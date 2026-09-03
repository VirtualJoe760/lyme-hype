import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Character, CharacterSpec } from '@shared/types'

/**
 * Characters persist in userData/characters.json — workspace-wide for now.
 * docs/ui/character-sheets-and-assets.md §5 says the library belongs to a
 * CHANNEL, a level the app does not have yet; when channels arrive this file
 * moves into the channel folder unchanged. Candidate and reference images are
 * ordinary asset-store URLs, so deleting a character never deletes a file.
 */

const FILE = 'characters.json'

function file(): string {
  return join(app.getPath('userData'), FILE)
}

function read(): Character[] {
  try {
    if (!existsSync(file())) return []
    const parsed = JSON.parse(readFileSync(file(), 'utf-8')) as { characters?: Character[] }
    return Array.isArray(parsed.characters) ? parsed.characters : []
  } catch {
    return []
  }
}

function write(list: Character[]): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify({ characters: list }, null, 2))
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character'
}

export function listCharacters(): Character[] {
  return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getCharacter(id: string): Character | null {
  return read().find((c) => c.id === id) ?? null
}

/** Create or update. A new character needs at least the lock list's required fields. */
export function saveCharacter(input: {
  id?: string
  spec: CharacterSpec
  styleId: string
  referencePhotos: string[]
}): Character {
  for (const key of ['name', 'kind', 'hair', 'eyes', 'outfit'] as const) {
    if (!input.spec[key] || !String(input.spec[key]).trim()) throw new Error(`The lock list needs "${key}".`)
  }
  const list = read()
  const now = new Date().toISOString()
  const existing = input.id ? list.find((c) => c.id === input.id) : undefined
  const character: Character = existing
    ? { ...existing, spec: input.spec, styleId: input.styleId, referencePhotos: input.referencePhotos.slice(0, 3), updatedAt: now }
    : {
        id: `chr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        slug: slugify(input.spec.name),
        spec: input.spec,
        styleId: input.styleId,
        referencePhotos: input.referencePhotos.slice(0, 3),
        candidates: [],
        createdAt: now,
        updatedAt: now
      }
  character.slug = slugify(character.spec.name)
  write(existing ? list.map((c) => (c.id === character.id ? character : c)) : [character, ...list])
  return character
}

export function updateCharacter(id: string, patch: (c: Character) => Character): Character {
  const list = read()
  const current = list.find((c) => c.id === id)
  if (!current) throw new Error(`No character ${id}`)
  const next = { ...patch(current), updatedAt: new Date().toISOString() }
  write(list.map((c) => (c.id === id ? next : c)))
  return next
}

export function deleteCharacter(id: string): void {
  write(read().filter((c) => c.id !== id))
}
