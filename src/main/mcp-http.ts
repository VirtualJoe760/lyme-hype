import { net } from 'electron'
import type { ConnectorAuthType } from '@shared/types'
import type { McpProbeResult, McpToolInfo } from './mcp-probe'

export interface HttpServerSpec {
  url: string
  headers?: Record<string, string>
}

/**
 * Builds the auth header for an http MCP connector. For http, a connector's
 * `secretKey` is the header NAME (env-var name for stdio); a bearer secret is
 * wrapped as `Bearer <token>`, an api-key secret is sent raw.
 */
export function httpAuthHeaders(
  authType: ConnectorAuthType,
  headerName: string | undefined,
  token: string | null
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (authType !== 'none' && headerName && token) {
    headers[headerName] = authType === 'bearer' ? `Bearer ${token}` : token
  }
  return headers
}

interface RpcOutcome {
  message: Record<string, unknown> | null
  sessionId: string | null
  status: number
  raw: string
}

/** Pulls the JSON-RPC message with the wanted id out of an SSE body (falls back
 *  to the last parseable data line for servers that omit/renumber ids). */
function parseSse(text: string, wantId: number): Record<string, unknown> | null {
  const datas = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
  for (const d of datas) {
    try {
      const m = JSON.parse(d) as Record<string, unknown>
      if (m['id'] === wantId) return m
    } catch {
      /* skip non-JSON keep-alive lines */
    }
  }
  for (let i = datas.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(datas[i]) as Record<string, unknown>
    } catch {
      /* keep scanning back */
    }
  }
  return null
}

async function postRpc(
  spec: HttpServerSpec,
  sessionId: string | null,
  body: Record<string, unknown>,
  wantId: number,
  timeoutMs = 20_000
): Promise<RpcOutcome> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(spec.headers ?? {})
  }
  if (sessionId) headers['mcp-session-id'] = sessionId

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const res = await net.fetch(spec.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abort.signal
    })
    const returnedSession = res.headers.get('mcp-session-id')
    const ctype = (res.headers.get('content-type') ?? '').toLowerCase()
    const raw = await res.text()
    let message: Record<string, unknown> | null = null
    if (ctype.includes('text/event-stream')) {
      message = parseSse(raw, wantId)
    } else if (raw) {
      try {
        const parsed = JSON.parse(raw)
        message = Array.isArray(parsed)
          ? ((parsed.find((m) => (m as Record<string, unknown>)['id'] === wantId) ??
              null) as Record<string, unknown> | null)
          : (parsed as Record<string, unknown>)
      } catch {
        message = null
      }
    }
    return { message, sessionId: returnedSession, status: res.status, raw }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * One-shot reachability check for a Streamable-HTTP MCP server: initialize +
 * tools/list (+ optional verify call). Mirrors probeStdioMcp so testConnector
 * can treat both transports the same. The Agent SDK does the real http MCP work
 * at generation time; this is just the "is it reachable / authorized" probe.
 */
export async function probeHttpMcp(
  spec: HttpServerSpec,
  verifyTool?: { name: string; arguments?: Record<string, unknown> }
): Promise<McpProbeResult> {
  try {
    const initId = 1
    const init = await postRpc(
      spec,
      null,
      {
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'lyme-hype', version: '0.1.0' }
        }
      },
      initId
    )

    if (init.status >= 400) {
      return {
        ok: false,
        serverInfo: null,
        tools: [],
        error: `initialize failed (HTTP ${init.status})${init.raw ? `: ${init.raw.slice(0, 200)}` : ''}`
      }
    }
    const initResult = init.message?.['result'] as
      | { serverInfo?: { name: string; version: string } }
      | undefined
    if (!initResult) {
      const err = init.message?.['error'] as { message?: string } | undefined
      return {
        ok: false,
        serverInfo: null,
        tools: [],
        error: err?.message ?? 'initialize returned no result'
      }
    }
    const serverInfo = initResult.serverInfo ?? { name: 'unknown', version: '0' }
    const session = init.sessionId

    // Best-effort readiness signal; servers reply 202 with no body.
    await postRpc(spec, session, { jsonrpc: '2.0', method: 'notifications/initialized' }, -1).catch(
      () => undefined
    )

    const listId = 2
    const listed = await postRpc(spec, session, { jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} }, listId)
    const toolList = (listed.message?.['result'] as { tools?: McpToolInfo[] } | undefined)?.tools ?? []
    const tools: McpToolInfo[] = toolList.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))

    let verify: McpProbeResult['verify']
    if (verifyTool) {
      const callId = 3
      const called = await postRpc(
        spec,
        session,
        { jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: verifyTool.name, arguments: verifyTool.arguments ?? {} } },
        callId,
        45_000
      )
      const r = called.message?.['result'] as
        | { isError?: boolean; content?: { type: string; text?: string }[] }
        | undefined
      const text = (r?.content ?? [])
        .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
        .join(' ')
      verify = { isError: r?.isError ?? false, text: text.slice(0, 500) }
    }

    return { ok: true, serverInfo, tools, verify }
  } catch (err) {
    return {
      ok: false,
      serverInfo: null,
      tools: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
