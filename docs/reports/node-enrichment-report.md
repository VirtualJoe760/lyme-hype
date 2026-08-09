# Node enrichment — nightly report

Human-readable log, newest entry first. Each autonomous run appends one entry here regardless
of whether it shipped code. Read this in the morning; the machine-readable queue is
[`node-enrichment-progress.md`](node-enrichment-progress.md), the per-node analysis is
[`../ui/node-enrichment-strategy.md`](../ui/node-enrichment-strategy.md).

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
