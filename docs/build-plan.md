# Build plan

Sequencing, not spec. What each phase covers is already written down in the other docs — this is the order to build it in, what blocks what, and what "done" looks like for each step. Nothing below exists as code yet.

## Phase 0 — Decisions to close before writing code

- [x] App name: **Lyme Hype**.
- [x] ~~LimeWire naming-proximity~~ — raised, dismissed. Not a concern; the citrus motif is aesthetic inspiration, not a naming collision. Closed.
- [x] **ffmpeg: bundle it.** Confirmed. Scope is broader than Cut Room concatenation — also powers Play view playback/cutting and subtitle burn-in (see [platform-decisions.md](platform-decisions.md#ffmpeg-dependency-cut-room--play--subtitles)). Which exact prebuilt package and LGPL-only verification is now a Phase 1/7 implementation detail, not a Phase 0 blocker.
- [x] Connections panel mockup reworked to match [connections-and-credentials.md](connections-and-credentials.md) — generic connector form, quick-start templates, and the secure-credential modal shown as its own piece.
- [ ] jpsrealtor's Instagram/social account-linking flow — under review in a separate session against the real jpsrealtor project directory. Lyme Hype ports that flow rather than building its own; exact mechanics land in [connections-and-credentials.md](connections-and-credentials.md) once that review is done.

## Phase 1 — Electron + TypeScript scaffold ✅ (built 2026-08-08)

Goal: an empty window that runs on Windows, with the Agent SDK wired into the main process.

- [x] electron-vite scaffold, TypeScript strict, hand-rolled (the create-tool is interactive). Stack pinned by the dev machine's Node 21 (nvm): electron-vite 2.3 / Vite 5 / React 18 / Electron 38 — see the implementation notes in [platform-decisions.md](platform-decisions.md#implementation-notes-phase-1).
- [x] Claude Agent SDK (0.1.77) in the main process — authenticates via this machine's existing Claude Code login, no API key needed. Verified standalone and in-app ("LINK OK", ~$0.10/ping).
- [x] `BrowserWindow` chrome in the **Lime Cut** skin (frameless window, custom titlebar/toolbar, per the kickoff prompt's pick).
- **Done criteria met:** `npm run dev` opens the window; the "Agent link" card in the aside gets a real reply. `LYME_SELFTEST=1 npm run dev` runs the headless plumbing check (vault, sessions, secure modal, agent) and exits.
- Ref: [platform-decisions.md](platform-decisions.md) (Electron decision, Windows-first build order).

## Phase 2 — Sessions + canvas core ✅ (built 2026-08-08)

- [x] Sessions rail: list, create, rename (double-click or ✎), select, delete (confirm step). Persisted as JSON in `userData` via the main process — no MCP yet.
- [x] Canvas view (React Flow / `@xyflow/react` 12): dot-grid background, pan/zoom, select + box-select tools.
- [x] Node types stubbed — Image/Video/Audio nodes with placeholder swatch thumbnails (audio gets a waveform), source badges (gen/file/link/gfx), "Rendering…" pulse that resolves after a stub delay.
- [x] Combine interaction: drag one node onto another (or select two + toolbar Combine) fires the combine dialog with per-pair copy; confirming spawns a stub combined node. Real generation lands in Phase 4.
- [x] Collapsible left/right panels; Cut Room strip with send-to-timeline from video/audio nodes; Canvas/Storyboard toggle (Storyboard itself is a Phase 6 placeholder).
- **Done criteria met** — verified end to end (session create/rename/switch with scoped state, drag-onto-node combine dialog, stub lifecycle).
- Note: the renderer also runs in a plain browser against the Vite dev server with an in-memory mock bridge ("browser preview" tag in the titlebar) — used for UI verification without driving the Electron window.
- Ref: [canvas-node-model.md](canvas-node-model.md), [reference-notes-stephenlawyer-canvas.md](reference-notes-stephenlawyer-canvas.md).

## Phase 3 — Credential security + first real connection

Build the security boundary before any real connection touches a real key, not after. **Done (2026-08-08):** ChatRealty pulls real listing photos onto the canvas, and the Connections panel is a generic add-any-connector surface (stdio/http, none/apiKey/bearer, credential via the native modal, live test).

- [x] Native secure-credential modal: `BrowserWindow` + IPC + `safeStorage`, reporting contract (field name / length / last-4 only) — built in the Phase 1/2 pass, ahead of need. The Connections sheet (left rail → Connections) has a "Test secure input (fake connector)" button; the self-test verifies the vault round-trip and that dismissing the modal stores nothing.
- [x] **ChatRealty connection shape resolved and transport proven (2026-08-08).** From the jpsrealtor review: stdio MCP server (`@chatrealty/mcp-server`), `Bearer` token in `CHATREALTY_API_TOKEN` (must be `crt_live_…`), hosted base `https://jpsrealtor.com`, and `get_listing_photos` already returns base64 image blocks. `src/main/mcp-probe.ts` (a raw MCP-over-stdio client) is wired and `LYME_SELFTEST=1` confirms Lyme Hype spawns the server, handshakes, and lists all 34 tools. Full spec in [connections-and-credentials.md](connections-and-credentials.md#chatrealty-connection--resolved-shape-2026-08-08-from-the-jpsrealtor-review).
- [x] **ChatRealty wired end to end (2026-08-08).** Token entered via the native secure modal → `safeStorage` vault (dev `.env.local` fallback), resolved only in the main process and injected into `CHATREALTY_API_TOKEN` when the stdio server is spawned — never in agent/renderer state. The aside's **ChatRealty** card (shown only when a token is configured) takes a query and pulls a listing's real photos: `search_listings` → `get_listing_photos` via `McpStdioClient`, image blocks saved as assets (`src/main/asset-store.ts`, served over the `lyme-asset://` protocol so `sessions.json` stays small), and dropped on the canvas as real Image nodes. Verified with Joseph's live hosted token: `LYME_SELFTEST=1` pulls 6 real photos and the protocol serves the JPEG bytes.
- [x] **Generic Connections panel (2026-08-08).** `src/main/connectors-store.ts` holds a built-in ChatRealty template plus user-added connectors (persisted to `connectors.json`); the panel lists them, adds a fully custom stdio/http connector (auth none/apiKey/bearer), collects its credential through the same native secure modal → vault, live-tests stdio connectors via the MCP probe, and deletes. The generic path — adding a connector we've never heard of — is the product, and it works.
- [ ] Agent-driven browser-copilot setup flow (optional convenience — the manual token path works today). Carried to a later pass.
- **Done criteria MET:** key never in agent/renderer-visible state or logs (vault + main-process-only resolution), a real query pulls real listing photos onto the canvas as Image nodes, and any MCP connector can be added generically. Phase 3 complete apart from the optional copilot flow.
- Ref: [connections-and-credentials.md](connections-and-credentials.md).

## Phase 4 — Real generation (video / image / audio) — IN PROGRESS

Connector landscape researched 2026-08-08 — see [connections-and-credentials.md](connections-and-credentials.md#generation-connectors--researched-landscape-2026-08-08) for the full table and per-tool key pages. **muapi** (one key = image+video+audio incl. Seedance/Midjourney/Kling/Veo/Flux/Suno) is the recommended primary; **ElevenLabs** for voice; **Gemini** for Nano Banana image + Veo video. Midjourney/Seedance/Dreamina are models inside aggregators, not separate keys.

- [x] Suggested-connectors catalog (`src/main/connector-suggestions.ts`) surfaces the generation tools in Settings › Connectors — each with "Open setup page" (drives the browser to its key page) and "Add" (installs + collects the credential via the secure modal → vault). muapi + ElevenLabs install today (stdio + API key); Krea/fal/Gemini/Yapper are listed but await the transport items below.
- [x] Model-provider switching (`src/main/model-providers.ts`, Settings › Models): the *agent's* LLM can be Claude (default), Kimi K3, or a custom Anthropic-compatible endpoint. Separate from generation connectors.
- [ ] **Wire Generate to a real connector — the core of this phase, not yet done.** The aside's Generate button still spawns stub nodes. Make it call a connector's generation tool (via `McpStdioClient`, like the ChatRealty pull) and drop a real Image/Video/Audio node with a real async "Rendering…" → ready lifecycle. Start with **muapi** (stdio, works today, funded).
- [ ] **http-MCP client** — Krea (`api.krea.ai/mcp`) and fal (`mcp.fal.ai/mcp`) are remote http MCP servers; the connector model + `McpStdioClient` are stdio-only today. Add an http/SSE MCP path.
- [ ] **MCP OAuth** — Yapper (and Krea's no-key option) auth the MCP connection via OAuth, not a stored key. Closer to the publishing-account OAuth mechanism.
- [ ] **Gemini stdio wrapper** — Google ships no trustworthy first-party media MCP; bundle a thin `@google/genai` stdio server rather than depend on a community package.
- Wire Generate mode to actually call a connector's tools: agent (or a direct tool call, like the ChatRealty pull) produces an actual clip/image/audio node, the "Rendering…" state reflecting a real async job instead of the stub timer.
- [x] **Upload and Link source methods for video/audio.** Upload uses a native file picker (`media:import` IPC → `importFileAsset`, copies into `userData/assets`); Link downloads the URL (`media:importUrl` → `importUrlAsset` via `net.fetch`) into the same asset store. Both return a `lyme-asset://` `src` that `MediaNode` renders as a real `<video>`/`<img>`/waveform and that Play view plays. Media-type inferred from extension (`EXT_MEDIA_TYPE`). CSP widened to `media-src 'self' blob: lyme-asset:`. Transcode-on-import is still deferred — a linked `.mov`/`.webm` is stored as-is and relies on Chromium's codec support until the Phase 7 ffmpeg path lands.
- **Done when:** all three source methods (generate / upload / link) produce a real node for at least one video connection and one audio connection. *(Upload + Link done; Generate still stubbed — the remaining blocker for closing this phase.)*
- Ref: [canvas-node-model.md](canvas-node-model.md), [connections-and-credentials.md](connections-and-credentials.md).

## Phase 5 — Play view — BUILT (ffmpeg-backed cutting deferred to Phase 7)

Implemented in `src/renderer/src/components/PlayView.tsx`, wired into `App.tsx` as a full takeover, store actions in `store.ts` (`openPlay`/`closePlay`/`setTrim`/`splitAtPlayhead`/`detachAudio`/`deleteAudio`).

- [x] A full-takeover view, not a third canvas toggle — Sessions rail and the aside hide while Play is open (`App.tsx` gates them on `playNodeId`); Cut Room stays visible below it.
- [~] **Playback runs on HTML5 media, not ffmpeg.** Decision: `<video>`/`<audio>` play the `lyme-asset://` source directly, and cuts are stored as non-destructive in/out points on the node — no frames are rewritten in Play. ffmpeg only enters at **export** (Phase 7), where the stored trim/split/mute get baked into the output file. This keeps Play instant and avoids an ffmpeg round-trip per scrub; the Phase 0 "same engine as Cut Room" note referred to *export*, which still holds.
- [x] Back arrow ("← Back to Canvas" / "← Back to Storyboard") driven by `playFrom`, captured from the session's `view` at `openPlay` time so Play returns to wherever it was opened from.
- [x] Video frame with a minimal overlaid control bar (play/pause, time, trim track with draggable in/out handles) — not a separate transport row. Audio nodes render a glyph + hidden `<audio>` in the same overlay pattern.
- [x] Clip audio actions below the stage (video only): **Detach** (→ independent audio node on Canvas referencing the same file) and **Delete** (mutes the track via `audioMuted`, behind a `confirm`). Real track extraction happens at export (ffmpeg, Phase 7) — Play stores intent.
- [x] Non-destructive in/out points stored on the node itself (`MediaNodeData.trimIn`/`trimOut`), not separate editor state — matches the resolved question in canvas-node-model.md.
- [x] Split at playhead → patches the source node's `trimOut` and spawns a right-half node (`trimIn = playhead`) back on Canvas; both are in/out views of the same file.
- [x] Send to timeline action, reusing the same node → Cut Room path (shared with Phase 7).
- [x] Entry points: double-click a video/audio node (`onNodeDoubleClick` in `CanvasArea`) or the hover ▶ button on the node thumb (`MediaNode`). `openPlay` guards against image nodes.
- **Done when:** a clip can be opened in Play, trimmed, split, have its audio detached or deleted, sent to Cut Room, and the back arrow returns you to where you came from. *(Met today with uploaded/linked clips; "a real generated clip from Phase 4" awaits Generate wiring.)*
- Ref: [canvas-node-model.md](canvas-node-model.md).

## Phase 6 — Storyboard view

- Canvas-corner toggle, sequential panel grid.
- "Add panel" (cheap, no generation call) vs. "Generate" (the Phase 4 path) — same aside, different button depending on mode.
- Promote action: a panel becomes a real node on the Canvas view — same underlying state, not a copy.
- **Done when:** you can block out five panels, promote one, and watch it become a real generating node.
- Ref: [canvas-node-model.md](canvas-node-model.md).

## Phase 7 — Cut Room / ffmpeg timeline

- Bundle ffmpeg per the Phase 0 decision — pick the specific prebuilt package, verify LGPL-only.
- Send-to-timeline action on video/audio nodes.
- Basic sequential concatenation + export to a file.
- Drag-to-combine on the timeline itself (clip-onto-clip → transition dialog) is a stretch goal — append-only can ship first.
- Subtitle burn-in: wire a speech-to-text MCP connection (Whisper-based) to produce timed captions, ffmpeg muxes/burns them at export. Depends on Phase 3's connector model already being in place.
- Publish export destination: port jpsrealtor's Instagram/YouTube OAuth account-linking flow (not an MCP connection — see connections-and-credentials.md). Requires an explicit confirm step before firing — publishing is immediate, no draft state at the API level.
- **Done when:** two or more clips can be sent to Cut Room and exported as a single rendered file, with or without burned-in subtitles, with a working publish-to-Instagram path behind a real confirm step.
- Ref: [canvas-node-model.md](canvas-node-model.md), [README.md](README.md) Status.

## Phase 8 — Premiere Pro plugin (UXP)

- Separate codebase and build target — own package, own dev loop, per the bridge-problem note in platform-decisions.md.
- Local bridge server (Lyme Hype ↔ the UXP panel).
- Import + timeline placement from Lyme Hype's exported/staged clips.
- Explicitly phase 2 of the whole project — don't start this before Phase 7 works, since it's a genuinely separate codebase either way.
- Ref: [platform-decisions.md](platform-decisions.md).

## Phase 9 — Packaging & distribution

- Windows installer via electron-builder.
- Mac build, code-signing, and notarization on Joseph's MacBook, per the platform-decisions.md build order.
- Auto-update wiring (electron-updater) — not needed day one, easy to add once there's something to update.

## Cross-cutting, ongoing

Update the relevant spec doc in the same change that implements it. Decisions made mid-build belong back in `canvas-node-model.md` / `connections-and-credentials.md` / `platform-decisions.md`, not just in code — that's how this project's planning has worked so far, and drifting from it is exactly how README's Status section went stale once already.
