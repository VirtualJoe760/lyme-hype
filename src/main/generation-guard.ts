import { LOCAL_VERIFY_RETRIES, promptIsThin } from '@shared/generation-policy'
import { findModel } from '@shared/model-catalog'
import type { GenerationParams, GenerationResult } from '@shared/types'
import { assetPathForUrl } from './asset-store'
import { runConversationTurn } from './conversations'
import { llmBilling } from './llm-billing'

/**
 * Which model the guard's two utility turns run on. On the Claude Code login
 * their tokens are plan consumption, not a charge (AGENTS.md §1.8), so the
 * provider's default — the best eyes — is the right choice. Only when every
 * token is a real bill (an API key) do they drop to Haiku. An
 * anthropic-compatible provider (Kimi, a custom endpoint) keeps whatever model
 * it is configured for; we never push an Anthropic model id at another vendor.
 */
function guardModel(): string | undefined {
  // On the plan the flagship's eyes are free — use them. Pin Haiku only when
  // every token is a real charge.
  return llmBilling() === 'api' ? 'claude-haiku-4-5-20251001' : undefined
}

/**
 * Safeguards around a generation, aimed at where local models actually fail.
 *
 * Every local template runs at CFG 1.0 (flux1-schnell, krea2-turbo,
 * z-image-turbo — verified 2026-09-02), and at CFG 1.0 a negative prompt is
 * computed and then ignored: there is no guidance margin to steer away with.
 * z-image's template has carried "blurry ugly bad" as a negative on every run
 * and it has never done anything. So the two levers that DO work are:
 *
 *  1. Say it in the positive prompt. A CFG-1 model listens to exactly one thing.
 *     Subject count, anatomy and framing stated outright ("one single bulldog,
 *     one head, four legs, full body in frame") is the honest form of a
 *     "negative prompt" for a distilled model — and thin prompts ("a dog walking
 *     through a park") leave all of that to chance on ANY model.
 *  2. Look at the result. A vision check after a local generation catches the
 *     second dog head with certainty, and a local retry is free.
 *
 * Both go through the app's own LLM (whatever provider is active), as a single
 * turn with no tools — the same shape Enhance uses, so none of the agent
 * orchestration cost that made batch images bill at 4× list.
 */

function isLocal(params: GenerationParams): boolean {
  if (params.connectorId === 'comfyui') return true
  if (params.connectorIds?.includes('comfyui')) return true
  return !!params.model && findModel(params.model)?.connectorId === 'comfyui'
}

interface Refined {
  prompt: string
  costUsd: number
  changed: boolean
}

async function refinePrompt(params: GenerationParams, local: boolean): Promise<Refined> {
  const original = params.prompt.trim()
  const references = [
    ...(params.referenceImagePaths ?? []),
    ...(params.characterReferencePaths ?? []),
    ...(params.styleReferencePaths ?? [])
  ]
    .map((p) => assetPathForUrl(p) ?? p)
    .slice(0, 4)
  const turn = await runConversationTurn(
    {
      conversationId: `refine-${Date.now()}`,
      model: guardModel(),
      prompt: [
        `Prompt as typed: ${original}`,
        references.length ? `Reference images are attached; keep the prompt consistent with them.` : '',
        '',
        local
          ? 'Target: a distilled diffusion model that reads ONLY the positive prompt (negative prompts have no effect at CFG 1).'
          : 'Target: a general image model.',
        'Rewrite this as one compact paragraph that a model cannot misread:',
        '- state the subject COUNT in words ("one single bulldog", "two people") — never leave it implicit',
        '- state the anatomy plainly when there is a body ("one head, four legs, one tail", "two hands, five fingers each")',
        '- make the framing explicit ("full body in frame", "waist-up portrait") so limbs are not cropped into ambiguity',
        '- keep every intent, style and detail the user gave; add lighting/style only where the prompt was silent',
        '- no lists, no quotes, no preamble: reply with the prompt text only'
      ]
        .filter(Boolean)
        .join('\n'),
      imagePaths: references,
      systemPrompt:
        'You write precise image-generation prompts that prevent anatomical and counting errors. You reply with only the prompt text.'
    },
    () => {}
  )
  if (!turn.ok || !turn.text.trim()) return { prompt: original, costUsd: turn.costUsd ?? 0, changed: false }
  const prompt = turn.text.trim()
  return { prompt, costUsd: turn.costUsd ?? 0, changed: prompt !== original }
}

interface Verdict {
  checked: boolean
  ok: boolean
  reason?: string
  costUsd: number
}

async function verifyImage(src: string, prompt: string): Promise<Verdict> {
  const path = assetPathForUrl(src)
  if (!path) return { checked: false, ok: true, reason: 'result is not a local asset', costUsd: 0 }
  const turn = await runConversationTurn(
    {
      conversationId: `verify-${Date.now()}`,
      model: guardModel(),
      prompt: [
        `The image was generated from this prompt: ${prompt}`,
        '',
        'Inspect the image for generation defects ONLY — not taste, not style:',
        'extra or missing limbs, extra heads or faces, duplicated or merged subjects, a subject count different from the prompt,',
        'body parts growing out of the wrong place, hands with the wrong number of fingers, text that is garbled.',
        'Reply with strict JSON and nothing else: {"ok": true} if clean, or {"ok": false, "issues": ["short phrase", ...]}.'
      ].join('\n'),
      imagePaths: [path],
      systemPrompt: 'You are a strict visual QA checker for AI-generated images. You reply with JSON only.'
    },
    () => {}
  )
  if (!turn.ok) {
    // A provider that cannot take images errors here. Say so rather than pass
    // the image as "clean" — an unchecked image must never look verified.
    return { checked: false, ok: true, reason: `verification unavailable on this provider: ${turn.error ?? 'no reply'}`, costUsd: turn.costUsd ?? 0 }
  }
  const match = turn.text.match(/\{[\s\S]*\}/)
  if (!match) return { checked: false, ok: true, reason: 'verifier reply was not JSON', costUsd: turn.costUsd ?? 0 }
  try {
    const parsed = JSON.parse(match[0]) as { ok?: boolean; issues?: string[] }
    if (parsed.ok === false) {
      return { checked: true, ok: false, reason: (parsed.issues ?? ['defect detected']).join('; ').slice(0, 200), costUsd: turn.costUsd ?? 0 }
    }
    return { checked: true, ok: true, costUsd: turn.costUsd ?? 0 }
  } catch {
    return { checked: false, ok: true, reason: 'verifier reply was not parsable', costUsd: turn.costUsd ?? 0 }
  }
}

/**
 * Wraps one generation runner with refinement before and verification after.
 * Images only; video and audio pass straight through.
 */
export async function guardedGeneration(
  input: GenerationParams,
  runOnce: (params: GenerationParams) => Promise<GenerationResult>
): Promise<GenerationResult> {
  if (input.mediaType !== 'image') return runOnce(input)

  const local = isLocal(input)
  let params = input
  let guardCost = 0
  let refinedFrom: string | undefined

  if (!input.skipRefine && (local || promptIsThin(input.prompt))) {
    const refined = await refinePrompt(input, local)
    guardCost += refined.costUsd
    if (refined.changed) {
      refinedFrom = input.prompt
      params = { ...input, prompt: refined.prompt }
      console.log(`[guard] refined prompt (${local ? 'local model' : 'thin prompt'}): "${refined.prompt.slice(0, 120)}…"`)
    }
  }

  const rejected: NonNullable<GenerationResult['rejected']> = []
  const attempts = local ? LOCAL_VERIFY_RETRIES + 1 : 1
  let verification: GenerationResult['verification']

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await runOnce(params)
    if (!result.ok || !result.src || !local) {
      return finish(result, guardCost, refinedFrom, rejected, verification)
    }
    const verdict = await verifyImage(result.src, params.prompt)
    guardCost += verdict.costUsd
    verification = { checked: verdict.checked, reason: verdict.reason }
    if (verdict.ok || !verdict.checked || attempt === attempts) {
      if (!verdict.ok) console.warn(`[guard] keeping a flagged image — retries exhausted: ${verdict.reason}`)
      return finish(result, guardCost, refinedFrom, rejected, verification)
    }
    console.log(`[guard] rejected attempt ${attempt}/${attempts}: ${verdict.reason} — regenerating with a new seed`)
    rejected.push({ src: result.src, thumbSrc: result.thumbSrc, reason: verdict.reason ?? 'defect detected' })
  }
  // unreachable: the loop always returns on its last attempt
  return runOnce(params)
}

function finish(
  result: GenerationResult,
  guardCost: number,
  refinedFrom: string | undefined,
  rejected: NonNullable<GenerationResult['rejected']>,
  verification: GenerationResult['verification']
): GenerationResult {
  const billed = llmBilling() === 'api'
  const costUsd = billed && guardCost > 0 ? (result.costUsd ?? 0) + guardCost : result.costUsd
  const guardLabel = guardCost > 0 ? (billed ? `guard $${guardCost.toFixed(3)}` : `guard tokens $${guardCost.toFixed(3)} (plan)`) : ''
  const note = result.note && guardLabel ? `${result.note} · ${guardLabel}` : result.note
  return {
    ...result,
    costUsd,
    note,
    ...(refinedFrom ? { refinedFrom } : {}),
    ...(rejected.length ? { rejected } : {}),
    ...(verification ? { verification } : {})
  }
}
