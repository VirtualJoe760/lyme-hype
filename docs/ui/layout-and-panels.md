# Resizable, collapsible panels

**Built (2026-08-08).** Every panel that had a fixed size has a drag handle on its shared edge (`PanelResizeHandle.tsx`); dragging far enough toward zero collapses it, matching (and replacing, not just supplementing) the existing collapse-toggle-button behavior. Implementation calls made during the build, where this spec left room:

- **The Cut Room gained a collapse toggle** (⌄/⌃ in its header) — it had neither resize nor collapse before, and collapse-on-overdrag needs a way back open, so the timeline now has the same toggle-button affordance the rail and aside always had. Collapsed = header row only, Export still reachable.
- **The collapse width animation (`transition: width`) was removed** from `.side-panel` — it fought live dragging (every pointermove would ease instead of track). Collapse/expand now snaps; an animation could come back scoped to a non-drag class if it's missed.
- **Handles disappear while their panel is collapsed** (a collapsed panel has no edge worth grabbing — reopening is the toggle button's job, as decided below).
- **Live drag updates go through the store** (same as PlayView's trim handles writing `setTrim` per move) rather than a CSS-variable fast path — three panels re-rendering at pointermove rate is well within budget, and one state path is simpler than two.

## What's fixed-size today

- **Sessions rail** (left) — fixed width, `railCollapsed` boolean toggled by a button (`‹`/`›`). No drag-resize.
- **Aside** (right, "Add to canvas") — same pattern, `asideCollapsed` boolean, own toggle button.
- **Cut Room / [timeline](timeline.md)** (bottom strip) — fixed height (`132px` in CSS), no collapse and no resize at all today.

Three resize handles cover all of it: rail↔canvas (vertical line, drag horizontally), aside↔canvas (vertical line, drag horizontally), canvas↔timeline (horizontal line, drag vertically). The [Scripting panel](scripting-panel.md) doesn't add a fourth — it occupies the same middle-panel slot Canvas/Storyboard already do, so it inherits whatever width that slot ends up as; it doesn't have independent sizing.

## Mechanics

Reuse the drag pattern already proven in this codebase rather than reaching for a new library — Play view's trim handles (`PlayView.tsx`'s `startHandleDrag`) already do exactly this shape of interaction: `pointerdown` on the handle starts tracking, `window.addEventListener('pointermove', ...)` updates a value live, `pointerup` tears the listeners down. The same shape applies here: `pointerdown` on a panel's edge starts tracking mouse position, `pointermove` computes a new width/height and applies it (directly to element style or a CSS custom property, not full component re-render churn), `pointerup` commits the final value to the store and persists it.

- **Clamped, not free** — each panel has a min and a sensible max, so a resize can't produce something unusable:
  - Rail: min ~160px (still legible session names), max ~400px.
  - Aside: min ~220px (the prompt form needs room), max ~480px.
  - Timeline: min ~80px (barely more than today's fixed strip), max ~45% of viewport height (real multitrack editing wants real vertical room, but shouldn't be able to eat the whole window).
- **Collapse-on-overdrag** — dragging past roughly half the minimum snaps the panel fully closed, calling the same `toggleRail`/`toggleAside` actions that already exist rather than inventing a second collapse mechanism. The existing toggle buttons stay as the primary way to *re-open* a collapsed panel (a collapsed panel has no visible edge to grab); drag-to-reveal from fully collapsed is a nice-to-have, not required for v1.
- **Cursor feedback** — `cursor: col-resize` on the two vertical handles, `cursor: row-resize` on the timeline's horizontal handle, applied on hover so the handles are discoverable without a visible affordance cluttering the UI at rest.

## Persistence

Panel sizes are a workspace preference, not session content — global, like `theme` already is in `PersistedState`, not scoped per-session. Add `railWidth?`, `asideWidth?`, `timelineHeight?` alongside `theme` in `PersistedState`, written through the same debounced `persist()` path everything else already uses.

## Non-blocking open questions

- **Track height inside the timeline itself**, now that [timeline.md](timeline.md) supports adding tracks freely rather than a fixed four: **decided** — tracks scroll vertically within the timeline panel once they exceed its available height (standard NLE behavior, e.g. Premiere), rather than shrinking track height to fit an unbounded number of tracks. This resize doc's `timelineHeight` (how tall the whole timeline panel is) and the timeline's own internal vertical scrolling (how many tracks are visible at once within that height) are two independent things — this doc only owns the former.
- **Does the middle panel (Canvas/Storyboard/Scripting) ever need its own resize handle** rather than the timeline handle being the only one that trades space with it — leaning "no" (rail/aside/timeline are the only panels with a genuine reason to compete for space), not required for v1, revisit only if the Scripting panel's chat ends up wanting more width than Canvas typically needs.

## Done when

Every one of the three handles can be dragged to resize, overdragging toward zero collapses the panel the same way clicking its toggle button does, and the resulting sizes survive an app restart. *(Met 2026-08-08 — drag, clamp (rail maxes at 400, etc.), collapse-on-overdrag, reopen-restores-size, and the timeline toggle all verified in the browser preview; sizes ride `PersistedState.railWidth/asideWidth/timelineHeight` through the same debounced persist + beforeunload flush as everything else.)*
