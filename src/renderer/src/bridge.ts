import type {
  AgentPingResult,
  AgentStreamEvent,
  PersistedState,
  SecretReport,
  SecretRequest
} from '@shared/types'

export interface Bridge {
  isElectron: boolean
  window: { minimize(): void; maximize(): void; close(): void }
  sessions: {
    load(): Promise<PersistedState | null>
    save(state: PersistedState): Promise<void>
  }
  agent: {
    ping(prompt: string): Promise<AgentPingResult | null>
    onStream(callback: (event: AgentStreamEvent) => void): () => void
  }
  media: {
    pickFile(kind: 'image' | 'video' | 'audio'): Promise<{ name: string; path: string } | null>
  }
  secrets: {
    request(request: SecretRequest): Promise<SecretReport | null>
    list(): Promise<SecretReport[]>
    delete(connectorId: string): Promise<void>
  }
}

/**
 * Browser-preview fallback so the renderer can be exercised in a plain browser
 * against the Vite dev server (no Electron main process). In-memory only; the
 * secure-credential path is deliberately NOT mocked with a real input — it
 * reports that the native modal needs Electron.
 */
function createBrowserMock(): Bridge {
  let state: PersistedState = { sessions: [], activeSessionId: null }
  const secrets: SecretReport[] = []

  return {
    isElectron: false,
    window: {
      minimize: () => {},
      maximize: () => {},
      close: () => {}
    },
    sessions: {
      load: async () => state,
      save: async (next) => {
        state = next
      }
    },
    agent: {
      ping: async () => ({
        ok: false,
        text: '',
        costUsd: null,
        durationMs: 0,
        error: 'Agent runs in the Electron main process — unavailable in browser preview.'
      }),
      onStream: () => () => {}
    },
    media: {
      pickFile: async () => null
    },
    secrets: {
      request: async () => null,
      list: async () => secrets,
      delete: async (connectorId) => {
        const index = secrets.findIndex((s) => s.connectorId === connectorId)
        if (index >= 0) secrets.splice(index, 1)
      }
    }
  }
}

function createElectronBridge(): Bridge {
  const lyme = window.lyme!
  return {
    isElectron: true,
    window: lyme.window,
    sessions: lyme.sessions,
    agent: lyme.agent,
    media: lyme.media,
    secrets: lyme.secrets
  }
}

export const bridge: Bridge = window.lyme ? createElectronBridge() : createBrowserMock()
