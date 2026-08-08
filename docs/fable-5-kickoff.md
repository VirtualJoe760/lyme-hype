# Fable 5 kickoff prompt

Paste this as the first message in a fresh session, opened in this repo
(`F:\web-clients\joseph-sardella\lyme-hype\`). `AGENTS.md` loads automatically via
`CLAUDE.md` — the prompt below assumes that context is already present and doesn't
repeat it.

---

This is Lyme Hype, currently 100% planning — nothing is built yet. You should already
have AGENTS.md loaded; read `docs/README.md` next, then `docs/build-plan.md` to see
exactly where we are and what's already decided vs. still open.

Your task is **Phase 1**: scaffold the actual Electron + TypeScript app.

- electron-vite or Electron Forge, your call — both are fine per `docs/platform-decisions.md`.
- Wire the Claude Agent SDK into the main process, confirm it can complete a basic call.
- Basic `BrowserWindow` chrome — use the "Lime Cut" direction in
  `docs/concepts/studio-concept-directions.html` as a rough visual reference for the
  shell (titlebar + toolbar). Doesn't need to be pixel-perfect, just recognizably headed
  that direction.
- Windows is the dev target — see `docs/platform-decisions.md` for why, and for the Mac
  timing.

**Done when:** `npm run dev` opens a real window and the agent responds to a hardcoded
prompt.

Before you generate files: give me a quick plan first — folder structure, which
scaffolding tool, key dependencies. This is a brand-new codebase and I'd rather catch a
wrong turn now than after 40 files exist.

Two things to keep in mind, not to act on yet:

- `docs/connections-and-credentials.md` has a section on publishing to Instagram/YouTube
  by porting jpsrealtor's existing account-linking flow (a sibling project). That's
  Phase 7 work, not now — just don't be surprised when you see the reference.
- `docs/reference-notes-*.md` are historical observations, not specs — don't edit them.
  Everything else: if you make a decision the docs don't already cover, update the
  relevant doc in the same change, per AGENTS.md rule #3.
