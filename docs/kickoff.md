# Kickoff prompt

Paste this as the first message in a fresh session, opened in this repo
(`F:\web-clients\joseph-sardella\lyme-hype\`). `AGENTS.md` loads automatically via
`CLAUDE.md` — the prompt below assumes that context is already present and doesn't
repeat it. Written for maximum autonomy — no plan-first checkpoint, no pausing between
phases. This file gets overwritten for the next round rather than accumulating one
file per round — `history.md` is where past rounds' narrative lives, not this file.

---

This is Lyme Hype. Read `docs/README.md`, then `docs/build-plan.md`, to see what's
built (Phases 1–9, and most of the connector catalog) and what's next.

Build **Phases 10 through 13, in that exact order**: Phase 10 (multitrack timeline),
Phase 11 (Scripting panel), Phase 12 (resizable/collapsible panels), Phase 13 (Create
panel + Motion graphics). Order matters here specifically — Phase 13's Motion graphics
tile has a **hard dependency** on Phase 11's persistent multi-turn agent-conversation
plumbing (see `docs/build-plan.md`'s Phase 13 entry and `docs/ui/create-panel.md`'s
"Decisions" section for the fallback if you ever need to build 13 before 11 for some
reason — don't build the multi-turn plumbing twice). Phase 12 has no dependency on
10/11/13 and could technically interleave, but building straight through in phase
order is simpler to reason about than interleaving — do that unless there's a real
reason not to.

Each of these four docs (`docs/ui/timeline.md`, `docs/ui/scripting-panel.md`,
`docs/ui/layout-and-panels.md`, `docs/ui/create-panel.md`) has every design question
that could plausibly block an unattended build already resolved to a firm default —
look for "Decisions" / "Requirement checklist" sections specifically. Genuinely
non-blocking open questions are labeled as such and don't need resolving before
building; everything else is a decision already made, not a question to re-litigate.
Follow the docs; don't stop to ask permission on choices they already cover — same
autonomy rule as every round before this one (`AGENTS.md` rule 3: update the docs in
the same change if you discover something they don't already cover or got wrong).

**Verification — structural completeness over live spend, same boundary as every
prior round:**

- `tsc --noEmit` (both configs) and `electron-vite build` clean before considering
  anything done, same as always.
- UI flows verified via the browser-mock preview pattern already used every round —
  build the renderer, serve `out/renderer` over localhost, drive it with the browser
  tool. This works for everything in Phases 10–13 except the parts of Phase 13 that
  call a real paid connector.
- **Phase 10's ffmpeg rewrite (`overlay` compositing, `amix` mixing) should be
  verified for real, not just structurally** — synthesize test clips locally with
  `ffmpeg -f lavfi -i "testsrc=..."` / `-i "sine=..."` (colored bars + a tone, no
  connector, no API, no cost — the exact technique already proven working earlier
  this project: two synthetic clips → a real multitrack export → `ffprobe` the
  result to confirm the composited output is actually correct). This is local and
  free; there's no reason to defer it.
- **Do NOT fire a real generation call against any paid connector** (muapi,
  Midjourney, ElevenLabs, Krea, Yapper, Gemini, OpenAI) while building Phase 13.
  Wire every tile completely — the code path, the IPC, the store actions, the UI —
  and verify everything up to the actual connector call using the browser mock and
  the no-connector/error-path guards the way every generation feature has been
  verified so far. Live connector spend (including Krea's LoRA training, which
  costs real money per job, and ElevenLabs voice cloning) is deferred to a session
  with Joseph watching, same as it's been every round. If you're not sure whether
  something counts as "a real call," it does — stop short of it.
- Add self-test coverage the same way every phase has so far (`src/main/selftest.ts`)
  for anything with a pure, checkable core (e.g. the multitrack `filter_complex`
  builder, same pattern as the existing `buildConcatArgs` self-test).

**Commit each phase separately** with a descriptive message (what changed, what it
cost to learn — matching every commit so far this project), not one giant commit at
the end. Update `docs/build-plan.md`'s checkboxes and status lines as you close out
each phase, in the same commit that finishes it — don't let the docs drift behind the
code, that's the one discipline this whole project has run on.

**Natural stopping point:** after Phase 13 is structurally complete and everything
that isn't live-connector-verified is clearly marked as such in `build-plan.md`.
Report what's built, and be explicit about the join-with-Joseph items: which
connectors need a real generation call to actually prove out (video, audio, image,
deepfake, LoRA training), and anything the docs' "Decisions" sections called a
reasonable default that's worth a second look once there's a working UI to actually
look at (tile icon treatment, Motion graphics' default batch size, the exact snapping
tolerance on the timeline — cosmetic/tuning items, not architecture).

Go.
