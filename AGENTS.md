# AGENTS.md — Lyme Hype

Instructions for any coding agent working in this repository.

`AGENTS.md` is the open standard read natively by Codex, Cursor, Copilot, Gemini CLI, Aider,
Windsurf and Zed. Claude Code does not read it natively — it reads `CLAUDE.md`, so the root
`CLAUDE.md` is a two-line file that imports this one. Edit **this** file; never duplicate rules
into `CLAUDE.md`.

---

## 0. Where this project actually is

**Phases 1–7 and 10–13 plus the parts-two/three redesign work are built; Phases 8–9 are not
started.** `docs/` is the spec — read it before touching code, and read
[`docs/build-plan.md`](docs/build-plan.md) to see which phases are done. The Electron +
TypeScript app runs (`npm start` — build-then-launch, so a window is never on a stale
build; `npm run dev` for HMR), the Claude Agent SDK drives real agent-driven generation
across all eight catalog connectors, the credential vault + secure-credential modal are
self-tested (`LYME_SELFTEST=1 npm run dev`), and Play/Storyboard/Scripting/multitrack Cut
Room/Create panel are all real. Since 2026-08-29 there is also a **tooling layer**
([`docs/tooling/`](docs/tooling/feature-tests.md)): live feature tests (`LYME_TEST=…`), the app
running **as an MCP server** (`.mcp.json` → `resources/lyme-mcp-bridge.cjs` → `--mcp` mode, 14
typed tools), Claude Code skills wrapping those tools, and headless credential import. Live
image generation is verified (gemini + muapi).

**Current focus (Part four of the build plan): bring every connector alive through that tooling
layer — images → video → the rest — BEFORE building production mode.** The product direction
(channels, approval-gated pipeline, analytics — [`docs/product/vision.md`](docs/product/vision.md))
is spec'd and deliberately waiting. Still deferred: the LGPL ffmpeg bundle (distribution-time)
and the Instagram publish port.

Start here: [`docs/README.md`](docs/README.md). It links everything else and tracks what's
decided vs. still open.

---

## 1. Hard rules

1. **Absolute Windows paths for every file operation.**
   `F:\web-clients\joseph-sardella\lyme-hype\...` — avoids a known Claude Code bug with relative
   paths on Windows, and makes every tool call unambiguous regardless of working directory.

2. **Read before writing.** `docs/README.md`, then the specific doc that covers the area you're
   touching (see §3). State back what you understood before writing code.

3. **Update the docs you read, in the same change.** If you make an architecture decision, resolve
   an open question, or discover the spec is wrong, fix the doc in the same commit — not after.
   That discipline is the only reason this planning phase didn't drift; don't break it once code
   exists.

4. **Doc drift is a bug.** If a doc contradicts the code (once there is code), the doc is wrong —
   fix it the same session. This already happened once during planning (`README.md`'s Status
   section said "chat vs. canvas: undecided" long after canvas had won) — it's an easy failure
   mode, not a hypothetical one.

5. **Credentials never pass through the agent.** This is the one rule that doesn't bend. Any
   connector setup flow can use the agent to drive a browser and help a user find a signup page or
   API-keys screen, but the actual secret is always typed into the native secure-credential modal
   (`BrowserWindow` + IPC, reports only field name/length/last-4 back to the agent) and stored via
   Electron's `safeStorage`. No plain `<input>` for a credential anywhere in agent-observable
   state, ever — not as a shortcut, not for a "trusted" template connector. Full reasoning:
   [`docs/connectors/model.md`](docs/connectors/model.md).

6. **Publishing to a social platform is immediate — there is no draft step at the API level.**
   Learned the expensive way on the jpsrealtor project (its own `AGENTS.md`: "`social:post`
   publishes to Instagram immediately. No draft step."). Lyme Hype's UI must force an explicit,
   deliberate confirm before any publish action fires, regardless of how the underlying OAuth flow
   is ported in.

7. **ffmpeg licensing only matters at distribution — don't gate work on it now.** (Corrected
   2026-08-08; the old "must be LGPL-only" version of this rule was over-imagined during planning.)
   Lyme Hype is a personal tool: running any ffmpeg build locally — including the user's installed
   GPL build on PATH — infringes nothing, because GPL/LGPL obligations attach to *distributing*
   software, not using it. The app also shells out to ffmpeg as a separate process rather than
   linking it. IF the app is ever packaged and given to others, revisit then: bundle a verified
   LGPL build (e.g. BtbN's `-lgpl` variants) and switch the export encoder from `libx264` (GPL,
   absent in LGPL builds) to `openh264` — and verify the binary with `ffmpeg -version` (no
   `--enable-gpl` / `--enable-nonfree` in the configuration line) rather than trusting a label.

8. **Never conflate LLM token cost with generation cost.** They are two different
   numbers and only one of them is a bill:
   - **Generation cost** = what a connector charges for the media: muapi per image/clip,
     Gemini/Veo per image/second, ElevenLabs per character, ComfyUI **$0**. This is the
     real dollar amount. The Agent SDK does not see it — it happens on the connector's
     own account — so it has to come from the model catalog's price, never from `costUsd`.
   - **LLM token cost** = the Agent SDK's `total_cost_usd` / `costUsd`: an API-list-price
     equivalent for the agent's own tokens. On Joseph's Claude Code login that is plan
     consumption, **not a charge**. It is a real bill only under an actually-billing
     provider (Anthropic API key, Kimi, a custom endpoint — `model-providers.ts`).
   In code, UI, docs and replies: label which one a number is, never add them into one
   figure, and never answer "what did that cost" with the token number. This was
   corrected on 2026-08-29 and again on 2026-09-02 after `via gemini · $0.383` shipped
   as if it were the image's price.

9. **Env files and credentials never reach git.** Same rule as every other project here — stage by
   explicit path, never `git add -A`, confirm `.gitignore` coverage with `git check-ignore -v
   <file>` before trusting it, never assume.

---

## 2. Repository map

```
lyme-hype/
├── CLAUDE.md            This file's two-line import shim.
├── AGENTS.md             You are here.
├── docs/                 Full spec — read before touching anything else. Organized by topic,
│   │                     not a flat pile — see docs/README.md for the annotated index.
│   ├── README.md                    Index. Start here.
│   ├── history.md                    How the design got here — provenance, not a live spec.
│   ├── build-plan.md                 The actual build order — read this to know what's next.
│   ├── product/
│   │   └── vision.md                 What Lyme Hype is FOR: channels, production vs creative
│   │                                 mode, the pipeline, research, analytics. The theory doc.
│   ├── tooling/
│   │   ├── feature-tests.md          The LYME_TEST live harness + credential import.
│   │   ├── mcp-server.md             The app as an MCP server (--mcp, the bridge, 14 tools).
│   │   └── skills.md                 Claude Code skills wrapping the MCP tools.
│   ├── architecture/
│   │   ├── platform-decisions.md    Electron, UXP vs CEP, MCP-client model, ffmpeg engine.
│   │   └── capability-map.md        Routing source of truth: connector × capability matrix,
│   │                                 creative-node needs table (drives tile readiness).
│   ├── connectors/
│   │   ├── model.md                  The generic connector mechanism + credential boundary.
│   │   ├── catalog.md                Which tools, why each one, exact connect shapes, tier routing.
│   │   ├── reference/                Aggregated external docs, one file per connector (tool
│   │   │                             surfaces, model catalogs, pricing, gotchas; verified markers).
│   │   └── publishing.md             Instagram/YouTube OAuth — a different mechanism, not MCP.
│   ├── ui/
│   │   ├── creative-nodes.md         Every creative building block + capabilities it consumes.
│   │   ├── canvas-and-storyboard.md  Node types, Sessions, Storyboard + promote.
│   │   ├── play-view.md              Full-takeover single-clip review/trim/split.
│   │   ├── timeline.md               Multitrack Cut Room — built; spec + build-decision record.
│   │   ├── scripting-panel.md        Third middle-panel chat view — built; ditto.
│   │   ├── layout-and-panels.md      Resizable/collapsible panels — built; ditto.
│   │   ├── create-panel.md           Create panel + Motion graphics wizard — built; ditto.
│   │   └── character-sheets-and-assets.md  Character/location sheets + the reusable
│   │                                 asset library and @-tagged references. Spec only.
│   └── concepts/
│       ├── studio-concept-directions.html   Interactive mockup — three visual-identity
│       │                                    directions, Storyboard, Play, Connections panel.
│       └── fonts/                    Bitcount Prop Single + Press Start 2P, self-hosted.
├── .mcp.json             Registers the app itself as a project MCP server for Claude Code —
│                         spawns resources/lyme-mcp-bridge.cjs (see below). Skills in
│                         .claude/skills/ call the resulting mcp__lyme-hype__* tools.
├── scripts/
│   └── launch.ps1        Behind the Start-menu shortcut: rebuilds only when a source file is
│                         newer than out/main/index.js, then launches. Stops a window opening
│                         on a stale build (docs/build-plan.md).
├── resources/            Bundled runtime assets shipped with the app (not build tooling).
│   ├── gemini-mcp.cjs    Dependency-free stdio MCP server wrapping Gemini's REST API (image w/
│   │                     reference input + Veo video w/ start/end-frame conditioning).
│   ├── openai-image-mcp.cjs   Same pattern for OpenAI gpt-image-1 (generations + edits-with-
│   │                          references endpoints).
│   └── lyme-mcp-bridge.cjs    Stdio↔named-pipe relay to the ONE shared backend on a fixed pipe; spawns `electron . --mcp` only if nothing answers — Electron
│                              on Windows crashes reading a piped stdin, so MCP clients talk to
│                              this plain-Node process instead (needs `npm run build` first).
├── src/
│   ├── main/             Electron main process. index.ts (boot/window + navigation lockdown +
│   │                     asset protocol), ipc.ts (all handlers, sender-validated), agent.ts
│   │                     (single-turn Agent SDK calls, dynamic import — ESM-only dep in a CJS
│   │                     bundle), conversations.ts (generic multi-turn conversation plumbing:
│   │                     SDK session resume + transcript-replay fallback, streaming, vision
│   │                     input; serves Scripting AND Motion graphics), generation.ts
│   │                     (agent-driven media generation: attaches every installed connector as
│   │                     an MCP server, canUseTool hard-denies non-MCP tools; connectorId
│   │                     restriction + reference/frame image params), sessions-store.ts (JSON
│   │                     in userData), credential-vault.ts (safeStorage/DPAPI),
│   │                     secure-credential.ts (native secret modal), mcp-client.ts (stdio MCP
│   │                     client) + mcp-http.ts (Streamable-HTTP MCP client) + mcp-oauth.ts
│   │                     (MCP OAuth client: discovery, dynamic registration, PKCE, loopback
│   │                     redirect) + mcp-probe.ts (connection check, both transports),
│   │                     mcp-server.ts (the app AS an MCP server — `--mcp` mode exposing the
│   │                     creative pipeline as typed tools), mcp-hub.ts (the one backend per machine:
│   │                     fixed pipe, N bridges, studio takes over from headless), comfyui-host.ts +
│   │                     comfyui-watchdog.ts (ComfyUI on demand, idle stop, memory kill switch), character/
│   │                     (Generate Character: style registry, SDXL + Qwen-Edit graph builders, direct
│   │                     ComfyUI client, cast/review/approve engine, characters.json store),
│   │                     build-info.ts (compile-time build stamp +
│                     stale-source detection for the boot line), chatrealty.ts (pull listing photos + the ChatRealty connector
│   │                     template), connectors-store.ts (generic connector CRUD + live test
│   │                     across all transports), connector-suggestions.ts (the eight-tool
│   │                     catalog + templates), claude-auth.ts (Claude default login + explicit
│   │                     overrides), model-providers.ts (agent LLM: Claude default / Kimi /
│   │                     custom Anthropic-compatible), asset-store.ts (lyme-asset:// protocol +
│   │                     import/download into userData/assets), ffmpeg.ts (binary discovery +
│   │                     the multitrack overlay+amix export graph builder), media-tools.ts
│   │                     (local ffmpeg: isolate-audio + colorkey→VP9-alpha keying),
│   │                     elevenlabs-tools.ts (direct ElevenLabs MCP tool calls — voice/music/
│   │                     SFX/clone, no agent turn), krea-training.ts (LoRA training REST
│   │                     client — the one deliberate non-MCP exception), selftest.ts
│   │                     (LYME_SELFTEST=1 plumbing check, covers all of the above),
│   │                     utils/ (the LYME_TEST live feature tests — *_test.ts per feature +
│   │                     test-harness/test-runner — and credential-import.ts; these are the
│   │                     engines the skills and MCP tools drive; docs/tooling/feature-tests.md).
│   ├── preload/          index.ts (the narrow `window.lyme` bridge — the studio renderer's whole
│   │                     world), secure.ts (the modal's even narrower bridge), index.d.ts.
│   ├── shared/           types.ts (a barrel over types/* — providers, scripting, media,
│   │                     canvas, timeline, connectors, chatrealty), model-catalog.ts
│   │                     (helpers; per-media entries in model-catalog/*) and
│   │                     ipc-channels.ts, imported by both sides as @shared/*.
│   └── renderer/         React UI (Lime Cut skin, plus Night Terminal + Zest). index.html +
│                         secure.html entries; src/store.ts (zustand create() body: state,
│                         closure helpers and the session/canvas actions; the rest lives in
│                         src/store/* — types.ts, helpers.ts, context.ts and one file per
│                         action group: timeline, review, generation, workspace, chatrealty),
│                         src/bridge.ts (real IPC or browser-preview mock), src/components/*
│                         (TitleBar, Toolbar, SessionsRail, CanvasArea + MediaNode,
│                         StoryboardView, ScriptingView, PlayView, BootSplash (startup
│                         takeover — real init() steps, one status line), CutRoom (multitrack timeline:
│                         ruler/tracks/clips/monitor), AsidePanel (the Create panel tile grid +
│                         task screens) + MotionGraphicsWizard + BatchResultsGrid + AgentCard +
│                         ChatRealtyPull, PanelResizeHandle, CombineDialog, TrashCan (canvas trash + Ctrl+Z), and the
│                         per-component folders that keep each under 700 lines (node-panel/,
│                         cut-room/, chat-realty/), settings/*
│                         (full-screen Settings shell + Connectors/Models/Trained styles/
│                         Appearance tabs)), src/secure/* (modal page). Themes are CSS-var token
│                         sets keyed on <html data-theme>; persists in PersistedState.
├── electron.vite.config.ts   Main/preload/renderer builds; two renderer entries (studio + modal).
├── tsconfig.json / .node.json / .web.json   Strict TS; `npm run typecheck` covers both sides.
└── package.json          electron-vite 2 / Vite 5 / React 18 / Electron 38 — version rationale in
                          docs/architecture/platform-decisions.md (Node 21 pins Vite).
```

## 3. Which doc covers what

| Touching... | Read first |
|---|---|
| Anything | [`docs/README.md`](docs/README.md) |
| Product direction: channels, production/creative mode, pipeline, analytics | [`docs/product/vision.md`](docs/product/vision.md) |
| The feature-test utils (`src/main/utils/*_test.ts`), env knobs, credential import | [`docs/tooling/feature-tests.md`](docs/tooling/feature-tests.md) |
| `mcp-server.ts`, the bridge, `.mcp.json`, adding MCP tools | [`docs/tooling/mcp-server.md`](docs/tooling/mcp-server.md) |
| `.claude/skills/*` | [`docs/tooling/skills.md`](docs/tooling/skills.md) |
| Electron shell, UXP/Premiere plugin, MCP-client architecture, ffmpeg engine decision | [`docs/architecture/platform-decisions.md`](docs/architecture/platform-decisions.md) |
| Canvas nodes, Sessions, Storyboard, promote | [`docs/ui/canvas-and-storyboard.md`](docs/ui/canvas-and-storyboard.md) |
| Play view (single-clip review/trim/split) | [`docs/ui/play-view.md`](docs/ui/play-view.md) |
| The Cut Room / multitrack timeline | [`docs/ui/timeline.md`](docs/ui/timeline.md) |
| The Scripting (chat) panel | [`docs/ui/scripting-panel.md`](docs/ui/scripting-panel.md) |
| Panel resize/collapse behavior | [`docs/ui/layout-and-panels.md`](docs/ui/layout-and-panels.md) |
| The Create panel (aside redesign), Motion graphics workflow | [`docs/ui/create-panel.md`](docs/ui/create-panel.md) |
| Character/location sheets, the asset library, `@` references | [`docs/ui/character-sheets-and-assets.md`](docs/ui/character-sheets-and-assets.md) |
| Connector setup mechanism, credential storage, the copilot browser flow | [`docs/connectors/model.md`](docs/connectors/model.md) |
| Which generation tool to use for what, adding a new connector | [`docs/connectors/catalog.md`](docs/connectors/catalog.md) |
| Publishing-account OAuth (Instagram/YouTube) | [`docs/connectors/publishing.md`](docs/connectors/publishing.md) |
| "What do I build next" | [`docs/build-plan.md`](docs/build-plan.md) |

## 4. Architecture, at a glance

- **Desktop app, not a web app.** Electron + TypeScript, one codebase targeting Windows and Mac.
  Windows is the primary dev target; Mac packaging/signing happens later on Joseph's MacBook.
- **The Claude Agent SDK runs in the main process** and is natively an MCP client — the same model
  Claude Desktop and Claude Code use. Generation tools (muapi, ElevenLabs, Krea, fal, Gemini,
  Yapper) and data tools (ChatRealty) all attach as user-added MCP connections, not per-provider
  integrations built into the app — see `docs/connectors/catalog.md` for which tool covers what.
- **Publishing accounts (Instagram, YouTube) are a different mechanism** — OAuth social logins,
  not MCP connections. Port jpsrealtor's existing account-linking flow rather than building a new
  one; not yet built (see `docs/connectors/publishing.md`).
- **The canvas is the primary surface**, not a chat log — a React Flow-style spatial workspace
  where nodes are generated, uploaded, or linked, then combined by dragging one onto another. A
  third middle-panel **Scripting** view (a real chat, deliberately) is spec'd but not built — see
  `docs/ui/scripting-panel.md` for why that's not a contradiction of "canvas is primary."
- **ffmpeg is shelled out to as a separate process, not linked or bundled.** It's the shared
  engine behind the timeline's export and Play view's non-destructive cutting. Personal use runs
  on the machine's own installed binary (found on PATH); bundling an LGPL build only matters once
  the app is actually distributed (§7). Subtitle *text* comes from a separate speech-to-text MCP
  connection — ffmpeg only muxes/burns, it doesn't transcribe, and that connection isn't built yet.
- **Premiere Pro integration is a UXP plugin**, a genuinely separate codebase and build target from
  the Electron app, bridged over a local server. Phase 2 of the whole project — don't start it
  before the core app works.

## 5. Conventions

- TypeScript throughout. `tsc --noEmit` clean before considering anything done, once there's a
  build to run it against.
- Absolute Windows paths in every file operation (§1.1) — no exceptions, including for an agent
  running on a different OS in a worktree; translate, don't assume.
- Commit messages: what changed, and what it cost to learn — several rules in this file exist
  because something shipped broken or a lesson was paid for on a sibling project; keep that
  provenance rather than writing generic messages.
- No comments explaining *what* code does — name things so the code reads on its own. Comments
  earn their place only for a non-obvious *why* (a workaround, a constraint, a rule this file
  states and the code has to satisfy).
- **No TypeScript or Python file over 700 lines.** A file past that stops being
  readable in one sitting and starts hiding things — `store.ts` reached 2426 lines and
  the session/canvas/timeline/generation code inside it could only be found by scrolling.
  Split by domain (`src/shared/types/*`, `src/shared/model-catalog/*`,
  `src/renderer/src/store/*`, `src/main/connector-intake/*`), and keep the original module
  as a barrel or the create() body so no consumer's imports have to change.
- **Buttons are components, not class-name recipes.** Use `src/renderer/src/components/ui/Button.tsx`
  (`Button` with its variants, `StatusChip` for non-interactive state) instead of hand-picking
  `conn-mini`/`generate-btn`/etc. classes; and never hardcode accent-ink hexes — use
  `var(--accent-ink, …)` so all three themes stay correct. (Both rules exist because the
  Connectors tab shipped an invisible clipped "added" span and 12 wrong-in-Zest inks.)
