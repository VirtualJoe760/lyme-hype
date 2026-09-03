/**
 * The studio store's public surface.
 *
 * Kept beside the implementation rather than inside it: the interface alone is
 * ~280 lines, and reading "what can the store do" should not mean scrolling
 * past every action body.
 */

import type { Node, NodeChange } from '@xyflow/react'
import type {
  ChatRealtyArticleDraftInput,
  ComfyState,
  ChatRealtyCarouselSlideInput,
  ChatRealtyLandingPageDraftInput,
  CutExportResult,
  MediaNodeData,
  MediaType,
  NodeStage,
  Session,
  SourceMethod,
  StudioView,
  ThemeId,
  TimelineClip,
  TrackType
} from '@shared/types'


export type SettingsTab = 'connectors' | 'models' | 'styles' | 'appearance'

export type MediaFlowNode = Node<MediaNodeData, 'media'>

let idCounter = 0
export function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

/** One line in the startup console. Steps describe work that actually happened —
 *  no synthetic progress; a fast machine simply flashes through them. */
export interface BootStep {
  label: string
  detail: string
}

interface AgentUiState {
  status: 'idle' | 'running' | 'ok' | 'error'
  transcript: string
  lastCostUsd: number | null
  totalCostUsd: number
  lastDurationMs: number | null
}

interface CombineTarget {
  sourceId: string
  targetId: string
}

export interface StudioStore {
  loaded: boolean
  sessions: Session[]
  activeSessionId: string | null
  /** Live React Flow nodes for the active session (single source of truth while active). */
  nodes: MediaFlowNode[]
  railCollapsed: boolean
  asideCollapsed: boolean
  timelineCollapsed: boolean
  railWidth: number
  asideWidth: number
  timelineHeight: number
  timelineTrackHeight: number
  setTimelineTrackHeight(px: number): void
  settingsOpen: boolean
  settingsTab: SettingsTab
  theme: ThemeId
  /** Play view: the node under review (full-takeover) and where to return to. */
  playNodeId: string | null
  playFrom: StudioView
  combine: CombineTarget | null
  agent: AgentUiState

  init(): Promise<void>
  createSession(): void
  /** Merge sessions read from a store/backup file into the rail (colliding ids
   *  are re-minted, nothing existing is touched). Returns how many landed. */
  importSessions(raw: unknown[]): number
  /** Commit every staged ready take to the canvas — the close guard's
   *  "Add to canvas & close" path. Returns how many landed. */
  /** Open a project folder's session into the rail (and make it active). */
  openProject(dir: string): Promise<string | null>
  /** Startup console lines — real steps, reported as they finish. */
  bootSteps: BootStep[]
  /** The local ComfyUI engine, as narrated by main. */
  comfy: ComfyState | null
  /** True once boot has finished AND the splash's minimum beat has elapsed. */
  booted: boolean
  commitAllStages(): number
  /** Save a session to the workspace as a project folder and take it out of the
   *  rail — the reopenable counterpart to delete. Resolves to an error string,
   *  or null on success. */
  closeSession(id: string): Promise<string | null>
  selectSession(id: string): void
  renameSession(id: string, name: string): void
  deleteSession(id: string): void
  setView(view: StudioView): void

  onNodesChange(changes: NodeChange<MediaFlowNode>[]): void
  addNode(input: {
    label: string
    mediaType: MediaType
    source: SourceMethod
    motionGfx?: boolean
    filePath?: string
    sourceUrl?: string
    src?: string
    detailUrl?: string
    listingKey?: string
    position?: { x: number; y: number }
    startRendering?: boolean
  }): void
  /** Delete = move to the session's trash. Every delete path (toolbar ✕, Delete
   *  key, drop on the can) lands here; nothing on the canvas is ever gone in one
   *  step. */
  removeNode(id: string): void
  trashNodes(ids: string[]): void
  restoreFromTrash(nodeId: string): void
  /** Ctrl+Z on the canvas. Returns false when there was nothing to restore. */
  restoreLastTrashed(): boolean
  emptyTrash(): void

  /** Timeline (multitrack Cut Room). */
  selectedTrackId: string | null
  sendToTimeline(nodeId: string): Promise<void>
  addClipToTimelineAt(nodeId: string, trackId: string, startTime: number): Promise<void>
  moveTimelineClip(clipId: string, trackId: string, startTime: number): void
  commitClipPosition(clipId: string): void
  retrimTimelineClip(clipId: string, trimIn: number, trimOut: number): void
  commitClipTrim(clipId: string): void
  splitTimelineClip(clipId: string, atTime: number): void
  removeTimelineClip(clipId: string): void
  patchTimelineClip(clipId: string, patch: Partial<TimelineClip>): void
  /** Returns the new track's id so a drop can target it immediately. */
  addTrack(type: TrackType): string | null
  removeTrack(trackId: string): void
  toggleTrackFlag(trackId: string, flag: 'muted' | 'soloed' | 'locked'): void
  selectTrack(trackId: string): void
  exportTimeline(): Promise<CutExportResult | null>

  openCombine(sourceId: string, targetId: string): void
  closeCombine(): void
  confirmCombine(note?: string): void

  openPlay(nodeId: string): void
  closePlay(): void
  setTrim(nodeId: string, trimIn: number, trimOut: number): void
  splitAtPlayhead(nodeId: string, at: number): void
  detachAudio(nodeId: string): void
  deleteAudio(nodeId: string): void

  addPanel(input?: { mediaType?: MediaType; label?: string; shotDescription?: string }): void
  updatePanel(nodeId: string, patch: Partial<MediaNodeData>): void
  movePanel(nodeId: string, dir: -1 | 1): void
  promotePanel(nodeId: string): void

  generateMedia(input: {
    label: string
    mediaType: MediaType
    prompt: string
    motionGfx?: boolean
    aspectRatio?: string
    durationSec?: number
    resolution?: string
    position?: { x: number; y: number }
    nodeId?: string
    /** Restrict to one connector (tier routing); omit = agent picks freely. */
    connectorId?: string
    /** Restrict to a specific set of connectors (e.g. Deepfake's muapi+yapper
     *  upload-then-lipsync chain) — takes precedence over connectorId. */
    connectorIds?: string[]
    modelHint?: string
    referenceImagePaths?: string[]
    startFramePath?: string
    endFramePath?: string
    referenceAudioPaths?: string[]
    sourceMediaPath?: string
    /** Extends an existing video by ~7s via Veo (docs/ui/node-enrichment-
     *  strategy.md Recommendations #3) instead of generating fresh. */
    extendVideoPath?: string
    extendVideoDurationSec?: number
    /** Returns the node id IMMEDIATELY (generation continues async) so Create
     *  screens can track the node's rendering → ready/error lifecycle. */
  }): string

  /** The canvas editor takeover (docs/build-plan.md Phase 19) — same shape as Play
   *  view: while set, the middle pane hosts the artifact at working size and the
   *  Sessions rail hides. A 300px panel is the wrong place to brush a mask. */
  editor: { manifestId: string; mode: 'mask' | 'expand' | 'crop'; mask?: string } | null
  openEditor(manifestId: string, mode: 'mask' | 'expand' | 'crop'): void
  closeEditor(): void
  /** Data-URL PNG of the brushed mask, handed to the generation call. */
  setEditorMask(mask: string | undefined): void

  /** Staged, uncommitted work per creative node (docs/build-plan.md Phase 16).
   *  Generating fills the node's preview; only commitStage reaches the canvas. */
  nodeStage(manifestId: string): NodeStage
  setNodeTool(manifestId: string, toolId: string): void
  setNodeModel(manifestId: string, modelId: string | undefined): void
  selectTake(manifestId: string, index: number): void
  clearStage(manifestId: string): void
  stageGenerate(
    manifestId: string,
    input: {
      label: string
      mediaType: MediaType
      prompt: string
      takes?: number
      /** "Generate as typed" — skip the automatic prompt refinement. */
      skipRefine?: boolean
      modelId?: string
      aspectRatio?: string
      durationSec?: number
      resolution?: string
      connectorId?: string
      connectorIds?: string[]
      modelHint?: string
      model?: string
      imageSize?: string
      thinkingLevel?: string
      personGeneration?: string
      steps?: number
      refStrength?: number
      characterReferencePaths?: string[]
      styleReferencePaths?: string[]
      referenceImagePaths?: string[]
      startFramePath?: string
      endFramePath?: string
      referenceAudioPaths?: string[]
      sourceMediaPath?: string
      maskDataUrl?: string
      extendVideoPath?: string
      extendVideoDurationSec?: number
    }
  ): void

  /** Commit the active take and open the target node with it already filled into the
   *  role the handoff names — a pill that says "as its start frame" has to actually
   *  set the start frame. */
  applyHandoff(fromManifestId: string, to: string, role: string): void
  /** Set by applyHandoff; AsidePanel navigates to it and clears it. */
  pendingNodeScreen: string | null
  clearPendingNodeScreen(): void
  /** Canvas-node action menu → open a node screen with this node's media loaded.
   *  role 'refs' seeds the reference list; role 'take' stages the media as a ready
   *  take (the subject the edit tools act on) and optionally picks the tool; any
   *  other role lands in nodeInputs exactly like a handoff. */
  openNodeScreenWith(
    manifestId: string,
    input: { src: string; label: string; mediaType: MediaType; role: string; toolId?: string }
  ): void
  /** Reference seeded by openNodeScreenWith('…', {role:'refs'}); NodePanel consumes it. */
  pendingRefs: { manifestId: string; src: string } | null
  clearPendingRefs(): void
  /** Inputs carried into a node by a handoff, keyed by manifest id then role. */
  nodeInputs: Record<string, Record<string, string>>
  setNodeInput(manifestId: string, role: string, src: string | undefined): void

  /** Training images for nodes whose preview holds inputs rather than output. */
  nodeDataset: Record<string, string[]>
  toggleDatasetImage(manifestId: string, src: string): void
  clearDataset(manifestId: string): void

  /** Audio's four jobs are direct connector calls with no agent turn — they land in the
   *  same staged-take lane so the preview, paging and Finish work identically. */
  stageAudio(
    manifestId: string,
    op: 'tts' | 'music' | 'sfx' | 'clone',
    input: { text: string; voiceName?: string; voiceId?: string; useYapper?: boolean }
  ): void
  /** Trains a LoRA and saves it as a reusable person/style. Returns its id. */
  trainLora(input: {
    name: string
    imagePaths: string[]
    steps: number
    kind: 'style' | 'subject'
    trainer?: string
  }): Promise<{ ok: boolean; error?: string }>
  /** Active take → a real canvas node. Returns its id, or null when there is
   *  nothing ready to commit. */
  commitStage(manifestId: string): string | null

  /** Canvas pans to this node (CanvasArea consumes and clears it). */
  focusNodeId: string | null
  focusNode(nodeId: string): void
  clearFocusNode(): void

  /** Scripting panel (docs/ui/scripting-panel.md). */
  scriptingBusy: boolean
  /** Keyed to its session so a mid-turn session switch never renders one
   *  conversation's live reply inside another's chat. */
  scriptingStream: { sessionId: string; text: string } | null
  improvingPanelId: string | null
  improveError: { nodeId: string; message: string } | null
  sendScriptingMessage(text: string): Promise<void>
  /** `stillActive` tells the caller whether the originating session is still
   *  the active one — the view flip only happens when it is. */
  runShotBreakdown(): Promise<{ ok: boolean; count: number; stillActive?: boolean; error?: string }>
  improvePanelPrompt(nodeId: string): Promise<void>

  /** Set when a Storyboard panel is sent to the Deepfake tile — the Create
   *  panel's aside picks this up to prefill the script and suggest a
   *  Reference person by tone (docs/ui/node-enrichment-strategy.md, row 8).
   *  Cleared once the Deepfake screen has consumed it. */
  deepfakeHandoff: { script: string; toneHint: string } | null
  sendPanelToDeepfake(nodeId: string): void
  clearDeepfakeHandoff(): void

  toggleRail(): void
  toggleAside(): void
  toggleTimeline(): void
  setPanelSize(panel: 'rail' | 'aside' | 'timeline', px: number): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
  setSettingsTab(tab: SettingsTab): void
  setTheme(theme: ThemeId): void

  pingAgent(): Promise<void>
  pullChatRealtyPhotos(query: string): Promise<{
    ok: boolean
    count: number
    error?: string
    topListing?: { listingKey: string; address: string; city: string; detailUrl: string | null }
    photos: { src: string; label: string; photoIndex: number }[]
  }>
  createChatRealtyCover(
    listingKey: string,
    opts: { hook: string; body: string; city?: string; label: string; detailUrl?: string }
  ): Promise<{ ok: boolean; error?: string }>
  createChatRealtyCarouselSlide(
    input: ChatRealtyCarouselSlideInput,
    opts: { label: string; listingKey?: string; detailUrl?: string }
  ): Promise<{ ok: boolean; error?: string }>
  stageChatRealtyListing(
    listingKey: string,
    photoIndexes: number[],
    opts: { labelBase: string; detailUrl?: string }
  ): Promise<{ ok: boolean; count: number; error?: string }>
  createChatRealtyArticleDraft(
    input: ChatRealtyArticleDraftInput
  ): Promise<{ ok: boolean; slug?: string; error?: string }>
  createChatRealtyLandingPageDraft(
    input: ChatRealtyLandingPageDraftInput
  ): Promise<{ ok: boolean; editUrl?: string; previewUrl?: string; error?: string }>
  flushPersist(): void
}
