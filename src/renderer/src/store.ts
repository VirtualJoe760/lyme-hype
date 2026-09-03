import { applyNodeChanges } from '@xyflow/react'
import { create } from 'zustand'
import type {
  MediaNodeData,
  NodeStage,
  PersistedState,
  Session,
  StagedTake,
  ThemeId,
} from '@shared/types'
import { bridge } from './bridge'
import { nextId, type MediaFlowNode, type StudioStore } from './store/types'
import type { StoreCtx } from './store/context'
import { createTimelineActions } from './store/timeline-actions'
import { createReviewActions } from './store/review-actions'
import { createGenerationActions } from './store/generation-actions'
import { createWorkspaceActions } from './store/workspace-actions'
import { createChatRealtyActions } from './store/chatrealty-actions'
import { createTrashActions } from './store/trash-actions'
import { createLayoutActions } from './store/layout-actions'
import {
  STUB_RENDER_MS,
  migrateSession,
  newSession,
  pickSwatch,
  PANEL_SIZES,
  flowNodesFrom,
  toNodeState,
} from './store/helpers'

// The store's public surface and its pure helpers live in ./store/* — this file
// is the create() body: the closure over set/get and nothing else.
export type { BootStep, MediaFlowNode, SettingsTab, StudioStore } from './store/types'
// Components import these from the store, not from its internals.
export { PANEL_SIZES, probeDuration } from './store/helpers'

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useStudio = create<StudioStore>((set, get) => {
  function activeSession(): Session | null {
    const { sessions, activeSessionId } = get()
    return sessions.find((s) => s.id === activeSessionId) ?? null
  }

  /** Serializes the live canvas back into the sessions array. */
  function syncedSessions(): Session[] {
    const { sessions, activeSessionId, nodes, nodeInputs, nodeDataset } = get()
    return sessions.map((session) =>
      session.id === activeSessionId
        ? { ...session, nodes: nodes.map(toNodeState), nodeInputs, nodeDataset }
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

  /** Ready takes still sitting in staging — paid renders not yet on the canvas.
   *  The close guard asks about these before the window goes away. */
  function uncommittedTakeCount(sessions: Session[]): number {
    let count = 0
    for (const session of sessions) {
      for (const stage of Object.values(session.stages ?? {})) {
        count += stage.takes.filter((t) => t.status === 'ready' && t.src).length
      }
    }
    return count
  }

  /** Mirror the active session into its project folder in the workspace.
   *  Sessions and projects were two disconnected worlds — a session you never
   *  explicitly closed simply did not exist to the "open a project" list, which
   *  is how "Wow Generations" was nowhere to be found (2026-08-31). Every
   *  session is now a project on disk, named for itself. The returned folder is
   *  recorded once so later saves update it in place instead of cloning. */
  function saveSessionAsProject(session: Session): void {
    void bridge.sessions.closeToProject(session).then((result) => {
      if (!result?.ok || !result.dir || result.dir === session.projectDir) return
      const dir = result.dir
      set({
        sessions: get().sessions.map((s) => (s.id === session.id ? { ...s, projectDir: dir } : s))
      })
    })
  }

  function persist(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const snapshot = persistedSnapshot()
      bridge.sessions.reportUncommitted(uncommittedTakeCount(snapshot.sessions))
      void bridge.sessions.save(snapshot)
      const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
      if (active) saveSessionAsProject(active)
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

  /** Put a finished take on the canvas. Generations go straight here rather than
   *  waiting behind a Finish click: a render that cost real money should never
   *  sit somewhere the user can lose track of (Joseph, 2026-08-31 — unwanted
   *  nodes are cheap to delete, lost renders are not). */
  function placeTakeOnCanvas(take: StagedTake): string {
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
        thumbSrc: take.thumbSrc,
        swatch: pickSwatch()
      }
    }
    // Centre the canvas on it. Placing a node isn't the same as the user SEEING
    // it — nodes land at arbitrary coordinates and the canvas may be panned
    // elsewhere, which is exactly how a finished video felt "missing" while
    // sitting on the canvas the whole time (2026-08-31).
    set({ nodes: [...get().nodes, node], focusNodeId: id })
    return id
  }

  /** Put any finished-but-stranded take on the canvas. Takes generated before
   *  auto-placement existed (or committed by an older build) sit "ready" with no
   *  node — paid renders visible only inside one panel. Runs on load and on
   *  session switch. A take whose media is ALREADY a node adopts that node
   *  instead of duplicating it. */
  function rescueStrandedTakes(): void {
    const { sessions, activeSessionId, nodes } = get()
    const session = sessions.find((s) => s.id === activeSessionId)
    if (!session?.stages) return
    const nodeIdBySrc = new Map(
      nodes.filter((n) => n.data.src).map((n) => [n.data.src as string, n.id])
    )
    let rescued = false
    const stages: Record<string, NodeStage> = {}
    for (const [manifestId, stage] of Object.entries(session.stages)) {
      stages[manifestId] = {
        ...stage,
        takes: stage.takes.map((take) => {
          if (take.status !== 'ready' || !take.src || take.nodeId) return take
          rescued = true
          return { ...take, nodeId: nodeIdBySrc.get(take.src) ?? placeTakeOnCanvas(take) }
        })
      }
    }
    if (!rescued) return
    set({
      sessions: get().sessions.map((s) => (s.id === session.id ? { ...s, stages } : s))
    })
    persist()
  }

  /**
   * Give every canvas node a real thumbnail, once.
   *
   * Clips saved before poster frames existed carry no `thumbSrc`, and the
   * `<video preload="metadata">` fallback paints an empty box instead of a frame
   * — restored video nodes looked blank on the canvas even though the media was
   * fine (2026-08-31). Main generates the poster on demand and caches it on
   * disk, so this costs nothing from the second boot onward. Deliberately not
   * awaited by init(): a missing thumbnail must never hold up the studio.
   */
  async function backfillThumbnails(): Promise<void> {
    const pending = get().nodes.filter((n) => n.data.src && !n.data.thumbSrc)
    for (const node of pending) {
      const thumbSrc = await bridge.media.ensureThumb(node.data.src as string)
      if (!thumbSrc) continue
      set({
        nodes: get().nodes.map((n) =>
          n.id === node.id ? { ...n, data: { ...n.data, thumbSrc } } : n
        )
      })
    }
    if (pending.length) persist()
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

  // One context, handed to each action slice — see store/context.ts for why the
  // slices live in their own files but still share this closure.
  const ctx: StoreCtx = {
    set,
    get,
    persist,
    updateSession,
    patchNodeData,
    patchNodeAnywhere,
    activeSession,
    syncedSessions,
    readStage,
    writeStage,
    patchTake,
    placeTakeOnCanvas,
    scheduleStubReady,
    rescueStrandedTakes,
    backfillThumbnails,
    saveSessionAsProject,
    persistedSnapshot,
    uncommittedTakeCount
  }

  return {
    ...createTimelineActions(ctx),
    ...createReviewActions(ctx),
    ...createGenerationActions(ctx),
    ...createWorkspaceActions(ctx),
    ...createChatRealtyActions(ctx),
    ...createTrashActions(ctx),
    ...createLayoutActions(ctx),
    focusNodeId: null,
    scriptingBusy: false,
    scriptingStream: null,
    improvingPanelId: null,
    improveError: null,
    deepfakeHandoff: null,

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
    pendingRefs: null,
    nodeInputs: {},
    nodeDataset: {},
    playFrom: 'canvas',
    combine: null,
    bootSteps: [],
    comfy: null,
    booted: false,
    agent: {
      status: 'idle',
      transcript: '',
      lastCostUsd: null,
      totalCostUsd: 0,
      lastDurationMs: null
    },

    async init() {
      const bootedAt = Date.now()
      const step = (label: string, detail: string): void => {
        set({ bootSteps: [...get().bootSteps, { label, detail }] })
      }

      // The close guard may ask for everything staged to be committed before the
      // window goes away; ack when done so main can finish closing.
      bridge.sessions.onCommitAll(() => {
        get().commitAllStages()
        bridge.sessions.commitAllDone()
      })

      const status = await bridge.sessions.systemStatus()
      step('media engine', status?.ffmpeg ? `ffmpeg (${status.ffmpeg})` : 'ffmpeg not found — export disabled')
      step('workspace', status?.workspace ?? 'unavailable')

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
          ),
          // A staged take left "rendering" can never finish — the promise that
          // would have completed it died with the previous process. Left in
          // place it becomes a permanent spinner sitting ON TOP of the real
          // takes (observed 2026-08-31: a finished video hidden behind a zombie
          // that looked like the video was gone). Drop them; the result itself,
          // if it landed, is in the generation ledger under Recent generations.
          stages: Object.fromEntries(
            Object.entries(session.stages ?? {}).map(([id, stage]) => {
              const takes = stage.takes.filter((t) => t.status !== 'rendering')
              return [
                id,
                takes.length === stage.takes.length
                  ? stage
                  : { ...stage, takes, activeIndex: Math.max(0, Math.min(stage.activeIndex, takes.length - 1)) }
              ]
            })
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
      sessions.forEach(saveSessionAsProject)
      set({
        loaded: true,
        sessions,
        activeSessionId,
        nodes: flowNodesFrom(active.nodes),
        nodeInputs: active.nodeInputs ?? {},
        nodeDataset: active.nodeDataset ?? {},
        theme,
        railWidth: persisted?.railWidth ?? PANEL_SIZES.rail.default,
        asideWidth: persisted?.asideWidth ?? PANEL_SIZES.aside.default,
        timelineHeight: persisted?.timelineHeight ?? PANEL_SIZES.timeline.default,
        timelineTrackHeight: persisted?.timelineTrackHeight ?? 46
      })
      step(
        'sessions',
        `${sessions.length} restored · ${active.name}${active.nodes.length ? ` (${active.nodes.length} nodes)` : ''}`
      )
      rescueStrandedTakes()
      void backfillThumbnails()

      const connectors = await bridge.connectors.list()
      const ready = connectors.filter((c) => c.authType === 'none' || c.hasCredential)
      step(
        'connectors',
        ready.length > 0
          ? `${ready.length} ready · ${ready.map((c) => c.id).join(', ')}`
          : 'none configured — add one in Settings'
      )
      // The local engine keeps narrating after the splash is gone — the status
      // strip shows it; the splash just records where it was at this moment.
      const comfy = await bridge.comfyui.status()
      if (comfy) set({ comfy })
      bridge.comfyui.onStatus((next) => set({ comfy: next }))
      step('local engine', comfy ? `comfyui ${comfy.phase} · ${comfy.detail}` : 'comfyui not configured')
      step(
        'ready',
        status?.stale
          ? `STALE BUILD (${status.build}) — source has changed since; run npm start`
          : `studio online · build ${status?.build ?? 'unknown'}`
      )

      // A minimum beat so the boot console is readable rather than a flicker on a
      // fast machine — the work is genuinely done either way.
      const elapsed = Date.now() - bootedAt
      window.setTimeout(() => set({ booted: true }), Math.max(0, 1500 - elapsed))
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

    importSessions(raw) {
      const current = syncedSessions()
      const taken = new Set(current.map((s) => s.id))
      const imported: Session[] = []
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue
        const s = entry as Partial<Session>
        if (typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.nodes)) continue
        const id = taken.has(s.id) ? nextId('session') : s.id
        taken.add(id)
        imported.push({
          ...s,
          id,
          name: s.name,
          createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
          nodes: s.nodes,
          timeline: s.timeline ?? { tracks: [], clips: [] },
          view: s.view ?? 'canvas'
        } as Session)
      }
      if (imported.length === 0) return 0
      const first = imported[0]
      set({
        sessions: [...imported, ...current],
        activeSessionId: first.id,
        nodes: flowNodesFrom(first.nodes),
        combine: null
      })
      persist()
      return imported.length
    },

    selectSession(id) {
      if (id === get().activeSessionId) return
      const sessions = syncedSessions()
      const next = sessions.find((s) => s.id === id)
      if (!next) return
      set({
        sessions,
        activeSessionId: id,
        nodes: flowNodesFrom(next.nodes),
        nodeInputs: next.nodeInputs ?? {},
        nodeDataset: next.nodeDataset ?? {},
        combine: null
      })
      persist()
      rescueStrandedTakes()
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
          nodes: flowNodesFrom(nextActive.nodes),
          combine: null
        })
      } else {
        set({ sessions })
      }
      persist()
    },

    async openProject(dir) {
      const result = await bridge.sessions.openProject(dir)
      if (!result?.session) return result?.error ?? 'Could not open that project.'
      const count = get().importSessions([result.session])
      return count > 0 ? null : 'That project had no usable session.'
    },

    commitAllStages() {
      const stages = activeSession()?.stages ?? {}
      let committed = 0
      for (const manifestId of Object.keys(stages)) {
        const stage = readStage(manifestId)
        // commitStage only takes the ACTIVE take, so walk the ready ones.
        for (let i = 0; i < stage.takes.length; i += 1) {
          const current = readStage(manifestId)
          const index = current.takes.findIndex((t) => t.status === 'ready' && t.src)
          if (index < 0) break
          get().selectTake(manifestId, index)
          if (get().commitStage(manifestId)) committed += 1
        }
      }
      return committed
    },

    async closeSession(id) {
      // Save FIRST, drop from the rail only once it's safely on disk — a "close"
      // that lost the work would be a delete with a friendlier name.
      const all = syncedSessions()
      const session = all.find((s) => s.id === id)
      if (!session) return 'Session not found.'
      const saved = await bridge.sessions.closeToProject(session)
      if (!saved?.ok) return saved?.error ?? 'Could not save the session.'
      // Remember where it landed so a future close updates that project rather
      // than cloning a second folder beside it.
      if (saved.dir) session.projectDir = saved.dir

      const remaining = all.filter((s) => s.id !== id)
      const sessions = remaining.length > 0 ? remaining : [newSession(1)]
      if (get().activeSessionId === id) {
        const nextActive = sessions[0]
        set({
          sessions,
          activeSessionId: nextActive.id,
          nodes: flowNodesFrom(nextActive.nodes),
          combine: null
        })
      } else {
        set({ sessions })
      }
      persist()
      return null
    },

    setView(view) {
      const session = activeSession()
      if (session) updateSession(session.id, { view })
    },

    onNodesChange(changes) {
      // Resize handles emit width AND height (setAttributes) — height is dropped
      // so a node's height always follows its media's aspect ratio; plain
      // measurement changes (no setAttributes) pass through untouched.
      // A group frame is the exception: its height is the user's, kept as-is.
      const widthOnly = changes.map((c) =>
        c.type === 'dimensions' && c.setAttributes && c.dimensions && get().nodes.find((n) => n.id === c.id)?.type !== 'group'
          ? { ...c, dimensions: { ...c.dimensions, height: undefined as unknown as number } }
          : c
      )
      // Keyboard deletes arrive here (not through removeNode). They go to the
      // trash like every other delete — captured BEFORE the change is applied,
      // or there is nothing left to keep.
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removedIds.length > 0) get().trashNodes(removedIds)
      const remaining = widthOnly.filter((c) => c.type !== 'remove')
      set({ nodes: applyNodeChanges(remaining, get().nodes) })
      if (changes.some((c) => c.type === 'dimensions' && c.setAttributes)) persist()
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
          listingKey: input.listingKey,
          characterId: input.characterId
        }
      }
      set({ nodes: [...get().nodes, node] })
      persist()
      if (rendering) scheduleStubReady(node.id)
    },

    removeNode(id) {
      get().trashNodes([id])
    },

    selectedTrackId: null,
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
