import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ConnectorDef, ConnectorTestResult, ConnectorView } from '@shared/types'
import { readSecretValue } from './credential-vault'
import { httpAuthHeaders, probeHttpMcp } from './mcp-http'
import { probeStdioMcp, type McpProbeResult } from './mcp-probe'

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
    hasCredential: readSecretValue(def.id) !== null
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
    probe = await probeHttpMcp({ url: def.url, headers: httpAuthHeaders(def.authType, def.secretKey, token) })
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
