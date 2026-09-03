import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetPathForUrl } from '../asset-store'
import { resolveFfmpeg } from '../ffmpeg'

/**
 * Shared plumbing for the per-feature test scripts (`*_test.ts` in this
 * folder). These are LIVE tests: unlike selftest.ts (plumbing only, no billed
 * calls), a feature test drives the real generation path against whatever
 * connectors are installed and credentialed, and the connector bills on its
 * own account. Each test logs what it's about to spend before it fires.
 *
 * Run with `LYME_TEST=<feature>[,<feature>...]` or `LYME_TEST=all`:
 *   LYME_TEST=image npm run dev
 */

export class TestRun {
  passes = 0
  failures = 0
  skips = 0

  constructor(private feature: string) {}

  log(line: string): void {
    console.log(`[test:${this.feature}] ${line}`)
  }

  pass(name: string, detail?: string): void {
    this.passes += 1
    this.log(`PASS — ${name}${detail ? ` (${detail})` : ''}`)
  }

  fail(name: string, detail: string): void {
    this.failures += 1
    this.log(`FAIL — ${name}: ${detail}`)
  }

  skip(name: string, reason: string): void {
    this.skips += 1
    this.log(`SKIP — ${name}: ${reason}`)
  }

  /** Machine-readable produced-file line. The generation skills (.claude/skills)
   *  drive these tests headless and grep for `OUTPUT — ` to find the file to
   *  hand back to the user, so keep this format stable. */
  output(src: string): void {
    const onDisk = src.startsWith('lyme-asset://') ? assetPathForUrl(src) : src
    this.log(`OUTPUT — ${onDisk ?? src}`)
  }
}

export function testWorkDir(): string {
  const dir = join(tmpdir(), 'lyme-hype-feature-tests')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Trimmed env var, or undefined when unset/blank — tests use these for
 *  opt-in extras (LYME_TEST_FRAMES=1) and for inputs that must be real media
 *  (LYME_TEST_FACE_VIDEO=<path>). */
export function envVar(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export interface SynthClipOptions {
  seconds?: number
  color?: string
  withAudio?: boolean
  /** Draw a white box on the solid background — gives colorkey something to keep. */
  drawBox?: boolean
}

/** Solid-color test clip via lavfi — free, local, no connector. Returns null
 *  (caller skips) when no ffmpeg binary is on this machine. */
export function synthClip(name: string, opts?: SynthClipOptions): string | null {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return null
  const out = join(testWorkDir(), name)
  const seconds = opts?.seconds ?? 3
  const color = opts?.color ?? 'black'
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=${seconds}`]
  if (opts?.withAudio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'aac', '-shortest')
  }
  if (opts?.drawBox) {
    args.push('-vf', 'drawbox=x=220:y=100:w=200:h=160:color=white:t=fill')
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', out)
  const res = spawnSync(ffmpeg.path, args, { timeout: 60_000 })
  return res.status === 0 && existsSync(out) ? out : null
}

/** Single solid-color PNG frame — the Motion graphics wizard's "locally-drawn
 *  solid start frame" shape, reused here for frame-conditioning and reference
 *  inputs. */
export function synthFrame(name: string, color: string, size = '1080x1920'): string | null {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return null
  const out = join(testWorkDir(), name)
  const res = spawnSync(
    ffmpeg.path,
    ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=1`, '-frames:v', '1', out],
    { timeout: 60_000 }
  )
  return res.status === 0 && existsSync(out) ? out : null
}
