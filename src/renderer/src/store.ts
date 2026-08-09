import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import type {
  AgentStreamEvent,
  CanvasNodeState,
  ChatRealtyArticleDraftInput,
  ChatRealtyCarouselSlideInput,
  ChatRealtyLandingPageDraftInput,
  CombineLocalKind,
  CutExportResult,
  ExportClip,
  MediaNodeData,
  MediaType,
  NodeStage,
  PersistedState,
  Session,
  SourceMethod,
  StagedTake,
  StudioView,
  ThemeId,
  TimelineClip,
  TimelineState,
  TrackType
} from '@shared/types'
import { bridge } from './bridge'

export type SettingsTab = 'connectors' | 'models' | 'styles' | 'appearance'

export type MediaFlowNode = Node<MediaNodeData, 'media'>

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

function toFlowNode(state: CanvasNodeState): MediaFlowNode {
  return { id: state.id, type: 'media', position: state.position, data: state.data }
}

function toNodeState(node: MediaFlowNode): CanvasNodeState {
  return { id: node.id, position: node.position, data: node.data }
}

function pickSwatch(): number {
  return 1 + Math.floor(Math.random() * 6)
}

/** Combine dialog's four ffmpeg-only pairs (video+video, image+video,
 *  audio+video, audio+audio) — deterministic filter graphs, no agent
 *  judgment needed, unlike image+image/audio+image which route through
 *  generateMedia instead. Returns null for the two generative pairs (handled
 *  earlier in confirmCombine) or if either node has no src yet. */
function localCombineFor(
  source: MediaFlowNode,
  target: MediaFlowNode
): { kind: CombineLocalKind; aUrl: string; bUrl: string } | null {
  if (!source.data.src || !target.data.src) return null
  const pair = [source.data.mediaType, target.data.mediaType].sort().join('+')
  switch (pair) {
    case 'video+video':
      return { kind: 'stitch-video', aUrl: source.data.src, bUrl: target.data.src }
    case 'image+video': {
      const video = source.data.mediaType === 'video' ? source : target
      const image = source.data.mediaType === 'image' ? source : target
      return { kind: 'overlay-image', aUrl: video.data.src!, bUrl: image.data.src! }
    }
    case 'audio+video': {
      const video = source.data.mediaType === 'video' ? source : target
      const audio = source.data.mediaType === 'audio' ? source : target
      return { kind: 'score-video', aUrl: video.data.src!, bUrl: audio.data.src! }
    }
    case 'audio+audio':
      return { kind: 'mix-audio', aUrl: source.data.src, bUrl: target.data.src }
    default:
      return null
  }
}

/** Stub-generation latency so the Rendering… state is visible (real jobs land in Phase 4). */
const STUB_RENDER_MS = 2500

/** Placed length for clips whose source duration isn't known yet (images, or
 *  legacy-migrated clips before their lazy metadata probe lands). */
const DEFAULT_CLIP_SEC = 5

/** The default starting layout (docs/ui/timeline.md): a narrated reel with a
 *  music bed and an occasional overlay, without an empty timeline being
 *  intimidating. Tracks stay dynamic beyond this. */
function defaultTimeline(): TimelineState {
  return {
    tracks: [
      { id: nextId('track'), type: 'video', name: 'Video 1', muted: false, soloed: false, locked: false, order: 0 },
      { id: nextId('track'), type: 'video', name: 'Video 2', muted: false, soloed: false, locked: false, order: 1 },
      { id: nextId('track'), type: 'audio', name: 'Audio 1', muted: false, soloed: false, locked: false, order: 0 },
      { id: nextId('track'), type: 'audio', name: 'Audio 2', muted: false, soloed: false, locked: false, order: 1 }
    ],
    clips: []
  }
}

/** Reads a media file's duration off a detached element — the timeline needs
 *  concrete trim bounds, and nodes don't store duration. Resolves 0 on failure
 *  (caller falls back to DEFAULT_CLIP_SEC). */
export function probeDuration(src: string, mediaType: MediaType): Promise<number> {
  if (mediaType === 'image') return Promise.resolve(0)
  return new Promise((resolve) => {
    const el = document.createElement(mediaType === 'video' ? 'video' : 'audio')
    const done = (value: number): void => {
      el.removeAttribute('src')
      resolve(value)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => done(0)
    el.src = src
  })
}

function clipDuration(clip: TimelineClip): number {
  return Math.max(0.05, clip.trimOut - clip.trimIn)
}

/**
 * Ripple overlap resolution for one track (docs/ui/timeline.md: ripple, not
 * overwrite): clips sorted by start; any clip overlapping the one before it
 * shifts right to its end. Gaps are untouched — position stays free.
 */
function rippleTrack(clips: TimelineClip[], trackId: string): TimelineClip[] {
  const onTrack = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startTime - b.startTime)
  const shifted = new Map<string, number>()
  let prevEnd = -Infinity
  for (const clip of onTrack) {
    const start = Math.max(clip.startTime, prevEnd === -Infinity ? clip.startTime : prevEnd)
    if (start !== clip.startTime) shifted.set(clip.id, start)
    prevEnd = start + clipDuration(clip)
  }
  if (shifted.size === 0) return clips
  return clips.map((c) => (shifted.has(c.id) ? { ...c, startTime: shifted.get(c.id)! } : c))
}

/** End-of-content on one track — where an appended clip lands. */
function trackEnd(clips: TimelineClip[], trackId: string): number {
  return clips
    .filter((c) => c.trackId === trackId)
    .reduce((max, c) => Math.max(max, c.startTime + clipDuration(c)), 0)
}

/** Migrates a legacy single-track cutRoom array into the multitrack shape:
 *  video clips laid back-to-back on Video 1, audio on Audio 1. Durations are
 *  provisional until the lazy metadata probe patches them. */
function migrateSession(session: Session): Session {
  if (session.timeline && session.timeline.tracks.length > 0) return session
  const timeline = defaultTimeline()
  const videoTrack = timeline.tracks.find((t) => t.type === 'video')!
  const audioTrack = timeline.tracks.find((t) => t.type === 'audio')!
  for (const legacy of session.cutRoom ?? []) {
    const node = session.nodes.find((n) => n.id === legacy.nodeId)
    const trimIn = node?.data.trimIn ?? 0
    const trimOut = node?.data.trimOut ?? 0
    const track = legacy.mediaType === 'audio' ? audioTrack : videoTrack
    const duration = trimOut > trimIn ? trimOut - trimIn : DEFAULT_CLIP_SEC
    timeline.clips.push({
      id: legacy.id,
      nodeId: legacy.nodeId,
      trackId: track.id,
      startTime: trackEnd(timeline.clips, track.id),
      trimIn,
      trimOut: trimIn + duration,
      sourceDuration: 0,
      label: legacy.label,
      mediaType: legacy.mediaType,
      swatch: legacy.swatch
    })
  }
  const { cutRoom: _legacy, ...rest } = session
  return { ...rest, timeline }
}

/** Panel size defaults + clamps (docs/ui/layout-and-panels.md). Timeline max is
 *  a viewport fraction, so it's resolved at drag time, not stored here. */
export const PANEL_SIZES = {
  rail: { default: 224, min: 160, max: 400 },
  aside: { default: 304, min: 220, max: 480 },
  timeline: { default: 132, min: 80, maxViewportFraction: 0.45 }
} as const

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

interface StudioStore {
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
  removeNode(id: string): void

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
      modelId?: string
      aspectRatio?: string
      durationSec?: number
      resolution?: string
      connectorId?: string
      connectorIds?: string[]
      modelHint?: string
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
  /** Inputs carried into a node by a handoff, keyed by manifest id then role. */
  nodeInputs: Record<string, Record<string, string>>
  setNodeInput(manifestId: string, role: string, src: string | undefined): void
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

function newSession(index: number): Session {
  return {
    id: nextId('session'),
    name: `R-${String(index).padStart(3, '0')} · Untitled`,
    createdAt: new Date().toISOString(),
    nodes: [],
    timeline: defaultTimeline(),
    view: 'canvas'
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useStudio = create<StudioStore>((set, get) => {
  function activeSession(): Session | null {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.id === activeSessionId) ?? null
  }

  /** Serializes the live canvas back into the sessions array. */
  function syncedSessions(): Session[] {
    const { sessions, activeSessionId, nodes } = get()
    return sessions.map((session) =>
      session.id === activeSessionId
        ? { ...session, nodes: nodes.map(toNodeState) }
        : session
    )
  }

  function persistedSnapshot(): PersistedState {
    const { activeSessionId, theme, railWidth, asideWidth, timelineHeight, timelineTrackHeight } = get()
    return {
      sessions: syncedSessions(),
      activeSessionId,
      theme,
      railWidth,
      asideWidth,
      timelineHeight,
      timelineTrackHeight
    }
  }

  function persist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      void bridge.sessions.save(persistedSnapshot())
    }, 500)
  }

  function updateSession(id: string, patch: Partial<Session>): void {
    set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
    persist()
  }

  function patchNodeData(nodeId: string, patch: Partial<MediaNodeData>): void {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node
      )
    })
    persist()
  }

  /**
   * Patches a node whether it's in the live active session or has since been
   * switched away into the serialized sessions array — the latter is why an
   * async job (stub timer, real generation) that outlives a session switch
   * doesn't leave a node stuck "Rendering…". A since-deleted node is a no-op.
   */
  function patchNodeAnywhere(nodeId: string, patch: Partial<MediaNodeData>): void {
    if (get().nodes.some((n) => n.id === nodeId)) {
      patchNodeData(nodeId, patch)
      return
    }
    const sessions = get().sessions.map((session) => {
      if (!session.nodes.some((n) => n.id === nodeId)) return session
      return {
        ...session,
        nodes: session.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )
      }
    })
    set({ sessions })
    persist()
  }

  function scheduleStubReady(nodeId: string): void {
    setTimeout(() => patchNodeAnywhere(nodeId, { status: 'ready' }), STUB_RENDER_MS)
  }

  const EMPTY_STAGE: NodeStage = { takes: [], activeIndex: 0, toolId: 'generate' }

  function readStage(manifestId: string): NodeStage {
    const session = get().sessions.find((s) => s.id === get().activeSessionId)
    return session?.stages?.[manifestId] ?? EMPTY_STAGE
  }

  function writeStage(manifestId: string, update: (stage: NodeStage) => NodeStage): void {
    const activeId = get().activeSessionId
    if (!activeId) return
    set({
      sessions: get().sessions.map((session) =>
        session.id === activeId
          ? {
              ...session,
              stages: {
                ...(session.stages ?? {}),
                [manifestId]: update(session.stages?.[manifestId] ?? EMPTY_STAGE)
              }
            }
          : session
      )
    })
    persist()
  }

  /** A take can resolve after the user has navigated away or switched sessions, so
   *  patch by id across every session rather than assuming the active one. */
  function patchTake(manifestId: string, takeId: string, patch: Partial<StagedTake>): void {
    set({
      sessions: get().sessions.map((session) => {
        const stage = session.stages?.[manifestId]
        if (!stage?.takes.some((t) => t.id === takeId)) return session
        return {
          ...session,
          stages: {
            ...(session.stages ?? {}),
            [manifestId]: {
              ...stage,
              takes: stage.takes.map((t) => (t.id === takeId ? { ...t, ...patch } : t))
            }
          }
        }
      })
    })
    persist()
  }

  return {
    loaded: false,
    sessions: [],
    activeSessionId: null,
    nodes: [],
    railCollapsed: false,
    asideCollapsed: false,
    timelineCollapsed: false,
    railWidth: PANEL_SIZES.rail.default,
    asideWidth: PANEL_SIZES.aside.default,
    timelineHeight: PANEL_SIZES.timeline.default,
    timelineTrackHeight: 46,
    settingsOpen: false,
    settingsTab: 'connectors',
    theme: 'lime-cut',
    playNodeId: null,
    editor: null,
    pendingNodeScreen: null,
    nodeInputs: {},
    playFrom: 'canvas',
    combine: null,
    agent: {
      status: 'idle',
      transcript: '',
      lastCostUsd: null,
      totalCostUsd: 0,
      lastDurationMs: null
    },

    async init() {
      const persisted = await bridge.sessions.load()
      let sessions = persisted?.sessions ?? []
      // Any node persisted mid-"render" would otherwise pulse forever — the stub
      // timer died with the previous process. Legacy single-track cutRoom
      // arrays migrate to the multitrack timeline here too.
      sessions = sessions.map((session) =>
        migrateSession({
          ...session,
          nodes: session.nodes.map((node) =>
            node.data.status === 'rendering'
              ? { ...node, data: { ...node.data, status: 'ready' as const } }
              : node
          )
        })
      )
      if (sessions.length === 0) sessions = [newSession(1)]
      const activeSessionId =
        persisted?.activeSessionId && sessions.some((s) => s.id === persisted.activeSessionId)
          ? persisted.activeSessionId
          : sessions[0].id
      const active = sessions.find((s) => s.id === activeSessionId)!
      const theme: ThemeId = persisted?.theme ?? 'lime-cut'
      document.documentElement.dataset.theme = theme
      set({
        loaded: true,
        sessions,
        activeSessionId,
        nodes: active.nodes.map(toFlowNode),
        theme,
        railWidth: persisted?.railWidth ?? PANEL_SIZES.rail.default,
        asideWidth: persisted?.asideWidth ?? PANEL_SIZES.aside.default,
        timelineHeight: persisted?.timelineHeight ?? PANEL_SIZES.timeline.default,
        timelineTrackHeight: persisted?.timelineTrackHeight ?? 46
      })
    },

    createSession() {
      const sessions = syncedSessions()
      const session = newSession(sessions.length + 1)
      set({
        sessions: [session, ...sessions],
        activeSessionId: session.id,
        nodes: [],
        combine: null
      })
      persist()
    },

    selectSession(id) {
      if (id === get().activeSessionId) return
      const sessions = syncedSessions()
      const next = sessions.find((s) => s.id === id)
      if (!next) return
      set({
        sessions,
        activeSessionId: id,
        nodes: next.nodes.map(toFlowNode),
        combine: null
      })
      persist()
    },

    renameSession(id, name) {
      const trimmed = name.trim()
      if (!trimmed) return
      updateSession(id, { name: trimmed })
    },

    deleteSession(id) {
      const remaining = syncedSessions().filter((s) => s.id !== id)
      const sessions = remaining.length > 0 ? remaining : [newSession(1)]
      const { activeSessionId } = get()
      if (activeSessionId === id) {
        const nextActive = sessions[0]
        set({
          sessions,
          activeSessionId: nextActive.id,
          nodes: nextActive.nodes.map(toFlowNode),
          combine: null
        })
      } else {
        set({ sessions })
      }
      persist()
    },

    setView(view) {
      const session = activeSession()
      if (session) updateSession(session.id, { view })
    },

    onNodesChange(changes) {
      set({ nodes: applyNodeChanges(changes, get().nodes) })
      // Keyboard deletes arrive here (not through removeNode) — evict the
      // removed nodes' clips from the timeline too.
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removedIds.length > 0) {
        const session = activeSession()
        if (session && session.timeline.clips.some((clip) => removedIds.includes(clip.nodeId))) {
          updateSession(session.id, {
            timeline: {
              ...session.timeline,
              clips: session.timeline.clips.filter((clip) => !removedIds.includes(clip.nodeId))
            }
          })
        }
      }
      const structural = changes.some((c) => c.type === 'position' || c.type === 'remove')
      if (structural) persist()
    },

    addNode(input) {
      const position = input.position ?? {
        x: 80 + Math.random() * 300,
        y: 80 + Math.random() * 220
      }
      const rendering = input.startRendering ?? input.source === 'generate'
      const node: MediaFlowNode = {
        id: nextId('node'),
        type: 'media',
        position,
        data: {
          label: input.label,
          mediaType: input.mediaType,
          source: input.source,
          status: rendering ? 'rendering' : 'ready',
          swatch: pickSwatch(),
          src: input.src,
          motionGfx: input.motionGfx,
          filePath: input.filePath,
          sourceUrl: input.sourceUrl,
          detailUrl: input.detailUrl,
          listingKey: input.listingKey
        }
      }
      set({ nodes: [...get().nodes, node] })
      persist()
      if (rendering) scheduleStubReady(node.id)
    },

    removeNode(id) {
      set({ nodes: get().nodes.filter((n) => n.id !== id) })
      const session = activeSession()
      if (session) {
        updateSession(session.id, {
          timeline: {
            ...session.timeline,
            clips: session.timeline.clips.filter((clip) => clip.nodeId !== id)
          }
        })
      }
      persist()
    },

    selectedTrackId: null,

    async sendToTimeline(nodeId) {
      // Append at end-of-content on the first (lowest-order) matching-type
      // track — today's familiar behavior; placing at a specific time is the
      // drag-onto-a-track path (addClipToTimelineAt).
      const session = activeSession()
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!session || !node) return
      if (node.data.mediaType === 'image') return
      if (node.data.status !== 'ready') return
      const trackType: TrackType = node.data.mediaType === 'audio' ? 'audio' : 'video'
      const track = session.timeline.tracks
        .filter((t) => t.type === trackType && !t.locked)
        .sort((a, b) => a.order - b.order)[0]
      if (!track) return
      await get().addClipToTimelineAt(nodeId, track.id, trackEnd(session.timeline.clips, track.id))
    },

    async addClipToTimelineAt(nodeId, trackId, startTime) {
      const node = get().nodes.find((n) => n.id === nodeId)
      const session = activeSession()
      if (!node || !session) return
      if (node.data.status !== 'ready') return
      const track = session.timeline.tracks.find((t) => t.id === trackId)
      if (!track || track.locked) return
      // No silent type conversion: audio ↔ audio tracks, video/image ↔ video.
      const clipTrackType: TrackType = node.data.mediaType === 'audio' ? 'audio' : 'video'
      if (track.type !== clipTrackType) return

      const sourceDuration =
        node.data.src && node.data.mediaType !== 'image'
          ? await probeDuration(node.data.src, node.data.mediaType)
          : 0
      // Seed the clip's trim from the node's Play-view trim (what you saw in
      // Play is what lands) — independently editable after that.
      const trimIn = node.data.trimIn ?? 0
      const trimOut =
        node.data.trimOut ?? (sourceDuration > 0 ? sourceDuration : trimIn + DEFAULT_CLIP_SEC)

      // The active session may have changed while probing metadata — re-check.
      const current = activeSession()
      if (!current || current.id !== session.id) return
      const clip: TimelineClip = {
        id: nextId('clip'),
        nodeId,
        trackId,
        startTime: Math.max(0, startTime),
        trimIn,
        trimOut,
        sourceDuration,
        label: node.data.label,
        mediaType: node.data.mediaType,
        swatch: node.data.swatch
      }
      updateSession(current.id, {
        timeline: {
          ...current.timeline,
          clips: rippleTrack([...current.timeline.clips, clip], trackId)
        }
      })
      patchNodeData(nodeId, { sentToTimeline: true })
    },

    moveTimelineClip(clipId, trackId, startTime) {
      // Live position update during a drag — raw, no ripple; the drop commits
      // via commitClipPosition so mid-drag states don't cascade shifts.
      const session = activeSession()
      if (!session) return
      const clip = session.timeline.clips.find((c) => c.id === clipId)
      const track = session.timeline.tracks.find((t) => t.id === trackId)
      const fromTrack = session.timeline.tracks.find((t) => t.id === clip?.trackId)
      if (!clip || !track || fromTrack?.locked || track.locked) return
      if (track.type !== fromTrack?.type) return
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          clips: session.timeline.clips.map((c) =>
            c.id === clipId ? { ...c, trackId, startTime: Math.max(0, startTime) } : c
          )
        }
      })
    },

    commitClipPosition(clipId) {
      const session = activeSession()
      if (!session) return
      const clip = session.timeline.clips.find((c) => c.id === clipId)
      if (!clip) return
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          clips: rippleTrack(session.timeline.clips, clip.trackId)
        }
      })
    },

    retrimTimelineClip(clipId, trimIn, trimOut) {
      const session = activeSession()
      if (!session) return
      const clip = session.timeline.clips.find((c) => c.id === clipId)
      const track = session.timeline.tracks.find((t) => t.id === clip?.trackId)
      if (!clip || track?.locked) return
      const maxOut = clip.sourceDuration > 0 ? clip.sourceDuration : Number.POSITIVE_INFINITY
      const nextIn = Math.max(0, Math.min(trimIn, trimOut - 0.1))
      const nextOut = Math.min(maxOut, Math.max(trimOut, nextIn + 0.1))
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          clips: session.timeline.clips.map((c) =>
            c.id === clipId ? { ...c, trimIn: nextIn, trimOut: nextOut } : c
          )
        }
      })
    },

    commitClipTrim(clipId) {
      // Extending a clip's right edge into its neighbor ripples the later
      // clips right — same rule as repositioning.
      get().commitClipPosition(clipId)
    },

    splitTimelineClip(clipId, atTime) {
      const session = activeSession()
      if (!session) return
      const clip = session.timeline.clips.find((c) => c.id === clipId)
      const track = session.timeline.tracks.find((t) => t.id === clip?.trackId)
      if (!clip || track?.locked) return
      const offset = atTime - clip.startTime
      if (offset <= 0.05 || offset >= clipDuration(clip) - 0.05) return
      const cutPoint = clip.trimIn + offset
      const right: TimelineClip = {
        ...clip,
        id: nextId('clip'),
        startTime: atTime,
        trimIn: cutPoint,
        label: `${clip.label}_b`
      }
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          clips: session.timeline.clips
            .map((c) => (c.id === clipId ? { ...c, trimOut: cutPoint } : c))
            .concat(right)
        }
      })
    },

    removeTimelineClip(clipId) {
      const session = activeSession()
      if (!session) return
      const clip = session.timeline.clips.find((c) => c.id === clipId)
      if (!clip) return
      const remaining = session.timeline.clips.filter((c) => c.id !== clipId)
      updateSession(session.id, {
        timeline: { ...session.timeline, clips: remaining }
      })
      // Only clear the node badge when its last timeline instance is gone.
      if (
        !remaining.some((c) => c.nodeId === clip.nodeId) &&
        get().nodes.some((n) => n.id === clip.nodeId)
      ) {
        patchNodeData(clip.nodeId, { sentToTimeline: false })
      }
    },

    patchTimelineClip(clipId, patch) {
      const session = activeSession()
      if (!session) return
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          clips: session.timeline.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))
        }
      })
    },

    addTrack(type) {
      const session = activeSession()
      if (!session) return null
      const sameType = session.timeline.tracks.filter((t) => t.type === type)
      const order = sameType.reduce((max, t) => Math.max(max, t.order), -1) + 1
      const name = `${type === 'video' ? 'Video' : 'Audio'} ${sameType.length + 1}`
      const id = nextId('track')
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          tracks: [
            ...session.timeline.tracks,
            { id, type, name, muted: false, soloed: false, locked: false, order }
          ]
        }
      })
      return id
    },

    removeTrack(trackId) {
      // Removes the track's clips from the timeline, never their source nodes.
      const session = activeSession()
      if (!session) return
      const orphaned = session.timeline.clips.filter((c) => c.trackId === trackId)
      const remaining = session.timeline.clips.filter((c) => c.trackId !== trackId)
      updateSession(session.id, {
        timeline: {
          tracks: session.timeline.tracks.filter((t) => t.id !== trackId),
          clips: remaining
        }
      })
      for (const clip of orphaned) {
        if (
          !remaining.some((c) => c.nodeId === clip.nodeId) &&
          get().nodes.some((n) => n.id === clip.nodeId)
        ) {
          patchNodeData(clip.nodeId, { sentToTimeline: false })
        }
      }
      if (get().selectedTrackId === trackId) set({ selectedTrackId: null })
    },

    toggleTrackFlag(trackId, flag) {
      const session = activeSession()
      if (!session) return
      updateSession(session.id, {
        timeline: {
          ...session.timeline,
          tracks: session.timeline.tracks.map((t) =>
            t.id === trackId ? { ...t, [flag]: !t[flag] } : t
          )
        }
      })
    },

    selectTrack(trackId) {
      set({ selectedTrackId: trackId })
    },

    async exportTimeline() {
      const session = activeSession()
      if (!session) return null
      const orderedTracks = session.timeline.tracks.slice().sort((a, b) => a.order - b.order)
      // Solo is intentionally dropped here — TimelineExportSpec carries no solo
      // field, so export honors mute alone (docs/ui/timeline.md's rule).
      const tracks = orderedTracks.map((t) => ({ type: t.type, muted: t.muted, order: t.order }))
      const trackIndex = new Map(orderedTracks.map((t, i) => [t.id, i] as const))
      // Resolve each clip to its live node for the real media source and the
      // node-level audio mute set in Play view.
      const clips: ExportClip[] = []
      for (const clip of session.timeline.clips) {
        const node = get().nodes.find((n) => n.id === clip.nodeId)
        if (!node?.data.src) continue
        const index = trackIndex.get(clip.trackId)
        if (index === undefined) continue
        clips.push({
          src: node.data.src,
          mediaType: clip.mediaType,
          trackIndex: index,
          startTime: clip.startTime,
          trimIn: clip.trimIn,
          trimOut: clip.trimOut,
          audioMuted: node.data.audioMuted
        })
      }
      if (clips.length === 0) {
        return {
          ok: false,
          error: 'No exportable clips — the timeline needs clips whose nodes have real media.'
        }
      }
      return bridge.cutRoom.export({ tracks, clips })
    },

    openCombine(sourceId, targetId) {
      if (sourceId === targetId) return
      set({ combine: { sourceId, targetId } })
    },

    closeCombine() {
      set({ combine: null })
    },

    confirmCombine(note) {
      const { combine, nodes } = get()
      if (!combine) return
      const source = nodes.find((n) => n.id === combine.sourceId)
      const target = nodes.find((n) => n.id === combine.targetId)
      set({ combine: null })
      if (!source || !target) return

      const label = `combine_${source.data.label.slice(0, 8)}+${target.data.label.slice(0, 8)}`
      const position = {
        x: (source.position.x + target.position.x) / 2 + 40,
        y: (source.position.y + target.position.y) / 2 + 60
      }
      const pair = [source.data.mediaType, target.data.mediaType].sort().join('+')
      const trimmedNote = note?.trim()

      // image+image and audio+image are real generation chains — reference-
      // conditioning and lipsync/animate-with-audio respectively — reusing
      // the same GenerationParams fields Deepfake's Stage 2 and Motion
      // graphics' References stage already established, because "how should
      // these mix" needs the agent's judgment. Every other pair (video+video,
      // image+video, audio+video, audio+audio) is deterministic instead —
      // see localCombineFor — and composites via local ffmpeg, no agent turn.
      if (pair === 'image+image' && source.data.src && target.data.src) {
        get().generateMedia({
          label,
          mediaType: 'image',
          position,
          prompt:
            trimmedNote ||
            'Merge these two reference images into one new image, blending their content and style together.',
          referenceImagePaths: [source.data.src, target.data.src]
        })
        return
      }

      if (pair === 'audio+image') {
        const imageNode = source.data.mediaType === 'image' ? source : target
        const audioNode = source.data.mediaType === 'audio' ? source : target
        if (imageNode.data.src && audioNode.data.src) {
          get().generateMedia({
            label,
            mediaType: 'video',
            position,
            prompt: [
              trimmedNote ||
                'Animate this still image driven by the accompanying audio.',
              'If the image shows a face, lip-sync its mouth to the audio like a talking avatar. Otherwise animate the still to the mood and pacing of the audio and use the audio as its soundtrack.'
            ].join(' '),
            sourceMediaPath: imageNode.data.src,
            referenceAudioPaths: [audioNode.data.src]
          })
          return
        }
      }

      const local = localCombineFor(source, target)
      if (local) {
        const outMediaType: MediaType = local.kind === 'mix-audio' ? 'audio' : 'video'
        const id = nextId('node')
        const node: MediaFlowNode = {
          id,
          type: 'media',
          position,
          data: {
            label,
            mediaType: outMediaType,
            // Local ffmpeg composite, not an agent generation — same
            // provenance IsolateScreen already uses for its ffmpeg output.
            source: 'upload',
            status: 'rendering',
            swatch: pickSwatch()
          }
        }
        set({ nodes: [...get().nodes, node] })
        persist()
        void (async () => {
          const result = await bridge.media.combineLocal(local)
          if (result?.ok && result.src) {
            patchNodeAnywhere(id, { src: result.src, status: 'ready', error: undefined })
          } else {
            patchNodeAnywhere(id, { status: 'error', error: result?.error ?? 'Local combine failed.' })
          }
        })()
        return
      }

      // Unreachable for MediaType's current three values (every pairing is
      // either generative above or local here) — kept as a safety net rather
      // than assuming a future MediaType addition is covered automatically.
      const types = new Set<MediaType>([source.data.mediaType, target.data.mediaType])
      const mediaType: MediaType = types.has('video')
        ? 'video'
        : types.has('audio') && types.has('image')
          ? 'video'
          : source.data.mediaType

      get().addNode({
        label,
        mediaType,
        source: 'generate',
        position,
        startRendering: true
      })
    },

    openPlay(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node || node.data.mediaType === 'image') return
      const session = activeSession()
      set({ playNodeId: nodeId, playFrom: session?.view ?? 'canvas' })
    },

    closePlay() {
      set({ playNodeId: null })
    },

    openEditor(manifestId, mode) {
      set({ editor: { manifestId, mode } })
    },

    closeEditor() {
      set({ editor: null })
    },

    setEditorMask(mask) {
      const editor = get().editor
      if (!editor) return
      set({ editor: { ...editor, mask } })
    },

    setTrim(nodeId, trimIn, trimOut) {
      patchNodeData(nodeId, { trimIn, trimOut })
    },

    splitAtPlayhead(nodeId, at) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node) return
      const inPt = node.data.trimIn ?? 0
      const outPt = node.data.trimOut
      if (at <= inPt || (outPt !== undefined && at >= outPt)) return
      // Left half stays on the source node; right half spawns beside it. Both are
      // non-destructive views of the same file (in/out points only).
      patchNodeData(nodeId, { trimOut: at })
      get().addNode({
        label: `${node.data.label}_b`,
        mediaType: node.data.mediaType,
        source: node.data.source,
        src: node.data.src,
        position: { x: node.position.x + 130, y: node.position.y + 24 },
        startRendering: false
      })
      // Carry the right-half range onto the freshly added node (last in the list).
      const added = get().nodes[get().nodes.length - 1]
      if (added) patchNodeData(added.id, { trimIn: at, trimOut: outPt })
    },

    detachAudio(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node || node.data.mediaType !== 'video' || !node.data.src) return
      // Detach spawns an independent audio node referencing the same file. Real
      // track extraction happens at export via ffmpeg (Phase 7); this is the
      // non-destructive canvas representation.
      get().addNode({
        label: `${node.data.label}_audio`,
        mediaType: 'audio',
        source: node.data.source,
        src: node.data.src,
        position: { x: node.position.x + 24, y: node.position.y + 150 },
        startRendering: false
      })
    },

    deleteAudio(nodeId) {
      patchNodeData(nodeId, { audioMuted: true })
    },

    addPanel(input) {
      const panels = get().nodes.filter((n) => n.data.panel)
      const nextOrder = panels.reduce((max, n) => Math.max(max, n.data.panelOrder ?? 0), 0) + 1
      const node: MediaFlowNode = {
        id: nextId('panel'),
        type: 'media',
        // Off-canvas until promoted; promotePanel assigns the real position.
        position: { x: 0, y: 0 },
        data: {
          label: input?.label ?? `panel ${String(nextOrder).padStart(2, '0')}`,
          mediaType: input?.mediaType ?? 'video',
          source: 'generate',
          status: 'ready',
          swatch: pickSwatch(),
          panel: true,
          panelOrder: nextOrder,
          promoted: false,
          shotDescription: input?.shotDescription
        }
      }
      set({ nodes: [...get().nodes, node] })
      persist()
    },

    updatePanel(nodeId, patch) {
      patchNodeData(nodeId, patch)
    },

    movePanel(nodeId, dir) {
      const ordered = get()
        .nodes.filter((n) => n.data.panel)
        .sort((a, b) => (a.data.panelOrder ?? 0) - (b.data.panelOrder ?? 0))
      const idx = ordered.findIndex((n) => n.id === nodeId)
      const swapWith = idx + dir
      if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return
      const a = ordered[idx]
      const b = ordered[swapWith]
      const aOrder = a.data.panelOrder ?? 0
      const bOrder = b.data.panelOrder ?? 0
      set({
        nodes: get().nodes.map((n) => {
          if (n.id === a.id) return { ...n, data: { ...n.data, panelOrder: bOrder } }
          if (n.id === b.id) return { ...n, data: { ...n.data, panelOrder: aOrder } }
          return n
        })
      })
      persist()
    },

    promotePanel(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node || !node.data.panel || node.data.promoted) return
      // Same node object graduates onto the Canvas — not a copy. It enters the
      // "Rendering…" lifecycle a real generation will occupy (stub timer today).
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                position: { x: 80 + Math.random() * 300, y: 80 + Math.random() * 220 },
                data: { ...n.data, promoted: true, status: 'rendering' }
              }
            : n
        )
      })
      persist()
      // A promoted panel with a note becomes a real generation; without one it
      // falls back to the stub lifecycle (nothing to prompt with yet).
      const note = (node.data.note ?? '').trim()
      if (note) {
        void get().generateMedia({
          nodeId,
          label: node.data.label,
          mediaType: node.data.mediaType,
          prompt: note,
          // Storyboard-tier routing: an image panel's model choice restricts
          // the generation to that connector (docs/connectors/catalog.md).
          connectorId: node.data.connectorId
        })
      } else {
        scheduleStubReady(nodeId)
      }
    },

    nodeStage(manifestId) {
      return readStage(manifestId)
    },

    setNodeTool(manifestId, toolId) {
      writeStage(manifestId, (stage) => ({ ...stage, toolId }))
    },

    setNodeModel(manifestId, modelId) {
      writeStage(manifestId, (stage) => ({ ...stage, modelId }))
    },

    selectTake(manifestId, index) {
      writeStage(manifestId, (stage) => ({
        ...stage,
        activeIndex: Math.max(0, Math.min(index, stage.takes.length - 1))
      }))
    },

    clearStage(manifestId) {
      writeStage(manifestId, () => ({ takes: [], activeIndex: 0, toolId: readStage(manifestId).toolId }))
    },

    stageGenerate(manifestId, input) {
      const count = Math.max(1, input.takes ?? 1)
      const fresh: StagedTake[] = Array.from({ length: count }, (_, i) => ({
        id: nextId('take'),
        mediaType: input.mediaType,
        status: 'rendering' as const,
        label: count > 1 ? `${input.label} ${i + 1}` : input.label,
        prompt: input.prompt,
        modelId: input.modelId,
        createdAt: Date.now()
      }))

      writeStage(manifestId, (stage) => ({
        ...stage,
        takes: [...stage.takes, ...fresh],
        activeIndex: stage.takes.length
      }))

      for (const take of fresh) {
        void (async () => {
          let result: Awaited<ReturnType<typeof bridge.generate.run>> = null
          try {
            result = await bridge.generate.run({
              mediaType: input.mediaType,
              prompt: input.prompt,
              aspectRatio: input.aspectRatio,
              durationSec: input.durationSec,
              resolution: input.resolution,
              connectorId: input.connectorId,
              connectorIds: input.connectorIds,
              modelHint: input.modelHint,
              referenceImagePaths: input.referenceImagePaths,
              startFramePath: input.startFramePath,
              endFramePath: input.endFramePath,
              referenceAudioPaths: input.referenceAudioPaths,
              sourceMediaPath: input.sourceMediaPath,
              maskDataUrl: input.maskDataUrl,
              extendVideoPath: input.extendVideoPath,
              extendVideoDurationSec: input.extendVideoDurationSec
            })
          } catch (error) {
            result = {
              ok: false,
              mediaType: input.mediaType,
              error: error instanceof Error ? error.message : String(error)
            }
          }

          patchTake(manifestId, take.id,
            result?.ok && result.src
              ? { status: 'ready', src: result.src, error: undefined }
              : { status: 'error', error: result?.error ?? 'Generation failed.' }
          )
        })()
      }
    },

    clearPendingNodeScreen() {
      set({ pendingNodeScreen: null })
    },

    setNodeInput(manifestId, role, src) {
      const all = get().nodeInputs
      const forNode = { ...(all[manifestId] ?? {}) }
      if (src) forNode[role] = src
      else delete forNode[role]
      set({ nodeInputs: { ...all, [manifestId]: forNode } })
    },

    applyHandoff(fromManifestId, to, role) {
      const stage = readStage(fromManifestId)
      const take = stage.takes[stage.activeIndex]
      if (!take || take.status !== 'ready' || !take.src) return
      const src = take.src
      // Commit first: the artifact has to exist as a node to be an input to anything.
      get().commitStage(fromManifestId)
      get().setNodeInput(to, role, src)
      set({ pendingNodeScreen: to })
    },

    commitStage(manifestId) {
      const stage = readStage(manifestId)
      const take = stage.takes[stage.activeIndex]
      if (!take || take.status !== 'ready' || !take.src) return null

      const id = nextId('node')
      const node: MediaFlowNode = {
        id,
        type: 'media',
        position: { x: 80 + Math.random() * 300, y: 80 + Math.random() * 220 },
        data: {
          label: take.label,
          mediaType: take.mediaType,
          source: 'generate',
          status: 'ready',
          src: take.src,
          swatch: pickSwatch()
        }
      }
      set({ nodes: [...get().nodes, node] })
      writeStage(manifestId, (s) => ({ ...s, takes: [], activeIndex: 0 }))
      persist()
      return id
    },

    generateMedia(input) {
      const id = input.nodeId ?? nextId('node')
      // A fresh Generate creates the rendering node; a promote reuses the panel
      // node (already flipped to rendering) — only create when it's new.
      if (!input.nodeId) {
        const node: MediaFlowNode = {
          id,
          type: 'media',
          position: input.position ?? {
            x: 80 + Math.random() * 300,
            y: 80 + Math.random() * 220
          },
          data: {
            label: input.label,
            mediaType: input.mediaType,
            source: 'generate',
            status: 'rendering',
            swatch: pickSwatch(),
            motionGfx: input.motionGfx
          }
        }
        set({ nodes: [...get().nodes, node] })
        persist()
      }

      // The id returns immediately; the generation itself runs on, patching
      // the node wherever it lives when the result lands.
      void (async () => {
        let result: Awaited<ReturnType<typeof bridge.generate.run>> = null
        try {
          result = await bridge.generate.run({
            mediaType: input.mediaType,
            prompt: input.prompt,
            aspectRatio: input.aspectRatio,
            durationSec: input.durationSec,
            resolution: input.resolution,
            connectorId: input.connectorId,
            connectorIds: input.connectorIds,
            modelHint: input.modelHint,
            referenceImagePaths: input.referenceImagePaths,
            startFramePath: input.startFramePath,
            endFramePath: input.endFramePath,
            referenceAudioPaths: input.referenceAudioPaths,
            sourceMediaPath: input.sourceMediaPath,
            extendVideoPath: input.extendVideoPath,
            extendVideoDurationSec: input.extendVideoDurationSec
          })
        } catch (error) {
          result = {
            ok: false,
            mediaType: input.mediaType,
            error: error instanceof Error ? error.message : String(error)
          }
        }

        if (result?.ok && result.src) {
          // Real measured length, not the requested one — Veo's 148s chained-
          // extension cap needs the actual total, and extension calls don't
          // report duration at all (only the fixed +7s/8s intent).
          const videoDurationSec =
            input.mediaType === 'video' ? await probeDuration(result.src, 'video') : undefined
          patchNodeAnywhere(id, {
            src: result.src,
            status: 'ready',
            error: undefined,
            genNote: result.note,
            ...(videoDurationSec ? { videoDurationSec } : {})
          })
        } else {
          patchNodeAnywhere(id, {
            status: 'error',
            error: result?.error ?? 'Generation failed.'
          })
        }
      })()
      return id
    },

    focusNodeId: null,

    focusNode(nodeId) {
      const session = activeSession()
      if (session && session.view !== 'canvas') updateSession(session.id, { view: 'canvas' })
      set({ focusNodeId: nodeId })
    },

    clearFocusNode() {
      set({ focusNodeId: null })
    },

    scriptingBusy: false,
    scriptingStream: null,
    improvingPanelId: null,
    improveError: null,
    deepfakeHandoff: null,

    async sendScriptingMessage(text) {
      const trimmed = text.trim()
      const session = activeSession()
      if (!trimmed || !session || get().scriptingBusy) return
      const sessionId = session.id
      const scripting = session.scripting ?? { messages: [], totalCostUsd: 0 }
      const userMessage = {
        id: nextId('msg'),
        role: 'user' as const,
        text: trimmed,
        at: new Date().toISOString()
      }
      const history = scripting.messages.map((m) => ({ role: m.role, text: m.text }))
      updateSession(sessionId, {
        scripting: { ...scripting, messages: [...scripting.messages, userMessage] }
      })
      set({ scriptingBusy: true, scriptingStream: { sessionId, text: '' } })

      // Real listing facts/CMA stats over an agent guessing them, when this
      // conversation has a ChatRealty-sourced node in play — fetched once,
      // on the conversation's first turn only, and folded into the prompt
      // (not the displayed message) rather than a standalone context UI.
      let promptForTurn = trimmed
      if (history.length === 0) {
        const listingNodes = session.nodes.filter((n) => Boolean(n.data.listingKey))
        const listingKey = listingNodes[listingNodes.length - 1]?.data.listingKey
        if (listingKey) {
          const context = await bridge.chatRealty.listingContext(listingKey)
          if (context?.ok && context.text) {
            promptForTurn = [
              "Real listing facts and CMA stats for this session's listing, from ChatRealty — use these numbers instead of inventing any:",
              context.text,
              '---',
              trimmed
            ].join('\n\n')
          }
        }
      }

      const unsubscribe = bridge.scripting.onStream((event) => {
        if (event.conversationId === sessionId) {
          const current = get().scriptingStream
          set({
            scriptingStream: { sessionId, text: (current?.text ?? '') + event.text }
          })
        }
      })
      try {
        const result = await bridge.scripting.turn({
          conversationId: sessionId,
          resumeSessionId: scripting.agentSessionId,
          prompt: promptForTurn,
          history
        })
        // Re-read: the turn may outlive a session switch; write to the
        // originating session either way (updateSession works by id).
        const target = get().sessions.find((s) => s.id === sessionId)
        const current = target?.scripting ?? { messages: [], totalCostUsd: 0 }
        const cost = result?.costUsd ?? 0
        if (result?.ok) {
          updateSession(sessionId, {
            scripting: {
              messages: [
                ...current.messages,
                { id: nextId('msg'), role: 'assistant', text: result.text, at: new Date().toISOString() }
              ],
              agentSessionId: result.agentSessionId ?? current.agentSessionId,
              totalCostUsd: current.totalCostUsd + cost
            }
          })
        } else {
          updateSession(sessionId, {
            scripting: {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: nextId('msg'),
                  role: 'assistant',
                  text: `⚠ ${result?.error ?? 'The agent did not respond.'}`,
                  at: new Date().toISOString()
                }
              ],
              totalCostUsd: current.totalCostUsd + cost
            }
          })
        }
        const agent = get().agent
        set({
          agent: {
            ...agent,
            lastCostUsd: result?.costUsd ?? agent.lastCostUsd,
            totalCostUsd: agent.totalCostUsd + cost
          }
        })
      } finally {
        unsubscribe()
        set({ scriptingBusy: false, scriptingStream: null })
      }
    },

    async runShotBreakdown() {
      const session = activeSession()
      if (!session || get().scriptingBusy) return { ok: false, count: 0, error: 'Busy.' }
      const scripting = session.scripting
      if (!scripting || scripting.messages.length === 0) {
        return { ok: false, count: 0, error: 'Develop a script in the conversation first.' }
      }
      const sessionId = session.id
      set({ scriptingBusy: true })
      try {
        const result = await bridge.scripting.breakdown({
          conversationId: sessionId,
          resumeSessionId: scripting.agentSessionId,
          history: scripting.messages.map((m) => ({ role: m.role, text: m.text }))
        })
        if (!result?.ok) {
          return { ok: false, count: 0, error: result?.error ?? 'Shot breakdown failed.' }
        }
        // Always fresh panels, never matched against existing ones (the
        // firm v1 decision in the spec). The agent turn takes seconds, so the
        // user may have switched sessions — panels must land in the session
        // that ASKED for them, not whichever is active now.
        const stillActive = get().activeSessionId === sessionId
        if (stillActive) {
          for (const shot of result.shots) {
            get().addPanel({ label: shot.label, shotDescription: shot.description })
          }
        } else {
          const sessions = get().sessions.map((s) => {
            if (s.id !== sessionId) return s
            let order = s.nodes
              .filter((n) => n.data.panel)
              .reduce((max, n) => Math.max(max, (n.data.panelOrder as number) ?? 0), 0)
            const panels: CanvasNodeState[] = result.shots.map((shot) => {
              order += 1
              return {
                id: nextId('panel'),
                position: { x: 0, y: 0 },
                data: {
                  label: shot.label,
                  mediaType: 'video' as MediaType,
                  source: 'generate' as SourceMethod,
                  status: 'ready' as const,
                  swatch: pickSwatch(),
                  panel: true,
                  panelOrder: order,
                  promoted: false,
                  shotDescription: shot.description
                }
              }
            })
            return { ...s, nodes: [...s.nodes, ...panels] }
          })
          set({ sessions })
          persist()
        }
        const target = get().sessions.find((s) => s.id === sessionId)
        const current = target?.scripting ?? { messages: [], totalCostUsd: 0 }
        updateSession(sessionId, {
          scripting: {
            messages: [
              ...current.messages,
              {
                id: nextId('msg'),
                role: 'assistant',
                text: `Broke the script into ${result.shots.length} shots — they're on the Storyboard. Add a feeling to each panel, then use ✨ to author its generation prompt.`,
                at: new Date().toISOString()
              }
            ],
            agentSessionId: result.agentSessionId ?? current.agentSessionId,
            totalCostUsd: current.totalCostUsd + (result.costUsd ?? 0)
          }
        })
        return { ok: true, count: result.shots.length, stillActive }
      } finally {
        set({ scriptingBusy: false })
      }
    },

    async improvePanelPrompt(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node?.data.panel || !node.data.shotDescription || get().improvingPanelId) return
      set({ improvingPanelId: nodeId, improveError: null })
      try {
        const result = await bridge.scripting.improve({
          label: node.data.label,
          shotDescription: node.data.shotDescription,
          feeling: node.data.feeling ?? ''
        })
        if (result?.ok && result.prompt) {
          patchNodeAnywhere(nodeId, { note: result.prompt })
        } else {
          // Never touch the note on failure — the user may have kept typing in
          // it during the call, and error text must not become a generation
          // prompt. Surface the failure beside the button instead.
          set({ improveError: { nodeId, message: result?.error ?? 'Prompt authoring failed.' } })
        }
      } finally {
        set({ improvingPanelId: null })
      }
    },

    sendPanelToDeepfake(nodeId) {
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!node?.data.panel || !node.data.shotDescription) return
      set({
        deepfakeHandoff: {
          script: node.data.shotDescription,
          toneHint: node.data.feeling ?? ''
        }
      })
    },

    clearDeepfakeHandoff() {
      set({ deepfakeHandoff: null })
    },

    toggleRail() {
      set({ railCollapsed: !get().railCollapsed })
    },

    toggleAside() {
      set({ asideCollapsed: !get().asideCollapsed })
    },

    toggleTimeline() {
      set({ timelineCollapsed: !get().timelineCollapsed })
    },

    setPanelSize(panel, px) {
      if (panel === 'rail') set({ railWidth: px })
      else if (panel === 'aside') set({ asideWidth: px })
      else set({ timelineHeight: px })
      persist()
    },

    setTimelineTrackHeight(px) {
      set({ timelineTrackHeight: Math.min(96, Math.max(28, Math.round(px))) })
      persist()
    },

    openSettings(tab) {
      set({ settingsOpen: true, ...(tab ? { settingsTab: tab } : {}) })
    },

    closeSettings() {
      set({ settingsOpen: false })
    },

    setSettingsTab(tab) {
      set({ settingsTab: tab })
    },

    setTheme(theme) {
      document.documentElement.dataset.theme = theme
      set({ theme })
      persist()
    },

    async pingAgent() {
      if (get().agent.status === 'running') return
      set({
        agent: { ...get().agent, status: 'running', transcript: '', lastDurationMs: null }
      })
      const unsubscribe = bridge.agent.onStream((event: AgentStreamEvent) => {
        if (event.kind === 'text') {
          set({ agent: { ...get().agent, transcript: get().agent.transcript + event.text } })
        }
      })
      try {
        const result = await bridge.agent.ping(
          'You are wired into the Lyme Hype studio shell. Confirm the link in one short sentence.'
        )
        const previous = get().agent
        if (result?.ok) {
          set({
            agent: {
              status: 'ok',
              transcript: result.text,
              lastCostUsd: result.costUsd,
              totalCostUsd: previous.totalCostUsd + (result.costUsd ?? 0),
              lastDurationMs: result.durationMs
            }
          })
        } else {
          set({
            agent: {
              ...previous,
              status: 'error',
              transcript: result?.error ?? 'Agent did not respond.',
              lastDurationMs: result?.durationMs ?? null
            }
          })
        }
      } finally {
        unsubscribe()
      }
    },

    async pullChatRealtyPhotos(query) {
      const result = await bridge.chatRealty.pull(query)
      if (!result || !result.ok) {
        return { ok: false, count: 0, error: result?.error ?? 'ChatRealty is unavailable.', photos: [] }
      }
      const cols = 3
      const gap = 128
      const originX = 60
      const originY = 70
      result.images.forEach((img, i) => {
        get().addNode({
          label: img.label,
          mediaType: 'image',
          source: 'generate',
          src: img.src,
          detailUrl: img.detailUrl ?? undefined,
          listingKey: img.listingKey,
          position: { x: originX + (i % cols) * gap, y: originY + Math.floor(i / cols) * gap },
          startRendering: false
        })
      })
      const top = result.listings[0]
      return {
        ok: true,
        count: result.images.length,
        error: result.images.length === 0 ? (result.error ?? 'No photos found.') : undefined,
        topListing: top
          ? { listingKey: top.listingKey, address: top.address, city: top.city, detailUrl: top.detailUrl }
          : undefined,
        photos: result.images.map((img) => ({
          src: img.src,
          label: img.label,
          photoIndex: img.photoIndex
        }))
      }
    },

    async createChatRealtyCover(listingKey, opts) {
      const result = await bridge.chatRealty.createCover(listingKey, {
        hook: opts.hook,
        body: opts.body,
        city: opts.city
      })
      if (!result || !result.ok || !result.src) {
        return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
      }
      get().addNode({
        label: opts.label,
        mediaType: 'image',
        source: 'generate',
        src: result.src,
        detailUrl: opts.detailUrl,
        listingKey,
        startRendering: false
      })
      return { ok: true }
    },

    async createChatRealtyCarouselSlide(input, opts) {
      const result = await bridge.chatRealty.createCarouselSlide(input)
      if (!result || !result.ok || !result.src) {
        return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
      }
      get().addNode({
        label: opts.label,
        mediaType: 'image',
        source: 'generate',
        src: result.src,
        detailUrl: opts.detailUrl,
        listingKey: opts.listingKey,
        startRendering: false
      })
      return { ok: true }
    },

    async stageChatRealtyListing(listingKey, photoIndexes, opts) {
      const result = await bridge.chatRealty.stageListing(listingKey, photoIndexes)
      if (!result || !result.ok || !result.images || result.images.length === 0) {
        return { ok: false, count: 0, error: result?.error ?? 'ChatRealty is unavailable.' }
      }
      const cols = 3
      const gap = 128
      const originX = 60
      const originY = 260
      result.images.forEach((img, i) => {
        get().addNode({
          label: `${opts.labelBase} · Staged ${String(i + 1).padStart(2, '0')}`,
          mediaType: 'image',
          source: 'generate',
          src: img.src,
          detailUrl: opts.detailUrl,
          listingKey,
          position: { x: originX + (i % cols) * gap, y: originY + Math.floor(i / cols) * gap },
          startRendering: false
        })
      })
      return { ok: true, count: result.images.length }
    },

    async createChatRealtyArticleDraft(input) {
      const result = await bridge.chatRealty.createArticleDraft(input)
      if (!result || !result.ok) {
        return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
      }
      return { ok: true, slug: result.slug }
    },

    async createChatRealtyLandingPageDraft(input) {
      const result = await bridge.chatRealty.createLandingPageDraft(input)
      if (!result || !result.ok) {
        return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
      }
      return { ok: true, editUrl: result.editUrl, previewUrl: result.previewUrl }
    },

    flushPersist() {
      if (!get().loaded) return
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      const state = persistedSnapshot()
      // Synchronous — this runs during beforeunload, when there's no time to
      // await. Falls back to async save under the browser-preview mock.
      if (bridge.isElectron) bridge.sessions.saveSync(state)
      else void bridge.sessions.save(state)
    }
  }
})

export function useActiveSession(): Session | null {
  return useStudio((s) => s.sessions.find((session) => session.id === s.activeSessionId) ?? null)
}
