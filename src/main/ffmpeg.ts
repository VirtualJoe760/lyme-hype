import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CutExportResult, TimelineExportClip } from '@shared/types'
import { assetPathForUrl } from './asset-store'

/** Reels-first default export canvas; off-ratio clips are letterboxed into it. */
const OUT_W = 1080
const OUT_H = 1920
const FPS = 30

export interface ResolvedFfmpeg {
  path: string
  /** How it was found — surfaced so the UI can say where export ran from. */
  source: 'env' | 'bundled' | 'path'
}

/**
 * Finds an ffmpeg binary WITHOUT bundling one — the LGPL-only build decision
 * (AGENTS.md §7) is deliberately left to the user, so this looks for an explicit
 * override, a binary dropped into userData/bin, or one already on PATH. Returns
 * null when none works, so the caller can tell the user rather than guess.
 */
export function resolveFfmpeg(): ResolvedFfmpeg | null {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates: ResolvedFfmpeg[] = []
  const override = process.env['LYME_FFMPEG_PATH']
  if (override) candidates.push({ path: override, source: 'env' })
  candidates.push({ path: join(app.getPath('userData'), 'bin', exe), source: 'bundled' })
  candidates.push({ path: exe, source: 'path' })

  for (const c of candidates) {
    // An absolute candidate must exist on disk; a bare name is probed via PATH.
    if ((c.source === 'env' || c.source === 'bundled') && !existsSync(c.path)) continue
    try {
      const probe = spawnSync(c.path, ['-version'], { timeout: 5000 })
      if (probe.status === 0) return c
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

function trimExpr(kind: 'trim' | 'atrim', trimIn?: number, trimOut?: number): string | null {
  const parts: string[] = []
  if (typeof trimIn === 'number' && trimIn > 0) parts.push(`start=${trimIn}`)
  if (typeof trimOut === 'number' && trimOut > 0) parts.push(`end=${trimOut}`)
  return parts.length ? `${kind}=${parts.join(':')}` : null
}

/**
 * Builds a single-pass filter_complex concat: each clip is trimmed, normalized to
 * the export canvas (scale + pad + fps) and a uniform audio format, muted clips
 * get volume=0, then all are concatenated. Pure and exported so the argument
 * shape can be verified without executing ffmpeg. Assumes each input carries an
 * audio stream (true for generated/recorded video); a stream-less input makes
 * ffmpeg error, surfaced to the caller.
 */
export function buildConcatArgs(
  clips: { path: string; trimIn?: number; trimOut?: number; muted?: boolean }[],
  outPath: string
): string[] {
  const args: string[] = ['-y']
  for (const clip of clips) args.push('-i', clip.path)

  const filters: string[] = []
  const maps: string[] = []
  clips.forEach((clip, i) => {
    const vTrim = trimExpr('trim', clip.trimIn, clip.trimOut)
    const aTrim = trimExpr('atrim', clip.trimIn, clip.trimOut)
    const vChain = [
      `[${i}:v]`,
      vTrim ? `${vTrim},` : '',
      'setpts=PTS-STARTPTS,',
      `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,`,
      `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black,`,
      `setsar=1,fps=${FPS}[v${i}]`
    ].join('')
    const aChain = [
      `[${i}:a]`,
      aTrim ? `${aTrim},` : '',
      'asetpts=PTS-STARTPTS,',
      'aformat=sample_rates=48000:channel_layouts=stereo,',
      `volume=${clip.muted ? 0 : 1}[a${i}]`
    ].join('')
    filters.push(vChain, aChain)
    maps.push(`[v${i}][a${i}]`)
  })
  filters.push(`${maps.join('')}concat=n=${clips.length}:v=1:a=1[outv][outa]`)

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outPath
  )
  return args
}

/**
 * Concatenates the timeline's video clips (trims + mutes baked in) into outPath
 * via ffmpeg. Audio-only clips are skipped in this cut — a proper audio-track
 * mix is a follow-up. Returns ffmpegMissing when no binary is available.
 */
export async function exportTimeline(
  clips: TimelineExportClip[],
  outPath: string
): Promise<CutExportResult> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    return {
      ok: false,
      ffmpegMissing: true,
      error:
        'No ffmpeg found. Drop an LGPL ffmpeg build into userData/bin, set LYME_FFMPEG_PATH, or install ffmpeg on PATH.'
    }
  }

  const resolved: { path: string; trimIn?: number; trimOut?: number; muted?: boolean }[] = []
  for (const c of clips) {
    if (c.mediaType !== 'video') continue
    const path = assetPathForUrl(c.src)
    if (!path) continue
    resolved.push({ path, trimIn: c.trimIn, trimOut: c.trimOut, muted: c.muted })
  }

  if (resolved.length === 0) {
    return { ok: false, error: 'No exportable video clips on the timeline.' }
  }

  const args = buildConcatArgs(resolved, outPath)

  return new Promise<CutExportResult>((resolve) => {
    let stderr = ''
    const child = spawn(ffmpeg.path, args, { windowsHide: true })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    child.on('error', (err) => resolve({ ok: false, error: `ffmpeg failed to start: ${err.message}` }))
    child.on('exit', (code) => {
      if (code === 0 && existsSync(outPath)) {
        resolve({ ok: true, outPath })
      } else {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-4).join(' ')
        resolve({ ok: false, error: `ffmpeg exited ${code}. ${tail}`.trim() })
      }
    })
  })
}
