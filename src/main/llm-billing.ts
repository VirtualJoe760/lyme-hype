import { resolveClaudeAuthOverride } from './claude-auth'
import { resolveActiveProvider } from './model-providers'

/**
 * Whether the agent's own tokens are a bill or plan consumption (AGENTS.md §1.8).
 *
 * The SDK reports `total_cost_usd` as an API-list-price equivalent regardless of
 * how the call was authenticated. On the Claude Code login that number is plan
 * usage, not a charge; it is a real dollar amount only under an API key or an
 * anthropic-compatible provider (Kimi, a custom endpoint). Generation cost — what
 * the connector charges for the media — is a different number the SDK never sees.
 */
export type LlmBilling = 'plan' | 'api'

export function llmBilling(): LlmBilling {
  const provider = resolveActiveProvider()
  if (provider.def.kind === 'anthropic-compatible') return 'api'
  return resolveClaudeAuthOverride()?.kind === 'apiKey' ? 'api' : 'plan'
}

/** "$0.383" when billed, "tokens $0.383 (plan)" when not — never a bare dollar
 *  figure for something that is not a bill. */
export function describeLlmCost(costUsd: number | null | undefined): string {
  if (costUsd == null) return ''
  return llmBilling() === 'api' ? `$${costUsd.toFixed(3)}` : `tokens $${costUsd.toFixed(3)} (plan)`
}
