# Canvas node model

Lyme Hype's own spec, evolved from the stephenlawyer.clothing precedent (see [reference-notes-stephenlawyer-canvas.md](reference-notes-stephenlawyer-canvas.md)). Current design, nothing built yet.

## Connections (MCP) — this changes "Generate"

Generation tools aren't hardcoded integrations. Lyme Hype's agent is a Claude Agent SDK session, and the Agent SDK is natively an MCP client — the same model Claude Desktop and Claude Code already use. So Seedance, an ElevenLabs-style audio tool, an image-gen platform, and **ChatRealty** all show up the same way: as a **connection** the user adds, not a bespoke API integration we build and maintain per provider — and critically, the connector model is generic enough for the user to add one we've never heard of, not just the ones we've pre-templated.

Concretely, this is what makes "listing video" a real feature: connect ChatRealty, and the agent can search a listing, pull its real photos, and hand them straight to the canvas as image nodes — from one prompt in the aside, no manual download-and-drag. The same pattern applies to any other platform the user connects, generative or data.

**Built (2026-08-08):** the ChatRealty half of this is live. The aside's ChatRealty card takes a query, calls `search_listings` + `get_listing_photos` over the stdio MCP connection, and drops the returned photos on the canvas as real Image nodes (badged `mls`). Current cut uses deterministic tool calls rather than a full agent turn — cheaper and more predictable for a photo pull; the natural-language, agent-chooses-the-tool version is a Phase 4 enhancement.

This also resolves the earlier open question about ElevenLabs being three different providers (voice/music/SFX) — it doesn't matter. Each is just whatever MCP server(s) the user connects; Lyme Hype doesn't special-case any of them.

Full mechanism — the generic connector shape, the agent-as-setup-copilot flow, and how credentials are kept out of the agent's own context entirely — is its own doc now: [connections-and-credentials.md](connections-and-credentials.md).

## Node types and how they get onto the canvas

Every node has a media type and a source method. The source method is what changed — canvas nodes aren't generate-only anymore.

| Type | Generate (via a connection) | Upload | Link |
|---|---|---|---|
| **Image** (keyframe / still) | any connected image-gen tool, or pulled from a data connection like ChatRealty (real listing photos) | local file | — |
| **Video** | Seedance, or whatever video-gen connection is active | local file | paste a web URL (Vimeo/YouTube/direct `.mp4`, etc.) |
| **Audio** | ElevenLabs-style voice/music/SFX connection(s) | local file (`.mp3`/`.wav`) | not requested yet — see open questions |

A "link" node isn't just a bookmark — ffmpeg needs a local file to cut, so pasting a link means Lyme Hype downloads/transcodes it into our own asset pipeline before it's usable, not just stores the URL as a reference.

## Actions

- **Combine** — drag one node onto another. Per the stephenlawyer precedent: design-onto-template style combination, adapted for our media (e.g. a motion-graphics overlay dragged onto a clip → composite dialog).
- **Send to timeline** — available on **Video** and **Audio** nodes only. Pushes the node into the Cut Room, which is the real ffmpeg-driven timeline (see the platform direction note in [README.md](README.md)). Image / motion-graphics-still nodes aren't timeline-eligible on their own — they have to be combined into a rendered video node first.
- **Subtitles** — generated via a connected speech-to-text tool (a Whisper-based MCP connection, most likely — not a bespoke integration), then burned in or muxed by ffmpeg at Cut Room export. ffmpeg handles the encoding side only; it doesn't produce the caption text itself. See [platform-decisions.md](platform-decisions.md#ffmpeg-dependency-cut-room--play--subtitles).
- **Publish** — Cut Room's export can go straight to a connected social account (Instagram, YouTube) instead of just a local file. This is not an MCP connection like the ones above — see [connections-and-credentials.md](connections-and-credentials.md#publishing-accounts-instagram-youtube-etc--a-different-thing-from-mcp-connections) for why, and for the one hard rule that comes with it (publishing is immediate, not draftable).

## Sessions (left rail)

The left rail is called **Sessions**, modeled on Claude Desktop's chat list rather than jboogx's ten-category sidebar. Sessions are nameable/renameable, same as renaming a Claude chat. A session still scopes its own canvas state, generated assets, and chat/agent history — the rename is about the label, not a change to what a session *is*.

## Storyboard view

A second mode of the same canvas, toggled in its top-right corner (`Canvas` / `Storyboard`) — not a separate screen. Where the canvas is normally a freeform space for combining already-generated nodes, Storyboard is a sequential grid for **planning shots before spending a real generation**:

- Each panel is a prompt + a rough sketch placeholder + shot metadata (duration, status) — deliberately cheap, no image/video/audio model call happens just from adding a panel.
- A panel is **promoted** when you're ready to actually generate it — promoting spawns a real node (image/video/audio, per the table above) back on the normal Canvas view. The two views share state; a promoted panel and its resulting node are the same underlying thing, viewed two ways.
- The "Add to canvas" aside works the same way in both modes — in Storyboard, its primary button reads **Add panel** (cheap) instead of **Generate** (real spend), so which mode you're in is never ambiguous from the form alone.
- The point is cost control for exploration: block out ten shots as panels, look at the sequence as prompts + rough sketches, and only pay for the ones that survive.

## Play view

Not a third canvas toggle — Canvas and Storyboard stay a 2-way toggle. Play is its own full-width destination for reviewing and cutting **one** video or audio node before it goes to the timeline, and it deliberately takes over the whole body instead of squeezing into the canvas area alongside Sessions and the Add-to-canvas rail:

- **Full takeover, not an overlay.** When Play opens, Sessions and the aside step aside entirely — the player gets real size for its preview and transport controls instead of fighting the canvas for space. Cut Room stays visible at the bottom, since Send to timeline is the natural next action from here.
- **Back arrow, not a peer toggle.** The toolbar's breadcrumb is replaced by "← Back to [Canvas / Storyboard]" while in Play — it returns to whichever view was open before Play was entered, not always Canvas by default. This is a drill-down, not a mode switch.
- **Controls are overlaid on the video, not a separate row.** Play/pause, time readouts, and trim handles live in one slim bar at the bottom edge of the video frame — the video itself gets the space, not a stack of boxed components with tools sandwiched between them.
- **Audio is a thin strip below the video, not a second boxed component.** A compact waveform with its own trim handles, sized to grab easily rather than to look important — it should read as "the audio track of this clip," not as an unrelated second asset.
- **Detach and delete, scoped to audio.** Detach pulls the audio out as its own independent node on Canvas; delete removes it from the clip outright. Both act on the audio track specifically, never the video.
- **Trimming is non-destructive.** It sets in/out points on the node's own data, not a cut of the underlying generated file — reopening Play later shows the full original with the last trim remembered.
- **Split at playhead** turns one clip into two nodes back on Canvas — the way to pull three good seconds out of a longer generation without regenerating it.
- Reachable by double-clicking any video/audio node on Canvas or Storyboard, or an explicit "Open in Play" action — either way, the back arrow is what gets you home.

## Open questions

- Does audio need link-import too (a shared Dropbox/SoundCloud link, say), or is upload + generate enough for v1? Not explicitly requested — flagging as a natural extension, not a decision. (The Phase 2 UI reflects the current answer: the link input only activates on the Video/Motion tabs.)
- ~~Play's non-destructive model implies in/out points (and split history) persist per node — worth confirming that's stored alongside the node itself rather than as separate editor state that could drift out of sync.~~ Confirmed in the Phase 5 build: `trimIn`/`trimOut` (and `audioMuted`) live on `MediaNodeData`, so they persist with the session and can't drift from the node. Split writes the same fields onto both halves rather than keeping a separate split history — the two nodes *are* the history.
- ~~Back-navigation needs to track more than "last view" if Play can be opened from either Canvas or Storyboard — probably a small nav stack rather than a single remembered state.~~ Resolved for v1 with a single `playFrom` value captured at `openPlay` (the session's current `view`). Play is not reachable from within Play today, so a one-level remembered origin is sufficient; revisit the nav-stack idea only if a related-clip jump inside Play is ever added.
- ~~Delete-audio needs a confirm step somewhere (even a lightweight one) since it's destructive to the clip's current audio track — unlike trimming, which is explicitly non-destructive. Detach doesn't need one; nothing is lost, it just becomes two nodes.~~ Done: Delete audio is behind a `window.confirm` in Play; Detach fires with no prompt. (Delete is currently a non-destructive `audioMuted` flag, not a file rewrite — the real mute/strip happens at ffmpeg export in Phase 7, so it's reversible until then.)
- ~~For video links: confirm the download-and-transcode step happens automatically on paste, not as a separate manual step.~~ Confirmed in the Phase 2 build: pasting a link immediately puts the node into the "Rendering…" state — the same state real download/transcode will occupy in Phase 4 — so a linked node never looks ready before it is.
- Connection auth and setup mechanics — how a connector actually gets added, how credentials are collected without the agent ever seeing them — now live in [connections-and-credentials.md](connections-and-credentials.md) rather than here.
