import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { saveImageAsset, type SavedAsset } from '../asset-store'
import { comfyConfig } from '../comfyui-host'
import type { ComfyGraph } from './character-graphs'

/**
 * Direct ComfyUI HTTP client for the character pipeline — no agent turn, no
 * wrapper, no MCP. Casting is deterministic (a graph is a graph), so the
 * Agent SDK would only add latency and tokens; the same reasoning as
 * elevenlabs-tools.ts. Talks to whichever server comfyui-host.ts manages.
 *
 * Outputs come back as bytes over /api/view and go straight into the asset
 * store, so a candidate is a normal lyme-asset:// URL from the first moment.
 */

const POLL_MS = 1500
const DEFAULT_TIMEOUT_MS = 10 * 60_000

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
}

// One GPU: every run in this process goes through one chain.
let queueTail: Promise<unknown> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task)
  queueTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** What is loaded on the GPU right now, by our own bookkeeping — a checkpoint switch frees first. */
let resident: string | null = null

export function comfyUrl(): string {
  return comfyConfig()?.url ?? 'http://127.0.0.1:8188'
}

async function api(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${comfyUrl()}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`ComfyUI ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Drop every resident model. Loading a 6.6 GB SDXL checkpoint next to a warm
 *  16 GB flux is the "Allocation on device" OOM seen 2026-09-02 — so a
 *  switch always evicts first. Same model twice in a row stays warm. */
export async function comfyPrepare(modelKey: string): Promise<void> {
  if (resident === modelKey) return
  try {
    await api('/api/free', { unload_models: true, free_memory: true })
  } catch {
    /* a failed free is not a failed generation */
  }
  resident = modelKey
}

export function comfyForgetResident(): void {
  resident = null
}

/** Push a local image into ComfyUI's input store so LoadImage can see it. */
export async function comfyUpload(path: string): Promise<string> {
  const ext = basename(path).includes('.') ? basename(path).slice(basename(path).lastIndexOf('.')) : '.png'
  const name = `lyme-chr-${randomUUID()}${ext}`
  const form = new FormData()
  form.append('image', new Blob([readFileSync(path)]), name)
  form.append('overwrite', 'true')
  const res = await fetch(`${comfyUrl()}/api/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Reference upload failed: HTTP ${res.status}`)
  const json = (await res.json()) as { name?: string }
  return json.name ?? name
}

function executionError(entry: HistoryEntry): string | null {
  for (const m of entry.status?.messages ?? []) {
    if (Array.isArray(m) && m[0] === 'execution_error') {
      const d = (m[1] ?? {}) as Record<string, string>
      return `${d.node_type ?? d.node_id ?? 'node'}: ${d.exception_message ?? 'execution error'}`
    }
  }
  return entry.status?.status_str === 'error' ? 'execution error' : null
}

export interface RunOptions {
  timeoutMs?: number
  onStatus?: (line: string) => void
}

/** Submit a graph, wait for it, import every output image into the asset store. */
export function comfyRun(graph: ComfyGraph, opts: RunOptions = {}): Promise<SavedAsset[]> {
  return serialize(() => runNow(graph, opts))
}

async function runNow(graph: ComfyGraph, opts: RunOptions): Promise<SavedAsset[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = opts.onStatus ?? (() => undefined)
  const submitted = (await api('/api/prompt', { prompt: graph, client_id: `lyme-character-${process.pid}` })) as {
    prompt_id?: string
    node_errors?: Record<string, unknown>
  }
  if (submitted.node_errors && Object.keys(submitted.node_errors).length > 0) {
    throw new Error(`Workflow rejected: ${JSON.stringify(submitted.node_errors).slice(0, 600)}`)
  }
  const promptId = submitted.prompt_id
  if (!promptId) throw new Error('ComfyUI accepted the workflow but returned no prompt_id')
  log(`queued ${promptId.slice(0, 8)}`)

  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Generation timed out after ${timeoutMs / 1000}s`)
    await new Promise((r) => setTimeout(r, POLL_MS))
    let hist: Record<string, HistoryEntry>
    try {
      // Legacy /api/history on purpose: /api/history_v2 returns an empty body
      // for finished jobs on v0.34 (verified live 2026-08-30).
      hist = (await api(`/api/history/${promptId}`)) as Record<string, HistoryEntry>
    } catch (err) {
      if (/HTTP 404/.test(String((err as Error).message))) continue
      throw err
    }
    const entry = hist?.[promptId]
    if (!entry) continue
    const err = executionError(entry)
    if (err) throw new Error(`Generation failed: ${err}`)
    const images = Object.values(entry.outputs ?? {}).flatMap((node) =>
      (node.images ?? []).filter((img) => (img.type ?? 'output') === 'output')
    )
    if (images.length > 0) {
      const saved: SavedAsset[] = []
      for (const img of images) {
        const params = new URLSearchParams({ filename: img.filename, type: img.type ?? 'output' })
        if (img.subfolder) params.set('subfolder', img.subfolder)
        const res = await fetch(`${comfyUrl()}/api/view?${params}`)
        if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
        const bytes = Buffer.from(await res.arrayBuffer())
        saved.push(saveImageAsset(bytes.toString('base64'), 'image/png'))
      }
      return saved
    }
    if (entry.status?.completed) throw new Error('Workflow completed but produced no image output')
  }
}
