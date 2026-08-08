import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PersistedState, SecretRequest } from '@shared/types'
import { runAgentPrompt } from './agent'
import { deleteSecret, listSecretReports } from './credential-vault'
import { registerSecureCredentialIpc, requestSecret } from './secure-credential'
import { loadState, saveState } from './sessions-store'

const FILE_FILTERS: Record<string, Electron.FileFilter[]> = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  video: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
}

let registered = false

export function registerIpc(mainWindow: BrowserWindow): void {
  if (registered) return
  registered = true

  const fromMainWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id

  ipcMain.on(IPC.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(IPC.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(IPC.sessionsLoad, (e) => (fromMainWindow(e) ? loadState() : null))
  ipcMain.handle(IPC.sessionsSave, (e, state: PersistedState) => {
    if (!fromMainWindow(e)) return
    saveState(state)
  })

  ipcMain.handle(IPC.agentPing, async (e, prompt: string) => {
    if (!fromMainWindow(e)) return null
    return runAgentPrompt(prompt, (event) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.agentStream, event)
      }
    })
  })

  ipcMain.handle(IPC.mediaPickFile, async (e, kind: string) => {
    if (!fromMainWindow(e)) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    return { name, path: filePath }
  })

  ipcMain.handle(IPC.secretRequest, (e, request: SecretRequest) => {
    if (!fromMainWindow(e)) return null
    return requestSecret(mainWindow, request)
  })
  ipcMain.handle(IPC.secretList, (e) => (fromMainWindow(e) ? listSecretReports() : []))
  ipcMain.handle(IPC.secretDelete, (e, connectorId: string) => {
    if (!fromMainWindow(e)) return
    deleteSecret(connectorId)
  })

  registerSecureCredentialIpc()
}
