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
- [x] Claude Agent SDK (0.1.77) in the main process — authenticates via this machine's existing Claude Code login, no API key needed. Verified standalone and in-app ("LINK OK"; ~$0.10 of tokens per ping — plan consumption on the login, not a charge).
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
- [~] **Finish commits the take on screen** — REVERSED 2026-08-31 (Joseph): every
      finished generation now lands on the canvas immediately (`placeTakeOnCanvas`),
      because a render that cost real money must never sit somewhere the user can
      lose track of. Unwanted nodes are cheap to delete; lost renders are not.
      Staging still exists for paging/iterating takes, the preview marks a take
      "on canvas", commit is idempotent (`StagedTake.nodeId`), and the button is
      now "Done → clear panel" rather than a promise to add what is already there.
      Original decision: **Finish commits the take on screen.** "The artifact is the subject" — one preview, one commit. Committing all N would dump three rejected takes on the canvas every time.
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

## Phase 20 — Roll the shell out to the other nodes ✅ (2026-08-09)

- [x] **All five nodes render from one manifest.** `AsidePanel.tsx` went 1630 → 400 lines; `VideoScreen`, `ImageScreen`, `AudioScreen`, `LoraScreen`, `DeepfakeScreen` all deleted rather than left dead.
- [x] `NodeToolDef.exec` carries *how* a tool runs — agent, direct audio connector call, dataset mutation, or local ffmpeg — so the renderer never special-cases a node id.
- [x] Settings kinds built: canvas media pickers (start/end frame, source, person) keyed to the same role names the handoffs use, plus live voice browsing, LoRA kind, steps, trainer.
- [x] Nothing regressed: audio keeps real voice browsing and the Yapper free-tier route; LoRA holds its training set in the preview and blocks below fal's dataset minimum.
- [x] Local-only tools (audio isolate, video reframe) render a "no model, no spend" line instead of an empty pill row.
- [x] Audit fixes: LoRA no longer opens with a dataset tool active, handoffs no longer offer self-targets or appear on a node that commits a person, colliding pill labels carry their connector, and `clear` is disabled on an empty dataset.
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

---

# Part three — memory, projects, export, and shipping (2026-08-10)

Part two rebuilt how a node *works*. This part is about everything around it: what survives a
restart, where files live, how work leaves the app, and what it takes to hand someone an `.exe`.

**Framing decision: there is no Save.** `persist()` already writes on every change, so a File →
Save would be a button that does nothing. This is the Figma model, not the Photoshop model, and
the menu should reflect it — "Save As" becomes **Duplicate project**, "Open" becomes **Open
project**, and the only thing that genuinely leaves the app is **Export**.

## Phase 22 — Close the session-memory holes ✅ (2026-08-10)

Everything here is a gap in something that already works, so each is cheap and independently
shippable.

- [x] **Persist window bounds.** `createMainWindow` hardcodes 1440×900 centered on every launch;
      maximize/move/resize is lost. Save bounds + maximized state on `close`, restore on create,
      and clamp to the current display so a window from a disconnected monitor isn't off-screen.
- [x] **Persist `nodeInputs` and `nodeDataset`.** Both live in the store root and are absent from
      `persistedSnapshot()`, so a linked start frame and an assembled LoRA training set vanish on
      restart. They belong on the session, not the workspace — they're per-project work.
- [x] Confirmed the rest is genuinely covered: sessions, nodes, timeline, Scripting chat, staged
      takes, `activeSessionId`, theme and all four panel sizes already restore.

## Phase 23 — Projects as folders (the structural one)

> **2026-08-31 incident feeding this phase:** a harness (`LYME_TEST`) instance booted the
> full renderer against the shared `sessions.json` while the real app was open — last
> writer won and a session rename was lost. Immediate fix: headless modes no longer boot
> a renderer at all (verified: harness runs leave sessions.json byte-identical). The
> durable fix is this phase: per-project files make cross-instance clobber structurally
> narrower, and the store should also learn compare-before-write (refuse to overwrite a
> file that changed since load) when it moves.

Today every session lives in one global `sessions.json` and every asset is a uuid in a flat
`userData/assets/`. **116 files / 28.8 MB are currently orphaned — nothing references any of
them, and nothing in `src/main/` ever deletes an asset.**

Target layout, the model Premiere and Figma desktop use:

```
Documents/Lyme Hype/              ← workspace root, user-chosen
  lime-reel-01/
    project.json                  ← nodes, chat, timeline, staged takes
    assets/
      img_citrus-vinyl_001.png    ← human-readable, not uuids
      clip_lantern_002.mp4
```

- [ ] `project-store.ts` alongside `sessions-store.ts` so the current app keeps working during the
      transition.
- [ ] Workspace root picker, default `Documents/Lyme Hype`; `userData` keeps only machine-local
      state (connectors, credential vault, workspace path, recents, window bounds).
- [ ] Asset writes go to the project's own `assets/`, named from the prompt rather than a uuid.
- [ ] Migration: existing sessions become folders; the 116 orphans move into the project that
      references them, or a `_recovered/` folder.
- [ ] **Asset lifecycle falls out for free** — deleting a project deletes its assets because they
      live inside it. No reference counting to maintain.

### Phase 23 progress (2026-08-31) — sessions ARE projects

Closing the gap that made a live session invisible to the project opener:

- [x] **Every session mirrors to the workspace automatically** — on load and on
      every persist, the active session is written to
      `Documents\Lyme Hype\<slug>\`. Sessions and projects were two disconnected
      worlds; a session you never explicitly closed simply did not exist to
      "open a project" (that's why "Wow Generations" was nowhere in the picker).
- [x] **Self-describing project files** — `<slug>.lymeproj.json` instead of a
      folder full of identical `project.json` files. Legacy `project.json` still
      reads, and a folder keeps whatever file it already uses.
- [x] **Stable project identity** — `Session.projectDir` records where a session
      lives, so saving again UPDATES that project instead of cloning
      `wow-generations-2` beside it (`saveProject()`).
- [x] **In-app project browser** — ↺ in the Sessions rail lists real projects
      (name, saved date, node count, asset size) instead of sending the user into
      a file dialog; "Open from a file instead…" remains for backups.
- [ ] Assets still live in `userData/assets`, not inside the project folder — the
      remaining half of Phase 23, and what makes a project genuinely portable.
- [ ] Deleting a project from the app (the folder + its assets together).

### One userData, and a 700-line ceiling (2026-08-31)

- [x] **`consolidateUserData()`** — userData now lives at
      `Documents\Lyme Hype\.app`, set before `app.whenReady()`. Documents is not
      virtualized, so every launcher agrees; the packaged-host split cannot
      recur. Migration moves assets AND the state files as a unit, `Local State`
      included: safeStorage keeps its AES key there and DPAPI-protects only that
      key, so a vault copied without it decrypts to nothing — which is exactly
      how a vault holding a WORKING muapi key read as "never configured".
      Verified from the desktop icon: 180 assets, every connector ready, no key
      re-entered.
- [x] **Undecryptable secrets are reported**, not silently treated as absent
      (`readSecretValue`), and the Create tiles now say `✓ READY` vs
      `! NEEDS KEY` instead of `✓ Added` for both.
- [x] **700-line ceiling met repo-wide** (AGENTS.md §5). Every split typechecks,
      builds, and was runtime-verified in the launched app:
      | file | was | now | split into |
      |---|---|---|---|
      | `store.ts` | 2426 | 678 | `store/*`: types, helpers, context + five action slices behind a `StoreCtx` |
      | `model-catalog.ts` | 1212 | 226 | `model-catalog/*`: catalog-types + one file per media |
      | `NodePanel.tsx` | 999 | 693 | `node-panel/*`: support, SettingSheets, TakePreview |
      | `CutRoom.tsx` | 805 | 687 | `cut-room/*`: helpers, TimelineToolbar, TimelineMonitor |
      | `ChatRealtyPull.tsx` | 764 | 606 | `chat-realty/*`: form-defs, ListingContentDrafts |
      | `types.ts` | 743 | 15 | barrel over `types/*` (7 domains) |
      | `connector-intake.ts` | 729 | 522 | `connector-intake/*`: schema, roles |
      The originals stay the entry point — a barrel, the `create()` body, or the
      component itself — so no consumer's imports changed.

### Two data folders: the packaged-host container (2026-08-31)

The real bug behind "the canvas is partially missing". Not a stale build -- two
copies of userData.

Claude Code on Windows is an MSIX-packaged app, so any process it launches gets
a virtualized AppData: writes to `%APPDATA%\lyme-hype` land in
`%LOCALAPPDATA%\Packages\<host>\LocalCache\Roaming\lyme-hype`, while reads
fall through to the real profile. Lyme Hype launched from inside that host built
a COMPLETE second copy -- 180 assets and the whole credential vault -- that the
same app launched from the Start menu could not see. Hence 404s on every
thumbnail and every connector reading as unconfigured, while an agent-launched
instance looked perfect. Two views disagreeing is what made it so hard to see;
it also means an agent CANNOT verify the user's app by launching it itself.

- [x] **`recoverStrandedUserData()`** -- globs `%LOCALAPPDATA%\Packages\*      LocalCache\Roaming\lyme-hype`, copies missing assets and newer state
      files into the real profile. Runs **every boot**, not once: development
      keeps writing new media into the container, so a one-shot fix would
      strand tomorrow's work.
- [x] **`rekeyFromEnvFile()`** -- safeStorage/DPAPI is scoped to the app
      container that encrypted it, so an adopted vault copies across intact and
      still will not open. Connectors whose key is in the repo's `.env.local`
      get re-encrypted in this profile automatically (gemini, chatrealty).
      muapi and ElevenLabs are not in `.env.local` and need one trip through
      the secure modal.
- [x] **The silent catch is no longer silent** -- `readSecretValue()` treated
      "cannot decrypt" as "no key", which is exactly why a full vault looked
      like an app that had never been configured. It now warns once per id.
- [x] **`boot.log` in userData** -- a Start-menu launch has no console, so every
      diagnostic main printed was discarded on precisely the launch that
      misbehaved. Mirrored to disk, it is what cracked this.
- [ ] Structural end-state: assets belong in the project folder under
      `Documents\Lyme Hype` (Phase 23's remaining half). Documents is NOT
      virtualized -- both contexts already share it -- so media kept there
      cannot diverge in the first place.

Verified from the desktop icon (the user's real launch, not an agent one):
assets=180 in the real profile, zero 404s, thumbnails and video posters render,
and video/image/motion-graphics tiles read ready.

### Tidy + groups on the canvas (2026-09-03)

- [x] **Tidy** (canvas toolbar): photos in one line, videos in the next, audio in the
      third, left-to-right in their existing order so nothing swaps places. Groups are
      laid out as blocks; nodes inside a group keep their arrangement.
- [x] **Groups**: select two or more nodes → Group. A named frame (React Flow parent
      node, `CanvasNodeState.type: 'group'`, children carry `parentId` + `extent:
      'parent'`) that moves them in unison; resizable; double-click the name (or the
      toolbar) to rename; Ungroup leaves the nodes where they are. Trashing a group takes
      its members; a member restored without its frame becomes a top-level node again
      (React Flow throws on a missing parent — `reparentOrphans` runs on every load).
- The drag ghost, drop-on-tile and trash paths all see a group as one node.
- [x] **Multi-select + a selection toolbar** (same day): Shift-click adds to the
      selection (React Flow's default was Control on Windows); with two or more nodes
      selected a toolbar floats above them — *merge* (two ready stills → the Merge
      stills dialog), *group*, trash — and the per-node actions step aside. Dragging a
      group frame across a node no longer opens Merge (it did).

### Generate Character (2026-09-03)

Joseph's call: build the cartoon pipeline INTO the app instead of gathering more lab
runs — "Generate Character should be the node's name", with Generate Scene to follow.
The lab's live-verified pieces moved into `src/main/character/` as-is:

- [x] **A Create tile** (`GenerateCharacterScreen`, three stages like the Motion
      graphics wizard): define (name, lock list, one of 12 cartoon styles with weight
      readiness, up to three reference photos from the canvas or an upload) → cast
      (N candidates in a `BatchResultsGrid`, engine progress narrated live) → approve.
- [x] **Two engines, no agent turn** (`character-engine.ts`, direct ComfyUI HTTP via
      `character-comfy.ts`): *cast* = SDXL checkpoint + style LoRA, optional img2img
      from photo 1; *convert* = Qwen-Image-Edit-2511 redraws the person in the style
      AND the lock-list outfit from up to three photos, then a LoRA polish pass. Both
      start ComfyUI on demand and `/api/free` on every checkpoint switch. Generation
      cost $0, recorded as such in the generation log.
- [x] **Review** = the plan LLM scoring every candidate against the photos and the
      lock list (likeness 35 / lock list 25 / anatomy 25 / style 15), notes and issues
      shown under the picked candidate. LLM tokens only, labelled so.
- [x] **Approve → a character node on the canvas** (`MediaNodeData.characterId`,
      badge "character"). Dragging it onto Generate image links it as a CHARACTER
      reference (gemini's typed refs) and seeds the prompt with the name; on the local
      tier it is the img2img reference. That is "generate an image of my character",
      v1 — the @-tag picker from the spec is the next step.
- [x] Characters persist in `userData/characters.json` (workspace-wide until channels
      exist — the spec's §5 says the library belongs to a channel).
- Not yet: the character sheet (turnaround + expressions), the local character-LoRA
  trainer, Generate Scene, weight downloads from inside the app (use the lab's
  `ensure` for now — the Civitai key lives there).

### One backend, ComfyUI on demand (2026-09-02)

Joseph's machine paged to a standstill: 1 GB of 32 GB free, commit 78.9 of 79.5 GB.
The 43 GB was ComfyUI — the one Lyme Hype starts at boot — running LoRA jobs that a
second Claude Code session (the lyme-hype-lab work) had queued into it over port 8188.
Flux + encoders + LoRA overflow a 24 GB card into RAM, and nothing in the app noticed.
Two more copies of the app were also running: each Claude Code session's MCP bridge
booted its own headless Electron. Closing the studio fixed the lag, because the studio
owned the ComfyUI process — so from the user's chair, Lyme Hype was the problem.

- [x] **One backend per machine** (`mcp-hub.ts`, rewritten bridge): fixed pipe name,
      N bridges per backend, the studio takes over while open, headless exits when
      idle, bridges reconnect and replay the handshake. Details: tooling/mcp-server.md.
- [x] **ComfyUI starts on demand, not at boot** (`ensureComfyUI` before a local image
      run; unrestricted runs only kick it off), **stops after 10 idle minutes** unless
      its queue has a job (anyone's), and the wrapper no longer spawns a server at all.
- [x] **Memory watchdog** (`comfyui-watchdog.ts`): every 10 s, committed bytes of the
      owned server + free RAM. Over `LYME_COMFY_MAX_GB` (default 20) or under 1.5 GB
      free → `POST /api/free` (unload models); three strikes → kill, status strip says
      why, restarts on the next generation. Shown live as `12.3 GB` in the strip. A
      ComfyUI the user started themselves is never watched or killed.
- [x] `LYME_TEST=comfy_watchdog` proves the sampler and the relieve→relieve→kill policy
      against a 1.2 GB Python balloon — no GPU, no model.
- Still true: the lab project should run its own ComfyUI on another port; its jobs die
  with the studio otherwise. That is its config, not this repo's.

### Monitor: fit, zoom, open large (2026-09-02)

The paladin clip showed thin black bars in the 9:16 monitor. Measured: the
source is 724×1268 (ratio 1.751, not 1.778), so contain-scaling it into
1080×1920 leaves ~14 px of black top and bottom — real in the export too, not
a monitor artefact (`signalstats` on the exported first frame: top rows luma 16
for Letterbox, 100 for Fill frame). Every clip was letterboxed with no way to
change it, in preview or export.

- [x] **Per-clip fit** (`ClipTransform` on `TimelineClip`): Letterbox (contain,
      the old default), Fill frame (cover — scale up and crop), Custom (scale
      relative to the contain size + x/y offset in % of frame). Set from the
      toolbar when a clip is selected; persisted with the clip.
- [x] **Preview and export agree by construction.** The monitor draws each layer
      with the clip's fit (`object-fit` / transform); `ffmpeg.ts` maps the same
      three cases (`force_original_aspect_ratio=increase` for cover, a second
      scale for custom, overlay position for the offset). The old base-track
      `pad` step is gone — every clip composites onto the opaque black base, so
      a letterbox is simply black showing through.
- [x] **Monitor zoom** (Premiere's program-monitor menu): Fit · ⅛ · ¼ · ⅓ · ½ ·
      100% · Custom, as fractions of the real 1080×1920 output; the monitor
      scrolls when larger than its panel.
- [x] **Double-click the monitor** opens the top-most video clip in Play view.
- Default stays Letterbox: cropping silently is the worse surprise. Fill frame
  is one click.

### Drag a node onto things (2026-09-02)

"Dragging a node toward the timeline drags the canvas down instead." A React
Flow drag only knows how to reposition; what was wanted is to drop the node
ON a target — a timeline lane, the trash, a Create tile.

- [x] `autoPanOnNodeDrag` off — leaving the canvas is the point, not a reason
      to pan after the pointer.
- [x] **One payload, every target.** The drag END finds the zone under the
      pointer and synthesizes the exact `application/lyme-node` drop the ⣿ grip
      already sends (`canvas-drag.ts`). The timeline's lanes — ghost lanes,
      real lanes, type checks, snapping — and the trash can needed no changes.
      The node snaps back to where it started; the canvas never strands it.
- [x] **Create tiles accept a node** and open with it in the right slot, mirroring
      the node toolbar: image → Generate image = img2img reference; image →
      Generate video = start frame; video → Generate video = extend.
- [x] Zone under the pointer highlights; once the pointer leaves the canvas a
      ghost chip (thumbnail + label) follows it, because React Flow clips the
      real node at the canvas edge. **The highlight is a `data-drop-target`
      attribute, not a class**: React owns `className` on those elements and
      rewrites it on every re-render, and a node drag re-renders the canvas every
      frame — the first version's class vanished before it could be seen
      (Joseph: "the trash should get bigger and red"). React leaves attributes it
      did not set alone; verified to survive a re-render. The can answers both
      protocols (grip `.over`, node-drag attribute) identically: scale 1.4,
      danger red, glow.
- [x] **The ghost chip must honour `hidden`.** Its `display: flex` outranked the
      browser's default `[hidden] { display: none }`, so the chip was never
      actually hidden — it sat at (0,0) as a stray "≡" box in the title bar and
      then wherever the last drag ended (Joseph: "a broken node"). Now an explicit
      `.drag-ghost[hidden] { display: none }`, and it parks off-screen until a
      drag positions it. Lesson: any element toggled via `hidden` that also has
      an author `display` needs the `[hidden]` override spelled out.
- The grip still works for the same drops; "→ timeline" on the toolbar remains
  the append-to-end shortcut.

### Canvas trash (2026-09-02)

A deleted image could not be brought back — Ctrl+Z did nothing, because delete
was delete. A generation is paid for or waited for; one keypress must not end
it.

- [x] **Every delete path lands in the session's trash**: the node toolbar ✕,
      the Delete/Backspace key (React Flow `remove` changes, captured *before*
      they are applied), and dropping a node's grip on the can. `Session.trash`,
      newest first, capped at 50, persisted with the session.
- [x] **The can** sits bottom-right of the canvas with a count badge; it is a
      drop target (`application/lyme-node`), and clicking it opens Recently
      deleted — thumbnail, label, when — with Restore per item and Empty trash
      behind a two-click confirm.
- [x] **Ctrl+Z / Cmd+Z on the canvas restores the most recent delete** (ignored
      while typing in an input). The restored node is focused.
- Trash forgets the NODE, never the file: assets stay in the store and in
  Recent generations. Timeline clips of a trashed node leave with it and are
  not auto-restored.

### Hallucination guard for image generation (2026-09-02)

Prompted by a z-image-turbo render of "a bulldog grinding a rail" that grew a
second dog's head out of the first one's legs. Joseph's instinct was AI-written
negative prompts; the templates say otherwise — **every local model runs at
CFG 1.0, where negatives are ignored** (see comfyui.md). Built instead, all in
`src/main/generation-guard.ts`, all through the app's OWN LLM provider as a
single no-tools turn (the Enhance shape — no agent orchestration overhead):

- [x] **Say it in the positive prompt.** Before a generation, a rewrite states
      subject count, anatomy and framing outright. Automatic for local models
      (the only channel they read) and for **thin prompts under 60 characters
      on any connector** — "a dog walking through a park" leaves all of that to
      chance. The panel's button becomes `✦ Enhance & generate` with an
      `as typed` escape hatch beside it. The take shows the prompt the model
      actually saw (`promptUsed`), so nothing is hidden.
- [x] **Verify and retry, local only.** After a local image, a vision check
      answers one question — extra limbs/heads, merged or miscounted subjects,
      wrong fingers — as strict JSON. On a defect the image is regenerated with
      a new seed (the wrapper randomises per call), up to 2 retries; local
      renders are free, so this costs only time. Billed connectors are never
      auto-retried. **Rejected attempts stay in the takes carousel as failed
      takes with the reason** — a safeguard you cannot see is one you cannot
      trust.
- [x] **Honest when it cannot look.** A text-only provider (some Kimi / custom
      endpoints) fails the vision turn; the result then carries
      `verification: { checked: false, reason }` instead of a false "clean".
- [x] The guard's token usage is labelled on the take's note — `· guard tokens $0.011 (plan)` on the
      login, `· guard $0.011` only under a billing provider — and never added to a dollar total
      unless it is one (AGENTS.md §1.8).
- [ ] Threshold and retry count are constants (`src/shared/generation-policy.ts`);
      promote to settings once real use shows the right numbers.
- [ ] PAG (`PerturbedAttentionGuidance`, core node) as a per-template toggle —
      the guidance-side lever for anatomy on distilled models, ~2× sample time.

### ComfyUI survived app close — and now cannot (2026-09-02)

"When I closed Lyme Hype the memory issue didn't stop" — because the kill never
ran. The wrapper spawned ComfyUI detached and left its pid in `%TEMP%`, which
Windows virtualizes per launcher: the file was written under one launcher and
looked for under another. Only one `[cleanup]` line was ever logged, from an
agent session.

- [x] **Main owns ComfyUI** (`comfyui-host.ts`): starts it at boot as a real
      child with piped output, adopts orphans of its own by their spawn-flag
      fingerprint, and kills the process tree on both quit hooks via the child
      handle, the userData pid file, and the port owner. Three routes, because the
      one that failed was the only one there was.
- [x] **Status strip** — one line of terminal context at the foot of the studio:
      `comfyui · loading z_image_turbo…` from the server's own output, so a 12 GB
      load in the background is visible instead of silent. The boot splash
      records where the engine was at the moment the studio opened.

### Memory audit (2026-09-02)

Prompted by a full-system OOM and reboot. Measured, not guessed:

| what | RAM | notes |
|---|---|---|
| Studio window with a 9-node session | ~490 MB | main 143 · renderer 142 · gpu 148 · utility 58 |
| `--mcp` instance (Claude Code keeps it alive all session) | ~225 MB | a full Electron just to serve 14 tools |
| ComfyUI (spawned by us) at the moment of the OOM | 7.5 GB + 3 parked models | **the actual culprit** |
| Claude Code itself | ~2.9 GB / 15 procs | not ours |

The app is not the problem: half a gigabyte for an Electron studio with a live
canvas and multitrack timeline is unremarkable. What ate the machine was
ComfyUI's default of parking every model it has used in system RAM (flux 16 GB +
z-image 12 + krea2 13 = 40 GB on a 32 GB box).

- [x] **ComfyUI: one model, in VRAM.** `--highvram --cache-none` at spawn, and
      `/api/free` on every checkpoint switch (`resources/comfyui-mcp.cjs`).
- [x] **Media-role picker decoded full-size originals** — one `<img>` of the
      2K–4K source per canvas node, plus `<video>` tiles at Chromium's default
      `preload=auto`, buffering every clip the moment the sheet opened. Now the
      256px companion and `preload="none"` with a poster.
- [x] Already right, confirmed: canvas nodes use the 256px thumbnail (commit
      1664c00); the asset protocol streams instead of buffering; the Cut Room
      monitor mounts only the clips under the playhead, not the whole timeline;
      every SDK generation clears its timeout in `finally`; connector test
      children are tree-killed (`taskkill /T`).
- [ ] The `--mcp` instance is ~225 MB of Electron for a tool server. Fine for
      now; if it matters, `--mcp` mode could skip the GPU process
      (`app.disableHardwareAcceleration()` before ready) since it never opens a
      window.
- [ ] VRAM is a non-issue today: 1.4 GB used of 24 at idle, and one image model
      is 12–16 GB. It becomes one only if two models are ever wanted resident.

### Launching a stale build (2026-08-31)

A fix can look like it did not work because `electron .` runs whatever is
already in `out/` — a window opened before a rebuild keeps the OLD renderer AND
the old main process, and Vite HMR never touches main. This cost a full session:
a thumbnail bug was chased that had already been fixed in a build the open
window had never loaded. Three defences, so it cannot happen quietly again:

- [x] **The Start-menu shortcut builds when it needs to.** It now runs
      `scripts/launch.ps1`, which compares the newest mtime under `src/`,
      `resources/`, `electron.vite.config.ts` and `package.json` against
      `out/main/index.js`, rebuilds only if something is newer, then launches.
      Measured: unchanged repo launches in 3.6s with no build; a touched source
      file rebuilds first. A failed build falls through to the last good `out/`
      with a warning rather than leaving no app at all.
      (ASCII + BOM: PowerShell 5.1 reads an unmarked `.ps1` as ANSI, and an em
      dash in a comment is a parser error.)
- [x] **The app states which build it is.** `electron.vite.config.ts` stamps
      compile time + short commit into main (`__BUILD_STAMP__` →
      `src/main/build-info.ts`), surfaced in `system:status` and printed on the
      boot line: `ready  studio online · build 2026-08-31 15:18 · 1664c00`.
      Local time deliberately — a UTC stamp reading 22:16 beside a 15:16 clock
      recreates the exact confusion it exists to end.
- [x] **The app notices when it is behind.** `sourceIsNewerThanBuild()` walks
      the same watched paths at boot; when source is newer the boot line reads
      `STALE BUILD (…) — source has changed since; run npm start`. Packaged
      builds have no source tree, so they are never flagged.
- `npm start` (build-then-launch) remains for terminal launches; `npm run dev`
  for HMR; `npm run app` / `electron .` deliberately still launch what exists.

### Canvas media on restore (2026-08-31)

"On boot the thumbnails and content in the canvas are partially missing"
(Joseph). Nothing was lost — every asset and thumbnail was on disk and valid.
Two separate causes:

- [x] **Video nodes had no poster frame.** Clips saved before posters existed
      carry no `thumbSrc`, and the `<video preload="metadata">` fallback loads
      metadata WITHOUT decoding a frame, so `#t=0.5` had nothing to paint — a
      blank node over perfectly good media. Fixed both ends: the fallback now
      uses `preload="auto"`, and `media:ensure-thumb` (`ensureThumbForUrl()`)
      backfills a real ffmpeg poster on load, cached on disk, so it costs
      nothing from the second boot on. Deliberately not awaited by `init()`.
- [x] **A cancelled thumbnail never retried.** `lyme-asset://` requests get
      cancelled when a node re-renders mid-flight — and boot does exactly that,
      mounting the canvas, rescuing takes and backfilling thumbs in quick
      succession. A cancelled `<img>` shows the broken glyph permanently since
      the browser never retries. `AssetImg` retries once with a cache-busting
      suffix (ignored by the handler, which resolves on pathname alone).
- [x] **404s are no longer silent** — the protocol handler warns, so "the canvas
      lost my media" is diagnosable next time instead of invisible.

Verified: fresh boot renders all five nodes including both video posters, zero
broken images, zero 404s.

### Startup takeover (2026-08-31)

A standardized boot experience, so the studio is never handed over half-booted
(Joseph): `BootSplash` covers the app until `init()` genuinely finishes.

- [x] **`system:status` IPC** — ffmpeg source, workspace path, ready connector
      ids, project count. The splash reports facts, not a fake progress bar.
- [x] **Real steps** — `init()` pushes `bootSteps` as each stage lands (media
      engine → workspace → sessions restored → connectors → ready). On this
      machine they all land inside ~200ms, so the splash holds a **1500ms
      minimum beat**: readable without ever claiming work that hasn't happened.
- [x] **One status line, bottom right** — the current step only, not a log
      (Joseph, 2026-08-31). The brand animation owns the center.
- [x] **Owns its own exit** — the component stays mounted through the `.done`
      fade and unmounts itself ~650ms later. Unmounting on `booted` (the first
      version) made the fade dead code; leaving it mounted forever would have
      swallowed every click, since the takeover sits above the whole app.

Verified live over CDP: splash present through boot with all five real lines,
`.done` at ~1.6s, gone by ~2.4s.

## Phase 24 — Hamburger menu + real keyboard accelerators

- [ ] Hamburger in the custom titlebar (correct pattern for a frameless window — VS Code, Figma):
      New project · Open project · Recent · Duplicate project · Reveal in Explorer · Export… ·
      Settings. **No Save, no Save As.**
- [ ] **Register a hidden application menu.** With `frame: false` and no `Menu.setApplicationMenu`,
      accelerators do not exist — Ctrl+N/Ctrl+O/Ctrl+E currently do nothing and won't start working
      just because a hamburger renders them.
- [ ] No Edit menu until there's undo/redo — there is none today, and an Edit menu implies it.

## Phase 25 — Export panel

The Cut Room already renders through ffmpeg (`⬇ Export mp4`, 1080×1920 @30). What's missing is
choice and destination.

- [ ] Preset list: Reel 1080×1920, Square 1080×1080, Landscape 1920×1080, plus a Master (higher
      bitrate, no downscale).
- [ ] Destination defaults to the project folder rather than a dialog every time.
- [ ] Export history per project, so a re-export overwrites deliberately instead of piling up.

## Phase 26 — Adobe handoff (see the recommendation below)

- [ ] **Watch-folder drop** — configurable path; after an ffmpeg export, optionally copy the file
      into an Adobe Media Encoder watch folder. This is the only supported third-party integration
      surface AME has, and it needs no Adobe SDK.
- [ ] **Timeline interchange** — export the Cut Room as an XML Premiere can open, so the *edit*
      arrives on tracks instead of a flattened mp4. **Format needs verifying against the installed
      Premiere version** (FCP7-style XMEML is the historically reliable one; AAF and EDL are the
      fallbacks). Do not assume.
- [ ] Leaves the already-planned UXP plugin (project Phase 2) as the deep integration; this is the
      cheap 90%.

## Phase 27 — Ship an `.exe`

No `build` config and no electron-builder exist yet. Beyond adding them, four things actually bite:

- [ ] **`resources/*.cjs` cannot be spawned from inside asar.** `connector-suggestions.ts` uses
      `join(app.getAppPath(), 'resources', …)`, which packaged becomes `app.asar/resources/…`.
      Gemini and OpenAI connectors work in dev and fail in a packaged build. Fix with
      `extraResources` + `process.resourcesPath`.
- [ ] **`asarUnpack` the Agent SDK** — it spawns its own `cli.js` out of `node_modules`.
- [ ] **Node is a hidden dependency.** muapi spawns `npx -y muapi-cli`, ChatRealty spawns `node`.
      On a machine without Node those connectors simply don't run. Decide: document it as a
      prerequisite, bundle a Node runtime, or prefer HTTP-transport connectors.
- [ ] ffmpeg: personal use runs on the machine's binary; distributing to others means bundling an
      LGPL build and switching the encoder (`AGENTS.md` §7).
- [ ] Code signing — an unsigned `.exe` triggers SmartScreen.
- [ ] Agent auth: generation currently rides *this machine's* Claude Code login. Another machine
      has none, and needs its own.

# Part four — every connector alive (2026-08-29) ← CURRENT FOCUS

The tooling layer landed 2026-08-29 (see `tooling/`): live feature tests
(`src/main/utils/*_test.ts`), the app as an MCP server (`--mcp` + bridge, 14 tools), Claude
Code skills, and headless credential import. Joseph's direction: **wire and live-test every
connector through this layer, in the current UI, before building production mode** — the
product vision (`product/vision.md`: channels, pipeline, analytics) waits until generation
is fully proven.

Order: **images → video → the rest.**

- [x] **Image** — gemini + muapi verified live, side by side (2026-08-29). **Full Gemini
      param surface exposed the same day** (wrapper → GenerationParams → utils → MCP tools →
      model-conditional UI chips): per-call model, real `imageConfig` aspect (10 values,
      live-verified 16:9→1376×768) + size tiers, thinking_level, typed object/character/
      style refs; skills now interview for blanks. Remaining: OpenAI Images (needs
      `OPENAI_API_KEY` import), Krea, fal image paths; live-run typed refs + thinking_level.
- [ ] **Video** — text-to-video (per connector: gemini/Veo, muapi, fal), frame-conditioned
      render, extend. All built, none live-run.
- [ ] **Audio** — ElevenLabs voices/tts/sfx live-run; music and clone gated runs.
- [ ] **Motion graphics** — reference-conditioned gen + alpha key live-run (alpha-key half
      is free and self-tested; the billed half isn't).
- [ ] **LoRA training** — needs a real training-image set from Joseph.
- [ ] **Deepfake/lipsync** — needs a real talking-head clip from Joseph.
- [ ] **ChatRealty** — needs the token entered (vault or `.env.local`).
- [x] Fix the dead `canUseTool` spend-tool backstop in `generation.ts` — DONE 2026-08-30,
      live-verified. `allowedTools` removed (bare server entries shadowed the callback,
      per the SDK's own warning); every call now falls through to a strict gate:
      ToolSearch allowed by name (loads attached servers' schemas), `mcp__*` allowed only
      from THIS RUN'S attached servers (a live run had seen a claude.ai-connected server
      leak in from the operator's session and get waved through), spend/credential regex
      now actually executes, `disallowedTools` kept as the second layer.

### Part four-C — ComfyUI local engine: the $0 image tier (planned 2026-08-30)

Reference (install facts, API, model research, the distro decision):
[connectors/reference/comfyui.md](connectors/reference/comfyui.md). Decision already
closed: attach-or-spawn Joseph's existing source install (`X:\_ai\comfy\ComfyUI`,
v0.34.0, system Python 3.12.7 + nightly torch cu130 + sage attention) — never bundle a
runtime for personal use (the ffmpeg precedent, AGENTS.md §7); a portable
`python_embeded` bundle is distribution-time work if the app ever ships to a machine
without ComfyUI.

- [x] **C1 — wrapper `resources/comfyui-mcp.cjs`** — built + LIVE-VERIFIED 2026-08-30
      (full pipeline pass: harness → agent → wrapper → 3090 → asset store, $0). See the
      reference doc's new gotchas for what the live pass surfaced (dep-skew rule,
      `--disable-all-custom-nodes` spawn, legacy-history polling, 10-min timeout).
      Original spec: **C1 — wrapper.** Dependency-free stdio MCP, same
      pattern as gemini-mcp.cjs. Env: `COMFYUI_URL` (default `http://127.0.0.1:8188`),
      `COMFYUI_PATH` + `COMFYUI_PYTHON` for spawn-if-down (health check
      `/api/system_stats`; spawn with cwd = repo root, then poll health). Tools:
      `comfy_generate_image(prompt, model, aspect_ratio?, width/height?, steps?, seed?)`
      and `comfy_list_models` (which workflow templates are runnable — weights present).
      Flow per call: load workflow template → patch prompt/dims/seed → `POST /api/prompt`
      → poll `/api/history_v2/{id}` → `GET /api/view` → temp file → `RESULT_FILE:`.
      Single-flight queue (one GPU); distinguish "loading model" from "generating" in
      logs. Done when: selftest smoke-tests the wrapper's MCP protocol like the other two
      bundled wrappers.
- [~] **C2 — workflow templates `resources/workflows/*.json`** (API-format graphs +
      `_meta` patch-point blocks): `flux1-schnell` built + verified; still open:
      `z-image-turbo`, `krea2-turbo-fp8`, `qwen-image-2.0`. Each template records its required weight
      files; the wrapper checks presence under the install's `models/` and returns a
      RESULT_ERROR naming the missing downloads instead of a cryptic node failure.
- [~] **C3 — connector + catalog wiring.** DONE: catalog entry (`authType: 'none'`,
      machine-default env), secretless `LYME_IMPORT_CONNECTOR` install path, selftest
      wrapper smoke row, `comfyui:flux1-schnell` in model-catalog with aspect+steps
      params, `steps` plumbed end to end (GenerationParams → prompt → utils → MCP tool →
      UI chip). Open: capability-map row, catalog.md routing note, entries for the three
      not-yet-downloaded models. Original spec: **connector + catalog wiring.** `connector-suggestions.ts` entry id `comfyui`
      (stdio, `authType: 'none'` — the first free connector; env carries url/path/python),
      capability-map row, `model-catalog.ts` entries (`comfyui:z-image-turbo` etc.,
      "$0 · local" notes, per-model `params` incl. steps), routing note in
      `connectors/catalog.md`: free local tier leads storyboard-volume work ahead of
      nano banana 1. Utils/MCP tools/skills need NO changes — comfyui is just another
      connector with `model` choices (the 2026-08-29 param plumbing pays off here).
- [ ] **C4 — live verification.** `LYME_TEST=image LYME_TEST_CONNECTOR=comfyui` against
      flux1-schnell first ($0, no download), then the three recommended models after
      their weights land; record real 3090 timings in the reference doc; check the UI
      pills render the comfyui models with their param surfaces.
- [ ] **C5 — weight download flow.** Guided, not automatic: the connector card lists the
      three downloads (~6–25GB each) with target dirs and HF links; presence check turns
      each model pill from "needs weights" to ready. (`extra_model_paths.yaml` stays an
      option if Lyme-managed weights ever need their own tree.)
- [ ] **C6 — bundled engines (committed goal, built at packaging time).** Joseph's
      direction (2026-08-30): the shipped app — the Mac build especially — must NOT
      require installing ComfyUI or ffmpeg separately. Architecture is resolution order,
      the `resolveFfmpeg()` pattern generalized: **existing install first (env/config
      path), bundled runtime as fallback.** On this Windows rig the existing source
      install always wins (nightly torch + source-built sage attention beat any pinned
      bundle *on this machine* — that's all "don't bundle for personal use" ever meant);
      a fresh machine gets the bundle. Per-platform runtimes: Windows = ComfyUI portable
      (`python_embeded`), macOS = Python + venv with torch-MPS (no CUDA on Apple
      Silicon — a different torch build regardless, so bundles are per-platform by
      necessity). ffmpeg: bundled LGPL build as fallback per AGENTS.md §7. Model weights
      are never bundled (6–25GB each) — the C5 download flow serves both cases.
- [ ] **C7 — the muapi tool families beyond raw generation** (probed live 2026-08-30 —
      full schemas in `userData/connector-tools/muapi.json`; Joseph: "we need all of
      these features"). Each is a small build because the connector + agent + gate
      already exist:
      - [ ] **Suno music node** (`muapi_audio_create`: prompt/title/tags/
            make_instrumental, ~$0.09/full song with vocals) — its OWN node per Joseph;
            plus `muapi_audio_from_text` SFX. A second audio provider beside ElevenLabs.
      - [ ] **Enhance family** — `muapi_enhance_upscale` and `muapi_enhance_bg_remove`
            back the image toolbar's greyed upscale/remove-bg tools;
            `muapi_enhance_face_swap` (source/target/mode) is the Deepfake node's
            face-swap stage ("one model, muapi" — confirmed live); `muapi_enhance_ghibli`
            style transfer.
      - [ ] **Lipsync engines** — `muapi_edit_lipsync` (9 engines, default `sync`):
            the Deepfake lane without Yapper.
      - [ ] **Auto-clipping** — `muapi_edit_clipping` (video_url/num_highlights/
            aspect_ratio): long-form → shorts highlights; a production-mode repurposing
            gem.
      - [ ] muapi workflows (create/execute/status) — parked until a use case demands
            them.
- [ ] **C8 — later.** The Wan 2.1/2.2 fleet already on disk as the free VIDEO tier
      (Joseph ruled out local video for GPU load — revisit only if that changes);
      Krea 2 Raw as a local LoRA-training backend for Trained Styles; deeper reference
      workflows (Krea 2 native refs / Z-Image Omni — need extra weights and per-model
      graphs). **img2img landed 2026-08-30 and is live-verified**:
      comfy_generate_image takes reference_image_path + strength (→ KSampler denoise —
      1 ≈ ignore, 0.6 default, 0.3 ≈ close variation), the wrapper uploads the reference
      via /api/upload/image and swaps the empty latent for LoadImage→ImageScale→VAEEncode
      per the template's _meta.i2i block; all three local models carry it, the model enum
      now rides the tool schema (fixes the agent's phantom-unavailable flake), and the
      panel's REFS uploads flow straight through. (2026-08-30 earlier: REFS square accepts
      direct uploads, not just canvas picks.)

Then: **Part five (unwritten) — production mode**, sequenced from `product/vision.md`
(channel store + memory files, publishing port + approval state machine, scheduler service,
pipeline orchestrator, analytics).

## Cross-cutting, ongoing

Update the relevant spec doc in the same change that implements it. Decisions made mid-build belong back in the `architecture/`, `connectors/`, or `ui/` docs, not just in code — that's how this project's planning has worked so far, and drifting from it is exactly how README's Status section went stale once already.

### Generation was dead: `spawn ENAMETOOLONG` (2026-08-31)

Every generation call failed instantly — before any network request — once the
fifth connector was installed. `buildMcpServers` gave each stdio connector a full
copy of `process.env` (~7 KB each; the comment above it explains why: without
`PATH` the child cannot resolve `node`/`npx`). The SDK carries that map to its
subprocess, and Windows caps a command line at 32,767 characters. Four connectors
≈ 28 KB and worked; five ≈ 35 KB and did not.

- [x] `inheritedChildEnv()` passes only what a child genuinely needs — interpreter
      path, temp dir, Windows system roots — instead of the whole environment.
      Config dropped to ~28 KB across four attached connectors and generation
      works again (verified live: image, then Veo).
- [x] The size is logged with a plain warning when it approaches the ceiling, so
      the next time this bites it says so instead of failing as `ENAMETOOLONG`.
- [ ] Still tight: `PATH` alone is ~2.5 KB per connector. If more connectors get
      installed, trim harder or pass the config by file rather than argv.

Proven end-to-end the same session (all four wizard stages; connector charges: one Gemini
image ≈ $0.07 list, one Veo fast 8 s ≈ $0.90 list — the "$1.12" first reported was the SDK's
token figure, plan consumption, not a bill):
reference-free logo image → locally drawn black start frame → Veo 3.1 fast
start→end interpolation (8 s, forced by `lastFrame`) → alpha key. **The keying
comparison settled 28.1's first item empirically:** `colorkey` punched holes
through the dark half of the logo's gradient; `lumakey` kept the letters solid.

## Phase 28 — Motion graphics ON the timeline: overlays, watermarks, transitions

Provenance: the JBooks Creative tutorial (transcript re-reviewed 2026-08-31; first
reviewed 2026-08-08, which is where `MotionGraphicsWizard` came from). Re-reading it
against the code, **the authoring half is built** — references → agent-authored prompt
variations → batch grid → pick → start/end-frame Veo → alpha key → optional perfect
loop. What does not exist is the half Joseph named: *applying* those graphics to the
timeline and to clips, and transitions of any kind.

### What already ships (do not rebuild)

| Tutorial step | Where it lives |
|---|---|
| 4–5 references in | wizard stage `refs` |
| Prompt variations from references (vision → text) | stage `variations`, via `conversations.ts` |
| Batch generate + compare grid | stage `batch` + `BatchResultsGrid` |
| Solid-colour start frame | drawn locally on a `<canvas>` — no generation call |
| Start-frame → end-frame reveal | `gemini_generate_video` `start_frame_path`/`end_frame_path` (Veo forces 8 s for `lastFrame`) |
| Perfect loop (first frame == last frame) | wizard `loop` flag → `gfx_loop` |
| Key the black out, keep alpha | `keyAlpha` → `colorkey` → VP9/WebM `yuva420p` |
| Alpha survives export | `ffmpeg.ts` decodes VP9 alpha with `libvpx-vp9` |

### Driving the wizard through its own UI (2026-08-31; connector charges ≈ 5 Gemini images + 1 Veo fast 8 s at list)

Ran all six stages by hand in the app rather than through the MCP tools. It works
end to end and the output is good. What the run exposed:

- [ ] **The animate stage defaults to full Veo 3.1 — $0.40/s, so $3.20 for the
      mandatory 8 s.** That is the most expensive option, silently selected, on
      the stage users iterate most. Default to `fast` (~$0.10-0.12/s) and let
      `default` be the deliberate choice for a hero render.
- [ ] **Cost is logged as prose, not data.** `GenerationRecord.note` carries
      `"via gemini · $0.240"` — and that figure was the SDK's TOKEN cost, plan
      consumption on the login, not what Gemini charged. The app has no field for
      either number. Fixed 2026-09-02 for the token half: notes now read
      `tokens $0.240 (plan)` or `$0.240` under a billing provider, and `costUsd`
      is null unless it is a bill. Still missing: the connector's own charge,
      which only the catalog price can estimate (AGENTS.md §1.8).
- [ ] **Agent orchestration dominates small jobs.** The four batch images billed
      $0.207-$0.355 each against a ~$0.067 list price for the image itself,
      because every one goes through a tool-choosing agent turn. Worth a direct
      path for batch stages, where the connector and model are already decided.
- [ ] **Tell the prompt author to keep type in frame.** One variation came back
      "filling the frame edge to edge" and both its images cropped the letters
      off both sides. A one-line constraint in the variations instruction fixes it.
- [ ] **Placing the result is a bare drag** onto Video 2, from a small grip, on a
      canvas that has just re-laid itself out after six new nodes. Attempting it
      grabbed the wrong node. Concrete evidence for 28.2's apply-to-clip button.

Worked exactly as designed: the reference pick, the feedback→revise loop on the
prompt variations, the 2×2 grid, the reference-reinforced final pass, the solid
start frame drawn locally for free (50 KB, no generation call), the 2-second beat
prompt pre-filled, and the alpha node rendering see-through on the canvas.

### 28.1 — Fidelity gaps against the transcript (small, do first)

- [ ] **Luma key, not just colour key.** The tutorial keys black with a *luma* key.
      `buildAlphaKeyArgs` only does `colorkey`, which cuts on colour distance and
      chews the soft edges that glow and gradients are made of — exactly the case
      here, since these logos are gradient-on-black. Add `lumakey` as a mode and
      default to it when the plate is black; keep `colorkey` for green plates.
- [ ] **Glow pass.** The tutorial's "Deep Glow" is an After Effects plugin. A close
      ffmpeg approximation is a blurred copy screened back over the original
      (`split`, `gblur`, `blend=screen`) — cosmetic, cheap, and it makes keyed logos
      read the way the reference does. Optional toggle, off by default.
- [ ] **Batch size configurable.** v1 fixed 2 variations × 2 images = 4 (a deliberate
      cost decision). The tutorial runs 4 × 4 = 16. Make it a control, not a constant,
      and show the projected spend before firing.
- [ ] **Confirm the animate prompt is time-segmented.** The tutorial's Veo prompter
      emits 2-second beats. The wizard's placeholder shows that shape; the agent
      instruction should require it rather than merely suggest it.

### 28.2 — Graphics as timeline objects (the actual gap)

Dropping a generated overlay onto Video 2 already works. What is missing is that the
overlay has no *relationship* to what it sits over — it is just another clip at a
time offset.

- [ ] **`overlay` role on a timeline clip** — `attachedTo?: clipId`, `anchor:
      'start' | 'end' | 'span' | 'cut'`. An anchored overlay moves and retrims WITH
      its base clip instead of drifting the moment the base is nudged. This is the
      difference between "a graphic that happens to be there" and "the lower-third
      that belongs to this shot".
- [ ] **Watermark track** — one clip marked `persistent`, looped for the whole
      timeline duration, excluded from ripple. The tutorial's whole bonus section
      exists to produce this; the app can currently make the asset but has nowhere
      to say "this rides on top of everything".
- [ ] **Apply-to-clip affordance** on the canvas node toolbar and the Cut Room clip
      menu: `→ overlay on selected clip`, `→ watermark whole timeline`. Placement
      today is drag-only, which is fine for one and tedious for many.

### 28.3 — Transitions

Two mechanisms, deliberately both, because they answer different needs:

- [ ] **Generated transitions (build first).** An alpha animation centred on a cut,
      on the track above. Needs no new export machinery — the overlay+alpha path
      already carries it — so this is mostly authoring plus placement. Same wizard,
      a different intent: start frame = last frame of clip A, end frame = first frame
      of clip B, which is precisely what start/end-frame conditioning is for and a
      capability the app already has wired.
- [ ] **Deterministic transitions (build second).** `xfade`/`acrossfade` between two
      adjacent clips on one track. Frame-accurate, free, instant. This is the real
      engineering: the export graph positions clips on a shared canvas and composites,
      whereas `xfade` needs the two inputs *overlapped and consumed in sequence*, so
      each track becomes a concat-with-offsets chain before it reaches the overlay
      stage. Do not fold this into 28.2 — it changes the graph builder.
- [ ] **A transition is an object, not two trimmed clips.** `TimelineTransition
      { id, trackId, betweenClipIds: [a, b], kind, durationSec, source: 'xfade' | assetId }`
      so it can be retimed, swapped, or replaced without re-cutting the clips.

### 28.4 — Reuse: a graphics library

- [ ] **Save a generated graphic as a reusable asset** (name, tags, alpha file,
      loop flag, native duration), stored in the workspace beside projects so it is
      available to every project — the same shape as Trained Styles. The tutorial's
      closing line is that you can make "hundreds or thousands of these"; that is only
      true if they outlive the project that made them.
- [ ] **Moodboard in-app (open question).** The 2026-08-08 decision was that mood
      boarding happens outside the app (`cosmos.so`) and Lyme Hype starts once
      references are in hand. Worth revisiting only if reference-gathering turns out
      to be the friction in practice.
