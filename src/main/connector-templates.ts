import type { ConnectorDef } from '@shared/types'

/**
 * Built-in connector templates beyond ChatRealty — pre-filled so the common
 * generation tools are one click to add in the Connections panel, then a
 * credential via the native secure modal. Researched 2026-08-08; see
 * docs/connections-and-credentials.md for the full landscape (and why Midjourney
 * / Seedance / Dreamina are NOT here — they're models reachable through muapi,
 * not separate keys — and why Krea/fal (http) and Yapper (OAuth) wait on
 * Phase 4 transport support).
 *
 * These two are the stdio + API-key shape that already runs end to end today.
 */
export const BUILTIN_CONNECTOR_TEMPLATES: ConnectorDef[] = [
  {
    id: 'muapi',
    name: 'muapi',
    kind: 'stdio',
    command: 'npx',
    args: ['-y', 'muapi-cli', 'mcp', 'serve'],
    authType: 'apiKey',
    secretKey: 'MUAPI_API_KEY',
    secretFieldLabel: 'muapi API key',
    builtin: true,
    docUrl: 'https://muapi.ai/access-keys'
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    kind: 'stdio',
    command: 'uvx',
    args: ['elevenlabs-mcp'],
    authType: 'apiKey',
    secretKey: 'ELEVENLABS_API_KEY',
    secretFieldLabel: 'ElevenLabs API key',
    builtin: true,
    docUrl: 'https://elevenlabs.io/app/settings/api-keys'
  }
]
