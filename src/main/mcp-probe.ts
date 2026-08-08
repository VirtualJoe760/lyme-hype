import { McpStdioClient, type McpToolInfo, type StdioServerSpec } from './mcp-client'

export type { StdioServerSpec, McpToolInfo } from './mcp-client'

export interface McpProbeResult {
  ok: boolean
  serverInfo: { name: string; version: string } | null
  tools: McpToolInfo[]
  /** Result of an optional verify tool call (e.g. ChatRealty's whoami). */
  verify?: { isError: boolean; text: string }
  error?: string
}

/**
 * One-shot connection check: initialize + tools/list + optional verify tool.
 * Confirms a stdio connector is reachable before Lyme Hype relies on it.
 */
export async function probeStdioMcp(
  spec: StdioServerSpec,
  verifyTool?: { name: string; arguments?: Record<string, unknown> }
): Promise<McpProbeResult> {
  const client = new McpStdioClient()
  try {
    await client.start(spec)
    const tools = await client.listTools()
    let verify: McpProbeResult['verify']
    if (verifyTool) {
      const res = await client.callTool(verifyTool.name, verifyTool.arguments ?? {})
      const text = res.content
        .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
        .join(' ')
      verify = { isError: res.isError, text: text.slice(0, 500) }
    }
    return { ok: client.serverInfo !== null, serverInfo: client.serverInfo, tools, verify }
  } catch (err) {
    return {
      ok: false,
      serverInfo: null,
      tools: [],
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    client.stop()
  }
}
