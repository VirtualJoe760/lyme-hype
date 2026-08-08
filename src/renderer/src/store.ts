import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import type {
  AgentStreamEvent,
  CanvasNodeState,
  MediaNodeData,
  MediaType,
  PersistedState,
  Session,
  SourceMethod,
  StudioView
} from '@shared/types'
import { bridge } from './bridge'

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
  connectionsOpen: boolean
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
    position?: { x: number; y: number }
    startRendering?: boolean
  }): void
  removeNode(id: string): void
  sendToTimeline(nodeId: string): void
  removeClip(clipId: string): void

  openCombine(sourceId: string, targetId: string): void
  closeCombine(): void
  confirmCombine(): void

  toggleRail(): void
  toggleAside(): void
  setConnectionsOpen(open: boolean): void

  pingAgent(): Promise<void>
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

  function persist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const { activeSessionId } = get()
      const state: PersistedState = { sessions: syncedSessions(), activeSessionId }
      void bridge.sessions.save(state)
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

  function scheduleStubReady(nodeId: string): void {
    setTimeout(() => {
      const inActive = get().nodes.some((n) => n.id === nodeId)
      if (inActive) {
        patchNodeData(nodeId, { status: 'ready' })
        return
      }
      // The node's session was switched away before the timer fired, so it now
      // lives only in the serialized sessions array — flip it there, or it stays
      // stuck "Rendering…" until the next app start. A since-deleted node is a
      // no-op under the map.
      const sessions = get().sessions.map((session) => {
        if (!session.nodes.some((n) => n.id === nodeId)) return session
        return {
          ...session,
          nodes: session.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, status: 'ready' as const } } : n
          )
        }
      })
      set({ sessions })
      persist()
    }, STUB_RENDER_MS)
  }

  return {
    loaded: false,
    sessions: [],
    activeSessionId: null,
    nodes: [],
    railCollapsed: false,
    asideCollapsed: false,
    connectionsOpen: false,
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
      set({
        loaded: true,
        sessions,
        activeSessionId,
        nodes: active.nodes.map(toFlowNode)
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
          motionGfx: input.motionGfx,
          filePath: input.filePath,
          sourceUrl: input.sourceUrl
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

    toggleRail() {
      set({ railCollapsed: !get().railCollapsed })
    },

    toggleAside() {
      set({ asideCollapsed: !get().asideCollapsed })
    },

    setConnectionsOpen(open) {
      set({ connectionsOpen: open })
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

    flushPersist() {
      if (!get().loaded) return
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
      const state: PersistedState = {
        sessions: syncedSessions(),
        activeSessionId: get().activeSessionId
      }
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
