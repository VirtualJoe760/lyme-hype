import { existsSync } from 'node:fs'
import { assetPathForUrl } from '../asset-store'
import { listConnectors } from '../connectors-store'
import { textToSpeech } from '../elevenlabs-tools'
import { runGeneration } from '../generation'
import { TestRun, envVar } from './test-harness'

/**
 * Lipsync/deepfake through the agent-driven path with the Deepfake node's
 * connector restriction (yapper + muapi, whichever are installed). A synthetic
 * clip has no face for a lipsync model to find, so the source video must be a
 * real talking-head clip, passed explicitly.
 *
 * Env knobs:
 *   LYME_TEST_FACE_VIDEO — REQUIRED: path to a real face/talking-head video
 *   LYME_TEST_AUDIO      — optional speech audio; otherwise a short TTS line is
 *                          generated first (one extra ElevenLabs call)
 *   LYME_TEST_PROMPT     — the line spoken by that TTS fallback (verbatim)
 */
export async function run(t: TestRun): Promise<void> {
  const faceVideo = envVar('LYME_TEST_FACE_VIDEO')
  if (!faceVideo) {
    t.skip('lipsync', 'set LYME_TEST_FACE_VIDEO=<path to a real talking-head clip> — synthetic clips have no face to sync')
    return
  }
  if (!existsSync(faceVideo)) {
    t.fail('lipsync', `LYME_TEST_FACE_VIDEO does not exist: ${faceVideo}`)
    return
  }

  const installed = listConnectors().map((c) => c.id)
  const connectorIds = ['yapper', 'muapi'].filter((id) => installed.includes(id))
  if (connectorIds.length === 0) {
    t.skip('lipsync', 'neither yapper nor muapi is installed — add one in Settings › Connectors')
    return
  }

  let audioPath = envVar('LYME_TEST_AUDIO')
  if (audioPath && !existsSync(audioPath)) {
    t.fail('lipsync', `LYME_TEST_AUDIO does not exist: ${audioPath}`)
    return
  }
  if (!audioPath) {
    t.log('LIVE BILLED CALL — generating a short speech line first (ElevenLabs TTS)')
    const tts = await textToSpeech({
      text: envVar('LYME_TEST_PROMPT') ?? 'This is a Lyme Hype lipsync pipeline test.'
    })
    audioPath = tts.ok && tts.src ? (assetPathForUrl(tts.src) ?? undefined) : undefined
    if (!audioPath) {
      t.fail('lipsync', `could not produce speech audio: ${tts.error ?? 'no file'} — or pass LYME_TEST_AUDIO directly`)
      return
    }
    t.pass('speech for lipsync', audioPath)
  }

  t.log(`LIVE BILLED CALL — lipsync via ${connectorIds.join(' + ')} (upload + render)`)
  const result = await runGeneration({
    mediaType: 'video',
    prompt: 'Lipsync the person in the source video to the provided audio. Keep the original framing.',
    connectorIds,
    sourceMediaPath: faceVideo,
    referenceAudioPaths: [audioPath]
  })
  if (result.ok && result.src) {
    t.pass('lipsync', result.note ?? '')
    t.output(result.src)
  } else {
    t.fail('lipsync', result.error ?? 'no src returned')
  }
}
