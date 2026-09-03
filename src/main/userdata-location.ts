import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * One home for app data, whoever launches the app.
 *
 * Windows hands an MSIX-packaged process a virtualized AppData, so Lyme Hype
 * launched from inside a packaged host (a terminal, an agent) writes
 * `%APPDATA%\lyme-hype` to `%LOCALAPPDATA%\Packages\<host>\LocalCache\Roaming\
 * lyme-hype`, while reads fall through to the real profile. The app did not
 * choose two homes -- the OS gave it a different one depending on the launcher.
 * The result was two complete, diverging copies: on 2026-08-31 every generated
 * asset and a working credential vault lived in one of them, and the Start-menu
 * app could see neither.
 *
 * Documents is NOT virtualized -- both contexts already agreed about the project
 * folders there -- so putting userData under the workspace collapses the two
 * copies into one for good.
 *
 * Credentials are the reason the whole set must move together. safeStorage does
 * not protect each secret with DPAPI directly: Chromium keeps a random AES key
 * in `Local State`, DPAPI-protects THAT, and encrypts secrets with it. Copying a
 * vault without its `Local State` yields a file that decrypts to nothing, which
 * is exactly how a vault holding a working muapi key looked like an app that had
 * never been configured.
 */

const OLD_DEFAULT = 'lyme-hype'
const MARKER = 'consolidated.json'

/** Moved as a unit. `Local State` carries the key the vault is encrypted with,
 *  so the two are meaningless apart. */
const STATE_FILES = [
  'Local State',
  'credential-vault.json',
  'connectors.json',
  'sessions.json',
  'generations.json',
  'model-providers.json',
  'window-state.json'
]

function candidateSources(target: string): string[] {
  const home = app.getPath('home')
  const sources = [join(home, 'AppData', 'Roaming', OLD_DEFAULT)]
  const packages = join(home, 'AppData', 'Local', 'Packages')
  if (existsSync(packages)) {
    try {
      for (const host of readdirSync(packages)) {
        sources.push(join(packages, host, 'LocalCache', 'Roaming', OLD_DEFAULT))
      }
    } catch {
      /* an unreadable Packages dir just means no container copies */
    }
  }
  return sources.filter((dir) => dir !== target && existsSync(dir))
}

function assetCount(dir: string): number {
  try {
    return readdirSync(join(dir, 'assets')).length
  } catch {
    return 0
  }
}

/**
 * Richest-wins: the copy with the most assets is the one that was actually
 * being used. Ties break toward a copy that has a vault, since a store with
 * credentials is worth more than an empty one of the same size.
 */
function bestSource(sources: string[]): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const dir of sources) {
    const score = assetCount(dir) * 2 + (existsSync(join(dir, 'credential-vault.json')) ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = dir
    }
  }
  return bestScore > 0 ? best : null
}

function copyAssets(from: string, to: string): number {
  const source = join(from, 'assets')
  if (!existsSync(source)) return 0
  mkdirSync(to, { recursive: true })
  let copied = 0
  for (const name of readdirSync(source)) {
    const target = join(to, name)
    if (existsSync(target)) continue
    try {
      copyFileSync(join(source, name), target)
      copied += 1
    } catch {
      /* one unreadable asset must not abort the migration */
    }
  }
  return copied
}

/**
 * Must run before app.whenReady() and before anything touches userData --
 * setting it later would leave part of the app pointed at the old location.
 */
export function consolidateUserData(): string {
  const target = join(app.getPath('documents'), 'Lyme Hype', '.app')
  try {
    mkdirSync(target, { recursive: true })
    app.setPath('userData', target)
  } catch {
    // Better a working app in the old split world than no app at all.
    return app.getPath('userData')
  }
  if (existsSync(join(target, MARKER))) return target

  const source = bestSource(candidateSources(target))
  if (!source) {
    writeFileSync(join(target, MARKER), JSON.stringify({ at: new Date().toISOString() }, null, 2))
    return target
  }

  const assets = copyAssets(source, join(target, 'assets'))
  const files: string[] = []
  for (const name of STATE_FILES) {
    const from = join(source, name)
    if (!existsSync(from)) continue
    const to = join(target, name)
    try {
      if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue
      copyFileSync(from, to)
      files.push(name)
    } catch {
      /* skip; the marker still records what did land */
    }
  }
  // console is not mirrored yet at this point, so record it in the receipt.
  writeFileSync(
    join(target, MARKER),
    JSON.stringify({ at: new Date().toISOString(), source, assets, files }, null, 2)
  )
  console.log(`[userdata] consolidated into ${target} — ${assets} asset(s), ${files.length} file(s) from ${source}`)
  return target
}
