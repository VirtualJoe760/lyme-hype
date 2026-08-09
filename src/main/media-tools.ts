import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CombineLocalKind } from '@shared/types'
import { assetPathForUrl, importFileAsset } from './asset-store'
import { FPS, OUT_H, OUT_W, probeMediaInfo, resolveFfmpeg } from './ffmpeg'

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

/**
 * The Combine dialog's four ffmpeg-only pairs (docs/ui/timeline.md's "row 9"
 * territory, left as a stub node by row 7): no agent judgment is needed for
 * any of these — the filter graph is fully determined by which two media
 * types were dragged together, unlike image+image/audio+image which route
 * through GenerationParams instead because "how should these mix" is a real
 * creative question only the agent can answer.
 */

function normalizeVideoFilter(inputIndex: number, label: string): string {
  return (
    `[${inputIndex}:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,` +
    `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}[${label}]`
  )
}

/** video+video "Stitch clips": concat, normalized to the shared export canvas
 *  first since two independently generated clips can differ in resolution/fps.
 *  Audio only concats when BOTH clips carry a stream — concat's `a=1` requires
 *  every segment to have one, and there's no ffprobe here to measure a missing
 *  track's duration for a matching silent filler, so the honest v1 behavior is
 *  video-only output when either clip is silent, not a guessed-length dub. */
export function buildStitchArgs(
  pathA: string,
  pathB: string,
  outPath: string,
  opts: { bothHaveAudio: boolean }
): string[] {
  const filters = [normalizeVideoFilter(0, 'v0'), normalizeVideoFilter(1, 'v1')]
  const map: string[] = []
  if (opts.bothHaveAudio) {
    filters.push('[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[outv][outa]')
    map.push('-map', '[outv]', '-map', '[outa]')
  } else {
    filters.push('[v0][v1]concat=n=2:v=1:a=0[outv]')
    map.push('-map', '[outv]')
  }
  return [
    '-y',
    '-i',
    pathA,
    '-i',
    pathB,
    '-filter_complex',
    filters.join(';'),
    ...map,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    ...(opts.bothHaveAudio ? ['-c:a', 'aac'] : []),
    '-movflags',
    '+faststart',
    outPath
  ]
}

/** image+video "Composite overlay": the still drawn centered, scaled-to-fit,
 *  over the clip's full duration (`shortest=1` on the overlay plus `-shortest`
 *  caps output to the video's length) — the same scale-to-fit-and-center
 *  treatment ffmpeg.ts's multitrack export gives a non-base overlay track.
 *  The video's own audio (if any) passes through unmixed via the optional
 *  `0:a?` map. */
export function buildOverlayImageArgs(videoPath: string, imagePath: string, outPath: string): string[] {
  return [
    '-y',
    '-i',
    videoPath,
    '-loop',
    '1',
    '-i',
    imagePath,
    '-filter_complex',
    `[1:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[ov];` +
      '[0:v][ov]overlay=(W-w)/2:(H-h)/2:shortest=1[outv]',
    '-map',
    '[outv]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ]
}

/** audio+video "Score the clip": lays the audio under the video, mixed with
 *  the clip's own audio when it has one (both audible, e.g. a voiceover over
 *  a talking clip) rather than one silently replacing the other. `-shortest`
 *  is the deliberate v1 default — output runs to whichever of the two is
 *  shorter, matching how `-shortest` already behaves for overlay-image above,
 *  rather than padding/looping the shorter side to match (revisit only if
 *  that proves wrong in practice, same posture timeline.md takes on its own
 *  open questions). The video stream is untouched (`-c:v copy`, no re-encode)
 *  since only the audio changes. */
export function buildScoreArgs(
  videoPath: string,
  audioPath: string,
  outPath: string,
  opts: { videoHasAudio: boolean }
): string[] {
  const filter = opts.videoHasAudio
    ? '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[outa]'
    : '[1:a]anull[outa]'
  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-filter_complex',
    filter,
    '-map',
    '0:v',
    '-map',
    '[outa]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ]
}

/** audio+audio "Mix tracks": blend both into one stream. `normalize=0` matches
 *  ffmpeg.ts's own multitrack `amix` call — neither track gets silently
 *  attenuated to make room for the other. */
export function buildMixAudioArgs(pathA: string, pathB: string, outPath: string): string[] {
  return [
    '-y',
    '-i',
    pathA,
    '-i',
    pathB,
    '-filter_complex',
    '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[outa]',
    '-map',
    '[outa]',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    outPath
  ]
}

export async function combineLocal(input: {
  kind: CombineLocalKind
  aUrl: string
  bUrl: string
}): Promise<LocalToolResult> {
  const pathA = assetPathForUrl(input.aUrl)
  const pathB = assetPathForUrl(input.bUrl)
  if (!pathA || !pathB) return { ok: false, error: 'Asset not found on disk.' }

  switch (input.kind) {
    case 'stitch-video': {
      const ffmpeg = resolveFfmpeg()
      if (!ffmpeg) return { ok: false, error: 'No ffmpeg found. Install ffmpeg on PATH or set LYME_FFMPEG_PATH.' }
      const bothHaveAudio =
        probeMediaInfo(ffmpeg.path, pathA).hasAudio && probeMediaInfo(ffmpeg.path, pathB).hasAudio
      const out = join(workDir(), `${randomUUID()}.mp4`)
      return runFfmpeg(buildStitchArgs(pathA, pathB, out, { bothHaveAudio }), out)
    }
    case 'overlay-image': {
      const out = join(workDir(), `${randomUUID()}.mp4`)
      return runFfmpeg(buildOverlayImageArgs(pathA, pathB, out), out)
    }
    case 'score-video': {
      const ffmpeg = resolveFfmpeg()
      if (!ffmpeg) return { ok: false, error: 'No ffmpeg found. Install ffmpeg on PATH or set LYME_FFMPEG_PATH.' }
      const videoHasAudio = probeMediaInfo(ffmpeg.path, pathA).hasAudio
      const out = join(workDir(), `${randomUUID()}.mp4`)
      return runFfmpeg(buildScoreArgs(pathA, pathB, out, { videoHasAudio }), out)
    }
    case 'mix-audio': {
      const out = join(workDir(), `${randomUUID()}.mp3`)
      return runFfmpeg(buildMixAudioArgs(pathA, pathB, out), out)
    }
  }
}
