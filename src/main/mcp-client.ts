import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

export interface StdioServerSpec {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
  [key: string]: unknown
}

export interface McpToolResult {
  isError: boolean
  content: McpContentBlock[]
}

export interface McpToolInfo {
  name: string
  description?: string
}

/**
 * Minimal persistent MCP-over-stdio client — spawn a server, initialize once,
 * then call any number of tools. Newline-delimited JSON-RPC, no external MCP
 * SDK. Same transport the Agent SDK uses, so a connector that works here works
 * there. Always call stop() (a finally block) to reap the child process.
 */
export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private stderr = ''
  private nextId = 0
  private readonly pending = new Map<number, (msg: Record<string, unknown>) => void>()
  serverInfo: { name: string; version: string } | null = null

  async start(spec: StdioServerSpec, timeoutMs = 20_000): Promise<void> {
    const child = spawn(spec.command, spec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...spec.env },
      shell: process.platform === 'win32'
    })
    this.child = child

    child.stderr.on('data', (d: Buffer) => {
      this.stderr += d.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString()
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        const id = msg['id']
        if (typeof id === 'number' && this.pending.has(id)) {
          this.pending.get(id)!(msg)
          this.pending.delete(id)
        }
      }
    })

    const spawnError = new Promise<never>((_, reject) => {
      child.once('error', (err) => reject(new Error(`Spawn failed: ${err.message}`)))
      child.once('exit', (code) => {
        if (this.serverInfo === null) {
          reject(
            new Error(`Server exited (code ${code}) before initialize. ${this.stderr.slice(0, 300)}`.trim())
          )
        }
      })
    })

    const init = (await Promise.race([
      this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lyme-hype', version: '0.1.0' }
      }),
      spawnError,
      this.rejectAfter(timeoutMs, 'initialize')
    ])) as Record<string, unknown>

    const result = init['result'] as { serverInfo?: { name: string; version: string } } | undefined
    this.serverInfo = result?.serverInfo ?? { name: 'unknown', version: '0' }
    this.notify('notifications/initialized')
  }

  async listTools(timeoutMs = 20_000): Promise<McpToolInfo[]> {
    const listed = (await Promise.race([
      this.send('tools/list', {}),
      this.rejectAfter(timeoutMs, 'tools/list')
    ])) as Record<string, unknown>
    const result = listed['result'] as { tools?: McpToolInfo[] } | undefined
    return (result?.tools ?? []).map((t) => ({ name: t.name, description: t.description }))
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs = 45_000
  ): Promise<McpToolResult> {
    const called = (await Promise.race([
      this.send('tools/call', { name, arguments: args }),
      this.rejectAfter(timeoutMs, `tools/call ${name}`)
    ])) as Record<string, unknown>
    if (called['error']) {
      const err = called['error'] as { message?: string }
      throw new Error(`MCP error calling ${name}: ${err.message ?? JSON.stringify(err)}`)
    }
    const result = called['result'] as { isError?: boolean; content?: McpContentBlock[] } | undefined
    return { isError: result?.isError ?? false, content: result?.content ?? [] }
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill()
    this.child = null
    for (const resolve of this.pending.values()) resolve({ error: { message: 'client stopped' } })
    this.pending.clear()
  }

  private send(method: string, params: unknown): Promise<Record<string, unknown>> {
    if (!this.child) return Promise.reject(new Error('MCP client not started'))
    const id = ++this.nextId
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  private notify(method: string): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }

  private rejectAfter(ms: number, label: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms))
  }
}
