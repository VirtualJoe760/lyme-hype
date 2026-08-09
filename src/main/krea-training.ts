import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, net } from 'electron'
import { readSecretValue } from './credential-vault'

/**
 * Krea LoRA training client — a deliberate one-off REST exception to the
 * everything-through-MCP model: Krea's hosted MCP documents exactly seven
 * tools (list_models, get_model_schema, generate, execute_node_app, get_job,
 * cancel_job, get_upload_url) and training is not among them.
 *
 * Verified against Krea's API reference (2026-08):
 * - POST https://api.krea.ai/styles/train — JSON body, NOT multipart:
 *   { name, urls[], model?, type?, trigger_word?, max_train_steps? (1-2000) }
 *   where urls entries are external URLs, base64 data URIs, or uploaded asset
 *   URLs. Success returns { job_id, status, ... }.
 * - Progress is polled at GET https://api.krea.ai/jobs/{id} (there is no
 *   /styles/train/{id}); status enum includes backlogged/queued/scheduled/
 *   processing/sampling/intermediate-complete/completed/failed/cancelled.
 * - Pricing is NOT the once-claimed $0.003/step (that's fal.ai's hosted
 *   krea-2-trainer) — Krea bills the workspace's API balance at an
 *   unpublished per-job rate; a 402 surfaces when the balance is short.
 * - A trained style is used at generation time via styles: [{ id, strength }].
 *
 * Live-token verification of the exact wire behavior stays joint-session
 * work; every non-2xx body surfaces verbatim.
 */

const API_BASE = 'https://api.krea.ai'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 20 * 60_000

export interface TrainedStyle {
  id: string
  name: string
  connectorId: 'krea'
  trainedAt: string
  referenceImageCount: number
}

export interface TrainResult {
  ok: boolean
  style?: TrainedStyle
  error?: string
}

function storeFile(): string {
  return join(app.getPath('userData'), 'trained-styles.json')
}

export function listTrainedStyles(): TrainedStyle[] {
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), 'utf-8'))
    return Array.isArray(parsed) ? (parsed as TrainedStyle[]) : []
  } catch {
    return []
  }
}

function writeTrainedStyles(styles: TrainedStyle[]): void {
  const file = storeFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(styles, null, 2), 'utf-8')
  renameSync(tmp, file)
}

export function deleteTrainedStyle(id: string): void {
  writeTrainedStyles(listTrainedStyles().filter((s) => s.id !== id))
}

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

function authHeader(): string | null {
  const token = readSecretValue('krea')
  if (!token) return null
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

/** Local training images become uploaded assets (POST /assets, multipart) so
 *  the train call's urls[] can reference them; a failed upload falls back to a
 *  base64 data URI, which the train endpoint also documents accepting. */
async function toTrainUrl(path: string, auth: string): Promise<string> {
  const mime = IMG_MIME[extname(path).toLowerCase()] ?? 'image/png'
  const bytes = readFileSync(path)
  try {
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), basename(path))
    const res = await net.fetch(`${API_BASE}/assets`, {
      method: 'POST',
      headers: { Authorization: auth },
      body: form
    })
    if (res.ok) {
      const json = (await res.json()) as { url?: string; asset_url?: string; id?: string }
      const url = json.url ?? json.asset_url
      if (url) return url
    }
  } catch {
    /* fall through to data URI */
  }
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function pollJob(jobId: string, auth: string): Promise<{ done: boolean; styleId?: string; error?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastStatus = 'submitted'
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await net.fetch(`${API_BASE}/jobs/${jobId}`, { headers: { Authorization: auth } })
    const body = await res.text()
    if (!res.ok) return { done: false, error: `Job check HTTP ${res.status}: ${body.slice(0, 300)}` }
    try {
      const json = JSON.parse(body) as {
        status?: string
        error?: string
        result?: { id?: string; style_id?: string } | null
      }
      lastStatus = json.status ?? lastStatus
      if (/^completed$/i.test(lastStatus)) {
        return { done: true, styleId: json.result?.style_id ?? json.result?.id }
      }
      if (/failed|cancel/i.test(lastStatus)) {
        return { done: false, error: json.error ?? `Training ${lastStatus}.` }
      }
    } catch {
      /* non-JSON poll reply — keep polling */
    }
  }
  return {
    done: false,
    error: `Training still "${lastStatus}" after ${POLL_TIMEOUT_MS / 60000} minutes — check Krea's dashboard.`
  }
}

export async function trainStyle(input: {
  name: string
  imagePaths: string[]
  steps?: number
  triggerWord?: string
}): Promise<TrainResult> {
  const auth = authHeader()
  if (!auth) {
    return { ok: false, error: 'Krea is not connected — install it and set a token in Settings › Connectors.' }
  }
  if (!input.name.trim()) return { ok: false, error: 'Name the style first.' }
  if (input.imagePaths.length === 0) return { ok: false, error: 'Pick at least one training image.' }

  let jobId: string
  try {
    const urls: string[] = []
    for (const p of input.imagePaths) urls.push(await toTrainUrl(p, auth))
    const body: Record<string, unknown> = {
      name: input.name.trim(),
      urls,
      max_train_steps: Math.min(2000, Math.max(1, input.steps ?? 300))
    }
    if (input.triggerWord?.trim()) body['trigger_word'] = input.triggerWord.trim()
    const res = await net.fetch(`${API_BASE}/styles/train`, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `Krea HTTP ${res.status}: ${text.slice(0, 300)}` }
    const json = JSON.parse(text) as { job_id?: string; id?: string }
    const id = json.job_id ?? json.id
    if (!id) return { ok: false, error: `No job id in Krea's reply: ${text.slice(0, 300)}` }
    jobId = String(id)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const polled = await pollJob(jobId, auth)
  if (!polled.done) return { ok: false, error: polled.error }

  const style: TrainedStyle = {
    // The style id (used at generation via styles: [{id, strength}]) comes
    // from the completed job's result when present; the job id is the
    // fallback handle.
    id: polled.styleId ?? jobId,
    name: input.name.trim(),
    connectorId: 'krea',
    trainedAt: new Date().toISOString(),
    referenceImageCount: input.imagePaths.length
  }
  writeTrainedStyles([...listTrainedStyles().filter((s) => s.id !== style.id), style])
  return { ok: true, style }
}
