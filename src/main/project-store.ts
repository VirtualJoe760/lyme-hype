import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { ProjectSummary, Session } from '@shared/types'
import { activeProjectDir, setActiveProjectDir, workspaceRoot } from './workspace'

/**
 * A project is a folder, not a row in a global file (build-plan Phase 23):
 *
 *   <workspace>/<project>/project.json   ← one session's content
 *   <workspace>/<project>/assets/        ← its media, living inside it
 *
 * The whole point of the assets living *inside* the folder is that deleting a project
 * deletes its media too. That removes the orphan problem by construction rather than
 * adding reference counting to maintain — 116 files / 28.8 MB were orphaned under the
 * old flat userData/assets layout because nothing ever deleted one.
 */

const PROJECT_FILE = 'project.json'
const PROJECT_EXT = '.lymeproj.json'

/** The project file inside a folder. New projects are written as
 *  `<slug>.lymeproj.json` so the name is legible in Explorer and in any file
 *  picker — a folder full of identical `project.json` files told the user
 *  nothing (2026-08-31). Legacy `project.json` is still read. */
function projectFileIn(dir: string): string | null {
  try {
    const named = readdirSync(dir).find((f) => f.endsWith(PROJECT_EXT))
    if (named) return join(dir, named)
  } catch {
    return null
  }
  const legacy = join(dir, PROJECT_FILE)
  return existsSync(legacy) ? legacy : null
}

interface ProjectFile {
  version: 1
  session: Session
  savedAt: string
}

/** Folder-safe, human-readable, and stable enough to be recognisable in Explorer. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'untitled'
}

function uniqueDir(root: string, slug: string): string {
  let candidate = join(root, slug)
  let n = 2
  while (existsSync(candidate)) {
    candidate = join(root, `${slug}-${n}`)
    n += 1
  }
  return candidate
}

export function projectAssetsDir(projectDir: string): string {
  const dir = join(projectDir, 'assets')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function readProject(projectDir: string): ProjectFile | null {
  try {
    const file = projectFileIn(projectDir)
    if (!file) return null
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    if (parsed?.version === 1 && parsed.session) return parsed as ProjectFile
    return null
  } catch {
    return null
  }
}

export function writeProject(projectDir: string, session: Session): void {
  mkdirSync(projectDir, { recursive: true })
  // Keep writing to whatever file the folder already uses (so legacy projects
  // stay one file, not two); new folders get the self-describing name.
  const file = projectFileIn(projectDir) ?? join(projectDir, `${slugify(session.name)}${PROJECT_EXT}`)
  const tmp = `${file}.tmp`
  const payload: ProjectFile = { version: 1, session, savedAt: new Date().toISOString() }
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
  renameSync(tmp, file)
}

export function listProjects(): ProjectSummary[] {
  const root = workspaceRoot()
  const out: ProjectSummary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const dir = join(root, entry.name)
    const project = readProject(dir)
    if (!project) continue
    let assetCount = 0
    let assetBytes = 0
    try {
      for (const f of readdirSync(join(dir, 'assets'))) {
        assetCount += 1
        assetBytes += statSync(join(dir, 'assets', f)).size
      }
    } catch {
      /* a project with no assets folder yet is normal */
    }
    out.push({
      dir,
      name: project.session.name,
      folder: entry.name,
      savedAt: project.savedAt,
      nodeCount: project.session.nodes.length,
      assetCount,
      assetBytes
    })
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

/** Save a session to its own project folder — updating the one it came from
 *  when it has one, so closing the same session twice doesn't clone it. */
export function saveProject(session: Session): string {
  const existing = session.projectDir
  if (existing && existsSync(existing)) {
    writeProject(existing, session)
    return existing
  }
  return createProject(session)
}

export function createProject(session: Session): string {
  const dir = uniqueDir(workspaceRoot(), slugify(session.name))
  mkdirSync(dir, { recursive: true })
  projectAssetsDir(dir)
  writeProject(dir, session)
  return dir
}

export function deleteProject(projectDir: string): void {
  // Recursive by design: the media lives inside, and that is the point.
  rmSync(projectDir, { recursive: true, force: true })
  if (activeProjectDir() === projectDir) setActiveProjectDir(null)
}

export function duplicateProject(projectDir: string, newName: string): string | null {
  const project = readProject(projectDir)
  if (!project) return null
  const dir = uniqueDir(workspaceRoot(), slugify(newName))
  mkdirSync(dir, { recursive: true })
  const srcAssets = join(projectDir, 'assets')
  if (existsSync(srcAssets)) {
    const dstAssets = projectAssetsDir(dir)
    for (const f of readdirSync(srcAssets)) copyFileSync(join(srcAssets, f), join(dstAssets, f))
  }
  writeProject(dir, { ...project.session, name: newName })
  return dir
}

/**
 * One-time move off the old layout: every session in `sessions.json` becomes a folder,
 * and each session's referenced assets move into it. Assets nothing references land in
 * `_recovered/` rather than being deleted — they were paid for.
 *
 * Idempotent: a workspace that already has projects is left alone.
 */
export function migrateSessionsToProjects(): {
  migrated: number
  assetsMoved: number
  recovered: number
  skipped: boolean
} {
  if (listProjects().length > 0) return { migrated: 0, assetsMoved: 0, recovered: 0, skipped: true }

  const legacyAssets = join(app.getPath('userData'), 'assets')
  const sessionsFile = join(app.getPath('userData'), 'sessions.json')
  if (!existsSync(sessionsFile)) return { migrated: 0, assetsMoved: 0, recovered: 0, skipped: true }

  let sessions: Session[] = []
  try {
    sessions = JSON.parse(readFileSync(sessionsFile, 'utf-8')).sessions ?? []
  } catch {
    return { migrated: 0, assetsMoved: 0, recovered: 0, skipped: true }
  }

  const claimed = new Set<string>()
  let assetsMoved = 0

  for (const session of sessions) {
    const dir = createProject(session)
    const assets = projectAssetsDir(dir)
    for (const node of session.nodes) {
      const src = node.data?.src
      if (typeof src !== 'string' || !src.startsWith('lyme-asset://')) continue
      const file = basename(src)
      const from = join(legacyAssets, file)
      if (!existsSync(from) || claimed.has(file)) continue
      try {
        copyFileSync(from, join(assets, file))
        claimed.add(file)
        assetsMoved += 1
      } catch {
        /* a file that won't copy shouldn't abort the migration */
      }
    }
  }

  let recovered = 0
  if (existsSync(legacyAssets)) {
    const orphans = readdirSync(legacyAssets).filter((f) => !claimed.has(f))
    if (orphans.length > 0) {
      const recoveredDir = join(workspaceRoot(), '_recovered')
      mkdirSync(recoveredDir, { recursive: true })
      for (const f of orphans) {
        try {
          copyFileSync(join(legacyAssets, f), join(recoveredDir, f))
          recovered += 1
        } catch {
          /* same — best effort */
        }
      }
    }
  }

  return { migrated: sessions.length, assetsMoved, recovered, skipped: false }
}

export function activeOrFirstProjectDir(): string | null {
  const active = activeProjectDir()
  if (active) return active
  const first = listProjects()[0]
  return first ? first.dir : null
}

export { activeProjectDir, setActiveProjectDir, workspaceRoot }
