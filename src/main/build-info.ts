import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Which build is actually running, and whether the source has moved past it.
 *
 * The Start-menu shortcut runs `electron .`, which starts whatever is sitting in
 * out/ — no build step. So a window can be hours behind the source while looking
 * completely normal, and a main-process fix appears not to have worked (Vite's
 * hot reload only ever touches the renderer, never main). That burned a full
 * debugging session on 2026-08-31, chasing a thumbnail bug that had already been
 * fixed in a build the open window had never loaded.
 *
 * The stamp is injected at compile time by electron.vite.config.ts.
 */

declare const __BUILD_STAMP__: string

export const BUILD_STAMP = typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'unstamped'

const WATCHED = ['src', 'resources', 'electron.vite.config.ts', 'package.json']
const SKIP = new Set(['node_modules', 'out', '.git', 'dist'])

function newestMtime(target: string): number {
  let newest = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop() as string
    let entries: { name: string; isDirectory: () => boolean }[]
    try {
      const info = statSync(current)
      if (!info.isDirectory()) return info.mtimeMs
      entries = readdirSync(current, { withFileTypes: true, encoding: 'utf-8' })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue
      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
      } else {
        try {
          const mtime = statSync(child).mtimeMs
          if (mtime > newest) newest = mtime
        } catch {
          /* a file that vanished mid-walk tells us nothing */
        }
      }
    }
  }
  return newest
}

/** True when any watched source file is newer than the running build. Packaged
 *  builds have no source tree to compare against, so they are never stale. */
export function sourceIsNewerThanBuild(): boolean {
  if (app.isPackaged) return false
  const root = app.getAppPath()
  const built = join(root, 'out', 'main', 'index.js')
  if (!existsSync(built)) return false
  const builtAt = statSync(built).mtimeMs
  return WATCHED.map((entry) => join(root, entry))
    .filter((entry) => existsSync(entry))
    .some((entry) => newestMtime(entry) > builtAt)
}

/** Set on the relaunch after a rebuild, so a build that fails to freshen the
 *  timestamps can never spin the app in a rebuild loop. */
const REBUILT_FLAG = '--rebuilt'

/**
 * Rebuild and restart when the window would otherwise open on old code.
 *
 * The shortcut launches the real executable — that is what makes Windows treat
 * this as Lyme Hype rather than as whatever script host wrapped it — so the
 * freshness check has to live in the app instead of in the launcher. Runs
 * before any window exists; returns true when it is relaunching and the caller
 * should stop booting.
 */
export function rebuildIfStale(): boolean {
  if (app.isPackaged || process.argv.includes(REBUILT_FLAG)) return false
  if (!sourceIsNewerThanBuild()) return false
  console.log('[build] source is newer than out/ — rebuilding before launch')
  // shell:true is required, not incidental — since Node 20.12 a .cmd cannot be
  // spawned directly on Windows (EINVAL), and without it this silently "failed"
  // and launched the stale build anyway, which is the exact bug it exists to
  // prevent. Arguments are fixed literals, so the shell adds no injection risk.
  const result = spawnSync('npm.cmd', ['run', 'build'], {
    cwd: app.getAppPath(),
    stdio: 'inherit',
    shell: true
  })
  if (result.status !== 0) {
    // Never strand the user with no app: fall through and run what exists.
    console.error(
      `[build] rebuild FAILED (${result.error?.message ?? `exit ${result.status}`}) — starting the previous build instead`
    )
    return false
  }
  app.relaunch({ args: process.argv.slice(1).concat(REBUILT_FLAG) })
  app.exit(0)
  return true
}
