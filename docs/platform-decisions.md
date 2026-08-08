# Platform decisions

## Desktop shell: Electron (decided)

- TypeScript throughout, one codebase for Windows + Mac (electron-builder handles packaging for both).
- The Claude Agent SDK is a Node.js SDK — Electron's main process already runs Node, so the agent runs in-process with full filesystem/child-process access (spawning ffmpeg, calling generation APIs, etc.) with no sidecar needed.
- Alternative considered: Tauri (Rust core, smaller/lighter binaries) — ruled out for now. The Agent SDK would have to run as a bundled Node sidecar process instead of natively, which adds packaging complexity for no clear win at this stage.
- **Build order:** Windows first — that's the primary dev machine. Mac packaging, code-signing (Apple notarization), and testing happen later on Joseph's MacBook, once the Windows build is solid. Resolves the earlier concern about cross-compiling a signed Mac build from Windows — we just build the Mac target on an actual Mac when we get there.
- **The app is an MCP client.** The Claude Agent SDK running in the main process is natively an MCP client — same model as Claude Desktop and Claude Code. Generation tools (Seedance, ElevenLabs-style audio, image-gen) and data tools (ChatRealty) all attach the same way, as user-added connections, not bespoke per-provider integrations we build and maintain. See [canvas-node-model.md](canvas-node-model.md#connections-mcp--this-changes-generate) for what this means for the canvas.
- **Credentials never pass through the agent.** Connector setup can use the agent to drive a real browser (Electron already is Chromium — no dependency on Anthropic's "Claude in Chrome" extension) to help a user reach a signup page or API-keys screen, but the actual secret is always typed into a native modal `BrowserWindow` that reports only field name/length/last-4 back to the agent, and stores the real value via Electron's `safeStorage` (OS keychain/DPAPI) — never a plaintext file, never agent-observable state. Full reasoning and open questions in [connections-and-credentials.md](connections-and-credentials.md).

## Implementation notes (Phase 1)

Written down when the scaffold was actually built (2026-08-08), because each of these was a real decision:

- **Stack: electron-vite 2.3 / Vite 5 / React 18 / Electron 38 / TypeScript strict.** The dev machine's nvm has Node 21.6.2 (and 18), and Vite 6/7 refuse Node 21 — so electron-vite 2.x + Vite 5 is the newest combination that runs here. Electron itself bundles its own Node 22, so the host Node only runs the build tooling. Upgrading the Vite line is a when-Node-gets-upgraded chore, not urgent.
- **Agent SDK auth rides the machine's Claude Code login.** `@anthropic-ai/claude-agent-sdk` spawns its bundled CLI, which uses the same stored OAuth credentials Claude Code uses — no `ANTHROPIC_API_KEY` anywhere. Verified working. Two consequences: (a) dev requires a machine where Claude Code is signed in; (b) distributing to users who don't run Claude Code needs its own auth story — parked as an open question below.
- **The SDK spawns `node` from PATH.** Fine in dev; packaging (Phase 9) must either bundle a Node runtime or use `ELECTRON_RUN_AS_NODE` so the spawned CLI has something to run on.
- **The SDK is ESM-only; the Electron main bundle is CJS.** Loaded via dynamic `import()` (rollup preserves it) — don't convert to a static import without switching the whole main process to ESM.
- **Self-test mode:** `LYME_SELFTEST=1 npm run dev` boots the app, checks vault encrypt/decrypt (real DPAPI), short-secret tail suppression, sessions persistence, secure-modal boot/dismiss, and a live agent call, then exits — the headless check for everything a browser preview can't reach.
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

**Decided: bundle ffmpeg.** Broader scope than just Cut Room — it's the video/audio processing engine behind Cut Room concatenation/export, Play view's playback and non-destructive cutting, and subtitle burn-in.

- ffmpeg binaries are large (tens of MB) and platform-specific — needs an actual bundling strategy (a package like `ffmpeg-static`, or download-and-cache on first run) rather than assuming it's on the user's PATH. Which specific package, still open — a Phase 1/7 implementation detail now, not a Phase 0 blocker.
- Licensing varies by build: ffmpeg can be compiled LGPL-only or with GPL components enabled. Shipping a closed-source app means deliberately picking (or building) an LGPL-only binary to avoid GPL copyleft obligations — worth confirming a specific prebuilt package actually guarantees that before depending on one.
- **Subtitles are two different capabilities, not one.** ffmpeg burns/muxes a caption track into a rendered file — it does not generate the caption text itself. Producing the actual subtitles needs a speech-to-text capability, most naturally another MCP connection (a Whisper-based transcription tool, for instance) feeding ffmpeg the timed text, the same connector model as everything else. Don't build a bespoke transcription integration; connect one.
- Not blocking early UI/canvas work, but blocking before Cut Room or Play's ffmpeg calls become real.

## Open questions

- ~~Do we need the Premiere plugin for v1?~~ Decided: yes, it's a confirmed goal — likely built as a second phase after the core studio app, since it's a genuinely separate codebase either way.
- ~~Agent auth for distribution~~ **Resolved (2026-08-08): bring your own Anthropic API key.** Anthropic's terms forbid third-party apps from offering claude.ai *subscription* login via the Agent SDK without prior approval ("Anthropic does not allow third party developers to offer claude.ai login … for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods instead" — Agent SDK docs). So each user stores their own `ANTHROPIC_API_KEY` via the native secure modal → `safeStorage`; `src/main/claude-auth.ts` resolves it (vault, then a dev `.env.local`) and `agent.ts` injects it into the SDK `env` at query time. In dev, when no key is stored, the SDK falls back to this machine's Claude Code login. A "done-for-you" managed tier could instead supply Claude via the operator's own key (allowed, since you're powering your own product); subscription login would require Anthropic approval (sales@anthropic.com). See [monetization.md](monetization.md).
- What's actually still missing from UXP's "approaching 1:1 parity" list right now — worth checking `developer.adobe.com/premiere-pro/uxp/changelog` before we commit to anything the API can't do yet.
- Motion graphics generation is now in scope alongside video — worth figuring out whether Seedance covers that well on its own, or whether we need a second specialized tool/API for it.

## Sources

- [Premiere Pro Scripting Guide](https://ppro-scripting.docsforadobe.dev/)
- [UXP Plugins in Premiere 2026: The CEP Migration Clock Is Ticking](https://hyperbrew.co/blog/uxp-plugins-in-premiere-2026/)
- [AdobeDocs/uxp-premiere-pro-samples](https://github.com/AdobeDocs/uxp-premiere-pro-samples)
- [Premiere API — UXP for Adobe Premiere](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/)
- [Premiere Pro UXP changelog](https://developer.adobe.com/premiere-pro/uxp/changelog)
- [Premiere Pro UXP Beta](https://hyperbrew.co/blog/premiere-pro-uxp-beta/)
