# Reference notes — jboogx "NIGHT SHIFT"

Notes from screenshots of jboogx's stream, taken from his tool running at `localhost:1985` (a local web app, not a hosted product). Captured 2026-08-07.

## What it is

A custom web app that wraps Claude Code as a branded on-stream co-host ("NIGHT SHIFT — JBoogx HQ") for a content-creation workflow: turn a song into a set of AI-generated visual concepts, then into Seedance-generated video clips.

## Layout

**Left sidebar**
- Pixel-art logo/brand ("jboogxcreative"), magenta/blue accent colors, retro terminal aesthetic.
- Numbered nav: `01 Tonight`, `02 The Darkroom`, `03 The Cut Room`, `04 War Room`, `05 Client Work`, `06 Personal`, `07 Ideas Inbox`, `08 Skills`, `09 Shipped`, `10 Learned` — reads like a personal workflow taxonomy (kanban-ish stages / life areas), not literal folders.
- `COMMS — N CHANNELS` — Discord-style channel list. Each channel is one working project/session (e.g. "119 - Not So Bad", named like a numbered track), tagged with a status badge (`DARKROOM`, `WORKING`, `IDLE`) and a live indicator.
- `+ OPEN CHANNEL` to start a new one.

**Center — chat / session view**
- This is a Claude Code agent session, rendered as a branded chat thread instead of raw terminal output.
- Speaker labels: "NIGHT SHIFT" (the agent) vs "TYLER" (the streamer). The agent refers to itself as "Claude, running in Tyler's HQ as Claude Code" — confirms it's Claude Code / Agent SDK under the hood, just with a custom frontend.
- Tool calls collapse into small inline cards — e.g. "2 OPS Bash — Confirm the MP3 landed in the audio folder" with a "+ DETAIL" expander. Same tool-use trace Claude Code normally prints to a terminal, just given a custom renderer.
- Top bar: session/channel name, version tag (`V1.1.0`), connection status (`LINK STABLE`), context-window usage (`CTX 7%`), a `PANELS` dropdown (panel visibility toggle), live cost readouts (`SESSION $`, `WEEK $`, `TABLE $`), and a `CREATIVE MODE` toggle top-right — possibly swaps system prompt / tool access.
- Bottom input bar: free-text box ("orders for this channel..."), plus model controls exposed as UI buttons: model picker (`OPUS 4.5 - 1M` ctx), reasoning-effort toggle (`THINK HIGH`), and an `AUTO` mode button. This is a skin over the same knobs Claude Code exposes on the CLI (model, thinking budget, permission mode).

**Right — Reference wall**
- An image pinboard. Empty state: "NO IMAGES YET — PASTE ONE INTO THE BAR" — images land here by pasting into the chat input; the UI (or the agent) promotes them to the wall.
- Once populated, filterable by tabs: `ALL` / `IMAGES` / `PENDING` / `VIDEOS` — the same wall holds source images, in-flight generations, and finished clips.

**Right, below — Seedance Console**
- Dedicated panel for driving Seedance 2.0 (video model) through a service called "ArtCraft" — reads like a paid credits/API aggregator (note in UI: "ARTCRAFT DOESN'T EXPOSE CREDITS TO API KEYS YET — CHECK THE APP").
- Prompt-mode tabs: `REFERENCE` / `KEYFRAME` / `TEXT`.
- Three drop targets that create addressable variables the chat can reference: image refs → `@image1`, `@image2`...; a video ref → `@video1`; an audio ref → `@audio1`.
- `+ PULL PROMPT + REFS FROM CHAT` button — one-click handoff of whatever the agent just proposed in chat (prompt text + which reference images) straight into the console fields.
- Negative prompt field; aspect ratio / duration / resolution controls (seen: `1:1`, `15s`, `720p`); audio toggle.
- The agent writes an explicit, ordered **upload map** as a code block in chat — e.g. `119_seam_1-4-f324_midfall.png → @image1 → FRAME ONE: the falling girl mid-air over the neon canyon (pulled from 1-4 @ 13.5s)` — and that map is what actually drives which image fills which console slot. This is the agent doing reference-orchestration for the video model, not just describing a shot in prose.

**Bottom — Cut Room strip**
- "DROP CLIPS HERE" — a clip bin below the console. Shows staged takes with `FILE` / `REJECT` actions, a `SCENE 1 — 8 TAKES` bucket, and an auto-named `INTAKE` bucket. A lightweight review queue for generated takes before they go into an edit.

## Notable behavioral details

- The agent is told to greet stream viewers directly ("say hello to everyone because they can see you on the stream") — the chat pane *is* the stream overlay, not a private tool.
- Tyler corrects the agent's output formatting live ("the upload map needs to be in its own code box above everything... you're making me look bad in front of all my friends on the stream") — the UI is parsing a specific code-block convention out of the agent's replies to drive the console. Breaking that convention visibly breaks the on-stream demo, so the format is a real contract between agent output and UI, not just a nice-to-have.
- One screenshot shows a long structured shot-prompt (partly in Chinese) with fields like `lighting`, `action`, `production_design`, `motion_continuity`, `subtext`, `critical_constraint` — suggests Seedance responds better to a structured multi-field prompt schema than a single free-text description, and the agent authors that schema per shot.
- Everything is scoped to a "channel," Discord-thread style — each song/project gets its own chat history, reference wall, and console state.

## What this implies architecturally

- Almost certainly the Claude Agent SDK embedded in a custom local web app (served on `localhost`, run during broadcasts) — not raw Claude Code CLI in a terminal window.
- The UI has to parse Claude's text output for specific conventions (headed code blocks, `@image`/`@video`/`@audio` tokens) and turn them into interactive state (drag targets, console fields, upload maps). That parsing contract is doing most of the "magic."
- Seedance access goes through a third-party aggregator ("ArtCraft") rather than a direct API — the console UI shape likely mirrors whatever ArtCraft's own submission form needs.
- No visible Midjourney panel in these particular screenshots. Image generation for the Reference wall might be happening through the chat/agent itself (an image-gen tool call) rather than a dedicated console like Seedance has — unconfirmed.

## Open questions for us

- What's actually filling the Reference wall — Midjourney via API/Discord wrapper, or a different model the agent calls directly?
- Is "ArtCraft" just a Seedance reseller/credits wrapper, or does it proxy other video models too?
- Is the left-nav structure (Tonight / Darkroom / Cut Room / War Room / etc.) real, used app structure, or mostly cosmetic during this session?
- Do we want "channels as projects" too, or is that more structure than we need for a v1?
