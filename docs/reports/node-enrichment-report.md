# Node enrichment — nightly report

Human-readable log, newest entry first. Each autonomous run appends one entry here regardless
of whether it shipped code. Read this in the morning; the machine-readable queue is
[`node-enrichment-progress.md`](node-enrichment-progress.md), the per-node analysis is
[`../ui/node-enrichment-strategy.md`](../ui/node-enrichment-strategy.md).

---

## 2026-08-09 — Fifteenth autonomous run: Timeline/export (row 9), Combine's last four pairs go real — row closed

Row 8 was `done` going into this pass (queue confirmed fully closed through row 8), so this run
took row 9 next. Unlike rows 1–8, row 9 never got a flagship-style analysis in the strategy doc —
its seed note just says "lower priority; look for gaps only" — but it didn't need one, because row
7's own writeup already named the exact gap and handed it off explicitly: "the four ffmpeg-
compositing pairs are a distinct, larger piece of scope better left for whoever tackles row 9." So
this pass wasn't a gap-search, it was picking up a pointer someone else already planted.

**The gap, concretely:** `CombineDialog.tsx` has always covered six possible media-type pairings
(image+image, audio+image, video+video, image+video, audio+video, audio+audio — every combination
of the app's three `MediaType`s). Row 7 made the first two real generations. The other four —
"Stitch clips," "Composite overlay," "Score the clip," "Mix tracks" — still spawned Phase 2's
placeholder "combined" node on a fake `setTimeout`, which is worth being precise about: it never
touched a real file at all, just flipped a node's status to `ready` after 2.5 seconds with no `src`
set, ever. That's a materially different kind of stub than most of this queue's "wiring exists,
UI doesn't expose it" gaps — there was no real output on the other end of that button for four of
six draggable pairs.

**What I built:** the whole thing stays local — no connector, no agent turn, which made this the
first row where I didn't have to reason about steering an LLM's tool choice at all. Four new pure
ffmpeg-args builders in `media-tools.ts` (`buildStitchArgs`, `buildOverlayImageArgs`,
`buildScoreArgs`, `buildMixAudioArgs`), matching the shape `buildAlphaKeyArgs` already established
in that file — a plain function from inputs to an argv array, so the filter graph is inspectable
and testable without spawning a process. One dispatcher, `combineLocal()`, keyed on a new
`CombineLocalKind` union (`shared/types.ts`) so the IPC boundary carries one typed request shape
instead of four separate channels. One new IPC round trip, `media:combine-local`, threaded through
the usual four files (`ipc-channels.ts` → `ipc.ts` → `preload/index.ts` → `bridge.ts`, including
the browser-preview mock). On the renderer side, `store.ts` gained `localCombineFor` — a pure
function mapping a dragged pair's two `MediaType`s onto the right `CombineLocalKind` plus which
node's `src` is which ffmpeg input (order matters for overlay-image and score-video, not for
stitch/mix) — and `confirmCombine`'s old placeholder branch now creates a `rendering` node
synchronously, fires the ffmpeg call, and patches the node to `ready`+`src` or `error` on
completion. That's the exact node-lifecycle pattern `generateMedia` already uses for real
generations, deliberately reused rather than inventing a second one — the only difference is what
resolves it (a local `combineLocal` call vs. an agent turn).

**The actual filter-graph decisions, one per pair:**

- **video+video ("Stitch clips")** normalizes both clips to the shared 1080×1920/30fps export
  canvas before `concat` — two independently generated clips can differ in resolution or frame
  rate, the same problem `ffmpeg.ts`'s multitrack export already solved for its own base track,
  reused here via the same scale/pad/setsar/fps chain. The one real judgment call: `concat`'s
  `a=1` mode requires every segment to carry an audio stream, and there's no ffprobe in this
  codebase (only banner-parsing, per `timeline.md`'s own `probeMediaInfo`) to measure a missing
  track's duration for a matching silent filler. Rather than fake a duration, the honest v1
  behavior is video-only output when either clip is silent — a real, stated decision, not a
  silently-dropped case.
- **image+video ("Composite overlay")** draws the still centered and scaled-to-fit over the clip's
  full duration (`overlay=...:shortest=1` plus `-shortest` on the output), the same "scale-to-fit,
  center" treatment `ffmpeg.ts` already gives a non-base overlay track in the real multitrack
  export — reused, not reinvented. The clip's own audio passes through unmixed via the optional
  `0:a?` map (no-op if the clip is silent).
- **audio+video ("Score the clip")** mixes the new audio with the clip's own audio when it has one,
  rather than silently discarding whichever the user didn't drag — a voiceover over an
  already-talking clip should still be audible under it, not replace it outright. `-c:v copy`
  since the video stream itself never changes; only the audio does. Output runs to the shorter of
  the two (`-shortest`) as the deliberate v1 default, the same posture `timeline.md`'s own "Open
  questions" section takes toward its unresolved tuning knobs — revisit if it proves wrong in
  practice, don't guess a fix now.
- **audio+audio ("Mix tracks")** reuses `ffmpeg.ts`'s exact `amix=inputs=...:duration=longest:
  normalize=0` convention rather than inventing a second one — consistency with the one other place
  in this codebase that already mixes audio down.

**UI side:** `CombineDialog.tsx` previously only required both dragged nodes to be `ready` with a
real `src` for the two generative pairs (`missingSrc = generative && ...`); now every pair requires
it, since all six now touch real files. The prompt textarea stays exclusive to the two generative
pairs — the four local pairs are fully determined by which two media types were dragged together,
so there's nothing left for a prompt to disambiguate, and the "Stub for now — the real combined
generation lands in a future pass" placeholder text is gone for good. Two of the six pairs' dialog
blurbs got small accuracy edits (video+video's used to promise a Cut-Room-only transitions payoff
that read oddly next to a real stitch now happening; audio+video's now mentions the mix-not-replace
behavior).

**Verification:** fresh `npm install --include=dev` (no `node_modules` present at run start), then
`npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`) — clean, zero errors, including
the exhaustive `switch` over `CombineLocalKind` in `combineLocal()` type-checking with no default
case needed. **Not run against real media** — this sandbox has no display and no sample video/audio
files staged in the app's own asset store to click "Combine" against. But this is a genuinely
different confidence position than every prior row in this queue: there is no live API key, no
billed connector call, and no agent-tool-choice uncertainty to flag here at all — it's local ffmpeg
running a fully-specified filter graph, the same category of risk `buildMultitrackArgs` already
carries and was verified for real (synthetic clips, actually executed) back at Phase 7. The
remaining risk is narrower and more mechanical: does this exact argv run clean against real files,
which is worth a human's one pass through the app before trusting it blind, but it's a "does the
command run" question, not an "does the agent behave" or "is this API shape real" question.
`creative-nodes.md`'s Combine section and `capability-map.md`'s §3 table row were updated in this
commit to describe the four pairs as real rather than unbuilt.

**Queue state:** rows 1–9 are now all `done`. Only row 10 (Listing photos / ChatRealty) remains —
per the strategy doc, ChatRealty's staging/cover/carousel tools are paid-for and currently unused,
candidate new tiles. Like row 9 was, row 10 has no ready-made build order in the strategy doc yet;
the next run should expect to spend real time reading `docs/connectors/reference/chatrealty.md`
and `docs/ui/creative-nodes.md`'s Listing photos section from scratch rather than following a plan
someone already wrote. Once row 10 closes, every run after that should go straight to the
guardrail's "queue is fully done" path — a dated Recommendations section in this report, not
invented new rows.

---

## 2026-08-09 — Fourteenth autonomous run: Storyboard/Scripting → Deepfake tone handoff (row 8) — row closed

Rows 1–7 were all `done` going into this pass, so this run took row 8 next per the queue's
priority order: "let a script's tone inform which voice/LoRA a Deepfake-shot panel should default
to." Unlike most prior rows, this one had no existing strategy-doc analysis to implement against —
just the one-line queue description — so the first job was figuring out what that sentence
actually cashes out to in this codebase, since "Deepfake-shot panel" isn't a thing that exists:
Storyboard panels only carry `mediaType: 'video' | 'image' | 'audio'`, and the Deepfake tile lives
entirely inside the Create panel, invoked from the tile grid with zero relationship to any panel
or script. So the real gap wasn't a missing parameter, it was a missing *connection* between two
screens that had never talked to each other.

**What I read first:** `docs/ui/scripting-panel.md`'s script → Storyboard handoff section, which
already defines exactly the tone signal this row needs — a script-born panel's `feeling` field is
explicitly "the user's generalized feeling annotation — mood/tone in a few words, the human
judgment step." That's the tone. The missing piece was a destination for it and something on the
Deepfake side worth matching it against.

**What I built, two pieces:**

1. **`personaTone` on `TrainedStyle`** — a free-text tag ("calm authoritative newsreader",
   "energetic upbeat vlogger") a Reference person can carry alongside its existing `voiceName`.
   New `setTrainedStylePersonaTone()` in `fal-training.ts` (mirrors `setTrainedStyleVoice()`
   exactly), a `lora:set-tone` IPC channel end-to-end (channels → main handler → preload → bridge,
   including the browser-preview mock), and a `ToneField` component in `TrainedStylesTab.tsx` —
   same inline-input-plus-Save shape as the existing `VoiceField` it sits directly beside, plus a
   `StatusChip` showing the tag when set.
2. **The Storyboard → Deepfake handoff.** A script-born panel (one with `shotDescription`) now
   shows a "☺" button next to its ✨ improve-prompt button. Clicking it calls a new store action,
   `sendPanelToDeepfake(nodeId)`, which writes `{script: shotDescription, toneHint: feeling}` into
   a new `deepfakeHandoff` field on the zustand store. The Create panel's aside (`AsidePanel.tsx`)
   watches that field: when it's set, it switches its local screen state to `'deepfake'`, and the
   `DeepfakeScreen` component consumes it on mount — prefills the script textarea, and calls a new
   pure function, `suggestReferencePerson(styles, toneHint)`, which lowercases and word-splits both
   the tone hint and every Reference person's `personaTone`, scores by overlap-count, and returns
   the best match (only considering styles that actually have a paired voice, since a bare LoRA
   can't drive Stage 1's speech step anyway). If there's a match, the Reference person picker
   auto-selects it and a status line explains why ("Feeling 'X' matched 'Y'"); if nothing matches
   (or no Reference person has a tone tag yet), the picker stays on "none" and the status line says
   so plainly instead of silently picking something arbitrary — an honest "I don't know" beats a
   confident wrong guess here, especially since nobody's watching this run to catch it if it guessed
   badly.

**Why not an agent call for the matching:** every other row that needed the agent to judge
something ambiguous (Combine's face-vs-not branch, the instrumental-only toggle) used an
embedded-prompt-directive pattern because the judgment genuinely needs the model reading real
content. Matching two short tag strings for word overlap doesn't need that — it's the kind of thing
plain code does deterministically and for free, and using the agent for it would just be one more
unverified live-call risk for no real benefit. This is a deliberate case of *not* reaching for the
agent, not an oversight.

**The one real design decision:** `AsidePanel`'s `screen` state has always been local
`useState` — nothing outside that component could ever navigate it. `StoryboardView` is a sibling
component, not a child, so this handoff had to cross through the shared zustand store rather than
a prop callback (the way row 6's "Train a LoRA from this photo" shortcut could stay entirely
inside `AsidePanel` since both the Deepfake and LoRA screens already lived there). That's a
slightly bigger blast radius than most of this queue's changes — new store state plus a `useEffect`
that can force-navigate the Create panel's aside out from under whatever the user was doing there —
so I kept the trigger fully explicit (a dedicated button the user has to click, not something that
fires from typing) and made consuming the handoff a one-shot (`clearDeepfakeHandoff()` fires
immediately after reading it) so returning to Storyboard and back to Deepfake doesn't repeatedly
re-navigate or re-clobber whatever the user typed since.

**Verification:** `npm run typecheck` clean (ran a fresh `npm install` first — no `node_modules`
in this sandbox at run start; both `tsconfig.node.json` and `tsconfig.web.json` pass). **Not
exercised in a running browser** — this sandbox has no display, so I could not actually click
"☺" on a panel and watch the Deepfake screen react. That's a different and, I think, real gap in
confidence versus most prior rows: those rows' main open risk was "does the live API call actually
work," which needs real keys either way; this row's main open risk is "does the cross-component
state hand-off actually fire correctly in the browser," which real keys wouldn't help verify
either — someone should click through this once before trusting it. `docs/ui/creative-nodes.md`
(Storyboard panel section, Reference person section) and `docs/architecture/capability-map.md`
(new Storyboard → Deepfake handoff row) updated in this commit; `docs/ui/node-enrichment-strategy.md`
row 8 filled in with the same analysis-then-status structure every other row uses.

**Queue state:** rows 1–8 are now all `done`. Only row 9 (Timeline / export — explicitly
lower-priority, "look for gaps only") and row 10 (Listing photos / ChatRealty — new tiles for
already-paid-for, unused tools) remain. The next run should expect to spend real time just finding
what's worth building on row 9 rather than following a ready-made plan, since — unlike rows 1–8 —
the strategy doc never got a flagship-style analysis written for it ahead of time.

---

## 2026-08-09 — Thirteenth autonomous run: Combine (row 7), image+image and audio+image go real — row closed

Row 6 was fully done as of the eleventh run (confirmed again by the twelfth run's collision
review), so this pass moved to row 7 per the queue's priority order: Combine has been a stub
since Phase 2 — dragging one node onto another spawned a placeholder "combined" node on a fake
rendering timer, with no real generation behind it at all.

**What I found before writing anything:** less missing plumbing than the queue's phrasing
suggested. `GenerationParams.referenceImagePaths` (for image-ref-conditioning) and
`sourceMediaPath`/`referenceAudioPaths` (for driving a face/still with audio) already exist as
typed fields, already flow end-to-end through `store.ts` → `bridge.generate.run` →
`generation.ts`, and `generation.ts`'s `toDiskPath` already resolves a canvas node's
`lyme-asset://` `src` to a real filesystem path — because rows 1 (Deepfake) and 2 (Motion
graphics) built and proved exactly this plumbing already. The actual gap was narrower and more
literal: `CombineDialog.tsx` never called `generateMedia` at all, for any pair, ever — `confirmCombine`
in `store.ts` unconditionally spawned a placeholder node on a stub timer. The dialog's own blurb
for the image+image case even said "prompt how they should mix," but there was no textarea
anywhere in the dialog for a user to type that prompt into. The real work here was mostly wiring
an existing mechanism through a dialog that had never been connected to it, not inventing a new
capability.

**What I built:** `CombineDialog` gained a prompt textarea, shown only for the two pairs getting
real semantics this pass (image+image, audio+image — either drag order), with a per-pair
placeholder string as a sensible default if the user leaves it blank. `confirmCombine` in
`store.ts` now dispatches on the sorted media-type pair: **image+image** calls `generateMedia`
with `mediaType: 'image'` and `referenceImagePaths: [source.src, target.src]` — the same field
Motion graphics' References stage uses for reference-conditioning. **audio+image** calls
`generateMedia` with `mediaType: 'video'`, `sourceMediaPath: <the image's src>`,
`referenceAudioPaths: [<the audio's src>]` — the identical chain Deepfake's Stage 2 uses to drive
a face with already-generated speech, reused as-is rather than restricted to a specific connector
pair: Deepfake restricts to muapi+Yapper because its chain note steers a specific
upload-then-lipsync sequence across exactly those two connectors, and Combine has no such
sequence to steer around, so it leaves the connector unrestricted and lets the agent pick from
whatever's installed — the same default posture Generate video and Generate image already use.
Since there's no way to actually detect whether the dragged image shows a face, I pushed that
judgment into the prompt itself rather than adding a UI toggle nobody would remember to set: "If
the image shows a face, lip-sync its mouth to the audio like a talking avatar. Otherwise animate
the still to the mood and pacing of the audio and use the audio as its soundtrack." This is the
same prompt-embedded-directive pattern the Suno instrumental-only checkbox (row 5) and Deepfake's
chain note (row 1) already established for steering agent tool choice through plain text instead
of a new typed field — consistent with how this codebase has been handling exactly this kind of
ambiguity across every prior row. The Combine button now disables until both dragged nodes are
`status: 'ready'`, since the real paths need finished files on disk, not an in-flight render — the
placeholder path never needed that guard because it never touched a real file. While in the file,
also converted the dialog's two raw `<button className="btn">`/`"btn primary">` elements to the
shared `Button` component (`variant="dialog"` / `"dialog-primary"`) per `AGENTS.md`'s
component-not-class-name-recipe rule — a same-file drive-by, not separate scope, since both
classes already map 1:1 onto `Button`'s existing `dialog`/`dialog-primary` variants.

**Deliberately left as the stub:** the other four combine pairs — video+video, image+video,
audio+video, audio+audio — still spawn the placeholder node. Those are ffmpeg-level compositing
jobs (stitch, score, mix), not agent generations; giving them real semantics means designing a
local-compositing mechanism this codebase doesn't have yet, which is meaningfully more scope than
one run and, per the strategy doc's own priority ordering, belongs with row 9 (Timeline / export)
where the ffmpeg pipeline already lives, not bolted onto this dialog ad hoc.

**Verified:** fresh `npm install` (no `node_modules` present at run start), then `npm run
typecheck` (`tsconfig.node.json` + `tsconfig.web.json`) — clean, zero errors. **Not run live** —
no connector keys configured in this sandbox, and live generation spend stays out of scope for
this routine regardless (`AGENTS.md` §0). Risk here is lower than most prior rows, not higher:
both `GenerationParams` fields this pass uses were already built and already exercised end-to-end
by rows 1 and 2, so nothing about *how* a local path reaches a generation tool is new — the only
genuinely unverified piece is whether the agent reliably follows the face-vs-not branch
instruction in the audio+image prompt, which needs a joint session with real keys to actually
watch play out.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): `creative-nodes.md`'s
Combine section rewritten from "still the stub" to describe the two real pairs and the four that
intentionally remain stubs; `capability-map.md` gained three Combine rows in §3's node table and
a correction to §4's muapi image-edit bullet (Combine's design has now started, per that bullet's
own prior wording, even though it doesn't specifically steer the agent toward muapi's image-edit
tool the way Deepfake steers toward muapi/Yapper); the strategy doc's row 7 status block.

Row 7's two named items are both closed. Next run should move to row 8 (Storyboard / Scripting)
per the queue's priority order — letting a script's tone default a shot panel's voice/LoRA pick.

---

## 2026-08-09 — Twelfth autonomous run: collided with the eleventh on row 6, deferred after review

Reached row 6 (Create a LoRA) independently at the same time as the run logged directly below —
same starting point (row 5 fully done as of the tenth run), same queue item ("train from this
deepfake's reference photos"), and, strikingly, the same real bug found along the way: `lora:train`'s
IPC handler passed `imagePaths` straight to `trainStyle()`, which `readFileSync`s each path
directly, with no resolution for `lyme-asset://` canvas-node URLs (unlike `scriptingTurn`'s
existing resolution for the same scheme). Both runs independently wrote the identical
`assetPathForUrl` fix for that half.

Where the two runs diverged is the actual shortcut. I read "train from this deepfake's reference
photos" as license for a general capability — `LoraScreen` gained a multi-select picker grid over
*any* ready canvas image node (reusing Motion graphics' `mgfx-ref` selection pattern), so training
images can come from disk and/or the canvas in one combined list. The other run read it more
literally and built a tighter, more directly-named feature: a "◈ Train a LoRA from this photo"
button on the Deepfake screen's own face-node picker, appearing only when the picked node is a
still image, that jumps straight to Create a LoRA with that exact photo prefilled (plus a fix so
the disk-file picker adds to the prefilled selection instead of replacing it). On reflection their
version is the more faithful reading of the row's own wording — it's literally the one-click path
from "this deepfake" to "a LoRA from its reference photo," where mine is a more general (arguably
scope-creepy) canvas-image picker that solves a broader problem the row didn't actually ask for.

By the time I went to push, `07e88f5` (the entry directly below) had already landed on the shared
branch. I attempted the standard recovery (`git pull --rebase`), which conflicted in all six files
either run had touched — both the identical `ipc.ts` fix and unrelated doc-log entries collided
line-for-line, as expected from two runs solving the same row at once. Rather than hand-splice a
merge under this run's time budget, I aborted the rebase, reviewed the other run's diff directly
(`git show 07e88f5`), confirmed it's sound — clean `assetPathForUrl` resolution identical in
substance to mine, a reasonable and well-scoped UI addition, `npm run typecheck` passes on their
tip in this sandbox too — and reset this branch to their commit rather than fight the merge, the
same call the eighth run made on row 4's collision. No code changes shipped from this pass; this
entry and the corresponding progress-file note are the only diff. Row 6 stays `done` from the
eleventh run's commit. Next run should move to row 7 (Combine) — currently a stub, real semantics
spec'd in the strategy doc, and worth a fresh look at whether the still-open cross-cutting
`asset-upload` helper is now genuinely blocking it or whether a narrower slice is buildable first.

---

## 2026-08-09 — Eleventh autonomous run: Create a LoRA (row 6), Deepfake-photo shortcut — row closed

Row 5 was fully done as of the tenth run, so this pass moved to row 6 per the strategy doc's
priority order: "Create a LoRA" already has two working trainers, and the queue's stated gap was a
"train from this deepfake's reference photos" shortcut, now unblocked since row 1's Reference
person concept shipped several runs ago.

**What I built:** the Deepfake screen's face/performance-node picker now shows a "◈ Train a LoRA
from this photo" button whenever the currently-picked node is a still image (deliberately excluded
for video source nodes — neither trainer accepts a video, and grabbing a representative frame
automatically felt like a decision a user should make explicitly, not one worth guessing). Clicking
it jumps to the Create a LoRA screen with that image already loaded as the first training file,
`kind` defaulted to "Subject / character" instead of "Style" (this is a person's likeness, not a
visual style), and `name` defaulted to `"<Reference person> — LoRA"` when a person was picked (or
the node's own label otherwise). Also fixed the LoRA screen's file picker so a second picker click
*adds* to the current selection instead of replacing it outright — without that, prefilling one
photo and then picking three more to round out the set to 4+ would have silently thrown the
prefilled one away, defeating the point of the shortcut.

**The part that took real digging, not just UI wiring:** the shortcut only works if the training
`imagePaths` array can actually contain a canvas node's `src`, and canvas node sources are always
`lyme-asset://<file>` URLs — everything generated, uploaded, or link-imported gets copied into
`userData/assets` and referenced that way (`asset-store.ts`), never a raw filesystem path. Both
trainers (`fal-training.ts`, `krea-training.ts`) call `readFileSync(path)` directly on every entry
in `imagePaths`. That's correct for what the native file-picker always handed back before this
pass, and would throw `ENOENT` on a `lyme-asset://` string, since it isn't a real path at all. I
checked whether this resolution step already existed anywhere in the codebase before writing it —
it does, one case away: `ipc.ts`'s `scriptingTurn` handler already resolves `lyme-asset://` URLs to
disk paths via `assetPathForUrl()`, built for the Motion graphics wizard's vision-input references,
which is the exact same "canvas node feeds a main-process call" shape. The `lora:train` handler two
cases below it in the same file just never got the equivalent fix, because until this shortcut
existed there was no code path capable of handing it a `lyme-asset://` URL. Added the identical
one-line resolve-and-filter to `lora:train`, matching the existing pattern rather than inventing a
new one — and since it lives at the IPC layer, not inside the shortcut's own code, any future
caller that wants to train from a canvas node (not just this one button) gets it for free.

**Verified:** `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`; this sandbox
needed a fresh `npm install` again — `node_modules` wasn't present at run start). **Not run
live** — no fal or Krea key is configured in this sandbox, and live spend is out of scope for this
routine regardless. Worth calling out explicitly, though: this is one of the lower-risk changes
shipped so far precisely because it doesn't touch *how* a trainer consumes `imagePaths`, only
*which strings* are now valid to appear in that array before hitting the same unchanged
`readFileSync` call — so there's less than usual riding on the eventual live-key verification pass.

**Docs updated in the same commit:** `docs/ui/creative-nodes.md` (Create a LoRA tile row now
mentions canvas-node image sources; a new paragraph under the Deepfake stage list cross-links the
shortcut both directions), `docs/ui/node-enrichment-strategy.md` (row 6 status block),
`docs/reports/node-enrichment-progress.md` (row 6 marked done, session log entry).

Row 6 has nothing left buildable blind. Next run should move to row 7 (Combine) per the queue's
priority order — the canvas drag-onto-node stub is still unimplemented semantics, a genuinely
different shape of work than the last several parameter-wiring/prefill passes.

---

## 2026-08-09 — Tenth autonomous run: Generate audio (row 5), Suno-via-muapi music fallback — row closed

Picked up exactly where the ninth run's resume note said to: row 5's one remaining item,
Suno-via-muapi as a music alternative when ElevenLabs isn't connected. Read the reference doc
(`docs/connectors/reference/muapi.md`) first — `muapi_audio_create` is Suno full-song generation
(`prompt`/`title`/`tags`/`make_instrumental` → job → audio URL), distinct from
`muapi_audio_from_text` (MMAudio SFX/ambience, already out of scope here) — then read
`AudioScreen`'s `run()` function and confirmed `elevenlabs-tools.ts`'s `music()` is a hard
ElevenLabs-only call (`withElevenLabs()`, fails outright with no connector fallback if ElevenLabs
isn't connected — the Music tab's Compose button wasn't even gated on `ready` before this pass, so
clicking it without ElevenLabs connected just produced an error).

**What I built:** `AudioScreen` gained a `useMuapiMusicFallback` flag (`!ready && muapiReady`,
same shape as the Voice job's existing `useYapperVoiceFallback`). Unlike the Yapper TTS fallback
— a synchronous REST call that fits the screen's uniform `run()`/await/`addNode` pattern —
`muapi_audio_create` is agent-driven, so this needed the *other* generation shape already proven
elsewhere in this file: `VideoScreen` and `DeepfakeScreen` both call the store's `generateMedia`
(which creates a rendering canvas node immediately and resolves async) and track it with
`ResultRow`, the shared rendering→ready/error component. The Music tab now branches on the
fallback: when active, a new `composeMusicViaMuapi()` calls `generateMedia({mediaType: 'audio',
connectorId: 'muapi', modelHint: 'suno', ...})` and the tab renders `<ResultRow
nodeId={musicResultId} />` instead of the direct-path status line. `modelHint: 'suno'` matters
specifically because muapi exposes two audio tools and the agent needs a nudge toward the music
one, not the SFX one. Picked up a genuinely useful small feature for free while in there: an
"Instrumental only (no vocals)" checkbox that appends "Instrumental only, no vocals." to the
prompt text — this is `muapi_audio_create`'s own `make_instrumental` parameter, exposed to the
agent as a plain-language directive in the prompt rather than adding a new typed field to
`GenerationParams`, the same embedded-directive pattern the Deepfake screen's Stage 2 "chain note"
already established for steering the agent's tool choice through free text. Also tightened a
pre-existing gap while touching this code: the direct (ElevenLabs) Compose button is now disabled
when ElevenLabs isn't connected and no fallback applies, instead of being clickable straight into
a guaranteed error — matching how the Voice tab already gates its own button.

**Verified:** fresh `npm install` (no `node_modules` in this sandbox), then `npm run typecheck`
(`tsconfig.node.json` + `tsconfig.web.json`) — clean, zero errors. **Not run live** — no muapi API
key configured in this sandbox, and live generation spend is out of scope for the autonomous
routine regardless (`AGENTS.md` §0). The plumbing itself isn't new — `generateMedia` →
`generation.ts`'s `buildMcpServers`/agent-turn path is the exact mechanism rows 1–3 already
exercised for Deepfake, Motion graphics, and Generate video — so the only genuinely unverified
part is whether the agent reliably picks `muapi_audio_create` over `muapi_audio_from_text` given
the `modelHint`, which needs a joint session with a real key to actually watch.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): `creative-nodes.md`'s
Generate audio · Music row, `capability-map.md` (the Audio · music routing row, and §4's "Suno via
muapi" bullet flipped from "still open" to "now wired" with the actual implementation shape), and
the strategy doc's row 5 status block (second-pass entry appended).

**Row 5 is now fully `done`** — both named items (Yapper TTS fallback, Suno-via-muapi) shipped
across the ninth and tenth runs. Next run should move to row 6, Create a LoRA (the "train from this
deepfake's reference photos" shortcut, unblocked now that row 1's Reference-person concept
exists).

---

## 2026-08-09 — Ninth autonomous run: Generate audio (row 5), Yapper free-tier TTS fallback

Checked rows 1–4 first: rows 1–3 are `done` or joint-session-only per their own notes, and row 4's
Krea-direct trainer work (the eighth run's entry directly below) is settled — `git fetch` showed
nothing new to reconcile, so no repeat work there. Moved to row 5, Generate audio, next `pending`.

**What the tile was missing:** `AudioScreen`'s Voice job (`AsidePanel.tsx`) is entirely built on
direct ElevenLabs tool calls (`elevenlabs-tools.ts`, the ChatRealtyPull-style "no agent turn"
pattern) — browse, preview, and generate all go through `withElevenLabs()`. Without an ElevenLabs
connection, the whole job silently fails; there was no fallback despite one existing on paper.
`docs/connectors/reference/yapper.md` documents `POST /audio/speech` — a **synchronous**, free
daily-character-tier script→voice endpoint on the same REST base the Deepfake row (row 1) already
built a client for (`yapper-rest.ts`, `yap_live_…` key, separate from the OAuth MCP login). That
endpoint was never called from anywhere in the app.

**What I built:**
- `yapper-rest.ts` gained `synthesizeYapperSpeech(input: {text, voiceId?})`: validates the
  2500-char cap the endpoint documents, `POST /audio/speech` with `{script, voiceId?}`, then
  downloads the returned `url` through `asset-store.ts`'s `importUrlAsset()` into `userData/assets`
  — same shape every other generation result lands in (`lyme-asset://`). Returns the response's
  `freeCharactersRemainingToday` count too, so the UI can surface it.
- New `audio:yapper-tts` IPC channel, wired end-to-end: `ipc-channels.ts` → a thin `ipc.ts` handler
  (same sender-validation pattern as every other `audio:*` channel) → `preload/index.ts`'s
  `audioTools.yapperTts` → `bridge.ts`'s `Bridge` interface, browser-mock stub, and pass-through.
  `AudioToolResult` (`shared/types.ts`) gained an optional `freeCharactersRemainingToday` field
  rather than inventing a parallel result type for one extra number.
- `AudioScreen`: added a `yapperTtsReady` check (`bridge.secrets.list()` for the `yapper-rest`
  synthetic vault id — same duplicated-string pattern `ConnectorsTab.tsx` already uses for the same
  id, since main-process constants can't cross into renderer code). When ElevenLabs isn't connected
  and that key is set, the Voice job auto-routes `run('voice')` through `yapperTts` instead of
  `tts`, hides the ElevenLabs-only browse/preview/voice-name UI (Yapper's free tier is one default
  voice, no browsing built this pass), and shows a status line with the free-characters-remaining
  count on success. The run-line reflects three states now: ElevenLabs connected, Yapper-fallback-only,
  or neither (unchanged "Connect →" prompt).

**What I did not build:** Suno-via-muapi as a music alternative, the row's second named item.
`muapi_audio_create` is an agent-driven MCP tool (the model has to call it, same as every other
muapi generation tool), not a synchronous REST endpoint like Yapper's speech call — wiring it means
routing the Music job through `generation.ts`'s agent path with `connectorIds: ['muapi']`, a
materially different shape than today's direct-call `AudioScreen` pattern. That's real design scope
(does Music job get a provider toggle? does the whole tile change shape when only muapi is
connected?) better left for its own pass than rushed alongside the TTS fix.

**Verified:** fresh `npm install` (no `node_modules` in this sandbox — 168 packages, clean), then
`npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`): clean, zero errors. **Not run
live** — no Yapper REST key configured in this sandbox, and live spend is out of scope for the
autonomous routine regardless. The one soft spot, same category as the row 1 upload flow it sits
beside: `POST /audio/speech`'s request/response field names (`script`, `voiceId`, `url`,
`freeCharactersRemainingToday`) come from the reference doc's live OpenAPI enumeration, not a
hand-verified real response — reasonably trustworthy (it's a documented, simpler endpoint than the
upload flow's undocumented-field-name upload response), but still unfired.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): `creative-nodes.md`'s
Generate audio · Voice row, `capability-map.md` (the `audio-tts` matrix cell, the Audio · voice
routing row, and §4's unwired-paths bullet — split into "Suno still open" / "Yapper TTS now wired"
instead of listing both as open), and the strategy doc's row 5 status block.

**Left in-progress** — row 5's resume note is now down to one item: Suno-via-muapi, real scope
needing its own design pass (agent-path routing, not a parameter wire-up), not a joint-session-only
item like several other rows' remainders. Next run should either finish that or move to row 6
(Create a LoRA) if it judges the design scope too large for one pass — same call the fifth run made
on Motion graphics's third item.

---

## 2026-08-09 — Eighth autonomous run: collided with the seventh on row 4, deferred after review

Reached row 4 (Generate image) independently, at the same time as the run logged directly below
this entry. Diagnosed the same root cause they did — `ImageScreen` forced `connectorId: 'fal'`
for any picked style regardless of the tier toggle, which meant the tier toggle was cosmetic and
the cost badge lied about what a style-driven generation actually cost — and built a narrower fix
for it: lock the tier tab to the style's trainer and correct the cost badge, nothing else. On the
second queue item (Krea 2 direct `styles:[{id,strength}]`), I concluded it was a dead end rather
than a build task: it needs a Krea-side `style_id`, the only source of one is Krea's own `POST
/styles/train`, and that REST client (`krea-training.ts`) was deliberately deleted one commit
before this enrichment queue even existed (`4e96389`, an explicit user call: fal's published
per-step pricing over Krea's unpublished balance billing). Reviving deleted code to build a
feature the project owner had just removed the underpinning of read, to me, as exactly the kind
of call these guardrails say to leave for a human — so I documented it as a known non-route
instead and left it there.

By the time I went to push, the other run had already landed `f612861` — the entry directly
below — which read the same fork in the road differently: it treated the original commit
message's own words ("Krea-native client lives in git history if that route ever comes back") as
license to bring `krea-training.ts` back as a second, explicitly opt-in trainer alongside fal's
(not replacing it as the default), and used it to make Krea-trained styles genuinely tier-aware
via real K2 Medium/Large routing — closing both queue items instead of one and documenting the
Krea-side `/styles/train` shape faithfully from the pre-deletion version. That's a more permissive
reading of the same commit message than mine, and on review it's a defensible one: "opt-in
alternative" is a materially different claim than "reverse the default," and the implementation
keeps fal as the default trainer untouched.

Rather than force a rebase through the same handful of files two runs had just independently
rewritten (the fourth run's collision on row 1 set the precedent for this: don't fight it), I
reset this branch to `f612861` and re-ran `npm run typecheck` against it myself — clean, zero
errors, independently confirmed rather than taken on their word. No code changes in this entry;
it exists to flag the judgment-call divergence for the morning read, not because the outcome was
wrong. Worth a human glance specifically because "an autonomous run brought back code you deleted
yesterday" is the kind of thing that should get eyes on it even when the reasoning holds up,
which — going through it a second time here — it does.

Next run should move to row 5 (Generate audio); row 4 is closed, no repeat needed.

---

## 2026-08-09 — Seventh autonomous run: Generate image (row 4), a routing bug fix + Krea's LoRA trainer resurrected

Checked rows 1–3 first: row 1 (Deepfake) and row 2 (Motion graphics) both have only real,
joint-session-scope items left per their own resume notes; row 3 (Generate video) is `done`. So
moved to row 4, Generate image, next `pending` in the queue.

**What I found wasn't quite what the queue item described.** The queue said "extend `lora-use` to
production tier" and "consider Krea 2 direct as a second LoRA route" as if they were two separate,
smaller asks. Reading `ImageScreen` (`AsidePanel.tsx`) turned up something sharper: a picked
`TrainedStyle` always forced `connectorId: 'fal'`, full stop — `style !== undefined ? 'fal' : ...`.
That's not a missing feature, that's a bug. `TrainedStyle.connectorId` is typed as `'krea' | 'fal'`
in `shared/types.ts` specifically so a style knows which backend trained it and should serve it —
the field has existed since before fal became the default trainer, and generation-time routing
had simply stopped reading it. Any legacy `connectorId: 'krea'` style sitting in a user's
`trained-styles.json` would silently and incorrectly route through fal, which has no idea what to
do with a Krea style id.

**Why nobody could hit this yet:** there was no live path to actually create a `connectorId:
'krea'` style anymore. `git log` on `krea-training.ts` told the real story — it existed once
(`4f93dc3`), implementing exactly this: `POST /styles/train` against Krea's own REST API,
producing a style usable via Krea 2's `styles:[{id,strength}]` generation param. It was
deliberately removed a commit later (`4e96389`, "LoRA training: both fal Krea trainers replace the
Krea-native client") when fal's published per-step pricing beat Krea's unpublished per-job
API-balance billing as the *default* — the commit message says outright "Krea-native client lives
in git history if that route ever comes back." It's back, on purpose, narrower than before: an
opt-in second trainer, not fal's replacement.

**What I built:**
- `src/main/krea-training.ts`, resurrected from `4f93dc3` and adapted to the current codebase: same
  `POST /assets` (multipart) → `POST /styles/train` → `GET /jobs/{id}` poll flow, now importing the
  shared `TrainedStyle`/`TrainStyleResult` types instead of duplicating them, and no longer owning
  its own JSON store (that responsibility stayed put in `fal-training.ts`, which now dispatches to
  it). One improvement over the original draft: the training-submit body now sets `model: 'k2'` and
  `type` (Style/Object from the kind toggle) explicitly — the newer, more complete reference doc
  (`docs/connectors/reference/krea.md`) documents both fields where the original draft omitted
  them and likely relied on undocumented defaults.
- `fal-training.ts`'s `trainStyle()` gained a one-line dispatch: `trainer === 'krea-k2'` routes to
  `trainKreaStyle()` instead of the fal path, then persists the result through the same
  `writeTrainedStyles` the fal path already uses. This meant zero new IPC surface — the existing
  `lora:train` channel, preload bridge, and renderer call all already thread an arbitrary
  `trainer` string through untouched.
- `AsidePanel.tsx`: `TRAINERS` gained a third entry ("Krea 2 direct — production styles route"),
  and `LoraScreen`'s readiness/run-line now check whichever connector the selected trainer actually
  needs (`fal` or `krea`) instead of hardcoding `fal`. `ImageScreen`'s `handleGenerate`/`runLabel`/
  `runOk` now dispatch on `style.connectorId` — the actual bug fix — with a Krea-specific hint that
  names the tier-appropriate model (`krea/krea-2/large` for Production, `krea/krea-2/medium` for
  Storyboard) and the `styles:[{id,strength}]` param to pass, mirroring the existing fal-style hint
  pattern (`modelHint` → `buildPrompt`'s "Model preference: use a ‹hint› model..." line).

**Why this closes both queue items in one fix, not two:** fal's route applies a style via a fixed
weights URL — there's no "higher-quality fal rendering" of the same LoRA to swap in for Production
tier, so tier was always going to stay meaningless for fal styles. Krea 2 Large ($0.06, "highest
quality K2" per the reference doc) vs. Krea 2 Medium ($0.03) is a real quality delta reachable only
through Krea's own endpoints — so making Krea styles tier-aware *is* "extending lora-use to
production tier," and it only exists because the Krea route (item two) got built. They were never
independent; the queue just read that way.

**Verified:** fresh `npm install` (no `node_modules` in this sandbox, 168 packages, clean), then
`npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`): clean, zero errors. **Not run
live** — no Krea key configured in this sandbox, and live spend is out of scope for the autonomous
routine regardless. Being specific about where the risk actually sits: the `/styles/train` request
shape and the `GET /jobs/{id}` poll are unchanged from the original 2026-08 draft, which was
written against Krea's official API reference — reasonably trustworthy. The one piece that was
*always* a guess, in both the original draft and today's revival, is what field name `POST /assets`
returns the uploaded image's URL under; the doc never says. The code tries three candidates
(`url`, `asset_url`, `file_url`) before falling back to a base64 data URI the training endpoint
also documents accepting, so a wrong guess degrades to "slower, still-correct" rather than
"silently broken" — but it's still unverified against a real response body.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): this was the one that
actually mattered most this run. `docs/connectors/catalog.md`'s Krea section had drifted badly —
it described `krea-training.ts` as already implementing "exactly this shape" and Generate image as
already routing Krea styles via `connectorId: 'krea'`, neither of which was true until this commit;
now both are. `docs/connectors/reference/krea.md`'s opening paragraph had the same problem, phrased
as settled fact about unbuilt code. Also updated: `capability-map.md` (`lora-train`'s Krea cell,
the Generate-image-with-style routing row, and a new §4 correction note), `creative-nodes.md`
(Generate image and Create a LoRA rows), and the strategy doc's row 4 status block.

**Left for later:** nothing named on row 4 — both queue items are closed. Live verification of the
whole Krea training→use chain (and confirming the `/assets` response field name for real) is
joint-session scope, same category as rows 1–3's open items. Next run should move to row 5
(Generate audio) unless another run gets there first.

---

## 2026-08-09 — Sixth autonomous run: Generate video (row 3), i2v starting frame + Yapper model routing

Checked rows 1 and 2 first, per the queue's own resume notes: row 1 (Deepfake) has nothing left
that's safely buildable blind — its only open item is live verification of the muapi/Yapper
upload→lipsync chains, explicitly joint-session scope. Row 2 (Motion graphics) has one open item
(muapi image-edit as a second batch source) that the prior run correctly flagged as "a genuinely
different generation path, not a parameter wire-up" — real design scope, not a blind-safe fit for
a 15-20 minute pass. So moved to row 3, Generate video, next in the strategy doc's priority order
and still `pending`.

**What the tile was missing:** `VideoScreen` (the Create panel's Generate video tile,
`AsidePanel.tsx`) was single-shot text→video only — a prompt, aspect/duration/resolution chips,
and a manual connector dropdown. Two capabilities the connector layer already supports were
invisible to the user: Gemini's Veo wrapper accepts a `start_frame_path` for image-conditioned
video (already plumbed end-to-end for the Motion graphics wizard's Animate stage, just never
exposed on this simpler tile), and Yapper's hosted connector is a genuine ~20-model video
aggregator (Seedance, Kling, Veo, Sora, Wan, Pixverse, Grok Imagine, and more per
`docs/connectors/reference/yapper.md`) with no way to name a specific model from the UI — only
"connect Yapper and hope the agent picks something reasonable."

**What I built:** two new pickers in the tile's "More options" section, both reusing plumbing that
already exists rather than adding any:

- **Starting frame (i2v).** Lists the canvas's ready, non-panel image nodes. Picking one sets
  `GenerationParams.startFramePath` to that node's asset path and forces `connectorId: 'gemini'`
  — checked the capability matrix first: Gemini's `start_frame_path` is the *only* wired i2v path
  today, muapi and fal both need a general-purpose `asset-upload` helper first (still an open
  cross-cutting item), so silently letting the picker apply to any connector would have been a
  UI promise the backend can't keep. The run-line reflects this: it reads "runs on gemini · i2v
  start frame (Veo)" when Gemini is connected, or "i2v needs gemini connected" (with the usual
  Connect → button) when it isn't.
- **Yapper model.** A `YAPPER_VIDEO_MODELS` list (~20 entries, transcribed from the reference
  doc's model table with a duration/resolution hint per entry) that sets `modelHint` to the
  literal model id and forces `connectorId: 'yapper'` — the exact same "hand the agent an
  unambiguous id from the tool's own enum, not a label to interpret" pattern the Veo quality-tier
  picker established in row 2's Motion graphics pass.

The two pickers are mutually exclusive by precedence in the generate handler — a chosen starting
frame always wins over a chosen Yapper model, since only Gemini can honor frame conditioning —
and the existing manual connector dropdown still works untouched when neither is set.

**Verification:** `npm run typecheck` — had to run `npm install --include=dev` first, since this
session's `node_modules` existed but was missing `@types/node` and other devDependencies (a
stale/partial install carried over from an earlier pass rather than a genuinely fresh one; worth
a note in case a future run hits the same `TS2688: Cannot find type definition file for 'node'`
error and wonders why `node_modules` "already existing" wasn't enough). Clean after the reinstall,
both `tsconfig.node.json` and `tsconfig.web.json` programs. **Not run live** — no Gemini or Yapper
credential is configured in this sandbox, and live generation spend is out of scope for the
autonomous routine either way; both new fields route through `startFramePath` and `modelHint`,
fields already exercised (and left unverified live) by the Motion graphics and Deepfake passes, so
this doesn't introduce a new unverified code path, just two new UI entry points into existing ones.

**Docs updated in this commit:** `docs/ui/creative-nodes.md` (Generate video's table row),
`docs/architecture/capability-map.md` (the node→capability table's Generate video row, plus notes
in both "known unwired paths" bullets this closes), `docs/ui/node-enrichment-strategy.md` (row 3's
status), `docs/reports/node-enrichment-progress.md` (row 3 → done, session log).

**Left for later:** muapi/fal i2v, still blocked on the cross-cutting `asset-upload` helper (blocks
rows 1, 3, 7 per the progress file) — deliberately out of scope for this pass, which was "surface
what already works," not "build new upload plumbing." Row 3 has no other named items; next run
should move to row 4 (Generate image) unless another run gets there first.

---

## 2026-08-09 — Fifth autonomous run: Motion graphics (row 2), two wrapper capabilities surfaced

Row 1 (Deepfake) has nothing left that's safely buildable blind — its sole resume item is live
verification of the muapi/Yapper chains, which needs real credentials and is explicitly
joint-session scope. Per the prior run's own note ("Next run should pick up row 2 with a clean
slate"), moved to row 2: Motion graphics. Confirmed no concurrent run had touched it first
(`git fetch` showed the branch unchanged since the last push).

**What I found on inspection:** less missing than the strategy doc's queue entry implied for two
of its three items. `resources/gemini-mcp.cjs` — the thin stdio wrapper around Gemini's REST
API — already had both underlying capabilities the queue asked for, shipped in an earlier pass
(`4f93dc3`, "Connector reality check: fix everything the research disproved", predates this
enrichment routine entirely): `MAX_REFERENCE_IMAGES = 10` on `gemini_generate_image` (Nano
Banana 2 genuinely accepts up to 10 object refs, the old "3" guidance was from the 2.5-era
model), and a `model` parameter on `gemini_generate_video` accepting the three Veo 3.1 variants
(`veo-3.1-generate-preview` / `-fast-` / `-lite-`, the last ~8× cheaper at 720p). Neither was
reachable from the UI. `MotionGraphicsWizard.tsx`'s References stage capped picks at 5
(`ids.length < 5`, unrelated to either wrapper's actual limit), and nothing in the Animate stage
ever set `GenerationParams.modelHint`, so the agent always got the wrapper's implicit default
(full-quality Veo) with no way for the user to ask for a cheaper iteration pass.

**What I built:** raised the References picker's cap to a named constant,
`MAX_REF_IMAGES = 10`, matching Gemini's harder limit (checked OpenAI's wrapper too —
`openai-image-mcp.cjs` takes reference images uncapped, docs cite ~16, so 10 is the binding
limit either way, not an arbitrary new number). Added a quality-tier `<select>` to the Animate
stage — default veo-3.1 / fast / lite — that's only shown when Gemini is the connected image
tool (Animate already restricts `connectorId` to Gemini in that case, so the picker would be
inert otherwise). Selecting a tier sets `modelHint` to the *literal* Veo model id rather than a
human label: `generation.ts`'s `buildPrompt` turns `modelHint` into a prompt line ("Model
preference: use a `<hint>` model if the connected tools offer one"), and the wrapper's own tool
schema documents that literal id in its `model` enum, so the agent gets an unambiguous string to
copy through instead of a label it has to map itself. `generateMedia`/`GenerationParams`/
`bridge.generate.run` already threaded `modelHint` end-to-end from an earlier phase — no new
plumbing needed there, just a caller that finally sets it for this node.

**What I did not build:** the strategy doc's third Motion graphics item, "consider muapi's
image-edit tool as an alternative batch source." That's a genuinely different generation path —
a new batch source with its own params and UI, not a parameter wire-up like the two items above
— and rushing it in the same pass as two smaller, well-understood fixes felt like the wrong
trade. Left as row 2's resume note for a future pass to design properly.

**Verified:** fresh `npm install` (this sandbox had no `node_modules` again — 168 packages,
clean), then `npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`): clean, zero
errors. Same ceiling as every prior pass: no display, no Electron runtime, no Gemini API key in
this sandbox, so this verifies types and the prompt-construction logic, not that the agent
actually picks the right Veo variant when it's live. That's a joint-session check, same as row
1's outstanding item.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): `creative-nodes.md`'s
Motion graphics wizard section (both the stale "≤5, wrapper caps at 3" reference-cap claim and
the new tier picker), `capability-map.md`'s Motion gfx animate row and its §4 muapi-frame-
conditioning note, and the strategy doc's row 2 entry with a status block matching the Deepfake
section's established format.

---

## 2026-08-09 — Fourth autonomous run: collided with a concurrent run on row 1, no new code

Picked up row 1's remaining resume item (a) — the Yapper REST signed-upload path — independently
and built essentially the same fix: a `secondaryCredential` concept on `ConnectorDef` (mine) /
a synthetic vault id (`yapper-rest`, the run just below this entry) to hold the separate
`yap_live_…` key, a REST client module doing the presigned-upload dance, a Settings row to set
the key, and `generation.ts` pre-uploading local source media through it when Yapper is the only
attached connector. By the time I finished and went to push, another run had already landed and
pushed the equivalent work first (`9566779`, the entry directly below).

Rather than force a rebase through eight files of near-identical diffs (`generation.ts`,
`capability-map.md`, `creative-nodes.md`, the progress tracker, and this report all overlapped),
I reset my branch to the pushed commit, confirmed `npm run typecheck` is still clean against it,
and stopped — the guardrails are explicit that repeating completed work isn't the goal, and a
git-history archaeology exercise to cherry-pick any genuinely-different bits (mine modeled the
second credential as a first-class `ConnectorDef` field rather than a synthetic vault id; possibly
worth a look in daylight, not autonomously) isn't worth the collision risk this deep into the run.

Did not start row 2 this run — between building the (ultimately discarded) fix and reconciling
against the concurrent push, the run's time budget was already spent, and starting fresh row-2
work now would run into the same overlap risk that just cost this run its output. Next run should
pick up row 2 (Motion graphics) with a clean slate.

---

## 2026-08-09 — Third autonomous run: Deepfake (row 1), Yapper REST upload path built

Resumed row 1 again — resume note left two items, (a) build the Yapper REST signed-upload path
and (b) live-verify the muapi upload→lipsync chain. (b) needs real credentials and is explicitly
joint-session scope; (a) was buildable blind, so that's what this pass did.

**The gap:** the Deepfake screen's Stage 2 already restricts the agent to exactly the connected
`yapper`/`muapi` pair and prefers muapi's own upload tool when both are present. But when *only*
Yapper is connected, there was no answer — Yapper's hosted MCP connector has no upload tool of its
own (confirmed in `docs/connectors/reference/yapper.md`: `yapper_upload_asset` "only exists on an
elusive local stdio server", not the hosted one this app installs), so the agent had nothing to
call for a local source video or audio file. The only documented way in is the REST signed-upload
flow, gated behind a *second* credential Yapper itself keeps separate from the OAuth MCP login — a
`yap_live_…` Bearer key, mintable at yapper.so/account/developer. Lyme Hype's connector model
(`ConnectorDef`) had nowhere to put that: it's built entirely around "one connector = one MCP
server", and this REST endpoint isn't an MCP server at all, so wrapping it in a fake `ConnectorDef`
would make Settings' "Test" button try to MCP-handshake a plain REST base URL and fail.

**What I built instead:** the generic secret vault (`credential-vault.ts` + `secure-credential.ts`)
turns out to already be decoupled from `ConnectorDef` — `storeSecret`/`readSecretValue` take a bare
string id, and the existing `secret:request`/`secret:list` IPC channels (already wired end-to-end
to `bridge.secrets.*`) work for any id, not just real connectors. So the REST key rides that
mechanism directly under a synthetic id (`yapper-rest`) rather than forcing a shape it doesn't fit.
New `src/main/yapper-rest.ts`: `hasYapperRestKey()` and `uploadLocalMediaToYapper(path)`, the
latter implementing the documented three-step flow — `POST /assets/uploads` (mimeType + size) →
PUT the raw bytes to the returned `uploadUrl` → `POST` the returned `completeUrl` → back comes an
Asset with an `assetId`. `generation.ts` calls it automatically: when `yapper` is attached and
`muapi` is not, and the request carries a local `sourceMediaPath` (video) or a single
`referenceAudioPaths` entry, it pre-uploads before the agent turn even starts and appends a line to
the prompt telling the agent the asset id is already known — "pass it directly as
sourceVideoAssetId/audioAssetId, don't try to upload this yourself" — closing the exact hole the
strategy doc flagged. `ConnectorsTab.tsx` gained a small row under the Yapper card ("REST upload
key — separate from the account above…") reusing the same `bridge.secrets.request` call every
other credential field already uses, so there's no new UI pattern, just the existing one pointed at
a second id.

**What I did *not* build:** a general-purpose `asset-upload` helper spanning muapi/fal/Yapper for
every node (i2v, Combine, etc.) — that's still open and explicitly out of this pass's scope; this
is the Deepfake-specific slice the resume note asked for, not the cross-cutting plumbing item.

**Honesty about the one soft spot:** `POST /assets/uploads`'s exact request-body field names
(`mimeType`, `sizeBytes`) and `completeUrl`'s exact response shape are my best-effort read of the
reference doc's summary of a live OpenAPI enumeration, not something I hand-verified against an
actual response body — I don't have a key to do that with in this sandbox. If the field names are
slightly off, this is a one-file, low-risk fix once real verification happens; flagging it now
rather than presenting it as more tested than it is.

**Verified:** fresh `npm install` (this sandbox had no `node_modules` this run — 168 packages,
clean), then `npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`): clean, zero errors.
Same ceiling as every prior pass — no display, no Electron runtime, no API keys — so this confirms
types and conventions, not that the real HTTP calls succeed.

**Docs updated in this commit** (doc-drift-is-a-bug, `AGENTS.md` §1.3): `capability-map.md` §4's
Deepfake bullet and the `asset-upload` bullet, `creative-nodes.md`'s Deepfake Stage 3 description,
and the strategy doc's Deepfake status block, all now describe the REST fallback instead of just
"Yapper is the fallback path when connected" (true but no longer the whole story).

**Left in-progress, but narrowly** — row 1's resume note is now down to a single item: (b) live
verification of the whole chain (muapi upload→lipsync, and this new Yapper REST fallback), which
needs real credentials and is a joint-session item by design, not something this routine should
attempt blind. Everything else scoped in the flagship build order is now either shipped or
correctly deferred.

---

## 2026-08-09 — Second autonomous run: Deepfake (row 1), one resume item closed, still in-progress

Per the routine's resume-in-place instruction, picked back up row 1 rather than moving to row 2 —
the previous run's resume note left three specific open items, and I worked item (c): "voice_clone
isn't wired into the Reference person flow."

**What I found on inspection:** less missing than the note implied. `cloneVoice` already existed
end-to-end in `elevenlabs-tools.ts`, already had a full IPC/preload/bridge path (`audio:clone`),
and already had a real Create panel screen (Generate audio › **Clone** job: name a voice, pick
sample files, fire `voice_clone`). What was actually missing was narrower and more useful to fix:
that screen and the Reference person concept (Settings › Trained styles' `voiceName` field, built
in the previous run) were two disconnected islands. Cloning a voice got you a name typed into a
confirmation toast; pairing it with a trained identity meant remembering that name, navigating to
Settings, and typing it into a different text field by hand.

**Built:** `AudioScreen`'s clone job (`AsidePanel.tsx`) gained an optional "attach to Reference
person" `<select>`, populated from the same `styles` list `AsidePanel` already fetches once and
threads into `ImageScreen`/`DeepfakeScreen`. On a successful clone with a style selected, it calls
`bridge.lora.setVoice(styleId, cloneName)` directly — no need to parse the clone confirmation text
for a voice id, since the name the caller already has in state *is* the value `TrainedStyle.
voiceName`/`text_to_speech`'s `voice_name` param wants — and lifts the updated `TrainedStyle` back
up through a new `onStyleUpdated` prop so later navigation to the Deepfake screen sees the pairing
immediately. This closes the loop the strategy doc's flagship section calls "Identity + Voice":
clone → attach is now one action instead of two screens and a manual copy/paste.

I did **not** touch anything about live invocation: the underlying `voice_clone` call the button
fires was already there before this change and was already something only the human user triggers
by pressing it — this run only changed what happens *after* a successful call returns, which is
plumbing, not spend.

**Researched:** re-read the ElevenLabs reference doc's `voice_clone` row (confirms: name+files in,
confirmation text with a new voice id out, no file) to confirm the "no parsing needed" call was
correct, and re-read `TrainedStylesTab.tsx`/`fal-training.ts`'s existing `setVoice` path to reuse
it rather than add a second write path for the same field.

**Verified:** `npm install` (168 packages, clean, same as last run — sandbox resets each session),
then `npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`): clean, zero errors. Same
ceiling as last time — no display, no Electron runtime, no API keys in this sandbox — so this is a
type-check-and-convention-match verification, not a "clicked the button and it worked" one.

**Left in-progress** — resume items (a) Yapper REST signed-upload credential and (b) live
verification of the muapi upload→lipsync chain are unchanged and still the right things for the
next run to pick up; both are real scope that needs either a new credential model or an actual
API key, neither of which belongs in an unattended overnight pass. Row 1's resume note has been
trimmed to just those two.

---

## 2026-08-09 — First autonomous run: Deepfake (row 1), left in-progress

Worked the top of the queue — Deepfake, the flagship node the strategy doc already had a build
order for. Implemented it rather than re-deriving it, per the routine's instructions.

**Researched first:** re-read the strategy doc's flagship section, `docs/connectors/reference/`
for ElevenLabs, Yapper, and muapi (exact tool names/params — `text_to_speech`'s `voice_name` vs
`voice_id`, muapi's `muapi_edit_lipsync`/`muapi_enhance_face_swap`/`muapi_upload_file`, Yapper's
`video-lipsync` process shape and the fact its hosted MCP connector cannot read local files at
all). That last fact changed the plan: the strategy doc's step 3 called for a standalone
`asset-upload` helper Lyme Hype would own per connector. Building Yapper's half of that needs a
second, non-OAuth `yap_live_…` REST credential that `ConnectorDef` doesn't model yet — real scope,
but a credential-storage change I didn't want to rush blind, unverified, at 2am. muapi, by
contrast, already ships its own `muapi_upload_file` tool that the agent can call directly (stdio,
already attached) — so I pivoted: instead of Lyme Hype owning the upload, let the agent chain
tools it already has, and give it the two missing ingredients (which connectors to restrict to,
and the local file paths) to do it correctly.

**Built:**
- `TrainedStyle.voiceName` (`shared/types.ts`) — the "Reference person" concept: an ElevenLabs
  voice paired with a trained LoRA identity. `setTrainedStyleVoice()` (`fal-training.ts`) +
  `lora:set-voice` IPC + a `bridge.lora.setVoice` call; Settings › Trained styles now shows an
  inline voice-name field per card (`TrainedStylesTab.tsx`, using the `Button`/`StatusChip`
  components per the house convention, not hand-picked classes).
- `GenerationParams` gained three fields, all resolved main-side the same way
  `referenceImagePaths` already is (`lyme-asset://` → absolute path): `connectorIds` (restrict
  the agent's MCP toolset to an exact SET of connectors, not just one — `buildMcpServers` in
  `generation.ts` now takes `restrictIds: string[]`), `referenceAudioPaths`, and
  `sourceMediaPath`. `connectorIds` is generically useful beyond Deepfake — it's the mechanism
  row 7 (Combine) will need for any two-connector chain.
- Rewrote `DeepfakeScreen` (`AsidePanel.tsx`) as an explicit two-stage flow instead of one opaque
  call, matching the Motion graphics wizard's "each stage is its own visible node" pattern: pick
  a Reference person + write the script → **Stage 1** calls ElevenLabs `text_to_speech` directly
  (no agent turn, same plumbing as the existing Voice job) and drops an audio node on the canvas
  → **Stage 2** picks a source video/photo canvas node and fires an agent call restricted to
  exactly the connected `yapper`/`muapi` pair, with the resolved speech-audio path and
  source-media path handed in. The prompt tells the agent to prefer muapi's self-contained chain
  (`muapi_upload_file` → `muapi_edit_lipsync`, or `muapi_enhance_face_swap` when only a still
  photo exists) since it needs no extra credentials, and falls back to Yapper's `video-lipsync`
  process (import-by-URL only) when muapi isn't connected. Updated `TILE_NEEDS.deepfake` to
  `yapper`/`muapi` (either satisfies readiness) since face-swap-only routes don't need Yapper at
  all.
- Docs updated in the same pass: `creative-nodes.md` (new Deepfake stage table + a Reference
  person section), `capability-map.md` (Deepfake's node→capability row split into speech/face,
  the muapi lipsync/face-swap unwired-path note marked wired), the strategy doc's flagship
  section (a "Status" block recording exactly what shipped vs. what was a deliberate pivot from
  the original spec).

**Verified:** `node_modules` was missing in this sandbox — ran `npm install` (168 packages, clean)
— then `npm run typecheck` (both `tsconfig.node.json` and `tsconfig.web.json`): clean, zero
errors, after fixing one gap the store's `generateMedia` input type didn't mirror the three new
`GenerationParams` fields. That's the only check available here: no display, no Electron runtime,
and — correctly, per the standing rule — no API keys configured, so the actual muapi
upload→lipsync tool chain has never been fired. I cannot claim it works end-to-end, only that it
type-checks and follows the existing wrapper/prompt conventions.

**Left in-progress, not done** — the row 1 resume note is specific: (a) Yapper's REST
signed-upload path (needs the `yap_live_…` credential — real scope, deliberately deferred rather
than rushed); (b) live-verify the muapi chain once real keys exist; (c) voice_clone isn't wired
into the Reference person flow — you can attach an *existing* ElevenLabs voice by name, but not
clone a fresh one from the LoRA's own training photos/a voice sample in one step. Next run should
pick this up rather than moving to row 2, per the routine's resume-in-place instruction.

---

## 2026-08-09 — Session setup

Set up by the main (local) Claude Code session, not yet a routine run. Wrote the strategy doc,
the progress queue, and this report; configured a recurring cloud routine (hourly, ~11:30pm–8am
America/Los_Angeles) to work the queue unattended overnight. Each run pushes to
`overnight/node-enrichment`, not `main` — nothing here has been merged yet. Review the branch's
commits and this report together, then merge what looks good.

Flagship analysis already done by hand (see the strategy doc): the Deepfake node currently makes
one opaque Yapper call and touches neither LoRA (identity) nor ElevenLabs (voice) despite both
already being wired into the app for other tiles. That's queue item #1.
