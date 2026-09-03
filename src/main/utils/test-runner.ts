import { app } from 'electron'
import { TestRun } from './test-harness'
import * as audio from './audio_test'
import * as chatrealty from './chatrealty_test'
import * as comfyWatchdog from './comfy_watchdog_test'
import * as deepfake from './deepfake_test'
import * as image from './image_test'
import * as isolateAudio from './isolate_audio_test'
import * as lora from './lora_test'
import * as motionGraphics from './motion_graphics_test'
import * as video from './video_test'

/**
 * Feature-test entry point — `LYME_TEST=<feature>[,<feature>...]` or
 * `LYME_TEST=all`, run via `npm run dev` like the selftest. Features run
 * sequentially (they share connectors and the asset store), log
 * `[test:<feature>]` lines, and the process exits non-zero on any failure.
 * Only the features named on the command line run — naming one IS the opt-in
 * to its billed calls; every extra billed call inside a feature is gated
 * behind its own env flag, documented in each test's header.
 */
const FEATURES: Record<string, { run: (t: TestRun) => Promise<void> }> = {
  comfy_watchdog: comfyWatchdog,
  image,
  video,
  audio,
  motion_graphics: motionGraphics,
  lora,
  deepfake,
  isolate_audio: isolateAudio,
  chatrealty
}

export async function runFeatureTests(spec: string): Promise<void> {
  const names =
    spec.trim().toLowerCase() === 'all'
      ? Object.keys(FEATURES)
      : spec
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)

  const unknown = names.filter((n) => !FEATURES[n])
  if (unknown.length > 0) {
    console.log(
      `[test] unknown feature(s): ${unknown.join(', ')} — available: ${Object.keys(FEATURES).join(', ')}, or "all"`
    )
    app.exit(2)
    return
  }

  let totalFailures = 0
  for (const name of names) {
    const t = new TestRun(name)
    const started = Date.now()
    t.log('— starting —')
    try {
      await FEATURES[name].run(t)
    } catch (error) {
      t.fail('unhandled', error instanceof Error ? (error.stack ?? error.message) : String(error))
    }
    t.log(
      `— done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${t.passes} pass, ${t.failures} fail, ${t.skips} skip —`
    )
    totalFailures += t.failures
  }

  console.log(`[test] ${totalFailures === 0 ? 'ALL PASS' : `${totalFailures} FAILURE(S)`}`)
  app.exit(totalFailures === 0 ? 0 : 1)
}
