import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ConnectorDef, ConnectorTestResult, ConnectorView } from '@shared/types'
import { CHATREALTY_CONNECTOR_ID, chatRealtyConnectorDef, hasChatRealtyToken } from './chatrealty'
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

/** Built-in templates (present by default) plus user-added connectors, each
 *  tagged with whether a credential is stored — never the value. */
export function listConnectors(): ConnectorView[] {
  const builtins = [chatRealtyConnectorDef()]
  const builtinIds = new Set(builtins.map((d) => d.id))
  const user = readUserConnectors().filter((d) => !builtinIds.has(d.id))
  return [...builtins, ...user].map((def) => ({
    ...def,
    // ChatRealty also honors the dev .env.local token, so mirror the same
    // resolution the pull uses instead of only checking the vault.
    hasCredential:
      def.id === CHATREALTY_CONNECTOR_ID
        ? hasChatRealtyToken()
        : readSecretValue(def.id) !== null
  }))
}

export function saveConnector(def: ConnectorDef): void {
  if (def.id === CHATREALTY_CONNECTOR_ID) return // built-in template is not user-editable
  const cleaned: ConnectorDef = { ...def, builtin: false }
  const user = readUserConnectors().filter((d) => d.id !== def.id)
  user.push(cleaned)
  writeUserConnectors(user)
}

export function deleteConnector(id: string): void {
  if (id === CHATREALTY_CONNECTOR_ID) return
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
