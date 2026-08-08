import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  AgentPingResult,
  AgentStreamEvent,
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
    save: (state: PersistedState): Promise<void> => ipcRenderer.invoke(IPC.sessionsSave, state)
  },
  agent: {
    ping: (prompt: string): Promise<AgentPingResult | null> =>
      ipcRenderer.invoke(IPC.agentPing, prompt),
    onStream: (callback: (event: AgentStreamEvent) => void): (() => void) => {
      const listener = (_: unknown, event: AgentStreamEvent): void => callback(event)
      ipcRenderer.on(IPC.agentStream, listener)
      return () => ipcRenderer.removeListener(IPC.agentStream, listener)
    }
  },
  media: {
    pickFile: (kind: 'image' | 'video' | 'audio'): Promise<{ name: string; path: string } | null> =>
      ipcRenderer.invoke(IPC.mediaPickFile, kind)
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
