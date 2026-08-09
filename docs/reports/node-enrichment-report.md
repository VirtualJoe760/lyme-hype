# Node enrichment — nightly report

Human-readable log, newest entry first. Each autonomous run appends one entry here regardless
of whether it shipped code. Read this in the morning; the machine-readable queue is
[`node-enrichment-progress.md`](node-enrichment-progress.md), the per-node analysis is
[`../ui/node-enrichment-strategy.md`](../ui/node-enrichment-strategy.md).

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
