import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ClaudeAuthOverrideKind } from '@shared/types'
import { readSecretValue } from './credential-vault'

/**
 * Claude auth for a personal tool. Default is this machine's own Claude Code
 * login — the same subscription-backed credential `claude setup-token` mints
 * and Claude Code itself uses, and the same mechanism jboogx's Night Shift and
 * openclaw run on. The SDK picks it up automatically with no env override,
 * which is why nothing needs to be configured for the common case.
 *
 * An explicit override is available for when that's not enough (a different
 * machine with no local Claude Code login, or a dedicated key/token for this
 * app specifically) — either an ANTHROPIC_API_KEY or a CLAUDE_CODE_OAUTH_TOKEN
 * (the value `claude setup-token` prints), entered through the native secure
 * modal and stored in safeStorage like every other credential.
 */
export const CLAUDE_API_KEY_CREDENTIAL_ID = 'anthropic-claude-api-key'
export const CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID = 'anthropic-claude-oauth-token'

export interface ClaudeAuthOverride {
  kind: ClaudeAuthOverrideKind
  value: string
}

function fromEnvLocal(varName: string): string | null {
  const envLocal = join(app.getAppPath(), '.env.local')
  if (!existsSync(envLocal)) return null
  const match = readFileSync(envLocal, 'utf-8').match(new RegExp(`^${varName}=(.*)$`, 'm'))
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
}

/** Oauth token takes priority — it's the one that mirrors a real Claude login. */
export function resolveClaudeAuthOverride(): ClaudeAuthOverride | null {
  const oauthToken = readSecretValue(CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID) ?? fromEnvLocal('CLAUDE_CODE_OAUTH_TOKEN')
  if (oauthToken) return { kind: 'oauthToken', value: oauthToken }

  const apiKey = readSecretValue(CLAUDE_API_KEY_CREDENTIAL_ID) ?? fromEnvLocal('ANTHROPIC_API_KEY')
  if (apiKey) return { kind: 'apiKey', value: apiKey }

  return null
}

export function claudeAuthOverrideKind(): ClaudeAuthOverrideKind {
  return resolveClaudeAuthOverride()?.kind ?? 'none'
}
