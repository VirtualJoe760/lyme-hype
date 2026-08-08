/**
 * The agent's LLM backend. The default is Claude via this machine's own Claude
 * Code login; other providers are any Anthropic-API-compatible endpoint (Kimi's
 * hosted one, or a local/OpenAI model behind a translation proxy that exposes an
 * Anthropic-shaped API). The agent injects ANTHROPIC_BASE_URL + auth + model.
 */
export type ModelProviderKind = 'claude-default' | 'anthropic-compatible'

export interface ModelProviderDef {
  id: string
  name: string
  kind: ModelProviderKind
  /** anthropic-compatible only: the endpoint the SDK targets via ANTHROPIC_BASE_URL. */
  baseUrl?: string
  /** anthropic-compatible only: the model id to request. */
  model?: string
  /** Label shown in the secure modal when collecting this provider's key. */
  secretFieldLabel: string
  builtin?: boolean
  docUrl?: string
}

export interface ModelProviderView extends ModelProviderDef {
  hasCredential: boolean
  active: boolean
}

export type ClaudeAuthOverrideKind = 'none' | 'apiKey' | 'oauthToken'

export interface ClaudeAuthStatus {
  /** 'none' = using this machine's own Claude Code login (the normal case). */
  override: ClaudeAuthOverrideKind
}

export type ThemeId = 'lime-cut' | 'night-terminal' | 'zest'

export type MediaType = 'image' | 'video' | 'audio'
export type SourceMethod = 'generate' | 'upload' | 'link'
export type NodeStatus = 'rendering' | 'ready'
export type StudioView = 'canvas' | 'storyboard'

export interface MediaNodeData {
  label: string
  mediaType: MediaType
  source: SourceMethod
  status: NodeStatus
  /** Placeholder-thumbnail swatch index (1-6) for stub nodes without real media. */
  swatch: number
  /** Real image source (lyme-asset:// URL), e.g. a ChatRealty listing photo. */
  src?: string
  /** Motion-graphics flavored video nodes keep a tag so the aside's tab choice isn't lost. */
  motionGfx?: boolean
  sentToTimeline?: boolean
  /** Set for upload nodes; real media pipeline lands in Phase 4. */
  filePath?: string
  /** Set for link nodes; download/transcode lands in Phase 4. */
  sourceUrl?: string
  /** Provenance for connection-sourced nodes (e.g. ChatRealty listing). */
  detailUrl?: string
  listingKey?: string
  /** Non-destructive in/out points (seconds) set in Play view; playback and
   *  export clamp to these without altering the underlying file. */
  trimIn?: number
  trimOut?: number
  /** Video's own audio track muted (set via Play view's audio delete). */
  audioMuted?: boolean
  [key: string]: unknown
}

export interface CanvasNodeState {
  id: string
  position: { x: number; y: number }
  data: MediaNodeData
}

export interface CutClip {
  id: string
  nodeId: string
  label: string
  mediaType: MediaType
  swatch: number
}

export interface Session {
  id: string
  name: string
  createdAt: string
  nodes: CanvasNodeState[]
  cutRoom: CutClip[]
  view: StudioView
}

export interface PersistedState {
  sessions: Session[]
  activeSessionId: string | null
  theme?: ThemeId
}

export interface AgentStreamEvent {
  kind: 'text' | 'status'
  text: string
}

export interface AgentPingResult {
  ok: boolean
  text: string
  costUsd: number | null
  durationMs: number
  error?: string
}

export type ConnectorKind = 'stdio' | 'http'
export type ConnectorAuthType = 'none' | 'apiKey' | 'bearer'

/**
 * A generic MCP connector — the product requirement is that a user can add one
 * we've never heard of, not just the pre-templated ones. Non-secret fields only;
 * the credential lives in the safeStorage vault keyed by this connector's id.
 */
export interface ConnectorDef {
  id: string
  name: string
  kind: ConnectorKind
  /** stdio: the local command + args. */
  command?: string
  args?: string[]
  /** http: the server URL. */
  url?: string
  /** Non-secret env vars (stdio) passed to the child process. */
  env?: Record<string, string>
  authType: ConnectorAuthType
  /**
   * Where the secret is injected: for stdio, the env-var name; for http, the
   * header name. Ignored when authType is 'none'.
   */
  secretKey?: string
  /** Label shown in the secure-credential modal. */
  secretFieldLabel: string
  /** Built-in template (ChatRealty) — present by default, not user-deletable. */
  builtin?: boolean
  docUrl?: string
}

export interface ConnectorView extends ConnectorDef {
  hasCredential: boolean
}

export interface ConnectorTestResult {
  ok: boolean
  serverName?: string
  serverVersion?: string
  toolCount?: number
  note?: string
  error?: string
}

/**
 * A known tool in the suggested-connectors catalog. "Open setup page" drives the
 * browser to keyPageUrl; "Add" installs `template` as an installed connector.
 * `available: false` means it needs transport support not built yet (http MCP,
 * OAuth, a Gemini wrapper) — still worth showing so the user can grab the key.
 */
export interface ConnectorSuggestion {
  id: string
  name: string
  blurb: string
  category: string
  keyPageUrl: string
  installed: boolean
  available: boolean
  note?: string
}

export interface ChatRealtyListing {
  listingKey: string
  address: string
  city: string
  listPrice: number | null
  beds: number | null
  baths: number | null
  detailUrl: string | null
}

export interface ChatRealtyPulledImage {
  src: string
  label: string
  listingKey: string
  detailUrl: string | null
}

export interface ChatRealtyPullResult {
  ok: boolean
  images: ChatRealtyPulledImage[]
  listings: ChatRealtyListing[]
  error?: string
}

/** The only credential facts the agent or renderer ever sees — never the value. */
export interface SecretReport {
  connectorId: string
  fieldLabel: string
  length: number
  last4: string
  savedAt: string
}

export interface SecretRequest {
  connectorId: string
  connectorName: string
  fieldLabel: string
}
