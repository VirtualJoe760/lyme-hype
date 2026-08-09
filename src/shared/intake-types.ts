import type { ModelCapability } from './model-catalog'

/**
 * Record shapes for connector intake (docs/architecture/connector-intake.md).
 *
 * These live in `shared` rather than `main` because a proposal is reviewed by a human:
 * the classifier runs in the main process, but the review surface is renderer-side, and
 * neither should own the record shape the other reads.
 */

/** A tool exactly as an MCP server declared it in `tools/list`. Structurally the same as
 *  main's `McpToolInfo`, restated here so `shared` never imports from `main`. */
export interface ObservedTool {
  name: string
  description?: string
  inputSchema?: unknown
}

/** What `recordObservedTools` writes to `userData/connector-tools/<id>.json` (step 1). */
export interface ObservedToolsRecord {
  connectorId: string
  observedAt: string
  serverName?: string
  serverVersion?: string
  tools: ObservedTool[]
}

/**
 * Which kind of evidence a proposal's *weakest* link rests on — not its strongest.
 * `schema` is the server's own parameter contract, `name` is the tool id it publishes,
 * `description` is prose. Only `schema` may auto-apply (intake doc §2); the tier rides on
 * every record so a caller cannot mistake a keyword guess for a contract.
 */
export type ClassificationConfidence = 'schema' | 'name' | 'description'

export interface CapabilityProposal {
  toolName: string
  capability: ModelCapability
  confidence: ClassificationConfidence
  /** Human-readable, one line per signal: which fields, tokens, or phrases fired. */
  evidence: string[]
}

export type ProposalVerdict = 'auto-applicable' | 'needs-review' | 'denied'

/** Hard rule 5: source, method, and date on every generated record, so any entry can be
 *  re-derived and staleness is visible. `confidence` is the method. */
export interface ProposalProvenance {
  connectorId: string
  serverName?: string
  serverVersion?: string
  observedAt: string
  classifiedOn: string
}

export interface ConnectorCapabilityProposal extends CapabilityProposal {
  provenance: ProposalProvenance
  verdict: ProposalVerdict
}

export type SideEffectKind =
  | 'publish'
  | 'send'
  | 'delete'
  | 'purchase'
  | 'credentials'
  | 'execute'

export type SignalSource = 'name' | 'schema' | 'description'

export interface SideEffectSignal {
  kind: SideEffectKind
  source: SignalSource
  /** The literal token, field name, or phrase that fired the rule. */
  matched: string
  /** Where it was found — the tool name, or the schema field that carried it. */
  where: string
}

export interface ToolScreening {
  toolName: string
  verdict: 'deny' | 'allow'
  signals: SideEffectSignal[]
}

export interface ResidueTool {
  toolName: string
  description?: string
  schemaFields: string[]
  reason: 'unmatched' | 'no-schema'
  /** Flagged by the side-effect screen — noise for capability review, not a gap in the
   *  vocabulary, and never the argument for a new node. */
  flagged: boolean
}

export interface ConnectorResidue {
  connectorId: string
  serverName?: string
  observedAt: string
  tools: ResidueTool[]
}

export interface ResidueReport {
  classifiedOn: string
  connectors: ConnectorResidue[]
  total: number
}

export interface ConnectorIntakeResult {
  connectorId: string
  proposals: ConnectorCapabilityProposal[]
  residue: ConnectorResidue
  screening: ToolScreening[]
}
