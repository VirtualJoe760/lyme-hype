import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { app } from 'electron'
import type {
  ConversationTurnRequest,
  ConversationTurnResult,
  ImprovePromptResult,
  ShotBreakdownResult
} from '@shared/types'
import { resolveClaudeAuthOverride } from './claude-auth'
import { resolveActiveProvider } from './model-providers'

/**
 * Generic persistent multi-turn conversation plumbing — the architectural gap
 * docs/ui/scripting-panel.md called out: every earlier agent call
 * (`runAgentPrompt`, `runGeneration`) is single-turn. Built once, generically,
 * for BOTH consumers that need it (the Scripting panel and the Motion graphics
 * wizard's abstraction/iterate stages), per the shared-plumbing decision in
 * both specs.
 *
 * Mechanism: the SDK persists sessions and `options.resume` continues one, so
 * a turn is query() with resume + the new prompt. If resuming isn't possible
 * (first turn, or the SDK session vanished across restarts/machine changes),
 * the turn falls back to replaying the caller-persisted transcript — the
 * conversation's source of truth is Lyme Hype's own session JSON, never SDK
 * internals.
 *
 * Pure conversation: no tools, no MCP connectors, settingSources [] — same
 * isolation as every other agent call in the app.
 */

type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<AgentSdk> | null = null
function loadSdk(): Promise<AgentSdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

const TURN_TIMEOUT_MS = 180_000

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
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

function transcriptPreamble(history: NonNullable<ConversationTurnRequest['history']>): string {
  const lines = history.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`)
  return `Conversation so far (replayed — continue it naturally):\n\n${lines.join('\n\n')}\n\n---\n\n`
}

/** Builds the streaming-input message so image attachments ride the same turn
 *  as the text (vision input — the Motion graphics references stage). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPromptInput(text: string, imagePaths: string[]): string | AsyncIterable<any> {
  if (imagePaths.length === 0) return text
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  for (const p of imagePaths) {
    const mime = IMAGE_MIME[extname(p).toLowerCase()]
    if (!mime) continue
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mime, data: readFileSync(p).toString('base64') }
    })
  }
  content.push({ type: 'text', text })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function* messages(): AsyncIterable<any> {
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: ''
    }
  }
  return messages()
}

async function runTurnOnce(
  request: ConversationTurnRequest,
  useResume: boolean,
  onText: (text: string) => void
): Promise<ConversationTurnResult> {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS)
  try {
    const { query } = await loadSdk()
    const { env: authEnv, model } = llmAuthEnv()
    const promptText =
      !useResume && request.history?.length
        ? transcriptPreamble(request.history) + request.prompt
        : request.prompt

    const stream = query({
      prompt: buildPromptInput(promptText, request.imagePaths ?? []),
      options: {
        abortController: abort,
        maxTurns: 1,
        allowedTools: [],
        settingSources: [],
        ...(useResume && request.resumeSessionId ? { resume: request.resumeSessionId } : {}),
        ...(authEnv ? { env: { ...process.env, ...authEnv } } : {}),
        // A per-request model wins over the provider's default — utility turns
        // (prompt refinement, vision QA) pin a cheap one; a configured
        // anthropic-compatible provider keeps its own model regardless.
        ...(request.model ?? model ? { model: request.model ?? model } : {}),
        systemPrompt:
          request.systemPrompt ??
          'You are the Lyme Hype studio agent inside a desktop content-creation app, helping develop scripts and creative direction for short-form reels. Be a concrete, useful collaborator: draft, revise, answer structural questions. Plain prose, no markdown headers.',
        cwd: app.getPath('userData')
      }
    })

    let text = ''
    let costUsd: number | null = null
    let agentSessionId: string | undefined

    for await (const message of stream) {
      if (message.type === 'system' && message.subtype === 'init') {
        agentSessionId = message.session_id
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            text += block.text
            onText(block.text)
          }
        }
      } else if (message.type === 'result') {
        if ('total_cost_usd' in message && typeof message.total_cost_usd === 'number') {
          costUsd = message.total_cost_usd
        }
        if (message.subtype !== 'success') {
          return { ok: false, text, agentSessionId, costUsd, error: `Turn ended with: ${message.subtype}` }
        }
      }
    }
    if (text.length === 0) return { ok: false, text, agentSessionId, costUsd, error: 'Empty reply.' }
    return { ok: true, text, agentSessionId, costUsd }
  } catch (error) {
    return {
      ok: false,
      text: '',
      costUsd: null,
      error: abort.signal.aborted
        ? `No reply within ${TURN_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function runConversationTurn(
  request: ConversationTurnRequest,
  onText: (text: string) => void = () => {}
): Promise<ConversationTurnResult> {
  if (!request.prompt.trim()) return { ok: false, text: '', costUsd: null, error: 'Empty prompt.' }
  if (request.resumeSessionId) {
    const resumed = await runTurnOnce(request, true, onText)
    if (resumed.ok) return resumed
    // Replay the transcript fresh ONLY when the failure looks like a lost/
    // stale SDK session: nothing streamed and it wasn't a timeout. A turn
    // that produced text or timed out really ran — re-running it would bill
    // (and answer) twice for a failure resume didn't cause.
    const timedOut = /within \d+s/.test(resumed.error ?? '')
    const sessionLost =
      resumed.text.length === 0 &&
      !timedOut
    if (!sessionLost) return resumed
    const replayed = await runTurnOnce(request, false, onText)
    return replayed.ok ? replayed : resumed
  }
  return runTurnOnce(request, false, onText)
}

const BREAKDOWN_PROMPT = [
  'Break the script we have been developing in this conversation into a shot list for a storyboard.',
  'Reply with ONLY a JSON array, no prose before or after, in exactly this shape:',
  '[{"label": "short shot name (max 40 chars)", "description": "1-3 sentences: what happens in this shot"}]',
  'Order the shots as they should appear. 3-12 shots is typical.'
].join('\n')

/** Shot breakdown — an agent turn in the SAME conversation (the agent already
 *  has the full script in context), parsed into structured shots. */
export async function runShotBreakdown(
  request: Omit<ConversationTurnRequest, 'prompt'>
): Promise<ShotBreakdownResult> {
  const turn = await runConversationTurn({ ...request, prompt: BREAKDOWN_PROMPT })
  if (!turn.ok) {
    return { ok: false, shots: [], agentSessionId: turn.agentSessionId, costUsd: turn.costUsd, error: turn.error }
  }
  const match = turn.text.match(/\[[\s\S]*\]/)
  if (!match) {
    return {
      ok: false,
      shots: [],
      agentSessionId: turn.agentSessionId,
      costUsd: turn.costUsd,
      error: 'The agent did not return a parsable shot list.'
    }
  }
  try {
    const parsed: unknown = JSON.parse(match[0])
    const shots = (Array.isArray(parsed) ? parsed : [])
      .filter(
        (s): s is { label: unknown; description: unknown } =>
          typeof s === 'object' && s !== null && 'label' in s && 'description' in s
      )
      .map((s) => ({ label: String(s.label).slice(0, 60), description: String(s.description) }))
      .filter((s) => s.label.trim().length > 0)
    if (shots.length === 0) {
      return { ok: false, shots: [], agentSessionId: turn.agentSessionId, costUsd: turn.costUsd, error: 'Shot list came back empty.' }
    }
    return { ok: true, shots, agentSessionId: turn.agentSessionId, costUsd: turn.costUsd }
  } catch {
    return { ok: false, shots: [], agentSessionId: turn.agentSessionId, costUsd: turn.costUsd, error: 'Shot list JSON failed to parse.' }
  }
}

/** The prompt-improvement step of the script → Storyboard handoff: shot
 *  content + the user's feeling annotation → the panel's generation prompt.
 *  Deliberately a lighter one-shot call, NOT the ongoing chat conversation
 *  (docs/ui/scripting-panel.md). Structured-prose single field, per the
 *  jboogx structured-shot-prompt idea adapted to the panel's one note field. */
export async function runImproveShotPrompt(input: {
  label: string
  shotDescription: string
  feeling: string
}): Promise<ImprovePromptResult> {
  const turn = await runConversationTurn(
    {
      conversationId: `improve-${Date.now()}`,
      prompt: [
        `Shot: ${input.label}`,
        `What happens: ${input.shotDescription}`,
        input.feeling.trim() ? `How it should land (the user's feeling for it): ${input.feeling}` : '',
        '',
        'Write the generation prompt for this shot as one compact paragraph of structured prose covering:',
        'subject and action, framing/shot type, lighting, production design/style, motion, and the emotional subtext.',
        'Reply with ONLY the prompt text — no preamble, no quotes, no markdown.'
      ]
        .filter(Boolean)
        .join('\n'),
      systemPrompt:
        'You author precise, evocative prompts for AI image/video generation models. You reply with only the prompt text.'
    },
    () => {}
  )
  if (!turn.ok) return { ok: false, prompt: '', costUsd: turn.costUsd, error: turn.error }
  return { ok: true, prompt: turn.text.trim(), costUsd: turn.costUsd }
}
