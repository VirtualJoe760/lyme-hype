import { readFileSync } from 'node:fs'
import { app } from 'electron'
import { addSuggestion } from '../connector-suggestions'
import { listConnectors, testConnector } from '../connectors-store'
import { storeSecret } from '../credential-vault'

/**
 * Headless connector probe — `LYME_PROBE_CONNECTOR=<id> npm run dev` runs the
 * live connection test (which records the full observed tool schemas to
 * userData/connector-tools/<id>.json — connector-intake step 1) and prints the
 * tool inventory. This is how the utility scripts and UI catalog get built from
 * the partner API's REAL surface instead of doc aliases.
 */
export async function runConnectorProbe(connectorId: string): Promise<void> {
  const log = (line: string): void => console.log(`[probe] ${line}`)
  const result = await testConnector(connectorId)
  if (!result.ok) {
    log(`FAIL — ${connectorId}: ${result.error ?? 'probe failed'}`)
    app.exit(1)
    return
  }
  log(
    `PASS — ${connectorId}: ${result.serverName ?? '?'} v${result.serverVersion ?? '?'} · ${result.toolCount ?? 0} tools — schemas recorded to userData/connector-tools/${connectorId}.json`
  )
  app.exit(0)
}

/**
 * Headless credential import — `LYME_IMPORT_CONNECTOR=<id>
 * LYME_IMPORT_ENVFILE=<path> npm run dev` installs a catalog connector and
 * moves its secret from an env file into the vault, then exits.
 *
 * Why this exists: a key that already sits on this machine's disk (a sibling
 * project's .env.local) shouldn't be re-typed through the secure modal, and it
 * must never pass through an agent's context either (AGENTS.md §1.5). This
 * path keeps the value main-process-only — disk → DPAPI vault — and logs only
 * the field name / length / last-4, the same reporting contract as the modal.
 */
export function runCredentialImport(connectorId: string, envFilePath?: string): void {
  const log = (line: string): void => console.log(`[import] ${line}`)
  try {
    const def = listConnectors().find((c) => c.id === connectorId) ?? addSuggestion(connectorId)
    if (!def) {
      log(`FAIL — "${connectorId}" is not an installed connector or an available catalog entry`)
      app.exit(1)
      return
    }
    if (def.authType === 'none' || !def.secretKey) {
      // Secretless connectors (comfyui) install-only — nothing to move into the vault.
      log(`PASS — "${def.id}" installed (no credential needed)`)
      app.exit(0)
      return
    }
    if (!envFilePath) {
      log(`FAIL — connector "${connectorId}" needs ${def.secretKey}; pass LYME_IMPORT_ENVFILE`)
      app.exit(1)
      return
    }
    const match = readFileSync(envFilePath, 'utf-8').match(new RegExp(`^${def.secretKey}=(.*)$`, 'm'))
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (!value) {
      log(`FAIL — no ${def.secretKey} line in ${envFilePath}`)
      app.exit(1)
      return
    }
    const report = storeSecret(def.id, def.secretFieldLabel ?? 'API key', value)
    log(
      `PASS — "${def.id}" installed, ${def.secretKey} stored from ${envFilePath} (length ${report.length}, …${report.last4})`
    )
    app.exit(0)
  } catch (error) {
    log(`FAIL — ${error instanceof Error ? error.message : String(error)}`)
    app.exit(1)
  }
}
