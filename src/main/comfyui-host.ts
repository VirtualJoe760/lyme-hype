import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { ComfyState } from '@shared/types'
import { listConnectors } from './connectors-store'
import { watchProcessMemory, type MemorySample } from './comfyui-watchdog'

/**
 * The app owns ComfyUI's lifecycle — on demand, not always-on.
 *
 * The wrapper (resources/comfyui-mcp.cjs) is spawned per generation by the
 * Agent SDK and is gone seconds later, so it could only ever start ComfyUI
 * DETACHED and leave a pid file for the app to find at quit. That file lived in
 * %TEMP% — a folder Windows virtualizes per launcher — so a server started
 * under one launcher was invisible to the app closed under another, and 12 GB
 * of models outlived the window. The machine OOM'd (2026-09-01). Since then
 * main starts the server itself, as a real child with piped output, streams its
 * state to the status strip, and kills the process tree on quit.
 *
 * Since 2026-09-02 it is no longer started at boot either. It starts on the
 * first local image generation (`ensureComfyUI`), stops again after ten idle
 * minutes, and a memory watchdog asks it to unload — then kills it — when it
 * grows past LYME_COMFY_MAX_GB (default 20) or leaves the machine under 1.5 GB
 * free. The trigger: another tool queued LoRA jobs into this server, it
 * reached 43 GB committed on a 32 GB machine, everything paged, and the app
 * had no idea. A server the user started themselves is attached, never
 * watched, never killed.
 */

const PID_FILE_NAME = 'comfyui.pid'
const READY_POLL_MS = 1000
const READY_TIMEOUT_MS = 180_000
/** Must match resources/comfyui-mcp.cjs — that is also the orphan fingerprint. */
const OUR_FLAGS = ['--disable-all-custom-nodes', '--highvram', '--cache-none']
const GB = 1024 ** 3
const IDLE_STOP_MS = Number(process.env['LYME_COMFY_IDLE_MIN'] ?? 10) * 60_000
const MAX_BYTES = Number(process.env['LYME_COMFY_MAX_GB'] ?? 20) * GB
const MIN_FREE_BYTES = 1.5 * GB
const WATCH_INTERVAL_MS = 10_000
const WATCH_STRIKES = 3

interface ComfyConfig {
  url: string
  path: string | null
  python: string | null
}

let child: ChildProcess | null = null
let state: ComfyState = {
  phase: 'off',
  detail: 'not started',
  owned: false,
  updatedAt: new Date().toISOString()
}
let idleTimer: ReturnType<typeof setTimeout> | null = null
let stopWatch: (() => void) | null = null
let starting: Promise<boolean> | null = null

export function comfyState(): ComfyState {
  return state
}

export function comfyPidFile(): string {
  return join(app.getPath('userData'), PID_FILE_NAME)
}

function publish(patch: Partial<ComfyState>): void {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.comfyStream, state)
  }
}

function readConfig(): ComfyConfig | null {
  const def = listConnectors().find((c) => c.id === 'comfyui')
  if (!def) return null
  const env = def.env ?? {}
  return {
    url: env['COMFYUI_URL'] ?? 'http://127.0.0.1:8188',
    path: env['COMFYUI_PATH'] ?? null,
    python: env['COMFYUI_PYTHON'] ?? null
  }
}

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/system_stats`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** True when a job is running or queued — including one queued by someone else. */
async function queueBusy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/queue`, { signal: AbortSignal.timeout(3000) })
    const q = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] }
    return (q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0) > 0
  } catch {
    return true // cannot tell — never stop a server that might be mid-job
  }
}

function fmtGb(s: MemorySample): string {
  return `${(s.privateBytes / GB).toFixed(1)} GB used, ${(s.systemFreeBytes / GB).toFixed(1)} GB free`
}

/** Reads what ComfyUI prints and turns it into a phase the studio can show. */
function ingestLine(raw: string): void {
  // ComfyUI colours its logger output; the escape codes would otherwise reach
  // the status strip verbatim (seen live: "␛[32m[INFO]␛[0m To see the GUI…").
  const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim()
  if (!line) return
  let patch: Partial<ComfyState> = { detail: line.slice(0, 160) }
  const load = /Requested to load (\S+)/.exec(line)
  if (load) patch = { ...patch, phase: 'loading', model: load[1] }
  else if (/loaded (completely|partially)/.test(line)) patch = { ...patch, phase: 'ready' }
  else if (/To see the GUI go to|Starting server/.test(line)) patch = { ...patch, phase: 'ready' }
  else if (/Prompt executed in/.test(line)) {
    patch = { ...patch, phase: 'ready' }
    touchActivity()
  } else if (/Traceback|Error:|RuntimeError|OutOfMemory/.test(line)) patch = { ...patch, phase: 'error' }
  publish(patch)
}

function waitReady(url: string): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      void (async () => {
        if (!child) {
          clearInterval(timer)
          resolve(false)
        } else if (await isUp(url)) {
          clearInterval(timer)
          if (state.phase === 'starting') publish({ phase: 'ready', detail: `listening at ${url}` })
          resolve(true)
        } else if (Date.now() > deadline) {
          clearInterval(timer)
          if (state.phase === 'starting') publish({ phase: 'error', detail: 'did not come up within 3 minutes' })
          resolve(false)
        }
      })()
    }, READY_POLL_MS)
  })
}

/** The pid listening on the configured port, and whether its command line is ours. */
function listeningOwner(url: string): { pid: number; ours: boolean } | null {
  const port = new URL(url).port || '8188'
  const net = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8', timeout: 5000, windowsHide: true })
  const row = (net.stdout ?? '').split('\n').find((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
  const pid = row ? Number(row.trim().split(/\s+/).pop()) : NaN
  if (!Number.isFinite(pid) || pid <= 0) return null
  const cim = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
    { encoding: 'utf-8', timeout: 8000, windowsHide: true }
  )
  const cmd = cim.stdout ?? ''
  return { pid, ours: cmd.includes('main.py') && OUR_FLAGS.every((f) => cmd.includes(f)) }
}

function killTree(pid: number, why: string): void {
  const res = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
    encoding: 'utf-8',
    timeout: 8000,
    windowsHide: true
  })
  const note = res.status === 0 ? '' : ` — taskkill said: ${(res.stdout || res.stderr || '').trim()}`
  console.log(`[comfyui] stopped pid ${pid} (${why})${note}`)
}

function clearTimers(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  stopWatch?.()
  stopWatch = null
}

/** Something used the server: push the idle stop out again. */
function touchActivity(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (!state.owned || IDLE_STOP_MS <= 0) return
  idleTimer = setTimeout(() => void stopIfIdle(), IDLE_STOP_MS)
  publish({ idleStopsAt: new Date(Date.now() + IDLE_STOP_MS).toISOString() })
}

async function stopIfIdle(): Promise<void> {
  const cfg = readConfig()
  if (!cfg || !state.owned) return
  if (await queueBusy(cfg.url)) {
    touchActivity()
    return
  }
  stopServer(
    `stopped after ${IDLE_STOP_MS / 60_000} idle minutes — starts again on the next local generation`,
    'off'
  )
}

function stopServer(why: string, phase: ComfyState['phase']): void {
  const pid = child?.pid ?? state.pid
  clearTimers()
  child = null
  if (pid) killTree(pid, why)
  try {
    if (existsSync(comfyPidFile())) unlinkSync(comfyPidFile())
  } catch {
    /* best effort */
  }
  publish({
    phase,
    detail: why,
    owned: false,
    pid: undefined,
    model: undefined,
    memGb: undefined,
    idleStopsAt: undefined
  })
}

function armWatchdog(pid: number, url: string): void {
  stopWatch?.()
  stopWatch = watchProcessMemory({
    pid,
    limitBytes: MAX_BYTES,
    minFreeBytes: MIN_FREE_BYTES,
    intervalMs: WATCH_INTERVAL_MS,
    strikes: WATCH_STRIKES,
    onSample: (s) => publish({ memGb: s.privateBytes / GB }),
    onRelieve: (s) => {
      console.log(`[comfyui] over budget (${fmtGb(s)}) — asking it to unload models`)
      publish({ detail: `memory ${fmtGb(s)} — unloading models` })
      void fetch(`${url}/api/free`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {
        /* a server that cannot answer is what the next strike is for */
      })
    },
    onKill: (s) => {
      console.log(`[comfyui] still over budget after ${WATCH_STRIKES} checks (${fmtGb(s)}) — killing it`)
      stopServer(
        `killed at ${fmtGb(s)} to protect the machine (limit ${MAX_BYTES / GB} GB, floor ${MIN_FREE_BYTES / GB} GB free) — starts again on demand`,
        'error'
      )
    }
  })
}

function own(pid: number, url: string): void {
  try {
    writeFileSync(comfyPidFile(), String(pid))
  } catch {
    /* the child handle is the real owner; the file is for a later boot */
  }
  armWatchdog(pid, url)
  touchActivity()
}

/**
 * Boot: attach to a server that is already up (adopting an orphan of our own),
 * otherwise stay off. Never spawns — that is `ensureComfyUI`'s job, on demand.
 */
export async function attachComfyUI(): Promise<void> {
  const cfg = readConfig()
  if (!cfg) return
  if (!(await isUp(cfg.url))) {
    publish({ phase: 'off', detail: 'idle — starts on the first local generation', owned: false })
    return
  }
  const owner = listeningOwner(cfg.url)
  if (owner?.ours) {
    publish({
      phase: 'ready',
      detail: `adopted a server this app started earlier (pid ${owner.pid})`,
      owned: true,
      pid: owner.pid
    })
    own(owner.pid, cfg.url)
  } else {
    publish({
      phase: 'ready',
      detail: `attached to a ComfyUI you started (pid ${owner?.pid ?? '?'}) — it stays yours`,
      owned: false,
      pid: owner?.pid
    })
  }
}

/**
 * Make sure a server is answering before a local generation, starting one if
 * needed. Resolves true once it is up; false when it cannot be started (no
 * spawn path configured, or it did not come up in time).
 */
export async function ensureComfyUI(): Promise<boolean> {
  if (process.env['LYME_COMFY_AUTOSTART'] === '0') return false
  const cfg = readConfig()
  if (!cfg) return false
  if (await isUp(cfg.url)) {
    if (state.phase === 'off') await attachComfyUI()
    touchActivity()
    return true
  }
  if (starting) return starting
  if (!cfg.path || !cfg.python) {
    publish({ phase: 'off', detail: 'ComfyUI not reachable and no spawn path configured', owned: false })
    return false
  }
  starting = spawnServer(cfg).finally(() => {
    starting = null
  })
  return starting
}

async function spawnServer(cfg: ComfyConfig): Promise<boolean> {
  const port = new URL(cfg.url).port || '8188'
  publish({ phase: 'starting', detail: `starting ${cfg.python} main.py …`, owned: true })
  const proc = spawn(cfg.python!, ['main.py', '--listen', '127.0.0.1', '--port', port, ...OUR_FLAGS], {
    cwd: cfg.path!,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  child = proc
  publish({ pid: proc.pid })
  console.log(`[comfyui] started pid ${proc.pid} with ${OUR_FLAGS.join(' ')}`)

  const onData = (buf: Buffer): void => {
    for (const line of buf.toString('utf-8').split(/\r?\n/)) ingestLine(line)
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  proc.on('exit', (code) => {
    if (child !== proc) return // already replaced or stopped deliberately
    child = null
    clearTimers()
    publish({
      phase: 'off',
      detail: `exited (code ${code ?? 'signal'})`,
      owned: false,
      pid: undefined,
      memGb: undefined,
      idleStopsAt: undefined
    })
  })

  const ready = await waitReady(cfg.url)
  if (ready && proc.pid) own(proc.pid, cfg.url)
  return ready
}

/**
 * Leave nothing running. Three independent routes, all cheap, because the one
 * that failed before was the only one there was.
 */
export function stopComfyUI(): void {
  clearTimers()
  const stopped = new Set<number>()
  if (child?.pid && !child.killed) {
    killTree(child.pid, 'our child')
    stopped.add(child.pid)
    child = null
  }
  for (const file of [comfyPidFile(), join(tmpdir(), 'lyme-hype-comfyui.pid')]) {
    try {
      if (!existsSync(file)) continue
      const pid = Number(readFileSync(file, 'utf-8').trim())
      unlinkSync(file)
      if (Number.isFinite(pid) && pid > 0 && !stopped.has(pid)) {
        killTree(pid, `pid file ${file}`)
        stopped.add(pid)
      }
    } catch (error) {
      console.error(`[comfyui] pid-file cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const cfg = readConfig()
  if (cfg) {
    const owner = listeningOwner(cfg.url)
    if (owner?.ours && !stopped.has(owner.pid)) killTree(owner.pid, 'port owner with our flags')
  }
  state = {
    ...state,
    phase: 'off',
    detail: 'stopped with the app',
    owned: false,
    pid: undefined,
    memGb: undefined,
    idleStopsAt: undefined,
    updatedAt: new Date().toISOString()
  }
}
