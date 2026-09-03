import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { assetPathForUrl } from './asset-store'
import type { GenerationRecord, MediaType } from '@shared/types'

/**
 * A ledger of every finished generation, written main-side the moment the
 * result is imported.
 *
 * Why it exists: generation runs in the MAIN process, so a result outlives the
 * renderer that asked for it. If that renderer is gone when the render lands (a
 * dev reload, a crash, the window closed, or an MCP-driven generation with no UI
 * at all), the asset is written but nothing on the canvas references it — an
 * orphan. Observed for real on 2026-08-31, and the Phase 23 audit already found
 * 116 older orphans. This ledger is what lets the app offer them back instead of
 * losing them to a uuid in a folder.
 */

const MAX_RECORDS = 60

function file(): string {
  return join(app.getPath('userData'), 'generations.json')
}

function read(): GenerationRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf-8'))
    return Array.isArray(parsed) ? (parsed as GenerationRecord[]) : []
  } catch {
    return []
  }
}

function write(records: GenerationRecord[]): void {
  const target = file()
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8')
  renameSync(tmp, target)
}

export function recordGeneration(entry: {
  src: string
  thumbSrc?: string
  mediaType: MediaType
  prompt: string
  note?: string
}): void {
  try {
    const record: GenerationRecord = {
      id: `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      src: entry.src,
      thumbSrc: entry.thumbSrc,
      mediaType: entry.mediaType,
      prompt: entry.prompt.slice(0, 400),
      note: entry.note,
      at: new Date().toISOString()
    }
    write([record, ...read()].slice(0, MAX_RECORDS))
  } catch {
    /* the ledger is a convenience — never fail a generation over it */
  }
}

/** Recent generations whose asset is still on disk, newest first. */
export function listGenerations(): GenerationRecord[] {
  return read().filter((r) => {
    const path = assetPathForUrl(r.src)
    return !!path && existsSync(path)
  })
}
