# Lyme Hype

A desktop content studio for generating short-form reels — images, motion graphics, video, and audio, combined on a canvas and cut together into finished output. Built from two references, now folded into `history.md`: jboogx's "NIGHT SHIFT" (an AI coding agent as the orchestrator, driving generation tools directly) and Joseph's own stephenlawyer.clothing canvas (a spatial, drag-to-combine workspace instead of a chat log).

The agent isn't a chatbot answering questions in a box — it's actively driving other tools: naming/organizing generated files, writing structured prompts per shot, and — per the MCP connections model — reaching whatever generation or data platform is connected.

## Status

**Building — Phases 1 through 7 and 10 through 13 landed (2026-08-08).** The Electron + TypeScript shell runs on Windows with the Claude Agent SDK live in the main process, three selectable themes, Sessions rail, a real React Flow canvas, drag-onto-node combine, a working Storyboard (real panels, promote-to-canvas, per-panel storyboard-tier image model choice), a working Play view (trim/split/detach), and — from the second 2026-08-08 build round — a real **multitrack timeline** (dynamic tracks, ripple, razor, snapping, mute/solo/lock, composited live preview, `overlay`+`amix` ffmpeg export verified against the machine's real binary), **resizable/collapsible panels**, a **Scripting** chat view riding new generic multi-turn conversation plumbing (SDK session resume, verified live), and the **Create panel** (tile grid → task screens, including local-ffmpeg Isolate audio, Krea LoRA training, ElevenLabs direct audio jobs, and the full six-stage Motion graphics wizard with reference-conditioned generation, batch review, start/end-frame video, and a colorkey→VP9-alpha path). The credential vault + secure-credential modal are built and self-tested. **All eight catalog connectors install today** — ChatRealty, muapi, ElevenLabs, Krea, fal, Gemini, OpenAI Images, and Yapper — across stdio, Streamable-HTTP, and OAuth transports; generation is agent-driven with connector-tier routing now enforced from the UI.

**Two ways to launch, and the difference bites:** `npm run app` builds and runs the real
app (use this to just *use* Lyme Hype — it always rebuilds first, so it can't run stale
code). `npm run dev` runs it against the Vite dev server with hot reload (use this while
changing code; note that editing renderer/store files reloads the window under you, and
closing the app also stops the dev server). Launching `electron .` by hand runs whatever
`out/` last held — that's how a stale renderer once came up with no sessions (2026-08-31).

`npm run dev` to run; `LYME_SELFTEST=1 npm run dev` runs the headless plumbing checks (vault, sessions, secure modal, agent link, multi-turn conversation resume, the full connector catalog, both bundled wrappers' MCP protocol, and the ffmpeg export/media-tool command builders). The 2026-08-29 tooling layer — the **live feature-test harness** (`LYME_TEST=…`), the app running **as an MCP server** (`--mcp` + the stdio↔pipe bridge), and the **Claude Code skills** that wrap those tools — is documented in [tooling/](tooling/feature-tests.md).

**Current focus (2026-08-29): bring every connector alive through the utility files / skills / MCP tools, in the current UI — images first, then video, then the rest** (audio, motion graphics, LoRA, deepfake, ChatRealty). Live image generation is verified (gemini + muapi side by side). Production mode, channels, the pipeline, and analytics (all spec'd in [product/vision.md](product/vision.md)) get built AFTER the generation layer is fully wired and tested. Still deferred: bundling a verified-LGPL ffmpeg for distribution, the jpsrealtor Instagram publish port, Phase 8 (Premiere UXP plugin), Phase 9 (packaging).

## Where things live

- **product/**
  - **[vision.md](product/vision.md)** — what Lyme Hype is *for*: the Channel → Production → assets hierarchy, production vs. creative mode as context-loading rules, the research process, the approval-gated pipeline (storyboard→script, priority queue, news interrupts), analytics loops, channel memory as editable files. Read this before touching projects/memory/publishing/pipeline infrastructure.
- **tooling/**
  - **[feature-tests.md](tooling/feature-tests.md)** — the `LYME_TEST` live harness: features, env knobs, the `OUTPUT —` contract, credential import.
  - **[mcp-server.md](tooling/mcp-server.md)** — the app as an MCP server: the `--mcp` mode, the Windows stdin crash and the bridge, the 14 tools, the build-before-serve rule.
  - **[skills.md](tooling/skills.md)** — the Claude Code skills wrapping the MCP tools ("let's generate a photo" → `generate_image`).
- **[history.md](history.md)** — how the design got here: the two reference tools, resolved planning-phase decisions, the ffmpeg-licensing correction. Read this once, not repeatedly — it's provenance, not a live spec.
- **[build-plan.md](build-plan.md)** — the actual build order: phases, what blocks what, what's done, what's next. The single "what do I build" doc.
- **architecture/**
  - **[platform-decisions.md](architecture/platform-decisions.md)** — Electron, UXP vs. CEP for the Premiere plugin, the MCP-client model, the ffmpeg engine decision.
  - **[capability-map.md](architecture/capability-map.md)** — the routing source of truth: capability vocabulary, the connector × capability matrix, the creative-node → capability table the UI derives readiness from, and the unwired paths worth planning around.
- **connectors/**
  - **[model.md](connectors/model.md)** — the generic connector mechanism (stdio/http/OAuth transports), the credential boundary, the secure-credential component, the agent-as-setup-copilot idea.
  - **[catalog.md](connectors/catalog.md)** — which specific tools are connected, why each one is used for what, and exact connect shapes.
  - **[reference/](connectors/reference/)** — aggregated external documentation, one file per connector (muapi with its full model catalog, ElevenLabs and ChatRealty from live schema enumeration, Krea, fal, Gemini/Veo, OpenAI Images, Yapper): tool surfaces, models, result handling, pricing, gotchas — with verified/docs/unverified markers.
  - **[publishing.md](connectors/publishing.md)** — Instagram/YouTube OAuth publish. A different mechanism from the MCP connectors above, not a variant of them.
- **ui/**
  - **[creative-nodes.md](ui/creative-nodes.md)** — every creative building block (canvas nodes, panels, Create tasks, wizard stages, timeline clips) described by inputs/outputs and the capabilities each consumes; pairs with the capability map.
  - **[canvas-and-storyboard.md](ui/canvas-and-storyboard.md)** — node types, source methods, combine, Sessions, the Storyboard view and its promote mechanic.
  - **[play-view.md](ui/play-view.md)** — the full-takeover single-clip review/trim/split view.
  - **[timeline.md](ui/timeline.md)** — the planned multitrack rework of the Cut Room. Not built yet.
  - **[scripting-panel.md](ui/scripting-panel.md)** — the planned third middle-panel chat view and its script → Storyboard handoff. Not built yet.
  - **[layout-and-panels.md](ui/layout-and-panels.md)** — the planned resizable/collapsible panel system. Not built yet.
  - **[create-panel.md](ui/create-panel.md)** — the planned redesign of the aside ("Add to canvas" → "Create"): a tile grid of tasks instead of one flat form. Includes the Motion graphics workflow (references → agent-authored prompts → batch review → animate → local alpha-keying), which surfaces real generation-architecture gaps (reference-image input, batch review, frame-conditioned video, alpha export). Not built yet.
  - **[character-sheets-and-assets.md](ui/character-sheets-and-assets.md)** — the character/location-sheet pipeline and the reusable asset library it needs (from an AI-cartoon tutorial, 2026-08-31). Process documented + a recommended UI flow; the `@`-tagging of typed references is the highest-leverage piece. Not built yet.
- **concepts/** — `studio-concept-directions.html` (the three visual-identity mockups; Lime Cut, Night Terminal, and Zest are all built now) and the self-hosted concept fonts.

## Platform direction

- **Desktop app**, not a local web app — TypeScript throughout, cross-platform Windows + Mac.
- **Electron** for the shell (Node main process fits the Claude Agent SDK natively) and **UXP** (not CEP) for the eventual Premiere Pro plugin.
- **Build order:** developing on Windows first (primary dev machine); Mac packaging/signing happens later on Joseph's MacBook.
- Full rationale in [architecture/platform-decisions.md](architecture/platform-decisions.md).
