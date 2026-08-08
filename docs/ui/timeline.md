# Timeline (multitrack)

**Not built yet.** This replaces the current Cut Room's thumbnail-node strip (`src/renderer/src/components/CutRoom.tsx`) with a real time-based multitrack timeline, closer to Final Cut Pro / Premiere Pro than to a clip bin. The current implementation is a single implicit sequential channel — clips in array order, reordered with ◀▶ buttons, concatenated one after another with no independent timing. That's fine for "append clips, export in order," which is all it was asked to be at Phase 7. It stops being fine the moment two things need to happen at once — a voiceover under a montage, a motion-graphics overlay on top of a clip, music under the whole reel — which is exactly the reel-editing reality this doc addresses.

## Precedent

Both reference tools this project draws on (`../history.md`) pointed at a real timeline directly: jboogx's Cut Room strip was explicitly a placeholder ("drop clips here" review queue, not a real edit surface), and the stephenlawyer.clothing canvas's drag-to-combine pattern — drop-onto-target for placement, drag-onto-existing for a contextual dialog — is the direct interaction model this timeline reuses: drop a clip onto a track to place it, drag clip-onto-clip for a transition dialog instead of a silent cut.

## Visual model

- A horizontal time axis with a **ruler** (timecodes, zoomable — clips range from a couple of seconds to a full generated video, so a fixed pixels-per-second scale doesn't work across that range).
- **Tracks stack vertically**, each spanning the full ruler width. A track has a type (video or audio), a name, and standard per-track controls: mute, solo, lock.
- **Default track set for a reel edit** (not a hard cap — tracks can be added/removed, this is just the sensible starting layout): **Video 1** (the main cut), **Video 2** (overlay / motion graphics, composited on top), **Audio 1** (voice), **Audio 2** (music). Four tracks covers the realistic case this app is actually for — a talking-head or narrated reel with a music bed and an occasional graphic overlay — without building toward full NLE track-count scale nobody needs here.
- **A clip is a rectangle positioned in time**, not a list entry — its horizontal position is its start time on that track, its width is its duration (after trim). Clips on the same track can't overlap; clips on different tracks can (that's the whole point of Video 2 / Audio 2).
- **Playhead**, scrubbable by clicking/dragging the ruler, drives a live preview (composited, not just the top track) — this is the timeline's own preview, separate from Play view's single-clip preview.

## Data model changes

Today's `CutClip` (`src/shared/types.ts`): `{ id, nodeId, label, mediaType, swatch }` — order is implicit (array position), timing is implicit (sequential, no gaps, no overlap possible even if wanted).

A multitrack `TimelineClip` needs to add:

- `trackId: string` — which track it's on.
- `startTime: number` — seconds from the timeline's zero, this instance's position (independent of any other instance of the same source node).
- `trimIn` / `trimOut: number` — **the timeline clip's own trim, not necessarily the same as the source node's `trimIn`/`trimOut` set in Play view.** This is a deliberate design decision: the same source asset might appear on the timeline twice with two different cuts (a B-roll shot reused as a bookend, say). Defaulting a newly-added timeline clip's trim to the node's current Play-view trim (so "what you saw in Play is what you get") makes sense as the *initial* value, but the two need to be independently editable after that — the timeline clip is its own edit, not a live mirror of the node.
- `duration` derives from `trimOut - trimIn`, not stored separately.

Tracks themselves need a small model: `{ id, type: 'video' | 'audio', name, muted, locked, order }` — persisted per-session alongside `cutRoom`, replacing the flat clip array with `{ tracks: Track[], clips: TimelineClip[] }`.

## Interactions

- **Add a clip:** drag a ready video/audio node from Canvas (or the existing Send-to-timeline button, extended) onto a track at a specific time — not just appended to the end. Dropping onto the ruler's current end-of-content is the common case and should feel like today's append; dropping mid-timeline or on a specific track is the new capability.
- **Reposition:** drag a clip left/right along its track (ripple the clips after it, or overwrite — ripple is the sane default for a reel edit where gaps are rarely wanted).
- **Move between tracks:** drag a clip vertically onto a different compatible-type track.
- **Retrim:** drag a clip's left/right edge, same interaction language as Play view's trim handles, just happening in-place on the timeline instead of in a separate full-takeover view. Play view remains the place for *first* reviewing and roughly cutting a clip before it's on the timeline at all (see [play-view.md](play-view.md)) — the timeline is for arranging and fine-tuning clips that are already placed.
- **Split at playhead:** works directly on the timeline now, not just in Play — park the playhead, split the clip under it into two independent `TimelineClip`s at that point.
- **Clip-onto-clip → transition dialog.** Dragging one clip so it overlaps the start/end of an adjacent clip on the same track opens a transition choice (cut / crossfade / wipe) instead of silently overlapping — direct reuse of the stephenlawyer merge-dialog pattern. A stretch goal, same as it was in the old Cut Room spec; append + reposition + retrim ships first.
- **Remove:** unchanged in spirit — a clip comes off the timeline without affecting its source node.

## ffmpeg export consequences

`buildConcatArgs` (`src/main/ffmpeg.ts`) today builds one linear `filter_complex`: per-clip trim → scale/pad/fps normalize → `concat`. That's correct for one sequential track and stops being correct the moment a second video track or a second audio track needs to be composited rather than concatenated.

A multitrack export needs the filter graph to change shape, not just grow:

- **Video 1** (the base track) still concatenates the way it does today.
- **Video 2** (overlay) needs `overlay` filters compositing its clips onto the base at their actual timeline positions — not appended after, layered on top during their time window.
- **Audio tracks** (voice, music, and Video 1/2's own embedded audio where not muted) need `amix` to blend down to one output audio stream, respecting each track's mute state and each clip's position/duration.
- This is a real rewrite of the export builder, not a parameter tweak — worth budgeting as its own implementation chunk when this phase starts, not assumed to fall out of the current single-track code for free.

## Open questions

- **Ripple vs. overwrite as the reposition default** — ripple (push later clips) feels right for a reel edit but needs to feel predictable, not surprising, once there's real multitrack content to bump into.
- **How many tracks is "enough" before it needs to become fully dynamic UI** (add/remove track buttons) vs. a fixed four-track starting layout that's good enough for v1 — leaning toward shipping the fixed four-track layout first and adding track management once it's clear more is actually needed.
- **Zoom UX** — pixels-per-second needs a control (scroll-wheel zoom, a zoom slider, fit-to-window) given the wide duration range clips can have; not designed yet.
- **Does Play view's trim and the timeline clip's trim ever need to stay linked** (e.g. "reset to Play's trim" action) rather than fully diverging once placed — leaning toward independent-after-placement (see Data model above) but worth revisiting once real usage shows whether that's confusing.

## Done when

Two or more video clips on separate positions of Video 1, at least one overlay clip on Video 2 during part of that span, a voice clip on Audio 1 and a music bed on Audio 2, export as one correctly-composited file — proving the ffmpeg rewrite actually handles overlap and mixing, not just sequencing.
