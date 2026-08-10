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
import { app, nativeImage, net, protocol } from 'electron'
import type { MediaType } from '@shared/types'
import { activeProjectDir } from './workspace'

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

function legacyAssetsDir(): string {
  const dir = join(app.getPath('userData'), 'assets')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * New media lands inside the open project so it is browsable, portable, and deleted
 * with the project (build-plan Phase 23). With no project open — first run, or before
 * migration — it falls back to the old userData location so nothing breaks mid-move.
 */
function assetsDir(): string {
  const project = activeProjectDir()
  if (!project) return legacyAssetsDir()
  const dir = join(project, 'assets')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * A `lyme-asset://` URL carries only a filename, so resolution checks the open project
 * first and then the legacy folder — which is what lets sessions written before the move
 * keep rendering their images while new ones are written project-side.
 */
function resolveAssetFile(fileName: string): string | null {
  const project = activeProjectDir()
  if (project) {
    const inProject = join(project, 'assets', fileName)
    if (existsSync(inProject)) return inProject
  }
  const legacy = join(app.getPath('userData'), 'assets', fileName)
  return existsSync(legacy) ? legacy : null
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
    if (!name || name.includes('/') || name.includes('\\')) {
      return new Response('Not found', { status: 404 })
    }
    const filePath = resolveAssetFile(name)
    if (!filePath) return new Response('Not found', { status: 404 })
    // net.fetch on a file URL streams with range support — needed for <video>
    // seeking — and infers Content-Type from the extension.
    return net.fetch(pathToFileURL(filePath).href)
  })
}

export interface SavedAsset {
  url: string
  bytes: number
  /** Downscaled companion for node thumbnails, when one could be made. */
  thumbUrl?: string
}

function stripExt(name: string): string {
  return name.replace(/.[^.]+$/, '')
}

/** Canvas node thumbs render at 62px tall; 256 covers hi-DPI without being wasteful. */
const THUMB_MAX = 256

/**
 * A canvas node's thumbnail is 62px tall, but it was being handed the full-resolution
 * source — a 1024×1024 3 MB PNG decoded and downscaled per node, per render. That is the
 * single biggest cost in the canvas. Generating a small companion once at import makes
 * node rendering cheap; the full asset is still what Play view and export use.
 *
 * Best-effort by design: a format nativeImage can't read (or a video) just has no thumb,
 * and the node falls back to the original.
 */
function writeThumb(sourcePath: string, baseName: string): string | undefined {
  try {
    const image = nativeImage.createFromPath(sourcePath)
    if (image.isEmpty()) return undefined
    const { width, height } = image.getSize()
    if (width <= THUMB_MAX && height <= THUMB_MAX) return undefined
    const resized =
      width >= height
        ? image.resize({ width: THUMB_MAX, quality: 'good' })
        : image.resize({ height: THUMB_MAX, quality: 'good' })
    const fileName = `thumb_${baseName}.jpg`
    writeFileSync(join(assetsDir(), fileName), resized.toJPEG(82))
    return `${ASSET_SCHEME}://asset/${fileName}`
  } catch {
    return undefined
  }
}

/** Persists image bytes to userData/assets and returns a lyme-asset:// URL. */
export function saveImageAsset(base64: string, mimeType: string): SavedAsset {
  const ext = MIME_EXT[mimeType.toLowerCase()] ?? '.bin'
  const fileName = `${randomUUID()}${ext}`
  const buffer = Buffer.from(base64, 'base64')
  const dest = join(assetsDir(), fileName)
  writeFileSync(dest, buffer)
  return {
    url: `${ASSET_SCHEME}://asset/${fileName}`,
    bytes: buffer.length,
    thumbUrl: writeThumb(dest, stripExt(fileName))
  }
}

/** Copies a user-picked/downloaded file into the asset store and returns a
 *  playable lyme-asset:// URL. Keeps the original untouched; large videos are
 *  copied once (acceptable for a local desktop app). */
export function importFileAsset(srcPath: string): SavedAsset {
  const ext = extname(srcPath).toLowerCase() || '.bin'
  const fileName = `${randomUUID()}${ext}`
  const dest = join(assetsDir(), fileName)
  copyFileSync(srcPath, dest)
  return {
    url: `${ASSET_SCHEME}://asset/${fileName}`,
    bytes: statSync(dest).size,
    thumbUrl: writeThumb(dest, stripExt(fileName))
  }
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
  const dest = join(assetsDir(), fileName)
  writeFileSync(dest, buffer)
  return {
    url: `${ASSET_SCHEME}://asset/${fileName}`,
    bytes: buffer.length,
    thumbUrl: writeThumb(dest, stripExt(fileName))
  }
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
  // Reject anything that is not a bare filename before touching the disk — the
  // traversal guard has to survive resolving across two possible directories.
  if (!name || name.includes("/") || name.includes("\\")) return null
  return resolveAssetFile(name)
}

/** Test helper: confirm a saved asset is readable and non-empty. */
export function readAssetBytes(fileName: string): number {
  const filePath = resolveAssetFile(fileName)
  return filePath ? readFileSync(filePath).length : 0
}

export function assetExtFor(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? '.bin'
}
