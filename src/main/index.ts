import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { registerAssetProtocol, registerAssetSchemePrivileges } from './asset-store'
import { rebuildIfStale } from './build-info'
import { installConsoleMirror, startBootLog } from './boot-log'
import { rekeyFromEnvFile } from './recover-userdata'
import { consolidateUserData } from './userdata-location'
import { reconcileInstalledConnectors } from './connector-suggestions'
import { attachComfyUI, stopComfyUI } from './comfyui-host'
import { attachCloseGuard } from './close-guard'
import { registerIpc } from './ipc'
import { startMcpHub, stopMcpHub } from './mcp-hub'
import { runSelfTest } from './selftest'
import { runConnectorProbe, runCredentialImport } from './utils/credential-import'
import { runFeatureTests } from './utils/test-runner'
import { restoredWindowOptions, trackWindowState } from './window-state'

// Both must run before app is ready, and this one runs FIRST: every path below
// resolves against userData, so it has to be settled before anything reads it.
consolidateUserData()

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
  attachCloseGuard(window)

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

// Headless backend mode (`electron . --mcp`): no window, no IPC. It is spawned
// by a bridge with every stdio stream ignored, so its diagnostics go to
// boot.log (console mirror) — stdout has nothing on the other end.
const isMcpServer = process.argv.includes('--mcp') || !!process.env['LYME_MCP']
if (isMcpServer) {
  console.log = (...args: unknown[]): void => {
    process.stderr.write(args.map(String).join(' ') + '\n')
  }
  app.whenReady().then(() => {
    startBootLog()
    installConsoleMirror()
    registerAssetProtocol()
    reconcileInstalledConnectors()
    void startMcpHub('headless')
  })
}

// Launching from the Start menu while the app is already open must raise the
// running window, not boot a second studio against the same sessions store.
//
// The headless checks are exempt: they are a separate short-lived process, and
// without this exemption `LYME_SELFTEST=1 npm run dev` silently quits whenever the
// real app happens to be open — it looks like the harness produced no output.
const importConnector = process.env['LYME_IMPORT_CONNECTOR']
const importEnvFile = process.env['LYME_IMPORT_ENVFILE']
const isHeadlessCheck = !!process.env['LYME_SELFTEST']
if (isMcpServer) {
  // handled above — never boot the studio window in server mode
} else if (importConnector) {
  app.whenReady().then(() => runCredentialImport(importConnector, importEnvFile))
} else if (process.env['LYME_PROBE_CONNECTOR']) {
  const probeId = process.env['LYME_PROBE_CONNECTOR']
  app.whenReady().then(() => void runConnectorProbe(probeId))
} else if (process.env['LYME_TEST']) {
  // Feature tests are main-process work — booting the renderer here loaded the
  // shared sessions.json into a second store instance whose write could clobber
  // the REAL app's session (observed 2026-08-31: a rename lost to a stale
  // harness write). No window, no renderer, no store, no writes.
  const spec = process.env['LYME_TEST']
  app.whenReady().then(() => {
    registerAssetProtocol()
    reconcileInstalledConnectors()
    void runFeatureTests(spec)
  })
} else if (!isHeadlessCheck && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (!isHeadlessCheck) app.on('second-instance', focusExistingWindow)

  app.whenReady().then(() => {
    // Before anything else: never hand over a window running code that has
    // already been changed. Returns true when it is restarting into the new
    // build, in which case there is nothing left to do here.
    startBootLog()
    installConsoleMirror()
    if (rebuildIfStale()) return
    app.setAppUserModelId(APP_USER_MODEL_ID)
    hardenNavigation()
    registerAssetProtocol()
    // Boot-time heal so generation and direct tool calls see every connector
    // whose credential exists, even if its def went missing (selftest cleanup
    // used to delete real defs and leave the key).
    reconcileInstalledConnectors()
    // Runs after reconcile so it sees the real installed set, and after the
    // adopt step so it only re-keys what genuinely cannot be decrypted here.
    rekeyFromEnvFile()

    const mainWindow = createMainWindow()
    registerIpc(mainWindow)
    // Neither is awaited: the studio opens now. ComfyUI is only ATTACHED here
    // (started on demand by the first local generation); the status strip
    // narrates whatever it is doing. The MCP hub makes this window the one
    // backend every Claude Code session talks to while it is open.
    void attachComfyUI()
    void startMcpHub('studio')

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

// Closing the app leaves nothing of ours running — chiefly ComfyUI, which
// would otherwise sit on ~12 GB of models long after the window is gone. Both
// hooks, because before-quit fires on paths where will-quit has been observed
// not to (stopComfyUI is idempotent).
app.on('before-quit', stopComfyUI)
app.on('will-quit', stopComfyUI)
// Dropping the pipe is what lets the bridges spawn a headless backend again.
app.on('before-quit', stopMcpHub)
app.on('will-quit', stopMcpHub)
