# Play view

Not a mode of [Canvas/Storyboard/Scripting](canvas-and-storyboard.md). Play is its own full-width destination for reviewing and cutting **one** video or audio node before it goes to the [timeline](timeline.md), and it deliberately takes over the whole body instead of squeezing into the canvas area alongside Sessions and the aside.

**Built (2026-08-08):** `src/renderer/src/components/PlayView.tsx`, wired into `App.tsx` as a full takeover, store actions in `store.ts` (`openPlay`/`closePlay`/`setTrim`/`splitAtPlayhead`/`detachAudio`/`deleteAudio`).

## Design

- **Full takeover, not an overlay.** When Play opens, Sessions and the aside step aside entirely (`App.tsx` gates them on `playNodeId`) — the player gets real size for its preview and transport controls instead of fighting the canvas for space. The timeline stays visible at the bottom, since Send to timeline is the natural next action from here.
- **Back arrow, not a peer toggle.** The toolbar's breadcrumb is replaced by "← Back to [Canvas / Storyboard]" while in Play, driven by `playFrom` — captured from the session's current view at `openPlay` time, so Play returns to wherever it was actually opened from. Play is not reachable from within Play today (no related-clip jump), so a single remembered origin is sufficient; a real nav-stack is only worth building if that changes.
- **Controls are overlaid on the video, not a separate row.** Play/pause, time readouts, and a trim track with draggable in/out handles live in one slim bar at the bottom edge of the video frame.
- **Audio nodes render a glyph + hidden `<audio>`** in the same overlay control pattern, rather than a second boxed component.
- **Trimming is non-destructive.** `trimIn`/`trimOut` (and `audioMuted`) live directly on `MediaNodeData` — not separate editor state that could drift out of sync. Playback clamps and loops to the trim window; reopening Play later shows the full original with the last trim remembered.
- **Split at playhead** patches the source node's `trimOut` and spawns a right-half node (`trimIn = playhead`) back on Canvas — the two nodes *are* the split history, no separate log kept.
- **Detach and delete, scoped to audio.** Detach spawns an independent audio node on Canvas referencing the same file (no confirm needed — nothing is lost, it just becomes two nodes). Delete sets `audioMuted: true` behind a `window.confirm` (destructive to the *current* audio track, unlike trimming) — it's a non-destructive flag today, not a file rewrite; the real mute/strip happens at ffmpeg export time.
- **Entry points:** double-click a video/audio node on Canvas (`onNodeDoubleClick` in `CanvasArea`), or the hover ▶ button on the node thumbnail (`MediaNode`). `openPlay` guards against image nodes.
- **Send to timeline** reuses the same node → timeline path as anywhere else.

## Status

Done per its original done-criteria: a clip can be opened in Play, trimmed, split, have its audio detached or deleted, sent to the timeline, and the back arrow returns to wherever it was opened from. Verified with uploaded/linked clips; a real generated clip exercises the identical path since generation writes the same `MediaNodeData` shape.
