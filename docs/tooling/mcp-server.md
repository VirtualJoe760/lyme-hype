# The app as an MCP server

Built 2026-08-29. `electron . --mcp` boots Lyme Hype headless (no window, no IPC) and
exposes the creative pipeline as typed MCP tools — the inverse of the connector system:
the app usually *consumes* MCP servers; this mode makes it *serve* one, so Claude Code (or
any MCP client — later Venus/thinkbigjoe) can drive generation without the UI.

## Transport — why there's a bridge

Electron on Windows crashes (0xC0000005) the moment the main process reads a piped stdin
(verified against Electron 38). So MCP clients spawn `resources/lyme-mcp-bridge.cjs` — a
dependency-free plain-Node process that speaks stdio to the client and relays it over a
named pipe. The Electron side reads the pipe via `net`, which works everywhere. Project
registration lives in `.mcp.json` (`command: node resources/lyme-mcp-bridge.cjs`).

## One backend per machine (2026-09-02)

Until 2026-09-02 every bridge booted its own `electron . --mcp`, so each open Claude Code
session was a full copy of the app — and the studio a further one. Two sessions plus the
studio put three copies on the same GPU and RAM, and one of them hosted the ComfyUI that
another tool drove to 43 GB committed on a 32 GB machine. Now (`src/main/mcp-hub.ts`):

- **The pipe name is fixed** (`\\.\pipe\lyme-hype-mcp`). Whoever listens on it is the
  backend. A bridge connects; only if nothing answers does it spawn a headless backend
  (detached — it belongs to the machine, not the session).
- **A headless backend serves every bridge** (one connection each, stateless per message)
  and exits a minute after the last one disconnects. A second headless that loses the
  race for the pipe exits immediately.
- **The studio takes over while it is open.** On boot it asks a headless backend to step
  aside (a `{"lyme":"handoff"}` line), then listens itself. Sessions then drive the live
  studio and share its one ComfyUI, watchdog and all. On quit it drops the pipe and the
  bridges spawn a headless backend again.
- **Bridges reconnect transparently.** On a backend change the bridge reconnects, replays
  the client's `initialize` handshake (swallowing the duplicate reply), and answers any
  tool call that was in flight with an error telling the client to retry — instead of
  hanging forever.

Diagnostics of a headless backend go to `boot.log` in userData (its stdio is ignored).
`hubClientCount()` is the number of bridges currently connected.

**The server runs the BUILT bundle** (`out/main/index.js`) — run `npm run build` after any
main-process change or the server keeps serving stale code.

## Tools (14)

`list_generation_connectors` (free diagnostic — installed connectors + credential status) ·
`generate_image` (prompt, connector_id?, model?, image_size?, thinking_level?, aspect_ratio?,
reference/character/style_reference_paths?) ·
`generate_video` (prompt, connector_id?, model?, resolution?, duration_seconds?,
person_generation?, reference_image_paths?, start/end_frame_path?) ·
`extend_video` · `generate_speech` (verbatim text) · `generate_sound_effect` ·
`generate_music` · `list_voices` · `clone_voice` (persistent — explicit user confirmation) ·
`lipsync` (face_video_path + audio_path|speech_text) · `key_alpha` (colorkey → VP9-alpha
webm, free) · `isolate_audio` (free) · `train_lora_style` (expensive — explicit
confirmation) · `pull_listing_photos`.

Results are one JSON text block: `{ ok, path?, assetUrl?, note?, costUsd?, error?, ... }` —
`path` is the on-disk file. `costUsd` is the SDK's orchestration figure; actual money is
the connector's own charge (see the cost rule in the project memory: cost = dollars
actually billed).

Protocol: newline-delimited JSON-RPC, hand-rolled, same shape as
`resources/gemini-mcp.cjs` — no SDK dependency. Same pattern for adding tools: entry in
`TOOLS` + handler in `HANDLERS` in `src/main/mcp-server.ts`.
