import type { ModelCapability } from './model-catalog'
import type { MediaType } from './types'

/**
 * A creative node declared as data rather than written as a component.
 *
 * Every node in the redesign is the same eight rows — preview, toolbar, settings,
 * model pills, prompt, parameters, primary action, commit — differing only in what the
 * preview holds, which tools act on it, which capability each tool needs, and what
 * "finish" commits to. Those are fields, so one renderer serves all of them.
 *
 * This is also the precondition for connector intake proposing a *node* rather than only
 * a model (docs/architecture/connector-intake.md §5): adding a node becomes adding a
 * record, the same risk class as adding a model, instead of generating React.
 */

export type ToolIcon =
  | 'generate'
  | 'brush'
  | 'expand'
  | 'eraser'
  | 'upscale'
  | 'crop'
  | 'play'
  | 'extend'
  | 'wave'
  | 'music'
  | 'mic'
  | 'person'
  | 'images'
  | 'caption'
  | 'trash'
  | 'eye'
  | 'face'

export interface NodeToolDef {
  id: string
  label: string
  icon: ToolIcon
  /** The capability its model row asks the registry for. `null` runs locally (ffmpeg) —
   *  no models, no pill row, no network, no spend. */
  capability: ModelCapability | null
  /** Primary-button verb while this tool is active. */
  verb: string
  /** Dark until the preview holds something. Generation tools are false. */
  needsArtifact: boolean
  /** Opens the full-size canvas editor instead of acting from the panel. */
  surface?: 'canvas'
  /** Editor mode when `surface` is canvas — all three are direct manipulation of the
   *  same image at size, so they share one surface (build-plan Phase 14). */
  editorMode?: 'mask' | 'expand' | 'crop'
}

export type SettingKind =
  | 'style'
  | 'refs'
  | 'takes'
  | 'person'
  | 'voice'
  | 'sourceMedia'
  | 'startFrame'
  | 'endFrame'
  | 'loraKind'
  | 'steps'
  | 'caption'
  | 'language'

export interface NodeSettingDef {
  id: string
  label: string
  kind: SettingKind
  icon: ToolIcon
}

export interface NodeParameterDef {
  id: string
  kind: 'aspect' | 'resolution' | 'duration' | 'format' | 'seed'
  options?: string[]
  /** Only offered when the picked model declares it — seed is per-model (Krea 2 has it,
   *  Veo 3.1 explicitly does not), so a fixed control would lie on half the row. */
  perModel?: boolean
}

/** Where Finish sends the artifact. Not always the canvas — a LoRA saves a person. */
export type CommitTarget = 'canvas' | 'person'

export interface NodeManifest {
  id: string
  title: string
  media: MediaType
  /** What the preview holds: the generated artifact, or the inputs being assembled. */
  previewHolds: 'artifact' | 'dataset'
  tools: NodeToolDef[]
  settings: NodeSettingDef[]
  parameters: NodeParameterDef[]
  commit: CommitTarget
  commitLabel: string
  promptPlaceholder: string
  /** Aspect the preview frame uses before an artifact exists. */
  previewAspect: string
}

const TAKES: NodeSettingDef = { id: 'takes', label: 'TAKES', kind: 'takes', icon: 'images' }

export const IMAGE_NODE: NodeManifest = {
  id: 'image',
  title: 'Generate image',
  media: 'image',
  previewHolds: 'artifact',
  previewAspect: '9 / 16',
  tools: [
    { id: 'generate', label: 'generate', icon: 'generate', capability: 'image-gen', verb: 'Generate', needsArtifact: false },
    { id: 'inpaint', label: 'inpaint', icon: 'brush', capability: 'image-inpaint', verb: 'Inpaint', needsArtifact: true, surface: 'canvas', editorMode: 'mask' },
    { id: 'expand', label: 'expand', icon: 'expand', capability: 'image-inpaint', verb: 'Expand', needsArtifact: true, surface: 'canvas', editorMode: 'expand' },
    { id: 'removeBg', label: 'remove bg', icon: 'eraser', capability: 'bg-remove', verb: 'Remove background', needsArtifact: true },
    { id: 'upscale', label: 'upscale', icon: 'upscale', capability: 'upscale', verb: 'Upscale', needsArtifact: true },
    { id: 'reframe', label: 'reframe', icon: 'crop', capability: null, verb: 'Reframe', needsArtifact: true, surface: 'canvas', editorMode: 'crop' }
  ],
  settings: [
    { id: 'style', label: 'STYLE', kind: 'style', icon: 'person' },
    { id: 'refs', label: 'REFS', kind: 'refs', icon: 'images' },
    TAKES
  ],
  parameters: [
    { id: 'aspect', kind: 'aspect', options: ['9:16', '1:1', '16:9'] },
    { id: 'resolution', kind: 'resolution', options: ['1024', '2048'] },
    { id: 'seed', kind: 'seed', perModel: true }
  ],
  commit: 'canvas',
  commitLabel: 'Finish → add to canvas',
  promptPlaceholder: 'citrus-slice vinyl record spinning in fog, studio light'
}

export const VIDEO_NODE: NodeManifest = {
  id: 'video',
  title: 'Generate video',
  media: 'video',
  previewHolds: 'artifact',
  previewAspect: '9 / 16',
  tools: [
    { id: 'generate', label: 'generate', icon: 'play', capability: 'video-gen-t2v', verb: 'Generate', needsArtifact: false },
    { id: 'animate', label: 'animate', icon: 'generate', capability: 'video-gen-i2v', verb: 'Animate', needsArtifact: false },
    { id: 'extend', label: 'extend', icon: 'extend', capability: 'video-extension', verb: 'Extend +7s', needsArtifact: true },
    { id: 'lipsync', label: 'lipsync', icon: 'wave', capability: 'lipsync', verb: 'Lipsync', needsArtifact: true },
    { id: 'upscale', label: 'upscale', icon: 'upscale', capability: 'upscale', verb: 'Upscale', needsArtifact: true }
  ],
  settings: [
    { id: 'startFrame', label: 'START', kind: 'startFrame', icon: 'images' },
    { id: 'endFrame', label: 'END', kind: 'endFrame', icon: 'images' },
    TAKES
  ],
  parameters: [
    { id: 'aspect', kind: 'aspect', options: ['9:16', '16:9', '1:1'] },
    { id: 'duration', kind: 'duration', options: ['4s', '6s', '8s'] },
    { id: 'resolution', kind: 'resolution', options: ['720p', '1080p'] }
  ],
  commit: 'canvas',
  commitLabel: 'Finish → add to canvas',
  promptPlaceholder: 'lantern spirit rising from a river of flames, wide shot'
}

export const AUDIO_NODE: NodeManifest = {
  id: 'audio',
  title: 'Generate audio',
  media: 'audio',
  previewHolds: 'artifact',
  previewAspect: '16 / 9',
  tools: [
    { id: 'voice', label: 'voice', icon: 'mic', capability: 'audio-tts', verb: 'Speak', needsArtifact: false },
    { id: 'music', label: 'music', icon: 'music', capability: 'audio-music', verb: 'Compose', needsArtifact: false },
    { id: 'sfx', label: 'sfx', icon: 'wave', capability: 'audio-sfx', verb: 'Make sound', needsArtifact: false },
    { id: 'clone', label: 'clone', icon: 'person', capability: 'voice-clone', verb: 'Clone voice', needsArtifact: false },
    { id: 'isolate', label: 'isolate', icon: 'eraser', capability: null, verb: 'Isolate', needsArtifact: true }
  ],
  settings: [
    { id: 'voice', label: 'VOICE', kind: 'voice', icon: 'person' },
    { id: 'language', label: 'LANG', kind: 'language', icon: 'caption' },
    TAKES
  ],
  parameters: [
    { id: 'duration', kind: 'duration', options: ['15s', '30s', '60s'] },
    { id: 'format', kind: 'format', options: ['mp3', 'wav'] }
  ],
  commit: 'canvas',
  commitLabel: 'Finish → add to canvas',
  promptPlaceholder: 'the lyme doesn’t lie. it just doesn’t care.'
}

export const LORA_NODE: NodeManifest = {
  id: 'lora',
  title: 'Create a LoRA',
  media: 'image',
  previewHolds: 'dataset',
  previewAspect: '1 / 1',
  tools: [
    { id: 'add', label: 'add images', icon: 'images', capability: null, verb: 'Train', needsArtifact: false },
    { id: 'caption', label: 'auto-caption', icon: 'caption', capability: null, verb: 'Caption', needsArtifact: true },
    { id: 'remove', label: 'remove', icon: 'trash', capability: null, verb: 'Remove', needsArtifact: true },
    { id: 'preview', label: 'sample', icon: 'eye', capability: 'lora-use', verb: 'Sample', needsArtifact: true }
  ],
  settings: [
    { id: 'loraKind', label: 'KIND', kind: 'loraKind', icon: 'person' },
    { id: 'steps', label: 'STEPS', kind: 'steps', icon: 'caption' },
    { id: 'caption', label: 'CAPTION', kind: 'caption', icon: 'caption' }
  ],
  parameters: [],
  commit: 'person',
  commitLabel: 'Finish → save as a person',
  promptPlaceholder: 'joeyface — trigger word for this subject'
}

export const DEEPFAKE_NODE: NodeManifest = {
  id: 'deepfake',
  title: 'Deepfake',
  media: 'video',
  previewHolds: 'artifact',
  previewAspect: '9 / 16',
  tools: [
    { id: 'speech', label: 'speech', icon: 'mic', capability: 'audio-tts', verb: 'Speak', needsArtifact: false },
    { id: 'lipsync', label: 'lipsync', icon: 'wave', capability: 'lipsync', verb: 'Lipsync', needsArtifact: false },
    { id: 'faceSwap', label: 'face swap', icon: 'face', capability: 'face-swap', verb: 'Swap face', needsArtifact: false },
    { id: 'upscale', label: 'upscale', icon: 'upscale', capability: 'upscale', verb: 'Upscale', needsArtifact: true }
  ],
  settings: [
    { id: 'person', label: 'PERSON', kind: 'person', icon: 'person' },
    { id: 'voice', label: 'VOICE', kind: 'voice', icon: 'mic' },
    { id: 'sourceMedia', label: 'SOURCE', kind: 'sourceMedia', icon: 'play' }
  ],
  parameters: [{ id: 'aspect', kind: 'aspect', options: ['9:16', '16:9'] }],
  commit: 'canvas',
  commitLabel: 'Finish → add to canvas',
  promptPlaceholder: 'the lyme doesn’t lie. it just doesn’t care.'
}

export const NODE_MANIFESTS: NodeManifest[] = [
  IMAGE_NODE,
  VIDEO_NODE,
  AUDIO_NODE,
  LORA_NODE,
  DEEPFAKE_NODE
]

export function findManifest(id: string): NodeManifest | undefined {
  return NODE_MANIFESTS.find((m) => m.id === id)
}

export function findTool(manifest: NodeManifest, toolId: string): NodeToolDef | undefined {
  return manifest.tools.find((t) => t.id === toolId)
}
