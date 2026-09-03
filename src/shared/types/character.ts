/** Generate Character — the cast → review → approve pipeline's vocabulary
 *  (docs/ui/character-sheets-and-assets.md, ported from lyme-hype-lab). */

export type CharacterKind = 'man' | 'woman' | 'boy' | 'girl' | 'creature' | 'animal' | 'robot'

/**
 * The lock list. The tutorial's rule, stated twice: whatever you leave
 * undefined, the model invents. Every field is something that must stay
 * identical from the casting image through every scene.
 */
export interface CharacterSpec {
  name: string
  /** Drives the 1boy/1girl/creature tag the SDXL-family models key on. */
  kind: CharacterKind
  age?: string
  species?: string
  hair: string
  eyes: string
  skin?: string
  build?: string
  outfit: string
  accessories?: string
  /** Scars, markings, a signature prop — what makes them recognisable at a glance. */
  distinguishing?: string
  personality?: string
  /** Free-form extras appended verbatim. */
  extra?: string
}

/** Vision-model verdict on one candidate. LLM tokens only — never a generation cost. */
export interface CandidateScore {
  likeness: number
  lockList: number
  anatomy: number
  style: number
  /** Weighted 0–100: likeness 35, lock list 25, anatomy 25, style 15. */
  total: number
  issues: string[]
  notes: string
  llmTokenCostUsd: number | null
  error?: string
}

export type CastMode = 'cast' | 'convert'

export interface CharacterCandidate {
  id: string
  /** lyme-asset:// URL. */
  src: string
  thumbSrc?: string
  seed: number
  mode: CastMode
  engine: string
  /** img2img denoise for cast-with-reference; polish denoise for convert. */
  strength?: number
  prompt: string
  createdAt: string
  score?: CandidateScore
}

export interface Character {
  id: string
  slug: string
  spec: CharacterSpec
  styleId: string
  /** lyme-asset:// URLs of the real person's photos (≤3): front, three-quarter, profile. */
  referencePhotos: string[]
  candidates: CharacterCandidate[]
  /** The candidate the user approved — the reference every later generation uses. */
  approvedSrc?: string
  createdAt: string
  updatedAt: string
  lastReview?: { at: string; llmTokenCostUsd: number }
}

/** A cartoon style as the Create panel sees it: what it is and whether its weights are on disk. */
export interface CharacterStyleView {
  id: string
  label: string
  family: string
  region: string
  referenceShows: string[]
  ready: boolean
  /** Weight files not on disk under ComfyUI/models. */
  missing: string[]
  missingMB: number
  notes?: string
}

export interface CastRequest {
  characterId: string
  mode: CastMode
  count: number
  aspect: string
  seed?: number
  /** cast + reference photo: img2img denoise (0.75 keeps style over likeness, 0.55 the reverse).
   *  convert: the LoRA polish pass denoise (0 skips it). */
  strength?: number
}

export interface CastProgress {
  characterId: string
  line: string
  candidate?: CharacterCandidate
  done?: boolean
  error?: string
}

export interface CastResult {
  ok: boolean
  candidates: CharacterCandidate[]
  error?: string
  /** ComfyUI is local: always 0. Present so no caller has to guess. */
  generationCostUsd: 0
}

export interface ReviewResult {
  ok: boolean
  ranked: CharacterCandidate[]
  llmTokenCostUsd: number
  error?: string
}
