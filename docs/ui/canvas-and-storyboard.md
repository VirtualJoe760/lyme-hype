# Canvas and Storyboard

The first two of the three middle-panel views (the third is [scripting-panel.md](scripting-panel.md)). Canvas is the spatial workspace for combining already-generated nodes; Storyboard is a sequential-panel mode of the same underlying state for planning shots before spending a real generation.

## Connections (MCP) — this changes "Generate"

Generation tools aren't hardcoded integrations. Lyme Hype's agent is a Claude Agent SDK session, and the Agent SDK is natively an MCP client — the same model Claude Desktop and Claude Code already use. So every generation tool and data tool (**ChatRealty**) shows up the same way: as a **connection** the user adds, not a bespoke API integration built and maintained per provider — and critically, the connector model is generic enough for the user to add one Lyme Hype has never heard of, not just the ones pre-templated. Full mechanism in [../connectors/model.md](../connectors/model.md); which specific tools are connected and why in [../connectors/catalog.md](../connectors/catalog.md).

**Built (2026-08-08):** Generate is agent-driven end to end. The aside's Generate button and a promoted Storyboard panel (see below) both call `src/main/generation.ts`, which attaches every installed connector to the Claude Agent SDK as an MCP server and lets the agent pick the right tool for the requested media type, returning a strict result line that gets imported as a real asset. `canUseTool` hard-denies any non-MCP tool, so the on-machine agent can never touch Bash/Write/etc. — see `../connectors/catalog.md`'s "Wiring the tiers" section for what's *not* yet built (per-connector routing restrictions).

## Node types and how they get onto the canvas

Every node has a media type and a source method.

| Type | Generate (via a connection) | Upload | Link |
|---|---|---|---|
| **Image** (keyframe / still) | any connected image-gen tool (Midjourney via muapi, Gemini, OpenAI — see the catalog), or pulled from a data connection like ChatRealty (real listing photos) | local file | — |
| **Video** | muapi (Seedance primary, Kling/Veo/Flux fallback), or whatever video-gen connection is active | local file | paste a web URL (Vimeo/YouTube/direct `.mp4`, etc.) |
| **Audio** | ElevenLabs (voice/music/SFX) | local file (`.mp3`/`.wav`) | not requested yet — see open questions |

Both Upload and Link are **real and built**: Upload uses a native file picker that copies into the asset store; Link downloads the URL into the same store before the node is usable — a "link" node isn't a bookmark, ffmpeg needs a local file to cut. Media type is inferred from the file extension; the resulting `lyme-asset://` URL is what `MediaNode` renders as a real `<video>`/`<img>`/waveform and what Play view actually plays.

## Actions

- **Combine** — drag one node onto another. Per the stephenlawyer.clothing precedent (see `../history.md`): design-onto-template style combination, adapted for our media (e.g. a motion-graphics overlay dragged onto a clip → composite dialog).
- **Send to timeline** — available on **Video** and **Audio** nodes only, once `status === 'ready'`. Pushes the node into the timeline (see [timeline.md](timeline.md)). Image / motion-graphics-still nodes aren't timeline-eligible on their own — they have to be combined into a rendered video node first.
- **Subtitles** — generated via a connected speech-to-text tool (a Whisper-based MCP connection, most likely — not a bespoke integration), then burned in or muxed by ffmpeg at export. ffmpeg handles the encoding side only; it doesn't produce the caption text itself. See `../architecture/platform-decisions.md`. **Not yet built.**
- **Publish** — the timeline's export can go straight to a connected social account instead of just a local file. Not an MCP connection — see [../connectors/publishing.md](../connectors/publishing.md) for why, and for the one hard rule that comes with it (publishing is immediate, not draftable).

## Sessions (left rail)

The left rail is called **Sessions**, modeled on Claude Desktop's chat list rather than jboogx's ten-category sidebar (see `../history.md`). Sessions are nameable/renameable, same as renaming a Claude chat. A session still scopes its own canvas state, generated assets, and chat/agent history — the rename is about the label, not a change to what a session *is*.

## Storyboard view

A second mode of the same middle panel, toggled alongside Canvas and Scripting — not a separate screen. Where the canvas is normally a freeform space for combining already-generated nodes, Storyboard is a sequential grid for **planning shots before spending a real generation**:

- **Built (2026-08-08):** `src/renderer/src/components/StoryboardView.tsx`. Each panel is `MediaNodeData` with `panel: true` + `panelOrder` — a panel *is* a node, not a separate collection, which is what makes "promoting" literal rather than a copy. The Canvas filters nodes to `!panel || promoted`; Storyboard shows `panel === true` ordered by `panelOrder`.
- Each panel card: media-type toggle (video/image/audio), an editable shot label, a note textarea (the generation prompt — feeds `generateMedia` when promoted), reorder ◀▶, delete, and Promote. Adding a panel is deliberately cheap — no generation call happens just from adding one.
- **Promote** flips `promoted: true` + `status: 'rendering'` on the *same* node object and gives it a canvas position, then switches to Canvas so the result appears there. If the panel has a note, promote calls `generateMedia` for real; without one it falls back to a stub-ready timer. A promoted panel stays visible in Storyboard, marked "On canvas →," with its media-type toggle locked.
- **Where the Scripting panel connects in:** a script broken into shots can hand each shot's "feeling"/intent straight into a panel's note field — see [scripting-panel.md](scripting-panel.md) for the handoff.
- The point is cost control for exploration: block out ten shots as panels, look at the sequence as prompts + rough sketches, and only pay for the ones that survive — and per `../connectors/catalog.md`, promoting to a *real* generation should eventually route to the production tier (Midjourney) rather than whatever cheap model was used to sketch it, once tier-routing is wired.

## Open questions

- Does audio need link-import too (a shared Dropbox/SoundCloud link, say), or is upload + generate enough? Not explicitly requested — flagging as a natural extension, not a decision. The current UI reflects the current answer: the link input only activates on the Video/Motion tabs.
- Connection auth and setup mechanics live in [../connectors/model.md](../connectors/model.md) rather than here.

## Tidy and Groups (2026-09-03)

**Tidy** lines nodes up by media type (a row of photos, a row of videos, a row of audio)
without reordering them. **Groups** are named frames: select nodes, Group, drag the frame
and everything in it follows; rename inline; Ungroup keeps positions. Stored as a
`type: 'group'` node plus `parentId` on its members (`docs/build-plan.md`, same date).
