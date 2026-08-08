# Reference notes — stephenlawyer.clothing designer canvas

Notes from `F:\web-clients\stephen-lawyer` (`src/components/admin/DesignerCanvas.tsx` and friends) — Joseph's own admin design-generator, built June 2026. Captured 2026-08-07 while reconsidering whether Lyme Hype's center panel should be a chat or a canvas.

## What it is

An admin-only tool where a brand operator prompts Google's Gemini image model for clothing graphics, drags them onto garment templates, reviews an AI-composited render, and publishes approved products to Printful. Built with React Flow (`@xyflow/react`).

## Layout

- **Canvas** (center, full-height): pannable/zoomable React Flow surface, dark theme, dot-grid background. This is the main workspace, not a side panel.
- **Top bar**: catalogue switcher + a horizontal "Designs History" filmstrip (every generated/uploaded design, click to drop one onto the canvas) + nav links.
- **Left rail** (desktop) / **bottom dock** (mobile): "Templates Rail" — garment blanks (tee, hoodie, beanie, …) to add to canvas.
- **Right rail** (desktop) / **floating button → full-screen sheet** (mobile): "Chat Panel" — **not actually a chat log.** It's a single-shot prompt form: textarea, background/aspect-ratio controls, Generate button, plus Upload and "Aa Text" (generate lettering) actions. No message history renders here — outputs land in the top filmstrip instead.
- **Floating toolbar** (top-left of canvas): Select tool, Box-select tool (for multi-select), and a context-aware Combine button.

## The core mechanic: drag-to-combine

No node-graph, no wires — just spatial overlap triggering meaningful actions:

- **Design dragged onto a template** → placement dialog (front/back/etc.) → spawns a **Group** node containing [design, template, composition-in-progress], auto-boxed with an editable label. The composition renders async server-side (Gemini composite) and swaps in when ready, showing a pulsing "Rendering…" state meanwhile.
- **Design dragged onto another design** → a "merge" dialog (prompts how they should collide/combine) → generates one new merged design.
- **Design dragged onto an existing composition** → "add placement" (e.g. also print the same design on the back).
- **Toolbar Combine button** does the same thing contextually based on multi-selection: one design + one template selected, or two-plus designs selected.
- **Groups** are draggable containers (drag by a header handle) that auto-reflow their bounding box to wrap current members; deleting a group ungroups its members rather than deleting them.
- Nodes are individually resizable when selected (`NodeResizer`), deletable via a small × button, and everything debounce-persists (500ms) to the backend on move/resize/delete.
- Click a composition node → modal to review large / discard. Click a design node → preview modal with an "add to canvas" action.

## Why this is relevant to Lyme Hype right now

Two live questions this directly informs:

1. **Cut Room as a real timeline.** Joseph wants the "cut room" strip (currently just a clip bin in the jboogx-style concepts) to become an actual ffmpeg-driven timeline for short-form output (reels). The drag-to-combine pattern maps directly: drop a generated clip onto the timeline to append it; drag clip-onto-clip to get a transition dialog (cut / crossfade / wipe) instead of this tool's "merge two designs" dialog; ffmpeg does the real concatenation/render on export.
2. **Reconsidering the center chat panel.** jboogx's Night Shift uses a scrolling chat thread as the dominant center panel. This tool's "Chat Panel" is proof that a single-shot prompt form (not a conversation log) is enough to drive generation — the canvas itself, not the chat, is what's actually being interacted with most of the time. For Lyme Hype this suggests: keep a lightweight prompt form (already compatible with the Seedance-Console idea from the jboogx notes), but make a **canvas** — not a chat transcript — the primary center surface for arranging and combining generated keyframes/clips.

## Open questions this raises

- Does an agent (Claude Agent SDK) still have a voice in this layout, or does it become more of a background executor triggered by canvas actions (generate, combine, export) with status shown on the nodes themselves, the way jboogx's tool narrates in a chat thread?
- What does "combine" mean for video specifically — a transition dialog is the obvious analog, but there may be others (e.g. dragging a motion-graphics overlay onto a clip → composite dialog, closely mirroring this tool's design-onto-template flow).
- React Flow is already proven here (TypeScript, cross-platform inside an Electron webview would work fine) — no reason to evaluate alternatives unless a concrete limitation shows up.
