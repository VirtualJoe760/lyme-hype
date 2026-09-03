/** The canvas, its nodes, and what a Session/Project persists. */

import type { ScriptingState } from './scripting'
import type { MediaType, NodeStatus, SourceMethod } from './media'
import type { TimelineState, CutClip } from './timeline'
import type { ThemeId } from './providers'

export type StudioView = 'canvas' | 'storyboard' | 'scripting'

export interface MediaNodeData {
  label: string
  mediaType: MediaType
  source: SourceMethod
  status: NodeStatus
  /** Placeholder-thumbnail swatch index (1-6) for stub nodes without real media. */
  swatch: number
  /** Real image source (lyme-asset:// URL), e.g. a ChatRealty listing photo. */
  src?: string
  /** Downscaled companion rendered in the node thumbnail; falls back to `src`. */
  thumbSrc?: string
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
  /** This image IS a character's approved reference (Generate Character). A
   *  Generate image run that takes it as a reference treats it as a character
   *  ref, not an object ref. */
  characterId?: string
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
  /** Real measured length of a video node (probed client-side after generation
   *  or extension, docs/ui/node-enrichment-strategy.md Recommendations #3) —
   *  what Veo's 148s chained-extension cap actually needs, since the requested
   *  duration and the delivered one aren't guaranteed to match. */
  videoDurationSec?: number
  [key: string]: unknown
}

export interface CanvasNodeState {
  id: string
  /** 'group' = a named frame whose children carry parentId (moves them in unison). Absent = media. */
  type?: 'media' | 'group'
  /** The group this node sits in; position is then relative to the group. */
  parentId?: string
  position: { x: number; y: number }
  data: MediaNodeData
  /** User-resized node width (drag handle on the canvas). Height is never stored
   *  for media — it follows the aspect ratio — but a group frame keeps both. */
  width?: number
  height?: number
}

/**
 * One generated result held in a creative node's preview, before it is committed.
 * Generating is cheap and reversible; putting something on the canvas is the deliberate
 * act — so takes live here until Finish, and page in place inside the preview.
 */
export interface StagedTake {
  id: string
  mediaType: MediaType
  status: NodeStatus
  label: string
  prompt: string
  src?: string
  /** Downscaled companion, carried onto the node when the take is committed. */
  thumbSrc?: string
  error?: string
  /** The canvas node this take was placed on. Generations land on the canvas as
   *  soon as they finish, so this is set on completion; it also makes committing
   *  idempotent (no second copy of a take that is already there). */
  nodeId?: string
  /** Catalog model id that produced it, for provenance in the preview. */
  modelId?: string
  createdAt: number
}

export interface NodeStage {
  takes: StagedTake[]
  activeIndex: number
  /** Which manifest tool is lit — decides the capability, and therefore the model row. */
  toolId: string
  /** Catalog model id the user picked for the active tool. */
  modelId?: string
}

/** A canvas node that was deleted but can come back. The asset itself is never
 *  deleted with the node — trash forgets the node, not the file. */
export interface TrashedNode {
  node: CanvasNodeState
  deletedAt: string
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
  /** Uncommitted work per creative node, keyed by manifest id. Survives navigating
   *  away from a node and dies with the session (build-plan Phase 14). */
  stages?: Record<string, NodeStage>
  /** The project folder this session was saved to / opened from, so closing it
   *  again updates that project instead of cloning a new folder. */
  projectDir?: string
  /** Canvas media linked into a node's role (start frame, source, face), keyed by
   *  manifest id then role. Per-session, not per-workspace: a frame linked in one
   *  project has no business appearing in another. */
  nodeInputs?: Record<string, Record<string, string>>
  /** Training images assembled for a dataset-preview node, keyed by manifest id. */
  nodeDataset?: Record<string, string[]>
  /** Recently deleted nodes, newest first, capped — restorable until emptied. */
  trash?: TrashedNode[]
  view: StudioView
}

/** A project folder on disk, as listed for the Open/Recent UI (build-plan Phase 23). */
export interface ProjectSummary {
  dir: string
  name: string
  folder: string
  savedAt: string
  nodeCount: number
  assetCount: number
  assetBytes: number
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
