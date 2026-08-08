import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { CLAUDE_CREDENTIAL_ID } from '@shared/types'
import { readSecretValue } from './credential-vault'

/**
 * Per-user Claude auth. Anthropic's terms forbid third-party apps from offering
 * claude.ai *subscription* login via the Agent SDK without prior approval, so
 * the shipped path is "bring your own Anthropic API key": the user's key is
 * entered through the native secure modal, stored in safeStorage, and injected
 * into the SDK as ANTHROPIC_API_KEY at query time — never in agent context.
 *
 * In dev, when no key is stored, the SDK falls back to this machine's Claude
 * Code login (that's why runAgentPrompt only sets env when a key is present).
 */
export { CLAUDE_CREDENTIAL_ID }

export function resolveClaudeApiKey(): string | null {
  const fromVault = readSecretValue(CLAUDE_CREDENTIAL_ID)
  if (fromVault) return fromVault

  const envLocal = join(app.getAppPath(), '.env.local')
  if (existsSync(envLocal)) {
    const match = readFileSync(envLocal, 'utf-8').match(/^ANTHROPIC_API_KEY=(.*)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

export function hasClaudeApiKey(): boolean {
  return resolveClaudeApiKey() !== null
}
