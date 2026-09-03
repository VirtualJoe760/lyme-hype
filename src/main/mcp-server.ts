import { existsSync } from 'node:fs'
import { assetPathForUrl, importFileAsset } from './asset-store'
import { hasChatRealtyToken, pullListingPhotos } from './chatrealty'
import { listConnectors } from './connectors-store'
import { readSecretValue } from './credential-vault'
import {
  cloneVoice,
  composeMusic,
  searchVoices,
  soundEffects,
  textToSpeech
} from './elevenlabs-tools'
import { runGeneration } from './generation'
import { trainKreaStyle } from './krea-training'
import { isolateAudio, keyAlpha } from './media-tools'
import type { GenerationParams, GenerationResult } from '@shared/types'

/**
 * Lyme Hype AS an MCP server (`electron . --mcp`) — the inverse of the
 * connector system. The app normally *consumes* MCP servers (muapi, Gemini,
 * ElevenLabs…); this mode *exposes* the app's own creative pipeline as typed
 * tools over stdio, so an outside agent (Claude Code via .mcp.json, or any
 * MCP client) can drive generation without the UI. Same hand-rolled
 * newline-delimited JSON-RPC as resources/gemini-mcp.cjs — no SDK dependency,
 * and the shape is already proven by both bundled wrappers.
 *
 * Runs against the BUILT bundle (out/main/index.js), so `npm run build` must
 * precede a server restart after code changes.
 *
 * Transport lives in mcp-hub.ts: ONE backend per machine listens on a fixed
 * named pipe (Electron on Windows crashes reading a piped stdin, so
 * resources/lyme-mcp-bridge.cjs speaks stdio to the client and relays). This
 * file is the stateless per-message handler that any number of connected
 * bridges share — and the studio serves it too while it is open.
 *
 * Tool results are one JSON object as text: { ok, path?, assetUrl?, note?,
 * costUsd?, error?, ... } — `path` is the on-disk file an MCP client can hand
 * to a user directly.
 */

export type JsonRpcMessage = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown> }
type ToolResult = { content: { type: 'text'; text: string }[]; isError: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

function json(payload: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError }
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function strArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key]
  if (!Array.isArray(v)) return undefined
  const items = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return items.length > 0 ? items : undefined
}

function requireExisting(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`)
}

function generationPayload(result: GenerationResult): Record<string, unknown> {
  if (!result.ok || !result.src) {
    return { ok: false, error: result.error ?? 'no result', costUsd: result.costUsd ?? null }
  }
  return {
    ok: true,
    path: assetPathForUrl(result.src),
    assetUrl: result.src,
    note: result.note,
    promptUsed: result.promptUsed,
    costUsd: result.costUsd ?? null
  }
}

async function generate(params: GenerationParams): Promise<unknown> {
  return generationPayload(await runGeneration(params))
}

const HANDLERS: Record<string, ToolHandler> = {
  list_generation_connectors: async () => {
    const connectors = listConnectors().map((c) => ({
      id: c.id,
      name: c.name,
      transport: c.kind,
      authType: c.authType,
      hasCredential: c.authType === 'none' ? true : readSecretValue(c.id) !== null
    }))
    return { ok: true, connectors, chatRealtyToken: hasChatRealtyToken() }
  },

  generate_image: async (args) => {
    const prompt = str(args, 'prompt')
    if (!prompt) throw new Error('prompt is required')
    const refs = strArray(args, 'reference_image_paths')
    const characterRefs = strArray(args, 'character_reference_paths')
    const styleRefs = strArray(args, 'style_reference_paths')
    for (const p of [...(refs ?? []), ...(characterRefs ?? []), ...(styleRefs ?? [])]) {
      requireExisting(p, 'reference image')
    }
    return generate({
      mediaType: 'image',
      prompt,
      aspectRatio: str(args, 'aspect_ratio') ?? '9:16',
      connectorId: str(args, 'connector_id'),
      model: str(args, 'model'),
      imageSize: str(args, 'image_size'),
      thinkingLevel: str(args, 'thinking_level'),
      steps: num(args, 'steps'),
      refStrength: num(args, 'strength'),
      referenceImagePaths: refs,
      characterReferencePaths: characterRefs,
      styleReferencePaths: styleRefs
    })
  },

  generate_video: async (args) => {
    const prompt = str(args, 'prompt')
    if (!prompt) throw new Error('prompt is required')
    const startFrame = str(args, 'start_frame_path')
    const endFrame = str(args, 'end_frame_path')
    if (startFrame) requireExisting(startFrame, 'start frame')
    if (endFrame) requireExisting(endFrame, 'end frame')
    const refs = strArray(args, 'reference_image_paths')
    refs?.forEach((p) => requireExisting(p, 'reference image'))
    return generate({
      mediaType: 'video',
      prompt,
      aspectRatio: str(args, 'aspect_ratio') ?? '9:16',
      connectorId: str(args, 'connector_id'),
      model: str(args, 'model'),
      resolution: str(args, 'resolution'),
      personGeneration: str(args, 'person_generation'),
      durationSec: num(args, 'duration_seconds'),
      referenceImagePaths: refs,
      startFramePath: startFrame,
      endFramePath: endFrame
    })
  },

  extend_video: async (args) => {
    const prompt = str(args, 'prompt')
    const source = str(args, 'source_video_path')
    if (!prompt || !source) throw new Error('prompt and source_video_path are required')
    requireExisting(source, 'source video')
    return generate({
      mediaType: 'video',
      prompt,
      connectorId: str(args, 'connector_id'),
      extendVideoPath: source,
      extendVideoDurationSec: num(args, 'previous_duration_seconds')
    })
  },

  generate_speech: async (args) => {
    const text = str(args, 'text')
    if (!text) throw new Error('text is required')
    const result = await textToSpeech({ text, voiceName: str(args, 'voice_name') })
    return result.ok && result.src
      ? { ok: true, path: assetPathForUrl(result.src), assetUrl: result.src }
      : { ok: false, error: result.error ?? 'no output file' }
  },

  generate_sound_effect: async (args) => {
    const prompt = str(args, 'prompt')
    if (!prompt) throw new Error('prompt is required')
    const result = await soundEffects({ prompt, durationSec: num(args, 'duration_seconds') })
    return result.ok && result.src
      ? { ok: true, path: assetPathForUrl(result.src), assetUrl: result.src }
      : { ok: false, error: result.error ?? 'no output file' }
  },

  generate_music: async (args) => {
    const prompt = str(args, 'prompt')
    if (!prompt) throw new Error('prompt is required')
    const seconds = num(args, 'duration_seconds')
    const result = await composeMusic({ prompt, lengthMs: seconds ? seconds * 1000 : 10_000 })
    return result.ok && result.src
      ? { ok: true, path: assetPathForUrl(result.src), assetUrl: result.src }
      : { ok: false, error: result.error ?? 'no output file' }
  },

  list_voices: async (args) => {
    const result = await searchVoices(str(args, 'search') ?? '')
    return result.ok ? { ok: true, listing: result.text } : { ok: false, error: result.error }
  },

  clone_voice: async (args) => {
    const name = str(args, 'name')
    const samples = strArray(args, 'sample_paths')
    if (!name || !samples) throw new Error('name and sample_paths are required')
    samples.forEach((p) => requireExisting(p, 'sample'))
    const result = await cloneVoice({ name, filePaths: samples })
    return result.ok ? { ok: true, detail: result.text } : { ok: false, error: result.error }
  },

  lipsync: async (args) => {
    const faceVideo = str(args, 'face_video_path')
    if (!faceVideo) throw new Error('face_video_path is required')
    requireExisting(faceVideo, 'face video')
    let audioPath = str(args, 'audio_path')
    if (audioPath) requireExisting(audioPath, 'audio')
    const speechText = str(args, 'speech_text')
    if (!audioPath && speechText) {
      const tts = await textToSpeech({ text: speechText, voiceName: str(args, 'voice_name') })
      if (!tts.ok || !tts.src) return { ok: false, error: `speech generation failed: ${tts.error ?? 'no file'}` }
      audioPath = assetPathForUrl(tts.src) ?? undefined
    }
    if (!audioPath) throw new Error('pass audio_path or speech_text')
    const installed = listConnectors().map((c) => c.id)
    const connectorIds = ['yapper', 'muapi'].filter((id) => installed.includes(id))
    if (connectorIds.length === 0) {
      return { ok: false, error: 'neither yapper nor muapi is installed — add one in Settings › Connectors' }
    }
    return generate({
      mediaType: 'video',
      prompt: 'Lipsync the person in the source video to the provided audio. Keep the original framing.',
      connectorIds,
      sourceMediaPath: faceVideo,
      referenceAudioPaths: [audioPath]
    })
  },

  key_alpha: async (args) => {
    const input = str(args, 'input_path')
    if (!input) throw new Error('input_path is required')
    requireExisting(input, 'input')
    const imported = importFileAsset(input)
    const result = await keyAlpha({
      assetUrl: imported.url,
      color: str(args, 'color'),
      similarity: num(args, 'similarity'),
      blend: num(args, 'blend')
    })
    return result.ok && result.src
      ? { ok: true, path: assetPathForUrl(result.src), assetUrl: result.src }
      : { ok: false, error: result.error ?? 'no output' }
  },

  isolate_audio: async (args) => {
    const input = str(args, 'input')
    if (!input) throw new Error('input is required')
    const source = /^https?:\/\//i.test(input) ? { url: input } : { filePath: input }
    if (source.filePath) requireExisting(source.filePath, 'input')
    const result = await isolateAudio(source)
    return result.ok && result.src
      ? { ok: true, path: assetPathForUrl(result.src), assetUrl: result.src }
      : { ok: false, error: result.error ?? 'no output' }
  },

  train_lora_style: async (args) => {
    const name = str(args, 'name')
    const images = strArray(args, 'image_paths')
    if (!name || !images) throw new Error('name and image_paths are required')
    if (images.length < 4) throw new Error(`need at least 4 training images, got ${images.length}`)
    images.forEach((p) => requireExisting(p, 'training image'))
    const result = await trainKreaStyle({ name, imagePaths: images, steps: num(args, 'steps') })
    return result.ok && result.style
      ? { ok: true, styleId: result.style.id, name: result.style.name, trainer: result.style.trainer }
      : { ok: false, error: result.error ?? 'no style returned' }
  },

  pull_listing_photos: async (args) => {
    const query = str(args, 'query')
    if (!query) throw new Error('query is required')
    if (!hasChatRealtyToken()) return { ok: false, error: 'no ChatRealty token configured' }
    const result = await pullListingPhotos(query)
    if (!result.ok) return { ok: false, error: result.error ?? 'pull failed' }
    return {
      ok: true,
      listings: result.listings,
      photos: result.images.map((img) => ({
        path: assetPathForUrl(img.src),
        label: img.label,
        listingKey: img.listingKey,
        photoIndex: img.photoIndex
      }))
    }
  }
}

const PATHS_NOTE = 'Absolute local paths only.'
const TOOLS = [
  {
    name: 'list_generation_connectors',
    description:
      'List the installed generation connectors (id, transport, whether a credential is stored) and whether a ChatRealty token is configured. Free — call this first when a generation tool fails or to pick a connector_id.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'generate_image',
    description:
      `Generate an image via the app's agent-driven pipeline (the agent picks the best installed connector tool). Billed on the connector's account. Optionally condition on reference images. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to generate — a full image prompt' },
        connector_id: { type: 'string', description: 'Restrict to one connector (gemini, openai-images, krea, fal, muapi) — optional' },
        model: { type: 'string', description: 'Exact model id on that connector (e.g. gemini-3.1-flash-lite-image = cheapest, gemini-3-pro-image = premium) — optional' },
        image_size: { type: 'string', description: '0.5K | 1K | 2K | 4K (gemini; price scales with size) — optional' },
        thinking_level: { type: 'string', description: 'minimal | high — composition reasoning depth (gemini-3.1-flash-image only) — optional' },
        steps: { type: 'number', description: 'Sampling steps for local comfyui models — optional' },
        strength: { type: 'number', description: 'img2img inspiration dial for local models with a reference: 1 ≈ ignore, 0.6 default, 0.3 ≈ close variation — optional' },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: 'Object/content reference images to condition on — optional' },
        character_reference_paths: { type: 'array', items: { type: 'string' }, description: "CHARACTER refs — preserve this exact person's likeness (≤4) — optional" },
        style_reference_paths: { type: 'array', items: { type: 'string' }, description: 'STYLE refs — match look, not content (≤3) — optional' },
        aspect_ratio: { type: 'string', description: '1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16 (default), 16:9, 21:9' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'generate_video',
    description:
      `Generate a video clip via the agent-driven pipeline. Billed; takes minutes. Optional start/end frame images for frame-conditioned renders (same image both ends = seamless loop). ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Shot description — camera move, subject, mood' },
        connector_id: { type: 'string', description: 'Restrict to one connector (gemini for Veo, muapi, fal) — optional' },
        model: { type: 'string', description: 'Exact model id (e.g. veo-3.1-lite-generate-preview = ~8x cheaper, veo-3.1-generate-preview = best) — optional' },
        resolution: { type: 'string', description: '720p (default) | 1080p | 4k — hi-res forces 8 s and bills higher; 4k not on lite — optional' },
        duration_seconds: { type: 'number', description: 'Veo: 4 | 6 | 8 (8 forced for interpolation/refs/hi-res) — optional' },
        person_generation: { type: 'string', description: 'allow_all (text-to-video) | allow_adult (image-conditioned modes) — optional' },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: '≤3 subject-consistency reference images (standard/fast Veo only; forces 8 s) — optional' },
        start_frame_path: { type: 'string', description: 'First-frame image — optional' },
        end_frame_path: { type: 'string', description: 'Last-frame image (same as start = loop) — optional' },
        aspect_ratio: { type: 'string', description: '16:9 or 9:16 (default)' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'extend_video',
    description: `Extend a previously generated video by ~7 seconds (Veo). Billed; takes minutes. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        source_video_path: { type: 'string', description: 'The video to extend' },
        prompt: { type: 'string', description: 'What happens in the next ~7 seconds' },
        connector_id: { type: 'string', description: 'Optional connector restriction' },
        previous_duration_seconds: { type: 'number', description: "Source video's current length, if known" }
      },
      required: ['source_video_path', 'prompt']
    }
  },
  {
    name: 'generate_speech',
    description: 'Text-to-speech via ElevenLabs (direct tool call, no agent). The text is spoken VERBATIM. Billed.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The exact words to speak' },
        voice_name: { type: 'string', description: 'ElevenLabs voice name — optional (see list_voices)' }
      },
      required: ['text']
    }
  },
  {
    name: 'generate_sound_effect',
    description: 'Sound effect via ElevenLabs from a description. Duration 0.5–5 seconds. Billed.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the sound' },
        duration_seconds: { type: 'number', description: '0.5–5 (default 2)' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'generate_music',
    description: 'Compose music via ElevenLabs from a description. Billed; composition can take minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description of the track' },
        duration_seconds: { type: 'number', description: 'Track length in seconds (default 10, min 3, max 600)' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'list_voices',
    description: 'List/search available ElevenLabs voices. Effectively free.',
    inputSchema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'Search term — optional, empty lists defaults' } }
    }
  },
  {
    name: 'clone_voice',
    description: `Clone a voice from sample audio files via ElevenLabs. Creates a PERSISTENT voice on the account — only call with explicit user confirmation. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new voice' },
        sample_paths: { type: 'array', items: { type: 'string' }, description: 'Sample audio files (mp3/wav)' }
      },
      required: ['name', 'sample_paths']
    }
  },
  {
    name: 'lipsync',
    description:
      `Lipsync a real talking-head video to speech (yapper/muapi). Pass audio_path, or speech_text to TTS it first. Billed; takes minutes. Only for the user's own likeness or footage they have rights to. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        face_video_path: { type: 'string', description: 'A real talking-head video' },
        audio_path: { type: 'string', description: 'The speech audio to sync to — optional if speech_text given' },
        speech_text: { type: 'string', description: 'Line to TTS first (spoken verbatim) — optional if audio_path given' },
        voice_name: { type: 'string', description: 'Voice for the TTS fallback — optional' }
      },
      required: ['face_video_path']
    }
  },
  {
    name: 'key_alpha',
    description: `Key a (near-)solid background to real alpha → VP9 webm, via local ffmpeg. Free, no connector. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        input_path: { type: 'string', description: 'The video to key' },
        color: { type: 'string', description: 'Background color to remove (default black)' },
        similarity: { type: 'number', description: 'Key tolerance 0–1 (default 0.15)' },
        blend: { type: 'number', description: 'Edge blend 0–1 (default 0.08)' }
      },
      required: ['input_path']
    }
  },
  {
    name: 'isolate_audio',
    description: 'Extract the audio track of a video as mp3, via local ffmpeg. Free. Accepts an absolute path or a direct https file URL (not hosting pages).',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'Absolute path or direct file URL of the video' } },
      required: ['input']
    }
  },
  {
    name: 'train_lora_style',
    description:
      `Train a custom style LoRA on Krea from ≥4 images. The most expensive single call in the app; polls up to 20 minutes. Only call with explicit user confirmation of the spend. ${PATHS_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the trained style' },
        image_paths: { type: 'array', items: { type: 'string' }, description: 'At least 4 training images (png/jpg/webp)' },
        steps: { type: 'number', description: 'Training steps — keep low for a cheap test run (optional)' }
      },
      required: ['name', 'image_paths']
    }
  },
  {
    name: 'pull_listing_photos',
    description:
      'Pull real MLS listing photos via the ChatRealty connector (search → photos → asset store). Free-ish (live API, no generation billing). Present listing data neutrally and factually.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Address, area, or listing search query' } },
      required: ['query']
    }
  }
]

export async function handleMcpMessage(msg: JsonRpcMessage): Promise<unknown> {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return {
      protocolVersion: (params?.['protocolVersion'] as string | undefined) ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lyme-hype', version: '0.1.0' }
    }
  }
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') {
    const name = params?.['name'] as string | undefined
    const args = (params?.['arguments'] as Record<string, unknown> | undefined) ?? {}
    const handler = name ? HANDLERS[name] : undefined
    if (!handler) return json({ ok: false, error: `Unknown tool: ${name}` }, true)
    try {
      const payload = await handler(args)
      const failed = typeof payload === 'object' && payload !== null && (payload as { ok?: boolean }).ok === false
      return json(payload, failed)
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
    }
  }
  if (id === undefined) return undefined // notification — no reply
  throw new Error(`Unknown method: ${method}`)
}
