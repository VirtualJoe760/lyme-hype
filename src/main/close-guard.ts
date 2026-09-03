import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'

/**
 * Don't let paid work leave the building unnoticed.
 *
 * A generated take lives in the node panel's staging area until "Finish → add to
 * canvas" commits it. Those takes cost real money at the connector, so closing
 * the app with uncommitted ones is exactly the moment to speak up — the user
 * asked for this after losing sight of a render (2026-08-31). The renderer keeps
 * this count current; the window's close event consults it.
 */

let uncommitted = 0

export function setUncommittedCount(count: number): void {
  uncommitted = Math.max(0, count)
}

export function attachCloseGuard(window: BrowserWindow): void {
  let confirmed = false

  window.on('close', (event) => {
    if (confirmed || uncommitted === 0) return
    event.preventDefault()

    const many = uncommitted !== 1
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Add to canvas & close', 'Close anyway', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `${uncommitted} generated take${many ? 's are' : ' is'} not on your canvas yet.`,
      detail:
        'These renders cost real money. Adding them to the canvas keeps them with your session as normal nodes.\n\nClosing anyway keeps the files — you can always bring them back from ⟲ Recent generations.'
    })

    if (choice === 2) return // Cancel — stay open
    if (choice === 1) {
      confirmed = true
      window.close()
      return
    }

    // Commit everything staged, then close once the renderer says it's done.
    ipcMain.once(IPC.stagesCommitted, () => {
      confirmed = true
      if (!window.isDestroyed()) window.close()
    })
    window.webContents.send(IPC.stagesCommitAll)
    // Never hang the close on a renderer that can't answer.
    setTimeout(() => {
      if (!confirmed && !window.isDestroyed()) {
        confirmed = true
        window.close()
      }
    }, 4000)
  })
}
