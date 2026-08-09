import { join } from 'node:path'
import { app, shell } from 'electron'
import type { ConnectorDef, ConnectorSuggestion } from '@shared/types'
import { CHATREALTY_CONNECTOR_ID, chatRealtyConnectorDef, hasChatRealtyToken } from './chatrealty'
import { installedConnectorIds, saveConnector } from './connectors-store'
import { readSecretValue } from './credential-vault'

interface CatalogEntry {
  id: string
  name: string
  blurb: string
  category: string
  keyPageUrl: string
  /** false = shown so the user can grab a key, but Add is deferred until the
   *  transport (http MCP / OAuth / Gemini wrapper) lands. */
  available: boolean
  note?: string
  /** How it installs as a connector. Null for not-yet-supported transports. */
  template: () => ConnectorDef | null
}

/**
 * The tools we've walked through — the suggested-connectors catalog. Each opens
 * its real key/login page in the browser and (where supported today) installs as
 * a working connector. Direct-to-source is preferred where a provider ships its
 * own API; aggregators (muapi/Krea/fal) are here because they cover models with
 * no practical direct path (Seedance, Midjourney, etc.).
 */
const CATALOG: CatalogEntry[] = [
  {
    id: CHATREALTY_CONNECTOR_ID,
    name: 'ChatRealty',
    blurb: 'Real-estate MLS data — search listings and pull real photos onto the canvas.',
    category: 'data',
    keyPageUrl: 'https://jpsrealtor.com/agent/settings',
    available: true,
    template: () => chatRealtyConnectorDef()
  },
  {
    id: 'muapi',
    name: 'muapi',
    blurb: 'One key for image + video + audio — Seedance, Kling, Veo, Flux, Midjourney V7, Suno.',
    category: 'multi',
    keyPageUrl: 'https://muapi.ai/access-keys',
    available: true,
    template: () => ({
      id: 'muapi',
      name: 'muapi',
      kind: 'stdio',
      command: 'npx',
      args: ['-y', 'muapi-cli', 'mcp', 'serve'],
      authType: 'apiKey',
      secretKey: 'MUAPI_API_KEY',
      secretFieldLabel: 'muapi API key',
      docUrl: 'https://muapi.ai/access-keys'
    })
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    blurb: 'Premium voiceover, music, and sound effects for reels.',
    category: 'audio',
    keyPageUrl: 'https://elevenlabs.io/app/settings/api-keys',
    available: true,
    note: 'Needs the `uv` runtime on this machine (uvx elevenlabs-mcp).',
    template: () => ({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      kind: 'stdio',
      command: 'uvx',
      args: ['elevenlabs-mcp'],
      authType: 'apiKey',
      secretKey: 'ELEVENLABS_API_KEY',
      secretFieldLabel: 'ElevenLabs API key',
      docUrl: 'https://elevenlabs.io/app/settings/api-keys'
    })
  },
  {
    id: 'krea',
    name: 'Krea',
    blurb: 'Image + video + 3D across many models, over remote http MCP.',
    category: 'multi',
    keyPageUrl: 'https://www.krea.ai/settings/api-tokens',
    available: true,
    note: 'Remote http MCP. Add, set your token, then Test to confirm the endpoint/auth.',
    template: () => ({
      id: 'krea',
      name: 'Krea',
      kind: 'http',
      url: 'https://api.krea.ai/mcp',
      authType: 'bearer',
      secretKey: 'Authorization',
      secretFieldLabel: 'Krea API token',
      docUrl: 'https://www.krea.ai/settings/api-tokens'
    })
  },
  {
    id: 'fal',
    name: 'fal (Seedance +1000 models)',
    blurb: 'Direct Seedance and a huge model catalog, over remote http MCP. Redundant with muapi.',
    category: 'video',
    keyPageUrl: 'https://fal.ai/dashboard/keys',
    available: true,
    note: 'Remote http MCP (verified: plain Bearer auth). Add, set your key, then Test.',
    template: () => ({
      id: 'fal',
      name: 'fal',
      kind: 'http',
      url: 'https://mcp.fal.ai/mcp',
      authType: 'bearer',
      secretKey: 'Authorization',
      secretFieldLabel: 'fal API key',
      docUrl: 'https://fal.ai/dashboard/keys'
    })
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Nano Banana image + Veo video via our bundled wrapper. Image/video are paid-tier keys.',
    category: 'multi',
    keyPageUrl: 'https://aistudio.google.com/apikey',
    available: true,
    note: 'Runs the bundled resources/gemini-mcp.cjs wrapper with your GEMINI_API_KEY.',
    template: () => ({
      id: 'gemini',
      name: 'Google Gemini',
      kind: 'stdio',
      command: 'node',
      // Resolved at install time; in dev app.getAppPath() is the repo root.
      args: [join(app.getAppPath(), 'resources', 'gemini-mcp.cjs')],
      authType: 'apiKey',
      secretKey: 'GEMINI_API_KEY',
      secretFieldLabel: 'Gemini API key',
      docUrl: 'https://aistudio.google.com/apikey'
    })
  },
  {
    id: 'openai',
    name: 'OpenAI Images',
    blurb: 'gpt-image-1 via our bundled wrapper — the second storyboard-tier image option alongside Gemini.',
    category: 'image',
    keyPageUrl: 'https://platform.openai.com/api-keys',
    available: true,
    note: 'Runs the bundled resources/openai-image-mcp.cjs wrapper with your OPENAI_API_KEY.',
    template: () => ({
      id: 'openai',
      name: 'OpenAI Images',
      kind: 'stdio',
      command: 'node',
      // Resolved at install time; in dev app.getAppPath() is the repo root.
      args: [join(app.getAppPath(), 'resources', 'openai-image-mcp.cjs')],
      authType: 'apiKey',
      secretKey: 'OPENAI_API_KEY',
      secretFieldLabel: 'OpenAI API key',
      docUrl: 'https://platform.openai.com/api-keys'
    })
  },
  {
    id: 'yapper',
    name: 'Yapper',
    blurb: 'Seedance/Sora/Kling video studio over remote http MCP — connects with an OAuth login, no key to paste.',
    category: 'video',
    keyPageUrl: 'https://yapper.so/account/developer',
    available: true,
    note: 'Add, then hit "Connect account" — approval happens in your browser.',
    template: () => ({
      id: 'yapper',
      name: 'Yapper',
      kind: 'http',
      url: 'https://yapper.so/mcp/connector',
      authType: 'oauth',
      secretFieldLabel: 'OAuth (browser sign-in)',
      docUrl: 'https://yapper.so/account/developer'
    })
  }
]

function isInstalled(entry: CatalogEntry, installedIds: Set<string>): boolean {
  if (installedIds.has(entry.id)) return true
  if (entry.id === CHATREALTY_CONNECTOR_ID) return hasChatRealtyToken()
  return readSecretValue(entry.id) !== null
}

/**
 * Self-heal the "credential exists but no connector def" split: a catalog
 * tool whose key is in the vault (or ChatRealty's env-fallback token) but
 * whose def is missing from connectors.json gets its template re-installed.
 * The state arises when a def is deleted without its secret (the selftest's
 * old add/delete round-trip did exactly this to real installs) or when a key
 * predates the def — either way the suggestion tile said "✓ installed" while
 * the Installed list, generation, and direct tool calls couldn't see it.
 */
export function reconcileInstalledConnectors(): void {
  const installed = new Set(installedConnectorIds())
  for (const entry of CATALOG) {
    if (installed.has(entry.id) || !entry.available) continue
    if (!isInstalled(entry, installed)) continue
    const def = entry.template()
    if (def) saveConnector(def)
  }
}

export function listSuggestions(installedIds: string[]): ConnectorSuggestion[] {
  const set = new Set(installedIds)
  return CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    blurb: e.blurb,
    category: e.category,
    keyPageUrl: e.keyPageUrl,
    available: e.available,
    note: e.note,
    installed: isInstalled(e, set)
  }))
}

/** Installs a suggestion as a connector. Returns the def so the caller can then
 *  collect its credential via the secure modal. */
export function addSuggestion(id: string): ConnectorDef | null {
  const entry = CATALOG.find((e) => e.id === id)
  if (!entry || !entry.available) return null
  const def = entry.template()
  if (!def) return null
  saveConnector(def)
  return def
}

/** Opens a catalog entry's key page in the user's browser. Only catalog URLs are
 *  honored — the renderer passes an id, never an arbitrary URL. */
export function openSuggestionKeyPage(id: string): void {
  const entry = CATALOG.find((e) => e.id === id)
  if (entry) void shell.openExternal(entry.keyPageUrl)
}
