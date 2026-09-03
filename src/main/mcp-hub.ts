import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { handleMcpMessage, type JsonRpcMessage } from './mcp-server'

/**
 * The ONE Lyme Hype backend: a named-pipe server every MCP bridge on the
 * machine connects to (resources/lyme-mcp-bridge.cjs).
 *
 * Before this, each Claude Code session's bridge booted its own headless
 * Electron, so N sessions meant N copies of the app — and the studio a further
 * one — each with its own idea of ComfyUI. Now:
 *
 *   - the pipe name is fixed; whoever listens on it IS the backend;
 *   - a headless backend serves any number of bridges and exits a minute after
 *     the last one disconnects;
 *   - the studio takes the pipe over when it opens (it asks a headless backend
 *     to step aside, then listens), so sessions drive the live studio and share
 *     its ComfyUI; when the studio closes, the bridges spawn a headless backend
 *     again. Bridges reconnect and replay the MCP handshake, so the client sees
 *     one uninterrupted server.
 *
 * Protocol per connection is unchanged: newline-delimited JSON-RPC handled by
 * mcp-server.ts, which is stateless per message.
 */

/** Must match resources/lyme-mcp-bridge.cjs. */
export const HUB_PIPE =
  process.platform === 'win32' ? '\\\\.\\pipe\\lyme-hype-mcp' : join(tmpdir(), 'lyme-hype-mcp.sock')

export type HubMode = 'studio' | 'headless'

const HANDOFF_LINE = JSON.stringify({ lyme: 'handoff' })
const HEADLESS_IDLE_EXIT_MS = 60_000
const LISTEN_RETRY_MS = 250
const TAKEOVER_TIMEOUT_MS = 15_000

let server: Server | null = null
let mode: HubMode = 'headless'
const clients = new Set<Socket>()
let idleTimer: ReturnType<typeof setTimeout> | null = null

export function hubClientCount(): number {
  return clients.size
}

function scheduleIdleExit(): void {
  if (mode !== 'headless') return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (clients.size === 0) {
      console.log('[hub] no bridge connected for a minute — exiting')
      app.exit(0)
    }
  }, HEADLESS_IDLE_EXIT_MS)
}

function stepAside(): void {
  if (mode === 'studio') return
  console.log('[hub] the studio is taking over the pipe — exiting so the bridges reconnect to it')
  stopMcpHub()
  app.exit(0)
}

function serve(sock: Socket): void {
  sock.setEncoding('utf8')
  clients.add(sock)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  let buf = ''
  sock.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      if (line === HANDOFF_LINE) {
        stepAside()
        continue
      }
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line) as JsonRpcMessage
      } catch {
        continue
      }
      void Promise.resolve(handleMcpMessage(msg))
        .then((result) => {
          if (msg.id !== undefined && result !== undefined && !sock.destroyed) {
            sock.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
          }
        })
        .catch((error: unknown) => {
          if (msg.id !== undefined && !sock.destroyed) {
            sock.write(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
              }) + '\n'
            )
          }
        })
    }
  })
  sock.on('error', () => {
    /* close follows */
  })
  sock.on('close', () => {
    clients.delete(sock)
    if (clients.size === 0) scheduleIdleExit()
  })
}

function tryListen(): Promise<'listening' | 'in-use'> {
  return new Promise((resolve) => {
    const s = createServer(serve)
    s.once('error', () => {
      s.close()
      resolve('in-use')
    })
    s.listen(HUB_PIPE, () => {
      server = s
      resolve('listening')
    })
  })
}

/** Is anyone actually behind the pipe? (A Unix socket file can be stale.) */
function pipeAnswers(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection(HUB_PIPE)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

/** Ask whoever holds the pipe to step aside — only a headless backend will. */
function requestHandoff(): Promise<void> {
  return new Promise((resolve) => {
    const s = createConnection(HUB_PIPE)
    s.once('connect', () => {
      s.end(HANDOFF_LINE + '\n')
      resolve()
    })
    s.once('error', () => resolve())
  })
}

/**
 * Become the backend. Headless: if another backend already serves the pipe,
 * this process is redundant and exits (the bridge that spawned it connects to
 * the other one). Studio: takes the pipe over, waiting for a headless backend
 * to leave.
 */
export async function startMcpHub(as: HubMode): Promise<void> {
  mode = as
  const deadline = Date.now() + TAKEOVER_TIMEOUT_MS
  let asked = false
  for (;;) {
    if ((await tryListen()) === 'listening') {
      console.log(`[hub] ${mode} backend listening on ${HUB_PIPE}`)
      scheduleIdleExit()
      return
    }
    if (process.platform !== 'win32' && !(await pipeAnswers())) {
      try {
        if (existsSync(HUB_PIPE)) unlinkSync(HUB_PIPE)
      } catch {
        /* retry below */
      }
    }
    if (mode === 'headless') {
      console.log('[hub] another backend already serves the pipe — this one is redundant, exiting')
      app.exit(0)
      return
    }
    if (!asked) {
      asked = true
      await requestHandoff()
    }
    if (Date.now() > deadline) {
      console.error('[hub] could not take the MCP pipe over — sessions keep using the other backend')
      return
    }
    await new Promise((r) => setTimeout(r, LISTEN_RETRY_MS))
  }
}

/** Close the pipe and drop every bridge; they reconnect (and respawn) by themselves. */
export function stopMcpHub(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  for (const c of clients) c.destroy()
  clients.clear()
  server?.close()
  server = null
}
