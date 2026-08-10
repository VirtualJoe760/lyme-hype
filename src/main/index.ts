import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { registerAssetProtocol, registerAssetSchemePrivileges } from './asset-store'
import { reconcileInstalledConnectors } from './connector-suggestions'
import { registerIpc } from './ipc'
import { runSelfTest } from './selftest'
import { restoredWindowOptions, trackWindowState } from './window-state'

// Must run before app is ready — privileged custom schemes register at this point.
registerAssetSchemePrivileges()

// Without an explicit AppUserModelId, Windows attributes the running process to
// electron.exe — the taskbar shows Electron's icon and won't group the window
// with the Start-menu shortcut that launched it.
const APP_USER_MODEL_ID = 'com.josephsardella.lymehype'

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../resources/icon.ico')
}

/**
 * Lyme Hype's own documents (studio + secure modal) are the only navigation
 * targets any window may load. A dropped file/link, a stray window.open, or a
 * spoofed page must never navigate a window that carries the privileged preload
 * (window.lyme / secureBridge) — that would hand the whole bridge, including the
 * credential flow, to arbitrary content. Enforced app-wide so it covers the
 * main window, the secure modal, and anything created later.
 */
function isOwnAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  try {
    // Origin comparison, not a prefix match: startsWith(devUrl) would also accept
    // http://localhost:5173@evil.com and http://localhost:51730 as "own app".
    if (devUrl && new URL(url).origin === new URL(devUrl).origin) return true
  } catch {
    return false
  }
  if (url.startsWith('file://')) return true
  return false
}

function hardenNavigation(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isOwnAppUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isOwnAppUrl(url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      // External links open in the user's real browser; nothing opens a new
      // Electron window carrying our preload.
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

function createMainWindow(): BrowserWindow {
  const restored = restoredWindowOptions()
  const window = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x !== undefined && restored.y !== undefined
      ? { x: restored.x, y: restored.y }
      : {}),
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    icon: appIconPath(),
    backgroundColor: '#15171A',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (restored.maximized) window.maximize()
  trackWindowState(window)

  window.on('ready-to-show', () => window.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function focusExistingWindow(): void {
  const [existing] = BrowserWindow.getAllWindows()
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.focus()
}

// Launching from the Start menu while the app is already open must raise the
// running window, not boot a second studio against the same sessions store.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusExistingWindow)

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID)
    hardenNavigation()
    registerAssetProtocol()
    // Boot-time heal so generation and direct tool calls see every connector
    // whose credential exists, even if its def went missing (selftest cleanup
    // used to delete real defs and leave the key).
    reconcileInstalledConnectors()

    const mainWindow = createMainWindow()
    registerIpc(mainWindow)

    if (process.env['LYME_SELFTEST']) {
      mainWindow.webContents.once('did-finish-load', () => void runSelfTest(mainWindow))
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const win = createMainWindow()
        registerIpc(win)
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
