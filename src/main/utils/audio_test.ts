import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { assetPathForUrl } from '../asset-store'
import { cloneVoice, composeMusic, searchVoices, soundEffects, textToSpeech } from '../elevenlabs-tools'
import { TestRun, envVar } from './test-harness'

/**
 * Audio through the direct ElevenLabs tool-call path (elevenlabs-tools.ts) —
 * deliberately NOT the agent-driven route, matching how the Create panel's
 * audio jobs actually run. Also the engine behind the generate-audio skill.
 *
 * Env knobs:
 *   LYME_TEST_AUDIO_KIND — run ONE job instead of the default suite:
 *                          tts | sfx | music | voices
 *   LYME_TEST_PROMPT     — the text to speak / SFX description / music prompt
 *   LYME_TEST_VOICE      — voice name for TTS
 *   LYME_TEST_DURATION   — seconds (SFX: 0.5–5; music: rounded to ms)
 *   LYME_TEST_MUSIC=1    — include music in the default suite
 *   LYME_TEST_CLONE_DIR  — directory of sample audio files; runs voice clone
 */
export async function run(t: TestRun): Promise<void> {
  const kind = envVar('LYME_TEST_AUDIO_KIND')
  const prompt = envVar('LYME_TEST_PROMPT')
  const voiceName = envVar('LYME_TEST_VOICE')
  const duration = envVar('LYME_TEST_DURATION')

  const runVoices = async (): Promise<void> => {
    const listing = await searchVoices(prompt ?? '')
    if (listing.ok) {
      t.pass('voice listing', `${(listing.text ?? '').slice(0, 200).replace(/\s+/g, ' ')}…`)
    } else {
      t.fail('voice listing', listing.error ?? 'no reply')
    }
  }

  const runTts = async (): Promise<void> => {
    t.log(`LIVE BILLED CALL — text_to_speech${voiceName ? ` (voice: ${voiceName})` : ''}`)
    const tts = await textToSpeech({
      text: prompt ?? 'Lyme Hype audio pipeline test. Sixty seconds, one story.',
      voiceName
    })
    if (tts.ok && tts.src && existsSync(assetPathForUrl(tts.src) ?? '')) {
      t.pass('text-to-speech')
      t.output(tts.src)
    } else {
      t.fail('text-to-speech', tts.error ?? 'no output file')
    }
  }

  const runSfx = async (): Promise<void> => {
    t.log('LIVE BILLED CALL — text_to_sound_effects')
    const sfx = await soundEffects({
      prompt: prompt ?? 'A citrus fruit being sliced on a wooden board',
      durationSec: duration ? Number(duration) : 2
    })
    if (sfx.ok && sfx.src) {
      t.pass('sound effects')
      t.output(sfx.src)
    } else {
      t.fail('sound effects', sfx.error ?? 'no output file')
    }
  }

  const runMusic = async (): Promise<void> => {
    t.log('LIVE BILLED CALL — compose_music (can take minutes)')
    const music = await composeMusic({
      prompt: prompt ?? 'Upbeat lo-fi with a citrus-bright synth lead',
      lengthMs: duration ? Number(duration) * 1000 : 10_000
    })
    if (music.ok && music.src) {
      t.pass('music')
      t.output(music.src)
    } else {
      t.fail('music', music.error ?? 'no output file')
    }
  }

  if (kind) {
    const jobs: Record<string, () => Promise<void>> = { tts: runTts, sfx: runSfx, music: runMusic, voices: runVoices }
    const job = jobs[kind.toLowerCase()]
    if (!job) {
      t.fail('audio', `unknown LYME_TEST_AUDIO_KIND "${kind}" — use tts, sfx, music, or voices`)
      return
    }
    await job()
    return
  }

  // Default suite: listing first (also proves the connector is reachable),
  // then one short spend per job type.
  await runVoices()
  if (t.failures > 0) {
    t.log('aborting the remaining audio tests — the connector itself is not reachable')
    return
  }
  await runTts()
  await runSfx()
  if (envVar('LYME_TEST_MUSIC') === '1') {
    await runMusic()
  } else {
    t.skip('music', 'set LYME_TEST_MUSIC=1 (or LYME_TEST_AUDIO_KIND=music) to run')
  }

  const cloneDir = envVar('LYME_TEST_CLONE_DIR')
  if (!cloneDir) {
    t.skip('voice clone', 'set LYME_TEST_CLONE_DIR=<dir of mp3/wav samples> to run — creates a persistent voice on the account')
    return
  }
  const samples = readdirSync(cloneDir)
    .filter((f) => /\.(mp3|wav|m4a|flac)$/i.test(f))
    .map((f) => join(cloneDir, f))
  if (samples.length === 0) {
    t.fail('voice clone', `no audio files found in ${cloneDir}`)
    return
  }
  t.log(`LIVE BILLED CALL — voice_clone from ${samples.length} sample(s); the created voice persists on the account`)
  const clone = await cloneVoice({ name: voiceName ?? 'Lyme Test Clone', filePaths: samples })
  if (clone.ok) {
    t.pass('voice clone', (clone.text ?? '').slice(0, 100))
  } else {
    t.fail('voice clone', clone.error ?? 'clone failed')
  }
}
