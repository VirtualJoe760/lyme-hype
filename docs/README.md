# Lyme Hype

A desktop content studio for generating short-form reels — images, motion graphics, video, and audio, combined on a canvas and cut together into finished output. Built from two references, now folded into `history.md`: jboogx's "NIGHT SHIFT" (an AI coding agent as the orchestrator, driving generation tools directly) and Joseph's own stephenlawyer.clothing canvas (a spatial, drag-to-combine workspace instead of a chat log).

The agent isn't a chatbot answering questions in a box — it's actively driving other tools: naming/organizing generated files, writing structured prompts per shot, and — per the MCP connections model — reaching whatever generation or data platform is connected.

## Status

**Building — Phases 1 through 7 landed (2026-08-08).** The Electron + TypeScript shell runs on Windows with the Claude Agent SDK live in the main process, three selectable themes, Sessions rail, a real React Flow canvas, drag-onto-node combine, a working Storyboard (real panels, promote-to-canvas), a working Play view (trim/split/detach), and a Cut Room export pipeline that runs real ffmpeg against the machine's installed binary. The credential vault + secure-credential modal are built and self-tested. **All seven catalog connectors install today** — ChatRealty, muapi, ElevenLabs, Krea, fal, Gemini, and Yapper — across stdio, Streamable-HTTP, and OAuth transports, and Generate is fully agent-driven (the agent picks the right connector's tool for the requested media, no per-connector hardcoding).

`npm run dev` to run; `LYME_SELFTEST=1 npm run dev` runs the headless plumbing checks (vault, sessions, secure modal, agent link, the full connector catalog, and the ffmpeg export command builder).

**Deferred to a joint session, not autonomous work** (see `build-plan.md` Phase 4/7 for detail): a live generation call against a real connector, bundling a verified-LGPL ffmpeg for eventual distribution, and porting jpsrealtor's Instagram publish flow.

**Newly spec'd, not yet built** (2026-08-08 doc expansion): an OpenAI image connector (storyboard-tier, alongside Gemini), a third middle-panel **Scripting** view (chat interface for developing a script before any shot exists), a real **multitrack timeline** replacing the Cut Room's current sequential clip strip, **resizable/collapsible panels** across the shell, and a **Create panel** redesign (tile grid of tasks replacing the aside's current flat form, including a full Motion graphics workflow that surfaces real generation gaps — reference-image input, batch review, frame-conditioned video, alpha-channel export). See `build-plan.md` Phases 4/10–13 and the linked `ui/` docs.

## Where things live

- **[history.md](history.md)** — how the design got here: the two reference tools, resolved planning-phase decisions, the ffmpeg-licensing correction. Read this once, not repeatedly — it's provenance, not a live spec.
- **[build-plan.md](build-plan.md)** — the actual build order: phases, what blocks what, what's done, what's next. The single "what do I build" doc.
- **architecture/**
  - **[platform-decisions.md](architecture/platform-decisions.md)** — Electron, UXP vs. CEP for the Premiere plugin, the MCP-client model, the ffmpeg engine decision.
- **connectors/**
  - **[model.md](connectors/model.md)** — the generic connector mechanism (stdio/http/OAuth transports), the credential boundary, the secure-credential component, the agent-as-setup-copilot idea.
  - **[catalog.md](connectors/catalog.md)** — which specific tools are connected, why each one is used for what (video → muapi/Seedance, voice → ElevenLabs, production image → Midjourney via muapi, storyboard-tier image → Gemini/OpenAI, LoRA training → Krea, deepfake/likeness → Yapper, data → ChatRealty), and exact connect shapes.
  - **[publishing.md](connectors/publishing.md)** — Instagram/YouTube OAuth publish. A different mechanism from the MCP connectors above, not a variant of them.
- **ui/**
  - **[canvas-and-storyboard.md](ui/canvas-and-storyboard.md)** — node types, source methods, combine, Sessions, the Storyboard view and its promote mechanic.
  - **[play-view.md](ui/play-view.md)** — the full-takeover single-clip review/trim/split view.
  - **[timeline.md](ui/timeline.md)** — the planned multitrack rework of the Cut Room. Not built yet.
  - **[scripting-panel.md](ui/scripting-panel.md)** — the planned third middle-panel chat view and its script → Storyboard handoff. Not built yet.
  - **[layout-and-panels.md](ui/layout-and-panels.md)** — the planned resizable/collapsible panel system. Not built yet.
  - **[create-panel.md](ui/create-panel.md)** — the planned redesign of the aside ("Add to canvas" → "Create"): a tile grid of tasks instead of one flat form. Includes the Motion graphics workflow (references → agent-authored prompts → batch review → animate → local alpha-keying), which surfaces real generation-architecture gaps (reference-image input, batch review, frame-conditioned video, alpha export). Not built yet.
- **concepts/** — `studio-concept-directions.html` (the three visual-identity mockups; Lime Cut, Night Terminal, and Zest are all built now) and the self-hosted concept fonts.

## Platform direction

- **Desktop app**, not a local web app — TypeScript throughout, cross-platform Windows + Mac.
- **Electron** for the shell (Node main process fits the Claude Agent SDK natively) and **UXP** (not CEP) for the eventual Premiere Pro plugin.
- **Build order:** developing on Windows first (primary dev machine); Mac packaging/signing happens later on Joseph's MacBook.
- Full rationale in [architecture/platform-decisions.md](architecture/platform-decisions.md).
