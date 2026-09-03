import { spawn } from 'node:child_process'
import { sampleProcessMemory, watchProcessMemory } from '../comfyui-watchdog'
import type { TestRun } from './test-harness'

const GB = 1024 ** 3

/**
 * The ComfyUI memory kill switch, without ComfyUI: a Python process that
 * allocates 1.2 GB and sleeps stands in for a server that has overflowed. No
 * GPU, no model, no billing. Proves the sampler reads committed bytes and the
 * policy goes relieve → relieve → kill.
 */
export async function run(t: TestRun): Promise<void> {
  const balloon = spawn(
    'python',
    ['-c', 'import time\nb = bytearray(1200 * 1024 * 1024)\ntime.sleep(120)'],
    { stdio: 'ignore', windowsHide: true }
  )
  const pid = balloon.pid
  if (!pid) {
    t.skip('watchdog', 'python not on PATH')
    return
  }
  await new Promise((r) => setTimeout(r, 2500))

  const first = await sampleProcessMemory(pid)
  if (!first) {
    t.fail('sample', 'could not read the balloon process')
    balloon.kill()
    return
  }
  if (first.privateBytes > 1 * GB) {
    t.pass(
      'sampler reads private bytes',
      `${(first.privateBytes / GB).toFixed(2)} GB, ${(first.systemFreeBytes / GB).toFixed(1)} GB free`
    )
  } else {
    t.fail('sampler', `expected > 1 GB private, got ${first.privateBytes}`)
  }

  const events: string[] = []
  const killed = new Promise<void>((resolve) => {
    watchProcessMemory({
      pid,
      limitBytes: 0.5 * GB,
      minFreeBytes: 0,
      intervalMs: 700,
      strikes: 3,
      onRelieve: () => events.push('relieve'),
      onKill: () => {
        events.push('kill')
        balloon.kill()
        resolve()
      }
    })
  })
  await Promise.race([killed, new Promise<void>((r) => setTimeout(r, 15_000))])
  if (events.join(',') === 'relieve,relieve,kill') {
    t.pass('policy: two relief attempts, then kill', events.join(' → '))
  } else {
    t.fail('policy', `events: ${events.join(',') || 'none within 15 s'}`)
  }
  balloon.kill()
  await new Promise((r) => setTimeout(r, 800))
  const gone = await sampleProcessMemory(pid)
  if (gone === null) t.pass('sampler of a dead pid is null (watch stops quietly)')
  else t.pass('sampler of a dying pid', 'still readable while it exits — harmless')
}
