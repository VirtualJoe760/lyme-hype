/**
 * Turning schema facts into roles and a media guess — does this field carry an
 * image, is that one just a size modifier, is the tool about video or audio.
 */

import type { ClassificationConfidence } from '@shared/intake-types'
import { any, type FieldRole, type SchemaField, type SchemaFacts } from './schema'

export const MEDIA_HANDLE = ['url', 'uri', 'path', 'paths', 'id', 'ids', 'asset', 'assets', 'file', 'files', 'b64', 'base64', 'data', 'src', 'frame', 'reference', 'references', 'ref', 'refs']

/** Fields that merely *describe* media rather than carry it — `image_size`, `num_images`,
 *  `output_format` — must never read as an image input or every generator looks like an editor. */
export const MEDIA_MODIFIER = ['size', 'count', 'num', 'number', 'width', 'height', 'quality', 'format', 'ratio', 'aspect', 'strength', 'scale', 'resolution', 'model', 'type', 'length', 'duration', 'fps']

export function carriesMedia(f: SchemaField, kinds: string[]): boolean {
  if (!any(f, ...kinds)) return false
  if (any(f, ...MEDIA_MODIFIER)) return false
  return f.tokens.length === 1 || any(f, ...MEDIA_HANDLE)
}

export const ROLE_TESTS: Record<FieldRole, (f: SchemaField) => boolean> = {
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
export const ROLES = Object.keys(ROLE_TESTS) as FieldRole[]

export type RoleIndex = Record<FieldRole, SchemaField[]>

export function indexRoles(facts: SchemaFacts): RoleIndex {
  const index = Object.fromEntries(ROLES.map((r) => [r, [] as SchemaField[]])) as RoleIndex
  for (const field of facts.fields) {
    for (const role of ROLES) if (ROLE_TESTS[role](field)) index[role].push(field)
  }
  return index
}

export type Media = 'image' | 'video' | 'audio'

export const MEDIA_WORDS: Record<Media, string[]> = {
  video: ['video', 'videos', 'animate', 'animation', 'motion', 'clip', 'clips', 'veo', 'i2v', 't2v', 'reel'],
  image: ['image', 'images', 'img', 'picture', 'photo', 'photos', 'draw', 'paint', 'inpaint', 'poster', 'thumbnail'],
  audio: ['audio', 'speech', 'tts', 'voice', 'music', 'song', 'sound', 'sfx', 'narration', 'dub', 'dubbing']
}

/**
 * `text_to_speech` outputs speech; `video_to_music` outputs music; `muapi_video_from_image`
 * outputs video. The preposition says which side of the name is the *output* — reading the
 * whole name instead lands `video_to_music` on video, which is exactly backwards.
 */
export function outputTokens(tokens: string[]): string[] {
  const to = Math.max(tokens.lastIndexOf('to'), tokens.lastIndexOf('into'))
  if (to >= 0 && to < tokens.length - 1) return tokens.slice(to + 1)
  const from = tokens.indexOf('from')
  if (from > 0) return tokens.slice(0, from)
  return tokens
}

export function mediaFromWords(tokens: string[]): Media | null {
  const scoped = outputTokens(tokens)
  for (const media of ['video', 'image', 'audio'] as Media[]) {
    if (MEDIA_WORDS[media].some((w) => scoped.includes(w))) return media
  }
  return null
}

export interface MediaGuess {
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
export function inferMedia(roles: RoleIndex, nameTokens: string[], descriptionTokens: string[]): MediaGuess {
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
