import { existsSync } from 'node:fs'
import { assetPathForUrl } from '../asset-store'
import { isolateAudio } from '../media-tools'
import { TestRun, envVar, synthClip } from './test-harness'

/**
 * The Isolate audio tile's local ffmpeg job — free, no connector. With
 * LYME_TEST_INPUT it extracts from a real file or direct-file URL (the
 * isolate-audio skill's path); without it, a synthetic sine-tone clip proves
 * the pipeline end to end.
 */
export async function run(t: TestRun): Promise<void> {
  const input = envVar('LYME_TEST_INPUT')
  let source: { filePath?: string; url?: string }
  if (input) {
    if (/^https?:\/\//i.test(input)) {
      source = { url: input }
    } else if (existsSync(input)) {
      source = { filePath: input }
    } else {
      t.fail('isolate audio', `LYME_TEST_INPUT does not exist: ${input}`)
      return
    }
  } else {
    const clip = synthClip('isolate-input.mp4', { color: 'green', withAudio: true })
    if (!clip) {
      t.skip('isolate audio', 'could not synthesize an input clip (no ffmpeg on PATH)')
      return
    }
    source = { filePath: clip }
  }

  const result = await isolateAudio(source)
  if (!result.ok || !result.src) {
    t.fail('isolate audio', result.error ?? 'no output')
    return
  }
  const onDisk = assetPathForUrl(result.src)
  if (onDisk && existsSync(onDisk) && /\.mp3$/i.test(onDisk)) {
    t.pass('isolate audio', input ? `extracted from ${input}` : 'sine track extracted from synthetic clip')
    t.output(result.src)
  } else {
    t.fail('isolate audio', `output missing or not mp3: ${result.src}`)
  }
}
