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
const { writeFileSync, mkdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
const VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'veo-3.0-generate-001'
const VIDEO_POLL_MS = 10_000
const VIDEO_TIMEOUT_MS = 6 * 60_000

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

async function generateImage(args) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const resp = await api(`models/${IMAGE_MODEL}:generateContent`, {
    contents: [{ parts: [{ text: prompt }] }]
  })
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
  const body = { instances: [{ prompt }] }
  if (args.aspectRatio) body.parameters = { aspectRatio: String(args.aspectRatio) }
  const op = await api(`models/${VIDEO_MODEL}:predictLongRunning`, body)
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

const TOOLS = [
  {
    name: 'gemini_generate_image',
    description:
      'Generate an image from a text prompt (Gemini image model, aka Nano Banana). Returns a RESULT_FILE: line with the absolute path of the saved image.',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'What to draw' } },
      required: ['prompt']
    }
  },
  {
    name: 'gemini_generate_video',
    description:
      'Generate a short video from a text prompt (Veo). Takes minutes; polls until done. Returns a RESULT_FILE: line with the absolute path of the saved mp4.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What happens in the shot' },
        aspectRatio: { type: 'string', description: 'e.g. 9:16 or 16:9 (optional)' }
      },
      required: ['prompt']
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
