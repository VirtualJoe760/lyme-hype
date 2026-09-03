import { execFile } from 'node:child_process'
import { freemem } from 'node:os'

/**
 * Memory watchdog for a process the app owns (ComfyUI). Pure policy over a
 * sampler, so it is testable with any process standing in for the real one
 * (utils/comfy_watchdog_test.ts uses a Python balloon).
 *
 * Two triggers, either is enough: the process's own private bytes over the
 * limit, or the machine's free RAM under the floor. The second matters because
 * a job that overflows VRAM spills into RAM in a way the first number lags —
 * and free RAM is what decides whether the whole machine starts paging.
 */

export interface MemorySample {
  /** Committed private bytes — the number that fills the pagefile. The working
   *  set understates it by 3× once the process is paging (43 GB vs 13 GB seen). */
  privateBytes: number
  systemFreeBytes: number
}

export type MemorySampler = (pid: number) => Promise<MemorySample | null>

export interface WatchOptions {
  pid: number
  limitBytes: number
  minFreeBytes: number
  intervalMs: number
  /** Consecutive over-limit samples before onKill; every earlier strike calls
   *  onRelieve (a chance to unload models and come back under). */
  strikes: number
  sample?: MemorySampler
  onSample?: (s: MemorySample) => void
  onRelieve: (s: MemorySample) => void
  onKill: (s: MemorySample) => void
}

export const sampleProcessMemory: MemorySampler = (pid) =>
  new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).PrivateMemorySize64`],
      { windowsHide: true, timeout: 8000 },
      (error, stdout) => {
        const bytes = Number(String(stdout ?? '').trim())
        resolve(
          !error && Number.isFinite(bytes) && bytes > 0
            ? { privateBytes: bytes, systemFreeBytes: freemem() }
            : null
        )
      }
    )
  })

/** Starts sampling; returns the function that stops it. Stops itself on kill. */
export function watchProcessMemory(opts: WatchOptions): () => void {
  const sample = opts.sample ?? sampleProcessMemory
  let over = 0
  let stopped = false
  let busy = false
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = (): void => {
    stopped = true
    if (timer) clearInterval(timer)
    timer = null
  }
  timer = setInterval(() => {
    if (stopped || busy) return
    busy = true
    void sample(opts.pid).then((s) => {
      busy = false
      if (stopped || !s) return
      opts.onSample?.(s)
      const fine = s.privateBytes <= opts.limitBytes && s.systemFreeBytes >= opts.minFreeBytes
      if (fine) {
        over = 0
        return
      }
      over += 1
      if (over >= opts.strikes) {
        stop()
        opts.onKill(s)
      } else {
        opts.onRelieve(s)
      }
    })
  }, opts.intervalMs)
  return stop
}
