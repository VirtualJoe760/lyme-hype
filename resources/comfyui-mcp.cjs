#!/usr/bin/env node
/**
 * ComfyUI local-engine MCP server (stdio, newline-delimited JSON-RPC).
 *
 * The $0 image tier: drives a local ComfyUI install over its HTTP API
 * (docs/connectors/reference/comfyui.md). Same dependency-free shape as
 * gemini-mcp.cjs. Workflow templates live in resources/workflows/*.json
 * (API-format graphs + a _meta block naming the patch points).
 *
 * Env:
 *   COMFYUI_URL     server to attach to (default http://127.0.0.1:8188)
 *   COMFYUI_PATH    ComfyUI repo root — enables the missing-weights check
 *   (the app, not this wrapper, starts the server: src/main/comfyui-host.ts)
 *
 * Endpoints (per the install's own openapi.yaml, v0.34): POST /api/prompt,
 * GET /api/history_v2/{id} (deprecated in favor of /api/jobs/{id} but retained —
 * revisit when the jobs API is the only path), GET /api/view, GET /api/system_stats.
 */
'use strict'

const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const BASE_URL = (process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '')
const COMFY_PATH = process.env.COMFYUI_PATH || ''
const WORKFLOWS_DIR = join(__dirname, 'workflows')
const SPAWN_TIMEOUT_MS = 150_000
const GENERATE_TIMEOUT_MS = 10 * 60_000
const POLL_MS = 1500

// ~1MP dimension pairs, multiples of 16 (what the flux/SD3-family latents want).
const ASPECT_DIMS = {
  '1:1': [1024, 1024],
  '9:16': [768, 1344],
  '16:9': [1344, 768],
  '4:5': [896, 1120],
  '5:4': [1120, 896],
  '3:4': [896, 1184],
  '4:3': [1184, 896],
  '2:3': [832, 1248],
  '3:2': [1248, 832],
  '21:9': [1536, 656]
}

function outDir() {
  const dir = join(tmpdir(), 'lyme-hype-comfyui')
  mkdirSync(dir, { recursive: true })
  return dir
}

function loadTemplates() {
  if (!existsSync(WORKFLOWS_DIR)) return []
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const parsed = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'))
      return { file: f, meta: parsed._meta || {}, graph: parsed.graph }
    })
    .filter((t) => t.graph && t.meta.model)
}

function missingWeights(template) {
  if (!COMFY_PATH) return [] // attach-only mode — let the server report missing files
  return (template.meta.requiredWeights || []).filter(
    (rel) => !existsSync(join(COMFY_PATH, 'models', rel))
  )
}

async function health() {
  try {
    const res = await fetch(`${BASE_URL}/api/system_stats`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

// The app owns the server's lifecycle (src/main/comfyui-host.ts): it starts
// ComfyUI on demand before a local generation, stops it after ten idle minutes,
// and kills it if it eats the machine. This wrapper never spawns one — two
// spawners is how an orphan outlived the app (2026-09-01) — it only waits for
// the one the app is bringing up. --highvram / --cache-none live over there.
async function ensureServer() {
  if (await health()) return
  const deadline = Date.now() + SPAWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    if (await health()) return
  }
  throw new Error(
    `ComfyUI is not reachable at ${BASE_URL}. Lyme Hype starts it on demand — check the status strip at the foot of the studio; a ComfyUI you start yourself is attached as-is.`
  )
}

async function api(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* binary/other */
  }
  if (!res.ok) {
    throw new Error(`ComfyUI ${path} HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  return json
}

/** Push a local image into ComfyUI's input store so LoadImage can see it. */
async function uploadImage(path) {
  const bytes = readFileSync(path)
  const name = `lyme-ref-${randomUUID()}.png`
  const form = new FormData()
  form.append('image', new Blob([bytes]), name)
  form.append('overwrite', 'true')
  const res = await fetch(`${BASE_URL}/api/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Reference upload failed: HTTP ${res.status}`)
  const json = await res.json()
  return json.name || name
}

function patchGraph(template, args, uploadedRef) {
  const graph = JSON.parse(JSON.stringify(template.graph))
  const patch = template.meta.patch || {}
  const set = (key, value) => {
    const p = patch[key]
    if (p && graph[p.node] && value !== undefined) graph[p.node].inputs[p.input] = value
  }
  const dims = ASPECT_DIMS[args.aspect_ratio] || null
  const width = Number(args.width) || (dims ? dims[0] : 1024)
  const height = Number(args.height) || (dims ? dims[1] : 1024)
  set('prompt', String(args.prompt))
  set('width', width)
  set('height', height)
  set('steps', Number(args.steps) || (template.meta.defaults || {}).steps)
  // A fixed seed means every identical prompt returns the identical image — default random.
  set('seed', Number.isFinite(Number(args.seed)) && args.seed !== undefined ? Number(args.seed) : Math.floor(Math.random() * 2 ** 48))

  // img2img: swap the empty latent for the reference image, VAE-encoded — the
  // prompt still directs the shot; `strength` (→ KSampler denoise) is the
  // inspiration dial: 1 ignores the reference, ~0.3 is a close variation.
  const i2i = template.meta.i2i
  if (uploadedRef && i2i && graph[i2i.samplerNode]) {
    graph['90'] = { class_type: 'LoadImage', inputs: { image: uploadedRef } }
    graph['89'] = {
      class_type: 'ImageScale',
      inputs: { image: ['90', 0], width, height, upscale_method: 'lanczos', crop: 'center' }
    }
    graph['91'] = { class_type: 'VAEEncode', inputs: { pixels: ['89', 0], vae: i2i.vaeFrom } }
    graph[i2i.samplerNode].inputs.latent_image = ['91', 0]
    const strength = Number(args.strength)
    graph[i2i.samplerNode].inputs.denoise = strength >= 0.1 && strength <= 1 ? strength : 0.6
    delete graph[i2i.latentNode]
  }
  return graph
}

function statusError(entry) {
  const messages = (entry.status && entry.status.messages) || []
  for (const m of messages) {
    if (Array.isArray(m) && m[0] === 'execution_error') {
      const d = m[1] || {}
      return `${d.node_type || d.node_id || 'node'}: ${d.exception_message || 'execution error'}`
    }
  }
  return entry.status && entry.status.status_str === 'error' ? 'execution error' : null
}

// One GPU — generations are strictly serialized, even if an MCP client fires
// tool calls concurrently.
let queueTail = Promise.resolve()
function enqueue(task) {
  const run = queueTail.then(task, task)
  queueTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

let lastModel = null

async function generateImage(args) {
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const templates = loadTemplates()
  if (templates.length === 0) throw new Error('No workflow templates found in resources/workflows.')
  const wanted = String(args.model || '').trim()
  const template = wanted
    ? templates.find((t) => t.meta.model === wanted)
    : templates.find((t) => missingWeights(t).length === 0) || templates[0]
  if (!template) {
    throw new Error(`Unknown model "${wanted}" — available: ${templates.map((t) => t.meta.model).join(', ')}`)
  }
  const missing = missingWeights(template)
  if (missing.length > 0) {
    throw new Error(
      `Model "${template.meta.model}" is missing weights under ${join(COMFY_PATH, 'models')}: ${missing.join(', ')} — download them first (see the connector card).`
    )
  }

  // One resident model, ever. Switching checkpoints without this stacks the old
  // one in memory next to the new one; POST /free is ComfyUI's own "drop
  // everything" and costs only the next model's load time (verified endpoint,
  // server.py post_free). Same model as last time = keep it warm, no call.
  if (lastModel && lastModel !== template.meta.model) {
    try {
      await api('/api/free', { unload_models: true, free_memory: true })
      process.stderr.write(`[comfyui-mcp] unloaded ${lastModel} before loading ${template.meta.model}
`)
    } catch {
      /* a failed free is not a failed generation */
    }
  }
  lastModel = template.meta.model

  const referencePath = String(args.reference_image_path || '').trim()
  if (referencePath && !existsSync(referencePath)) {
    throw new Error(`reference_image_path does not exist: ${referencePath}`)
  }
  if (referencePath && !template.meta.i2i) {
    throw new Error(`Model "${template.meta.model}" has no img2img route in its workflow template.`)
  }

  return enqueue(async () => {
    await ensureServer()
    const uploadedRef = referencePath ? await uploadImage(referencePath) : null
    const graph = patchGraph(template, { ...args, prompt }, uploadedRef)
    const submitted = await api('/api/prompt', { prompt: graph, client_id: `lyme-${process.pid}` })
    if (submitted && submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
      throw new Error(`Workflow rejected: ${JSON.stringify(submitted.node_errors).slice(0, 400)}`)
    }
    const promptId = submitted && submitted.prompt_id
    if (!promptId) throw new Error('ComfyUI accepted the workflow but returned no prompt_id')

    const deadline = Date.now() + GENERATE_TIMEOUT_MS
    for (;;) {
      if (Date.now() > deadline) throw new Error('Generation timed out (10 min) — the model may still be loading; retry once.')
      await new Promise((r) => setTimeout(r, POLL_MS))
      let hist
      try {
        // Legacy /api/history, deliberately: on v0.34 the "preferred"
        // /api/history_v2 returns an EMPTY body for completed jobs (verified
        // live 2026-08-30) while the legacy endpoint carries the classic
        // {id: {outputs, status}} shape. Revisit when the /api/jobs API is
        // the settled successor.
        hist = await api(`/api/history/${promptId}`)
      } catch (err) {
        // 404 until the prompt finishes executing — "still running", not an error.
        if (/HTTP 404/.test(String(err && err.message))) continue
        throw err
      }
      const entry = hist && hist[promptId]
      if (!entry) continue
      const err = statusError(entry)
      if (err) throw new Error(`Generation failed: ${err}`)
      const outputs = entry.outputs || {}
      for (const nodeId of Object.keys(outputs)) {
        const images = outputs[nodeId] && outputs[nodeId].images
        if (Array.isArray(images) && images.length > 0) {
          const img = images[0]
          const params = new URLSearchParams({ filename: img.filename })
          if (img.subfolder) params.set('subfolder', img.subfolder)
          params.set('type', img.type || 'output')
          const res = await fetch(`${BASE_URL}/api/view?${params}`)
          if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
          const ext = img.filename.includes('.') ? img.filename.slice(img.filename.lastIndexOf('.')) : '.png'
          const file = join(outDir(), `${randomUUID()}${ext}`)
          writeFileSync(file, Buffer.from(await res.arrayBuffer()))
          return `RESULT_FILE: ${file}`
        }
      }
      if (entry.status && entry.status.completed) {
        throw new Error('Workflow completed but produced no image output')
      }
    }
  })
}

async function listModels() {
  const templates = loadTemplates()
  const up = await health()
  const rows = templates.map((t) => {
    const missing = missingWeights(t)
    return {
      model: t.meta.model,
      label: t.meta.label || t.meta.model,
      ready: missing.length === 0,
      missingWeights: missing
    }
  })
  return JSON.stringify({ server: up ? `up at ${BASE_URL}` : 'down (will spawn on demand)', models: rows }, null, 2)
}

const ASPECTS = Object.keys(ASPECT_DIMS)
// Enumerated at startup so MCP clients (and the routing agent) can SEE the
// valid model names — a free-string model param let the agent wrongly declare
// models unavailable instead of calling the tool.
const KNOWN_MODELS = loadTemplates().map((t) => t.meta.model)
const TOOLS = [
  {
    name: 'comfy_generate_image',
    description:
      'Generate an image LOCALLY via ComfyUI — free, no per-image billing, runs on this machine\'s GPU. Takes seconds once the model is warm (first call per model loads weights, tens of seconds). Pass reference_image_path to run img2img: the reference inspires composition/palette while the prompt still directs the shot. Returns a RESULT_FILE: line with the absolute path of the saved image.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw — always required, img2img included' },
        model: {
          type: 'string',
          ...(KNOWN_MODELS.length > 0 ? { enum: KNOWN_MODELS } : {}),
          description: 'Workflow/model name (see comfy_list_models). Omit to use the first ready model.'
        },
        reference_image_path: { type: 'string', description: 'Absolute path of a reference image → img2img conditioning (optional)' },
        strength: { type: 'number', description: 'img2img inspiration dial 0.1–1: 1 ≈ ignore reference, 0.6 default, 0.3 ≈ close variation (optional)' },
        aspect_ratio: { type: 'string', enum: ASPECTS, description: 'Output aspect (~1MP dims) — optional' },
        width: { type: 'number', description: 'Explicit width (overrides aspect_ratio) — optional' },
        height: { type: 'number', description: 'Explicit height — optional' },
        steps: { type: 'number', description: 'Sampling steps (each workflow carries a sane default) — optional' },
        seed: { type: 'number', description: 'Fixed seed for reproducibility — optional, random otherwise' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'comfy_list_models',
    description: 'List the local workflow models, whether their weights are present, and server status. Free.',
    inputSchema: { type: 'object', properties: {} }
  }
]

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    return {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lyme-comfyui', version: '0.1.0' }
    }
  }
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') {
    const name = params && params.name
    const args = (params && params.arguments) || {}
    try {
      const text =
        name === 'comfy_generate_image'
          ? await generateImage(args)
          : name === 'comfy_list_models'
            ? await listModels()
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
