import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AgentPingResult,
  AgentStreamEvent,
  ChatRealtyPullResult,
  ConnectorDef,
  ConnectorTestResult,
  ConnectorView,
  PersistedState,
  SecretReport,
  SecretRequest
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
    claudeStatus: (): Promise<{ hasKey: boolean } | null> => ipcRenderer.invoke(IPC.claudeStatus)
  },
  media: {
    pickFile: (kind: 'image' | 'video' | 'audio'): Promise<{ name: string; path: string } | null> =>
      ipcRenderer.invoke(IPC.mediaPickFile, kind)
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
      ipcRenderer.invoke(IPC.connectorsTest, id)
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
