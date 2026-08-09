# Node enrichment — progress tracker

Machine-consumed queue for the nightly enrichment routine. Each cloud run: read this file, take
the first `pending` node, do real work on it (research + cross-reference + implement safe
wiring), then either mark it `done` (with a one-line summary) or leave it `in-progress` (with a
`resume:` note describing exactly what's left) if it didn't finish in one run. Always append the
human-readable account to `node-enrichment-report.md` regardless of status. Commit and push to
the `overnight/node-enrichment` branch, not `main` — the user merges in the morning after review.

Full per-node analysis lives in [`../ui/node-enrichment-strategy.md`](../ui/node-enrichment-strategy.md).

| # | Node | Status | Notes |
|---|---|---|---|
| 1 | Deepfake | in-progress | Reference person (TrainedStyle.voiceName) + staged Speech→Face UI shipped; Stage 2 chains muapi's own upload tool into edit_lipsync/face_swap via new `GenerationParams.connectorIds`/`referenceAudioPaths`/`sourceMediaPath` instead of a standalone asset-upload helper. Clone-and-attach (former resume item c) shipped: the Create panel's Clone-voice job can attach its result to a Reference person in one step. Yapper REST signed-upload (former resume item a) shipped: `src/main/yapper-rest.ts` + a synthetic-id credential (`yapper-rest`, riding the existing generic secret vault) + a Settings › Connectors row to set it; `generation.ts` pre-uploads local source media to Yapper and hands the agent asset ids directly when Yapper is the only attached connector. resume: (b) is the only item left — live-verify the whole chain (muapi upload→lipsync, and the new Yapper REST fallback) once real keys exist; needs a joint session, nothing further is safely buildable blind. |
| 2 | Motion graphics | in-progress | Reference-image picker cap raised 5→10 (matches Gemini's real limit; wrapper already supported it) and Animate-stage Veo quality-tier picker (default/fast/lite via `modelHint`) shipped. resume: muapi image-edit as a second batch source is the only item left — a genuinely different generation path (not a parameter wire-up), needs its own design pass before implementing. |
| 3 | Generate video | done | i2v starting-frame picker (routes to gemini via `startFramePath`) + Yapper model picker (`modelHint` + `connectorId: 'yapper'`) shipped in `VideoScreen`; both named items closed. |
| 4 | Generate image | done | Fixed a real bug (picked style always forced `connectorId: 'fal'`, ignoring `style.connectorId`); resurrected `krea-training.ts` (git-history revival) as a second, opt-in "Krea 2 direct" trainer producing `connectorId: 'krea'` styles, applied via `styles:[{id,strength}]` and honoring the tier toggle (K2 medium/large) — the first genuine production-tier LoRA path. Both named items closed in one fix. |
| 5 | Generate audio | done | Yapper free-tier TTS fallback (Voice job) shipped first pass; Suno-via-muapi music fallback (agent-routed `generateMedia`/`ResultRow`, `connectorId: 'muapi'`, `modelHint: 'suno'`, instrumental-only toggle) shipped second pass. Both named items closed. |
| 6 | Create a LoRA | done | "Train from this deepfake's reference photos" shortcut shipped: Deepfake's face-node picker gains a "Train a LoRA from this photo" button when the picked node is a still image, prefilling the Create a LoRA screen's first training image + name + kind (subject). Also fixed a real plumbing gap this depended on: `lora:train`'s IPC handler never resolved `lyme-asset://` canvas-node URLs to disk paths (only `scriptingTurn` had that resolution before), so passing a canvas image straight through would have failed `readFileSync` in both trainers. |
| 7 | Combine (canvas) | done | image+image (ref-conditioning mix) and audio+image (lipsync-if-face, else animate+score) now call real `generateMedia` with a new prompt textarea in the dialog; the other four pairs (video+video, image+video, audio+video, audio+audio) stay the placeholder stub — real ffmpeg compositing for those belongs with row 9. |
| 8 | Storyboard / Scripting | done | Reference person gained an optional `personaTone` tag (Settings › Trained styles); a script-born Storyboard panel gets a "☺ Send to Deepfake" button that prefills the script and auto-suggests a Reference person by matching the panel's `feeling` against `personaTone` (word overlap, no agent call). |
| 9 | Timeline / export | done | Built the local ffmpeg compositing row 7 explicitly deferred here: Combine's four remaining pairs (video+video stitch, image+video overlay, audio+video score, audio+audio mix) now produce real output via a new `combineLocal()`/`media:combine-local` IPC round trip instead of the Phase 2 placeholder node. |
| 10 | Listing photos (ChatRealty) | in-progress | Cover render shipped: `create_listing_cover` wired into the Listing photos tile (hook/body form on the top-matched listing, Cloudinary URL downloaded via `importUrlAsset`, real image node). CMA-context shipped: `planListingCarousel()` (`chatrealty:listing-context` IPC) feeds `plan_listing_carousel`'s real listing facts/CMA stats into the Scripting panel's first agent turn whenever a ChatRealty-sourced node is in the session, once per conversation. resume: strategy doc's build order has 2 items left — (3) carousel slide builder (`create_carousel_slide`, 4 kinds each with its own required-field shape — real staged-screen UI, closer to the Motion graphics wizard's pattern than a single call), (4) `stage_listing_with_agent` interior-photo picker (real generation spend, ~$0.04/photo — build the picker, never fire it). Either is independently shippable; no ordering dependency between them. |

## Cross-cutting plumbing (build once, benefits multiple rows)

- [ ] `asset-upload` helper — local file/asset → provider-hosted URL, shared by muapi/fal/Yapper. Blocks rows 1, 3, 7.
- [ ] "Reference person" concept — extends `TrainedStyle` with an optional `voiceId`. Blocks rows 1, 6.

## Session log (routine writes one line per run here, newest first)

- 2026-08-09 (eighteenth autonomous run) — row 10, step 2 of the strategy doc's build order:
  `plan_listing_carousel`'s real facts/CMA material now feeds the Scripting panel's agent context
  (`planListingCarousel()` + `chatrealty:listing-context` IPC, fetched once on a conversation's
  first turn when a ChatRealty-sourced node is in the session, folded into the prompt not the
  displayed message). `npm run typecheck` clean (fresh `npm install`, no `node_modules` at run
  start). Not run live — no ChatRealty token in this sandbox. `creative-nodes.md` and
  `capability-map.md` updated in the same commit. Row 10 left in-progress: steps 3 (carousel slide
  builder) and 4 (agent-in-photo staging picker) remain, see this row's resume note.
- 2026-08-09 (seventeenth autonomous run) — queue was fully `done` through row 9 (confirmed via
  the sixteenth run's collision-review entry below), so this run took row 10 (Listing photos /
  ChatRealty), the last row and the only one that never got a flagship-style analysis — its seed
  note was a single line. Wrote the full analysis in `node-enrichment-strategy.md` (what the user's
  after, the four-tool creative-rendering chain, a four-step build order) and shipped step 1: a
  "Create Instagram cover" mini-form on the Listing photos tile, appearing after a successful pull
  for the top-matched listing. New `createListingCover()` in `chatrealty.ts` (one deterministic
  `create_listing_cover` MCP call, matching `pullListingPhotos()`'s own no-agent-turn pattern),
  Cloudinary URL extracted and downloaded via the existing `importUrlAsset()` path, landing as a
  real image node. Full plumbing: `ChatRealtyCoverResult` shared type, `chatrealty:create-cover` IPC
  channel, preload + bridge (both the real and browser-preview-mock sides), `createChatRealtyCover`
  store action, and `pullChatRealtyPhotos` extended to hand back the top-matched listing's key/
  address/city so the form has something to render against. `npm run typecheck` clean (fresh `npm
  install`, no `node_modules` at run start). **Not run live** — no ChatRealty token in this sandbox,
  and even with one, autonomously firing the call would violate the live-billed-call guardrail
  regardless of how cheap the templated render actually is; the button exists, nothing fires
  without a human click. `creative-nodes.md` and `capability-map.md` updated in the same commit.
  Left in-progress: three more items in the strategy doc's build order (Scripting-panel CMA context,
  carousel slide builder, agent-in-photo staging picker) — see this row's resume note.
- 2026-08-09 (sixteenth autonomous run) — collided with the fifteenth run on row 9, independently;
  built a different, also-typechecked-clean implementation (reused the Cut Room export's own
  multitrack compositor via a synthetic timeline spec, vs. their four purpose-built filter graphs),
  reviewed their already-pushed fix, found their per-clip `hasAudio` probing on stitch/score more
  careful than my reliance on the general compositor's own audio-inclusion logic and their real
  `concat` filter more legible than my overlay-gating trick for the same sequential-playback effect,
  reset to their commit rather than fight a six-file conflict between two structurally different
  filter-graph designs, re-verified `npm run typecheck` clean on their tip myself. No code changes;
  see the report for the full account, including one shipped-behavior difference flagged for a
  human glance (audio+video's mute handling). Row 9 stays `done` from the fifteenth run. Next: row
  10 (Listing photos / ChatRealty).
- 2026-08-09 (fifteenth autonomous run) — Row 9 (Timeline / export) closed: built the local ffmpeg
  compositing row 7 explicitly scoped out ("belongs with row 9"). Four new pure args builders in
  `media-tools.ts` (stitch/overlay/score/mix), one `combineLocal()` dispatcher, one IPC channel
  (`media:combine-local`), and `store.ts`'s `confirmCombine` gained `localCombineFor` to route the
  four non-generative Combine pairs through it with the same rendering-node-then-patch lifecycle
  `generateMedia` already uses (not the old fake-timer stub). `CombineDialog.tsx`'s "Stub for now"
  text and its generative-only ready-state guard are both gone — every pair now requires both
  dragged nodes ready with a real `src`. `npm run typecheck` clean (fresh `npm install
  --include=dev`, no `node_modules` at run start). Not run against real media in this sandbox (no
  display), but unlike prior rows this has zero live-key/billed-spend risk to caveat — it's local
  ffmpeg only, same risk category as the already-verified `buildMultitrackArgs`. Queue is now fully
  `done` except row 10 (Listing photos / ChatRealty).
- 2026-08-09 (fourteenth autonomous run) — Row 8 (Storyboard / Scripting) closed: `TrainedStyle`
  gained `personaTone` (`lora:set-tone` IPC, `ToneField` in `TrainedStylesTab.tsx`, same shape as
  the existing `voiceName`/`VoiceField` pair). Storyboard panels born from a script breakdown
  (have `shotDescription`) gained a "☺" action beside ✨ that stores `{script, toneHint}` on a new
  `deepfakeHandoff` store field; the Create panel's aside watches it, switches to the Deepfake
  screen, prefills the script from `shotDescription`, and auto-selects the Reference person whose
  `personaTone` shares the most words with the panel's `feeling` (`suggestReferencePerson` in
  `AsidePanel.tsx` — plain string matching, no agent call, no live spend either way). No match
  (or no tagged Reference people yet) leaves the picker on "none" with an honest status line
  rather than guessing. `npm run typecheck` clean (fresh `npm install` in this sandbox — no
  `node_modules` present at run start). Not exercised in a running browser (no display in this
  sandbox) — the mechanism reuses `store.ts`'s established prefill/state-lift pattern
  (`loraPrefill`/`onTrainFromFace` from row 6) closely enough that this is lower-risk than most
  rows, but it's still worth a human glance in the app before trusting it blind. `creative-nodes.md`
  and `capability-map.md` updated in this commit. Queue is now fully `done` except rows 9–10.
- 2026-08-09 (thirteenth autonomous run) — Row 7 (Combine) closed: `CombineDialog` gained a
  prompt textarea and `confirmCombine` now dispatches image+image (`referenceImagePaths`) and
  audio+image (`sourceMediaPath` + `referenceAudioPaths`, lipsync-if-face else animate+score,
  agent-judged via prompt text) through real `generateMedia` calls instead of the Phase 2 stub
  timer — no new main-process plumbing needed, both fields already existed and were already
  `lyme-asset://`-resolved from rows 1 and 2. The other four combine pairs intentionally keep the
  placeholder node (ffmpeg compositing, row 9's territory). `npm run typecheck` clean. Next:
  row 8 (Storyboard / Scripting).
- 2026-08-09 (twelfth autonomous run) — collided with the eleventh run on row 6, independently;
  found the identical `lora:train`/`lyme-asset://` bug but built a broader canvas-image-picker
  feature where they built the more literally-named "train from this photo" shortcut on the
  Deepfake screen itself, reviewed their already-pushed fix, found their reading more faithful to
  the row's wording and the fix itself sound, reset to their commit rather than fight the merge
  (six-file rebase conflict), re-verified `npm run typecheck` clean on their tip myself. No code
  changes; see the report for the full writeup. Row 6 stays `done` from the eleventh run. Next:
  row 7 (Combine).
- 2026-08-09 (eleventh autonomous run) — Row 6 (Create a LoRA) closed: the Deepfake screen's
  face-node picker now shows a "◈ Train a LoRA from this photo" button whenever the picked node
  is a still image, jumping to the Create a LoRA screen with that image pre-loaded as the first
  training file (name defaults to the Reference person's name, kind defaults to "Subject /
  character"); the file picker there now adds to the prefilled image instead of replacing it.
  Found and fixed the real blocker this depended on along the way: `ipc.ts`'s `lora:train` handler
  passed `imagePaths` straight to `trainStyle()`, which `readFileSync`s each path directly — fine
  for the native file-picker's real disk paths, but a canvas node's `src` is a `lyme-asset://` URL,
  and nothing resolved it (unlike `scriptingTurn`'s vision-input handler two cases above it in the
  same file, which already had this exact resolution for the Motion graphics wizard's reference
  images). Added the same `assetPathForUrl` resolution to `lora:train`. `npm run typecheck` clean
  (fresh `npm install` in this sandbox). Not run live — no fal/Krea key configured, and this
  change doesn't touch a live call path anyway (it's client-side prefill + a server-side path
  resolution fix). `creative-nodes.md` updated in the same commit. Row 6 fully done. Next run:
  row 7 (Combine).
- 2026-08-09 (tenth autonomous run) — Row 5 (Generate audio) closed: built the Suno-via-muapi
  music fallback the ninth run left open. `AudioScreen`'s Music job now routes through
  `generateMedia` (agent path, `connectorId: 'muapi'`, `modelHint: 'suno'`) and renders via
  `ResultRow` when ElevenLabs isn't connected and muapi is, plus a small instrumental-only toggle
  riding along on the same change. `npm run typecheck` clean; not run live (no muapi key in this
  sandbox). Row 5 now fully `done`. Next run: row 6 (Create a LoRA).
- 2026-08-09 (ninth autonomous run) — Row 4 confirmed done from the eighth run's reconciliation, no
  repeat needed. Moved to row 5 (Generate audio): built the Yapper free-tier TTS fallback
  (`synthesizeYapperSpeech()` in `yapper-rest.ts`, direct `POST /audio/speech` call, no agent turn)
  and wired it into the Voice job — auto-routes there when ElevenLabs isn't connected and the
  `yapper-rest` REST key from the Deepfake pass is already set. Left in-progress: Suno-via-muapi as
  a music alternative is real scope for a future pass (agent-driven MCP tool, not a REST call like
  the TTS fix). `npm run typecheck` clean; not run live (no Yapper key in this sandbox).
- 2026-08-09 (eighth autonomous run) — collided with the seventh run on row 4, independently;
  read the Krea-direct dead end differently (out-of-scope revival vs. their opt-in-trainer
  reading of the removal commit's own wording), reviewed their already-pushed fix, found their
  reading defensible, reset to their commit rather than fight the merge, and re-verified
  `npm run typecheck` clean myself. No code changes; see the report for the full judgment-call
  writeup, flagged for a human glance. Row 4 stays `done` from the seventh run. Next: row 5.
- 2026-08-09 (seventh autonomous run) — Rows 1–3 confirmed to have nothing left buildable blind
  (unchanged from prior runs' notes), so moved to row 4, Generate image. Found and fixed a real
  bug along the way: a picked trained style always forced `connectorId: 'fal'`, silently ignoring
  `TrainedStyle.connectorId` (a field that's existed for exactly this dispatch since before fal
  became the default trainer). Resurrected `src/main/krea-training.ts` from git history
  (`4f93dc3`, removed at `4e96389`) as a second, opt-in "Krea 2 direct" trainer alongside fal's
  two — `POST /styles/train`, asset upload, job polling, all reusing the existing `lora:train` IPC
  channel via a one-line dispatch in `fal-training.ts`'s `trainStyle()`. Both of row 4's named
  items (production-tier LoRA, Krea-direct styles route) closed by the same fix: a Krea-trained
  style now routes through `connectorId: 'krea'` with a `styles:[{id,strength}]` hint, and the
  tier toggle picks K2 medium vs. K2 large — the first LoRA path that's actually tier-sensitive,
  since fal's weights-URL route always uses the same weights regardless of tier. Row 4 marked
  done. `catalog.md`'s Krea section and `capability-map.md` updated to match (both had drifted —
  `catalog.md` still described `krea-training.ts` as removed/anticipated-but-unbuilt).
- 2026-08-09 (sixth autonomous run) — Rows 1 and 2 have nothing left to build blind this pass (row
  1 is live-verification-only; row 2's remaining item is a genuinely new generation path, not a
  wire-up), so moved to row 3 (Generate video) per the strategy doc's priority order. Shipped both
  named items: a starting-frame picker on the canvas (i2v via Gemini, reusing `startFramePath`
  from the Motion graphics wizard) and a Yapper model picker (~20 models, `modelHint` +
  `connectorId: 'yapper'`, same literal-id pattern as row 2's Veo tier picker). Row 3 marked done.
- 2026-08-09 (fifth autonomous run) — Row 1 (Deepfake) has nothing left to build blind (only
  live verification remains, joint-session scope), so moved to row 2 (Motion graphics) with a
  clean slate as the prior run's report suggested. Raised the References stage's picker cap
  5→10 and added an Animate-stage Veo quality-tier picker — both surfaced existing wrapper
  capability that the UI never exposed. Left in-progress: muapi image-edit as a second batch
  source is real scope for a future pass.
- 2026-08-09 (fourth autonomous run) — collided with a concurrent run on row 1's last buildable
  item, no new code shipped; see the report for the full account.
- 2026-08-09 (third autonomous run) — Deepfake: built the Yapper REST signed-upload path
  (`yapper-rest.ts`, a synthetic-id vault credential, a Settings row, and `generation.ts` wiring
  so the Yapper-only fallback can actually ingest local source media). Row 1's only remaining
  resume item is live verification, which needs a joint session — everything safely buildable
  blind is now done.
- 2026-08-09 (second autonomous run) — Deepfake: wired `voice_clone` into the Reference person
  flow (former resume item c). Create panel's Clone-voice job can now attach a freshly-cloned
  voice to a `TrainedStyle` in one action instead of a manual copy/paste round-trip through
  Settings. Left in-progress — see row 1's resume note (Yapper REST upload credential + live
  verification still open, both real scope needing a joint session).
- 2026-08-09 (first autonomous run) — Deepfake: Reference person concept + staged Speech/Face UI
  + `connectorIds`/`referenceAudioPaths`/`sourceMediaPath` plumbing. Left in-progress — see row 1's
  resume note (Yapper REST upload credential + live verification still open).
- 2026-08-09 06:2x UTC — seeded by main session ahead of the first autonomous run.
