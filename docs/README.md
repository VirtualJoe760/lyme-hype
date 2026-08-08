# Lyme Hype

Early planning. This doc will evolve as the idea firms up — right now it's just a place to keep notes so we don't lose them between sessions.

## The idea

Build our own short-form content platform for generating reels — images, motion graphics, video, and audio, combined on a canvas and cut together into finished short-form output. Built from two references: jboogx's "NIGHT SHIFT" (an AI coding agent as the orchestrator, driving generation tools directly instead of us copy-pasting prompts between five different apps) and Joseph's own stephenlawyer.clothing canvas (a spatial, drag-to-combine workspace instead of a chat log — see [reference-notes-stephenlawyer-canvas.md](reference-notes-stephenlawyer-canvas.md)).

The agent isn't a chatbot answering questions in a box — it's actively driving other tools: naming/organizing generated files, writing structured prompts per shot, assembling reference images into a video model's input slots, and — per the MCP connections model — reaching whatever generation or data platforms are connected, ChatRealty included.

## Branding

- **Name: Lyme Hype.** Decided — this is the product name, not just a logo treatment. Anything still saying "Limehype" (mockup included) is stale; see the build plan.
- **Wordmark**: set in Bitcount Prop Single (a dot-matrix variable font), colored lime. Press Start 2P (8-bit arcade font) is reserved for small decorative accents only — confirmed too illegible for body/UI text at normal sizes to use anywhere else. Font files live in `concepts/fonts/`.
- **LimeWire proximity: not a concern.** Raised and dismissed — the citrus motif is aesthetic inspiration for the "Zest" direction, not a naming collision. Closed.

## Scope

- **MCP connections** — the app is an MCP client (same model as Claude Desktop/Code). Generation tools and data tools like ChatRealty attach as connections — a generic model, not a predetermined list — with the agent able to drive a browser to help set one up, but never touching the actual credential. See [canvas-node-model.md](canvas-node-model.md) and [connections-and-credentials.md](connections-and-credentials.md).
- **Image generation** — engine TBD (see open questions in the reference notes).
- **Video** — generate (Seedance), upload a local file, or paste a web link. All three land on the canvas as nodes; see [canvas-node-model.md](canvas-node-model.md).
- **Audio** — generate (ElevenLabs-style voice/music/SFX, provider TBD) or upload local `.mp3`/`.wav` files. Also canvas nodes.
- **Motion graphics generation** — Seedance plus other AI tools as needed; which tools cover this well is still open.
- **Send to timeline** — Video and Audio nodes push straight from the canvas into the Cut Room, which is a real ffmpeg-driven timeline, not just a clip bin.
- **Subtitles** — generated via a connected speech-to-text tool, burned in / muxed by ffmpeg at export. ffmpeg (bundled — decided) is the shared engine behind Cut Room, Play view, and subtitles.
- **Sessions** — the left rail, modeled on Claude Desktop's chat list. Nameable/renameable, not jboogx's ten-category sidebar.
- **Storyboard view** — a toggle inside the canvas (not a separate screen) for planning shots as cheap prompt-and-sketch panels before spending a real generation; promoting a panel turns it into a real node. See [canvas-node-model.md](canvas-node-model.md).
- **Play view** — a full-width takeover (not a canvas toggle) for reviewing and non-destructively cutting a single video or audio node, before sending it to the timeline. Controls overlay the video itself rather than sitting in a separate row; audio is a compact strip below with its own Detach (→ independent node) and delete actions. A back arrow returns to whichever view — Canvas or Storyboard — opened it. See [canvas-node-model.md](canvas-node-model.md).
- **Premiere Pro plugin** — confirmed goal, not just a maybe. Built on UXP so generated clips/sequences can land directly on a Premiere timeline. Likely a second build phase after the core studio app works, since it's a genuinely separate codebase (see [platform-decisions.md](platform-decisions.md)).
- **Publish to social platforms** — Cut Room export can go straight to a connected Instagram/YouTube account, reusing jpsrealtor's existing account-linking flow (OAuth, not an MCP connection — a different mechanism from everything else on this list). Publishing is immediate at the API level, no draft step — the UI has to force an explicit confirm regardless. See [connections-and-credentials.md](connections-and-credentials.md).

## Reference

- [reference-notes-jboogx-nightshift.md](reference-notes-jboogx-nightshift.md) — breakdown of jboogx's screenshots: layout, panels, what we think is happening under the hood.
- [reference-notes-stephenlawyer-canvas.md](reference-notes-stephenlawyer-canvas.md) — Joseph's own React Flow-based design-generator canvas (stephenlawyer.clothing admin tool), and why its drag-to-combine interaction model might fit Lyme Hype better than a chat-centric layout.
- [canvas-node-model.md](canvas-node-model.md) — Lyme Hype's own spec: node types (image/video/audio), source methods (generate/upload/link) per type, and the send-to-timeline action.
- [connections-and-credentials.md](connections-and-credentials.md) — the generic connector model (no predetermined list), the agent-as-setup-copilot browser flow, and the credential boundary that keeps secrets out of the agent's context entirely.
- [build-plan.md](build-plan.md) — the actual build order: eight phases from Electron scaffold through packaging, what blocks what, and what "done" looks like at each step.
- [fable-5-kickoff.md](fable-5-kickoff.md) — the handoff prompt for whichever session picks up Phase 1.
- [monetization.md](monetization.md) — how Lyme Hype gets paid: BYO flat-fee first (thinkbigjoe login + Stripe), managed tier later, and the three BYO layers (license / Claude key / connector keys).

## Platform direction

- **Desktop app**, not a local web app — TypeScript throughout, cross-platform Windows + Mac.
- **Electron** for the shell (Node main process fits the Claude Agent SDK natively) and **UXP** (not CEP) for the Premiere Pro plugin, so generated clips/sequences can transition straight onto a Premiere timeline.
- **Build order:** developing on Windows first (primary dev machine); Mac packaging/signing happens later on Joseph's MacBook.
- Full rationale and open questions in [platform-decisions.md](platform-decisions.md).

## Status

**Building — Phases 1–3 landed (2026-08-08).** The Electron + TypeScript shell (Lime Cut skin) runs on Windows with the Claude Agent SDK live in the main process (authenticated via the machine's Claude Code login), Sessions rail, React Flow canvas with stub Image/Video/Audio nodes, drag-onto-node combine dialog, Cut Room strip, and collapsible panels. The credential boundary (native secure modal + `safeStorage` vault) is built, and **ChatRealty is connected end to end**: a query in the aside's ChatRealty card pulls a listing's real photos onto the canvas as Image nodes (stdio MCP server, token never in agent/renderer state, photos served via the `lyme-asset://` protocol). `npm run dev` to run; `LYME_SELFTEST=1 npm run dev` runs the headless checks (vault, sessions, secure modal, agent link, ChatRealty transport + live pull + asset protocol).

Connections is a generic add-any-MCP-connector panel (ChatRealty ships as a built-in template; custom stdio/http connectors add, store a credential via the secure modal, and live-test). **Next: Phase 4** — real video/image/audio generation connections (Seedance, ElevenLabs-style).

**Resolved** (these were open questions in earlier drafts of this doc; no longer are): center panel is a canvas (React Flow, per the stephenlawyer.clothing precedent), not jboogx's chat thread. Left rail is Sessions (Claude Desktop's chat-list model), not a category sidebar. Premiere plugin confirmed in scope, as a phase-2 build. Electron + TypeScript, Windows-first, Mac build later on Joseph's MacBook. Visual direction: **Lime Cut** (per the kickoff prompt), from the three directions sketched in `concepts/studio-concept-directions.html`.

Actual build order — phases, dependencies, "done" criteria, and which are now done — lives in [build-plan.md](build-plan.md). Stack specifics and the decisions made while scaffolding are in [platform-decisions.md](platform-decisions.md#implementation-notes-phase-1).
