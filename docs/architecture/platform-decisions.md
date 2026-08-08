# Platform decisions

## Desktop shell: Electron (decided)

- TypeScript throughout, one codebase for Windows + Mac (electron-builder handles packaging for both).
- The Claude Agent SDK is a Node.js SDK — Electron's main process already runs Node, so the agent runs in-process with full filesystem/child-process access (spawning ffmpeg, calling generation APIs, etc.) with no sidecar needed.
- Alternative considered: Tauri (Rust core, smaller/lighter binaries) — ruled out for now. The Agent SDK would have to run as a bundled Node sidecar process instead of natively, which adds packaging complexity for no clear win at this stage.
- **Build order:** Windows first — that's the primary dev machine. Mac packaging, code-signing (Apple notarization), and testing happen later on Joseph's MacBook, once the Windows build is solid. Resolves the earlier concern about cross-compiling a signed Mac build from Windows — we just build the Mac target on an actual Mac when we get there.
- **The app is an MCP client.** The Claude Agent SDK running in the main process is natively an MCP client — same model as Claude Desktop and Claude Code. Generation tools (muapi, ElevenLabs, Gemini, image-gen) and data tools (ChatRealty) all attach the same way, as user-added connections, not bespoke per-provider integrations we build and maintain. See [../ui/canvas-and-storyboard.md](../ui/canvas-and-storyboard.md#connections-mcp--this-changes-generate) for what this means for the canvas.
- **Credentials never pass through the agent.** Connector setup can use the agent to drive a real browser (Electron already is Chromium — no dependency on Anthropic's "Claude in Chrome" extension) to help a user reach a signup page or API-keys screen, but the actual secret is always typed into a native modal `BrowserWindow` that reports only field name/length/last-4 back to the agent, and stores the real value via Electron's `safeStorage` (OS keychain/DPAPI) — never a plaintext file, never agent-observable state. Full reasoning and open questions in [../connectors/model.md](../connectors/model.md).

## Implementation notes (Phase 1)

Written down when the scaffold was actually built (2026-08-08), because each of these was a real decision:

- **Stack: electron-vite 2.3 / Vite 5 / React 18 / Electron 38 / TypeScript strict.** The dev machine's nvm has Node 21.6.2 (and 18), and Vite 6/7 refuse Node 21 — so electron-vite 2.x + Vite 5 is the newest combination that runs here. Electron itself bundles its own Node 22, so the host Node only runs the build tooling. Upgrading the Vite line is a when-Node-gets-upgraded chore, not urgent.
- **Agent SDK auth rides the machine's Claude Code login.** `@anthropic-ai/claude-agent-sdk` spawns its bundled CLI, which uses the same stored OAuth credentials Claude Code uses — no `ANTHROPIC_API_KEY` anywhere. Verified working. Two consequences: (a) dev requires a machine where Claude Code is signed in; (b) distributing to users who don't run Claude Code needs its own auth story — parked as an open question below.
- **The SDK spawns `node` from PATH.** Fine in dev; packaging (Phase 9) must either bundle a Node runtime or use `ELECTRON_RUN_AS_NODE` so the spawned CLI has something to run on.
- **The SDK is ESM-only; the Electron main bundle is CJS.** Loaded via dynamic `import()` (rollup preserves it) — don't convert to a static import without switching the whole main process to ESM.
- **Self-test mode:** `LYME_SELFTEST=1 npm run dev` boots the app, checks vault encrypt/decrypt (real DPAPI), short-secret tail suppression, sessions persistence, secure-modal boot/dismiss, a live agent call, the full connector catalog, and the ffmpeg export command builder, then exits — the headless check for everything a browser preview can't reach.
- **Navigation is locked to the app's own documents.** An app-level `web-contents-created` guard `preventDefault`s any `will-navigate`/`will-redirect` that isn't the dev-server URL or a `file://` (the app's own pages), and a deny-all window-open handler routes external `http(s)` links to the OS browser instead of ever opening an Electron window that carries the preload. The renderer and the secure modal also `preventDefault` drag-drop. Reason: a dropped file/link would otherwise navigate a privileged window and hand `window.lyme` / `secureBridge` (including the credential flow) to foreign content. This came out of the Phase 1–2 adversarial review, not a hypothetical.

## Premiere Pro integration: UXP, not CEP

Adobe is mid-migration away from CEP (the old Node+Chromium plugin platform) to UXP (Unified Extensibility Platform):

- With Premiere Pro 2026, UXP is the standard, supported plugin platform. CEP is being phased out — ExtendScript support is only guaranteed through September 2026, and Premiere Pro 2026 no longer natively loads CEP extensions without migration.
- UXP plugins ship official TypeScript declarations (`@adobe/premierepro` package) — fits our TypeScript-everywhere goal directly.
- Timeline manipulation (placing clips into a sequence) has landed in UXP — this is the specific capability "transition sequences to Premiere Pro" depends on, and it's been available for a few months as of this writing. UXP is approaching but hasn't fully reached 1:1 parity with the old ExtendScript API, so expect some gaps if we ever need something obscure.
- Building on CEP now would mean building on a platform Adobe is actively sunsetting, despite CEP having more history/examples online.

## The bridge problem

A UXP plugin runs inside Premiere Pro's own process — it is **not** part of our Electron app. It's a separate JS/HTML/CSS runtime that Adobe hosts. So "generate in Lyme Hype Studio, then transition to Premiere" means two separate codebases that need to talk to each other:

- Likely shape: Lyme Hype (the Electron app) runs a small local server (HTTP or WebSocket) on a fixed port. The UXP plugin panel, sitting inside Premiere, connects to that local server to pull the list of generated clips/sequences and trigger the import + timeline placement.
- Both sides are JS-capable (UXP plugins can `fetch` / use `WebSocket`), so this is a normal local-loopback integration, not an exotic one — but it does mean two build targets, and two things running during a session (Lyme Hype + Premiere with our panel installed).

## ffmpeg dependency (Cut Room + Play + subtitles)

ffmpeg is the shared engine behind the timeline's export, Play view's playback/non-destructive cutting, and subtitle burn-in — it's shelled out to as a separate process, never linked into the app.

- **Personal-use today:** the machine's installed ffmpeg (found on PATH by `resolveFfmpeg()` in `src/main/ffmpeg.ts`) is the binary in use. No bundling needed — see `AGENTS.md` §7 for why licensing doesn't gate this until the app is actually distributed to other people.
- **Distribution (Phase 9):** bundle a verified LGPL-only build and switch the export encoder from `libx264` (GPL, absent in LGPL builds) to `openh264`. Full detail in `build-plan.md`'s Phase 9 entry — this doc just states the engine decision, not the packaging mechanics.
- **Subtitles are two different capabilities, not one.** ffmpeg burns/muxes a caption track into a rendered file — it does not generate the caption text itself. Producing the actual subtitles needs a speech-to-text capability, most naturally another MCP connection (a Whisper-based transcription tool, for instance) feeding ffmpeg the timed text, the same connector model as everything else. Don't build a bespoke transcription integration; connect one. Still open — not yet built.

## Open questions

- What's actually still missing from UXP's "approaching 1:1 parity" list right now — worth checking `developer.adobe.com/premiere-pro/uxp/changelog` before we commit to anything the API can't do yet. Not revisited since Phase 1 planning; the Premiere plugin (Phase 8) hasn't started.
- Agent tool-selection with multiple similar connections (e.g. two connected video-gen tools) — the agent just picks, Claude Desktop/Code-style. This is now effectively how `src/main/generation.ts` works when more than one stdio/http connector could serve a request; unconfirmed by an actual multi-connector generation test (deferred to a session with the user — see `build-plan.md`).

## Sources

- [Premiere Pro Scripting Guide](https://ppro-scripting.docsforadobe.dev/)
- [UXP Plugins in Premiere 2026: The CEP Migration Clock Is Ticking](https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/)
- [AdobeDocs/uxp-premiere-pro-samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)
- [Premiere API — UXP for Adobe Premiere](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/)
- [Premiere Pro UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)
- [Premiere Pro UXP Beta](https://hyperbrew.co/blog/premiere-pro-uxp-beta/)
