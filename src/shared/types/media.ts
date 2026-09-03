/** Generation requests and results — the vocabulary every connector speaks. */

export type MediaType = 'image' | 'video' | 'audio'

export type SourceMethod = 'generate' | 'upload' | 'link'

export type NodeStatus = 'rendering' | 'ready' | 'error'

/** A generation request from the renderer. The agent picks the actual MCP tool. */
export interface GenerationParams {
  mediaType: MediaType
  prompt: string
  aspectRatio?: string
  durationSec?: number
  resolution?: string
  /** Restrict to a single connector by id; omit to let the agent choose.
   *  Superseded by `connectorIds` when both are set. */
  connectorId?: string
  /** Restrict to a specific SET of connectors — lets the agent chain tools
   *  across exactly those (e.g. muapi + yapper for Deepfake's upload-then-
   *  lipsync handoff) without opening every installed connector. */
  connectorIds?: string[]
  /** Nudge toward a specific model within a connector (e.g. "Midjourney" on
   *  muapi for production-tier image) — advisory, included in the prompt. */
  modelHint?: string
  /** Exact model id to pass to the tool's own `model` parameter when it has
   *  one (e.g. gemini-3.1-flash-lite-image, veo-3.1-lite-generate-preview) —
   *  stronger than modelHint: a parameter, not a preference. */
  model?: string
  /** Image output size tier for tools that support it: 0.5K | 1K | 2K | 4K.
   *  Price scales with size (docs/connectors/reference/gemini.md pricing). */
  imageSize?: string
  /** "Generate as typed": skip the automatic prompt refinement that thin prompts
   *  and local models otherwise get. */
  skipRefine?: boolean
  /** Composition reasoning depth (gemini-3.1-flash-image only): minimal | high. */
  thinkingLevel?: string
  /** CHARACTER reference images — preserve this exact person's likeness across
   *  generations; lyme-asset:// URLs or paths, resolved main-side. */
  characterReferencePaths?: string[]
  /** STYLE reference images — match their look, not their content. */
  styleReferencePaths?: string[]
  /** Veo people policy: allow_all (text-to-video) | allow_adult (image-conditioned). */
  personGeneration?: string
  /** Sampling steps for local diffusion tools (comfyui) that expose them. */
  steps?: number
  /** img2img inspiration dial for single-reference local tools (comfyui):
   *  1 ≈ ignore the reference, 0.6 balanced, 0.3 ≈ close variation. */
  refStrength?: number
  /** Reference images to condition the generation on — lyme-asset:// URLs or
   *  absolute paths; resolved to paths main-side (owned wrappers accept them
   *  via reference_image_paths). */
  referenceImagePaths?: string[]
  /** Frame conditioning for video (Veo via the Gemini wrapper): first frame. */
  startFramePath?: string
  /** Frame conditioning for video: last frame (same as start = seamless loop). */
  endFramePath?: string
  /** Local audio file(s) to hand the agent (e.g. Deepfake's generated speech
   *  clip) — lyme-asset:// URLs or absolute paths, resolved main-side the
   *  same way as referenceImagePaths. */
  referenceAudioPaths?: string[]
  /** The face/performance media to drive (Deepfake's source video or still
   *  photo) — lyme-asset:// URL or absolute path, resolved main-side. */
  sourceMediaPath?: string
  /** Resolved main-side from maskDataUrl — the on-disk mask path handed to tools. */
  maskPath?: string
  /** Inpaint mask painted in the canvas editor — a `data:image/png;base64,…` URL
   *  the main process writes to the asset store before handing the agent a path.
   *  Painted areas are what gets regenerated. */
  maskDataUrl?: string
  /** A previously generated video to extend by ~7s (Veo via the Gemini
   *  wrapper's gemini_extend_video) — lyme-asset:// URL or absolute path,
   *  resolved main-side. Set alongside `extendVideoDurationSec` when the
   *  source clip's current length is known, so the wrapper can enforce
   *  Veo's 148s total-extension cap. */
  extendVideoPath?: string
  /** The source clip's current total length in seconds, if known. */
  extendVideoDurationSec?: number
}

export interface LocalToolResult {
  ok: boolean
  src?: string
  error?: string
}

/** Combine dialog's four non-generative pairs — real local ffmpeg compositing,
 *  no connector/agent call. video+video and image+video/audio+video/audio+audio
 *  each map to one deterministic filter graph, unlike image+image/audio+image
 *  which need the agent's judgment and go through GenerationParams instead. */
export type CombineLocalKind = 'stitch-video' | 'overlay-image' | 'score-video' | 'mix-audio'

export interface CombineLocalRequest {
  kind: CombineLocalKind
  /** lyme-asset:// URLs. Meaning depends on kind: stitch-video/mix-audio are
   *  order-preserving pairs; overlay-image is {video, image}; score-video is
   *  {video, audio}. */
  aUrl: string
  bUrl: string
}

export interface VoiceEntry {
  name: string
  /** Compact descriptor line: category · labels. */
  tags: string
}

export interface AudioToolResult {
  ok: boolean
  src?: string
  text?: string
  /** Structured voice rows when the listing parsed; raw `text` is the fallback. */
  voices?: VoiceEntry[]
  /** `GET /audio/voices` rows — id-keyed, unlike ElevenLabs's name-keyed `voices`,
   *  since Yapper's `/audio/speech` takes a `voiceId`, not a name. */
  yapperVoices?: YapperVoiceEntry[]
  /** Yapper's `/audio/speech` free daily-character tier remaining count. */
  freeCharactersRemainingToday?: number
  error?: string
}

export interface YapperVoiceEntry {
  id: string
  name: string
}

export interface TrainedStyle {
  id: string
  name: string
  /** 'fal' for the fal-hosted Krea trainers (the default); 'krea' for styles
   *  trained via Krea's own `/styles/train` (`krea-training.ts`) — the only
   *  ones usable via `styles:[{id,strength}]` at generation time. Drives
   *  Generate image's routing: a style always generates through the backend
   *  that trained it. */
  connectorId: 'krea' | 'fal'
  /** Which trainer produced it: fal's ('krea-2' | 'flux-krea') or Krea's own
   *  ('krea-k2') — see `connectorId` for which backend the style lives on
   *  (a 'krea-k2' style always has `connectorId: 'krea'`). */
  trainer?: string
  /** URL of the trained LoRA weights (safetensors) — the generation input. */
  loraUrl?: string
  trainedAt: string
  referenceImageCount: number
  /** ElevenLabs voice name paired with this identity — turns a plain trained
   *  LoRA into a "Reference person" (likeness + voice in one record) that the
   *  Deepfake tile can pick from. Matches elevenlabs-tools.ts's `voiceName`
   *  param (the MCP tool takes voice_name, not an id). */
  voiceName?: string
  /** Free-text tone/persona tag ("calm authoritative newsreader", "energetic
   *  upbeat vlogger") — lets a Storyboard shot's "feeling" annotation suggest
   *  which Reference person a Deepfake script should default to, instead of
   *  the user re-picking the same person by hand for every matching shot. */
  personaTone?: string
}

export interface TrainStyleResult {
  ok: boolean
  style?: TrainedStyle
  error?: string
}

export interface GenerationResult {
  ok: boolean
  /** lyme-asset:// URL of the imported result, when ok. */
  src?: string
  /** Downscaled companion for canvas thumbnails — rendering the full asset into a
   *  62px node meant decoding a multi-megabyte image per node, per render. */
  thumbSrc?: string
  mediaType: MediaType
  /** Short provenance note (tool/model/cost) for display. */
  note?: string
  /** The prompt actually passed to the generation tool — differs from the request
   *  when the agent translated (Chinese-native models). Captured from the tool
   *  call itself, so it is proof of what was sent, not what was claimed. */
  promptUsed?: string
  /** Dollars actually billed for the agent's tokens — null on the Claude login,
   *  where token usage is plan consumption. NEVER the connector's charge for the
   *  media itself, which the app cannot observe (AGENTS.md §1.8); the `note`
   *  carries the token figure labelled as tokens. */
  costUsd?: number | null
  error?: string
  /** The user's original prompt, when the safeguard rewrote it before generating. */
  refinedFrom?: string
  /** Local-model attempts the verifier rejected before this one — kept, with the
   *  reason, so a safeguard is something you can see working. */
  rejected?: { src: string; thumbSrc?: string; reason: string }[]
  /** Whether a vision check ran on the returned image, and why not if it didn't. */
  verification?: { checked: boolean; reason?: string }
}

/** One finished generation, logged main-side so a result can be recovered even
 *  when the renderer that requested it is gone (generation-log.ts). */
/** What the app can actually do on this machine — shown in the startup console. */
export interface SystemStatus {
  /** How ffmpeg was found ('path' | 'bundled' | 'env'), or null if absent. */
  ffmpeg: string | null
  workspace: string
  connectors: number
  projects: number
  /** When this build was compiled, plus the commit it came from. */
  build: string
  /** True when a source file is newer than the running build — i.e. this window
   *  is showing code that has since been changed. Dev launches only. */
  stale: boolean
}

export interface GenerationRecord {
  id: string
  /** lyme-asset:// URL of the imported result. */
  src: string
  thumbSrc?: string
  mediaType: MediaType
  prompt: string
  note?: string
  at: string
}

/** Where the local ComfyUI engine is, as owned and watched by the main process. */
export interface ComfyState {
  phase: 'off' | 'starting' | 'ready' | 'loading' | 'error'
  /** The latest meaningful line from the server — the "terminal context". */
  detail: string
  /** Checkpoint currently resident, when known. */
  model?: string
  /** True when the app started this server (or adopted an orphan of its own) and will stop it on quit. */
  owned: boolean
  pid?: number
  /** Committed private memory of an owned server, sampled every 10 s by the watchdog. */
  memGb?: number
  /** When an idle owned server will be stopped (pushed out by every generation). */
  idleStopsAt?: string
  updatedAt: string
}
