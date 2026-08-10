import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * Where projects live on disk (build-plan Phase 23).
 *
 * Deliberately NOT userData: projects are the user's documents, and belong somewhere
 * they can browse, back up, and copy to another machine. userData keeps only what is
 * genuinely machine-local — connectors, the credential vault, window geometry, and the
 * pointer to this root.
 */
interface WorkspaceConfig {
  root?: string
  activeProjectDir?: string
}

function configFile(): string {
  return join(app.getPath('userData'), 'workspace.json')
}

function read(): WorkspaceConfig {
  try {
    const file = configFile()
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as WorkspaceConfig) : {}
  } catch {
    return {}
  }
}

function write(config: WorkspaceConfig): void {
  const file = configFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  renameSync(tmp, file)
}

export function defaultWorkspaceRoot(): string {
  return join(app.getPath('documents'), 'Lyme Hype')
}

export function workspaceRoot(): string {
  const root = read().root ?? defaultWorkspaceRoot()
  mkdirSync(root, { recursive: true })
  return root
}

export function setWorkspaceRoot(root: string): void {
  write({ ...read(), root })
  mkdirSync(root, { recursive: true })
}

export function activeProjectDir(): string | null {
  const dir = read().activeProjectDir
  return dir && existsSync(dir) ? dir : null
}

export function setActiveProjectDir(dir: string | null): void {
  const config = read()
  if (dir) config.activeProjectDir = dir
  else delete config.activeProjectDir
  write(config)
}
