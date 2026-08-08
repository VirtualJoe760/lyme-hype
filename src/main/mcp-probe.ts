import { spawn } from 'node:child_process'

export interface StdioServerSpec {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpToolInfo {
  name: string
  description?: string
}

export interface McpProbeResult {
  ok: boolean
  serverInfo: { name: string; version: string } | null
  tools: McpToolInfo[]
  /** Result of an optional verify tool call (e.g. ChatRealty's whoami). */
  verify?: { isError: boolean; text: string }
  error?: string
}

/**
 * Minimal MCP-over-stdio client: spawn a server, run initialize + tools/list,
 * and optionally call one verify tool. Newline-delimited JSON-RPC — no external
 * MCP SDK needed. This is how Lyme Hype confirms a stdio connector is reachable
 * before relying on it; the transport is identical to what the Agent SDK uses.
 */
export function probeStdioMcp(
  spec: StdioServerSpec,
  verifyTool?: { name: string; arguments?: Record<string, unknown> },
  timeoutMs = 20_000
): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...spec.env },
      shell: process.platform === 'win32'
    })

    const pending = new Map<number, (msg: Record<string, unknown>) => void>()
    let buf = ''
    let settled = false
    let stderr = ''

    const finish = (result: McpProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ ok: false, serverInfo: null, tools: [], error: `Timed out after ${timeoutMs}ms` }),
      timeoutMs
    )

    child.on('error', (err) =>
      finish({ ok: false, serverInfo: null, tools: [], error: `Spawn failed: ${err.message}` })
    )
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('exit', (code) => {
      if (!settled) {
        finish({
          ok: false,
          serverInfo: null,
          tools: [],
          error: `Server exited (code ${code}) before handshake completed. ${stderr.slice(0, 300)}`.trim()
        })
      }
    })

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        const id = msg['id']
        if (typeof id === 'number' && pending.has(id)) {
          pending.get(id)!(msg)
          pending.delete(id)
        }
      }
    })

    let idCounter = 0
    const send = (method: string, params: unknown): Promise<Record<string, unknown>> => {
      const id = ++idCounter
      return new Promise((res) => {
        pending.set(id, res)
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    }
    const notify = (method: string): void => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
    }

    void (async () => {
      try {
        const init = await send('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'lyme-hype', version: '0.1.0' }
        })
        const initResult = init['result'] as { serverInfo?: { name: string; version: string } } | undefined
        const serverInfo = initResult?.serverInfo ?? null
        notify('notifications/initialized')

        const listed = await send('tools/list', {})
        const listResult = listed['result'] as { tools?: McpToolInfo[] } | undefined
        const tools = (listResult?.tools ?? []).map((t) => ({ name: t.name, description: t.description }))

        let verify: McpProbeResult['verify']
        if (verifyTool) {
          const called = await send('tools/call', {
            name: verifyTool.name,
            arguments: verifyTool.arguments ?? {}
          })
          const cr = called['result'] as
            | { isError?: boolean; content?: Array<{ type: string; text?: string }> }
            | undefined
          const text = (cr?.content ?? [])
            .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
            .join(' ')
          verify = { isError: cr?.isError ?? false, text: text.slice(0, 500) }
        }

        finish({ ok: serverInfo !== null, serverInfo, tools, verify })
      } catch (err) {
        finish({
          ok: false,
          serverInfo: null,
          tools: [],
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  })
}
