# Timeline (multitrack)

**Not built yet.** This replaces the current Cut Room's thumbnail-node strip (`src/renderer/src/components/CutRoom.tsx`) with a real time-based multitrack timeline, closer to Final Cut Pro / Premiere Pro than to a clip bin. The current implementation is a single implicit sequential channel — clips in array order, reordered with ◀▶ buttons, concatenated one after another with no independent timing. That's fine for "append clips, export in order," which is all it was asked to be at Phase 7. It stops being fine the moment two things need to happen at once — a voiceover under a montage, a motion-graphics overlay on top of a clip, music under the whole reel — which is exactly the reel-editing reality this doc addresses.

**Requirement checklist (2026-08-08), so this is unambiguous for an autonomous build:** accepts both audio and video ✓ (§Visual model), slicing tools ✓ (§Interactions — a general razor tool, not just split-at-playhead), overlay motion graphics on top of clips ✓ (§Visual model's Video 2+ tracks, §ffmpeg export consequences' `overlay` filter, and directly consumes `../ui/create-panel.md`'s Motion graphics tile output), stack clips using different tracks ✓ (§Visual model — dynamic track count, not capped), mute **and** solo per track ✓ (§Interactions defines both explicitly, including the distinction between them). Every open question from the first draft of this doc that could block an autonomous build has been resolved to a firm default below — remaining open items are genuinely non-blocking (see §Open questions).

## Precedent

Both reference tools this project draws on (`../history.md`) pointed at a real timeline directly: jboogx's Cut Room strip was explicitly a placeholder ("drop clips here" review queue, not a real edit surface), and the stephenlawyer.clothing canvas's drag-to-combine pattern — drop-onto-target for placement, drag-onto-existing for a contextual dialog — is the direct interaction model this timeline reuses: drop a clip onto a track to place it, drag clip-onto-clip for a transition dialog instead of a silent cut.

## Visual model

- A horizontal time axis with a **ruler** (timecodes, zoomable — clips range from a couple of seconds to a full generated video, so a fixed pixels-per-second scale doesn't work across that range). **Zoom: scroll-wheel over the ruler is the primary control** (same affordance Premiere/FCP both use), plus a "fit to window" button. Decided, not left open — an autonomous build needs a concrete control, not just "a zoom control TBD."
- **Tracks stack vertically**, each spanning the full ruler width. A track has a type (video or audio, locked at creation — a video track holds video/image-composited clips, an audio track holds audio clips; no mixed-type tracks, matching how every mainstream NLE does it) and a name.
- **Tracks are dynamic, not capped.** A "+ Add track" control (video or audio) is in scope for v1, not deferred — stacking depth genuinely needs to be open-ended ("stack clips on top of each other using different tracks," not "stack up to exactly two"). The **default starting layout** when a session first gets a timeline is still a sensible four: **Video 1** (the main cut), **Video 2** (overlay / motion graphics, composited on top), **Audio 1** (voice), **Audio 2** (music) — that covers the realistic case (a narrated reel with a music bed and an occasional graphic overlay) without an empty timeline being intimidating, but the user can add more of either type freely from there.
- **A clip is a rectangle positioned in time**, not a list entry — its horizontal position is its start time on that track, its width is its duration (after trim). Clips on the same track can't overlap; clips on different tracks can (that's the whole point of multiple video/audio tracks).
- **Clip content is visible, not just a labeled box.** Audio clips render a waveform (reuse `MediaNode.tsx`'s existing `Waveform` SVG component — same visual language as a canvas audio node). Video clips render at minimum a static poster frame (the node's existing thumbnail); a scrubbing filmstrip is a nice-to-have, not required for v1 — a static frame is an acceptable first cut.
- **Playhead**, scrubbable by clicking/dragging the ruler, drives a live preview (composited, not just the top track) — this is the timeline's own preview, separate from Play view's single-clip preview.
- **Per-track controls: mute and solo, distinct behaviors, both required.**
  - **Mute** silences (audio tracks) or hides (video tracks, meaning the track's content is skipped in compositing) that track — a real, persistent state that affects both live preview **and** export.
  - **Solo** is a *monitoring* convenience only, standard NLE behavior: soloing one or more tracks silences every other track **in the live preview only**, to let you listen to/watch just that track while editing. **Solo never affects export** — export always respects mute state alone, never solo state. This distinction matters enough to state explicitly, since it's the one part of "mute and solo" that's easy to get subtly wrong (a solo state that leaked into export would silently drop tracks from the real output).
  - **Lock** (present in the data model, not explicitly requested but standard alongside mute/solo) prevents accidental edits to a track's clips — included for completeness, not a hard requirement.

## Data model changes

Today's `CutClip` (`src/shared/types.ts`): `{ id, nodeId, label, mediaType, swatch }` — order is implicit (array position), timing is implicit (sequential, no gaps, no overlap possible even if wanted).

A multitrack `TimelineClip` needs to add:

- `trackId: string` — which track it's on.
- `startTime: number` — seconds from the timeline's zero, this instance's position (independent of any other instance of the same source node).
- `trimIn` / `trimOut: number` — **the timeline clip's own trim, not necessarily the same as the source node's `trimIn`/`trimOut` set in Play view.** This is a deliberate design decision: the same source asset might appear on the timeline twice with two different cuts (a B-roll shot reused as a bookend, say). Defaulting a newly-added timeline clip's trim to the node's current Play-view trim (so "what you saw in Play is what you get") makes sense as the *initial* value, but the two need to be independently editable after that — the timeline clip is its own edit, not a live mirror of the node.
- `duration` derives from `trimOut - trimIn`, not stored separately.

Tracks themselves need a small model: `{ id, type: 'video' | 'audio', name, muted, soloed, locked, order }` — persisted per-session alongside `cutRoom`, replacing the flat clip array with `{ tracks: Track[], clips: TimelineClip[] }`. `soloed` is UI/preview state; it must never be read by the export path (see §Visual model's mute/solo distinction) — worth a code comment at the export call site given how easy that distinction is to lose in a rewrite.

## Interactions

- **Add a clip:** drag a ready video/audio node from Canvas (or the existing Send-to-timeline button, extended) onto a track at a specific time — not just appended to the end. Dropping onto the ruler's current end-of-content is the common case and should feel like today's append; dropping mid-timeline or on a specific track is the new capability. **Motion graphics output** (`../ui/create-panel.md`) is the concrete case that exercises Video 2+: a generated overlay/watermark clip drags onto Video 2 positioned over whatever span of the Video 1 base clip it should appear during.
- **Add / remove a track:** an explicit "+ Add track" control (choose video or audio) — see §Visual model, dynamic track count is a firm v1 decision. Removing a track removes its clips from the timeline (not from their source nodes).
- **Reposition:** drag a clip left/right along its track. **Decided: ripple** (later clips on the same track shift to absorb the move) is the default — a reel edit rarely wants a silent gap, and ripple is the less-surprising choice once real content is on the timeline. Overwrite is not offered as a mode toggle in v1; revisit only if ripple proves wrong in practice.
- **Move between tracks:** drag a clip vertically onto a different track of the same type (video clips only move between video tracks, audio between audio — no silent type conversion).
- **Retrim:** drag a clip's left/right edge, same interaction language as Play view's trim handles, just happening in-place on the timeline instead of in a separate full-takeover view. Play view remains the place for *first* reviewing and roughly cutting a clip before it's on the timeline at all (see [play-view.md](play-view.md)) — the timeline is for arranging and fine-tuning clips that are already placed.
- **Slicing tools — two, not one.** (a) **Split at playhead**: park the playhead, split whatever clip is under it on the active track. (b) **A general razor/blade tool**: click anywhere along a clip's body to cut it at that exact point, independent of the playhead — the more general tool; split-at-playhead is really just the common-case shortcut of parking the playhead first and using the same underlying cut operation. Both produce two independent `TimelineClip`s at the cut point, same as Play view's split.
- **Snapping.** While dragging a clip (reposition, retrim, or a fresh drop), it snaps to: the playhead, the start/end edges of nearby clips (same track or others), and whole-second ruler marks. Toggleable (a magnet icon, matching the convention every mainstream NLE uses), on by default. Not in the original draft of this doc — added because dragging without snapping in a real multitrack timeline is genuinely painful, not a nice-to-have.
- **Clip-onto-clip → transition dialog.** Dragging one clip so it overlaps the start/end of an adjacent clip on the same track opens a transition choice (cut / crossfade / wipe) instead of silently overlapping — direct reuse of the stephenlawyer merge-dialog pattern. A stretch goal, same as it was in the old Cut Room spec; append + reposition + retrim + slicing ship first.
- **Remove:** unchanged in spirit — a clip comes off the timeline without affecting its source node.

## ffmpeg export consequences

`buildConcatArgs` (`src/main/ffmpeg.ts`) today builds one linear `filter_complex`: per-clip trim → scale/pad/fps normalize → `concat`. That's correct for one sequential track and stops being correct the moment a second video track or a second audio track needs to be composited rather than concatenated.

A multitrack export needs the filter graph to change shape, not just grow. **Track order (lowest video-track number = base) decides compositing order** — the lowest-numbered video track concatenates as the base image; every video track above it layers on top via `overlay`, in ascending order, at its clips' actual timeline positions (not appended after — layered during their time window only):

- **The base video track** (whichever is lowest-numbered/first) concatenates the way today's single-track export already does.
- **Every video track above it** needs `overlay` filters compositing its clips onto the running base at their timeline positions. `ffmpeg`'s `overlay` filter natively handles both cases this app needs without special-casing: an overlay clip **with** an alpha channel (Motion graphics output, per `../ui/create-panel.md`'s ffmpeg luma-key step) blends by its alpha; an overlay clip **without** one draws opaquely at its position/size (a plain picture-in-picture insert). No extra logic needed to distinguish the two — the filter already does the right thing for both.
- **Audio tracks** (voice, music, and any video track's own embedded audio where not muted) need `amix` to blend down to one output audio stream. **Respects each track's `muted` flag only — never `soloed`**, per §Visual model's mute/solo distinction; export must not accidentally read solo state.
- This is a real rewrite of the export builder, not a parameter tweak — worth budgeting as its own implementation chunk when this phase starts, not assumed to fall out of the current single-track code for free.

## Open questions

Everything that could plausibly block an autonomous build has been resolved to a firm default above (ripple, dynamic tracks, scroll-wheel zoom, mute-vs-solo, snapping, base-track-composites-first). What's left is genuinely non-blocking:

- **Does Play view's trim and the timeline clip's trim ever need a "reset to Play's trim" action** rather than staying fully independent once placed (already decided independent — see §Data model changes) — worth revisiting once real usage shows whether that's confusing, not before.
- **Exact snapping tolerance** (how close counts as a snap) and **exact transition-dialog options** (cut/crossfade/wipe list) — implementation-level tuning, not a design blocker.

## Done when

Two or more video clips on separate positions of the base video track, at least one overlay clip on a track above it during part of that span (ideally a real Motion graphics output, exercising the alpha-overlay path for real), a voice clip on one audio track and a music bed on another, muted vs. soloed both behaving correctly (solo affects only the live preview, mute affects both preview and the exported file) — export as one correctly-composited file, proving the ffmpeg rewrite actually handles layering and mixing, not just sequencing.
