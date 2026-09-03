import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { listConnectors } from './connectors-store'
import { storeSecret } from './credential-vault'

/**
 * Re-key connectors whose stored secret this profile cannot decrypt.
 *
 * safeStorage encrypts with DPAPI, which is scoped to the OS user AND to the
 * app container that did the encrypting. A vault adopted from a packaged host
 * therefore copies across intact and still cannot be opened here — every
 * connector reads as unconfigured. Where the repo's own .env.local holds the
 * key, re-encrypt it in THIS profile so the user does not have to hunt down a
 * key they already have on disk. Anything not in .env.local still needs one
 * trip through the secure modal; the vault warning names those.
 */
export function rekeyFromEnvFile(): void {
  const envFile = join(app.getAppPath(), '.env.local')
  if (!existsSync(envFile)) return
  let contents: string
  try {
    contents = readFileSync(envFile, 'utf-8')
  } catch {
    return
  }
  for (const connector of listConnectors()) {
    if (connector.hasCredential || !connector.secretKey) continue
    const match = contents.match(new RegExp(`^${connector.secretKey}=(.*)$`, 'm'))
    const value = match?.[1]?.trim()
    if (!value) continue
    const report = storeSecret(connector.id, connector.secretKey, value)
    console.log(
      `[recover] re-keyed "${connector.id}" from .env.local (${connector.secretKey}, ` +
        `length ${report.length}, ...${report.last4})`
    )
  }
}
