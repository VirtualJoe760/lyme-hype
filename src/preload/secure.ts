import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'

// The request id arrives via webPreferences.additionalArguments — no reliance
// on the page URL, and no DOM types needed in the preload.
function requestId(): string {
  const arg = process.argv.find((a) => a.startsWith('--lyme-rid='))
  return arg ? arg.slice('--lyme-rid='.length) : ''
}

// The secure modal's entire world: fetch its labels, submit once, or cancel.
// The studio renderer never gets this bridge — only the modal window loads it.
contextBridge.exposeInMainWorld('secureBridge', {
  init: (): Promise<{ connectorName: string; fieldLabel: string } | null> =>
    ipcRenderer.invoke(IPC.secureInit, requestId()),
  submit: (value: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.secureSubmit, requestId(), value),
  cancel: (): void => ipcRenderer.send(IPC.secureCancel, requestId())
})
