# History

How Lyme Hype's design got here — condensed from planning-phase documents that are no longer needed as live specs (their conclusions are baked into the current docs; this page is provenance, not a spec). Replaces `reference-notes-jboogx-nightshift.md`, `reference-notes-stephenlawyer-canvas.md`, and `fable-5-kickoff.md`, all deleted in the 2026-08-08 doc reorg.

## Two references that shaped the design

**jboogx's "NIGHT SHIFT"** (observed 2026-08-07, a local stream tool at `localhost:1985` wrapping Claude Code) — an AI coding agent as the orchestrator for a music-video pipeline: turn a song into visual concepts, then Seedance clips. What carried into Lyme Hype's design:

- A branded chat thread as the primary surface, with a dedicated **Seedance Console** beside it: prompt-mode tabs (Reference / Keyframe / Text), drop targets that create addressable variables the chat could reference (`@image1`, `@video1`, `@audio1`), and a **"Pull prompt + refs from chat"** button that took whatever the agent just proposed and populated the console fields in one click.
- The agent authored an explicit **upload map** as a code block — e.g. `119_seam_1-4-f324_midfall.png → @image1 → FRAME ONE: the falling girl mid-air...` — a real contract between agent output and UI, not just narration.
- One screenshot showed a **structured multi-field shot-prompt schema** (`lighting`, `action`, `production_design`, `motion_continuity`, `subtext`, `critical_constraint`) rather than a single free-text prompt.
- A **Cut Room strip** — "drop clips here" — a lightweight review queue (`FILE`/`REJECT`, take buckets) below the console.

Lyme Hype didn't adopt jboogx's chat-as-primary-surface layout (see the stephenlawyer note below), but the addressable-reference pattern and the structured shot-prompt idea are direct precedent for the **Scripting panel** (`ui/scripting-panel.md`) and the **multitrack timeline** (`ui/timeline.md`).

**Joseph's own stephenlawyer.clothing designer canvas** (`F:\web-clients\stephen-lawyer`, React Flow / `@xyflow/react`, observed 2026-08-07) — an admin tool where an operator prompts Gemini for clothing graphics, drags them onto garment templates, and publishes to Printful. What carried into Lyme Hype's design:

- **Drag-to-combine as the core interaction**, no node-graph/wires: design-onto-template → placement dialog → a Group node that renders async with a pulsing "Rendering…" state; design-onto-design → merge dialog; toolbar Combine button does the same thing contextually on a multi-selection.
- The tool's "Chat Panel" was proven to **not need to be a chat log** — a single-shot prompt form (textarea + controls + Generate) was enough, with outputs landing in a filmstrip rather than a scrolling thread. This directly settled Lyme Hype's early open question of "chat vs. canvas as the center panel": **canvas won**, with a lightweight prompt form in the aside, not a chat transcript, as the default generation surface. (The chat-thread idea didn't disappear — it resurfaced later as the dedicated **Scripting panel**, a third view alongside Canvas/Storyboard rather than the whole app's primary surface.)
- The drag-to-combine pattern is the direct ancestor of Cut Room's drop-to-append and clip-onto-clip-for-a-transition-dialog behavior, now specified for real in `ui/timeline.md`.

## Planning-phase decisions, now resolved

These were open questions in early drafts of `README.md`; the answers are simply facts in the current docs now, not narrated as "resolved" anymore:

- **Center panel is a canvas** (React Flow), not a chat log — see above.
- **Left rail is Sessions**, modeled on Claude Desktop's chat list, not jboogx's ten-category sidebar (`Tonight`/`Darkroom`/`Cut Room`/etc.).
- **Premiere Pro plugin is in scope**, built on UXP, as a separate later build phase (own codebase, bridged over a local server) — not started yet.
- **Electron + TypeScript, Windows-first**; Mac build happens later on Joseph's MacBook.
- **Visual direction: Lime Cut** (charcoal + lime), one of three concept directions sketched in `concepts/studio-concept-directions.html`. All three (Lime Cut, Night Terminal, Zest) ended up built and user-selectable in Settings › Appearance rather than picking just one.
- **App name: Lyme Hype**, confirmed early and never revisited. LimeWire naming-proximity was raised once and dismissed — the citrus motif is aesthetic inspiration for "Zest," not a naming collision.

## Build narrative

Phase-by-phase implementation detail (what was built, when, and how) lives in `build-plan.md` — that's current reference, not history, since it documents how the code that exists actually works. As of this doc reorg (2026-08-08), Phases 1 through 7 are built: the Electron shell, Sessions + canvas core, the credential-vault security boundary, ChatRealty as the first live connection, the full connector catalog (all seven tools installable — stdio, http, and OAuth transports), agent-driven Generate wiring, Play view, Storyboard, and the Cut Room export pipeline. What's next lives in `build-plan.md`, not here.

The **ffmpeg licensing question** went through a real correction worth recording: early planning assumed a closed app bundling ffmpeg needed an LGPL-only build immediately, "to be safe." That was wrong — GPL/LGPL obligations attach to *distributing* software, not running it, and Lyme Hype was a personal tool running the developer's own installed ffmpeg. The rule (`AGENTS.md` §7) was corrected the same day to say so, and the LGPL-build-plus-`openh264`-swap work moved to Phase 9 (packaging/distribution), where the obligation actually starts.
