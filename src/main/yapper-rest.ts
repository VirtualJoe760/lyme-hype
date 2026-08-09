import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
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
