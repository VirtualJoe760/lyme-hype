import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { SecretReport, SecretRequest } from '@shared/types'
import { storeSecret } from './credential-vault'

interface PendingRequest {
  request: SecretRequest
  webContentsId: number
  resolve: (report: SecretReport | null) => void
  settled: boolean
}

const pending = new Map<string, PendingRequest>()

/**
 * Opens the native secure-credential modal — the ONLY path in the app that
 * collects a secret. The value travels modal -> main over one IPC channel,
 * is encrypted via safeStorage, and only the reporting contract (field label,
 * length, last 4) ever goes back to the renderer or the agent.
 */
export function requestSecret(
  parent: BrowserWindow,
  request: SecretRequest
): Promise<SecretReport | null> {
  return new Promise((resolve) => {
    const rid = randomUUID()

    const modal = new BrowserWindow({
      parent,
      modal: true,
      width: 460,
      height: 340,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      backgroundColor: '#1D2023',
      webPreferences: {
        preload: join(__dirname, '../preload/secure.js'),
        additionalArguments: [`--lyme-rid=${rid}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    pending.set(rid, {
      request,
      webContentsId: modal.webContents.id,
      resolve,
      settled: false
    })

    modal.on('ready-to-show', () => modal.show())
    modal.on('closed', () => {
      const entry = pending.get(rid)
      if (entry && !entry.settled) {
        entry.settled = true
        entry.resolve(null)
      }
      pending.delete(rid)
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      modal.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/secure.html`)
    } else {
      modal.loadFile(join(__dirname, '../renderer/secure.html'))
    }
  })
}

function lookupForSender(rid: string, senderId: number): PendingRequest | null {
  const entry = pending.get(rid)
  if (!entry || entry.webContentsId !== senderId) return null
  return entry
}

export function registerSecureCredentialIpc(): void {
  ipcMain.handle(IPC.secureInit, (event, rid: string) => {
    const entry = lookupForSender(rid, event.sender.id)
    if (!entry) return null
    return {
      connectorName: entry.request.connectorName,
      fieldLabel: entry.request.fieldLabel
    }
  })

  ipcMain.handle(IPC.secureSubmit, (event, rid: string, value: string) => {
    const entry = lookupForSender(rid, event.sender.id)
    if (!entry || entry.settled) return false
    if (typeof value !== 'string' || value.length === 0) return false

    const report = storeSecret(entry.request.connectorId, entry.request.fieldLabel, value)
    entry.settled = true
    entry.resolve(report)
    BrowserWindow.fromWebContents(event.sender)?.close()
    return true
  })

  ipcMain.on(IPC.secureCancel, (event, rid: string) => {
    const entry = lookupForSender(rid, event.sender.id)
    if (entry && !entry.settled) {
      entry.settled = true
      entry.resolve(null)
    }
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
