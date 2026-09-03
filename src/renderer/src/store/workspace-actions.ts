/** Scripting panel, panel layout, settings and the agent ping.
 *
 * A slice of the studio store: the same actions as before, lifted out of the
 * create() body so no single file carries the whole surface. */

import type {
  AgentStreamEvent,
  CanvasNodeState,
  MediaType,
  SourceMethod,
} from '@shared/types'
import { bridge } from '../bridge'
import type { StoreCtx } from './context'
import { nextId, type StudioStore } from './types'
import {
  pickSwatch,
} from './helpers'

export function createWorkspaceActions(ctx: StoreCtx): Pick<StudioStore, 'sendScriptingMessage' | 'runShotBreakdown' | 'improvePanelPrompt' | 'sendPanelToDeepfake' | 'clearDeepfakeHandoff' | 'toggleRail' | 'toggleAside' | 'toggleTimeline' | 'setPanelSize' | 'setTimelineTrackHeight' | 'openSettings' | 'closeSettings' | 'setSettingsTab' | 'setTheme' | 'pingAgent'> {
  const {
    set,
    get,
    persist,
    updateSession,
    patchNodeAnywhere,
    activeSession,
  } = ctx

  return {
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
  }
}
