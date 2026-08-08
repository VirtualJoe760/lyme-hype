# AGENTS.md — Lyme Hype

Instructions for any coding agent working in this repository.

`AGENTS.md` is the open standard read natively by Codex, Cursor, Copilot, Gemini CLI, Aider,
Windsurf and Zed. Claude Code does not read it natively — it reads `CLAUDE.md`, so the root
`CLAUDE.md` is a two-line file that imports this one. Edit **this** file; never duplicate rules
into `CLAUDE.md`.

---

## 0. Where this project actually is

**Phases 1–7 are built (2026-08-08); Phases 10–12 are spec'd but not started.** `docs/` is the
spec — read it before touching code, and read [`docs/build-plan.md`](docs/build-plan.md) to see
which phases are done. The Electron + TypeScript app runs (`npm run dev`), the Claude Agent SDK
drives real agent-driven generation across all seven catalog connectors, the credential vault +
secure-credential modal are self-tested (`LYME_SELFTEST=1 npm run dev`), and Play/Storyboard/Cut
Room export are all real. What's deferred to a joint session (a live generation call, the LGPL
ffmpeg bundle, the Instagram publish port) and what's newly spec'd but unbuilt (an OpenAI image
connector, the Scripting panel, the multitrack timeline, resizable panels) are both tracked in
`docs/build-plan.md` — don't assume either category is done just because most of the app is.

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

8. **Env files and credentials never reach git.** Same rule as every other project here — stage by
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
│   ├── architecture/
│   │   └── platform-decisions.md    Electron, UXP vs CEP, MCP-client model, ffmpeg engine.
│   ├── connectors/
│   │   ├── model.md                  The generic connector mechanism + credential boundary.
│   │   ├── catalog.md                Which tools, why each one, exact connect shapes.
│   │   └── publishing.md             Instagram/YouTube OAuth — a different mechanism, not MCP.
│   ├── ui/
│   │   ├── canvas-and-storyboard.md  Node types, Sessions, Storyboard + promote.
│   │   ├── play-view.md              Full-takeover single-clip review/trim/split.
│   │   ├── timeline.md               Multitrack Cut Room rework — spec'd, not built.
│   │   ├── scripting-panel.md        Third middle-panel chat view — spec'd, not built.
│   │   ├── layout-and-panels.md      Resizable/collapsible panels — spec'd, not built.
│   │   └── create-panel.md           Aside redesign (tile grid + Motion graphics) — spec'd,
│   │                                 not built.
│   └── concepts/
│       ├── studio-concept-directions.html   Interactive mockup — three visual-identity
│       │                                    directions, Storyboard, Play, Connections panel.
│       └── fonts/                    Bitcount Prop Single + Press Start 2P, self-hosted.
├── resources/            Bundled runtime assets shipped with the app (not build tooling).
│   └── gemini-mcp.cjs    Dependency-free stdio MCP server wrapping Gemini's REST API.
├── src/
│   ├── main/             Electron main process. index.ts (boot/window + navigation lockdown +
│   │                     asset protocol), ipc.ts (all handlers, sender-validated), agent.ts
│   │                     (single-turn Agent SDK calls, dynamic import — ESM-only dep in a CJS
│   │                     bundle), generation.ts (agent-driven media generation: attaches every
│   │                     installed connector as an MCP server, canUseTool hard-denies non-MCP
│   │                     tools), sessions-store.ts (JSON in userData), credential-vault.ts
│   │                     (safeStorage/DPAPI), secure-credential.ts (native secret modal),
│   │                     mcp-client.ts (stdio MCP client) + mcp-http.ts (Streamable-HTTP MCP
│   │                     client) + mcp-oauth.ts (MCP OAuth client: discovery, dynamic
│   │                     registration, PKCE, loopback redirect) + mcp-probe.ts (connection
│   │                     check, both transports), chatrealty.ts (pull listing photos + the
│   │                     ChatRealty connector template), connectors-store.ts (generic connector
│   │                     CRUD + live test across all transports), connector-suggestions.ts (the
│   │                     seven-tool catalog + templates), claude-auth.ts (Claude default login +
│   │                     explicit overrides), model-providers.ts (agent LLM: Claude default /
│   │                     Kimi / custom Anthropic-compatible), asset-store.ts (lyme-asset://
│   │                     protocol + import/download into userData/assets), ffmpeg.ts (binary
│   │                     discovery + the export filter-graph builder), selftest.ts
│   │                     (LYME_SELFTEST=1 plumbing check, covers all of the above).
│   ├── preload/          index.ts (the narrow `window.lyme` bridge — the studio renderer's whole
│   │                     world), secure.ts (the modal's even narrower bridge), index.d.ts.
│   ├── shared/           types.ts + ipc-channels.ts, imported by both sides as @shared/*.
│   └── renderer/         React UI (Lime Cut skin, plus Night Terminal + Zest). index.html +
│                         secure.html entries; src/store.ts (zustand), src/bridge.ts (real IPC or
│                         browser-preview mock), src/components/* (TitleBar, Toolbar,
│                         SessionsRail, CanvasArea + MediaNode, StoryboardView (real, not a
│                         placeholder), PlayView, CutRoom, AsidePanel + AgentCard +
│                         ChatRealtyPull, CombineDialog, settings/* (full-screen Settings shell +
│                         Connectors/Models/Appearance tabs)), src/secure/* (modal page). Themes
│                         are CSS-var token sets keyed on <html data-theme>; persists in
│                         PersistedState.
├── electron.vite.config.ts   Main/preload/renderer builds; two renderer entries (studio + modal).
├── tsconfig.json / .node.json / .web.json   Strict TS; `npm run typecheck` covers both sides.
└── package.json          electron-vite 2 / Vite 5 / React 18 / Electron 38 — version rationale in
                          docs/architecture/platform-decisions.md (Node 21 pins Vite).
```

## 3. Which doc covers what

| Touching... | Read first |
|---|---|
| Anything | [`docs/README.md`](docs/README.md) |
| Electron shell, UXP/Premiere plugin, MCP-client architecture, ffmpeg engine decision | [`docs/architecture/platform-decisions.md`](docs/architecture/platform-decisions.md) |
| Canvas nodes, Sessions, Storyboard, promote | [`docs/ui/canvas-and-storyboard.md`](docs/ui/canvas-and-storyboard.md) |
| Play view (single-clip review/trim/split) | [`docs/ui/play-view.md`](docs/ui/play-view.md) |
| The Cut Room / multitrack timeline | [`docs/ui/timeline.md`](docs/ui/timeline.md) |
| The Scripting (chat) panel | [`docs/ui/scripting-panel.md`](docs/ui/scripting-panel.md) |
| Panel resize/collapse behavior | [`docs/ui/layout-and-panels.md`](docs/ui/layout-and-panels.md) |
| The Create panel (aside redesign), Motion graphics workflow | [`docs/ui/create-panel.md`](docs/ui/create-panel.md) |
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
