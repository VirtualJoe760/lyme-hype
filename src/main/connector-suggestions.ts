import { shell } from 'electron'
import type { ConnectorDef, ConnectorSuggestion } from '@shared/types'
import { CHATREALTY_CONNECTOR_ID, chatRealtyConnectorDef, hasChatRealtyToken } from './chatrealty'
import { saveConnector } from './connectors-store'
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
    blurb: 'Image + video + 3D across many models. Remote MCP — needs http transport (coming).',
    category: 'multi',
    keyPageUrl: 'https://www.krea.ai/settings/api-tokens',
    available: false,
    note: 'http MCP support is a Phase 4 item.',
    template: () => null
  },
  {
    id: 'fal',
    name: 'fal (Seedance +1000 models)',
    blurb: 'Direct Seedance and a huge model catalog. Remote MCP — needs http transport (coming). Redundant with muapi.',
    category: 'video',
    keyPageUrl: 'https://fal.ai/dashboard/keys',
    available: false,
    note: 'http MCP support is a Phase 4 item.',
    template: () => null
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Nano Banana image + Veo video. Needs a small stdio wrapper (coming); image/video are paid-tier.',
    category: 'multi',
    keyPageUrl: 'https://aistudio.google.com/apikey',
    available: false,
    note: 'Bundled @google/genai wrapper is a Phase 4 item.',
    template: () => null
  },
  {
    id: 'yapper',
    name: 'Yapper',
    blurb: 'Seedance/Sora/Kling video studio. Hosted MCP is OAuth-only — needs MCP OAuth support (coming).',
    category: 'video',
    keyPageUrl: 'https://yapper.so/account/developer',
    available: false,
    note: 'MCP OAuth support is a Phase 4 item.',
    template: () => null
  }
]

function isInstalled(entry: CatalogEntry, installedIds: Set<string>): boolean {
  if (installedIds.has(entry.id)) return true
  if (entry.id === CHATREALTY_CONNECTOR_ID) return hasChatRealtyToken()
  return readSecretValue(entry.id) !== null
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
