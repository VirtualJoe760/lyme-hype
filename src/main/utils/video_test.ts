import { existsSync } from 'node:fs'
import { assetPathForUrl } from '../asset-store'
import { probeMediaInfo, resolveFfmpeg } from '../ffmpeg'
import { runGeneration } from '../generation'
import { TestRun, envVar, synthFrame } from './test-harness'

/**
 * Video generation through the agent-driven path. One billed text-to-video
 * call by default; frame conditioning and extend are opt-in because each is
 * its own billed render. Also the engine behind the generate-video skill.
 *
 * Env knobs:
 *   LYME_TEST_PROMPT       — override the default prompt
 *   LYME_TEST_CONNECTOR    — restrict to one connector id
 *   LYME_TEST_DURATION     — requested duration in seconds (Veo: 4 | 6 | 8)
 *   LYME_TEST_MODEL        — exact model id, or a comma list → one render PER
 *                            MODEL, side by side. Veo ids (gemini) and muapi's
 *                            short aliases both work (seedance-lite = vanilla
 *                            Seedance $0.10, seedance-pro-fast $0.06,
 *                            seedance-2-mini, kling-v2.5-turbo, sora-2, …)
 *   LYME_TEST_ASPECT       — aspect ratio (default 9:16; muapi tools default 16:9)
 *   LYME_TEST_RESOLUTION   — 720p | 1080p | 4k (hi-res forces 8 s, bills higher)
 *   LYME_TEST_PERSON       — person_generation: allow_all | allow_adult
 *   LYME_TEST_REF_IMAGES   — comma list of ≤3 subject-consistency reference
 *                            image paths (standard/fast models only)
 *   LYME_TEST_START_FRAME  — condition on this first-frame image (absolute path)
 *   LYME_TEST_END_FRAME    — condition on this last-frame image (absolute path)
 *   LYME_TEST_FRAMES=1     — frame-conditioned render with a synthetic frame
 *                            both ends (loop plumbing check) when no real
 *                            frames are passed
 *   LYME_TEST_EXTEND=1     — also extend the first result by ~7s
 */
export async function run(t: TestRun): Promise<void> {
  const connectorId = envVar('LYME_TEST_CONNECTOR')
  const prompt =
    envVar('LYME_TEST_PROMPT') ??
    'Slow dolly-in on a glowing lime wedge on a black studio background, subtle mist'
  const duration = envVar('LYME_TEST_DURATION')
  const startFrame = envVar('LYME_TEST_START_FRAME')
  const endFrame = envVar('LYME_TEST_END_FRAME')
  for (const [name, path] of [['LYME_TEST_START_FRAME', startFrame], ['LYME_TEST_END_FRAME', endFrame]] as const) {
    if (path && !existsSync(path)) {
      t.fail('text-to-video', `${name} does not exist: ${path}`)
      return
    }
  }

  const refImages = envVar('LYME_TEST_REF_IMAGES')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const p of refImages ?? []) {
    if (!existsSync(p)) {
      t.fail('text-to-video', `LYME_TEST_REF_IMAGES path does not exist: ${p}`)
      return
    }
  }

  // A model list runs one render per model, side by side — mirror of the image
  // lane's matrix. Different models bill very differently ($0.06 seedance-pro-fast
  // → $3+ Veo/4K tiers), so each run logs which model it is asking for.
  const models = envVar('LYME_TEST_MODEL')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const runs: { model?: string; label: string }[] = models?.length
    ? models.map((m) => ({ model: m, label: `text-to-video (${m})` }))
    : [{ model: undefined, label: 'text-to-video' }]

  let firstVideoPath: string | null = null
  for (const run of runs) {
    t.log(
      `LIVE BILLED CALL — ${startFrame || endFrame ? 'frame-conditioned ' : ''}video via ${run.model ?? connectorId ?? 'agent choice'}: "${prompt}"`
    )
    const result = await runGeneration({
      mediaType: 'video',
      prompt,
      aspectRatio: envVar('LYME_TEST_ASPECT') ?? '9:16',
      connectorId,
      model: run.model,
      resolution: envVar('LYME_TEST_RESOLUTION'),
      personGeneration: envVar('LYME_TEST_PERSON'),
      ...(refImages?.length ? { referenceImagePaths: refImages } : {}),
      ...(duration ? { durationSec: Number(duration) } : {}),
      ...(startFrame ? { startFramePath: startFrame } : {}),
      ...(endFrame ? { endFramePath: endFrame } : {})
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
    firstVideoPath ??= onDisk
    const ffmpeg = resolveFfmpeg()
    const audioNote = ffmpeg
      ? probeMediaInfo(ffmpeg.path, onDisk).hasAudio
        ? 'has audio'
        : 'no audio track'
      : 'ffmpeg absent, streams unprobed'
    t.pass(run.label, `${result.note ?? ''} · ${audioNote}`)
    if (result.promptUsed && result.promptUsed !== prompt) {
      t.log(`PROMPT SENT — ${result.promptUsed}`)
      t.log(`PROMPT SOURCE (EN) — ${prompt}`)
    }
    t.output(result.src)
  }

  if (envVar('LYME_TEST_FRAMES') === '1' && !startFrame && !endFrame) {
    const frame = synthFrame('frame-lime.png', 'lime')
    if (!frame) {
      t.skip('frame-conditioned video', 'could not synthesize a frame (no ffmpeg on PATH)')
    } else {
      t.log('LIVE BILLED CALL — start/end-frame conditioned render (loop: same frame both ends)')
      const framed = await runGeneration({
        mediaType: 'video',
        prompt: 'Soft particles drifting over the solid background, seamless loop',
        connectorId,
        startFramePath: frame,
        endFramePath: frame
      })
      if (framed.ok && framed.src) {
        t.pass('frame-conditioned video', framed.note ?? '')
        t.output(framed.src)
      } else {
        t.fail('frame-conditioned video', framed.error ?? 'no src returned')
      }
    }
  } else if (!startFrame && !endFrame) {
    t.skip('frame-conditioned video', 'set LYME_TEST_FRAMES=1 (or pass LYME_TEST_START_FRAME) to run')
  }

  if (envVar('LYME_TEST_EXTEND') === '1') {
    if (!firstVideoPath) {
      t.skip('extend video', 'needs a successful text-to-video result to extend')
    } else {
      t.log('LIVE BILLED CALL — extending the first result by ~7s')
      const extended = await runGeneration({
        mediaType: 'video',
        prompt: 'Continue the shot: the camera keeps pushing in as the glow intensifies',
        connectorId,
        extendVideoPath: firstVideoPath
      })
      if (extended.ok && extended.src) {
        t.pass('extend video', extended.note ?? '')
        t.output(extended.src)
      } else {
        t.fail('extend video', extended.error ?? 'no src returned')
      }
    }
  } else {
    t.skip('extend video', 'set LYME_TEST_EXTEND=1 to run (billed render)')
  }
}
