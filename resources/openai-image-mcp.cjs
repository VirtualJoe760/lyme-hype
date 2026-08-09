#!/usr/bin/env node
/**
 * Thin OpenAI image MCP server (stdio, newline-delimited JSON-RPC).
 *
 * Why this exists: OpenAI ships no first-party image MCP either, and the repo
 * rule (docs/connectors/catalog.md) is a small owned wrapper over an unvetted
 * community package — same precedent as resources/gemini-mcp.cjs. Plain Node,
 * no dependencies — global fetch/FormData against the Images API.
 *
 * Auth: OPENAI_API_KEY env var (injected by Lyme Hype's connector runtime from
 * the vault). The key never appears in tool results.
 *
 * Results: image bytes are written to a temp file and returned as a
 * `RESULT_FILE: <absolute path>` text line — gpt-image-1 returns base64, not
 * public URLs, so a file hand-off is the clean boundary (same as Gemini).
 */
'use strict'

const { randomUUID } = require('node:crypto')
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, extname, basename } = require('node:path')

const API_BASE = 'https://api.openai.com/v1'
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
const SIZES = ['1024x1024', '1024x1536', '1536x1024', 'auto']

function apiKey() {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  return key
}

function outDir() {
  const dir = join(tmpdir(), 'lyme-hype-openai')
  mkdirSync(dir, { recursive: true })
  return dir
}

async function readApiError(res) {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    return (json.error && json.error.message) || text.slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

function saveB64Result(json) {
  const item = json.data && json.data[0]
  if (!item || !item.b64_json) throw new Error('No image data in response')
  const file = join(outDir(), `${randomUUID()}.png`)
  writeFileSync(file, Buffer.from(item.b64_json, 'base64'))
  return `RESULT_FILE: ${file}`
}

const MIME_FOR_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

async function generateImage(args) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const size = SIZES.includes(args.size) ? args.size : 'auto'
  const refs = Array.isArray(args.reference_image_paths) ? args.reference_image_paths.filter(Boolean) : []

  if (refs.length > 0) {
    // Reference-conditioned generation goes through the edits endpoint, which
    // accepts input images alongside the prompt (multipart, not JSON).
    const form = new FormData()
    form.append('model', IMAGE_MODEL)
    form.append('prompt', prompt)
    if (size !== 'auto') form.append('size', size)
    for (const p of refs) {
      const mime = MIME_FOR_EXT[extname(p).toLowerCase()] || 'image/png'
      form.append('image[]', new Blob([readFileSync(p)], { type: mime }), basename(p))
    }
    const res = await fetch(`${API_BASE}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey()}` },
      body: form
    })
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await readApiError(res)}`)
    return saveB64Result(await res.json())
  }

  const res = await fetch(`${API_BASE}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size })
  })
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await readApiError(res)}`)
  return saveB64Result(await res.json())
}

const TOOLS = [
  {
    name: 'openai_generate_image',
    description:
      'Generate an image from a text prompt (OpenAI gpt-image-1). Optionally pass reference_image_paths (absolute local paths) to condition the result on reference images. Returns a RESULT_FILE: line with the absolute path of the saved image.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw' },
        size: { type: 'string', enum: SIZES, description: 'Output size; 1024x1536 is portrait, 1536x1024 landscape (optional, default auto)' },
        reference_image_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute paths of reference images to mix into the result (optional)'
        }
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
      serverInfo: { name: 'lyme-openai-image', version: '0.1.0' }
    }
  }
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') {
    const name = params && params.name
    const args = (params && params.arguments) || {}
    try {
      if (name !== 'openai_generate_image') throw new Error(`Unknown tool: ${name}`)
      const text = await generateImage(args)
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
