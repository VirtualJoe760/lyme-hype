import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
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
} from '../shared/types'

const api = {
  window: {
    minimize: (): void => ipcRenderer.send(IPC.windowMinimize),
    maximize: (): void => ipcRenderer.send(IPC.windowMaximize),
    close: (): void => ipcRenderer.send(IPC.windowClose)
  },
  sessions: {
    load: (): Promise<PersistedState | null> => ipcRenderer.invoke(IPC.sessionsLoad),
    save: (state: PersistedState): Promise<void> => ipcRenderer.invoke(IPC.sessionsSave, state),
    // Blocking save for the beforeunload flush, when there's no time to await.
    saveSync: (state: PersistedState): void => {
      ipcRenderer.sendSync(IPC.sessionsSaveSync, state)
    }
  },
  agent: {
    ping: (prompt: string): Promise<AgentPingResult | null> =>
      ipcRenderer.invoke(IPC.agentPing, prompt),
    onStream: (callback: (event: AgentStreamEvent) => void): (() => void) => {
      const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
      ipcRenderer.on(IPC.agentStream, listener)
      return () => ipcRenderer.removeListener(IPC.agentStream, listener)
    },
    claudeStatus: (): Promise<ClaudeAuthStatus | null> => ipcRenderer.invoke(IPC.claudeStatus)
  },
  scripting: {
    turn: (request: ConversationTurnRequest): Promise<ConversationTurnResult | null> =>
      ipcRenderer.invoke(IPC.scriptingTurn, request),
    onStream: (callback: (event: ConversationStreamEvent) => void): (() => void) => {
      const listener = (_: unknown, event: ConversationStreamEvent): void => callback(event)
      ipcRenderer.on(IPC.scriptingStream, listener)
      return () => ipcRenderer.removeListener(IPC.scriptingStream, listener)
    },
    breakdown: (
      request: Omit<ConversationTurnRequest, 'prompt'>
    ): Promise<ShotBreakdownResult | null> => ipcRenderer.invoke(IPC.scriptingBreakdown, request),
    improve: (input: {
      label: string
      shotDescription: string
      feeling: string
    }): Promise<ImprovePromptResult | null> => ipcRenderer.invoke(IPC.scriptingImprove, input)
  },
  media: {
    pickFile: (kind: 'image' | 'video' | 'audio'): Promise<{ name: string; path: string } | null> =>
      ipcRenderer.invoke(IPC.mediaPickFile, kind),
    import: (
      kind: 'image' | 'video' | 'audio'
    ): Promise<{ name: string; src: string; mediaType: 'image' | 'video' | 'audio' } | null> =>
      ipcRenderer.invoke(IPC.mediaImport, kind),
    importUrl: (
      url: string
    ): Promise<{ name: string; src: string | null; error: string | null } | null> =>
      ipcRenderer.invoke(IPC.mediaImportUrl, url)
  },
  generate: {
    run: (params: GenerationParams): Promise<GenerationResult | null> =>
      ipcRenderer.invoke(IPC.generateRun, params)
  },
  cutRoom: {
    export: (spec: TimelineExportSpec): Promise<CutExportResult | null> =>
      ipcRenderer.invoke(IPC.cutRoomExport, spec)
  },
  chatRealty: {
    status: (): Promise<{ connected: boolean } | null> => ipcRenderer.invoke(IPC.chatRealtyStatus),
    pull: (query: string): Promise<ChatRealtyPullResult | null> =>
      ipcRenderer.invoke(IPC.chatRealtyPull, query)
  },
  connectors: {
    list: (): Promise<ConnectorView[]> => ipcRenderer.invoke(IPC.connectorsList),
    save: (def: ConnectorDef): Promise<void> => ipcRenderer.invoke(IPC.connectorsSave, def),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.connectorsDelete, id),
    test: (id: string): Promise<ConnectorTestResult | null> =>
      ipcRenderer.invoke(IPC.connectorsTest, id),
    suggestions: (): Promise<ConnectorSuggestion[]> => ipcRenderer.invoke(IPC.connectorsSuggestions),
    addSuggestion: (id: string): Promise<ConnectorDef | null> =>
      ipcRenderer.invoke(IPC.connectorsAddSuggestion, id),
    openKeyPage: (id: string): Promise<void> => ipcRenderer.invoke(IPC.connectorsOpenKeyPage, id),
    oauthConnect: (id: string): Promise<{ ok: boolean; error?: string } | null> =>
      ipcRenderer.invoke(IPC.connectorsOauthConnect, id)
  },
  modelProviders: {
    list: (): Promise<ModelProviderView[]> => ipcRenderer.invoke(IPC.modelProvidersList),
    save: (def: ModelProviderDef): Promise<void> => ipcRenderer.invoke(IPC.modelProvidersSave, def),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.modelProvidersDelete, id),
    setActive: (id: string): Promise<void> => ipcRenderer.invoke(IPC.modelProvidersSetActive, id)
  },
  secrets: {
    request: (request: SecretRequest): Promise<SecretReport | null> =>
      ipcRenderer.invoke(IPC.secretRequest, request),
    list: (): Promise<SecretReport[]> => ipcRenderer.invoke(IPC.secretList),
    delete: (connectorId: string): Promise<void> => ipcRenderer.invoke(IPC.secretDelete, connectorId)
  }
}

export type LymeApi = typeof api

contextBridge.exposeInMainWorld('lyme', api)
