import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ConnectorDef, ConnectorTestResult, ConnectorView } from '@shared/types'
import { hasChatRealtyToken } from './chatrealty'
import { readSecretValue } from './credential-vault'
import { httpAuthHeaders, probeHttpMcp } from './mcp-http'
import { getOAuthAccessToken } from './mcp-oauth'
import { probeStdioMcp, type McpProbeResult } from './mcp-probe'

/** Auth headers for an http connector, whatever its auth type. OAuth resolves
 *  (and silently refreshes) the vault-stored token; key types inject the typed
 *  secret. Empty when not connected — the probe then reports the 401 honestly. */
export async function resolveHttpHeaders(def: ConnectorDef): Promise<Record<string, string>> {
  if (def.authType === 'oauth') {
    const token = await getOAuthAccessToken(def.id)
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
  return httpAuthHeaders(def.authType, def.secretKey, readSecretValue(def.id))
}

function storeFile(): string {
  return join(app.getPath('userData'), 'connectors.json')
}

function readUserConnectors(): ConnectorDef[] {
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), 'utf-8'))
    return Array.isArray(parsed) ? (parsed as ConnectorDef[]) : []
  } catch {
    return []
  }
}

function writeUserConnectors(defs: ConnectorDef[]): void {
  const file = storeFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(defs, null, 2), 'utf-8')
  renameSync(tmp, file)
}

/** Installed connectors are exactly what the user added — from the suggested
 *  catalog or custom. All removable; each tagged with whether a credential is
 *  stored (never the value). Known tools live in the suggestions catalog, not
 *  here, so nothing is a forced, undeletable placeholder. */
export function listConnectors(): ConnectorView[] {
  return readUserConnectors().map((def) => ({
    ...def,
    builtin: false,
    // ChatRealty's token may live in the dev .env.local fallback rather than
    // the vault — that still counts as credentialed (it's what pulls use).
    hasCredential:
      readSecretValue(def.id) !== null ||
      (def.id === 'chatrealty' && hasChatRealtyToken())
  }))
}

export function installedConnectorIds(): string[] {
  return readUserConnectors().map((d) => d.id)
}

export function saveConnector(def: ConnectorDef): void {
  const cleaned: ConnectorDef = { ...def, builtin: false }
  const user = readUserConnectors().filter((d) => d.id !== def.id)
  user.push(cleaned)
  writeUserConnectors(user)
}

export function deleteConnector(id: string): void {
  writeUserConnectors(readUserConnectors().filter((d) => d.id !== id))
}

/** Live reachability check for a connector: handshake and count tools. Works
 *  for stdio (spawn) and Streamable-HTTP (POST) transports. The stored
 *  credential (if any) is injected exactly as it would be at real use — env var
 *  for stdio, header for http — but never returned. */
export async function testConnector(id: string): Promise<ConnectorTestResult> {
  const def = listConnectors().find((d) => d.id === id)
  if (!def) return { ok: false, error: 'Connector not found.' }
  const token = readSecretValue(id)

  let probe: McpProbeResult
  if (def.kind === 'stdio' && def.command) {
    const env = { ...(def.env ?? {}) }
    if (def.authType !== 'none' && def.secretKey && token) env[def.secretKey] = token
    probe = await probeStdioMcp({ command: def.command, args: def.args ?? [], env })
  } else if (def.kind === 'http' && def.url) {
    probe = await probeHttpMcp({ url: def.url, headers: await resolveHttpHeaders(def) })
  } else {
    return { ok: false, error: 'Connector is missing a command (stdio) or url (http).' }
  }

  if (!probe.ok) return { ok: false, error: probe.error ?? 'Connection failed.' }
  return {
    ok: true,
    serverName: probe.serverInfo?.name,
    serverVersion: probe.serverInfo?.version,
    toolCount: probe.tools.length,
    note:
      def.authType !== 'none' && !token ? 'Reachable — set a credential to authorize calls.' : undefined
  }
}
