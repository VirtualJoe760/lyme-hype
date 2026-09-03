import { existsSync } from 'node:fs'
import { assetPathForUrl } from '../asset-store'
import { listConnectors } from '../connectors-store'
import { runGeneration } from '../generation'
import { TestRun, envVar } from './test-harness'

/**
 * Image generation through the real agent-driven path (generation.ts):
 * connectors attach as MCP servers, the agent picks a tool, the result lands
 * in the asset store. One billed call per requested connector. Also the engine
 * behind the generate-image skill, which passes the user's request through the
 * env knobs.
 *
 * Env knobs:
 *   LYME_TEST_PROMPT     — override the default prompt
 *   LYME_TEST_CONNECTOR  — one connector id (gemini, openai, krea, fal, muapi)
 *                          or a comma list to generate side-by-side, one image
 *                          per connector; omit to let the agent choose
 *   LYME_TEST_REF_IMAGE  — condition on this reference image (absolute path)
 *   LYME_TEST_ASPECT     — aspect ratio (default 9:16)
 *   LYME_TEST_MODEL      — exact model id passed to the tool's model param, or a
 *                          comma list → one generation PER MODEL, side by side
 *                          (e.g. gemini-2.5-flash-image,gemini-3.1-flash-image =
 *                          nano banana 1 vs 2 on the same prompt — they are
 *                          different models with different prices, not variants)
 *   LYME_TEST_SIZE       — image size tier: 0.5K | 1K | 2K | 4K
 *   LYME_TEST_THINKING   — minimal | high (gemini-3.1-flash-image only)
 *   LYME_TEST_CHAR_REFS  — comma list of CHARACTER reference paths (likeness)
 *   LYME_TEST_STYLE_REFS — comma list of STYLE reference paths (look, not content)
 *   LYME_TEST_REFS=1     — also run a pass reusing the first result as its
 *                          reference (plumbing check, one more billed call)
 */
export async function run(t: TestRun): Promise<void> {
  const installed = listConnectors().map((c) => c.id)
  t.log(`installed connectors: ${installed.join(', ') || '(none)'}`)

  const connectorIds = envVar('LYME_TEST_CONNECTOR')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [undefined]
  const aspectRatio = envVar('LYME_TEST_ASPECT') ?? '9:16'
  const prompt =
    envVar('LYME_TEST_PROMPT') ?? 'A single neon-green lime wedge on a black studio background, product shot'
  const refImage = envVar('LYME_TEST_REF_IMAGE')
  if (refImage && !existsSync(refImage)) {
    t.fail('text-to-image', `LYME_TEST_REF_IMAGE does not exist: ${refImage}`)
    return
  }
  const pathList = (name: string): string[] | undefined =>
    envVar(name)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const characterRefs = pathList('LYME_TEST_CHAR_REFS')
  const styleRefs = pathList('LYME_TEST_STYLE_REFS')
  for (const p of [...(characterRefs ?? []), ...(styleRefs ?? [])]) {
    if (!existsSync(p)) {
      t.fail('text-to-image', `reference path does not exist: ${p}`)
      return
    }
  }
  const extras = {
    imageSize: envVar('LYME_TEST_SIZE'),
    thinkingLevel: envVar('LYME_TEST_THINKING'),
    steps: envVar('LYME_TEST_STEPS') ? Number(envVar('LYME_TEST_STEPS')) : undefined,
    refStrength: envVar('LYME_TEST_STRENGTH') ? Number(envVar('LYME_TEST_STRENGTH')) : undefined,
    ...(characterRefs?.length ? { characterReferencePaths: characterRefs } : {}),
    ...(styleRefs?.length ? { styleReferencePaths: styleRefs } : {})
  }

  // A model list outranks the connector list: each model is its own run (paired
  // with the first requested connector), because nano banana 1 vs 2 are different
  // models with different prices — not variants of one thing.
  const models = pathList('LYME_TEST_MODEL')
  const runs: { connectorId?: string; model?: string; label: string }[] = models?.length
    ? models.map((m) => ({ connectorId: connectorIds[0], model: m, label: `text-to-image (${m})` }))
    : connectorIds.map((c) => ({
        connectorId: c,
        model: undefined,
        label: c ? `text-to-image (${c})` : 'text-to-image'
      }))

  let firstOnDisk: string | null = null
  for (const run of runs) {
    t.log(
      `LIVE BILLED CALL — ${refImage ? 'reference-conditioned ' : ''}image via ${run.model ?? run.connectorId ?? 'agent choice'}: "${prompt}"`
    )
    const result = await runGeneration({
      mediaType: 'image',
      prompt,
      aspectRatio,
      connectorId: run.connectorId,
      model: run.model,
      ...extras,
      ...(refImage ? { referenceImagePaths: [refImage] } : {})
    })

    if (!result.ok || !result.src) {
      t.fail(run.label, result.error ?? 'no src returned')
      continue
    }
    const onDisk = assetPathForUrl(result.src)
    if (!onDisk || !existsSync(onDisk)) {
      t.fail(run.label, `result imported but not on disk: ${result.src}`)
      continue
    }
    firstOnDisk ??= onDisk
    t.pass(run.label, result.note ?? '')
    if (result.promptUsed && result.promptUsed !== prompt) {
      t.log(`PROMPT SENT — ${result.promptUsed}`)
      t.log(`PROMPT SOURCE (EN) — ${prompt}`)
    }
    t.output(result.src)
  }

  if (envVar('LYME_TEST_REFS') !== '1') {
    if (!refImage) t.skip('reference-conditioned image', 'set LYME_TEST_REFS=1 to run (one more billed call)')
    return
  }
  if (!firstOnDisk) {
    t.skip('reference-conditioned image', 'needs a successful generation to use as the reference')
    return
  }

  t.log('LIVE BILLED CALL — reference-conditioned pass using the first result as the reference')
  const refResult = await runGeneration({
    mediaType: 'image',
    prompt: 'The same subject, now from a top-down angle, keeping the exact style and lighting of the reference',
    aspectRatio,
    connectorId: connectorIds[0],
    referenceImagePaths: [firstOnDisk]
  })
  if (refResult.ok && refResult.src) {
    t.pass('reference-conditioned image', refResult.note ?? '')
    t.output(refResult.src)
  } else {
    t.fail('reference-conditioned image', refResult.error ?? 'no src returned')
  }
}
