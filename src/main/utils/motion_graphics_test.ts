import { existsSync } from 'node:fs'
import { assetPathForUrl, importFileAsset } from '../asset-store'
import { probeMediaInfo, resolveFfmpeg } from '../ffmpeg'
import { runGeneration } from '../generation'
import { keyAlpha } from '../media-tools'
import { TestRun, envVar, synthClip, synthFrame } from './test-harness'

/**
 * The Motion graphics wizard's two load-bearing pipeline pieces, tested
 * without the wizard UI:
 *   1. reference-conditioned image generation (the wizard's variation stage) —
 *      one billed call, conditioned on a synthetic solid frame;
 *   2. colorkey → VP9-alpha keying (the final stage) — local ffmpeg, free,
 *      verified by re-probing the output for the webm alpha side-channel.
 * The animate stage (start/end-frame video) lives in video_test.ts under
 * LYME_TEST_FRAMES=1 — same call shape, not duplicated here.
 */
export async function run(t: TestRun): Promise<void> {
  const reference = synthFrame('mg-reference.png', 'lime')
  if (!reference) {
    t.skip('reference-conditioned image', 'could not synthesize a reference frame (no ffmpeg on PATH)')
  } else {
    t.log('LIVE BILLED CALL — image generation conditioned on a synthetic reference frame')
    const result = await runGeneration({
      mediaType: 'image',
      prompt:
        envVar('LYME_TEST_PROMPT') ??
        'Bold geometric badge that says HYPE, matching the exact green of the reference image, on black',
      referenceImagePaths: [reference]
    })
    if (result.ok && result.src) {
      t.pass('reference-conditioned image', result.note ?? '')
      t.output(result.src)
    } else {
      t.fail('reference-conditioned image', result.error ?? 'no src returned')
    }
  }

  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    t.skip('alpha keying', 'no ffmpeg binary found')
    return
  }
  const clip = synthClip('mg-black-bg.mp4', { color: 'black', drawBox: true })
  if (!clip) {
    t.fail('alpha keying', 'failed to synthesize the black-background input clip')
    return
  }
  // keyAlpha takes an asset URL, matching how the wizard hands it a generated
  // node — importing first exercises that same path.
  const imported = importFileAsset(clip)
  const keyed = await keyAlpha({ assetUrl: imported.url })
  if (!keyed.ok || !keyed.src) {
    t.fail('alpha keying', keyed.error ?? 'no output')
    return
  }
  const keyedPath = assetPathForUrl(keyed.src)
  if (!keyedPath || !existsSync(keyedPath)) {
    t.fail('alpha keying', `output not on disk: ${keyed.src}`)
    return
  }
  const info = probeMediaInfo(ffmpeg.path, keyedPath)
  if (info.vp9Alpha) {
    t.pass('alpha keying', 'VP9 alpha side-channel confirmed')
    t.output(keyed.src)
  } else {
    t.fail('alpha keying', 'output webm has no alpha_mode side-channel')
  }
}
