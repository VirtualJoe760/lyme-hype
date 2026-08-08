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

Build the security boundary before any real connection touches a real key, not after.

- [x] Native secure-credential modal: `BrowserWindow` + IPC + `safeStorage`, reporting contract (field name / length / last-4 only) — built in the Phase 1/2 pass, ahead of need. The Connections sheet (left rail → Connections) has a "Test secure input (fake connector)" button; the self-test verifies the vault round-trip and that dismissing the modal stores nothing.
- [x] **ChatRealty connection shape resolved and transport proven (2026-08-08).** From the jpsrealtor review: stdio MCP server (`@chatrealty/mcp-server`), `Bearer` token in `CHATREALTY_API_TOKEN` (must be `crt_live_…`), hosted base `https://jpsrealtor.com`, and `get_listing_photos` already returns base64 image blocks. `src/main/mcp-probe.ts` (a raw MCP-over-stdio client) is wired and `LYME_SELFTEST=1` confirms Lyme Hype spawns the server, handshakes, and lists all 34 tools. Full spec in [connections-and-credentials.md](connections-and-credentials.md#chatrealty-connection--resolved-shape-2026-08-08-from-the-jpsrealtor-review).
- [ ] Generic connector data model (name / endpoint / auth-type / credential) + the reworked Connections panel UI. **Next up.**
- [ ] Wire ChatRealty end to end: connector stored (token via the native modal → vault), agent calls `get_listing_photos`, returned image blocks become Image nodes.
- [ ] Agent-driven browser-copilot setup flow.
- **BLOCKER:** needs a fresh **hosted `crt_live_` token** from Joseph (mint at `https://jpsrealtor.com/agent/settings → Integrations`). The token found on-disk is revoked on hosted and its local backend is down — see the connections doc. Everything up to "requires a live authorized call" is built and self-tested.
- **Done when:** a user can add a ChatRealty connection through the UI, the key never appears in agent-visible state or logs, and a real prompt in the aside pulls real listing photos onto the canvas as image nodes.
- Ref: [connections-and-credentials.md](connections-and-credentials.md).

## Phase 4 — Real generation (video / image / audio)

- Wire a real video-gen connection (Seedance) — Generate mode produces an actual clip node, with the "Rendering…" pulsing state reflecting a real async job instead of a mock.
- Wire a real audio-gen connection (ElevenLabs-style).
- Upload and Link source methods for video/audio — local file picker; pasting a link triggers the download/transcode step before the node is usable.
- **Done when:** all three source methods (generate / upload / link) produce a real node for at least one video connection and one audio connection.
- Ref: [canvas-node-model.md](canvas-node-model.md).

## Phase 5 — Play view

- A full-takeover view, not a third canvas toggle — Sessions and the aside hide while Play is open; Cut Room stays visible below it.
- Playback and non-destructive cutting both run on the bundled ffmpeg (same engine as Cut Room, per Phase 0) — not a separate media library.
- Toolbar breadcrumb swaps for a back arrow ("← Back to Canvas" / "← Back to Storyboard") while in Play — needs a small nav-stack, not just "last view," since Play should be reachable (and return correctly) from either Canvas or Storyboard.
- Video frame with a minimal overlaid control bar (play/pause, time, trim track) — not a separate transport row. Audio nodes render a bigger waveform in the same overlay pattern.
- A compact, separate audio strip below the video stage for the clip's own audio track — own trim handles, own **Detach** (→ independent node on Canvas) and **delete** (destructive, needs a confirm step) actions, scoped to audio only.
- Non-destructive in/out points stored on the node itself, not separate editor state — confirm this before building, per the open question in canvas-node-model.md.
- Split at playhead → produces two nodes back on Canvas.
- Send to timeline action, reusing the same node → Cut Room path as Phase 7.
- Double-click a video/audio node on Canvas or Storyboard as the entry point, or an explicit "Open in Play" action.
- **Done when:** a real generated clip from Phase 4 can be opened in Play, trimmed, split, have its audio detached or deleted, sent to Cut Room, and the back arrow returns you to wherever you actually came from.
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
