import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'

/**
 * Window geometry across restarts. Kept out of `sessions.json` on purpose: it is
 * machine-local chrome, not project content — a project copied to another machine
 * shouldn't drag a window position from a monitor that machine doesn't have.
 */
interface WindowState {
  bounds?: Rectangle
  maximized?: boolean
}

const DEFAULT_SIZE = { width: 1440, height: 900 }
const MIN_SIZE = { width: 1080, height: 700 }

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function read(): WindowState {
  try {
    const file = stateFile()
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as WindowState) : {}
  } catch {
    return {}
  }
}

function write(state: WindowState): void {
  try {
    const file = stateFile()
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, file)
  } catch {
    /* geometry is a convenience; never let it break startup or shutdown */
  }
}

/**
 * Saved bounds are only honoured if they still land on a display that exists — a
 * window restored onto a disconnected second monitor is invisible and looks like the
 * app failed to launch.
 */
function visibleOn(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x))
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y))
    return overlapX > 120 && overlapY > 80
  })
}

export function restoredWindowOptions(): {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
} {
  const state = read()
  const bounds = state.bounds
  if (bounds && visibleOn(bounds)) {
    return {
      width: Math.max(bounds.width, MIN_SIZE.width),
      height: Math.max(bounds.height, MIN_SIZE.height),
      x: bounds.x,
      y: bounds.y,
      maximized: !!state.maximized
    }
  }
  return { ...DEFAULT_SIZE, maximized: !!state.maximized }
}

/**
 * `getBounds()` on a maximized window returns the maximized rectangle, which would
 * make un-maximizing restore to full screen forever — so the normal bounds are what
 * gets stored, and the maximized flag is carried separately.
 */
export function trackWindowState(window: BrowserWindow): void {
  const save = (): void => {
    if (window.isDestroyed()) return
    write({ bounds: window.getNormalBounds(), maximized: window.isMaximized() })
  }

  let timer: NodeJS.Timeout | null = null
  const saveSoon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }

  window.on('resize', saveSoon)
  window.on('move', saveSoon)
  window.on('maximize', save)
  window.on('unmaximize', save)
  window.on('close', save)
}
