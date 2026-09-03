import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { trainKreaStyle } from '../krea-training'
import { TestRun, envVar } from './test-harness'

/**
 * Krea-native LoRA training (krea-training.ts — the deliberate non-MCP REST
 * exception). Training is the most expensive single call in the app and takes
 * minutes, so it never runs on synthetic data: it requires a real image
 * directory, passed explicitly.
 *
 * Env knobs:
 *   LYME_TEST_LORA_DIR   — REQUIRED: directory of ≥4 png/jpg/webp training images
 *   LYME_TEST_LORA_STEPS — optional step count (keep low for a test run)
 */
export async function run(t: TestRun): Promise<void> {
  const dir = envVar('LYME_TEST_LORA_DIR')
  if (!dir) {
    t.skip('krea LoRA training', 'set LYME_TEST_LORA_DIR=<dir of training images> — training is a real multi-minute spend, no synthetic default')
    return
  }
  const images = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => join(dir, f))
  if (images.length < 4) {
    t.fail('krea LoRA training', `only ${images.length} usable image(s) in ${dir} — need at least 4`)
    return
  }

  const steps = envVar('LYME_TEST_LORA_STEPS')
  t.log(`LIVE BILLED CALL — training a style from ${images.length} images${steps ? ` at ${steps} steps` : ''}; polls up to 20 minutes`)
  const result = await trainKreaStyle({
    name: `lyme-test-${Date.now().toString(36)}`,
    imagePaths: images,
    ...(steps ? { steps: Number(steps) } : {})
  })
  if (result.ok && result.style) {
    t.pass('krea LoRA training', `style "${result.style.name}" (${result.style.id}, trainer ${result.style.trainer ?? '?'}) — visible in Settings › Trained styles`)
  } else {
    t.fail('krea LoRA training', result.error ?? 'no style returned')
  }
}
