import type { CandidateScore, CastProgress, CastRequest, CastResult, Character, CharacterCandidate, ReviewResult } from '@shared/types'
import { assetPathForUrl } from '../asset-store'
import { ensureComfyUI } from '../comfyui-host'
import { runConversationTurn } from '../conversations'
import { recordGeneration } from '../generation-log'
import { buildQwenEditGraph, buildSdxlGraph } from './character-graphs'
import { comfyPrepare, comfyRun, comfyUpload } from './character-comfy'
import {
  QWEN_EDIT_2511,
  buildCastingPrompt,
  describeCharacter,
  dimsFor,
  getStyle,
  missingWeights,
  qwenWeights,
  styleWeights,
  type CartoonStyle
} from './character-styles'
import { getCharacter, updateCharacter } from './character-store'

/**
 * Generate Character — steps 2 and 2½ of the cartoon pipeline
 * (docs/ui/character-sheets-and-assets.md), ported from lyme-hype-lab where
 * every piece was live-verified first:
 *
 *   cast     N lock-list variations in a style (SDXL + LoRA), optionally
 *            img2img from a reference photo. Fast; keeps the photo's clothes.
 *   convert  Qwen-Image-Edit-2511 redraws the person in the style AND the
 *            lock-list outfit from up to three photos, then a light img2img
 *            polish through the style's own LoRA. Slow to load; best likeness.
 *   review   the plan LLM scores every candidate against the photos and the
 *            lock list (likeness / lock list / anatomy / style). LLM tokens
 *            only — never reported as a generation cost.
 *   approve  one candidate becomes the character's reference image.
 *
 * Generation cost is always $0: ComfyUI is local (AGENTS.md §1.8).
 */

export type ProgressSink = (p: CastProgress) => void

function candidateId(): string {
  return `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function referencePaths(character: Character): string[] {
  return character.referencePhotos.map((u) => assetPathForUrl(u)).filter((p): p is string => !!p)
}

async function castOne(
  character: Character,
  style: CartoonStyle,
  req: CastRequest,
  seed: number,
  refs: string[],
  say: (line: string) => void
): Promise<CharacterCandidate> {
  await comfyPrepare(style.checkpoint.file)
  const uploaded = refs[0] ? await comfyUpload(refs[0]) : null
  // With a photo the shot is already decided by the photo — do not fight it.
  const { positive, negative } = buildCastingPrompt(
    style,
    character.spec,
    uploaded ? { pose: 'same pose and framing as the reference', background: 'simple background' } : {}
  )
  const { width, height } = dimsFor(req.aspect, style.family)
  const strength = req.strength ?? 0.75
  say(`cast · ${style.id} · ${width}×${height} · seed ${seed}${uploaded ? ` · img2img ${strength}` : ''}`)
  const [saved] = await comfyRun(
    buildSdxlGraph({
      checkpointFile: style.checkpoint.file,
      loras: style.loras,
      positive,
      negative,
      width,
      height,
      seed,
      sampler: style.sampler,
      filenamePrefix: `lyme/${character.slug}-cast`,
      initImage: uploaded ? { name: uploaded, denoise: strength } : undefined
    }),
    { onStatus: say }
  )
  if (!saved) throw new Error('no image came back')
  return {
    id: candidateId(),
    src: saved.url,
    thumbSrc: saved.thumbUrl,
    seed,
    mode: 'cast',
    engine: `comfyui/${style.checkpoint.file}`,
    strength: uploaded ? strength : undefined,
    prompt: positive,
    createdAt: new Date().toISOString()
  }
}

async function convertOne(
  character: Character,
  style: CartoonStyle,
  req: CastRequest,
  seed: number,
  refs: string[],
  say: (line: string) => void
): Promise<CharacterCandidate> {
  const spec = character.spec
  const q = QWEN_EDIT_2511
  await comfyPrepare('qwen-edit-2511')
  const uploads: string[] = []
  for (const r of refs.slice(0, 3)) uploads.push(await comfyUpload(r))
  const who = uploads.length === 1 ? 'image 1' : `images 1 to ${uploads.length} (the same person photographed from different angles)`
  const stage1Prompt =
    `Redraw the person in ${who} as a character in ${style.sentence}. ` +
    'Keep the same face structure, hairstyle, expression and skin tone so they are clearly recognizable. ' +
    'Show the full body, standing, facing the viewer, arms relaxed. ' +
    `They are wearing ${spec.outfit}${spec.accessories ? ` and ${spec.accessories}` : ''}. ` +
    `Plain flat white background, no text. Character notes: ${describeCharacter(spec)}`
  const output = dimsFor(req.aspect)
  say(`convert · qwen-edit · ${output.width}×${output.height} · seed ${seed} (the 31 GB engine loads slowly the first time)`)
  const [stage1] = await comfyRun(
    buildQwenEditGraph({
      images: uploads,
      prompt: stage1Prompt,
      seed,
      output,
      files: { diffusion: q.diffusion.file, textEncoder: q.textEncoder.file, vae: q.vae.file, lightning: q.lightning.file },
      filenamePrefix: `lyme/${character.slug}-convert`
    }),
    { onStatus: say }
  )
  if (!stage1) throw new Error('no image came back from Qwen-Edit')
  let final = stage1
  let engine = `comfyui/${q.diffusion.file}`
  const polish = req.strength ?? 0.45
  if (polish > 0) {
    const stage1Path = assetPathForUrl(stage1.url)
    if (!stage1Path) throw new Error('stage 1 output is not on disk')
    await comfyPrepare(style.checkpoint.file)
    const { positive, negative } = buildCastingPrompt(style, spec, {
      pose: 'full body, standing, facing viewer, arms at sides',
      background: 'simple background, white background'
    })
    say(`polish · ${style.id} LoRA · denoise ${polish}`)
    const [stage2] = await comfyRun(
      buildSdxlGraph({
        checkpointFile: style.checkpoint.file,
        loras: style.loras,
        positive,
        negative,
        width: output.width,
        height: output.height,
        seed,
        sampler: style.sampler,
        filenamePrefix: `lyme/${character.slug}-polish`,
        initImage: { name: await comfyUpload(stage1Path), denoise: polish }
      }),
      { onStatus: say }
    )
    if (stage2) {
      final = stage2
      engine += ` + ${style.checkpoint.file}`
    }
  }
  return {
    id: candidateId(),
    src: final.url,
    thumbSrc: final.thumbUrl,
    seed,
    mode: 'convert',
    engine,
    strength: polish,
    prompt: stage1Prompt,
    createdAt: new Date().toISOString()
  }
}

export async function castCharacter(req: CastRequest, progress: ProgressSink): Promise<CastResult> {
  const say = (line: string, extra: Partial<CastProgress> = {}): void =>
    progress({ characterId: req.characterId, line, ...extra })
  const fail = (error: string): CastResult => {
    say(error, { error, done: true })
    return { ok: false, candidates: [], error, generationCostUsd: 0 }
  }
  const character = getCharacter(req.characterId)
  if (!character) return fail('That character no longer exists.')
  const style = getStyle(character.styleId)
  const refs = referencePaths(character)
  if (req.mode === 'convert' && refs.length === 0) return fail('Photo → character needs at least one reference photo.')

  const needed = req.mode === 'convert' ? [...qwenWeights(), ...((req.strength ?? 0.45) > 0 ? styleWeights(style) : [])] : styleWeights(style)
  const missing = missingWeights(needed)
  if (missing.length > 0) {
    const mb = missing.reduce((n, m) => n + m.sizeMB, 0)
    return fail(`Missing under ComfyUI/models: ${missing.map((m) => m.file).join(', ')} (${(mb / 1000).toFixed(1)} GB). Download them with the lab's "ensure" command.`)
  }

  say('starting the local engine…')
  if (!(await ensureComfyUI())) return fail('ComfyUI did not come up — see the status strip at the foot of the studio.')

  const count = Math.max(1, Math.min(8, req.count))
  const baseSeed = req.seed ?? Math.floor(Math.random() * 2 ** 32)
  const made: CharacterCandidate[] = []
  try {
    for (let i = 0; i < count; i++) {
      const seed = baseSeed + i
      const candidate =
        req.mode === 'convert'
          ? await convertOne(character, style, req, seed, refs, (l) => say(`${i + 1}/${count} ${l}`))
          : await castOne(character, style, req, seed, refs, (l) => say(`${i + 1}/${count} ${l}`))
      recordGeneration({
        src: candidate.src,
        thumbSrc: candidate.thumbSrc,
        mediaType: 'image',
        prompt: candidate.prompt,
        note: `character "${character.spec.name}" · ${candidate.engine} · generation cost $0 (local)`
      })
      updateCharacter(character.id, (c) => ({ ...c, candidates: [...c.candidates, candidate] }))
      made.push(candidate)
      say(`${i + 1}/${count} ready`, { candidate })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    say(message, { error: message, done: true })
    return { ok: made.length > 0, candidates: made, error: message, generationCostUsd: 0 }
  }
  say(`${made.length} candidate(s) ready`, { done: true })
  return { ok: true, candidates: made, generationCostUsd: 0 }
}

// ---- review ------------------------------------------------------------------

const WEIGHTS = { likeness: 0.35, lockList: 0.25, anatomy: 0.25, style: 0.15 }
const REVIEW_SYSTEM =
  'You are the casting director for an animated series, reviewing AI-generated character candidates against photos of the real person they are based on. You score strictly and consistently, and you reply with JSON only.'

function clamp(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0
}

async function scoreCandidate(character: Character, style: CartoonStyle, candidate: CharacterCandidate, refs: string[]): Promise<CandidateScore> {
  const path = assetPathForUrl(candidate.src)
  const base: CandidateScore = { likeness: 0, lockList: 0, anatomy: 0, style: 0, total: 0, issues: [], notes: '', llmTokenCostUsd: null }
  if (!path) return { ...base, error: 'candidate image is not on disk' }
  const n = refs.length + 1
  const prompt = [
    ...refs.map((_, i) => `Image ${i + 1}: a photo of the real person.`),
    `Image ${n}: an AI-generated candidate for the character.`,
    '',
    `The character lock list (everything here MUST appear as described): ${describeCharacter(character.spec)}`,
    `Target style: ${style.label}.`,
    '',
    `Score image ${n} on four axes, each an integer 0-10:`,
    refs.length > 0
      ? '- likeness: would someone who knows the person in the photos recognise them here (face structure, hair, expression, build)?'
      : '- likeness: 0 — no reference photos were given; say so in notes.',
    '- lock_list: how many of the lock-list items are present and correct (outfit, hair, eyes, accessories, distinguishing features)?',
    '- anatomy: freedom from generation defects — extra or missing limbs, extra heads or faces, merged fingers, warped features, garbled text. 10 = clean.',
    '- style: does it read as the target style (line, shading, proportions), not a generic render?',
    'List the concrete problems you saw as short phrases, and one sentence of notes.',
    'Reply with strict JSON and nothing else: {"likeness":0,"lock_list":0,"anatomy":0,"style":0,"issues":["..."],"notes":"..."}'
  ].join('\n')
  const turn = await runConversationTurn(
    { conversationId: `character-review-${character.id}-${candidate.id}`, prompt, imagePaths: [...refs, path], systemPrompt: REVIEW_SYSTEM },
    () => {}
  )
  const cost = turn.costUsd ?? null
  if (!turn.ok) return { ...base, llmTokenCostUsd: cost, error: turn.error ?? 'no reply' }
  const m = turn.text.match(/\{[\s\S]*\}/)
  if (!m) return { ...base, llmTokenCostUsd: cost, error: `reply was not JSON: ${turn.text.slice(0, 100)}` }
  let parsed: { likeness?: unknown; lock_list?: unknown; anatomy?: unknown; style?: unknown; issues?: unknown; notes?: unknown }
  try {
    parsed = JSON.parse(m[0])
  } catch {
    return { ...base, llmTokenCostUsd: cost, error: 'reply JSON did not parse' }
  }
  const s = { likeness: clamp(parsed.likeness), lockList: clamp(parsed.lock_list), anatomy: clamp(parsed.anatomy), style: clamp(parsed.style) }
  return {
    ...s,
    total: Math.round((s.likeness * WEIGHTS.likeness + s.lockList * WEIGHTS.lockList + s.anatomy * WEIGHTS.anatomy + s.style * WEIGHTS.style) * 10),
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 8) : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    llmTokenCostUsd: cost
  }
}

/** Score every unscored candidate (or all of them with `rescore`), then rank. */
export async function reviewCharacter(characterId: string, progress: ProgressSink, rescore = false): Promise<ReviewResult> {
  const character = getCharacter(characterId)
  if (!character) return { ok: false, ranked: [], llmTokenCostUsd: 0, error: 'That character no longer exists.' }
  const style = getStyle(character.styleId)
  const refs = referencePaths(character)
  const todo = character.candidates.filter((c) => rescore || !c.score || c.score.error)
  let spent = 0
  for (const [i, candidate] of todo.entries()) {
    progress({ characterId, line: `reviewing ${i + 1}/${todo.length} (seed ${candidate.seed})…` })
    const score = await scoreCandidate(character, style, candidate, refs)
    spent += score.llmTokenCostUsd ?? 0
    updateCharacter(characterId, (c) => ({
      ...c,
      candidates: c.candidates.map((x) => (x.id === candidate.id ? { ...x, score } : x))
    }))
  }
  const updated = updateCharacter(characterId, (c) => ({ ...c, lastReview: { at: new Date().toISOString(), llmTokenCostUsd: spent } }))
  const ranked = [...updated.candidates].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))
  progress({ characterId, line: `review done — LLM tokens $${spent.toFixed(3)} (plan), generation cost $0`, done: true })
  return { ok: true, ranked, llmTokenCostUsd: spent }
}

export function approveCharacter(characterId: string, src: string): Character {
  return updateCharacter(characterId, (c) => {
    if (!c.candidates.some((x) => x.src === src)) throw new Error('That image is not one of this character’s candidates.')
    return { ...c, approvedSrc: src }
  })
}
