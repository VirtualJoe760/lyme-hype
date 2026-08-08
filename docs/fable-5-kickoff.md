# Fable 5 kickoff prompt

Paste this as the first message in a fresh session, opened in this repo
(`F:\web-clients\joseph-sardella\lyme-hype\`). `AGENTS.md` loads automatically via
`CLAUDE.md` — the prompt below assumes that context is already present and doesn't
repeat it. Written for maximum autonomy — no plan-first checkpoint, no pausing between
phases. Go as far as the actual work allows in one run.

---

This is Lyme Hype — read `docs/README.md` and `docs/build-plan.md` for full context.
Nothing is built yet.

Build it. Work through `build-plan.md`'s phases in order, autonomously — **Phase 1**
(Electron + TypeScript scaffold, Claude Agent SDK wired into the main process) straight
into **Phase 2** (Sessions rail, canvas core, stub Image/Video/Audio nodes, combine
interaction, collapsible panels), without stopping to check in between them. Don't ask
for a plan first and don't pause for permission on implementation choices the docs
already cover — the docs are the spec; follow them and go. Use the "Lime Cut" direction
in `docs/concepts/studio-concept-directions.html` as your visual reference for the shell
chrome.

**Natural stopping point:** Phase 3 needs a real ChatRealty API key from Joseph to test
against — that's genuinely where a human has to get involved. Push right up to that
boundary (Phase 1 + Phase 2 both fully done, per their done-criteria in `build-plan.md`),
then report what's built, what's next, and exactly what you need from him to keep going
into Phase 3.

Update the relevant doc in the same change any time you make a decision the docs don't
already cover — don't silently deviate from spec (AGENTS.md rule #3).

Constraints that don't bend, already in AGENTS.md, restated because they matter even in
full-autonomy mode: credentials never pass through you directly — build the native
secure-credential modal (`BrowserWindow` + IPC + `safeStorage`) before Phase 3 needs it,
never a plain input field. ffmpeg (whenever you get to it) must be an LGPL-only build.
Absolute Windows paths for every file operation.

Don't touch `docs/reference-notes-*.md` — historical observations, not specs.

Go.
