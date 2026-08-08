import { BrowserWindow, app } from 'electron'
import { runAgentPrompt } from './agent'
import { deleteSecret, readSecretValue, storeSecret } from './credential-vault'
import { requestSecret } from './secure-credential'
import { loadState, saveState } from './sessions-store'

/**
 * Headless plumbing check for everything the renderer can't see from a plain
 * browser: DPAPI vault, sessions persistence, secure-modal boot, agent link.
 * Run with LYME_SELFTEST=1 — logs [selftest] lines and exits non-zero on failure.
 */
export async function runSelfTest(mainWindow: BrowserWindow): Promise<void> {
  const log = (line: string): void => console.log(`[selftest] ${line}`)
  let failures = 0
  const fail = (line: string): void => {
    failures += 1
    log(`FAIL — ${line}`)
  }

  // 1. Credential vault round-trip on real safeStorage/DPAPI
  try {
    const value = `sk-selftest-${Date.now().toString(36)}-abcd1234`
    const report = storeSecret('selftest-connector', 'API key', value)
    const roundTrip = readSecretValue('selftest-connector')
    deleteSecret('selftest-connector')
    if (
      roundTrip === value &&
      report.length === value.length &&
      report.last4 === value.slice(-4)
    ) {
      log(`vault: PASS (encrypt/decrypt round-trip, report …${report.last4})`)
    } else {
      fail('vault: round-trip or report mismatch')
    }
  } catch (error) {
    fail(`vault: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 2. Sessions persistence round-trip (restores the user's real state after)
  try {
    const original = loadState()
    const probe = {
      sessions: [
        {
          id: 'selftest-session',
          name: 'Self Test',
          createdAt: new Date().toISOString(),
          nodes: [],
          cutRoom: [],
          view: 'canvas' as const
        }
      ],
      activeSessionId: 'selftest-session'
    }
    saveState(probe)
    const readBack = loadState()
    saveState(original)
    if (readBack.sessions[0]?.id === 'selftest-session') {
      log('sessions: PASS (save/load round-trip)')
    } else {
      fail('sessions: read-back mismatch')
    }
  } catch (error) {
    fail(`sessions: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 3. Secure-credential modal boots and resolves null when dismissed
  try {
    const pendingReport = requestSecret(mainWindow, {
      connectorId: 'selftest-modal',
      connectorName: 'Self Test',
      fieldLabel: 'API key'
    })
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const modal = BrowserWindow.getAllWindows().find((w) => w !== mainWindow)
    if (!modal) {
      fail('secure modal: window never appeared')
    } else {
      modal.close()
      const report = await pendingReport
      if (report === null) {
        log('secure modal: PASS (boots, dismiss resolves null, nothing stored)')
      } else {
        fail('secure modal: dismissal unexpectedly produced a report')
      }
    }
  } catch (error) {
    fail(`secure modal: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 4. Agent link through the real main-process service
  try {
    const result = await runAgentPrompt('Reply with exactly: LINK OK', () => {})
    if (result.ok && result.text.includes('LINK OK')) {
      log(
        `agent: PASS ("${result.text.trim()}", $${result.costUsd?.toFixed(4) ?? '?'}, ${result.durationMs}ms)`
      )
    } else {
      fail(`agent: ${result.error ?? `unexpected reply "${result.text}"`}`)
    }
  } catch (error) {
    fail(`agent: ${error instanceof Error ? error.message : String(error)}`)
  }

  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
  app.exit(failures === 0 ? 0 : 1)
}
