import type {
  CapabilityProposal,
  ClassificationConfidence,
  ConnectorCapabilityProposal,
  ConnectorIntakeResult,
  ConnectorResidue,
  ObservedTool,
  ObservedToolsRecord,
  ResidueReport,
  ResidueTool,
  SideEffectKind,
  SideEffectSignal,
  SignalSource,
  ToolScreening
} from '@shared/intake-types'
import type { ModelCapability } from '@shared/model-catalog'

/**
 * Connector intake step 2 — schema-first capability classification, and the default-deny
 * side-effect screen (docs/architecture/connector-intake.md §2, §3.2).
 *
 * Pure and deterministic on purpose: no model call, no network, no filesystem, no Electron
 * import. Everything here is derivable from what `tools/list` already returned, which is
 * the entire argument of the intake doc — the checkable half gets checked mechanically so
 * the unhcheckable half is visibly queued for a person instead of silently guessed at.
 */

/**
 * Hard rule 4: classification picks from the closed vocabulary or reports residue, never
 * invents a key. A `Record` rather than a list so extending `ModelCapability` fails to
 * compile here until someone decides whether the new key is machine-inferable.
 *
 * `false` means "real capability, but no schema or name can establish it":
 * `image-production` is a spend-tier judgement (Midjourney-class), `video-extension` and
 * `voice-clone` are inferable only from prose, and both are handled as keyword rules that
 * never reach `schema` confidence.
 */
const PROPOSABLE: Record<ModelCapability, boolean> = {
  'image-gen': true,
  'image-production': false,
  'image-ref-conditioning': true,
  'image-edit': true,
  'image-inpaint': true,
  'video-gen-t2v': true,
  'video-gen-i2v': true,
  'video-frame-conditioning': true,
  'video-extension': true,
  'audio-tts': true,
  'audio-music': true,
  'audio-sfx': true,
  'voice-clone': true,
  lipsync: true,
  'face-swap': true,
  'lora-train': true,
  'lora-use': true,
  upscale: true,
  'bg-remove': true
}

import {
  TIERS,
  any,
  type FieldRole,
  type SchemaField,
  readSchema,
  tokenize,
  weaker
} from './connector-intake/schema'
import {
  indexRoles,
  inferMedia,
  outputTokens,
  type Media,
  type MediaGuess,
  type RoleIndex
} from './connector-intake/roles'

// Schema reading and role inference live in ./connector-intake/* — this file
// is the classifier and the screening rules that act on their output.

interface ClassifyContext {
  roles: RoleIndex
  media: MediaGuess
  /** Image fields that are the subject of the operation, not references or frames — the
   *  difference between "edit this image" and "generate, guided by these images". */
  primaryImages: SchemaField[]
}

interface RawProposal {
  capability: ModelCapability
  confidence: ClassificationConfidence
  evidence: string[]
}

function fieldEvidence(fields: SchemaField[]): string {
  return `schema: ${fields.map((f) => f.name).join(' + ')}`
}

function schemaRules(ctx: ClassifyContext): RawProposal[] {
  const { roles, media, primaryImages } = ctx
  const has = (r: FieldRole): boolean => roles[r].length > 0
  const out: RawProposal[] = []
  const add = (
    capability: ModelCapability,
    confidence: ClassificationConfidence,
    evidence: string[]
  ): void => {
    out.push({ capability, confidence, evidence })
  }

  if (has('trainingImages') || (has('trainingControl') && has('image'))) {
    const fields = has('trainingImages') ? roles.trainingImages : [...roles.image, ...roles.trainingControl]
    add('lora-train', 'schema', [fieldEvidence(fields)])
  }

  if (has('loraRef')) add('lora-use', 'schema', [fieldEvidence(roles.loraRef)])

  if (has('video') && has('audio')) {
    add('lipsync', 'schema', [fieldEvidence([roles.video[0], roles.audio[0]])])
  }

  if (has('sourceRef') && has('targetRef')) {
    add('face-swap', 'schema', [fieldEvidence([roles.sourceRef[0], roles.targetRef[0]])])
  }

  if (has('mask') && has('image')) {
    add('image-inpaint', 'schema', [fieldEvidence([roles.image[0], roles.mask[0]])])
  }

  if (has('startFrame')) add('video-gen-i2v', 'schema', [fieldEvidence(roles.startFrame)])
  if (has('startFrame') && has('endFrame')) {
    add('video-frame-conditioning', 'schema', [fieldEvidence([roles.startFrame[0], roles.endFrame[0]])])
  }

  const startVideoField = roles.startVideo.find((f) => any(f, 'start', 'continue', 'previous'))
  if (startVideoField && !has('audio') && !has('mask')) {
    add('video-extension', 'schema', [fieldEvidence([startVideoField])])
  }

  if (has('scaleFactor') && (has('image') || has('video'))) {
    add('upscale', 'schema', [fieldEvidence([...roles.image.slice(0, 1), ...roles.video.slice(0, 1), roles.scaleFactor[0]])])
  }

  if (has('voice') && (has('text') || has('prompt'))) {
    add('audio-tts', 'schema', [fieldEvidence([...(roles.text[0] ? [roles.text[0]] : roles.prompt.slice(0, 1)), roles.voice[0]])])
  }

  if (has('referenceImages')) {
    add('image-ref-conditioning', 'schema', [fieldEvidence(roles.referenceImages)])
  }

  const generative = has('prompt') || has('text')
  const promptField = roles.prompt[0] ?? roles.text[0]
  const mediaNote = media.evidence ? [media.evidence] : []
  // A *required* media input makes a tool a transformer; an optional one makes it a
  // generator that also accepts conditioning — Krea 2's optional `image_url` is why one
  // tool is both `image-gen` and `image-edit`, and muapi's required one is why its edit
  // tool is only the latter.
  const requiredMediaInput = [
    ...primaryImages,
    ...roles.startFrame,
    ...roles.video,
    ...roles.audio
  ].some((f) => f.required)

  if (generative && media.media === 'video') {
    if (primaryImages.length > 0) {
      add('video-gen-i2v', weaker('schema', media.tier), [
        fieldEvidence([promptField, primaryImages[0]]),
        ...mediaNote
      ])
    }
    if (!requiredMediaInput && !has('video') && !has('audio')) {
      add('video-gen-t2v', media.tier, [fieldEvidence([promptField]), ...mediaNote])
    }
  }

  if (generative && media.media === 'image' && !has('video') && !has('audio')) {
    if (primaryImages.length > 0 && !has('mask')) {
      add('image-edit', weaker('schema', media.tier), [
        fieldEvidence([promptField, primaryImages[0]]),
        ...mediaNote
      ])
    }
    if (!requiredMediaInput) {
      add('image-gen', media.tier, [fieldEvidence([promptField]), ...mediaNote])
    }
  }

  return out
}

interface KeywordRule {
  capability: ModelCapability
  media?: Media
  /** Every group must contribute at least one token — `['face'], ['swap']` means both. */
  groups: string[][]
}

/**
 * The prose half. These fire on a token stream from the tool name (tier `name`) and, failing
 * that, its description (tier `description`) — never at `schema`, because a keyword is not a
 * contract. Deliberately absent: outpaint/expand. The intake doc's own worked example is a
 * toolbar wired to an `outpaint_image` tool that no connector actually exposes, and there is
 * no `image-outpaint` key to propose — so an outpaint-shaped tool lands in residue, which is
 * the correct answer.
 */
const MAKE = ['generate', 'generates', 'generation', 'create', 'creates', 'creation', 'render', 'renders', 'draw', 'make', 'makes']

const KEYWORD_RULES: KeywordRule[] = [
  { capability: 'lipsync', groups: [['lipsync', 'lip'], ['lipsync', 'sync']] },
  { capability: 'face-swap', groups: [['face', 'faceswap'], ['swap', 'faceswap']] },
  { capability: 'upscale', groups: [['upscale', 'upscales', 'upscaling', 'superresolution', 'supersample']] },
  { capability: 'bg-remove', groups: [['background', 'bg'], ['remove', 'removes', 'removal', 'removing', 'erase']] },
  { capability: 'image-inpaint', groups: [['inpaint', 'inpaints', 'inpainting']] },
  { capability: 'lora-train', groups: [['train', 'trains', 'trainer', 'training', 'finetune']] },
  { capability: 'lora-use', groups: [['lora', 'loras']] },
  { capability: 'voice-clone', media: 'audio', groups: [['clone', 'clones', 'cloning']] },
  { capability: 'video-extension', media: 'video', groups: [['extend', 'extends', 'extension', 'continuation']] },
  { capability: 'audio-music', media: 'audio', groups: [['music', 'song', 'compose', 'composes', 'composition']] },
  { capability: 'audio-sfx', media: 'audio', groups: [['sfx', 'foley', 'ambience', 'sound'], ['sfx', 'foley', 'ambience', 'effect', 'effects']] },
  { capability: 'audio-tts', media: 'audio', groups: [['tts', 'speech', 'narrate', 'narration', 'speak']] },
  { capability: 'image-edit', media: 'image', groups: [['edit', 'edits', 'editing', 'restyle', 'transform', 'transforms', 'modify']] },
  { capability: 'video-gen-i2v', media: 'video', groups: [['i2v', 'animate', 'animates']] },
  { capability: 'image-gen', media: 'image', groups: [[...MAKE, 't2i']] },
  { capability: 'video-gen-t2v', media: 'video', groups: [[...MAKE, 't2v']] }
]

/**
 * Media-gated rules read only the *output* side of the name: `speech_to_text` contains the
 * token "speech" and is not a text-to-speech tool. Ungated rules (lipsync, upscale) read
 * the whole stream, since their keyword is the operation itself wherever it sits.
 */
function keywordRules(
  tokens: string[],
  media: MediaGuess,
  tier: ClassificationConfidence
): RawProposal[] {
  const out: RawProposal[] = []
  const output = outputTokens(tokens)
  for (const rule of KEYWORD_RULES) {
    if (rule.media && rule.media !== media.media) continue
    const scope = rule.media ? output : tokens
    const matched: string[] = []
    const satisfied = rule.groups.every((group) => {
      const hit = group.find((t) => scope.includes(t))
      if (hit) matched.push(hit)
      return hit !== undefined
    })
    if (!satisfied) continue
    const confidence = rule.media ? weaker(tier, media.tier) : tier
    const label = tier === 'name' ? 'name' : 'description'
    out.push({
      capability: rule.capability,
      confidence,
      evidence: [`${label}: ${[...new Set(matched)].map((m) => `"${m}"`).join(' + ')}`]
    })
  }
  return out
}

/**
 * Every capability an observed tool plausibly satisfies, one entry per capability, each
 * carrying the tier of the weakest evidence it rests on. Empty means residue — the tool
 * matched nothing in the closed vocabulary, which is the pipeline's most valuable output
 * (intake doc §4), not a failure.
 */
export function classifyTool(tool: ObservedTool): CapabilityProposal[] {
  const facts = readSchema(tool.inputSchema)
  const roles = indexRoles(facts)
  const nameTokens = tokenize(tool.name)
  const descriptionTokens = tokenize(tool.description ?? '')
  const media = inferMedia(roles, nameTokens, descriptionTokens)
  const excluded = new Set([
    ...roles.trainingImages,
    ...roles.referenceImages,
    ...roles.startFrame,
    ...roles.endFrame
  ])
  const ctx: ClassifyContext = {
    roles,
    media,
    primaryImages: roles.image.filter((f) => !excluded.has(f))
  }

  const raw = [
    ...schemaRules(ctx),
    ...keywordRules(nameTokens, media, 'name'),
    ...keywordRules(descriptionTokens, media, 'description')
  ]

  const best = new Map<ModelCapability, CapabilityProposal>()
  for (const proposal of raw) {
    if (!PROPOSABLE[proposal.capability]) continue
    const existing = best.get(proposal.capability)
    if (!existing) {
      best.set(proposal.capability, {
        toolName: tool.name,
        capability: proposal.capability,
        confidence: proposal.confidence,
        evidence: [...proposal.evidence]
      })
      continue
    }
    existing.confidence = TIERS.indexOf(proposal.confidence) < TIERS.indexOf(existing.confidence)
      ? proposal.confidence
      : existing.confidence
    for (const line of proposal.evidence) if (!existing.evidence.includes(line)) existing.evidence.push(line)
  }

  return [...best.values()].sort((a, b) => TIERS.indexOf(a.confidence) - TIERS.indexOf(b.confidence))
}

interface ScreenRule {
  kind: SideEffectKind
  /** Fires on its own — unambiguous in any connector's vocabulary. */
  tokens: string[]
  /** Fires only alongside a second token. `remove` is background removal until it sits next
   *  to `account`; `key` is a map key until it sits next to `create`. */
  qualified?: { tokens: string[]; withAny: string[] }
  /** Description phrases, matched literally. Multi-word on purpose: single words in prose
   *  deny half a catalog ("requires an API key" is on every generator's docs). */
  phrases: string[]
}

const SCREEN_RULES: ScreenRule[] = [
  {
    kind: 'publish',
    tokens: ['publish', 'unpublish', 'deploy', 'broadcast', 'tweet', 'livestream'],
    qualified: {
      tokens: ['post', 'posts', 'share', 'submit'],
      withAny: ['social', 'instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'linkedin', 'reddit', 'blog', 'feed', 'story', 'reel', 'channel', 'comment', 'review', 'schedule']
    },
    phrases: ['publish to', 'publishes to', 'posts to', 'goes live', 'cross-post', 'visible to the public']
  },
  {
    kind: 'send',
    tokens: ['send', 'sends', 'email', 'mail', 'sms', 'outbound', 'dial', 'notify', 'dm'],
    qualified: {
      tokens: ['call', 'calls', 'message', 'messages', 'invite', 'reply', 'agent', 'agents'],
      // A voice agent exists to place and answer calls, so creating or arming one is a
      // send-side effect a step removed — the case `DANGEROUS_TOOLS_BY_SERVER` names by hand
      // for ElevenLabs. Reading an agent (`get_agent`, `list_agents`) qualifies nothing.
      withAny: ['phone', 'outbound', 'number', 'sms', 'send', 'contact', 'lead', 'twilio', 'sip', 'recipient', 'create', 'update', 'knowledge']
    },
    phrases: ['sends an email', 'send a message', 'sends a message', 'phone call', 'outbound call', 'text message']
  },
  {
    kind: 'delete',
    tokens: ['delete', 'destroy', 'purge', 'wipe', 'revoke', 'uninstall', 'truncate'],
    qualified: {
      tokens: ['remove', 'erase', 'clear', 'drop', 'reset', 'cancel'],
      withAny: ['account', 'key', 'keys', 'file', 'files', 'asset', 'assets', 'user', 'users', 'member', 'project', 'projects', 'voice', 'agent', 'conversation', 'event', 'record', 'records', 'history', 'session', 'order', 'position', 'subscription', 'trial', 'renewal', 'website', 'workspace']
    },
    phrases: ['permanently delete', 'permanently removes', 'cannot be undone', 'irreversible']
  },
  {
    kind: 'purchase',
    tokens: ['purchase', 'buy', 'topup', 'checkout', 'payment', 'billing', 'refund', 'invoice', 'withdraw', 'deposit', 'onramp', 'subscribe'],
    qualified: {
      tokens: ['pay', 'charge', 'order', 'orders', 'credits', 'balance', 'transfer', 'trade', 'position', 'positions'],
      withAny: ['create', 'execute', 'place', 'add', 'buy', 'sell', 'purchase', 'top', 'up', 'close', 'open', 'fund', 'funds', 'card', 'stripe', 'account', 'convert']
    },
    phrases: ['top up', 'charges your', 'will be charged', 'payment method', 'places an order', 'real money']
  },
  {
    kind: 'credentials',
    tokens: ['apikey', 'credential', 'credentials', 'password', 'secret', 'secrets', 'passphrase'],
    qualified: {
      tokens: ['key', 'keys', 'token', 'tokens', 'auth'],
      withAny: ['api', 'create', 'delete', 'list', 'rotate', 'revoke', 'generate', 'update', 'set', 'add', 'reset', 'manage', 'new', 'access']
    },
    phrases: ['creates an api key', 'deletes an api key', 'rotate the key', 'revoke the key', 'manage api keys', 'returned once']
  },
  {
    kind: 'execute',
    tokens: ['shell', 'bash', 'terminal', 'subprocess', 'powershell'],
    qualified: {
      tokens: ['exec', 'execute', 'eval', 'run', 'code', 'command', 'script', 'sql', 'python', 'sandbox'],
      withAny: ['code', 'shell', 'bash', 'command', 'arbitrary', 'sandbox', 'exec', 'python', 'sql', 'script', 'terminal', 'blender', 'javascript']
    },
    phrases: ['arbitrary code', 'shell command', 'executes code', 'runs code', 'execute arbitrary']
  }
]

function matchTokens(rule: ScreenRule, tokens: string[]): string | null {
  const direct = rule.tokens.find((t) => tokens.includes(t))
  if (direct) return direct
  const qualified = rule.qualified
  if (!qualified) return null
  const hit = qualified.tokens.find((t) => tokens.includes(t))
  if (!hit) return null
  const partner = qualified.withAny.find((t) => t !== hit && tokens.includes(t))
  return partner ? `${hit} + ${partner}` : null
}

/**
 * Hard rule 2 — the default-deny screen. `DANGEROUS_TOOLS_BY_SERVER` in `generation.ts`
 * names muapi's and ElevenLabs's known side-effect tools by hand; a blocklist cannot cover
 * a connector nobody has seen. This inverts the default for those: an unseen tool whose
 * name or schema smells of publishing, sending, deleting, purchasing, key management or
 * code execution is denied until a human allows it.
 *
 * Deliberately not screened: `upload`. Asset upload is a prerequisite capability for half
 * the catalog's i2v paths — denying it by keyword would break generation to prevent nothing.
 */
export function screenTool(tool: ObservedTool): ToolScreening {
  const signals: SideEffectSignal[] = []
  const nameTokens = tokenize(tool.name)
  const description = (tool.description ?? '').toLowerCase()
  const fields = readSchema(tool.inputSchema).fields

  for (const rule of SCREEN_RULES) {
    const push = (matched: string, source: SignalSource, where: string): void => {
      signals.push({ kind: rule.kind, source, matched, where })
    }
    const byName = matchTokens(rule, nameTokens)
    if (byName) push(byName, 'name', tool.name)
    for (const field of fields) {
      const bySchema = matchTokens(rule, field.tokens)
      if (bySchema) push(bySchema, 'schema', field.name)
    }
    const phrase = rule.phrases.find((p) => description.includes(p))
    if (phrase) push(phrase, 'description', 'description')
  }

  return { toolName: tool.name, verdict: signals.length > 0 ? 'deny' : 'allow', signals }
}

/** Tool names an unseen connector should not auto-allow. Bare names — the caller owns the
 *  `mcp__<server>__<tool>` spelling, which lives with the agent wiring, not here. */
export function deniedToolNames(tools: readonly ObservedTool[]): string[] {
  return tools.filter((t) => screenTool(t).verdict === 'deny').map((t) => t.name)
}

function residueEntry(tool: ObservedTool, flagged: boolean): ResidueTool {
  const facts = readSchema(tool.inputSchema)
  return {
    toolName: tool.name,
    description: tool.description,
    schemaFields: facts.fields.map((f) => f.name),
    reason: facts.present ? 'unmatched' : 'no-schema',
    flagged
  }
}

/**
 * One connector's whole intake pass: proposals, residue, and the screen. Nothing here
 * writes or applies anything — a proposal is a record for review, per the doc's step 2.
 * A screened-deny tool's proposals are marked `denied` rather than dropped, because the
 * capability it satisfies is still true and still worth a human seeing.
 */
export function classifyObservedTools(
  record: ObservedToolsRecord,
  classifiedOn: string = new Date().toISOString().slice(0, 10)
): ConnectorIntakeResult {
  const proposals: ConnectorCapabilityProposal[] = []
  const residue: ResidueTool[] = []
  const screening: ToolScreening[] = []

  for (const tool of record.tools) {
    const screen = screenTool(tool)
    screening.push(screen)
    const matches = classifyTool(tool)
    if (matches.length === 0) {
      residue.push(residueEntry(tool, screen.verdict === 'deny'))
      continue
    }
    for (const match of matches) {
      proposals.push({
        ...match,
        provenance: {
          connectorId: record.connectorId,
          serverName: record.serverName,
          serverVersion: record.serverVersion,
          observedAt: record.observedAt,
          classifiedOn
        },
        verdict:
          screen.verdict === 'deny'
            ? 'denied'
            : match.confidence === 'schema'
              ? 'auto-applicable'
              : 'needs-review'
      })
    }
  }

  return {
    connectorId: record.connectorId,
    proposals,
    residue: {
      connectorId: record.connectorId,
      serverName: record.serverName,
      observedAt: record.observedAt,
      tools: residue
    },
    screening
  }
}

/**
 * Residue across every observed connector, grouped by connector — the report a human reads
 * to decide noise vs. new capability vs. new node (intake doc §4, §5). Connectors whose
 * every tool classified are dropped: an empty group is not a finding.
 */
export function reportResidue(
  records: readonly ObservedToolsRecord[],
  classifiedOn: string = new Date().toISOString().slice(0, 10)
): ResidueReport {
  const connectors: ConnectorResidue[] = []
  for (const record of records) {
    const { residue } = classifyObservedTools(record, classifiedOn)
    if (residue.tools.length > 0) connectors.push(residue)
  }
  return {
    classifiedOn,
    connectors,
    total: connectors.reduce((sum, c) => sum + c.tools.length, 0)
  }
}
