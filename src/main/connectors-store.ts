import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ConnectorDef, ConnectorTestResult, ConnectorView } from '@shared/types'
import { readSecretValue } from './credential-vault'
import { probeStdioMcp } from './mcp-probe'

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

/** Live reachability check for a stdio connector: spawn it, handshake, count
 *  tools. The stored credential (if any) is injected exactly as it would be at
 *  real use, but never returned. */
export async function testConnector(id: string): Promise<ConnectorTestResult> {
  const def = listConnectors().find((d) => d.id === id)
  if (!def) return { ok: false, error: 'Connector not found.' }
  if (def.kind !== 'stdio' || !def.command) {
    return { ok: false, error: 'Live test currently supports stdio connectors only.' }
  }
  const token = readSecretValue(id)
  const env = { ...(def.env ?? {}) }
  if (def.authType !== 'none' && def.secretKey && token) env[def.secretKey] = token

  const probe = await probeStdioMcp({ command: def.command, args: def.args ?? [], env })
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
