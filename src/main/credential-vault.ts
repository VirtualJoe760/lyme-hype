import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { SecretReport } from '@shared/types'

interface VaultEntry {
  fieldLabel: string
  ciphertext: string
  length: number
  last4: string
  savedAt: string
}

type Vault = Record<string, VaultEntry>

function vaultFilePath(): string {
  return join(app.getPath('userData'), 'credential-vault.json')
}

function readVault(): Vault {
  try {
    return JSON.parse(readFileSync(vaultFilePath(), 'utf-8')) as Vault
  } catch {
    return {}
  }
}

function writeVault(vault: Vault): void {
  const file = vaultFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(vault, null, 2), 'utf-8')
  renameSync(tmp, file)
}

/**
 * Stores a secret via OS-native encryption (DPAPI on Windows, Keychain on Mac).
 * Returns only the reporting contract — field label, length, last 4. The value
 * itself never leaves the main process.
 */
export function storeSecret(connectorId: string, fieldLabel: string, value: string): SecretReport {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable — refusing to store a credential in plaintext')
  }
  const entry: VaultEntry = {
    fieldLabel,
    ciphertext: safeStorage.encryptString(value).toString('base64'),
    length: value.length,
    // Suppress the tail for short secrets — last-4 of a <8-char value discloses
    // most or all of it, which would defeat the whole reporting contract
    // (AGENTS.md rule 5). This single choke point also keeps plaintext out of
    // the vault metadata and the renderer display.
    last4: value.length >= 8 ? value.slice(-4) : '',
    savedAt: new Date().toISOString()
  }
  const vault = readVault()
  vault[connectorId] = entry
  writeVault(vault)
  return {
    connectorId,
    fieldLabel: entry.fieldLabel,
    length: entry.length,
    last4: entry.last4,
    savedAt: entry.savedAt
  }
}

export function listSecretReports(): SecretReport[] {
  const vault = readVault()
  return Object.entries(vault).map(([connectorId, entry]) => ({
    connectorId,
    fieldLabel: entry.fieldLabel,
    length: entry.length,
    last4: entry.last4,
    savedAt: entry.savedAt
  }))
}

export function deleteSecret(connectorId: string): void {
  const vault = readVault()
  delete vault[connectorId]
  writeVault(vault)
}

/**
 * Main-process consumers only (Phase 3 will inject decrypted values into MCP
 * connection configs). Never expose over IPC, never log the return value.
 */
const warnedUndecryptable = new Set<string>()

export function readSecretValue(connectorId: string): string | null {
  const entry = readVault()[connectorId]
  if (!entry) return null
  try {
    return safeStorage.decryptString(Buffer.from(entry.ciphertext, 'base64'))
  } catch {
    // An entry that exists but can't be decrypted (OS keychain/DPAPI changed,
    // different OS user, corrupted ciphertext) reads as "no credential" — the
    // caller then falls back to its unconfigured path rather than crashing.
    //
    // Said out loud, once per id: silently equating "cannot decrypt" with "no
    // key" is why a whole vault adopted from a packaged host's container looked
    // like an app that had simply never been configured (2026-08-31).
    if (!warnedUndecryptable.has(connectorId)) {
      warnedUndecryptable.add(connectorId)
      console.warn(
        `[vault] "${connectorId}" has a stored secret that THIS profile cannot decrypt — ` +
          'it was encrypted by a different OS user or app container. Re-enter it in Settings.'
      )
    }
    return null
  }
}
