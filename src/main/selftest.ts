import { existsSync } from 'node:fs'
import { BrowserWindow, app, net } from 'electron'
import { runAgentPrompt } from './agent'
import { hasChatRealtyToken, pullListingPhotos } from './chatrealty'
import {
  CLAUDE_API_KEY_CREDENTIAL_ID,
  CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID,
  claudeAuthOverrideKind
} from './claude-auth'
import { deleteConnector, listConnectors, saveConnector } from './connectors-store'
import {
  deleteModelProvider,
  listModelProviders,
  resolveActiveProvider,
  saveModelProvider,
  setActiveModelProvider
} from './model-providers'
import { deleteSecret, readSecretValue, storeSecret } from './credential-vault'
import { probeStdioMcp } from './mcp-probe'
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

  // 1b. Short secrets must not disclose their tail in the report
  try {
    const shortReport = storeSecret('selftest-short', 'PIN', 'abc')
    const decrypts = readSecretValue('selftest-short') === 'abc'
    deleteSecret('selftest-short')
    if (shortReport.last4 === '' && shortReport.length === 3 && decrypts) {
      log('vault short-secret: PASS (tail suppressed, value still recoverable)')
    } else {
      fail(`vault short-secret: last4 leaked "${shortReport.last4}"`)
    }
  } catch (error) {
    fail(`vault short-secret: ${error instanceof Error ? error.message : String(error)}`)
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

  // 5. ChatRealty MCP transport (dev-machine probe). Proves Lyme Hype can spawn
  //    and speak MCP to the ChatRealty stdio server; auth needs a real hosted
  //    crt_live_ token (entered via the vault), so whoami is expected to error
  //    here — the pass condition is the handshake + tool discovery.
  const chatRealtyServer =
    'F:\\web-clients\\joseph-sardella\\jpsrealtor\\packages\\mcp-server\\dist\\index.js'
  if (!existsSync(chatRealtyServer)) {
    log('chatrealty transport: SKIP (jpsrealtor mcp-server dist not present)')
  } else {
    try {
      const probe = await probeStdioMcp(
        {
          command: 'node',
          args: [chatRealtyServer],
          env: {
            CHATREALTY_API_TOKEN: 'crt_live_selftest_dummy_token_shape_only',
            CHATREALTY_API_BASE: 'https://jpsrealtor.com'
          }
        },
        { name: 'whoami' }
      )
      const hasPhotos = probe.tools.some((t) => t.name === 'get_listing_photos')
      if (probe.ok && hasPhotos) {
        log(
          `chatrealty transport: PASS (${probe.serverInfo?.name}@${probe.serverInfo?.version}, ${probe.tools.length} tools, get_listing_photos present; auth=${
            probe.verify?.isError ? 'needs real token' : 'ok'
          })`
        )
      } else {
        fail(`chatrealty transport: ${probe.error ?? 'handshake ok but get_listing_photos missing'}`)
      }
    } catch (error) {
      fail(`chatrealty transport: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 6. ChatRealty live pull — the Phase 3 headline. Needs a real hosted token
  //    (vault or dev .env.local); skips cleanly when none is configured.
  if (!hasChatRealtyToken()) {
    log('chatrealty pull: SKIP (no token configured)')
  } else {
    try {
      const result = await pullListingPhotos('')
      if (result.ok && result.images.length > 0) {
        log(
          `chatrealty pull: PASS (${result.images.length} real photos as assets, top listing "${result.listings[0]?.address ?? '?'}")`
        )
        // Confirm the custom protocol actually serves a pulled asset — this is
        // what makes <img src="lyme-asset://…"> render in the renderer.
        const served = await net.fetch(result.images[0].src)
        const bytes = served.ok ? (await served.arrayBuffer()).byteLength : 0
        if (served.ok && bytes > 0) {
          log(`asset protocol: PASS (served ${result.images[0].src.split('/').pop()}, ${bytes} bytes)`)
        } else {
          fail(`asset protocol: served status ${served.status}, ${bytes} bytes`)
        }
      } else {
        fail(`chatrealty pull: ${result.error ?? 'no images returned'}`)
      }
    } catch (error) {
      fail(`chatrealty pull: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 7. Generic connector store: ChatRealty is a built-in template, and a custom
  //    connector round-trips through save/list/delete.
  try {
    const withBuiltin = listConnectors()
    const chatRealty = withBuiltin.find((c) => c.id === 'chatrealty')
    saveConnector({
      id: 'selftest-conn',
      name: 'Self Test Connector',
      kind: 'stdio',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      authType: 'apiKey',
      secretKey: 'X_TOKEN',
      secretFieldLabel: 'API key'
    })
    const added = listConnectors().some((c) => c.id === 'selftest-conn')
    deleteConnector('selftest-conn')
    const removed = !listConnectors().some((c) => c.id === 'selftest-conn')
    if (chatRealty?.builtin && added && removed) {
      log(
        `connectors: PASS (ChatRealty built-in present [credential=${chatRealty.hasCredential}], custom save/delete round-trip)`
      )
    } else {
      fail(`connectors: builtin=${!!chatRealty?.builtin} added=${added} removed=${removed}`)
    }
  } catch (error) {
    fail(`connectors: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 8. Claude auth override resolution — default is 'none' (this machine's own
  //    Claude Code login, what the agent test above actually used). Storing an
  //    override flips the kind; removing it restores the default. Oauth-token
  //    takes priority over api-key when both are set. Doesn't call Anthropic —
  //    just verifies the resolve plumbing.
  try {
    const before = claudeAuthOverrideKind()
    storeSecret(CLAUDE_API_KEY_CREDENTIAL_ID, 'Anthropic API key', 'sk-ant-selftest-dummy')
    const withApiKey = claudeAuthOverrideKind()
    storeSecret(CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID, 'Setup-token', 'selftest-oauth-token-dummy')
    const withBoth = claudeAuthOverrideKind()
    deleteSecret(CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID)
    deleteSecret(CLAUDE_API_KEY_CREDENTIAL_ID)
    const after = claudeAuthOverrideKind()
    if (before === 'none' && withApiKey === 'apiKey' && withBoth === 'oauthToken' && after === 'none') {
      log('claude auth: PASS (default = local Claude Code login; override toggles correctly; oauth-token takes priority)')
    } else {
      fail(`claude auth: before=${before} withApiKey=${withApiKey} withBoth=${withBoth} after=${after}`)
    }
  } catch (error) {
    fail(`claude auth: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 9. Model providers — Claude default is present+active by default; a custom
  //    Anthropic-compatible provider round-trips and can be made active, which
  //    resolveActiveProvider reflects. Restores the default afterward.
  try {
    const initial = listModelProviders()
    const claudeDefault = initial.find((p) => p.id === 'claude-default')
    const kimi = initial.find((p) => p.id === 'kimi')
    saveModelProvider({
      id: 'selftest-provider',
      name: 'Self Test Provider',
      kind: 'anthropic-compatible',
      baseUrl: 'http://localhost:9999',
      model: 'test-model',
      secretFieldLabel: 'API key'
    })
    storeSecret('selftest-provider', 'API key', 'sk-provider-dummy')
    setActiveModelProvider('selftest-provider')
    const resolved = resolveActiveProvider()
    const activeIsCustom = resolved.def.id === 'selftest-provider' && resolved.key === 'sk-provider-dummy'
    setActiveModelProvider('claude-default')
    deleteSecret('selftest-provider')
    deleteModelProvider('selftest-provider')
    const restored = resolveActiveProvider().def.id === 'claude-default'
    if (claudeDefault?.active && kimi?.builtin && activeIsCustom && restored) {
      log('model providers: PASS (Claude default active; Kimi template present; custom provider activates + resolves; restored)')
    } else {
      fail(
        `model providers: default-active=${!!claudeDefault?.active} kimi=${!!kimi?.builtin} activeCustom=${activeIsCustom} restored=${restored}`
      )
    }
  } catch (error) {
    fail(`model providers: ${error instanceof Error ? error.message : String(error)}`)
  }

  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
  app.exit(failures === 0 ? 0 : 1)
}
