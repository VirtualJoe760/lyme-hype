import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  ConnectorDef,
  GenerationParams,
  ModelProviderDef,
  PersistedState,
  SecretRequest,
  TimelineExportClip
} from '@shared/types'
import { importFileAsset, importUrlAsset, mediaTypeForPath } from './asset-store'
import { runAgentPrompt } from './agent'
import { exportTimeline } from './ffmpeg'
import { runGeneration } from './generation'
import { startOAuthConnect } from './mcp-oauth'
import { claudeAuthOverrideKind } from './claude-auth'
import { hasChatRealtyToken, pullListingPhotos } from './chatrealty'
import { deleteConnector, installedConnectorIds, listConnectors, saveConnector, testConnector } from './connectors-store'
import { addSuggestion, listSuggestions, openSuggestionKeyPage } from './connector-suggestions'
import { deleteSecret, listSecretReports } from './credential-vault'
import {
  deleteModelProvider,
  listModelProviders,
  saveModelProvider,
  setActiveModelProvider
} from './model-providers'
import { registerSecureCredentialIpc, requestSecret } from './secure-credential'
import { loadState, saveState } from './sessions-store'

const FILE_FILTERS: Record<string, Electron.FileFilter[]> = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  video: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
}

let handlersRegistered = false
// Rebindable so the macOS activate path (which creates a fresh window after the
// first one is closed) retargets every handler instead of leaving them closed
// over a destroyed window. Handlers still register exactly once — re-running
// ipcMain.handle for the same channel throws.
let mainWindow: BrowserWindow | null = null

function isMainSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    event.sender.id === mainWindow.webContents.id
  )
}

export function registerIpc(window: BrowserWindow): void {
  mainWindow = window

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on(IPC.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(IPC.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(IPC.sessionsLoad, (e) => (isMainSender(e) ? loadState() : null))
  ipcMain.handle(IPC.sessionsSave, (e, state: PersistedState) => {
    if (!isMainSender(e)) return
    saveState(state)
  })
  // Synchronous companion for the beforeunload flush — the renderer is being
  // torn down, so it can't await an async save. sendSync blocks until saveState
  // (itself synchronous) returns.
  ipcMain.on(IPC.sessionsSaveSync, (e, state: PersistedState) => {
    if (isMainSender(e)) saveState(state)
    e.returnValue = true
  })

  ipcMain.handle(IPC.claudeStatus, (e) => (isMainSender(e) ? { override: claudeAuthOverrideKind() } : null))

  ipcMain.handle(IPC.agentPing, async (e, prompt: string) => {
    if (!isMainSender(e)) return null
    const target = mainWindow
    return runAgentPrompt(prompt, (event) => {
      if (target && !target.isDestroyed()) {
        target.webContents.send(IPC.agentStream, event)
      }
    })
  })

  ipcMain.handle(IPC.mediaPickFile, async (e, kind: string) => {
    if (!isMainSender(e) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    return { name, path: filePath }
  })

  ipcMain.handle(IPC.mediaImport, async (e, kind: string) => {
    if (!isMainSender(e) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    const saved = importFileAsset(filePath)
    return { name, src: saved.url, mediaType: mediaTypeForPath(filePath) ?? kind }
  })

  ipcMain.handle(IPC.mediaImportUrl, async (e, url: string) => {
    if (!isMainSender(e)) return null
    try {
      const saved = await importUrlAsset(url)
      const tail = new URL(url).pathname.split('/').filter(Boolean).pop()
      return { name: tail || new URL(url).hostname, src: saved.url, error: null }
    } catch (err) {
      return { name: '', src: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.generateRun, (e, params: GenerationParams) => {
    if (!isMainSender(e)) return null
    return runGeneration(params)
  })

  ipcMain.handle(IPC.cutRoomExport, async (e, clips: TimelineExportClip[]) => {
    if (!isMainSender(e) || !mainWindow) return null
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Export timeline',
      defaultPath: 'lyme-cut.mp4',
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    return exportTimeline(clips, picked.filePath)
  })

  ipcMain.handle(IPC.chatRealtyStatus, (e) => (isMainSender(e) ? { connected: hasChatRealtyToken() } : null))
  ipcMain.handle(IPC.chatRealtyPull, (e, query: string) => {
    if (!isMainSender(e)) return null
    return pullListingPhotos(typeof query === 'string' ? query : '')
  })

  ipcMain.handle(IPC.connectorsList, (e) => (isMainSender(e) ? listConnectors() : []))
  ipcMain.handle(IPC.connectorsSave, (e, def: ConnectorDef) => {
    if (!isMainSender(e)) return
    saveConnector(def)
  })
  ipcMain.handle(IPC.connectorsDelete, (e, id: string) => {
    if (!isMainSender(e)) return
    deleteConnector(id)
  })
  ipcMain.handle(IPC.connectorsTest, (e, id: string) => {
    if (!isMainSender(e)) return null
    return testConnector(id)
  })
  ipcMain.handle(IPC.connectorsSuggestions, (e) =>
    isMainSender(e) ? listSuggestions(installedConnectorIds()) : []
  )
  ipcMain.handle(IPC.connectorsAddSuggestion, (e, id: string) => {
    if (!isMainSender(e)) return null
    return addSuggestion(id)
  })
  ipcMain.handle(IPC.connectorsOpenKeyPage, (e, id: string) => {
    if (!isMainSender(e)) return
    openSuggestionKeyPage(id)
  })
  ipcMain.handle(IPC.connectorsOauthConnect, async (e, id: string) => {
    if (!isMainSender(e)) return null
    const def = listConnectors().find((c) => c.id === id)
    if (!def || def.authType !== 'oauth' || !def.url) {
      return { ok: false, error: 'Not an OAuth http connector.' }
    }
    try {
      await startOAuthConnect(def.id, def.url)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.modelProvidersList, (e) => (isMainSender(e) ? listModelProviders() : []))
  ipcMain.handle(IPC.modelProvidersSave, (e, def: ModelProviderDef) => {
    if (!isMainSender(e)) return
    saveModelProvider(def)
  })
  ipcMain.handle(IPC.modelProvidersDelete, (e, id: string) => {
    if (!isMainSender(e)) return
    deleteModelProvider(id)
  })
  ipcMain.handle(IPC.modelProvidersSetActive, (e, id: string) => {
    if (!isMainSender(e)) return
    setActiveModelProvider(id)
  })

  ipcMain.handle(IPC.secretRequest, (e, request: SecretRequest) => {
    if (!isMainSender(e) || !mainWindow) return null
    return requestSecret(mainWindow, request)
  })
  ipcMain.handle(IPC.secretList, (e) => (isMainSender(e) ? listSecretReports() : []))
  ipcMain.handle(IPC.secretDelete, (e, connectorId: string) => {
    if (!isMainSender(e)) return
    deleteSecret(connectorId)
  })

  registerSecureCredentialIpc()
}
