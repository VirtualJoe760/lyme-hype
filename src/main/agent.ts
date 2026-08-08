import { app } from 'electron'
import type { AgentPingResult, AgentStreamEvent } from '@shared/types'

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

    const stream = query({
      prompt,
      options: {
        abortController: abort,
        maxTurns: 1,
        allowedTools: [],
        // The studio agent must not inherit this machine's Claude Code settings
        // or any repo CLAUDE.md — Lyme Hype defines its own context.
        settingSources: [],
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
