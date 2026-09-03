import { app } from 'electron'
import { guardedGeneration } from './generation-guard'
import { describeLlmCost, llmBilling } from './llm-billing'
import { ensureComfyUI } from './comfyui-host'
import { promptLanguageFor } from '@shared/model-catalog'
import type { GenerationParams, GenerationResult } from '@shared/types'
import {
  assetPathForUrl,
  importFileAsset,
  importUrlAsset,
  mediaTypeForPath,
  saveImageAsset
} from './asset-store'
import { resolveClaudeAuthOverride } from './claude-auth'
import { listConnectors, resolveHttpHeaders } from './connectors-store'
import { readSecretValue } from './credential-vault'
import { uploadLocalFileToFal } from './fal-training'
import { recordGeneration } from './generation-log'
import { resolveActiveProvider } from './model-providers'
import { hasYapperRestKey, uploadLocalMediaToYapper } from './yapper-rest'

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
// than a chat turn — give it real headroom. 10 min, not 5: the local ComfyUI
// engine may cold-boot the server AND load a 16GB checkpoint before its first
// sample (observed >300s on the 3090 from cold; warm calls take seconds).
const GENERATION_TIMEOUT_MS = 600_000
// Caps only the *orchestration* LLM spend; the generation tool itself bills on
// the connector's own account, outside the agent's cost accounting.
const ORCHESTRATION_BUDGET_USD = 1.5

/** MCP server name must be a bare identifier so `mcp__<name>__<tool>` resolves. */
function mcpName(connectorId: string): string {
  return connectorId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * On Windows `npx` is `npx.cmd`, which CreateProcess won't resolve from a bare name.
 * `mcp-client.ts` gets away with `shell: true`, but the Agent SDK spawns MCP servers
 * itself and doesn't — so every stdio connector died with "process exited with code 1"
 * and no attached tools. Route bare commands through cmd.exe; leave absolute paths and
 * already-suffixed executables alone.
 */
function windowsSafeCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args }
  if (/[\\/]/.test(command) || /\.(exe|cmd|bat)$/i.test(command)) return { command, args }
  return { command: 'cmd.exe', args: ['/c', command, ...args] }
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
  muapi: ['muapi_account_topup', 'muapi_keys_create', 'muapi_keys_delete'],
  // The official ElevenLabs server ships side-effect tools alongside audio
  // generation: real outbound phone calls and persistent billable agents.
  elevenlabs: ['make_outbound_call', 'create_agent', 'add_knowledge_base_to_agent']
}

/**
 * The slice of this process's environment a spawned MCP server genuinely needs:
 * an interpreter on PATH, a temp dir, and the Windows system roots. Everything
 * else is weight in a config that has a hard size ceiling.
 */
const CHILD_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'windir',
  'ComSpec',
  'SystemDrive',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'LANG',
  'LC_ALL'
]

function inheritedChildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) env[key] = value
  }
  return env
}

async function buildMcpServers(restrictIds?: string[]): Promise<{
  servers: Record<string, McpServerConfig>
  disallowedTools: string[]
  attached: string[]
  skipped: string[]
}> {
  const servers: Record<string, McpServerConfig> = {}
  const disallowedTools: string[] = []
  const attached: string[] = []
  const skipped: string[] = []

  for (const def of listConnectors()) {
    if (restrictIds && restrictIds.length > 0 && !restrictIds.includes(def.id)) continue
    const needsKey = def.authType !== 'none'
    const token = needsKey ? readSecretValue(def.id) : null
    if (needsKey && !token) {
      skipped.push(def.id)
      continue
    }
    const name = mcpName(def.id)
    if (def.kind === 'stdio' && def.command) {
      // The SDK uses this env as the child's WHOLE environment, so the secret alone
      // leaves the server with no PATH and nothing to resolve `npx`/`node` with —
      // mcp-client.ts merges process.env for exactly this reason, and generation
      // silently didn't, which is why no stdio connector ever attached.
      //
      // But copying ALL of process.env costs ~7 KB PER SERVER inside the config
      // the SDK hands its subprocess, and Windows caps a command line at 32,767
      // characters: four connectors fit, five did not, and generation started
      // failing with `spawn ENAMETOOLONG` before a single network call (verified
      // 2026-08-31). Only what a child actually needs to find its interpreter and
      // its temp dir travels now.
      const env: Record<string, string> = {
        ...inheritedChildEnv(),
        ...(def.env ?? {})
      }
      if (def.secretKey && token && def.authType !== 'oauth') env[def.secretKey] = token
      const spawnable = windowsSafeCommand(def.command, def.args ?? [])
      servers[name] = { command: spawnable.command, args: spawnable.args, env }
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
    // No allowedTools: bare `mcp__<server>` entries would pre-approve whole
    // servers and shadow canUseTool (the strict per-server gate in runGeneration).
    for (const tool of DANGEROUS_TOOLS_BY_SERVER[def.id] ?? []) {
      disallowedTools.push(`mcp__${name}__${tool}`)
    }
    attached.push(def.id)
  }

  return { servers, disallowedTools, attached, skipped }
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
  if (params.model) {
    lines.push(
      `Exact model REQUIRED: pass \`model: "${params.model}"\` to the generation tool's model parameter. If no connected tool accepts that model id, reply RESULT_ERROR rather than substituting a different model.`
    )
  }
  // Chinese-origin models (Seedance/Seedream, Kling, Wan, Qwen, Hunyuan, Vidu…)
  // follow Chinese prompts measurably better — they were captioned in Chinese.
  // The orchestrating LLM does the translation; the user never sees Chinese.
  if (promptLanguageFor(params.model) === 'zh') {
    lines.push(
      'PROMPT LANGUAGE: this model is Chinese-native. Translate the description above into natural Simplified Chinese — preserving cinematic intent, style terms, and any camera direction — and pass THE CHINESE TEXT as the tool\'s prompt parameter. If the tool errors on the non-ASCII text (an encoding/surrogate error), retry the SAME call once with the original English prompt instead of failing. Keep every other parameter and all of your own replies (including the RESULT_* line) in English.'
    )
  } else if (!params.model) {
    lines.push(
      'PROMPT LANGUAGE: if the model you choose is from a Chinese-native family (Seedance, Seedream, Kling, Wan, Qwen, Hunyuan, Vidu, PixVerse, MiniMax/Hailuo), translate the description into natural Simplified Chinese for the tool\'s prompt parameter — these models follow Chinese prompts better. If the tool errors on non-ASCII text, retry once with the English prompt. Your own replies stay in English.'
    )
  }
  if (params.imageSize) {
    lines.push(`Output size: pass \`image_size: "${params.imageSize}"\` if the tool supports it.`)
  }
  if (params.thinkingLevel) {
    lines.push(`Pass \`thinking_level: "${params.thinkingLevel}"\` if the tool supports it.`)
  }
  if (params.resolution) {
    lines.push(`Video resolution: pass \`resolution: "${params.resolution}"\` if the tool supports it.`)
  }
  if (params.personGeneration) {
    lines.push(`Pass \`person_generation: "${params.personGeneration}"\` if the tool supports it.`)
  }
  if (params.steps) {
    lines.push(`Pass \`steps: ${params.steps}\` if the tool supports it.`)
  }
  if (params.refStrength && params.referenceImagePaths?.length) {
    lines.push(`Pass \`strength: ${params.refStrength}\` if the tool has an img2img strength parameter.`)
  }
  if (params.characterReferencePaths?.length) {
    lines.push(
      `CHARACTER reference images on disk (preserve this exact person's likeness): ${params.characterReferencePaths.join(' | ')} — pass as character_reference_paths if the tool has it, else include with the other reference images.`
    )
  }
  if (params.styleReferencePaths?.length) {
    lines.push(
      `STYLE reference images on disk (match their look, not their content): ${params.styleReferencePaths.join(' | ')} — pass as style_reference_paths if the tool has it, else include with the other reference images.`
    )
  }
  if (params.referenceImagePaths?.length) {
    lines.push(
      `Reference images on disk (mix their style into the output): ${params.referenceImagePaths.join(' | ')}`,
      'If the chosen tool accepts a reference_image_paths parameter, pass these absolute paths to it.'
    )
  }
  if (params.maskPath) {
    lines.push(
      `INPAINT MASK on disk: ${params.maskPath} — the painted (opaque) areas are the region to regenerate; transparent areas must be preserved exactly.`,
      'This is a masked edit, not a fresh generation: pass the source image AND this mask to a tool that accepts a mask parameter (fal-ai/flux-krea-lora/inpainting, or gpt-image-2 via the images/edits mask field). If no connected tool accepts a mask, say so with RESULT_ERROR rather than generating an unmasked image.'
    )
  }
  if (params.startFramePath) {
    lines.push(
      `First-frame image on disk: ${params.startFramePath} — for a tool with a literal start_frame_path parameter (e.g. gemini_generate_video), pass it there directly. Otherwise (e.g. fal's run_model/submit_job), call get_model_schema first and use whatever field name that model's schema expects for a starting image (commonly image_url, start_image_url, or first_frame_image) — do not assume start_frame_path is a real parameter on every tool.`
    )
  }
  if (params.endFramePath) {
    lines.push(
      `Last-frame image on disk: ${params.endFramePath} — pass it as the tool's end_frame_path parameter.`
    )
  }
  if (params.sourceMediaPath) {
    lines.push(
      `Source face/performance media on disk: ${params.sourceMediaPath} — the video or photo to drive/transform.`
    )
  }
  if (params.referenceAudioPaths?.length) {
    lines.push(
      `Audio file(s) on disk to use as-is (do not regenerate speech, it already exists): ${params.referenceAudioPaths.join(' | ')}.`
    )
  }
  if (params.extendVideoPath) {
    lines.push(
      `This is a video-extension request, not a fresh generation: extend the existing video at ${params.extendVideoPath} by ~7 seconds using the tool's source_video_path parameter (e.g. gemini_extend_video).`
    )
    if (params.extendVideoDurationSec) {
      lines.push(`Pass its current length, ${params.extendVideoDurationSec} seconds, as previous_duration_seconds.`)
    }
  }
  if (
    params.sourceMediaPath ||
    params.referenceAudioPaths?.length ||
    params.referenceImagePaths?.length ||
    params.characterReferencePaths?.length ||
    params.styleReferencePaths?.length
  ) {
    lines.push(
      "If the target generation tool needs a hosted URL rather than a local path, and one of your attached connectors exposes its own file-upload tool (e.g. a *_upload_file tool), call that first to get a URL, then pass the returned URL to the generation tool."
    )
  }
  if (params.referenceImagePaths?.length) {
    lines.push(
      "Some reference-driven tools accept only a single input image — muapi's muapi_image_edit via image_url, comfyui's comfy_generate_image via reference_image_path — if the tool you pick has that shape, pass just the first reference path there; do not try to pass multiple images to a single-image parameter."
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

/** The mask is painted in the renderer and arrives as a data URL; wrappers read files,
 *  so it lands in the asset store first and travels as a path like every other input. */
function maskDataUrlToPath(dataUrl: string): string | undefined {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return undefined
  const saved = saveImageAsset(match[2], match[1])
  return assetPathForUrl(saved.url) ?? undefined
}

export async function runGenerationOnce(params: GenerationParams): Promise<GenerationResult> {
  const fail = (error: string): GenerationResult => ({ ok: false, mediaType: params.mediaType, error })

  if (!params.prompt.trim()) return fail('Enter a prompt to generate.')

  // ComfyUI runs on demand, not from boot. A run pinned to it waits for the
  // server (cold start ≈ 20 s, worst case 3 min); an unrestricted image run
  // only kicks the start off, because the agent may pick a cloud connector
  // and the wrapper itself waits for health if it does pick the local one.
  if (params.mediaType === 'image') {
    const pinned = params.connectorId === 'comfyui'
    const eligible = pinned || (!params.connectorId && (!params.connectorIds || params.connectorIds.includes('comfyui')))
    if (pinned && !(await ensureComfyUI())) {
      return fail('ComfyUI did not come up — see the status strip at the foot of the studio.')
    }
    if (eligible && !pinned) void ensureComfyUI()
  }

  const stderrTail: string[] = []

  params = {
    ...params,
    referenceImagePaths: params.referenceImagePaths
      ?.map(toDiskPath)
      .filter((p): p is string => p !== null),
    characterReferencePaths: params.characterReferencePaths
      ?.map(toDiskPath)
      .filter((p): p is string => p !== null),
    styleReferencePaths: params.styleReferencePaths
      ?.map(toDiskPath)
      .filter((p): p is string => p !== null),
    startFramePath: params.startFramePath ? (toDiskPath(params.startFramePath) ?? undefined) : undefined,
    endFramePath: params.endFramePath ? (toDiskPath(params.endFramePath) ?? undefined) : undefined,
    referenceAudioPaths: params.referenceAudioPaths
      ?.map(toDiskPath)
      .filter((p): p is string => p !== null),
    sourceMediaPath: params.sourceMediaPath ? (toDiskPath(params.sourceMediaPath) ?? undefined) : undefined,
    extendVideoPath: params.extendVideoPath ? (toDiskPath(params.extendVideoPath) ?? undefined) : undefined,
    maskPath: params.maskDataUrl ? maskDataUrlToPath(params.maskDataUrl) : undefined
  }

  const restrictIds =
    params.connectorIds && params.connectorIds.length > 0
      ? params.connectorIds
      : params.connectorId
        ? [params.connectorId]
        : undefined
  const { servers, disallowedTools, attached, skipped } = await buildMcpServers(restrictIds)
  if (attached.length === 0) {
    return fail(
      restrictIds
        ? `None of the requested connector(s) (${restrictIds.join(', ')}) are ready stdio/http generation connectors (missing command, credential, or transport support).`
        : skipped.length > 0
          ? 'No usable generation connector. Installed connectors are http-only or missing a credential — add a stdio generation connector (e.g. muapi) with a key in Settings › Connectors.'
          : 'No generation connector installed. Add one in Settings › Connectors.'
    )
  }

  // Yapper's hosted MCP connector has no upload tool of its own (yapper.md
  // "Getting local media INTO Yapper") — when it's the only attached
  // connector, the agent has no way to turn a local sourceMediaPath/
  // referenceAudioPaths into something yapper_start_process can take. Do
  // the REST signed-upload here instead of asking the agent to, and hand it
  // the resulting Yapper asset ids directly.
  const yapperOnlyPromptLines: string[] = []
  if (attached.includes('yapper') && !attached.includes('muapi') && hasYapperRestKey()) {
    if (params.sourceMediaPath && mediaTypeForPath(params.sourceMediaPath) === 'video') {
      const uploaded = await uploadLocalMediaToYapper(params.sourceMediaPath)
      if (uploaded.ok && uploaded.assetId) {
        yapperOnlyPromptLines.push(
          `The source video is already uploaded to Yapper as assetId "${uploaded.assetId}" — pass it directly as sourceVideoAssetId (yapper_start_process, type video-lipsync). Do not try to upload ${params.sourceMediaPath} yourself.`
        )
      }
    }
    if (params.referenceAudioPaths?.length === 1) {
      const uploaded = await uploadLocalMediaToYapper(params.referenceAudioPaths[0])
      if (uploaded.ok && uploaded.assetId) {
        yapperOnlyPromptLines.push(
          `The audio is already uploaded to Yapper as assetId "${uploaded.assetId}" — pass it directly as audioAssetId. Do not try to upload ${params.referenceAudioPaths[0]} yourself.`
        )
      }
    }
  }

  // fal's hosted MCP `upload_file` tool only accepts a remote URL (stateless
  // server) — it has no way to read a local disk path the way muapi's stdio
  // muapi_upload_file or Lyme Hype's own bundled Gemini wrapper can. When fal
  // is the only attached connector, pre-upload local reference/source files
  // through the REST storage flow (same pattern as the Yapper block above)
  // instead of asking the agent to find an upload tool that doesn't exist for
  // fal — this is the cross-cutting asset-upload gap flagged since the first
  // enrichment run (node-enrichment-report.md Recommendations #1).
  const falOnlyPromptLines: string[] = []
  if (attached.length === 1 && attached[0] === 'fal') {
    const localPaths = [
      ...(params.referenceImagePaths ?? []),
      params.startFramePath,
      params.endFramePath,
      params.sourceMediaPath,
      ...(params.referenceAudioPaths ?? [])
    ].filter((p): p is string => !!p)
    for (const path of localPaths) {
      const uploaded = await uploadLocalFileToFal(path)
      if (uploaded.ok && uploaded.url) {
        falOnlyPromptLines.push(
          `${path} is already uploaded to fal as ${uploaded.url} — pass this URL directly wherever the tool wants that file. Do not try to upload ${path} yourself.`
        )
      }
    }
  }

  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), GENERATION_TIMEOUT_MS)
  const { env: authEnv, model } = llmAuthEnv()

  // Hard backstop: this agent runs on the user's machine, so it may ONLY call
  // tools from the EXACT servers this run attached — never a built-in
  // (Bash/Write/etc.) and never a server inherited from the environment (a
  // live run 2026-08-30 saw the nested agent offered a claude.ai-connected
  // server from the OPERATOR'S session and try it first). Bare allowedTools
  // entries pre-approve whole servers before canUseTool is consulted (the SDK
  // warns CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), so allowedTools is deliberately
  // NOT passed — every call falls through to this callback. No bypassPermissions.
  //
  // Second backstop: some connectors expose tools that SPEND MONEY or mutate
  // credentials alongside their generation tools (muapi ships account_topup —
  // a Stripe checkout — plus keys_create/keys_delete). Denied by pattern here
  // AND by exact name via disallowedTools (belt and suspenders).
  const DENIED_TOOL_RE = /topup|top_up|checkout|payment|billing|purchase|keys_create|keys_delete|key_create|key_delete|delete_account/i
  const attachedServers = new Set(Object.keys(servers))
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: 'allow'; updatedInput: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > => {
    // ToolSearch only loads deferred MCP tool schemas — the agent needs it
    // BEFORE it can call any attached server's tools (observed in live runs).
    if (toolName === 'ToolSearch') return { behavior: 'allow', updatedInput: input }
    if (!toolName.startsWith('mcp__')) {
      return { behavior: 'deny', message: `Blocked non-generation tool: ${toolName}` }
    }
    const serverName = toolName.split('__')[1] ?? ''
    if (!attachedServers.has(serverName)) {
      return { behavior: 'deny', message: `Blocked tool from unattached server: ${toolName}` }
    }
    if (DENIED_TOOL_RE.test(toolName)) {
      return { behavior: 'deny', message: `Blocked spend/credential tool: ${toolName}` }
    }
    return { behavior: 'allow', updatedInput: input }
  }

  try {
    const { query } = await loadSdk()
    const preUploadLines = [...yapperOnlyPromptLines, ...falOnlyPromptLines]
    const prompt = preUploadLines.length
      ? `${buildPrompt(params)}\n${preUploadLines.join('\n')}`
      : buildPrompt(params)
    // The SDK reports a failed subprocess as a bare "exited with code 1"; without this
    // the actual cause (a connector that won't launch, a rejected option) is invisible.
    // A config that cannot be spawned should say so in words. Windows' limit is
    // 32,767 characters for the whole command line; the config is the bulk of it.
    const configSize = JSON.stringify(servers).length
    if (configSize > 24_000) {
      console.warn(
        `[generation] MCP config is ${configSize} chars across ${Object.keys(servers).length} connector(s) — ` +
          'close to the Windows command-line limit. Restrict the generation to one connector if this fails.'
      )
    }
    const stream = query({
      prompt,
      options: {
        stderr: (data: string) => {
          const line = data.trim()
          if (!line) return
          stderrTail.push(line)
          console.error('[generation:sdk]', line.slice(0, 400))
        },
        abortController: abort,
        maxTurns: 12,
        maxBudgetUsd: ORCHESTRATION_BUDGET_USD,
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
    let promptUsed: string | undefined

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') text += block.text
          // Capture what the agent ACTUALLY sent to each tool — the ground truth
          // for prompt-language routing (the zh translation is verified here, not
          // taken on the agent's word). Logged and carried on the result.
          if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown> | undefined
            const sent = typeof input?.['prompt'] === 'string' ? (input['prompt'] as string) : undefined
            if (sent) promptUsed = sent
            console.error(
              '[generation:tool]',
              block.name,
              JSON.stringify(input ?? {}).slice(0, 500)
            )
          }
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
    // The SDK's figure is the agent's TOKEN cost, never the connector's charge
    // (which lands on the connector's own account and is not observable here).
    // Label it as such, and count it as dollars only when it actually is.
    const llmLabel = describeLlmCost(costUsd)
    const note = `via ${attached.join(', ')}${llmLabel ? ` · ${llmLabel}` : ''}`
    const billedUsd = llmBilling() === 'api' ? costUsd : null
    // Log before returning: if the renderer that asked for this is already gone
    // (reload, crash, or an MCP-driven call with no UI), the ledger is the only
    // thing that can hand the result back later.
    recordGeneration({
      src: saved.url,
      thumbSrc: saved.thumbUrl,
      mediaType: params.mediaType,
      prompt: params.prompt,
      note
    })
    return {
      ok: true,
      src: saved.url,
      thumbSrc: saved.thumbUrl,
      mediaType: params.mediaType,
      note,
      promptUsed,
      costUsd: billedUsd
    }
  } catch (error) {
    const base =
      error instanceof Error ? error.message : String(error)
    const detail = stderrTail.length ? ` — ${stderrTail.slice(-3).join(' | ').slice(0, 500)}` : ''
    return {
      ok: false,
      mediaType: params.mediaType,
      error: abort.signal.aborted
        ? `Generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s.`
        : `${base}${detail}`
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * What every caller gets: the single-shot runner wrapped in the safeguard
 * (prompt refinement for thin prompts and local models; vision verify-and-retry
 * for local images). See generation-guard.ts for why negatives are not it.
 */
export async function runGeneration(params: GenerationParams): Promise<GenerationResult> {
  return guardedGeneration(params, runGenerationOnce)
}
