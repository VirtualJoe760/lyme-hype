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
export type NodeStatus = 'rendering' | 'ready' | 'error'
export type StudioView = 'canvas' | 'storyboard' | 'scripting'

/** One message in a session's Scripting conversation (docs/ui/scripting-panel.md). */
export interface ScriptingMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
}

/** Persisted on Session — plain JSON through the same persist path as nodes. */
export interface ScriptingState {
  messages: ScriptingMessage[]
  /** SDK session id so each turn resumes the same conversation server-side.
   *  If resuming ever fails, the turn falls back to replaying `messages`. */
  agentSessionId?: string
  totalCostUsd: number
}

/** A multi-turn conversation turn (Scripting panel, Motion graphics wizard). */
export interface ConversationTurnRequest {
  /** Attribution id for stream events — the renderer's conversation key. */
  conversationId: string
  resumeSessionId?: string
  prompt: string
  /** Absolute paths of images attached as vision input. */
  imagePaths?: string[]
  /** Replay transcript used when there's no resumable SDK session. */
  history?: { role: 'user' | 'assistant'; text: string }[]
  systemPrompt?: string
}

export interface ConversationTurnResult {
  ok: boolean
  text: string
  agentSessionId?: string
  costUsd: number | null
  error?: string
}

export interface ConversationStreamEvent {
  conversationId: string
  text: string
}

export interface ShotBreakdownResult {
  ok: boolean
  shots: { label: string; description: string }[]
  agentSessionId?: string
  costUsd: number | null
  error?: string
}

export interface ImprovePromptResult {
  ok: boolean
  prompt: string
  costUsd: number | null
  error?: string
}

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
  /** Yapper's `/audio/speech` free daily-character tier remaining count. */
  freeCharactersRemainingToday?: number
  error?: string
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
  mediaType: MediaType
  /** Short provenance note (tool/model/cost) for display. */
  note?: string
  costUsd?: number | null
  error?: string
}

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
  /** Short provenance note from a real generation (tool/model). */
  genNote?: string
  /** Failure reason when status is 'error' (e.g. generation failed). */
  error?: string
  /** Non-destructive in/out points (seconds) set in Play view; playback and
   *  export clamp to these without altering the underlying file. */
  trimIn?: number
  trimOut?: number
  /** Video's own audio track muted (set via Play view's audio delete). */
  audioMuted?: boolean
  /** Storyboard panel: a cheap planning sketch that lives only in the Storyboard
   *  sequence until promoted. `panel` and `promoted` are the same node object —
   *  promotion flips the flag and gives it a canvas position, never a copy. */
  panel?: boolean
  panelOrder?: number
  promoted?: boolean
  /** Shot/prompt note authored on a Storyboard panel; carried onto the node when
   *  promoted so the generation call (Phase 4) has the intent. */
  note?: string
  /** Set on panels created by the Scripting panel's shot breakdown: what
   *  happens in the shot (from the script). Feeds the improve-prompt call. */
  shotDescription?: string
  /** The user's "generalized feeling" annotation for a script-born shot —
   *  mood/tone in a few words, the human judgment step. */
  feeling?: string
  /** Storyboard image panels: restrict promotion's generation to one connector
   *  (the storyboard-tier model choice — Gemini vs OpenAI). */
  connectorId?: string
  [key: string]: unknown
}

export interface CanvasNodeState {
  id: string
  position: { x: number; y: number }
  data: MediaNodeData
}

/** Legacy single-track Cut Room clip (pre-multitrack). Only survives in old
 *  persisted sessions; migrated to TimelineClip on load. */
export interface CutClip {
  id: string
  nodeId: string
  label: string
  mediaType: MediaType
  swatch: number
}

export type TrackType = 'video' | 'audio'

export interface TimelineTrack {
  id: string
  type: TrackType
  name: string
  /** Real, persistent state: silences (audio) / hides from compositing (video)
   *  in BOTH live preview and export. */
  muted: boolean
  /** Monitoring convenience only — affects the live preview, NEVER export.
   *  The export payload type (TimelineExportSpec) deliberately has no solo
   *  field, so leaking it into an export is a compile error, not a bug. */
  soloed: boolean
  /** Prevents accidental edits to this track's clips. */
  locked: boolean
  /** Among same-type tracks. Lowest video order = compositing base. */
  order: number
}

/** A clip is a rectangle positioned in time, not a list entry. */
export interface TimelineClip {
  id: string
  nodeId: string
  trackId: string
  /** Seconds from timeline zero. */
  startTime: number
  /** The timeline clip's OWN trim — seeded from the node's Play-view trim when
   *  added, independently editable after (the same asset can appear twice with
   *  two different cuts). */
  trimIn: number
  trimOut: number
  /** Source media duration for retrim clamping; 0 = not probed yet. */
  sourceDuration: number
  label: string
  mediaType: MediaType
  swatch: number
}

export interface TimelineState {
  tracks: TimelineTrack[]
  clips: TimelineClip[]
}

export interface Session {
  id: string
  name: string
  createdAt: string
  nodes: CanvasNodeState[]
  timeline: TimelineState
  /** Legacy pre-multitrack shape; migrated into `timeline` on load. */
  cutRoom?: CutClip[]
  scripting?: ScriptingState
  view: StudioView
}

export interface PersistedState {
  sessions: Session[]
  activeSessionId: string | null
  theme?: ThemeId
  /** Panel sizes are a workspace preference like theme, not session content —
   *  global, restored across restarts (docs/ui/layout-and-panels.md). */
  railWidth?: number
  asideWidth?: number
  timelineHeight?: number
  /** Timeline track-row height (vertical zoom) — same workspace-pref class. */
  timelineTrackHeight?: number
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
/** 'oauth' = the MCP server authorizes via an OAuth browser flow (http only);
 *  tokens are stored in the vault, never typed by anyone. */
export type ConnectorAuthType = 'none' | 'apiKey' | 'bearer' | 'oauth'

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

/** A track as the export sees it. NOTE: no `soloed` here, on purpose — solo is
 *  a preview-only monitoring state and must never affect export (timeline.md).
 *  Keeping it out of the payload type makes that rule structural. */
export interface ExportTrack {
  type: TrackType
  muted: boolean
  order: number
}

/** One resolved clip handed to the ffmpeg export. */
export interface ExportClip {
  /** lyme-asset:// URL of the source media. */
  src: string
  mediaType: MediaType
  /** Index into TimelineExportSpec.tracks. */
  trackIndex: number
  startTime: number
  trimIn: number
  trimOut: number
  /** Video clip's own embedded audio silenced (Play view's audio delete). */
  audioMuted?: boolean
}

export interface TimelineExportSpec {
  tracks: ExportTrack[]
  clips: ExportClip[]
}

export interface CutExportResult {
  ok: boolean
  outPath?: string
  /** Set when the user cancels the save dialog — not an error. */
  canceled?: boolean
  /** ffmpeg not found on this machine (not bundled/configured yet). */
  ffmpegMissing?: boolean
  error?: string
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

export interface ChatRealtyCoverResult {
  ok: boolean
  /** lyme-asset:// URL of the downloaded cover image, when ok. */
  src?: string
  error?: string
}

/** `plan_listing_carousel`'s material — real facts/CMA stats for a listing,
 *  handed to the Scripting panel as context instead of an agent guessing
 *  numbers. Raw JSON text, not parsed: the agent reads it directly. */
export interface ChatRealtyListingContextResult {
  ok: boolean
  text?: string
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
