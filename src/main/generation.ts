import { app } from 'electron'
import type { GenerationParams, GenerationResult } from '@shared/types'
import { assetPathForUrl, importFileAsset, importUrlAsset } from './asset-store'
import { resolveClaudeAuthOverride } from './claude-auth'
import { listConnectors, resolveHttpHeaders } from './connectors-store'
import { readSecretValue } from './credential-vault'
import { resolveActiveProvider } from './model-providers'

type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk')
type McpServerConfig = {
  type?: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

let sdkPromise: Promise<AgentSdk> | null = null
function loadSdk(): Promise<AgentSdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

// Generation (a tool call plus, for async services, a poll loop) is far slower
// than a chat turn — give it real headroom.
const GENERATION_TIMEOUT_MS = 300_000
// Caps only the *orchestration* LLM spend; the generation tool itself bills on
// the connector's own account, outside the agent's cost accounting.
const ORCHESTRATION_BUDGET_USD = 1.5

/** MCP server name must be a bare identifier so `mcp__<name>__<tool>` resolves. */
function mcpName(connectorId: string): string {
  return connectorId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Builds the SDK mcpServers map from installed connectors, injecting each stored
 * credential the same way a real call would — env var for stdio, header for
 * http. The SDK carries the actual transport (stdio spawn / Streamable-HTTP).
 * A connector that needs a key but has none is skipped rather than attached to
 * fail.
 */
/** Tools that spend money or mutate credentials, shipped ALONGSIDE generation
 *  tools on some connectors. The server-level allowlist would pre-authorize
 *  them, so they're excluded by exact name via disallowedTools (which takes
 *  precedence over allowedTools in the SDK). muapi's are known concretely;
 *  the canUseTool regex backstop covers unknown servers' variants. */
const DANGEROUS_TOOLS_BY_SERVER: Record<string, string[]> = {
  muapi: ['muapi_account_topup', 'muapi_keys_create', 'muapi_keys_delete']
}

async function buildMcpServers(restrictId?: string): Promise<{
  servers: Record<string, McpServerConfig>
  allowedTools: string[]
  disallowedTools: string[]
  attached: string[]
  skipped: string[]
}> {
  const servers: Record<string, McpServerConfig> = {}
  const allowedTools: string[] = []
  const disallowedTools: string[] = []
  const attached: string[] = []
  const skipped: string[] = []

  for (const def of listConnectors()) {
    if (restrictId && def.id !== restrictId) continue
    const needsKey = def.authType !== 'none'
    const token = needsKey ? readSecretValue(def.id) : null
    if (needsKey && !token) {
      skipped.push(def.id)
      continue
    }
    const name = mcpName(def.id)
    if (def.kind === 'stdio' && def.command) {
      const env: Record<string, string> = { ...(def.env ?? {}) }
      if (def.secretKey && token && def.authType !== 'oauth') env[def.secretKey] = token
      servers[name] = { command: def.command, args: def.args ?? [], env }
    } else if (def.kind === 'http' && def.url) {
      const headers = await resolveHttpHeaders(def)
      if (def.authType === 'oauth' && !headers['Authorization']) {
        // Connected-then-expired with no refresh path — attaching would just 401.
        skipped.push(def.id)
        continue
      }
      servers[name] = { type: 'http', url: def.url, headers }
    } else {
      skipped.push(def.id)
      continue
    }
    // `mcp__<server>` allows every tool from that server and nothing else — the
    // canUseTool backstop still hard-denies any non-MCP tool.
    allowedTools.push(`mcp__${name}`)
    for (const tool of DANGEROUS_TOOLS_BY_SERVER[def.id] ?? []) {
      disallowedTools.push(`mcp__${name}__${tool}`)
    }
    attached.push(def.id)
  }

  return { servers, allowedTools, disallowedTools, attached, skipped }
}

function llmAuthEnv(): { env: Record<string, string> | null; model: string | undefined } {
  const provider = resolveActiveProvider()
  if (provider.def.kind === 'anthropic-compatible' && provider.def.baseUrl && provider.key) {
    return {
      env: { ANTHROPIC_BASE_URL: provider.def.baseUrl, ANTHROPIC_AUTH_TOKEN: provider.key },
      model: provider.def.model
    }
  }
  const override = resolveClaudeAuthOverride()
  let env: Record<string, string> | null = null
  if (override?.kind === 'oauthToken') env = { CLAUDE_CODE_OAUTH_TOKEN: override.value }
  else if (override?.kind === 'apiKey') env = { ANTHROPIC_API_KEY: override.value }
  return { env, model: undefined }
}

function buildPrompt(params: GenerationParams): string {
  const lines = [
    `Generate a ${params.mediaType}.`,
    `Description: ${params.prompt}`
  ]
  if (params.aspectRatio) lines.push(`Aspect ratio: ${params.aspectRatio}.`)
  if (params.durationSec) lines.push(`Duration: ${params.durationSec} seconds.`)
  if (params.resolution) lines.push(`Resolution: ${params.resolution}.`)
  if (params.modelHint) {
    lines.push(`Model preference: use a ${params.modelHint} model if the connected tools offer one.`)
  }
  if (params.referenceImagePaths?.length) {
    lines.push(
      `Reference images on disk (mix their style into the output): ${params.referenceImagePaths.join(' | ')}`,
      'If the chosen tool accepts a reference_image_paths parameter, pass these absolute paths to it.'
    )
  }
  if (params.startFramePath) {
    lines.push(
      `First-frame image on disk: ${params.startFramePath} — pass it as the tool's start_frame_path parameter.`
    )
  }
  if (params.endFramePath) {
    lines.push(
      `Last-frame image on disk: ${params.endFramePath} — pass it as the tool's end_frame_path parameter.`
    )
  }
  lines.push(
    'Use exactly one connected generation tool that produces this media type. Wait for it to finish.',
    'If the tool returns a request/job id instead of a result (async services like muapi do), poll its matching result/status tool until the job completes and you have the final output URL or file.',
    'Then reply with a single line and nothing else: `RESULT_URL: <direct https URL>` for a URL result, `RESULT_FILE: <absolute local path>` if the tool returned a local file path, or `RESULT_ERROR: <short reason>`.'
  )
  return lines.join('\n')
}

const RESULT_URL_RE = /RESULT_URL:\s*(https?:\/\/\S+)/i
const RESULT_FILE_RE = /RESULT_FILE:\s*(.+)/i
const RESULT_ERROR_RE = /RESULT_ERROR:\s*(.+)/i
const ANY_URL_RE = /(https?:\/\/[^\s"'<>)]+)/i

/** lyme-asset:// URLs from the renderer become on-disk paths the wrappers can
 *  read; already-absolute paths pass through. Unresolvable entries drop. */
function toDiskPath(ref: string): string | null {
  if (ref.startsWith('lyme-asset://')) return assetPathForUrl(ref)
  return ref
}

export async function runGeneration(params: GenerationParams): Promise<GenerationResult> {
  const fail = (error: string): GenerationResult => ({ ok: false, mediaType: params.mediaType, error })

  if (!params.prompt.trim()) return fail('Enter a prompt to generate.')

  params = {
    ...params,
    referenceImagePaths: params.referenceImagePaths
      ?.map(toDiskPath)
      .filter((p): p is string => p !== null),
    startFramePath: params.startFramePath ? (toDiskPath(params.startFramePath) ?? undefined) : undefined,
    endFramePath: params.endFramePath ? (toDiskPath(params.endFramePath) ?? undefined) : undefined
  }

  const { servers, allowedTools, disallowedTools, attached, skipped } = await buildMcpServers(
    params.connectorId
  )
  if (attached.length === 0) {
    return fail(
      params.connectorId
        ? 'That connector is not a ready stdio generation connector (missing command or credential).'
        : skipped.length > 0
          ? 'No usable generation connector. Installed connectors are http-only or missing a credential — add a stdio generation connector (e.g. muapi) with a key in Settings › Connectors.'
          : 'No generation connector installed. Add one in Settings › Connectors.'
    )
  }

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), GENERATION_TIMEOUT_MS)
  const { env: authEnv, model } = llmAuthEnv()

  // Hard backstop: this agent runs on the user's machine, so it may ONLY call
  // the attached generation MCP tools — never a built-in (Bash/Write/etc.).
  // allowedTools pre-authorizes the MCP servers so they run without a prompt;
  // anything else reaches canUseTool and is denied. No bypassPermissions.
  //
  // Second backstop: some connectors expose tools that SPEND MONEY or mutate
  // credentials alongside their generation tools (muapi ships account_topup —
  // a Stripe checkout — plus keys_create/keys_delete). The server-level
  // allowlist would pre-authorize those too, so deny them by name here.
  const DENIED_TOOL_RE = /topup|top_up|checkout|payment|billing|purchase|keys_create|keys_delete|key_create|key_delete|delete_account/i
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: 'allow'; updatedInput: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > => {
    if (!toolName.startsWith('mcp__')) {
      return { behavior: 'deny', message: `Blocked non-generation tool: ${toolName}` }
    }
    if (DENIED_TOOL_RE.test(toolName)) {
      return { behavior: 'deny', message: `Blocked spend/credential tool: ${toolName}` }
    }
    return { behavior: 'allow', updatedInput: input }
  }

  try {
    const { query } = await loadSdk()
    const stream = query({
      prompt: buildPrompt(params),
      options: {
        abortController: abort,
        maxTurns: 12,
        maxBudgetUsd: ORCHESTRATION_BUDGET_USD,
        allowedTools,
        disallowedTools,
        canUseTool,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcpServers: servers as any,
        settingSources: [],
        ...(authEnv ? { env: { ...process.env, ...authEnv } } : {}),
        ...(model ? { model } : {}),
        systemPrompt:
          'You are Lyme Hype\'s media-generation agent. You have MCP tools from connected generation services. Call the single best tool to produce the requested media, wait for completion, and return only the required RESULT_URL:/RESULT_ERROR: line. Never invent a URL.',
        cwd: app.getPath('userData')
      }
    })

    let text = ''
    let costUsd: number | null = null

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') text += block.text
        }
      } else if (message.type === 'result') {
        if ('total_cost_usd' in message && typeof message.total_cost_usd === 'number') {
          costUsd = message.total_cost_usd
        }
        if (message.subtype !== 'success') {
          return {
            ok: false,
            mediaType: params.mediaType,
            costUsd,
            error:
              message.subtype === 'error_max_budget_usd'
                ? 'Generation stopped: orchestration budget reached before a result.'
                : message.subtype === 'error_max_turns'
                  ? 'Generation stopped: the tool did not return a result in time.'
                  : `Generation failed: ${message.subtype}`
          }
        }
      }
    }

    const errMatch = text.match(RESULT_ERROR_RE)
    const fileMatch = text.match(RESULT_FILE_RE)
    const urlMatch = text.match(RESULT_URL_RE) ?? text.match(ANY_URL_RE)
    if (!urlMatch && !fileMatch) {
      return {
        ok: false,
        mediaType: params.mediaType,
        costUsd,
        error: errMatch ? `Connector: ${errMatch[1].trim()}` : 'No media URL returned by the generator.'
      }
    }

    // File results (e.g. the bundled Gemini wrapper) are copied into the asset
    // store; URL results are downloaded into it.
    const saved = fileMatch
      ? importFileAsset(fileMatch[1].trim())
      : await importUrlAsset(urlMatch![1].trim(), params.mediaType)
    return {
      ok: true,
      src: saved.url,
      mediaType: params.mediaType,
      note: `via ${attached.join(', ')}${costUsd != null ? ` · $${costUsd.toFixed(3)}` : ''}`,
      costUsd
    }
  } catch (error) {
    return {
      ok: false,
      mediaType: params.mediaType,
      error: abort.signal.aborted
        ? `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
        : error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}
