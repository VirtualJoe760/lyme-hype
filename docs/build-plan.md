# Build plan

Sequencing, not spec. What each phase covers is already written down in the other docs — this is the order to build it in, what blocks what, and what "done" looks like for each step. As of the 2026-08-08 doc reorg, Phases 1–7 are built (see each phase's own status); Phases 8–12 are not started.

## Phase 0 — Decisions to close before writing code

- [x] App name: **Lyme Hype**.
- [x] ~~LimeWire naming-proximity~~ — raised, dismissed. Not a concern; the citrus motif is aesthetic inspiration, not a naming collision. Closed.
- [x] **ffmpeg: bundle it** — later revised; see `architecture/platform-decisions.md`'s ffmpeg section and `AGENTS.md` §7. Personal use runs on the machine's installed binary; bundling is Phase 9 (distribution) work, not a Phase 0 blocker.
- [x] Connections panel mockup reworked to match [connectors/model.md](connectors/model.md) — generic connector form, quick-start templates, and the secure-credential modal shown as its own piece.
- [x] jpsrealtor's Instagram/social account-linking flow — reviewed against the real jpsrealtor project directory. Full mechanics in [connectors/publishing.md](connectors/publishing.md); the port itself is still open (deferred to a joint session, see Phase 7).

## Phase 1 — Electron + TypeScript scaffold ✅ (built 2026-08-08)

Goal: an empty window that runs on Windows, with the Agent SDK wired into the main process.

- [x] electron-vite scaffold, TypeScript strict, hand-rolled (the create-tool is interactive). Stack pinned by the dev machine's Node 21 (nvm): electron-vite 2.3 / Vite 5 / React 18 / Electron 38 — see the implementation notes in [architecture/platform-decisions.md](architecture/platform-decisions.md#implementation-notes-phase-1).
- [x] Claude Agent SDK (0.1.77) in the main process — authenticates via this machine's existing Claude Code login, no API key needed. Verified standalone and in-app ("LINK OK", ~$0.10/ping).
- [x] `BrowserWindow` chrome in the **Lime Cut** skin (frameless window, custom titlebar/toolbar, per the kickoff prompt's pick).
- **Done criteria met:** `npm run dev` opens the window; the "Agent link" card in the aside gets a real reply. `LYME_SELFTEST=1 npm run dev` runs the headless plumbing check (vault, sessions, secure modal, agent) and exits.
- Ref: [architecture/platform-decisions.md](architecture/platform-decisions.md) (Electron decision, Windows-first build order).

## Phase 2 — Sessions + canvas core ✅ (built 2026-08-08)

- [x] Sessions rail: list, create, rename (double-click or ✎), select, delete (confirm step). Persisted as JSON in `userData` via the main process — no MCP yet.
- [x] Canvas view (React Flow / `@xyflow/react` 12): dot-grid background, pan/zoom, select + box-select tools.
- [x] Node types stubbed — Image/Video/Audio nodes with placeholder swatch thumbnails (audio gets a waveform), source badges (gen/file/link/gfx), "Rendering…" pulse that resolves after a stub delay.
- [x] Combine interaction: drag one node onto another (or select two + toolbar Combine) fires the combine dialog with per-pair copy; confirming spawns a stub combined node. Real generation lands in Phase 4.
- [x] Collapsible left/right panels; Cut Room strip with send-to-timeline from video/audio nodes; Canvas/Storyboard toggle (Storyboard itself is a Phase 6 placeholder).
- **Done criteria met** — verified end to end (session create/rename/switch with scoped state, drag-onto-node combine dialog, stub lifecycle).
- Note: the renderer also runs in a plain browser against the Vite dev server with an in-memory mock bridge ("browser preview" tag in the titlebar) — used for UI verification without driving the Electron window.
- Ref: [ui/canvas-and-storyboard.md](ui/canvas-and-storyboard.md), [history.md](history.md) (the stephenlawyer.clothing precedent).

## Phase 3 — Credential security + first real connection

Build the security boundary before any real connection touches a real key, not after. **Done (2026-08-08):** ChatRealty pulls real listing photos onto the canvas, and the Connections panel is a generic add-any-connector surface (stdio/http, none/apiKey/bearer, credential via the native modal, live test).

- [x] Native secure-credential modal: `BrowserWindow` + IPC + `safeStorage`, reporting contract (field name / length / last-4 only) — built in the Phase 1/2 pass, ahead of need. The Connections sheet (left rail → Connections) has a "Test secure input (fake connector)" button; the self-test verifies the vault round-trip and that dismissing the modal stores nothing.
- [x] **ChatRealty connection shape resolved and transport proven (2026-08-08).** From the jpsrealtor review: stdio MCP server (`@chatrealty/mcp-server`), `Bearer` token in `CHATREALTY_API_TOKEN` (must be `crt_live_…`), hosted base `https://jpsrealtor.com`, and `get_listing_photos` already returns base64 image blocks. `src/main/mcp-probe.ts` (a raw MCP-over-stdio client) is wired and `LYME_SELFTEST=1` confirms Lyme Hype spawns the server, handshakes, and lists all 34 tools.
- [x] **ChatRealty wired end to end (2026-08-08).** Token entered via the native secure modal → `safeStorage` vault (dev `.env.local` fallback), resolved only in the main process and injected into `CHATREALTY_API_TOKEN` when the stdio server is spawned — never in agent/renderer state. The aside's **ChatRealty** card (shown only when a token is configured) takes a query and pulls a listing's real photos: `search_listings` → `get_listing_photos` via `McpStdioClient`, image blocks saved as assets (`src/main/asset-store.ts`, served over the `lyme-asset://` protocol so `sessions.json` stays small), and dropped on the canvas as real Image nodes. Verified with Joseph's live hosted token: `LYME_SELFTEST=1` pulls 6 real photos and the protocol serves the JPEG bytes.
- [x] **Generic Connections panel (2026-08-08).** `src/main/connectors-store.ts` holds a built-in ChatRealty template plus user-added connectors (persisted to `connectors.json`); the panel lists them, adds a fully custom stdio/http connector (auth none/apiKey/bearer), collects its credential through the same native secure modal → vault, live-tests stdio connectors via the MCP probe, and deletes. The generic path — adding a connector we've never heard of — is the product, and it works.
- [ ] Agent-driven browser-copilot setup flow (optional convenience — the manual token path works today). Carried to a later pass.
- **Done criteria MET:** key never in agent/renderer-visible state or logs (vault + main-process-only resolution), a real query pulls real listing photos onto the canvas as Image nodes, and any MCP connector can be added generically. Phase 3 complete apart from the optional copilot flow.
- Ref: [connectors/model.md](connectors/model.md).

## Phase 4 — Real generation (video / image / audio) — CONNECTOR CATALOG COMPLETE

Connector landscape researched 2026-08-08, routing intent refined the same day — see [connectors/catalog.md](connectors/catalog.md) for the full per-tool table, connect shapes, and why each tool is used for what.

- [x] Suggested-connectors catalog (`src/main/connector-suggestions.ts`) surfaces the generation tools in Settings › Connectors — each with "Open setup page" (drives the browser to its key page) and "Add" (installs + collects the credential via the secure modal → vault, or the OAuth browser flow). **All seven catalog entries install today** (ChatRealty, muapi, ElevenLabs, Krea, fal, Gemini, Yapper) across all three transports (stdio, http, http+OAuth).
- [x] Model-provider switching (`src/main/model-providers.ts`, Settings › Models): the *agent's* LLM can be Claude (default), Kimi K3, or a custom Anthropic-compatible endpoint. Separate from generation connectors.
- [x] **Wire Generate to a real connector — done, agent-driven.** `src/main/generation.ts` runs the Claude Agent SDK with every installed connector attached as `mcpServers` — stdio (spawned, credential in env), http (Streamable-HTTP, credential as a header), and OAuth (bearer header resolved async via `connectors-store.resolveHttpHeaders`) — and lets the agent pick the right generation tool for the requested media type, no per-connector arg-schema hardcoding. It returns a strict `RESULT_URL:`/`RESULT_FILE:`/`RESULT_ERROR:` line; the result is imported via `importUrlAsset`/`importFileAsset` and dropped as a real node. The aside's Generate button and Storyboard **promote** (when the panel has a note) both drive it through `store.generateMedia`, with a real "Rendering…" → ready **or error** lifecycle. **Safety:** no `bypassPermissions` — `allowedTools` pre-authorizes only the `mcp__<server>` tools and a `canUseTool` backstop hard-denies every non-MCP tool, so the on-machine agent can never run Bash/Write/etc.; orchestration is capped by `maxBudgetUsd` and a 5-min timeout. **Boundary:** a live generation call against a real connector is deliberately untested here (deferred to a session with the user) — verified up to that edge (renderer lifecycle, error paths, typecheck + build, selftest).
- [x] **http-MCP client** — done. `src/main/mcp-http.ts` speaks the Streamable-HTTP MCP transport. `testConnector` probes http connectors the same way it probes stdio. Krea and fal both install with bearer-`Authorization` http templates.
- [x] **MCP OAuth** — done. `src/main/mcp-oauth.ts`: protected-resource discovery → auth-server metadata → dynamic client registration → PKCE in the system browser → loopback redirect → token exchange; tokens live in the vault under the connector id and refresh silently. Yapper installs as `authType: 'oauth'`; the card shows **Connect account** instead of a secret prompt, and the custom-connector form offers oauth for http connectors. Same credential boundary as ever — nobody types anything, the agent never sees a token.
- [x] **Gemini stdio wrapper** — done, dependency-free. `resources/gemini-mcp.cjs` is a plain-Node stdio MCP server hitting the REST API directly: `gemini_generate_image` (Nano Banana) + `gemini_generate_video` (Veo, polls the long-running op, downloads with the key in-process). Results hand off as `RESULT_FILE:` since Gemini returns bytes/authed URIs, not public URLs.
- [x] **OpenAI image wrapper** — built 2026-08-08. `resources/openai-image-mcp.cjs`, same shape as the Gemini wrapper (dependency-free stdio, `RESULT_FILE:` hand-off), plus `reference_image_paths` support via the images/edits endpoint from day one. Catalog entry installs it; selftest smoke-tests both bundled wrappers' MCP protocol. See [connectors/catalog.md](connectors/catalog.md#openai--storyboard-tier-image).
- [x] **Connector-tier routing** — built 2026-08-08 with Phases 11/13: Storyboard image panels carry a per-panel model choice, and the Create panel's task screens drive `connectorId` (+ a new advisory `modelHint`) per the tiering — see [connectors/catalog.md](connectors/catalog.md)'s "Wiring the tiers".
- [x] **Upload and Link source methods for video/audio.** Upload uses a native file picker (`media:import` IPC → `importFileAsset`, copies into `userData/assets`); Link downloads the URL (`media:importUrl` → `importUrlAsset` via `net.fetch`) into the same asset store. Both return a `lyme-asset://` `src` that `MediaNode` renders as a real `<video>`/`<img>`/waveform and that Play view plays. Media-type inferred from extension. Transcode-on-import is still deferred — a linked `.mov`/`.webm` is stored as-is and relies on Chromium's codec support until the ffmpeg path is built out further.
- **Done when:** all three source methods (generate / upload / link) produce a real node for at least one video connection and one audio connection, against a real live connector call. *(Structurally done; the live-connector verification is the remaining item, deferred to a session with the user.)*
- Ref: [ui/canvas-and-storyboard.md](ui/canvas-and-storyboard.md), [connectors/catalog.md](connectors/catalog.md), [connectors/model.md](connectors/model.md).

## Phase 5 — Play view — BUILT (ffmpeg-backed cutting deferred to Phase 7)

Implemented in `src/renderer/src/components/PlayView.tsx`, wired into `App.tsx` as a full takeover, store actions in `store.ts` (`openPlay`/`closePlay`/`setTrim`/`splitAtPlayhead`/`detachAudio`/`deleteAudio`).

- [x] A full-takeover view, not a third canvas toggle — Sessions rail and the aside hide while Play is open (`App.tsx` gates them on `playNodeId`); Cut Room stays visible below it.
- [~] **Playback runs on HTML5 media, not ffmpeg.** Decision: `<video>`/`<audio>` play the `lyme-asset://` source directly, and cuts are stored as non-destructive in/out points on the node — no frames are rewritten in Play. ffmpeg only enters at **export** (Phase 7), where the stored trim/split/mute get baked into the output file. This keeps Play instant and avoids an ffmpeg round-trip per scrub; the Phase 0 "same engine as Cut Room" note referred to *export*, which still holds.
- [x] Back arrow ("← Back to Canvas" / "← Back to Storyboard") driven by `playFrom`, captured from the session's `view` at `openPlay` time so Play returns to wherever it was opened from.
- [x] Video frame with a minimal overlaid control bar (play/pause, time, trim track with draggable in/out handles) — not a separate transport row. Audio nodes render a glyph + hidden `<audio>` in the same overlay pattern.
- [x] Clip audio actions below the stage (video only): **Detach** (→ independent audio node on Canvas referencing the same file) and **Delete** (mutes the track via `audioMuted`, behind a `confirm`). Real track extraction happens at export (ffmpeg, Phase 7) — Play stores intent.
- [x] Non-destructive in/out points stored on the node itself (`MediaNodeData.trimIn`/`trimOut`), not separate editor state.
- [x] Split at playhead → patches the source node's `trimOut` and spawns a right-half node (`trimIn = playhead`) back on Canvas; both are in/out views of the same file.
- [x] Send to timeline action, reusing the same node → Cut Room path (shared with Phase 7).
- [x] Entry points: double-click a video/audio node (`onNodeDoubleClick` in `CanvasArea`) or the hover ▶ button on the node thumb (`MediaNode`). `openPlay` guards against image nodes.
- **Done when:** a clip can be opened in Play, trimmed, split, have its audio detached or deleted, sent to Cut Room, and the back arrow returns you to where you came from. *(Met today with uploaded/linked and generated clips alike, since generation writes the same node shape.)*
- Ref: [ui/play-view.md](ui/play-view.md).

## Phase 6 — Storyboard view — BUILT

Implemented in `src/renderer/src/components/StoryboardView.tsx`; store actions in `store.ts` (`addPanel`/`updatePanel`/`movePanel`/`promotePanel`).

- [x] Canvas-corner toggle (already existed), sequential panel grid.
- [x] **A panel is a node, not a separate collection.** Panels are `MediaNodeData` with `panel: true` + `panelOrder`, so they persist with the session and share every node facility. The Canvas filters them out (`CanvasArea` shows `!panel || promoted`); the Storyboard shows `panel === true` ordered by `panelOrder`. This is what makes promote "same underlying state, not a copy" literal — promotion flips `promoted`/`status` on the *same* object and gives it a canvas position.
- [x] Each panel card: media-type toggle (video/image/audio), editable shot label, a note textarea (the future generation prompt), reorder ◀ ▶, delete, and Promote.
- [x] Promote → sets `promoted: true` + a canvas position, enters the "Rendering…" lifecycle (stub timer today, real generation when Phase 4's Generate wiring lands), and switches to Canvas so you watch it appear. A promoted panel stays in the Storyboard marked "On canvas →" and its type toggle locks.
- [~] **"Add panel" lives in the Storyboard grid, not the aside.** The plan floated a mode-switched aside ("Add panel" vs "Generate" on the same button). Chose the simpler, self-contained affordance — a `+ Add panel` tile in the grid — so the aside keeps one job (add-to-canvas). Revisit if the aside's Generate flow and the Storyboard ever need to share prompt state.
- **Done when:** block out five panels, promote one, watch it become a real generating node. *(Verified end-to-end in the browser mock: add → edit → reorder → promote → same node lands on Canvas as a "gen" node; the Storyboard entry flips to "On canvas →". No console errors.)*
- Ref: [ui/canvas-and-storyboard.md](ui/canvas-and-storyboard.md).

## Phase 7 — Cut Room / ffmpeg export — SINGLE-TRACK PIPELINE BUILT (multitrack rework is Phase 10)

Export pipeline in `src/main/ffmpeg.ts`; Cut Room UI reworked in `CutRoom.tsx`; store actions `moveClip`/`exportTimeline`.

- [x] Send-to-timeline action on video/audio nodes (already existed; now gated on `status === 'ready'`).
- [x] **Cut Room UX:** reorder clips (◀ ▶ via `moveClip`), per-clip trimmed/muted flags, remove, and an Export button with an inline status (Exported ✓ / Export failed with the reason as tooltip). Verified end-to-end in the browser mock: send → clip lands with reorder controls → Export enables → the no-real-media guard surfaces correctly.
- [x] **Sequential concat + export to a file.** `exportTimeline` resolves each timeline clip to its live node (so trims/mute set in Play are honored), and `buildConcatArgs` builds a single-pass ffmpeg `filter_complex`: per clip trim → normalize to a 1080×1920 reels canvas (scale+pad+fps) and a uniform audio format → `volume=0` for muted → `concat`. The export IPC opens a native save dialog then runs ffmpeg. `buildConcatArgs` is pure and self-tested (selftest §11).
- [x] **ffmpeg binary: resolved — the machine's installed ffmpeg (PATH) is the binary.** The LGPL question was settled 2026-08-08 (AGENTS.md §7, corrected): licensing attaches to *distribution*, and this is a personal tool, so the user's installed GPL build (ffmpeg 8.0, gyan.dev, includes libx264) is fine and is what `resolveFfmpeg()` finds today. The exact export `filter_complex` was run for real against it: two synthetic clips (one 16:9, one muted) → letterboxed 1080×1920 H.264/AAC mp4, verified with ffprobe. Bundling a verified-LGPL build + `openh264` swap moves to Phase 9 (packaging/distribution), where it belongs.
- Drag-to-combine on the timeline itself (clip-onto-clip → transition dialog) — folded into the Phase 10 multitrack rework rather than being a stretch-goal add-on to the single-track model.
- [ ] Subtitle burn-in: wire a speech-to-text MCP connection (Whisper-based) to produce timed captions, ffmpeg muxes/burns them at export. Still open.
- [ ] **Publish export destination — deferred to a session with you.** Full mechanics reviewed and written up in [connectors/publishing.md](connectors/publishing.md); the port itself needs a registered Meta OAuth app and — per AGENTS.md §6 — publishing is immediate with no API-level draft, so the UI must force a deliberate confirm. That's an irreversible, outward-facing action, so it isn't built blind here.
- **Done when:** two or more clips can be sent to Cut Room and exported as a single rendered file, with or without burned-in subtitles, with a working publish-to-Instagram path behind a real confirm step. *(Single-track pipeline + UI done, verified against the real installed ffmpeg binary; the publish port is the remaining outward-facing piece, and the multitrack rework in Phase 10 supersedes "single rendered file from a sequential clip strip" with real layered tracks.)*
- Ref: [ui/canvas-and-storyboard.md](ui/canvas-and-storyboard.md).

## Phase 8 — Premiere Pro plugin (UXP)

- Separate codebase and build target — own package, own dev loop, per the bridge-problem note in `architecture/platform-decisions.md`.
- Local bridge server (Lyme Hype ↔ the UXP panel).
- Import + timeline placement from Lyme Hype's exported/staged clips.
- Explicitly phase 2 of the whole project — don't start this before the core studio app (including the Phase 10 timeline) works, since it's a genuinely separate codebase either way.
- Ref: [architecture/platform-decisions.md](architecture/platform-decisions.md).

## Phase 9 — Packaging & distribution

- Windows installer via electron-builder.
- **ffmpeg for distribution:** bundle a verified LGPL build (check `ffmpeg -version` has no `--enable-gpl`/`--enable-nonfree`) via `extraResources`, and switch the export encoder from `libx264` → `openh264`. Local/personal use needs none of this (AGENTS.md §7).
- Mac build, code-signing, and notarization on Joseph's MacBook, per the `architecture/platform-decisions.md` build order.
- Auto-update wiring (electron-updater) — not needed day one, easy to add once there's something to update.

## Phase 10 — Multitrack timeline (Cut Room rework) ✅ (built 2026-08-08)

Full spec + build-decision record: [ui/timeline.md](ui/timeline.md).

- [x] Data model: `TimelineTrack`/`TimelineClip` (per-clip trim independent of the node's Play trim, seeded from it at add time), persisted per-session as `Session.timeline`; legacy `cutRoom` arrays migrate on load.
- [x] CutRoom rewritten as a real timeline: zoomable ruler (wheel + fit), dynamic tracks (+V/+A, default V1/V2/A1/A2), positioned clip rectangles (posters/waveforms), drag/reposition/move-across-tracks with ripple overlap resolution, edge retrim, razor + split-at-playhead, snapping (magnet toggle), per-track M/S/L, composited monitor pane with playhead-synced live preview, HTML5 drag from a canvas node's ⣿ grip onto a specific track/time.
- [x] ffmpeg export rewritten: unified `overlay`-chain graph over a black canvas with per-clip `enable` windows + `amix` with `adelay` positioning; mute-only (solo structurally absent from the export types); no-audio-stream inputs probed and excluded from the mix. Selftest covers the pure builder; the real graph was executed against the machine's ffmpeg and verified (1080×1920, correct duration, alpha overlay path included).
- **Done criteria met** — see the doc's done-when note for what was verified and the one synthetic-overlay caveat.

## Phase 11 — Scripting panel ✅ (built 2026-08-08)

Full spec + build-decision record: [ui/scripting-panel.md](ui/scripting-panel.md).

- [x] The multi-turn plumbing landed as `src/main/conversations.ts` — generic (resume + transcript-replay fallback, streaming, optional vision input and system prompt) so Phase 13's Motion graphics consumes the same module instead of a second copy. Selftest proves resume carries context with a real two-turn recall exchange.
- [x] `ScriptingView` chat (third view-toggle button), conversation persisted on `Session.scripting`, per-session cost readout, script → Storyboard handoff: JSON shot breakdown → fresh panels with `shotDescription`, per-panel feeling + ✨ agent-authored prompt into `note`, promoted the normal way.
- **Done criteria met** — see the doc's done-when note.

## Phase 12 — Resizable, collapsible panels ✅ (built 2026-08-08)

Full spec: [ui/layout-and-panels.md](ui/layout-and-panels.md). Drag-to-resize on the three panel boundaries (Sessions rail, aside, timeline height), collapse-on-overdrag, sizes persisted.

- [x] `PanelResizeHandle.tsx` (PlayView's proven pointer-drag shape), clamps per spec, collapse-on-overdrag firing the same toggle actions as the buttons, sizes in `PersistedState`. The Cut Room gained the collapse toggle it never had. Verified end-to-end in the browser preview (drag, clamps, collapse, reopen, restore).
- **Done criteria met** — see the doc's own done-when note.

## Phase 13 — Create panel (aside redesign) ✅ (built 2026-08-08, after Phase 11 as required)

Full spec + build-decision record: [ui/create-panel.md](ui/create-panel.md).

- [x] Tile grid → task screens ("Create"): Generate video / image (tier toggle wiring the Phase 4 routing gap) / audio (ElevenLabs direct tool calls: voice+browse, music, SFX, clone), Motion graphics, Isolate audio (local ffmpeg, direct-file URLs included), Create a LoRA (Krea REST train + poll; styles in Settings › Trained styles), Deepfake (Yapper-restricted), Upload, Link, Listing photos (ChatRealty's card as its own tile). Back arrow everywhere; navigation is local UI state.
- [x] **Motion graphics wizard**, all stages: references (canvas picks, ≤5) → agent-authored prompt variations (the Phase 11 conversation plumbing, vision input) → 2×2 batch into the generic `BatchResultsGrid` → iterate → reference-reinforced final pass → start/end-frame Veo animation (locally-drawn solid start frame; loop = same frame both ends) → colorkey → VP9-alpha webm via local ffmpeg, landing as a motionGfx node ready for the timeline's Video 2.
- [x] The four architecture gaps closed: reference-image input (both wrappers), frame conditioning (Gemini/Veo wrapper), batch-and-compare UI, alpha-capable codec path (verified `alpha_mode=1` against the real binary).
- **Done criteria structurally met** — live billed calls (real batch, real frame-conditioned render, real Krea training, live ElevenLabs/Yapper shapes) are joint-session work, per the doc's done-when note.

---

# Part two — the creative-node redesign (2026-08-09)

Phases 1–13 built the studio. This part rebuilds how a creative node *works*: panel as workbench
rather than form, models chosen by name, tools that re-frame what can run, artifacts that move
between nodes. Concept + annotated mockups:
[concepts/creative-node-redesign.html](concepts/creative-node-redesign.html). The registry it
runs on: [`src/shared/model-catalog.ts`](../src/shared/model-catalog.ts).

## Phase 14 — Decisions closed ✅ (2026-08-09)

Answered to unblock the build; each is cheap to revisit, and the reasoning is recorded so
revisiting is an argument rather than a coin flip.

- [x] **Leaving without Finish → staged takes persist per node, for the session.** Discarding punishes a cheap, exploratory action, and a confirm dialog taxes every exit to protect the rare one. Staging lives in session state so it survives navigation and dies with the session.
- [x] **Finish commits the take on screen.** "The artifact is the subject" — one preview, one commit. Committing all N would dump three rejected takes on the canvas every time.
- [x] **Settings squares stay three: Style / Refs / Takes.** Seed is per-model (Krea 2 has it, Veo 3.1 explicitly does not), so it belongs in the manifest's parameter list where it can appear conditionally — not as a fixed square that lies on half the models.
- [x] **Erase survives, renamed "remove bg".** One model and background-only, but it needs no mask and no prompt, so a one-click tool is genuinely the right shape. Object erase is a masked edit and lives in Inpaint. The honest label is the fix, not deletion.
- [x] **Expand and Reframe become modes of the canvas editor.** All three are direct manipulation of the image at size; three surfaces for one interaction would be the clutter the redesign exists to remove.
- [x] **A pill is a model.** One pill per model, connector implied and shown as secondary text. Mixing the two levels is the same category error as the old tier tabs.

## Phase 15 — Merge `overnight/node-enrichment` first ✅ (2026-08-09)

Not redesign work, but a hard prerequisite: the branch is **+6,977/−247 across 31 files** and
rewrites `AsidePanel.tsx` by +878 lines — the exact file every phase below touches. Reconciling
two rewrites of it afterwards costs more than reviewing it now.

- [x] Merged into `redesign/creative-nodes` — **not into `main`**, so the call on main stays with a human. Clean merge, no conflicts; typecheck + build green on the combined tree.
- [ ] Re-baseline the registry against the branch (muapi image-edit + fal i2v paths it added are not yet reflected in `model-catalog.ts`).

## Phase 16 — Node manifest + staging state ✅ (2026-08-09)

The architectural precondition. Without it, every node is hand-written TSX and none of this scales.

- [x] **Node manifest** — `src/shared/node-manifest.ts`, five nodes declared as records.
- [x] **Staging state** — `Session.stages`, `stageGenerate`/`selectTake`/`commitStage`. `generateMedia` kept for promote/Combine/Motion graphics, which legitimately want a node up front.
- [x] `commit` varies per node — carried in the manifest (`canvas` vs `person`).
- [x] Each manifest tool carries its own capability, superseding the standalone `IMAGE_TOOL_CAPABILITY` map.

## Phase 17 — Rebuild the image node on the shell ✅ (2026-08-09)

Reference implementation for everything after it. Rows per the concept's §01.

- [x] Model registry + capability keys + picker ordering — `model-catalog.ts`, 74 models.
- [x] Tool→capability reconciliation with a stated handoff when the model must change.
- [x] `NodePanel.tsx` renders any manifest; `ImageScreen` deleted rather than left dead.
- [x] Take paging inside the preview.
- [x] Refuse-when-empty — verified in the browser preview: zero ready models renders "Connect a tool to run", disabled.
- [x] Reference-image picker (canvas image nodes) + trained-style square that still routes through whichever backend trained the style.

## Phase 18 — Artifact handoffs between nodes ✅ (2026-08-09)

- [x] `ARTIFACT_HANDOFFS` + `handoffsFor()` — 12 routes, capability-gated.
- [x] "Continue in" pill row, capability-gated, appearing only once an artifact exists.
- [ ] Target node does NOT yet open pre-loaded — the pill commits the artifact but does not carry it into the other node's role. This is the half that makes handoffs useful.
- [x] Handing off commits.

## Phase 19 — The canvas editor takeover — PARTIAL

The largest single item, and the one with real UI risk.

- [x] `editor` state beside `playNodeId`; `App.tsx` swaps the middle pane and hides the rail.
- [x] Mask brush (brush/erase/clear/size, coords scaled into image space, PNG export). **No zoom/pan yet.** Built and typechecked but NOT visually exercised — it needs a ready artifact, which needs a live billed generation.
- [x] Mask wired end to end: `maskDataUrl` → `saveImageAsset` → `maskPath` → an explicit masked-edit instruction in `buildPrompt` that tells the agent to fail rather than generate unmasked. Inpaint is disabled until a mask exists.
- [ ] Panel keeps prompt + model pills + action; only the artifact surface moves.
- [ ] Expand and Reframe are modes of the surface but render an honest "not built yet" line.

## Phase 20 — Roll the shell out to the other nodes — MOSTLY DONE

- [x] **Video and Deepfake are on the shell**; `VideoScreen`/`DeepfakeScreen` deleted. Settings kinds built: media pickers (start/end frame, source, person) that share the handoff role names, plus voice, loraKind, steps. Audio and LoRA stay on their existing screens — audio's ElevenLabs/Yapper voice browsing and LoRA's dataset management are real surfaces the shell does not model yet. Original note: All four manifests exist, but the shell implements only `style`, `refs` and `takes`. Swapping video/audio/lora/deepfake onto it today would REGRESS shipped behavior — Yapper voice browsing, the Suno fallback, LoRA dataset management, Deepfake person/source pickers. Build `voice`, `sourceMedia`, `startFrame`/`endFrame`, `loraKind`/`steps`/`caption`, `person` first.
- [ ] **Generate video** — start/end-frame settings squares, Extend tool (**only 4 models**), lipsync handoff.
- [ ] **Create a LoRA** — preview holds the training set; Finish saves a person.
- [ ] **Deepfake** — toolbar as a left-to-right chain (Speech → Lipsync → Face swap), preview carries stage state. Face swap is **one model, muapi** — same refuse-when-empty case.
- [ ] Style local-only tools (audio Isolate, video Reframe) distinctly — no model, no row, no network, no spend.

## Phase 21 — Connector intake, steps 2–5 — IN PROGRESS

Spec: [architecture/connector-intake.md](architecture/connector-intake.md).

- [x] Step 1 — retain `inputSchema` from `tools/list`; observed tools recorded to `userData/connector-tools/<id>.json`. *Built, not yet exercised against a live server.*
- [ ] Step 2 — schema→capability classification, emitting proposals rather than live edits.
- [ ] Step 3 — model harvest from reference docs, with `retiresOn`/`unavailable` populated.
- [ ] Step 4 — residue review: tools matching no capability become new-capability candidates.
- [ ] Step 5 — node proposals from clustered residue (needs Phase 16's manifest).
- [ ] Default-deny on side-effecting verbs for newly observed tools — `DANGEROUS_TOOLS_BY_SERVER` is a hand-maintained blocklist and cannot cover unseen connectors.

## Cross-cutting, ongoing

Update the relevant spec doc in the same change that implements it. Decisions made mid-build belong back in the `architecture/`, `connectors/`, or `ui/` docs, not just in code — that's how this project's planning has worked so far, and drifting from it is exactly how README's Status section went stale once already.
