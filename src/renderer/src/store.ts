import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import type {
  AgentStreamEvent,
  CanvasNodeState,
  CutExportResult,
  MediaNodeData,
  MediaType,
  PersistedState,
  Session,
  SourceMethod,
  StudioView,
  ThemeId,
  TimelineExportClip
} from '@shared/types'
import { bridge } from './bridge'

export type SettingsTab = 'connectors' | 'models' | 'appearance'

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

/** Stub-generation latency so the Rendering… state is visible (real jobs land in Phase 4). */
const STUB_RENDER_MS = 2500

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
  sendToTimeline(nodeId: string): void
  removeClip(clipId: string): void
  moveClip(clipId: string, dir: -1 | 1): void
  exportTimeline(): Promise<CutExportResult | null>

  openCombine(sourceId: string, targetId: string): void
  closeCombine(): void
  confirmCombine(): void

  openPlay(nodeId: string): void
  closePlay(): void
  setTrim(nodeId: string, trimIn: number, trimOut: number): void
  splitAtPlayhead(nodeId: string, at: number): void
  detachAudio(nodeId: string): void
  deleteAudio(nodeId: string): void

  addPanel(input?: { mediaType?: MediaType; label?: string }): void
  updatePanel(nodeId: string, patch: { label?: string; note?: string; mediaType?: MediaType }): void
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
  }): Promise<void>

  toggleRail(): void
  toggleAside(): void
  toggleTimeline(): void
  setPanelSize(panel: 'rail' | 'aside' | 'timeline', px: number): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
  setSettingsTab(tab: SettingsTab): void
  setTheme(theme: ThemeId): void

  pingAgent(): Promise<void>
  pullChatRealtyPhotos(query: string): Promise<{ ok: boolean; count: number; error?: string }>
  flushPersist(): void
}

function newSession(index: number): Session {
  return {
    id: nextId('session'),
    name: `R-${String(index).padStart(3, '0')} · Untitled`,
    createdAt: new Date().toISOString(),
    nodes: [],
    cutRoom: [],
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
    const { activeSessionId, theme, railWidth, asideWidth, timelineHeight } = get()
    return {
      sessions: syncedSessions(),
      activeSessionId,
      theme,
      railWidth,
      asideWidth,
      timelineHeight
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
    settingsOpen: false,
    settingsTab: 'connectors',
    theme: 'lime-cut',
    playNodeId: null,
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
      // timer died with the previous process.
      sessions = sessions.map((session) => ({
        ...session,
        nodes: session.nodes.map((node) =>
          node.data.status === 'rendering'
            ? { ...node, data: { ...node.data, status: 'ready' as const } }
            : node
        )
      }))
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
        timelineHeight: persisted?.timelineHeight ?? PANEL_SIZES.timeline.default
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
      // removed nodes' clips from the Cut Room too.
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removedIds.length > 0) {
        const session = activeSession()
        if (session && session.cutRoom.some((clip) => removedIds.includes(clip.nodeId))) {
          updateSession(session.id, {
            cutRoom: session.cutRoom.filter((clip) => !removedIds.includes(clip.nodeId))
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
          cutRoom: session.cutRoom.filter((clip) => clip.nodeId !== id)
        })
      }
      persist()
    },

    sendToTimeline(nodeId) {
      const session = activeSession()
      const node = get().nodes.find((n) => n.id === nodeId)
      if (!session || !node) return
      if (node.data.mediaType === 'image') return
      if (node.data.status !== 'ready') return
      if (session.cutRoom.some((clip) => clip.nodeId === nodeId)) return
      updateSession(session.id, {
        cutRoom: [
          ...session.cutRoom,
          {
            id: nextId('clip'),
            nodeId,
            label: node.data.label,
            mediaType: node.data.mediaType,
            swatch: node.data.swatch
          }
        ]
      })
      patchNodeData(nodeId, { sentToTimeline: true })
    },

    removeClip(clipId) {
      const session = activeSession()
      if (!session) return
      const clip = session.cutRoom.find((c) => c.id === clipId)
      updateSession(session.id, {
        cutRoom: session.cutRoom.filter((c) => c.id !== clipId)
      })
      if (clip && get().nodes.some((n) => n.id === clip.nodeId)) {
        patchNodeData(clip.nodeId, { sentToTimeline: false })
      }
    },

    moveClip(clipId, dir) {
      const session = activeSession()
      if (!session) return
      const clips = [...session.cutRoom]
      const idx = clips.findIndex((c) => c.id === clipId)
      const swap = idx + dir
      if (idx < 0 || swap < 0 || swap >= clips.length) return
      const tmp = clips[idx]
      clips[idx] = clips[swap]
      clips[swap] = tmp
      updateSession(session.id, { cutRoom: clips })
    },

    async exportTimeline() {
      const session = activeSession()
      if (!session) return null
      // Resolve each timeline clip to its live node so trims/mute set after it
      // was sent are honored. Only nodes with real media are exportable.
      const clips: TimelineExportClip[] = []
      for (const clip of session.cutRoom) {
        const node = get().nodes.find((n) => n.id === clip.nodeId)
        if (!node?.data.src) continue
        clips.push({
          src: node.data.src,
          mediaType: node.data.mediaType,
          trimIn: node.data.trimIn,
          trimOut: node.data.trimOut,
          muted: node.data.audioMuted
        })
      }
      if (clips.length === 0) {
        return { ok: false, error: 'No exportable clips — the timeline needs video nodes with real media.' }
      }
      return bridge.cutRoom.export(clips)
    },

    openCombine(sourceId, targetId) {
      if (sourceId === targetId) return
      set({ combine: { sourceId, targetId } })
    },

    closeCombine() {
      set({ combine: null })
    },

    confirmCombine() {
      const { combine, nodes } = get()
      if (!combine) return
      const source = nodes.find((n) => n.id === combine.sourceId)
      const target = nodes.find((n) => n.id === combine.targetId)
      set({ combine: null })
      if (!source || !target) return

      const types = new Set<MediaType>([source.data.mediaType, target.data.mediaType])
      const mediaType: MediaType = types.has('video')
        ? 'video'
        : types.has('audio') && types.has('image')
          ? 'video'
          : source.data.mediaType

      const midpoint = {
        x: (source.position.x + target.position.x) / 2 + 40,
        y: (source.position.y + target.position.y) / 2 + 60
      }
      get().addNode({
        label: `combine_${source.data.label.slice(0, 8)}+${target.data.label.slice(0, 8)}`,
        mediaType,
        source: 'generate',
        position: midpoint,
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
          promoted: false
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
          prompt: note
        })
      } else {
        scheduleStubReady(nodeId)
      }
    },

    async generateMedia(input) {
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

      let result: Awaited<ReturnType<typeof bridge.generate.run>> = null
      try {
        result = await bridge.generate.run({
          mediaType: input.mediaType,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          durationSec: input.durationSec,
          resolution: input.resolution
        })
      } catch (error) {
        result = {
          ok: false,
          mediaType: input.mediaType,
          error: error instanceof Error ? error.message : String(error)
        }
      }

      if (result?.ok && result.src) {
        patchNodeAnywhere(id, {
          src: result.src,
          status: 'ready',
          error: undefined,
          genNote: result.note
        })
      } else {
        patchNodeAnywhere(id, {
          status: 'error',
          error: result?.error ?? 'Generation failed.'
        })
      }
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
        return { ok: false, count: 0, error: result?.error ?? 'ChatRealty is unavailable.' }
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
      return {
        ok: true,
        count: result.images.length,
        error: result.images.length === 0 ? (result.error ?? 'No photos found.') : undefined
      }
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
