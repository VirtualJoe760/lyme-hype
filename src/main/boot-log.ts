import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Mirrors main's console to userData/boot.log.
 *
 * Every diagnostic main already prints -- what sessions.load handed the
 * renderer, an asset 404, a refused IPC sender -- goes to a console that only
 * exists when the app was started from a terminal. Launched from the Start menu
 * or the desktop icon, which is how the app is actually used, all of it is
 * discarded. That is precisely the launch that misbehaves, so the evidence was
 * being thrown away exactly when it mattered.
 */

let logPath: string | null = null

export function startBootLog(): void {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'boot.log')
    // Keep one previous run: a bug that only shows on some launches needs the
    // run BEFORE the one you are looking at.
    try {
      if (statSync(logPath).size > 256_000) renameSync(logPath, `${logPath}.prev`)
    } catch {
      /* no log yet */
    }
    write(`\n=== boot ${new Date().toISOString()} argv=${JSON.stringify(process.argv.slice(1))}`)
    // What the app can actually SEE on disk, from inside its own process. A 404
    // for a file the shell reads without trouble is otherwise unfalsifiable.
    const assets = join(dir, 'assets')
    let count = -1
    try {
      count = readdirSync(assets).length
    } catch (error) {
      write(`    readdir(assets) THREW: ${error instanceof Error ? error.message : String(error)}`)
    }
    write(`    userData=${dir} exists=${existsSync(dir)}`)
    write(`    assets=${assets} exists=${existsSync(assets)} files=${count}`)
    write(`    sessions.json exists=${existsSync(join(dir, 'sessions.json'))}`)
    write(`    vault exists=${existsSync(join(dir, 'credential-vault.json'))}`)
  } catch {
    logPath = null
  }
}

function write(line: string): void {
  if (!logPath) return
  try {
    appendFileSync(logPath, `${line}\n`)
  } catch {
    /* logging must never break boot */
  }
}

function patch(level: 'log' | 'warn' | 'error'): void {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]): void => {
    original(...args)
    write(
      `[${new Date().toISOString().slice(11, 23)}] ${level}: ` +
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    )
  }
}

export function installConsoleMirror(): void {
  patch('log')
  patch('warn')
  patch('error')
}
