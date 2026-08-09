import type {
  AgentPingResult,
  AgentStreamEvent,
  ChatRealtyPullResult,
  ClaudeAuthStatus,
  ConnectorDef,
  ConnectorSuggestion,
  ConnectorTestResult,
  ConnectorView,
  ConversationStreamEvent,
  ConversationTurnRequest,
  ConversationTurnResult,
  CutExportResult,
  GenerationParams,
  GenerationResult,
  ImprovePromptResult,
  ModelProviderDef,
  ModelProviderView,
  PersistedState,
  SecretReport,
  SecretRequest,
  ShotBreakdownResult,
  TimelineExportSpec
} from '@shared/types'

export interface Bridge {
  isElectron: boolean
  window: { minimize(): void; maximize(): void; close(): void }
  sessions: {
    load(): Promise<PersistedState | null>
    save(state: PersistedState): Promise<void>
    saveSync(state: PersistedState): void
  }
  agent: {
    ping(prompt: string): Promise<AgentPingResult | null>
    onStream(callback: (event: AgentStreamEvent) => void): () => void
    claudeStatus(): Promise<ClaudeAuthStatus | null>
  }
  scripting: {
    turn(request: ConversationTurnRequest): Promise<ConversationTurnResult | null>
    onStream(callback: (event: ConversationStreamEvent) => void): () => void
    breakdown(request: Omit<ConversationTurnRequest, 'prompt'>): Promise<ShotBreakdownResult | null>
    improve(input: {
      label: string
      shotDescription: string
      feeling: string
    }): Promise<ImprovePromptResult | null>
  }
  media: {
    pickFile(kind: 'image' | 'video' | 'audio'): Promise<{ name: string; path: string } | null>
    import(
      kind: 'image' | 'video' | 'audio'
    ): Promise<{ name: string; src: string; mediaType: 'image' | 'video' | 'audio' } | null>
    importUrl(url: string): Promise<{ name: string; src: string | null; error: string | null } | null>
  }
  generate: {
    run(params: GenerationParams): Promise<GenerationResult | null>
  }
  cutRoom: {
    export(spec: TimelineExportSpec): Promise<CutExportResult | null>
  }
  chatRealty: {
    status(): Promise<{ connected: boolean } | null>
    pull(query: string): Promise<ChatRealtyPullResult | null>
  }
  connectors: {
    list(): Promise<ConnectorView[]>
    save(def: ConnectorDef): Promise<void>
    delete(id: string): Promise<void>
    test(id: string): Promise<ConnectorTestResult | null>
    suggestions(): Promise<ConnectorSuggestion[]>
    addSuggestion(id: string): Promise<ConnectorDef | null>
    openKeyPage(id: string): Promise<void>
    oauthConnect(id: string): Promise<{ ok: boolean; error?: string } | null>
  }
  modelProviders: {
    list(): Promise<ModelProviderView[]>
    save(def: ModelProviderDef): Promise<void>
    delete(id: string): Promise<void>
    setActive(id: string): Promise<void>
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
      },
      saveSync: (next) => {
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
      onStream: () => () => {},
      claudeStatus: async () => ({ override: 'none' })
    },
    scripting: {
      turn: async () => ({
        ok: false,
        text: '',
        costUsd: null,
        error: 'The agent runs in the Electron main process — unavailable in browser preview.'
      }),
      onStream: () => () => {},
      breakdown: async () => ({
        ok: false,
        shots: [],
        costUsd: null,
        error: 'The agent runs in the Electron main process — unavailable in browser preview.'
      }),
      improve: async () => ({
        ok: false,
        prompt: '',
        costUsd: null,
        error: 'The agent runs in the Electron main process — unavailable in browser preview.'
      })
    },
    media: {
      pickFile: async () => null,
      import: async () => null,
      importUrl: async () => ({
        name: '',
        src: null,
        error: 'Media import runs in the Electron main process — unavailable in browser preview.'
      })
    },
    generate: {
      run: async (params) => ({
        ok: false,
        mediaType: params.mediaType,
        error: 'Generation runs in the Electron main process — unavailable in browser preview.'
      })
    },
    cutRoom: {
      export: async () => ({
        ok: false,
        error: 'Export runs in the Electron main process — unavailable in browser preview.'
      })
    },
    chatRealty: {
      status: async () => ({ connected: false }),
      pull: async () => ({
        ok: false,
        images: [],
        listings: [],
        error: 'ChatRealty runs in the Electron main process — unavailable in browser preview.'
      })
    },
    connectors: {
      list: async () => [],
      save: async () => {},
      delete: async () => {},
      test: async () => ({
        ok: false,
        error: 'Connections run in the Electron main process — unavailable in browser preview.'
      }),
      suggestions: async () => [],
      addSuggestion: async () => null,
      openKeyPage: async () => {},
      oauthConnect: async () => ({
        ok: false,
        error: 'OAuth runs in the Electron main process — unavailable in browser preview.'
      })
    },
    modelProviders: {
      list: async () => [],
      save: async () => {},
      delete: async () => {},
      setActive: async () => {}
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
    scripting: lyme.scripting,
    media: lyme.media,
    generate: lyme.generate,
    cutRoom: lyme.cutRoom,
    chatRealty: lyme.chatRealty,
    connectors: lyme.connectors,
    modelProviders: lyme.modelProviders,
    secrets: lyme.secrets
  }
}

export const bridge: Bridge = window.lyme ? createElectronBridge() : createBrowserMock()
