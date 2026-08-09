import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assetPathForUrl, importFileAsset } from './asset-store'
import { resolveFfmpeg } from './ffmpeg'

/**
 * Local ffmpeg jobs behind Create-panel tiles — the "local ffmpeg over a paid
 * API call" principle (docs/ui/create-panel.md): extracting an audio track and
 * keying a background to alpha cost nothing and spend no connector tokens.
 */

export interface LocalToolResult {
  ok: boolean
  /** lyme-asset:// URL of the produced file. */
  src?: string
  error?: string
}

function workDir(): string {
  const dir = join(tmpdir(), 'lyme-hype-media-tools')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Pure args builder: extract the audio track (video discarded) to mp3.
 *  Works identically for local paths and direct-file URLs — ffmpeg reads
 *  http(s) inputs natively (the confirmed v1 scope; hosting-site URLs are
 *  explicitly out of scope and just error). */
export function buildIsolateAudioArgs(input: string, outPath: string): string[] {
  return ['-y', '-i', input, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outPath]
}

/** Pure args builder: key a (near-)solid background to real alpha and encode
 *  with an alpha-capable codec. VP9/WebM carries yuva420p alpha AND plays in
 *  Chromium, so the result is previewable in-app — the reason it beats
 *  qtrle/prores as the default (those stay possible later for NLE handoff). */
export function buildAlphaKeyArgs(
  input: string,
  outPath: string,
  opts?: { color?: string; similarity?: number; blend?: number }
): string[] {
  const color = opts?.color ?? 'black'
  const similarity = opts?.similarity ?? 0.15
  const blend = opts?.blend ?? 0.08
  return [
    '-y',
    '-i',
    input,
    '-vf',
    `colorkey=${color}:${similarity}:${blend},format=yuva420p`,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-an',
    outPath
  ]
}

function runFfmpeg(args: string[], outPath: string): Promise<LocalToolResult> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    return Promise.resolve({
      ok: false,
      error: 'No ffmpeg found. Install ffmpeg on PATH or set LYME_FFMPEG_PATH.'
    })
  }
  return new Promise((resolve) => {
    let stderr = ''
    const child = spawn(ffmpeg.path, args, { windowsHide: true })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    child.on('error', (err) => resolve({ ok: false, error: `ffmpeg failed to start: ${err.message}` }))
    child.on('exit', (code) => {
      if (code === 0 && existsSync(outPath)) {
        const saved = importFileAsset(outPath)
        resolve({ ok: true, src: saved.url })
      } else {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
        resolve({ ok: false, error: `ffmpeg exited ${code}. ${tail}`.trim() })
      }
    })
  })
}

/** Resolves the tile's three source shapes to one ffmpeg input string. */
function resolveInput(source: { assetUrl?: string; filePath?: string; url?: string }):
  | { ok: true; input: string }
  | { ok: false; error: string } {
  if (source.assetUrl) {
    const path = assetPathForUrl(source.assetUrl)
    return path ? { ok: true, input: path } : { ok: false, error: 'Asset not found on disk.' }
  }
  if (source.filePath) return { ok: true, input: source.filePath }
  if (source.url) {
    if (!/^https?:\/\//i.test(source.url)) return { ok: false, error: 'Not an http(s) URL.' }
    return { ok: true, input: source.url }
  }
  return { ok: false, error: 'No input given.' }
}

export async function isolateAudio(source: {
  assetUrl?: string
  filePath?: string
  url?: string
}): Promise<LocalToolResult> {
  const resolved = resolveInput(source)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const out = join(workDir(), `${randomUUID()}.mp3`)
  const result = await runFfmpeg(buildIsolateAudioArgs(resolved.input, out), out)
  if (!result.ok && source.url) {
    return {
      ok: false,
      error: `${result.error ?? 'Extraction failed.'} — if this was a hosting-site link (YouTube etc.), that isn't a direct media file; v1 supports direct file URLs only.`
    }
  }
  return result
}

export async function keyAlpha(input: {
  assetUrl: string
  color?: string
  similarity?: number
  blend?: number
}): Promise<LocalToolResult> {
  const path = assetPathForUrl(input.assetUrl)
  if (!path) return { ok: false, error: 'Asset not found on disk.' }
  const out = join(workDir(), `${randomUUID()}.webm`)
  return runFfmpeg(buildAlphaKeyArgs(path, out, input), out)
}
