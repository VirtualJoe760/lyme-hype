/** Agent model providers, Claude auth, themes, and the secure-credential report shapes. */

/**
 * The agent's LLM backend. The default is Claude via this machine's own Claude
 * Code login; other providers are any Anthropic-API-compatible endpoint (Kimi's
 * hosted one, or a local/OpenAI model behind a translation proxy that exposes an
 * Anthropic-shaped API). The agent injects ANTHROPIC_BASE_URL + auth + model.
 */
export type ModelProviderKind = 'claude-default' | 'anthropic-compatible'

export interface ModelProviderDef {
  id: string
  name: string
  kind: ModelProviderKind
  /** anthropic-compatible only: the endpoint the SDK targets via ANTHROPIC_BASE_URL. */
  baseUrl?: string
  /** anthropic-compatible only: the model id to request. */
  model?: string
  /** Label shown in the secure modal when collecting this provider's key. */
  secretFieldLabel: string
  builtin?: boolean
  docUrl?: string
}

export interface ModelProviderView extends ModelProviderDef {
  hasCredential: boolean
  active: boolean
}

export type ClaudeAuthOverrideKind = 'none' | 'apiKey' | 'oauthToken'

export interface ClaudeAuthStatus {
  /** 'none' = using this machine's own Claude Code login (the normal case). */
  override: ClaudeAuthOverrideKind
}

export type ThemeId = 'lime-cut' | 'night-terminal' | 'zest'

export interface AgentStreamEvent {
  kind: 'text' | 'status'
  text: string
}

export interface AgentPingResult {
  ok: boolean
  text: string
  costUsd: number | null
  durationMs: number
  error?: string
}

/** The only credential facts the agent or renderer ever sees — never the value. */
export interface SecretReport {
  connectorId: string
  fieldLabel: string
  length: number
  last4: string
  savedAt: string
}

export interface SecretRequest {
  connectorId: string
  connectorName: string
  fieldLabel: string
}
