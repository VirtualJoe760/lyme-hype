import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app, net } from 'electron'
import { readSecretValue } from './credential-vault'
import { trainKreaStyle } from './krea-training'

/**
 * LoRA training via fal's hosted Krea-family trainers — chosen over Krea's own
 * REST trainer for published per-step pricing (user call, 2026-08-09; the
 * Krea-native client lives in git history if that route ever comes back).
 *
 * Two trainers, both verified against fal's API docs:
 * - fal-ai/krea-2-trainer   — Krea 2 look, $0.003/step (100-step min);
 *   input {images_data_url(zip), trigger_phrase, auto_captioning, steps,
 *   resolution}; output lora_file (safetensors) + config_file. Pairs with
 *   Krea 2 LoRA inference on fal.
 * - fal-ai/flux-krea-trainer — FLUX.1 Krea [dev] base, ~$2/run scaling with
 *   steps; input {images_data_url(zip), trigger_word, steps, is_style};
 *   output diffusers_lora_file. Pairs with fal-ai/flux-krea-lora.
 *
 * Mechanics: training images are packed into a store-only ZIP locally (no
 * archiver dependency), uploaded through fal's storage API (Key auth), and
 * the zip URL feeds the queue submit → status poll → result fetch cycle.
 * Live-spend verification stays joint-session; errors surface verbatim.
 */

const QUEUE_BASE = 'https://queue.fal.run'
const STORAGE_INITIATE = 'https://rest.alpha.fal.ai/storage/upload/initiate'
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 30 * 60_000

export type TrainerKind = 'style' | 'subject'

export interface TrainerDef {
  id: string
  model: string
  label: string
  priceNote: string
  defaultSteps: number
}

export const FAL_TRAINERS: TrainerDef[] = [
  {
    id: 'krea-2',
    model: 'fal-ai/krea-2-trainer',
    label: 'Krea 2 (best Krea look)',
    priceNote: '$0.003/step, 100-step min',
    defaultSteps: 300
  },
  {
    id: 'flux-krea',
    model: 'fal-ai/flux-krea-trainer',
    label: 'FLUX.1 Krea [dev]',
    priceNote: '~$2/run, scales with steps',
    defaultSteps: 1000
  }
]

export type { TrainedStyle } from '@shared/types'
import type { TrainedStyle } from '@shared/types'

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

/** Pairs an ElevenLabs voice with an existing trained identity — the
 *  "Reference person" concept (docs/ui/node-enrichment-strategy.md). Pass an
 *  empty/whitespace name to detach the voice. */
export function setTrainedStyleVoice(id: string, voiceName: string): TrainedStyle | null {
  const styles = listTrainedStyles()
  const style = styles.find((s) => s.id === id)
  if (!style) return null
  style.voiceName = voiceName.trim() || undefined
  writeTrainedStyles(styles)
  return style
}

/** Tags a Reference person with a free-text tone/persona descriptor, matched
 *  against a Storyboard shot's "feeling" annotation to auto-suggest a person
 *  on the Deepfake screen (docs/ui/node-enrichment-strategy.md, row 8). Pass
 *  an empty/whitespace tone to clear it. */
export function setTrainedStylePersonaTone(id: string, personaTone: string): TrainedStyle | null {
  const styles = listTrainedStyles()
  const style = styles.find((s) => s.id === id)
  if (!style) return null
  style.personaTone = personaTone.trim() || undefined
  writeTrainedStyles(styles)
  return style
}

/* ---------- store-only ZIP writer (no dependency) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Packs files into an uncompressed (STORED) ZIP — trainers just want the
 *  images bundled, and store-only keeps this dependency-free and testable. */
export function buildStoredZip(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf-8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x21, 12) // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, entry.data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(entry.data.length, 20)
    cd.writeUInt32LE(entry.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    offset += 30 + name.length + entry.data.length
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, eocd])
}

/* ---------- fal REST plumbing ---------- */

/** fal's REST surface uses the `Key` scheme (the MCP endpoint alone is Bearer). */
function falAuth(): string | null {
  const token = readSecretValue('fal')
  if (!token) return null
  return token.startsWith('Key ') ? token : `Key ${token.replace(/^Bearer\s+/i, '')}`
}

async function uploadZip(zip: Buffer, auth: string): Promise<string> {
  try {
    const initiate = await net.fetch(STORAGE_INITIATE, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ file_name: 'training-images.zip', content_type: 'application/zip' })
    })
    if (initiate.ok) {
      const json = (await initiate.json()) as { upload_url?: string; file_url?: string }
      if (json.upload_url && json.file_url) {
        const put = await net.fetch(json.upload_url, {
          method: 'PUT',
          headers: { 'content-type': 'application/zip' },
          body: new Uint8Array(zip)
        })
        if (put.ok) return json.file_url
      }
    }
  } catch {
    /* fall through to data URI */
  }
  // Fallback: fal *_data_url fields also accept base64 data URIs.
  return `data:application/zip;base64,${zip.toString('base64')}`
}

function trainerInput(
  trainer: TrainerDef,
  zipUrl: string,
  steps: number,
  triggerWord: string | undefined,
  kind: TrainerKind
): Record<string, unknown> {
  if (trainer.id === 'krea-2') {
    return {
      images_data_url: zipUrl,
      steps,
      trigger_phrase: triggerWord ?? '',
      auto_captioning: kind === 'style' ? 'Style' : 'Object/Character',
      resolution: 1024
    }
  }
  return {
    images_data_url: zipUrl,
    steps,
    ...(triggerWord ? { trigger_word: triggerWord } : {}),
    is_style: kind === 'style'
  }
}

/** Digs the LoRA weights URL out of the result: named fields first
 *  (lora_file / diffusers_lora_file), then any .safetensors URL. */
export function extractLoraUrl(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const record = result as Record<string, unknown>
  for (const key of ['lora_file', 'diffusers_lora_file']) {
    const file = record[key]
    if (typeof file === 'object' && file !== null && typeof (file as { url?: unknown }).url === 'string') {
      return (file as { url: string }).url
    }
  }
  const match = JSON.stringify(result).match(/https?:\/\/[^"\s]+\.safetensors[^"\s]*/)
  return match ? match[0] : undefined
}

async function pollQueue(
  model: string,
  requestId: string,
  auth: string
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastStatus = 'IN_QUEUE'
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await net.fetch(`${QUEUE_BASE}/${model}/requests/${requestId}/status`, {
      headers: { Authorization: auth }
    })
    const body = await res.text()
    if (!res.ok) return { ok: false, error: `Status HTTP ${res.status}: ${body.slice(0, 300)}` }
    try {
      const json = JSON.parse(body) as { status?: string; error?: string }
      lastStatus = json.status ?? lastStatus
      if (lastStatus === 'COMPLETED') {
        const final = await net.fetch(`${QUEUE_BASE}/${model}/requests/${requestId}`, {
          headers: { Authorization: auth }
        })
        const finalBody = await final.text()
        if (!final.ok) return { ok: false, error: `Result HTTP ${final.status}: ${finalBody.slice(0, 300)}` }
        return { ok: true, result: JSON.parse(finalBody) }
      }
      if (/FAILED|ERROR|CANCEL/i.test(lastStatus)) {
        return { ok: false, error: json.error ?? `Training ${lastStatus}.` }
      }
    } catch {
      /* keep polling through non-JSON replies */
    }
  }
  return { ok: false, error: `Training still "${lastStatus}" after ${POLL_TIMEOUT_MS / 60000} minutes.` }
}

export async function trainStyle(input: {
  name: string
  imagePaths: string[]
  steps?: number
  triggerWord?: string
  trainer?: string
  kind?: TrainerKind
}): Promise<TrainResult> {
  if (input.trainer === 'krea-k2') {
    const result = await trainKreaStyle(input)
    if (result.ok && result.style) {
      writeTrainedStyles([...listTrainedStyles().filter((s) => s.id !== result.style!.id), result.style])
    }
    return result
  }
  const auth = falAuth()
  if (!auth) {
    return { ok: false, error: 'fal is not connected — install it and set a key in Settings › Connectors.' }
  }
  if (!input.name.trim()) return { ok: false, error: 'Name the style first.' }
  if (input.imagePaths.length === 0) return { ok: false, error: 'Pick at least one training image.' }
  const trainer = FAL_TRAINERS.find((t) => t.id === (input.trainer ?? 'krea-2')) ?? FAL_TRAINERS[0]
  const kind: TrainerKind = input.kind ?? 'style'
  const steps = Math.max(1, input.steps ?? trainer.defaultSteps)

  try {
    const zip = buildStoredZip(
      input.imagePaths.map((p, i) => ({ name: `${String(i + 1).padStart(2, '0')}-${basename(p)}`, data: readFileSync(p) }))
    )
    const zipUrl = await uploadZip(zip, auth)

    const submit = await net.fetch(`${QUEUE_BASE}/${trainer.model}`, {
      method: 'POST',
      headers: { Authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(trainerInput(trainer, zipUrl, steps, input.triggerWord?.trim() || undefined, kind))
    })
    const submitBody = await submit.text()
    if (!submit.ok) return { ok: false, error: `fal HTTP ${submit.status}: ${submitBody.slice(0, 300)}` }
    const { request_id } = JSON.parse(submitBody) as { request_id?: string }
    if (!request_id) return { ok: false, error: `No request id in fal's reply: ${submitBody.slice(0, 300)}` }

    const polled = await pollQueue(trainer.model, request_id, auth)
    if (!polled.ok) return { ok: false, error: polled.error }

    const style: TrainedStyle = {
      id: request_id,
      name: input.name.trim(),
      connectorId: 'fal',
      trainer: trainer.id,
      loraUrl: extractLoraUrl(polled.result),
      trainedAt: new Date().toISOString(),
      referenceImageCount: input.imagePaths.length
    }
    writeTrainedStyles([...listTrainedStyles().filter((s) => s.id !== style.id), style])
    return { ok: true, style }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
