import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { app, net } from 'electron'
import { readSecretValue } from './credential-vault'

/**
 * Krea LoRA training client — a deliberate one-off REST exception to the
 * everything-through-MCP model: training is confirmed NOT reachable through
 * Krea's MCP server (docs/connectors/catalog.md), so this posts to the
 * documented endpoint directly. Submit → job id → poll. $0.003/step,
 * 100-step minimum.
 *
 * The exact request/response schema hasn't been exercised against a live
 * token (that class of live-spend verification is joint-session work, same as
 * generation calls) — so every non-2xx response surfaces its body verbatim
 * instead of being reinterpreted, and the poller accepts any {status}-shaped
 * reply.
 */

const TRAIN_URL = 'https://api.krea.ai/styles/train'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 15 * 60_000

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

async function pollJob(jobId: string, auth: string): Promise<{ done: boolean; error?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastStatus = 'submitted'
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await net.fetch(`${TRAIN_URL}/${jobId}`, { headers: { Authorization: auth } })
    const body = await res.text()
    if (!res.ok) return { done: false, error: `Status check HTTP ${res.status}: ${body.slice(0, 300)}` }
    try {
      const json = JSON.parse(body) as { status?: string; error?: string }
      lastStatus = json.status ?? lastStatus
      if (/completed|succeeded|ready/i.test(lastStatus)) return { done: true }
      if (/failed|error|cancel/i.test(lastStatus)) {
        return { done: false, error: json.error ?? `Training ${lastStatus}.` }
      }
    } catch {
      /* non-JSON poll reply — keep polling */
    }
  }
  return { done: false, error: `Training still "${lastStatus}" after ${POLL_TIMEOUT_MS / 60000} minutes — check Krea's dashboard.` }
}

export async function trainStyle(input: {
  name: string
  imagePaths: string[]
  steps?: number
}): Promise<TrainResult> {
  const auth = authHeader()
  if (!auth) {
    return { ok: false, error: 'Krea is not connected — install it and set a token in Settings › Connectors.' }
  }
  if (!input.name.trim()) return { ok: false, error: 'Name the style first.' }
  if (input.imagePaths.length === 0) return { ok: false, error: 'Pick at least one training image.' }

  const form = new FormData()
  form.append('name', input.name.trim())
  form.append('steps', String(Math.max(100, input.steps ?? 300)))
  for (const p of input.imagePaths) {
    const mime = IMG_MIME[extname(p).toLowerCase()] ?? 'image/png'
    form.append('images', new Blob([readFileSync(p)], { type: mime }), basename(p))
  }

  let jobId: string
  try {
    const res = await net.fetch(TRAIN_URL, {
      method: 'POST',
      headers: { Authorization: auth },
      body: form
    })
    const body = await res.text()
    if (!res.ok) return { ok: false, error: `Krea HTTP ${res.status}: ${body.slice(0, 300)}` }
    const json = JSON.parse(body) as { id?: string; job_id?: string; style_id?: string }
    const id = json.id ?? json.job_id ?? json.style_id
    if (!id) return { ok: false, error: `No job id in Krea's reply: ${body.slice(0, 300)}` }
    jobId = String(id)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const polled = await pollJob(jobId, auth)
  if (!polled.done) return { ok: false, error: polled.error }

  const style: TrainedStyle = {
    id: jobId,
    name: input.name.trim(),
    connectorId: 'krea',
    trainedAt: new Date().toISOString(),
    referenceImageCount: input.imagePaths.length
  }
  writeTrainedStyles([...listTrainedStyles().filter((s) => s.id !== style.id), style])
  return { ok: true, style }
}
