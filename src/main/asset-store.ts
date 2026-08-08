import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { app, net, protocol } from 'electron'

export const ASSET_SCHEME = 'lyme-asset'

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
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
    return net.fetch(`file://${filePath.replace(/\\/g, '/')}`)
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

/** Test helper: confirm a saved asset is readable and non-empty. */
export function readAssetBytes(fileName: string): number {
  const filePath = join(assetsDir(), fileName)
  return existsSync(filePath) ? readFileSync(filePath).length : 0
}

export function assetExtFor(mimeType: string): string {
  return MIME_EXT[mimeType.toLowerCase()] ?? '.bin'
}
