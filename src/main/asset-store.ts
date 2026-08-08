import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'
import type { MediaType } from '@shared/types'

export const ASSET_SCHEME = 'lyme-asset'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg'
}

const MEDIA_TYPE_DEFAULT_EXT: Record<MediaType, string> = {
  image: '.png',
  video: '.mp4',
  audio: '.mp3'
}

const EXT_MEDIA_TYPE: Record<string, MediaType> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio'
}

export function mediaTypeForPath(p: string): MediaType | null {
  return EXT_MEDIA_TYPE[extname(p).toLowerCase()] ?? null
}

function assetsDir(): string {
  const dir = join(app.getPath('userData'), 'assets')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Must run before app.whenReady() — privileged scheme registration requirement. */
export function registerAssetSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false } }
  ])
}

/** Serves saved assets to the renderer as lyme-asset://asset/<file>. */
export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const url = new URL(request.url)
    // Only the flat filename is honored — no path traversal out of assetsDir.
    const name = normalize(url.pathname).replace(/^([/\\.]+)/, '')
    const filePath = join(assetsDir(), name)
    if (!filePath.startsWith(assetsDir()) || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    // net.fetch on a file URL streams with range support — needed for <video>
    // seeking — and infers Content-Type from the extension.
    return net.fetch(pathToFileURL(filePath).href)
  })
}

export interface SavedAsset {
  url: string
  bytes: number
}

/** Persists image bytes to userData/assets and returns a lyme-asset:// URL. */
export function saveImageAsset(base64: string, mimeType: string): SavedAsset {
  const ext = MIME_EXT[mimeType.toLowerCase()] ?? '.bin'
  const fileName = `${randomUUID()}${ext}`
  const buffer = Buffer.from(base64, 'base64')
  writeFileSync(join(assetsDir(), fileName), buffer)
  return { url: `${ASSET_SCHEME}://asset/${fileName}`, bytes: buffer.length }
}

/** Copies a user-picked/downloaded file into the asset store and returns a
 *  playable lyme-asset:// URL. Keeps the original untouched; large videos are
 *  copied once (acceptable for a local desktop app). */
export function importFileAsset(srcPath: string): SavedAsset {
  const ext = extname(srcPath).toLowerCase() || '.bin'
  const fileName = `${randomUUID()}${ext}`
  const dest = join(assetsDir(), fileName)
  copyFileSync(srcPath, dest)
  return { url: `${ASSET_SCHEME}://asset/${fileName}`, bytes: statSync(dest).size }
}

/** Downloads a remote media URL into the asset store. The extension is resolved
 *  from the URL path, then the response Content-Type, then a media-type default —
 *  generation tools often hand back extension-less or query-string URLs. Real
 *  transcode of non-web-playable containers is deferred to the ffmpeg pass
 *  (Phase 7). */
export async function importUrlAsset(sourceUrl: string, mediaType?: MediaType): Promise<SavedAsset> {
  const res = await net.fetch(sourceUrl)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const urlExt = extname(new URL(sourceUrl).pathname).toLowerCase()
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT_MEDIA_TYPE[urlExt]
    ? urlExt
    : (MIME_EXT[contentType] ?? (mediaType ? MEDIA_TYPE_DEFAULT_EXT[mediaType] : '.mp4'))
  const fileName = `${randomUUID()}${ext}`
  writeFileSync(join(assetsDir(), fileName), buffer)
  return { url: `${ASSET_SCHEME}://asset/${fileName}`, bytes: buffer.length }
}

/** Resolves a lyme-asset://asset/<file> URL back to its on-disk path (for ffmpeg
 *  input at export). Returns null for a non-asset URL or a missing file — the
 *  same flat-filename, no-traversal rule as the protocol handler. */
export function assetPathForUrl(url: string): string | null {
  if (!url.startsWith(`${ASSET_SCHEME}://`)) return null
  let name: string
  try {
    name = normalize(new URL(url).pathname).replace(/^([/\\.]+)/, '')
  } catch {
    return null
  }
  const filePath = join(assetsDir(), name)
  if (!filePath.startsWith(assetsDir()) || !existsSync(filePath)) return null
  return filePath
}

/** Test helper: confirm a saved asset is readable and non-empty. */
export function readAssetBytes(fileName: string): number {
  const filePath = join(assetsDir(), fileName)
  return existsSync(filePath) ? readFileSync(filePath).length : 0
}

export function assetExtFor(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? '.bin'
}
