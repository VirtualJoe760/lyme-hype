import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { AudioToolResult, YapperVoiceEntry } from '@shared/types'
import { importUrlAsset } from './asset-store'
import { readSecretValue } from './credential-vault'

/** Synthetic vault key — NOT a ConnectorDef id. Yapper's hosted MCP server
 *  authenticates via OAuth (connectors-store.ts); this is the separate
 *  `yap_live_…` REST key the MCP login doesn't grant (docs/connectors/
 *  reference/yapper.md "Two credentials, easy to conflate"). It rides the
 *  same generic secret vault (credential-vault.ts) without needing a fake
 *  MCP ConnectorDef, since testConnector would try to MCP-handshake a REST
 *  base URL and fail. */
export const YAPPER_REST_CREDENTIAL_ID = 'yapper-rest'
export const YAPPER_REST_CREDENTIAL_LABEL = 'API key (yap_live_…)'

const YAPPER_REST_BASE = 'https://yapper.so/api/v1'

/** Yapper's accepted upload mimeTypes (yapper.md "Key REST endpoints"). */
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mpeg': 'audio/mpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/x-wav'
}

export function hasYapperRestKey(): boolean {
  return readSecretValue(YAPPER_REST_CREDENTIAL_ID) !== null
}

export interface YapperUploadResult {
  ok: boolean
  assetId?: string
  url?: string
  error?: string
}

interface YapperUploadInit {
  assetId: string
  uploadUrl: string
  method?: string
  headers?: Record<string, string>
  completeUrl: string
}

/**
 * Signed-upload flow for local media the hosted MCP connector can't read
 * (yapper.md "Getting local media INTO Yapper"): POST /assets/uploads ->
 * PUT the bytes to the returned uploadUrl -> POST completeUrl -> Asset.
 * Independent of the OAuth MCP login; needs the REST `yap_live_…` key.
 */
export async function uploadLocalMediaToYapper(path: string): Promise<YapperUploadResult> {
  const key = readSecretValue(YAPPER_REST_CREDENTIAL_ID)
  if (!key) return { ok: false, error: 'No Yapper REST upload key configured (Settings › Connectors).' }

  const mimeType = MIME_BY_EXT[extname(path).toLowerCase()]
  if (!mimeType) return { ok: false, error: `Unsupported file type for Yapper upload: ${path}` }

  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (error) {
    return { ok: false, error: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }
  }

  const initRes = await fetch(`${YAPPER_REST_BASE}/assets/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType, sizeBytes: bytes.length })
  })
  if (!initRes.ok) {
    return { ok: false, error: `Yapper upload init failed: ${initRes.status} ${await initRes.text()}` }
  }
  const init = (await initRes.json()) as YapperUploadInit

  const putRes = await fetch(init.uploadUrl, {
    method: init.method ?? 'PUT',
    headers: { ...(init.headers ?? {}), 'Content-Type': mimeType },
    body: bytes
  })
  if (!putRes.ok) return { ok: false, error: `Yapper upload PUT failed: ${putRes.status}` }

  const completeRes = await fetch(init.completeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` }
  })
  if (!completeRes.ok) {
    return { ok: false, error: `Yapper upload complete failed: ${completeRes.status} ${await completeRes.text()}` }
  }
  const asset = (await completeRes.json()) as { assetId?: string; id?: string; url?: string }

  return { ok: true, assetId: asset.assetId ?? asset.id ?? init.assetId, url: asset.url }
}

/** `POST /audio/speech`'s documented cap (yapper.md "Key REST endpoints"). */
const YAPPER_SPEECH_MAX_CHARS = 2500

interface YapperSpeechResponse {
  assetId?: string
  url?: string
  freeCharactersRemainingToday?: number
}

/**
 * Yapper's synchronous script->voice endpoint (yapper.md "Key REST
 * endpoints") — a zero-cost fallback for the Generate audio › Voice job when
 * ElevenLabs isn't connected: a free daily character tier applies before any
 * credits are charged. Same REST key as `uploadLocalMediaToYapper`, no OAuth
 * MCP login involved (this isn't a tool the hosted connector exposes).
 */
export async function synthesizeYapperSpeech(input: { text: string; voiceId?: string }): Promise<AudioToolResult> {
  const key = readSecretValue(YAPPER_REST_CREDENTIAL_ID)
  if (!key) return { ok: false, error: 'No Yapper REST key configured (Settings › Connectors).' }

  const script = input.text.trim()
  if (!script) return { ok: false, error: 'Enter a line to speak.' }
  if (script.length > YAPPER_SPEECH_MAX_CHARS) {
    return {
      ok: false,
      error: `Yapper's free speech endpoint takes up to ${YAPPER_SPEECH_MAX_CHARS} characters (this line is ${script.length}).`
    }
  }

  const body: Record<string, unknown> = { script }
  if (input.voiceId?.trim()) body.voiceId = input.voiceId.trim()

  const res = await fetch(`${YAPPER_REST_BASE}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) return { ok: false, error: `Yapper speech failed: ${res.status} ${await res.text()}` }
  const speech = (await res.json()) as YapperSpeechResponse
  if (!speech.url) return { ok: false, error: 'Yapper returned no audio URL.' }

  const saved = await importUrlAsset(speech.url, 'audio')
  return { ok: true, src: saved.url, freeCharactersRemainingToday: speech.freeCharactersRemainingToday }
}

/** `POST /audio/speech`'s `provider` values map to the two browsable TTS
 *  models in the audio-model catalog (yapper.md "Models" > Audio (speech));
 *  the third, `bytedance/seed-audio-1.0`, is ref-clip voice design, not a
 *  named-voice library, so it has nothing to browse here. */
const YAPPER_VOICE_MODEL_BY_PROVIDER = {
  cartesia: 'sonic-3.5',
  elevenlabs: 'eleven_v3'
} as const

interface YapperVoicesResponse {
  data?: Array<Record<string, unknown>>
}

/**
 * `GET /audio/voices?modelId=…` (yapper.md "Key REST endpoints") — browsing
 * for `synthesizeYapperSpeech`'s optional `voiceId`. The response's per-voice
 * field names aren't captured in the reference doc beyond the bare
 * `AudioVoice[]` type, so this reads defensively across the field names the
 * sibling `/audio/speech` response's own `voice{voiceId,provider,name}`
 * object uses, worth a live check once a REST key exists.
 */
export async function listYapperVoices(input: {
  provider: keyof typeof YAPPER_VOICE_MODEL_BY_PROVIDER
  search?: string
}): Promise<AudioToolResult> {
  const key = readSecretValue(YAPPER_REST_CREDENTIAL_ID)
  if (!key) return { ok: false, error: 'No Yapper REST key configured (Settings › Connectors).' }

  const modelId = YAPPER_VOICE_MODEL_BY_PROVIDER[input.provider]
  const params = new URLSearchParams({ modelId })
  if (input.search?.trim()) params.set('search', input.search.trim())

  const res = await fetch(`${YAPPER_REST_BASE}/audio/voices?${params.toString()}`, {
    headers: { Authorization: `Bearer ${key}` }
  })
  if (!res.ok) return { ok: false, error: `Yapper voice list failed: ${res.status} ${await res.text()}` }
  const body = (await res.json()) as YapperVoicesResponse

  const yapperVoices: YapperVoiceEntry[] = (body.data ?? [])
    .map((v) => {
      const id = v.voiceId ?? v.id
      const name = v.name ?? v.label ?? id
      return typeof id === 'string' && typeof name === 'string' ? { id, name } : null
    })
    .filter((v): v is YapperVoiceEntry => v !== null)

  return { ok: true, yapperVoices }
}
