import { app } from 'electron'
import type { AgentPingResult, AgentStreamEvent } from '@shared/types'
import { resolveClaudeAuthOverride } from './claude-auth'
import { resolveActiveProvider } from './model-providers'

type AgentSdk = typeof import('@anthropic-ai/claude-agent-sdk')

// Dynamic import keeps this working from the CJS main bundle regardless of the
// SDK shipping ESM-only — rollup preserves import() for externalized deps.
let sdkPromise: Promise<AgentSdk> | null = null
function loadSdk(): Promise<AgentSdk> {
  sdkPromise ??= import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

const PING_TIMEOUT_MS = 120_000

export async function runAgentPrompt(
  prompt: string,
  onEvent: (event: AgentStreamEvent) => void
): Promise<AgentPingResult> {
  const startedAt = Date.now()
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), PING_TIMEOUT_MS)

  try {
    const { query } = await loadSdk()
    onEvent({ kind: 'status', text: 'Contacting agent…' })

    // Which LLM backs the agent. Claude-default = this machine's own Claude Code
    // login (or an explicit Claude override). Any other provider is an
    // Anthropic-API-compatible endpoint (Kimi, or a local/OpenAI model behind a
    // proxy) reached via ANTHROPIC_BASE_URL + a bearer token + an explicit model.
    const provider = resolveActiveProvider()
    let authEnv: Record<string, string> | null = null
    let model: string | undefined

    if (provider.def.kind === 'anthropic-compatible' && provider.def.baseUrl && provider.key) {
      authEnv = { ANTHROPIC_BASE_URL: provider.def.baseUrl, ANTHROPIC_AUTH_TOKEN: provider.key }
      model = provider.def.model
    } else {
      // Claude default: no env override → SDK uses the machine's Claude Code
      // login. An explicit Claude API key / setup-token override is opt-in.
      const override = resolveClaudeAuthOverride()
      authEnv =
        override?.kind === 'oauthToken'
          ? { CLAUDE_CODE_OAUTH_TOKEN: override.value }
          : override?.kind === 'apiKey'
            ? { ANTHROPIC_API_KEY: override.value }
            : null
    }

    const stream = query({
      prompt,
      options: {
        abortController: abort,
        maxTurns: 1,
        allowedTools: [],
        // The studio agent must not inherit this machine's Claude Code settings
        // or any repo CLAUDE.md — Lyme Hype defines its own context.
        settingSources: [],
        ...(authEnv ? { env: { ...process.env, ...authEnv } } : {}),
        ...(model ? { model } : {}),
        systemPrompt:
          'You are the Lyme Hype studio agent, embedded in a desktop content-creation app. Answer briefly.',
        cwd: app.getPath('userData')
      }
    })

    let text = ''
    let costUsd: number | null = null

    for await (const message of stream) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            text += block.text
            onEvent({ kind: 'text', text: block.text })
          }
        }
      } else if (message.type === 'result') {
        if ('total_cost_usd' in message && typeof message.total_cost_usd === 'number') {
          costUsd = message.total_cost_usd
        }
        if (message.subtype !== 'success') {
          return {
            ok: false,
            text,
            costUsd,
            durationMs: Date.now() - startedAt,
            error: `Agent run ended with: ${message.subtype}`
          }
        }
      }
    }

    return { ok: text.length > 0, text, costUsd, durationMs: Date.now() - startedAt }
  } catch (error) {
    const aborted = abort.signal.aborted
    return {
      ok: false,
      text: '',
      costUsd: null,
      durationMs: Date.now() - startedAt,
      error: aborted
        ? `Agent did not respond within ${PING_TIMEOUT_MS / 1000}s`
        : error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timeout)
  }
}
