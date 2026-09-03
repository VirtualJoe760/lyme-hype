import type { ClipTransform } from '@shared/types'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CutExportResult, TimelineExportSpec } from '@shared/types'
import { assetPathForUrl } from './asset-store'

/** Reels-first default export canvas; off-ratio clips are letterboxed into it. */
export const OUT_W = 1080
export const OUT_H = 1920
export const FPS = 30

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

/** A clip resolved to an on-disk path with its track semantics flattened in —
 *  the pure builder's whole world, so it stays testable without Electron. */
export interface ResolvedTimelineClip {
  path: string
  mediaType: 'video' | 'image' | 'audio'
  trackType: 'video' | 'audio'
  /** Among same-type tracks; lowest video order composites first (base). */
  trackOrder: number
  trackMuted: boolean
  startTime: number
  trimIn: number
  trimOut: number
  /** Video clip's own embedded audio silenced. */
  audioMuted?: boolean
  /** How the clip sits in the frame — the same fit the monitor drew. */
  transform?: ClipTransform
  /** Whether the source actually carries an audio stream. Motion-graphics
   *  overlays (and many stills-derived clips) don't — referencing a missing
   *  [i:a] would kill the whole export, so video-track clips only join the mix
   *  when this is explicitly true. Probed at export time. */
  hasAudio?: boolean
  /** Force a specific decoder for this input. VP9/WebM alpha only survives
   *  when decoded by libvpx-vp9 — ffmpeg's native vp9 decoder silently drops
   *  the alpha plane, which would flatten every Motion-graphics overlay to an
   *  opaque rectangle. Probed at export time. */
  inputDecoder?: string
}

export interface MediaStreamInfo {
  hasAudio: boolean
  /** VP9 with an alpha side-channel (webm alpha_mode) — needs libvpx-vp9 to decode. */
  vp9Alpha: boolean
}

/** Detects stream facts by parsing `ffmpeg -i`'s banner (no ffprobe
 *  dependency — the banner is stable enough for booleans). */
export function probeMediaInfo(ffmpegPath: string, mediaPath: string): MediaStreamInfo {
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-i', mediaPath], { timeout: 8000 })
    const banner = String(res.stderr ?? '')
    return {
      hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(banner),
      vp9Alpha: /Video:\s*vp9/.test(banner) && /alpha_mode\s*:\s*1/.test(banner)
    }
  } catch {
    return { hasAudio: false, vp9Alpha: false }
  }
}

function fmtSec(n: number): string {
  // Fixed decimals keep filter args stable and locale-proof.
  return (Math.round(n * 1000) / 1000).toString()
}

/**
 * Builds a single-pass multitrack filter graph. The model (timeline.md):
 * a black FPS-locked canvas runs the full duration; every un-muted video-track
 * clip is an `overlay` onto the running composite with an
 * enable='between(t,start,end)' window — base-track clips (lowest track order)
 * are scaled+padded to the full canvas so they cover everything below them,
 * higher-track clips are scaled-to-fit only and centered, so an alpha-carrying
 * overlay blends and an opaque one draws as a picture-in-picture. Audio from
 * un-muted audio-track clips plus un-muted video-track clips' embedded tracks
 * is delayed to position and blended with `amix`.
 *
 * Track MUTE is honored here (muted tracks' clips never enter the graph).
 * Track SOLO must never be honored here — it's preview-only, and the export
 * payload type carries no solo field precisely so this stays true.
 *
 * Pure and exported so the argument shape is verifiable without running ffmpeg.
 * Assumes video files carry an audio stream (as generated/recorded clips do);
 * image clips are looped stills and contribute no audio.
 */
export function buildMultitrackArgs(clips: ResolvedTimelineClip[], outPath: string): string[] {
  const active = clips.filter((c) => !c.trackMuted)
  const video = active
    .filter((c) => c.trackType === 'video' && c.mediaType !== 'audio')
    .sort((a, b) => (a.trackOrder - b.trackOrder) || (a.startTime - b.startTime))
  const audio = active.filter(
    (c) =>
      (c.trackType === 'audio' && c.mediaType === 'audio') ||
      (c.trackType === 'video' && c.mediaType === 'video' && !c.audioMuted && c.hasAudio === true)
  )

  const duration = Math.max(
    0.1,
    ...active.map((c) => c.startTime + Math.max(0.05, c.trimOut - c.trimIn))
  )

  // Inputs: one per referenced clip instance. Image stills loop for their
  // placed duration; everything else reads normally.
  const inputIndex = new Map<ResolvedTimelineClip, number>()
  const args: string[] = ['-y']
  const addInput = (clip: ResolvedTimelineClip): number => {
    const existing = inputIndex.get(clip)
    if (existing !== undefined) return existing
    const index = inputIndex.size
    if (clip.mediaType === 'image') {
      if (/\.gif$/i.test(clip.path)) {
        // The gif demuxer rejects image2's -loop option; -stream_loop covers
        // both animated and single-frame gifs, capped by the input -t.
        args.push('-stream_loop', '-1', '-t', fmtSec(clip.trimOut - clip.trimIn), '-i', clip.path)
      } else {
        args.push('-loop', '1', '-t', fmtSec(clip.trimOut - clip.trimIn), '-i', clip.path)
      }
    } else {
      if (clip.inputDecoder) args.push('-c:v', clip.inputDecoder)
      args.push('-i', clip.path)
    }
    inputIndex.set(clip, index)
    return index
  }
  for (const clip of video) addInput(clip)
  for (const clip of audio) addInput(clip)

  const filters: string[] = [
    `color=black:s=${OUT_W}x${OUT_H}:r=${FPS}:d=${fmtSec(duration)}[base]`
  ]

  const baseOrder = video.length > 0 ? Math.min(...video.map((c) => c.trackOrder)) : 0
  let composite = '[base]'
  video.forEach((clip, i) => {
    const input = inputIndex.get(clip)!
    const start = clip.startTime
    const end = clip.startTime + (clip.trimOut - clip.trimIn)
    const isBase = clip.trackOrder === baseOrder
    const chain: string[] = []
    if (clip.mediaType === 'video') {
      chain.push(`trim=start=${fmtSec(clip.trimIn)}:end=${fmtSec(clip.trimOut)}`)
    }
    chain.push(`setpts=PTS-STARTPTS+${fmtSec(start)}/TB`)
    // The clip's fit, identical to what the monitor showed (ClipTransform):
    //   contain — scale down to fit, bars where the aspect differs (the old default)
    //   cover   — scale up until the frame is filled; the overlay crops the rest
    //   custom  — the contain size × scale, nudged by an offset
    // Every clip composites onto the opaque black [base], so nothing needs a pad
    // step any more: a letterbox is just black showing through.
    const t = clip.transform ?? { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 }
    if (t.fit === 'cover') {
      chain.push(`scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase`)
    } else {
      chain.push(`scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease`)
      if (t.fit === 'custom' && t.scale !== 1) {
        chain.push(`scale=trunc(iw*${t.scale.toFixed(4)}/2)*2:trunc(ih*${t.scale.toFixed(4)}/2)*2`)
      }
    }
    chain.push('setsar=1', `fps=${FPS}`)
    filters.push(`[${input}:v]${chain.join(',')}[v${i}]`)
    const out = `[cmp${i}]`
    // Centered, plus the custom offset as a fraction of the frame. Base or not
    // makes no difference now — the base is just the lowest opaque layer.
    void isBase
    const dx = t.fit === 'custom' ? Math.round((t.offsetX / 100) * OUT_W) : 0
    const dy = t.fit === 'custom' ? Math.round((t.offsetY / 100) * OUT_H) : 0
    const position = `(W-w)/2${dx >= 0 ? '+' : ''}${dx}:(H-h)/2${dy >= 0 ? '+' : ''}${dy}`
    filters.push(
      `${composite}[v${i}]overlay=${position}:enable='between(t,${fmtSec(start)},${fmtSec(end)})'${out}`
    )
    composite = out
  })
  filters.push(`${composite}fps=${FPS}[outv]`)

  const audioLabels: string[] = []
  audio.forEach((clip, i) => {
    const input = inputIndex.get(clip)!
    const delayMs = Math.max(0, Math.round(clip.startTime * 1000))
    filters.push(
      `[${input}:a]atrim=start=${fmtSec(clip.trimIn)}:end=${fmtSec(clip.trimOut)},` +
        'asetpts=PTS-STARTPTS,' +
        'aformat=sample_rates=48000:channel_layouts=stereo,' +
        `adelay=${delayMs}|${delayMs}[a${i}]`
    )
    audioLabels.push(`[a${i}]`)
  })
  if (audioLabels.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${fmtSec(duration)}[outa]`)
  } else if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}apad=whole_dur=${fmtSec(duration)},atrim=0:${fmtSec(duration)}[outa]`)
  } else {
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,` +
        `apad=whole_dur=${fmtSec(duration)},atrim=0:${fmtSec(duration)}[outa]`
    )
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-t',
    fmtSec(duration),
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
 * Composites the multitrack timeline into outPath via ffmpeg. Mute is applied
 * here (per-track, plus per-clip audioMuted); solo state never reaches this
 * function — see TimelineExportSpec. Returns ffmpegMissing when no binary is
 * available.
 */
export async function exportTimeline(
  spec: TimelineExportSpec,
  outPath: string
): Promise<CutExportResult> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    return {
      ok: false,
      ffmpegMissing: true,
      error:
        'No ffmpeg found. Drop an ffmpeg build into userData/bin, set LYME_FFMPEG_PATH, or install ffmpeg on PATH.'
    }
  }

  const resolved: ResolvedTimelineClip[] = []
  const probed = new Map<string, MediaStreamInfo>()
  const infoFor = (path: string): MediaStreamInfo => {
    let info = probed.get(path)
    if (!info) {
      info = probeMediaInfo(ffmpeg.path, path)
      probed.set(path, info)
    }
    return info
  }
  for (const clip of spec.clips) {
    const track = spec.tracks[clip.trackIndex]
    if (!track) continue
    const path = assetPathForUrl(clip.src)
    if (!path) continue
    if (clip.trimOut - clip.trimIn <= 0.01) continue
    const info = clip.mediaType === 'video' && !track.muted ? infoFor(path) : null
    resolved.push({
      path,
      mediaType: clip.mediaType,
      trackType: track.type,
      trackOrder: track.order,
      trackMuted: track.muted,
      startTime: clip.startTime,
      trimIn: clip.trimIn,
      trimOut: clip.trimOut,
      transform: clip.transform,
      audioMuted: clip.audioMuted,
      hasAudio: info?.hasAudio,
      inputDecoder: info?.vp9Alpha ? 'libvpx-vp9' : undefined
    })
  }

  if (!resolved.some((c) => !c.trackMuted && c.trackType === 'video' && c.mediaType !== 'audio')) {
    return { ok: false, error: 'No exportable video clips on un-muted video tracks.' }
  }

  const args = buildMultitrackArgs(resolved, outPath)

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
