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

const TIERS: ClassificationConfidence[] = ['schema', 'name', 'description']

function weaker(a: ClassificationConfidence, b: ClassificationConfidence): ClassificationConfidence {
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b
}

/** `sourceVideoAssetId` → source video asset id; `images_data_url` → images data url. One
 *  token stream makes camelCase, snake_case and kebab-case servers match the same rules. */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface SchemaField {
  name: string
  tokens: string[]
  type: string | null
  isArray: boolean
  required: boolean
}

interface SchemaFacts {
  present: boolean
  fields: SchemaField[]
}

function readType(prop: Record<string, unknown>): { type: string | null; isArray: boolean } {
  const raw = prop['type']
  const type = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : null
  if (type === 'array') return { type: 'array', isArray: true }
  return { type, isArray: false }
}

function requiredNames(schema: Record<string, unknown>): Set<string> {
  const raw = schema['required']
  return new Set(Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [])
}

/** One level of nesting is walked because a wrapper object hides both halves of the job:
 *  a `{input: {command}}` tool must still trip the side-effect screen. Deeper than that is
 *  where field names stop describing the call and start describing a payload. */
function collectFields(
  props: Record<string, unknown>,
  required: Set<string>,
  prefix: string,
  depth: number
): SchemaField[] {
  const out: SchemaField[] = []
  for (const [name, value] of Object.entries(props)) {
    const prop = isRecord(value) ? value : {}
    const { type, isArray } = readType(prop)
    const path = prefix ? `${prefix}.${name}` : name
    const isRequired = required.has(name)
    out.push({ name: path, tokens: tokenize(path), type, isArray, required: isRequired })
    const nested = prop['properties']
    if (depth > 0 && isRecord(nested)) {
      const nestedRequired = isRequired ? requiredNames(prop) : new Set<string>()
      out.push(...collectFields(nested, nestedRequired, path, depth - 1))
    }
  }
  return out
}

function readSchema(inputSchema: unknown): SchemaFacts {
  if (!isRecord(inputSchema)) return { present: false, fields: [] }
  const props = inputSchema['properties']
  if (!isRecord(props)) return { present: false, fields: [] }
  const fields = collectFields(props, requiredNames(inputSchema), '', 1)
  // A tool that declares `properties: {}` published a contract saying "no arguments" — that
  // is a schema, and residue review should not read it as a server that told us nothing.
  return { present: true, fields }
}

type FieldRole =
  | 'prompt'
  | 'text'
  | 'voice'
  | 'mask'
  | 'image'
  | 'video'
  | 'audio'
  | 'startFrame'
  | 'endFrame'
  | 'startVideo'
  | 'sourceRef'
  | 'targetRef'
  | 'trainingImages'
  | 'trainingControl'
  | 'loraRef'
  | 'referenceImages'
  | 'scaleFactor'
  | 'duration'
  | 'aspect'
  | 'outputCount'
  | 'dimension'
  | 'frameRate'

const any =(f: SchemaField, ...tokens: string[]): boolean => tokens.some((t) => f.tokens.includes(t))

const MEDIA_HANDLE = ['url', 'uri', 'path', 'paths', 'id', 'ids', 'asset', 'assets', 'file', 'files', 'b64', 'base64', 'data', 'src', 'frame', 'reference', 'references', 'ref', 'refs']

/** Fields that merely *describe* media rather than carry it — `image_size`, `num_images`,
 *  `output_format` — must never read as an image input or every generator looks like an editor. */
const MEDIA_MODIFIER = ['size', 'count', 'num', 'number', 'width', 'height', 'quality', 'format', 'ratio', 'aspect', 'strength', 'scale', 'resolution', 'model', 'type', 'length', 'duration', 'fps']

function carriesMedia(f: SchemaField, kinds: string[]): boolean {
  if (!any(f, ...kinds)) return false
  if (any(f, ...MEDIA_MODIFIER)) return false
  return f.tokens.length === 1 || any(f, ...MEDIA_HANDLE)
}

const ROLE_TESTS: Record<FieldRole, (f: SchemaField) => boolean> = {
  // `system_prompt` configures an agent and `negative_prompt` steers one — neither is the
  // content field that makes a tool generative, and reading them as one turns ElevenLabs'
  // create_agent into a text-to-speech tool.
  prompt: (f) =>
    (any(f, 'prompt', 'instruction', 'instructions') || f.tokens.join('') === 'description') &&
    !any(f, 'system', 'negative'),
  text: (f) => any(f, 'text', 'script', 'ssml', 'lyrics') && !any(f, 'format', 'model'),
  voice: (f) => any(f, 'voice', 'voices', 'speaker'),
  mask: (f) => any(f, 'mask', 'masks'),
  image: (f) => carriesMedia(f, ['image', 'images', 'img', 'photo', 'photos', 'picture']),
  video: (f) => carriesMedia(f, ['video', 'videos', 'footage']),
  audio: (f) => carriesMedia(f, ['audio', 'music', 'sound', 'song', 'speech']),
  startFrame: (f) => any(f, 'start', 'first', 'init', 'begin') && any(f, 'frame', 'image', 'img', 'photo'),
  endFrame: (f) => any(f, 'end', 'last', 'final', 'tail') && any(f, 'frame', 'image', 'img', 'photo'),
  startVideo: (f) => any(f, 'start', 'source', 'input', 'continue', 'previous') && any(f, 'video', 'footage'),
  sourceRef: (f) => f.tokens[0] === 'source' && !any(f, 'video', 'audio'),
  targetRef: (f) => f.tokens[0] === 'target',
  trainingImages: (f) =>
    (any(f, 'images', 'image', 'dataset') && any(f, 'data', 'zip', 'archive', 'tar', 'dataset')) ||
    any(f, 'zip'),
  trainingControl: (f) =>
    any(f, 'steps', 'epochs') ||
    (any(f, 'learning') && any(f, 'rate')) ||
    (any(f, 'trigger') && any(f, 'word', 'phrase')),
  loraRef: (f) => any(f, 'lora', 'loras', 'adapter', 'adapters') || (f.isArray && any(f, 'styles', 'weights')),
  referenceImages: (f) =>
    f.isArray &&
    any(f, 'image', 'images', 'img', 'photo', 'photos') &&
    any(f, 'reference', 'references', 'ref', 'refs'),
  scaleFactor: (f) => any(f, 'scale', 'scaling', 'upscale', 'magnification'),
  duration: (f) => any(f, 'duration', 'seconds') || (any(f, 'length') && any(f, 'ms', 'sec', 'seconds')),
  aspect: (f) => any(f, 'aspect') || f.tokens.join('') === 'ratio',
  outputCount: (f) => any(f, 'num', 'number', 'n') && any(f, 'images', 'outputs', 'samples', 'results'),
  dimension: (f) => any(f, 'width', 'height') || (any(f, 'image') && any(f, 'size')),
  frameRate: (f) => any(f, 'fps') || (any(f, 'num') && any(f, 'frames')) || (any(f, 'frame') && any(f, 'rate'))
}

/** Derived, not restated: `ROLE_TESTS` is a total `Record<FieldRole, …>`, so adding a role to
 *  the union fails to compile until it has a test, and it is then indexed automatically. */
const ROLES = Object.keys(ROLE_TESTS) as FieldRole[]

type RoleIndex = Record<FieldRole, SchemaField[]>

function indexRoles(facts: SchemaFacts): RoleIndex {
  const index = Object.fromEntries(ROLES.map((r) => [r, [] as SchemaField[]])) as RoleIndex
  for (const field of facts.fields) {
    for (const role of ROLES) if (ROLE_TESTS[role](field)) index[role].push(field)
  }
  return index
}

type Media = 'image' | 'video' | 'audio'

const MEDIA_WORDS: Record<Media, string[]> = {
  video: ['video', 'videos', 'animate', 'animation', 'motion', 'clip', 'clips', 'veo', 'i2v', 't2v', 'reel'],
  image: ['image', 'images', 'img', 'picture', 'photo', 'photos', 'draw', 'paint', 'inpaint', 'poster', 'thumbnail'],
  audio: ['audio', 'speech', 'tts', 'voice', 'music', 'song', 'sound', 'sfx', 'narration', 'dub', 'dubbing']
}

/**
 * `text_to_speech` outputs speech; `video_to_music` outputs music; `muapi_video_from_image`
 * outputs video. The preposition says which side of the name is the *output* — reading the
 * whole name instead lands `video_to_music` on video, which is exactly backwards.
 */
function outputTokens(tokens: string[]): string[] {
  const to = Math.max(tokens.lastIndexOf('to'), tokens.lastIndexOf('into'))
  if (to >= 0 && to < tokens.length - 1) return tokens.slice(to + 1)
  const from = tokens.indexOf('from')
  if (from > 0) return tokens.slice(0, from)
  return tokens
}

function mediaFromWords(tokens: string[]): Media | null {
  const scoped = outputTokens(tokens)
  for (const media of ['video', 'image', 'audio'] as Media[]) {
    if (MEDIA_WORDS[media].some((w) => scoped.includes(w))) return media
  }
  return null
}

interface MediaGuess {
  media: Media | null
  tier: ClassificationConfidence
  evidence: string | null
}

/**
 * Schemas do not declare outputs, so the medium is inferred — but some parameters pin it
 * anyway: `aspect_ratio` alongside a duration is a video (audio has no aspect ratio), a
 * voice field is audio, `num_images`/`width` with no duration is an image. Everything else
 * falls back to the tool's name and then its prose, at correspondingly lower confidence.
 */
function inferMedia(roles: RoleIndex, nameTokens: string[], descriptionTokens: string[]): MediaGuess {
  const has = (r: FieldRole): boolean => roles[r].length > 0
  if (has('voice')) return { media: 'audio', tier: 'schema', evidence: `schema: ${roles.voice[0].name}` }
  if (has('frameRate')) return { media: 'video', tier: 'schema', evidence: `schema: ${roles.frameRate[0].name}` }
  if (has('duration') && has('aspect')) {
    return { media: 'video', tier: 'schema', evidence: `schema: ${roles.duration[0].name} + ${roles.aspect[0].name}` }
  }
  if (!has('duration') && (has('outputCount') || has('dimension'))) {
    const field = (roles.outputCount[0] ?? roles.dimension[0]).name
    return { media: 'image', tier: 'schema', evidence: `schema: ${field}` }
  }
  const byName = mediaFromWords(nameTokens)
  if (byName) return { media: byName, tier: 'name', evidence: `name: "${byName}" in tool name` }
  const byDescription = mediaFromWords(descriptionTokens)
  if (byDescription) return { media: byDescription, tier: 'description', evidence: `description: mentions "${byDescription}"` }
  return { media: null, tier: 'description', evidence: null }
}

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
