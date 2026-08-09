import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { net } from 'electron'
import { readSecretValue } from './credential-vault'
import type { TrainedStyle, TrainStyleResult } from '@shared/types'

/**
 * Krea's own LoRA training (`POST /styles/train`) — the second identity route
 * queued in docs/ui/node-enrichment-strategy.md row 4, alongside fal's
 * krea-2/flux-krea trainers (fal-training.ts). A fal-trained style carries
 * `loraUrl` (weights file, applied via a model's `loras` param); a
 * Krea-trained style carries a `style_id`, applied only on Krea 2 endpoints
 * via `styles: [{id, strength}]` — the one route that reaches Krea 2 Large
 * ($0.06, the "highest quality K2" tier per docs/connectors/reference/
 * krea.md), i.e. a genuine production-tier LoRA path fal's weights-URL route
 * has no equivalent for.
 *
 * This client shipped once before (4f93dc3) and was removed when fal's
 * published per-step pricing won the *default* training route (4e96389) —
 * "Krea-native client lives in git history if that route ever comes back."
 * It's back, deliberately narrower: an alternative a user opts into for the
 * production-quality styles route, not fal's replacement.
 */

const API_BASE = 'https://api.krea.ai'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 20 * 60_000

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
 *  the train call's urls[] can reference them. The response's asset-URL field
 *  name isn't documented (docs/connectors/reference/krea.md flags this), so
 *  every plausible candidate is tried before falling back to a base64 data
 *  URI, which the train endpoint also documents accepting. */
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
      const json = (await res.json()) as { url?: string; asset_url?: string; file_url?: string }
      const url = json.url ?? json.asset_url ?? json.file_url
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

export async function trainKreaStyle(input: {
  name: string
  imagePaths: string[]
  steps?: number
  triggerWord?: string
  kind?: 'style' | 'subject'
}): Promise<TrainStyleResult> {
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
      model: 'k2',
      type: input.kind === 'subject' ? 'Object' : 'Style',
      max_train_steps: Math.min(2000, Math.max(1, input.steps ?? 1000))
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
    id: polled.styleId ?? jobId,
    name: input.name.trim(),
    connectorId: 'krea',
    trainer: 'krea-k2',
    trainedAt: new Date().toISOString(),
    referenceImageCount: input.imagePaths.length
  }
  return { ok: true, style }
}
