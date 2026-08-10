import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, net } from 'electron'
import { runAgentPrompt } from './agent'
import { hasChatRealtyToken, pullListingPhotos } from './chatrealty'
import { runConversationTurn } from './conversations'
import {
  CLAUDE_API_KEY_CREDENTIAL_ID,
  CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID,
  claudeAuthOverrideKind
} from './claude-auth'
import { deleteConnector, installedConnectorIds, listConnectors, saveConnector } from './connectors-store'
import { addSuggestion, listSuggestions } from './connector-suggestions'
import {
  deleteModelProvider,
  listModelProviders,
  resolveActiveProvider,
  saveModelProvider,
  setActiveModelProvider
} from './model-providers'
import { deleteSecret, readSecretValue, storeSecret } from './credential-vault'
import { buildMultitrackArgs, resolveFfmpeg } from './ffmpeg'
import { buildAlphaKeyArgs, buildIsolateAudioArgs } from './media-tools'
import { extractFilePath } from './elevenlabs-tools'
import { runGeneration } from './generation'
import { listProjects, migrateSessionsToProjects, workspaceRoot } from './project-store'
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
          timeline: { tracks: [], clips: [] },
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

  // 4b. Multi-turn conversation plumbing (Phase 11) — a REAL two-turn exchange
  //     proving `resume` carries context: turn 1 plants a word, turn 2 resumes
  //     and must recall it. Costs about two agent pings.
  try {
    const first = await runConversationTurn({
      conversationId: 'selftest-conv',
      prompt: 'Remember the word "kumquat". Reply with exactly: NOTED'
    })
    if (!first.ok || !first.agentSessionId) {
      fail(`conversation turn 1: ${first.error ?? 'no session id captured'}`)
    } else {
      // Deliberately NO history here: passing it would let the transcript-
      // replay fallback also answer "kumquat", and the assertion could no
      // longer distinguish real resume from replay.
      const second = await runConversationTurn({
        conversationId: 'selftest-conv',
        resumeSessionId: first.agentSessionId,
        prompt: 'What word did I ask you to remember? Reply with only that word.'
      })
      if (second.ok && /kumquat/i.test(second.text)) {
        log(
          `conversations: PASS (resume carried context across turns, "${second.text.trim().slice(0, 30)}", $${((first.costUsd ?? 0) + (second.costUsd ?? 0)).toFixed(4)})`
        )
      } else {
        fail(`conversations: ${second.error ?? `resume lost context ("${second.text.trim().slice(0, 60)}")`}`)
      }
    }
  } catch (error) {
    fail(`conversations: ${error instanceof Error ? error.message : String(error)}`)
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

  // 7. Connectors: installed list is user-only + all removable; the suggestions
  //    catalog carries the known tools; add-from-suggestion installs one.
  try {
    const suggestions = listSuggestions(installedConnectorIds())
    const hasMuapi = suggestions.some((s) => s.id === 'muapi' && s.available)
    // Krea is now an available http connector (http-MCP transport landed).
    const hasKrea = suggestions.some((s) => s.id === 'krea' && s.available)
    // Gemini (bundled stdio wrapper) and Yapper (MCP OAuth) are now installable too.
    const hasGemini = suggestions.some((s) => s.id === 'gemini' && s.available)
    const hasYapper = suggestions.some((s) => s.id === 'yapper' && s.available)
    // OpenAI Images — the second bundled wrapper (storyboard-tier image).
    const hasOpenai = suggestions.some((s) => s.id === 'openai' && s.available)
    // Custom connector round-trip (all removable now).
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
    const added = listConnectors().some((c) => c.id === 'selftest-conn' && !c.builtin)
    deleteConnector('selftest-conn')
    const removed = !listConnectors().some((c) => c.id === 'selftest-conn')
    // Add-from-suggestion round-trips — ONLY on ids not already installed:
    // deleting a real install's def (while its key stayed in the vault) is
    // exactly the split the reconcile path now heals, and this test used to
    // cause it. An already-installed id passes by existence.
    const preInstalled = new Set(installedConnectorIds())
    let installedDefOk: boolean
    let muapiInstalled: boolean
    if (preInstalled.has('muapi')) {
      installedDefOk = true
      muapiInstalled = true
    } else {
      const installedDef = addSuggestion('muapi')
      installedDefOk = installedDef?.id === 'muapi'
      muapiInstalled = listConnectors().some((c) => c.id === 'muapi')
      deleteConnector('muapi')
    }
    let kreaHttp: boolean
    if (preInstalled.has('krea')) {
      kreaHttp = listConnectors().some((c) => c.id === 'krea' && c.kind === 'http' && !!c.url)
    } else {
      const kreaDef = addSuggestion('krea')
      kreaHttp = kreaDef?.kind === 'http' && !!kreaDef.url
      deleteConnector('krea')
    }
    if (
      hasMuapi &&
      hasKrea &&
      hasGemini &&
      hasYapper &&
      hasOpenai &&
      kreaHttp &&
      added &&
      removed &&
      installedDefOk &&
      muapiInstalled
    ) {
      log(
        `connectors: PASS (${suggestions.length} suggestions, all installable; add-from-suggestion verified without touching real installs)`
      )
    } else {
      fail(
        `connectors: muapi=${hasMuapi} krea=${hasKrea} gemini=${hasGemini} yapper=${hasYapper} openai=${hasOpenai} kreaHttp=${kreaHttp} added=${added} removed=${removed} installedDefOk=${installedDefOk} muapiInstalled=${muapiInstalled}`
      )
    }
  } catch (error) {
    fail(`connectors: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 7b. Bundled wrapper protocol smoke tests — spawn each owned stdio wrapper
  //     with a dummy key, handshake, and list tools. Proves the MCP framing and
  //     tool surface without any billed API call (dummy keys never reach a
  //     network request in initialize/tools-list).
  const wrappers: { file: string; env: Record<string, string>; tool: string }[] = [
    { file: 'gemini-mcp.cjs', env: { GEMINI_API_KEY: 'selftest-dummy' }, tool: 'gemini_generate_image' },
    { file: 'openai-image-mcp.cjs', env: { OPENAI_API_KEY: 'selftest-dummy' }, tool: 'openai_generate_image' }
  ]
  for (const wrapper of wrappers) {
    try {
      const probe = await probeStdioMcp({
        command: 'node',
        args: [join(app.getAppPath(), 'resources', wrapper.file)],
        env: wrapper.env
      })
      const hasTool = probe.tools.some((t) => t.name === wrapper.tool)
      if (probe.ok && hasTool) {
        log(`wrapper ${wrapper.file}: PASS (${probe.serverInfo?.name}, ${probe.tools.length} tool(s), ${wrapper.tool} present)`)
      } else {
        fail(`wrapper ${wrapper.file}: ${probe.error ?? `handshake ok but ${wrapper.tool} missing`}`)
      }
    } catch (error) {
      fail(`wrapper ${wrapper.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
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

  // 10. Generation wiring — DELIBERATELY only the empty-prompt guard, which
  //     returns before touching any connector or the agent. Passing a real
  //     prompt here would fire a live (billed) generation on whatever connector
  //     the user has installed, so the self-test never does that.
  try {
    const guarded = await runGeneration({ mediaType: 'video', prompt: '   ' })
    if (!guarded.ok && /prompt/i.test(guarded.error ?? '')) {
      log('generation wiring: PASS (module loads; empty-prompt guard returns before any live call)')
    } else {
      fail(`generation wiring: guard did not fire (ok=${guarded.ok}, error=${guarded.error})`)
    }
  } catch (error) {
    fail(`generation wiring: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 11. ffmpeg export — verify the pure multitrack builder (no ffmpeg executed)
  //     against the timeline.md done-criteria scenario: two clips at different
  //     positions on the base video track, an overlay clip above during part of
  //     that span, voice + music on two audio tracks, one muted audio track
  //     whose clip must vanish, and an embedded-audio mute. Solo can't leak by
  //     construction — ResolvedTimelineClip carries no solo field.
  try {
    const base = { trackType: 'video' as const, trackOrder: 0, trackMuted: false }
    const overlay = { trackType: 'video' as const, trackOrder: 1, trackMuted: false }
    const voice = { trackType: 'audio' as const, trackOrder: 0, trackMuted: false }
    const mutedMusic = { trackType: 'audio' as const, trackOrder: 1, trackMuted: true }
    const args = buildMultitrackArgs(
      [
        { path: 'a.mp4', mediaType: 'video', ...base, startTime: 0, trimIn: 1, trimOut: 4, audioMuted: true, hasAudio: true },
        { path: 'b.mp4', mediaType: 'video', ...base, startTime: 4, trimIn: 0, trimOut: 6, hasAudio: true },
        // No hasAudio — a Motion-graphics overlay with no audio stream must
        // stay out of the mix instead of referencing a missing [i:a]. The
        // inputDecoder forces libvpx-vp9 so the alpha plane survives decode.
        { path: 'gfx.webm', mediaType: 'video', ...overlay, startTime: 2, trimIn: 0, trimOut: 3, inputDecoder: 'libvpx-vp9' },
        { path: 'still.png', mediaType: 'image', ...overlay, startTime: 6, trimIn: 0, trimOut: 2 },
        { path: 'wm.gif', mediaType: 'image', ...overlay, startTime: 0, trimIn: 0, trimOut: 1 },
        { path: 'vo.mp3', mediaType: 'audio', ...voice, startTime: 0.5, trimIn: 0, trimOut: 8 },
        { path: 'music.mp3', mediaType: 'audio', ...mutedMusic, startTime: 0, trimIn: 0, trimOut: 10 }
      ],
      'out.mp4'
    )
    const s = args.join(' ')
    const wellFormed =
      // Muted track's clip contributes no input at all.
      !s.includes('music.mp3') &&
      args.filter((a) => a === '-i').length === 6 &&
      // Canvas + per-clip overlays with enable windows at real positions.
      s.includes('color=black:s=1080x1920') &&
      (s.match(/overlay=/g) ?? []).length === 5 &&
      s.includes("enable='between(t,4,10)'") &&
      s.includes("enable='between(t,2,5)'") &&
      // Base clips pad to the full canvas; overlay clips center instead.
      s.includes('pad=1080:1920') &&
      s.includes('overlay=(W-w)/2:(H-h)/2') &&
      // Image stills loop for their placed duration; gifs use -stream_loop
      // (the gif demuxer rejects image2's -loop option).
      s.includes('-loop 1 -t 2 -i still.png') &&
      s.includes('-stream_loop -1 -t 1 -i wm.gif') &&
      // VP9-alpha overlays force the libvpx decoder so alpha survives.
      s.includes('-c:v libvpx-vp9 -i gfx.webm') &&
      // Audio: voice delayed to position; a.mp4's embedded track is audioMuted
      // and b.mp4's embedded track mixes with the voice via amix.
      s.includes('adelay=500|500') &&
      s.includes('amix=inputs=2') &&
      !s.includes('[0:a]') &&
      s.includes('libx264') &&
      args[args.length - 1] === 'out.mp4'
    // Duration caps at the furthest clip end (base b.mp4 ends at 10).
    const durationCapped = s.includes('-t 10')
    let discovery = 'threw'
    try {
      const r = resolveFfmpeg()
      discovery = r ? `found (${r.source})` : 'none (unbundled)'
    } catch {
      discovery = 'threw'
    }
    if (wellFormed && durationCapped && discovery !== 'threw') {
      log(`ffmpeg export: PASS (multitrack overlay+amix graph well-formed; discovery: ${discovery})`)
    } else {
      fail(`ffmpeg export: wellFormed=${wellFormed} durationCapped=${durationCapped} discovery=${discovery}`)
    }
  } catch (error) {
    fail(`ffmpeg export: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 12. Local media tools (Phase 13) — pure arg builders for the two
  //     Create-panel ffmpeg jobs, plus the ElevenLabs reply-path parser. The
  //     exact commands were executed for real against the machine's ffmpeg
  //     during the build (audio extracted; VP9 webm with alpha_mode=1).
  try {
    const iso = buildIsolateAudioArgs('in.mp4', 'out.mp3').join(' ')
    const key = buildAlphaKeyArgs('in.mp4', 'out.webm').join(' ')
    const isoOk = iso.includes('-vn') && iso.includes('libmp3lame') && iso.endsWith('out.mp3')
    const keyOk =
      key.includes('colorkey=black:0.15:0.08') &&
      key.includes('format=yuva420p') &&
      key.includes('libvpx-vp9') &&
      key.endsWith('out.webm')
    const winPath = extractFilePath('Success. File saved as: C:\\tmp\\lyme\\voice.mp3. Voice used: Rachel')
    const nixPath = extractFilePath('Audio written to /tmp/lyme/sfx.wav today')
    const parseOk = winPath === 'C:\\tmp\\lyme\\voice.mp3' && nixPath === '/tmp/lyme/sfx.wav'
    if (isoOk && keyOk && parseOk) {
      log('media tools: PASS (isolate + alpha-key args well-formed; ElevenLabs path parser handles win/nix)')
    } else {
      fail(`media tools: iso=${isoOk} key=${keyOk} parse=${parseOk} (win="${winPath}" nix="${nixPath}")`)
    }
  } catch (error) {
    fail(`media tools: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 12b. PROJECTS — the folder layout and the one-way migration off the flat
  //      userData/assets store. Gated because it writes real folders into the
  //      user's Documents; LYME_SELFTEST=1 alone stays read-only.
  if (process.env['LYME_MIGRATE']) {
    try {
      const before = listProjects().length
      const result = migrateSessionsToProjects()
      const after = listProjects()
      log(
        `projects: root=${workspaceRoot()} · before=${before} · migrated=${result.migrated} · assets moved=${result.assetsMoved} · recovered=${result.recovered}${result.skipped ? ' (SKIPPED — already migrated)' : ''}`
      )
      for (const p of after) {
        log(
          `  project "${p.name}" -> ${p.folder} (${p.nodeCount} nodes, ${p.assetCount} assets, ${(p.assetBytes / 1048576).toFixed(1)} MB)`
        )
      }
    } catch (error) {
      fail(`projects: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 13. LIVE GENERATION — off by default and never part of the plumbing run, because
  //     every case here spends real money on the user's connector accounts. Gated on its
  //     own env var so LYME_SELFTEST=1 can stay free forever (AGENTS.md §0: live billed
  //     verification is joint-session work, not something a routine or CI does).
  if (process.env['LYME_LIVEGEN']) {
    const only = process.env['LYME_LIVEGEN'].toLowerCase()
    const wants = (kind: string): boolean => only === '1' || only.includes(kind)
    const installed = installedConnectorIds()
    log(`LIVE GENERATION requested (${only}) — installed: ${installed.join(', ') || 'none'}`)

    const cases: { kind: string; label: string; params: Parameters<typeof runGeneration>[0] }[] = [
      {
        kind: 'image',
        label: 'image · muapi flux-dev',
        params: {
          mediaType: 'image',
          prompt: 'a quarter lime wedge on black slate, studio rim light, macro, high contrast',
          aspectRatio: '1:1',
          connectorId: 'muapi',
          modelHint: 'flux-dev'
        }
      },
      {
        kind: 'image',
        label: 'image · muapi flux-schnell (second take)',
        params: {
          mediaType: 'image',
          prompt: 'citrus-slice vinyl record spinning in fog, neon green key light',
          aspectRatio: '1:1',
          connectorId: 'muapi',
          modelHint: 'flux-schnell'
        }
      },
      {
        kind: 'audio',
        label: 'audio · elevenlabs tts',
        params: {
          mediaType: 'audio',
          prompt: 'The lyme does not lie. It just does not care.',
          connectorId: 'elevenlabs'
        }
      },
      {
        kind: 'video',
        label: 'video · muapi',
        params: {
          mediaType: 'video',
          prompt: 'slow push in on a lime wedge resting on black slate, volumetric fog',
          aspectRatio: '9:16',
          durationSec: 5,
          connectorId: 'muapi'
        }
      }
    ]

    for (const c of cases) {
      if (!wants(c.kind)) continue
      if (!installed.includes(c.params.connectorId ?? '')) {
        log(`live ${c.label}: SKIP — ${c.params.connectorId} not installed`)
        continue
      }
      const started = Date.now()
      try {
        const result = await runGeneration(c.params)
        const secs = Math.round((Date.now() - started) / 1000)
        if (result.ok && result.src) log(`live ${c.label}: PASS in ${secs}s -> ${result.src}`)
        else fail(`live ${c.label}: ${result.error ?? 'no src returned'} (${secs}s)`)
      } catch (error) {
        fail(`live ${c.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
  app.exit(failures === 0 ? 0 : 1)
}
