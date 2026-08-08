import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { PersistedState } from '@shared/types'

const EMPTY_STATE: PersistedState = { sessions: [], activeSessionId: null }

function stateFilePath(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

export function loadState(): PersistedState {
  try {
    const raw = readFileSync(stateFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as PersistedState
    if (!Array.isArray(parsed.sessions)) return EMPTY_STATE
    return parsed
  } catch {
    return EMPTY_STATE
  }
}

export function saveState(state: PersistedState): void {
  const file = stateFilePath()
  mkdirSync(dirname(file), { recursive: true })
  // Write-then-rename so a crash mid-write can't leave a truncated sessions file.
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, file)
}
