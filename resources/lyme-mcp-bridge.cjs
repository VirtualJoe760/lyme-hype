#!/usr/bin/env node
/**
 * Stdio↔named-pipe bridge for Lyme Hype's MCP mode — and the reason there is
 * only ever ONE Lyme Hype backend on this machine.
 *
 * Why a bridge at all: Electron on Windows crashes (0xC0000005) the moment the
 * main process reads a piped stdin (verified against Electron 38). So the MCP
 * client spawns this plain-Node process and it relays to the app over a named
 * pipe, which Electron reads as a net socket without trouble.
 *
 * Why one backend: every Claude Code session used to get its own headless
 * Electron (`electron . --mcp`), each one a full copy of the app. Two sessions
 * plus the studio meant three copies competing for the same GPU and RAM
 * (2026-09-02: 43 GB committed, the whole machine paging). Now the pipe name is
 * fixed, the backend LISTENS on it (src/main/mcp-hub.ts), and a bridge spawns a
 * headless backend only when nothing answers. The studio hosts the same pipe
 * while it is open, so a session's tool calls run inside the window you are
 * looking at, against the one ComfyUI the app manages.
 *
 * The backend can change underneath a bridge: the studio opens and takes over
 * from a headless backend, or the studio closes. The bridge reconnects and
 * replays the MCP `initialize` handshake so the client never notices; a tool
 * call that was in flight gets an error reply instead of hanging forever.
 *
 * Requires a built bundle (`npm run build`) — `electron .` runs out/main/index.js.
 */
'use strict'

const { spawn } = require('node:child_process')
const { createConnection } = require('node:net')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')
const electronExe = join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)

/** Fixed name — must match HUB_PIPE in src/main/mcp-hub.ts. */
const HUB_PIPE =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\lyme-hype-mcp'
    : join(require('node:os').tmpdir(), 'lyme-hype-mcp.sock')

const CONNECT_RETRY_MS = 250
/** Nothing answering for this long → spawn a headless backend. On a cold start
 *  that is near-immediate; after a backend goes away it waits long enough for
 *  a studio that is taking over to start listening. */
const SPAWN_AFTER_COLD_MS = 400
const SPAWN_AFTER_WARM_MS = 3000
const GIVE_UP_MS = 120_000

let sock = null
let everConnected = false
let spawnedAt = 0
let closed = false
const handshake = { initialize: null, initialized: null }
/** Request ids the client is still waiting on. */
const inFlight = new Set()
/** Lines from the client that arrived while no backend was connected. */
const pending = []
let replayId = null
let stdinBuf = ''

function log(line) {
  process.stderr.write(`[lyme-mcp-bridge] ${line}\n`)
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function spawnBackend() {
  spawnedAt = Date.now()
  // Detached and unreferenced: the backend belongs to the machine, not to this
  // session. It exits by itself once no bridge has been connected for a minute.
  const child = spawn(electronExe, ['.', '--mcp'], {
    cwd: projectRoot,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  })
  child.on('error', (err) => log(`electron spawn failed: ${err.message}`))
  child.unref()
  log(`spawned a headless backend (pid ${child.pid})`)
}

function flushPending() {
  while (pending.length > 0 && sock) sock.write(pending.shift() + '\n')
}

function connect(waitingSince) {
  if (closed) return
  const s = createConnection(HUB_PIPE)
  s.setEncoding('utf8')
  let buf = ''

  s.on('connect', () => {
    sock = s
    spawnedAt = 0
    if (everConnected && handshake.initialize) {
      // The client already did its handshake with the previous backend; do it
      // again on its behalf and swallow the duplicate reply.
      replayId = handshake.initialize.id
      s.write(JSON.stringify(handshake.initialize) + '\n')
      if (handshake.initialized) s.write(JSON.stringify(handshake.initialized) + '\n')
      log('reconnected — handshake replayed')
    } else {
      log('connected to the backend')
    }
    everConnected = true
    flushPending()
  })

  s.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg = null
      try {
        msg = JSON.parse(line)
      } catch {
        /* pass through as-is */
      }
      if (msg && msg.id !== undefined && msg.method === undefined) {
        if (replayId !== null && msg.id === replayId) {
          replayId = null
          continue
        }
        inFlight.delete(msg.id)
      }
      process.stdout.write(line + '\n')
    }
  })

  s.on('error', () => {
    /* 'close' follows and decides what to do */
  })

  s.on('close', () => {
    const wasConnected = sock === s
    sock = null
    if (closed) return
    if (wasConnected) {
      log('backend went away — reconnecting')
      for (const id of inFlight) {
        reply({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: 'Lyme Hype backend changed (the studio opened or closed) — retry the call'
          }
        })
      }
      inFlight.clear()
      setTimeout(() => connect(Date.now()), CONNECT_RETRY_MS)
      return
    }
    const waited = Date.now() - waitingSince
    if (waited > GIVE_UP_MS) {
      log('no backend came up within 2 minutes — is the app built? (npm run build)')
      process.exit(1)
    }
    const spawnAfter = everConnected ? SPAWN_AFTER_WARM_MS : SPAWN_AFTER_COLD_MS
    if (waited >= spawnAfter && spawnedAt === 0) spawnBackend()
    setTimeout(() => connect(waitingSince), CONNECT_RETRY_MS)
  })
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk
  let nl
  while ((nl = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, nl)
    stdinBuf = stdinBuf.slice(nl + 1)
    if (!line.trim()) continue
    let msg = null
    try {
      msg = JSON.parse(line)
    } catch {
      /* forward anyway; the backend ignores what it cannot parse */
    }
    if (msg) {
      if (msg.method === 'initialize') handshake.initialize = msg
      else if (msg.method === 'notifications/initialized') handshake.initialized = msg
      if (msg.id !== undefined && msg.method !== undefined) inFlight.add(msg.id)
    }
    if (sock) sock.write(line + '\n')
    else pending.push(line)
  }
})

process.stdin.on('end', () => {
  closed = true
  if (sock) sock.end()
  process.exit(0)
})

connect(Date.now())
