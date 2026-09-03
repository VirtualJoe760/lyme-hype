#!/usr/bin/env node
/**
 * Thin Gemini media MCP server (stdio, newline-delimited JSON-RPC).
 *
 * Why this exists: Google ships no first-party media-generation MCP, and the
 * repo rule is to bundle a thin wrapper rather than trust an unvetted
 * community package (docs/connections-and-credentials.md). Plain Node, no
 * dependencies — global fetch against the Generative Language REST API.
 *
 * Auth: GEMINI_API_KEY env var (injected by Lyme Hype's connector runtime from
 * the vault). The key never appears in tool results.
 *
 * Results: media is written to a temp file and returned as a
 * `RESULT_FILE: <absolute path>` text line — Lyme Hype's generation service
 * imports that file into its asset store. (Gemini returns bytes/short-lived
 * authed URIs, not public URLs, so a file hand-off is the clean boundary.)
 */
'use strict'

const { randomUUID } = require('node:crypto')
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, extname } = require('node:path')

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
// Model succession (verified against Google's deprecations page, 2026-08):
// veo-3.0-generate-001 was SHUT DOWN 2026-06-30 — the veo-3.1 family is
// current and carries lastFrame across all variants. gemini-2.5-flash-image
// works until 2026-10-02; gemini-3.1-flash-image (Nano Banana 2) is the
// recommended successor, so it's tried first with 2.5 as an automatic
// fallback in case the GA id differs.
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'
// Per-call choices (docs/connectors/reference/gemini.md "Models"): NB2 (default),
// Lite (cheapest, 1K-only, object refs only), Pro (premium composition).
const IMAGE_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image']
// Fallback chain for id churn: the -preview id variant, then legacy 2.5
// (which shuts down 2026-10-02 — drop it from this chain then).
const IMAGE_MODEL_FALLBACK = 'gemini-2.5-flash-image'
const IMAGE_ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const IMAGE_SIZES = ['0.5K', '1K', '2K', '4K']
const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview'
// The 3.1 family, callable per-request: lite is ~8x cheaper ($0.05/s vs
// $0.40/s), 720p-only, and still supports frame interpolation — the right
// default lever for Motion graphics reveals.
const VIDEO_MODELS = ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview']
const VIDEO_POLL_MS = 10_000
const VIDEO_TIMEOUT_MS = 6 * 60_000
// Nano Banana 2 accepts up to 10 object refs (the old 3-image guidance was
// gemini-2.5-era); the fallback model still prefers ≤3.
const MAX_REFERENCE_IMAGES = 10

function apiKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return key
}

function outDir() {
  const dir = join(tmpdir(), 'lyme-hype-gemini')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function api(path, body) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': apiKey(), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 300)
    throw new Error(`Gemini API ${res.status}: ${msg}`)
  }
  return json
}

const EXT_FOR_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4'
}

const MIME_FOR_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function inlineImagePart(path) {
  const mimeType = MIME_FOR_EXT[extname(path).toLowerCase()]
  if (!mimeType) throw new Error(`Unsupported reference image type: ${path}`)
  return { inlineData: { mimeType, data: readFileSync(path).toString('base64') } }
}

function frameImage(path) {
  const mimeType = MIME_FOR_EXT[extname(path).toLowerCase()]
  if (!mimeType) throw new Error(`Unsupported frame image type: ${path}`)
  return { bytesBase64Encoded: readFileSync(path).toString('base64'), mimeType }
}

function refArray(value, cap) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, cap) : []
}

async function generateImage(args) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const model = IMAGE_MODELS.includes(args.model) ? args.model : IMAGE_MODEL

  // Typed reference images. generateContent has no structured reference-type
  // field (that's Interactions-API territory) — the working pattern is inline
  // image parts plus a text preamble telling the model each image's role.
  // Caps per docs/connectors/reference/gemini.md: NB2 10 object + 4 character
  // + 3 style; the flat legacy param counts as object refs.
  const objectRefs = [...refArray(args.reference_image_paths, MAX_REFERENCE_IMAGES), ...refArray(args.object_reference_paths, MAX_REFERENCE_IMAGES)].slice(0, MAX_REFERENCE_IMAGES)
  const characterRefs = refArray(args.character_reference_paths, 4)
  const styleRefs = refArray(args.style_reference_paths, 3)
  const allRefs = [...objectRefs, ...characterRefs, ...styleRefs]

  const roleLines = []
  let index = 1
  if (objectRefs.length) {
    roleLines.push(`Images ${index}-${index + objectRefs.length - 1} are OBJECT references: include/compose these subjects.`)
    index += objectRefs.length
  }
  if (characterRefs.length) {
    roleLines.push(`Images ${index}-${index + characterRefs.length - 1} are CHARACTER references: preserve this exact person's likeness and identity.`)
    index += characterRefs.length
  }
  if (styleRefs.length) {
    roleLines.push(`Images ${index}-${index + styleRefs.length - 1} are STYLE references: match their visual style, palette and rendering, not their content.`)
  }

  const requestParts = allRefs.map(inlineImagePart)
  requestParts.push({ text: roleLines.length ? `${roleLines.join('\n')}\n\n${prompt}` : prompt })

  const generationConfig = {}
  const imageConfig = {}
  if (IMAGE_ASPECTS.includes(args.aspect_ratio)) imageConfig.aspectRatio = args.aspect_ratio
  if (IMAGE_SIZES.includes(args.image_size)) imageConfig.imageSize = args.image_size
  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig
  // Gemini 3.1 Flash Image only; other models reject it, so send selectively.
  if ((args.thinking_level === 'minimal' || args.thinking_level === 'high') && model === 'gemini-3.1-flash-image') {
    generationConfig.thinkingLevel = args.thinking_level
  }
  const body = { contents: [{ parts: requestParts }] }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig

  let resp
  try {
    resp = await api(`models/${model}:generateContent`, body)
  } catch (err) {
    // Model-id churn guard: if the preferred id isn't recognized on this
    // account yet, fall back to the still-live legacy model.
    if (/404|not found|is not supported/i.test(String(err && err.message)) && model !== IMAGE_MODEL_FALLBACK) {
      resp = await api(`models/${IMAGE_MODEL_FALLBACK}:generateContent`, body)
    } else {
      throw err
    }
  }
  const parts =
    (resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || []
  const inline = parts.map((p) => p.inlineData || p.inline_data).find(Boolean)
  if (!inline || !inline.data) {
    const refusal = parts.map((p) => p.text).filter(Boolean).join(' ')
    throw new Error(refusal ? `No image returned: ${refusal.slice(0, 200)}` : 'No image data in response')
  }
  const ext = EXT_FOR_MIME[(inline.mimeType || inline.mime_type || '').toLowerCase()] || '.png'
  const file = join(outDir(), `${randomUUID()}${ext}`)
  writeFileSync(file, Buffer.from(inline.data, 'base64'))
  return `RESULT_FILE: ${file}`
}

async function generateVideo(args) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const model = VIDEO_MODELS.includes(args.model) ? args.model : VIDEO_MODEL
  const instance = { prompt }
  // Frame conditioning (whole veo-3.1 family): instance.image is the start
  // frame, instance.lastFrame the end frame — a start→end interpolation, the
  // Motion graphics reveal/loop mechanism.
  if (args.start_frame_path) instance.image = frameImage(String(args.start_frame_path))
  if (args.end_frame_path) instance.lastFrame = frameImage(String(args.end_frame_path))
  // Style/asset reference images (≤3; standard + fast models only): keep a
  // subject's appearance consistent across shots.
  const videoRefs = refArray(args.reference_image_paths, 3)
  if (videoRefs.length) {
    if (model === 'veo-3.1-lite-generate-preview') {
      throw new Error('referenceImages are not supported on veo-3.1-lite-generate-preview — use the default or fast model.')
    }
    const referenceType = args.reference_type === 'style' ? 'style' : 'asset'
    instance.referenceImages = videoRefs.map((p) => ({ image: frameImage(String(p)), referenceType }))
  }
  const body = { instances: [instance] }
  const parameters = {}
  if (args.aspectRatio) parameters.aspectRatio = String(args.aspectRatio)
  if (['720p', '1080p', '4k'].includes(args.resolution)) {
    if (args.resolution === '4k' && model === 'veo-3.1-lite-generate-preview') {
      throw new Error('4k is not supported on veo-3.1-lite-generate-preview.')
    }
    parameters.resolution = args.resolution
  }
  if ([4, 6, 8].includes(Number(args.duration_seconds))) parameters.durationSeconds = Number(args.duration_seconds)
  // 8 s is mandatory for lastFrame interpolation, referenceImages, and >720p.
  if (instance.lastFrame || instance.referenceImages || (parameters.resolution && parameters.resolution !== '720p')) {
    parameters.durationSeconds = 8
  }
  if (['allow_all', 'allow_adult'].includes(args.person_generation)) {
    parameters.personGeneration = args.person_generation
  }
  if (Object.keys(parameters).length > 0) body.parameters = parameters
  const op = await api(`models/${model}:predictLongRunning`, body)
  if (!op.name) throw new Error('No operation returned for video generation')

  const deadline = Date.now() + VIDEO_TIMEOUT_MS
  let status = op
  while (!status.done) {
    if (Date.now() > deadline) throw new Error('Video generation timed out')
    await new Promise((r) => setTimeout(r, VIDEO_POLL_MS))
    status = await api(status.name.startsWith('operations/') || status.name.includes('/') ? status.name : `operations/${status.name}`)
  }
  if (status.error) throw new Error(`Video generation failed: ${status.error.message || 'unknown error'}`)

  const r = status.response || {}
  const gv = r.generateVideoResponse || r
  const sample = (gv.generatedSamples && gv.generatedSamples[0]) || (gv.generatedVideos && gv.generatedVideos[0])
  const uri = sample && sample.video && (sample.video.uri || sample.video.videoUri)
  if (!uri) throw new Error('Video finished but no video URI in response')

  // The URI needs the API key — download here so the key never leaves this process.
  const dl = await fetch(uri, { headers: { 'x-goog-api-key': apiKey() } })
  if (!dl.ok) throw new Error(`Video download failed: HTTP ${dl.status}`)
  const file = join(outDir(), `${randomUUID()}.mp4`)
  writeFileSync(file, Buffer.from(await dl.arrayBuffer()))
  return `RESULT_FILE: ${file}`
}

// Video extension: append ~7 s of new content onto a Veo-generated clip.
// [unverified] wire shape — official docs (ai.google.dev/gemini-api/docs/veo)
// show `instances[0].video: {inlineData: {mimeType, data}}` for the prior
// clip, matching the `inlineData` shape generateContent's own image parts
// use; at least one third-party report claims the REST endpoint rejects
// base64 video and wants `video: {uri: <files/... download URL>}` instead —
// but that uri is the short-lived (2-day) authed one this wrapper already
// discards after downloading, so honoring it would mean restructuring the
// wrapper to retain operation state across calls. Going with the shape the
// primary docs show; if it 400s in practice the fix is almost certainly
// swapping to `uri` and threading the original operation's video URI through
// instead of a fresh local-file read. Not supported on the lite variant.
async function extendVideo(args) {
  const sourcePath = String(args.source_video_path || '').trim()
  if (!sourcePath) throw new Error('source_video_path is required')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required (what happens in the next ~7 seconds)')
  const model = VIDEO_MODELS.includes(args.model) ? args.model : VIDEO_MODEL
  if (model === 'veo-3.1-lite-generate-preview') {
    throw new Error('Video extension is not supported on veo-3.1-lite-generate-preview — use the default or fast model.')
  }
  const priorDuration = Number(args.previous_duration_seconds) || 0
  if (priorDuration > 0 && priorDuration + 7 > 148) {
    throw new Error(`Extending would exceed Veo's 148 s total-length cap (already at ~${priorDuration}s).`)
  }
  const data = readFileSync(sourcePath).toString('base64')
  const body = {
    instances: [{ prompt, video: { inlineData: { mimeType: 'video/mp4', data } } }],
    // Extension requires the mandatory 8 s duration, same as lastFrame interpolation.
    parameters: { durationSeconds: 8 }
  }
  const op = await api(`models/${model}:predictLongRunning`, body)
  if (!op.name) throw new Error('No operation returned for video extension')

  const deadline = Date.now() + VIDEO_TIMEOUT_MS
  let status = op
  while (!status.done) {
    if (Date.now() > deadline) throw new Error('Video extension timed out')
    await new Promise((r) => setTimeout(r, VIDEO_POLL_MS))
    status = await api(status.name.startsWith('operations/') || status.name.includes('/') ? status.name : `operations/${status.name}`)
  }
  if (status.error) throw new Error(`Video extension failed: ${status.error.message || 'unknown error'}`)

  const r = status.response || {}
  const gv = r.generateVideoResponse || r
  const sample = (gv.generatedSamples && gv.generatedSamples[0]) || (gv.generatedVideos && gv.generatedVideos[0])
  const uri = sample && sample.video && (sample.video.uri || sample.video.videoUri)
  if (!uri) throw new Error('Video extension finished but no video URI in response')

  const dl = await fetch(uri, { headers: { 'x-goog-api-key': apiKey() } })
  if (!dl.ok) throw new Error(`Video download failed: HTTP ${dl.status}`)
  const file = join(outDir(), `${randomUUID()}.mp4`)
  writeFileSync(file, Buffer.from(await dl.arrayBuffer()))
  return `RESULT_FILE: ${file}`
}

const TOOLS = [
  {
    name: 'gemini_generate_image',
    description:
      'Generate an image from a text prompt (Gemini image model, aka Nano Banana). Optionally pass reference_image_paths (absolute local paths) to mix reference images into the result. Returns a RESULT_FILE: line with the absolute path of the saved image.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw' },
        model: {
          type: 'string',
          enum: IMAGE_MODELS,
          description:
            'Image model (optional). gemini-3.1-flash-image = default all-rounder; -lite- = fastest/cheapest, 1K only, object refs only; gemini-3-pro-image = premium composition/reasoning.'
        },
        aspect_ratio: { type: 'string', enum: IMAGE_ASPECTS, description: 'Output aspect ratio (optional; a real API field, not prompt text)' },
        image_size: { type: 'string', enum: IMAGE_SIZES, description: 'Output resolution tier (optional): 0.5K draft (3.1-flash only) → 4K (not on lite). Price scales with size.' },
        thinking_level: { type: 'string', enum: ['minimal', 'high'], description: 'Composition reasoning depth (gemini-3.1-flash-image only, optional)' },
        reference_image_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of reference images to condition on — treated as object references (optional)'
        },
        object_reference_paths: { type: 'array', items: { type: 'string' }, description: 'OBJECT refs — subjects/things to include (≤10, optional)' },
        character_reference_paths: { type: 'array', items: { type: 'string' }, description: "CHARACTER refs — preserve this exact person's likeness (≤4; not on lite; optional)" },
        style_reference_paths: { type: 'array', items: { type: 'string' }, description: 'STYLE refs — match visual style, not content (≤3; 3.1-flash only; optional)' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'gemini_generate_video',
    description:
      'Generate a short video from a text prompt (Veo). Optionally pass start_frame_path and/or end_frame_path (absolute local image paths) for frame-conditioned generation — e.g. a reveal that ends on a given image, or a seamless loop when both are the same image. Takes minutes; polls until done. Returns a RESULT_FILE: line with the absolute path of the saved mp4.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What happens in the shot (time-segmented beats work well)' },
        aspectRatio: { type: 'string', description: 'e.g. 9:16 or 16:9 (optional)' },
        model: {
          type: 'string',
          enum: VIDEO_MODELS,
          description: 'Veo variant (optional). lite is ~8x cheaper (720p) and still supports start/end-frame interpolation — prefer it for overlays/reveals.'
        },
        start_frame_path: { type: 'string', description: 'Absolute path of the first-frame image (optional)' },
        end_frame_path: { type: 'string', description: 'Absolute path of the last-frame image (optional)' },
        reference_image_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of ≤3 reference images to keep subject appearance consistent (standard/fast models only; forces 8 s; optional)'
        },
        reference_type: { type: 'string', enum: ['asset', 'style'], description: 'How the reference images apply (default asset = subject consistency; style = visual style)' },
        resolution: { type: 'string', enum: ['720p', '1080p', '4k'], description: '720p default; 1080p/4k force 8 s; 4k not on lite and bills higher (optional)' },
        duration_seconds: { type: 'number', enum: [4, 6, 8], description: 'Clip length (optional; 8 forced for interpolation/refs/hi-res)' },
        person_generation: { type: 'string', enum: ['allow_all', 'allow_adult'], description: 'People policy (optional): text-to-video allows allow_all; image-conditioned modes only allow_adult' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'gemini_extend_video',
    description:
      'Extend an existing Veo-generated video by ~7 seconds of new content (Veo 3.1, not the lite variant). Pass the absolute local path of the previously generated mp4 and a prompt describing what happens next. Up to 20 extensions per clip, 148s total. Takes minutes; polls until done. Returns a RESULT_FILE: line with the absolute path of the saved, extended mp4.',
    inputSchema: {
      type: 'object',
      properties: {
        source_video_path: { type: 'string', description: 'Absolute local path of the video to extend (a prior gemini_generate_video/gemini_extend_video result)' },
        prompt: { type: 'string', description: 'What happens in the next ~7 seconds' },
        model: {
          type: 'string',
          enum: VIDEO_MODELS.filter((m) => m !== 'veo-3.1-lite-generate-preview'),
          description: 'Veo variant (optional, defaults to the standard model). Extension is not supported on the lite variant.'
        },
        previous_duration_seconds: {
          type: 'number',
          description: "The source video's current total length in seconds, if known — used to reject an extension that would exceed Veo's 148s cap (optional)."
        }
      },
      required: ['source_video_path', 'prompt']
    }
  }
]

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lyme-gemini-media', version: '0.1.0' }
    }
  }
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') {
    const name = params && params.name
    const args = (params && params.arguments) || {}
    try {
      const text =
        name === 'gemini_generate_image'
          ? await generateImage(args)
          : name === 'gemini_generate_video'
            ? await generateVideo(args)
            : name === 'gemini_extend_video'
              ? await extendVideo(args)
              : null
      if (text === null) throw new Error(`Unknown tool: ${name}`)
      return { content: [{ type: 'text', text }], isError: false }
    } catch (err) {
      return { content: [{ type: 'text', text: String((err && err.message) || err) }], isError: true }
    }
  }
  if (id === undefined) return undefined // notification — no reply
  throw new Error(`Unknown method: ${method}`)
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    Promise.resolve(handle(msg))
      .then((result) => {
        if (msg.id !== undefined && result !== undefined) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
        }
      })
      .catch((err) => {
        if (msg.id !== undefined) {
          process.stdout.write(
            JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String((err && err.message) || err) } }) + '\n'
          )
        }
      })
  }
})
process.stdin.on('end', () => process.exit(0))
