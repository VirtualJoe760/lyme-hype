# AGENTS.md — Lyme Hype

Instructions for any coding agent working in this repository.

`AGENTS.md` is the open standard read natively by Codex, Cursor, Copilot, Gemini CLI, Aider,
Windsurf and Zed. Claude Code does not read it natively — it reads `CLAUDE.md`, so the root
`CLAUDE.md` is a two-line file that imports this one. Edit **this** file; never duplicate rules
into `CLAUDE.md`.

---

## 0. Where this project actually is

**Phases 1–2 are built and verified (2026-08-08); Phase 3 is next.** `docs/` is the spec — read
it before touching code, and read [`docs/build-plan.md`](docs/build-plan.md) to see which phases
are done. The Electron + TypeScript app runs (`npm run dev`), the Claude Agent SDK is live in the
main process, and the secure-credential boundary exists and is self-tested
(`LYME_SELFTEST=1 npm run dev`). Phase 3 proper (first real MCP connection: ChatRealty) is
blocked on a real token from Joseph.

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
   [`docs/connections-and-credentials.md`](docs/connections-and-credentials.md).

6. **Publishing to a social platform is immediate — there is no draft step at the API level.**
   Learned the expensive way on the jpsrealtor project (its own `AGENTS.md`: "`social:post`
   publishes to Instagram immediately. No draft step."). Lyme Hype's UI must force an explicit,
   deliberate confirm before any publish action fires, regardless of how the underlying OAuth flow
   is ported in.

7. **ffmpeg must be an LGPL-only build.** Lyme Hype is closed-source; a GPL-component ffmpeg build
   would create copyleft obligations we don't want. Verify whichever prebuilt package gets used
   actually guarantees LGPL-only before depending on it — don't assume.

8. **Env files and credentials never reach git.** Same rule as every other project here — stage by
   explicit path, never `git add -A`, confirm `.gitignore` coverage with `git check-ignore -v
   <file>` before trusting it, never assume.

---

## 2. Repository map

```
lyme-hype/
├── CLAUDE.md            This file's two-line import shim.
├── AGENTS.md             You are here.
├── docs/                 Full spec — read before touching anything else.
│   ├── README.md                              Index. Start here.
│   ├── platform-decisions.md                  Electron, UXP vs CEP, MCP-client architecture,
│   │                                           credential handling, ffmpeg.
│   ├── canvas-node-model.md                    Node types, Sessions, Storyboard, Play view,
│   │                                           Cut Room actions (send-to-timeline, subtitles,
│   │                                           publish).
│   ├── connections-and-credentials.md          The generic connector model, the agent-as-
│   │                                           setup-copilot flow, the credential boundary,
│   │                                           publishing accounts (OAuth, not MCP).
│   ├── build-plan.md                           The actual build order — read this to know what
│   │                                           phase we're in and what's next.
│   ├── reference-notes-jboogx-nightshift.md     Historical — observations only, don't edit.
│   ├── reference-notes-stephenlawyer-canvas.md  Historical — observations only, don't edit.
│   └── concepts/
│       ├── studio-concept-directions.html      Interactive mockup — three visual-identity
│       │                                       directions, Storyboard, Play, Connections panel.
│       └── fonts/                              Bitcount Prop Single + Press Start 2P, self-hosted.
├── src/
│   ├── main/             Electron main process. index.ts (boot/window), ipc.ts (all handlers,
│   │                     sender-validated), agent.ts (Claude Agent SDK, dynamic import — ESM-only
│   │                     dep in a CJS bundle), sessions-store.ts (JSON in userData),
│   │                     credential-vault.ts (safeStorage/DPAPI), secure-credential.ts (the
│   │                     native secret modal), selftest.ts (LYME_SELFTEST=1 plumbing check).
│   ├── preload/          index.ts (the narrow `window.lyme` bridge — the studio renderer's whole
│   │                     world), secure.ts (the modal's even narrower bridge), index.d.ts.
│   ├── shared/           types.ts + ipc-channels.ts, imported by both sides as @shared/*.
│   └── renderer/         React UI (Lime Cut skin). index.html + secure.html entries;
│                         src/store.ts (zustand), src/bridge.ts (real IPC or browser-preview
│                         mock), src/components/* (TitleBar, Toolbar, SessionsRail, CanvasArea +
│                         MediaNode, StoryboardView placeholder, AsidePanel + AgentCard, CutRoom,
│                         CombineDialog, ConnectionsPanel), src/secure/* (modal page).
├── electron.vite.config.ts   Main/preload/renderer builds; two renderer entries (studio + modal).
├── tsconfig.json / .node.json / .web.json   Strict TS; `npm run typecheck` covers both sides.
└── package.json          electron-vite 2 / Vite 5 / React 18 / Electron 38 — version rationale in
                          docs/platform-decisions.md (Node 21 on the dev machine pins Vite).
```

## 3. Which doc covers what

| Touching... | Read first |
|---|---|
| Anything | [`docs/README.md`](docs/README.md) |
| Electron shell, UXP/Premiere plugin, MCP-client architecture, ffmpeg | [`docs/platform-decisions.md`](docs/platform-decisions.md) |
| Canvas nodes, Sessions, Storyboard, Play view, Cut Room, subtitles, publish | [`docs/canvas-node-model.md`](docs/canvas-node-model.md) |
| Connector setup, credential storage, the copilot browser flow, publishing-account OAuth | [`docs/connections-and-credentials.md`](docs/connections-and-credentials.md) |
| "What do I build next" | [`docs/build-plan.md`](docs/build-plan.md) |

## 4. Architecture, at a glance

- **Desktop app, not a web app.** Electron + TypeScript, one codebase targeting Windows and Mac.
  Windows is the primary dev target; Mac packaging/signing happens later on Joseph's MacBook.
- **The Claude Agent SDK runs in the main process** and is natively an MCP client — the same model
  Claude Desktop and Claude Code use. Generation tools (Seedance, ElevenLabs-style audio,
  image-gen) and data tools (ChatRealty) all attach as user-added MCP connections, not
  per-provider integrations built into the app.
- **Publishing accounts (Instagram, YouTube) are a different mechanism** — OAuth social logins,
  not MCP connections. Port jpsrealtor's existing account-linking flow rather than building a new
  one; that review happens against the real jpsrealtor project directory, not from memory.
- **The canvas is the primary surface**, not a chat log — a React Flow-style spatial workspace
  (per the stephenlawyer.clothing precedent) where nodes are generated, uploaded, or linked, then
  combined by dragging one onto another.
- **ffmpeg is bundled** and is the shared engine behind Cut Room export, Play view playback/cutting,
  and subtitle burn-in. Subtitle *text* comes from a separate speech-to-text MCP connection —
  ffmpeg only muxes/burns, it doesn't transcribe.
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
