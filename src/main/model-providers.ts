import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ModelProviderDef, ModelProviderView } from '@shared/types'
import { readSecretValue } from './credential-vault'

export const CLAUDE_DEFAULT_PROVIDER_ID = 'claude-default'

/**
 * Built-in provider templates. "Claude (this machine's login)" is the default and
 * needs no config — the agent uses its normal auth (claude-auth.ts). Kimi ships an
 * Anthropic-compatible endpoint so it drops straight in with a base URL + key.
 * A fully custom Anthropic-compatible provider (a local model behind a proxy,
 * OpenRouter, etc.) is added by the user via the Models tab.
 */
const BUILTIN_PROVIDERS: ModelProviderDef[] = [
  {
    id: CLAUDE_DEFAULT_PROVIDER_ID,
    name: "Claude (this machine's login)",
    kind: 'claude-default',
    secretFieldLabel: 'Anthropic API key or setup-token',
    builtin: true,
    docUrl: 'https://code.claude.com/docs/en/authentication'
  },
  {
    id: 'kimi',
    name: 'Kimi K3 (Moonshot)',
    kind: 'anthropic-compatible',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    model: 'kimi-k3',
    secretFieldLabel: 'Moonshot API key',
    builtin: true,
    docUrl: 'https://platform.moonshot.ai/'
  }
]

interface ProvidersFile {
  userProviders: ModelProviderDef[]
  activeId: string
}

function storeFile(): string {
  return join(app.getPath('userData'), 'model-providers.json')
}

function read(): ProvidersFile {
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), 'utf-8')) as Partial<ProvidersFile>
    return {
      userProviders: Array.isArray(parsed.userProviders) ? parsed.userProviders : [],
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : CLAUDE_DEFAULT_PROVIDER_ID
    }
  } catch {
    return { userProviders: [], activeId: CLAUDE_DEFAULT_PROVIDER_ID }
  }
}

function write(data: ProvidersFile): void {
  const file = storeFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

function allDefs(): ModelProviderDef[] {
  const builtinIds = new Set(BUILTIN_PROVIDERS.map((p) => p.id))
  const user = read().userProviders.filter((p) => !builtinIds.has(p.id))
  return [...BUILTIN_PROVIDERS, ...user]
}

export function listModelProviders(): ModelProviderView[] {
  const { activeId } = read()
  // If the active provider was deleted, fall back to the Claude default.
  const known = allDefs().some((p) => p.id === activeId)
  const effectiveActive = known ? activeId : CLAUDE_DEFAULT_PROVIDER_ID
  return allDefs().map((def) => ({
    ...def,
    // Claude-default is always usable (this machine's Claude Code login, with or
    // without an explicit override). Other providers need a stored key.
    hasCredential:
      def.kind === 'claude-default' ? true : readSecretValue(def.id) !== null,
    active: def.id === effectiveActive
  }))
}

export function saveModelProvider(def: ModelProviderDef): void {
  if (BUILTIN_PROVIDERS.some((p) => p.id === def.id)) return
  const data = read()
  data.userProviders = data.userProviders.filter((p) => p.id !== def.id)
  data.userProviders.push({ ...def, kind: 'anthropic-compatible', builtin: false })
  write(data)
}

export function deleteModelProvider(id: string): void {
  if (BUILTIN_PROVIDERS.some((p) => p.id === id)) return
  const data = read()
  data.userProviders = data.userProviders.filter((p) => p.id !== id)
  if (data.activeId === id) data.activeId = CLAUDE_DEFAULT_PROVIDER_ID
  write(data)
}

export function setActiveModelProvider(id: string): void {
  if (!allDefs().some((p) => p.id === id)) return
  const data = read()
  data.activeId = id
  write(data)
}

export interface ResolvedProvider {
  def: ModelProviderDef
  /** Present for anthropic-compatible providers with a stored credential. */
  key: string | null
}

/** The active provider plus its credential, for the agent. */
export function resolveActiveProvider(): ResolvedProvider {
  const { activeId } = read()
  const def = allDefs().find((p) => p.id === activeId) ?? BUILTIN_PROVIDERS[0]
  return { def, key: readSecretValue(def.id) }
}
