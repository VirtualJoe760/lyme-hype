# Node enrichment strategy

**Living document.** Where [`creative-nodes.md`](creative-nodes.md) says what each node does and
[`../architecture/capability-map.md`](../architecture/capability-map.md) says what each connector
can do, this doc says **how to chain those capabilities so each node is as good as it can
possibly be** — not "one connector satisfies one node," but "which connectors compose, in what
order, to make this node excellent." Seeded 2026-08-09; expanded automatically by the nightly
enrichment routine (see `../reports/node-enrichment-progress.md` for the queue and
`../reports/node-enrichment-report.md` for the run-by-run log).

## Method, per node

For every node: (1) what is the user actually trying to accomplish — the *feeling*, not the
mechanism; (2) which capabilities from the matrix currently serve it and how thinly; (3) what a
**chain** of 2+ connectors produces that no single connector can; (4) what's missing entirely
(new connector or genuinely new feature); (5) a concrete build-order.

---

## Flagship example: Deepfake — the chain that was missing entirely

**What the user is trying to accomplish:** put a specific face and a specific voice into a
script and get a believable talking clip — a virtual spokesperson, not a generic AI avatar.

**Current state (pre-enrichment):** the Deepfake tile is a single call to Yapper's lipsync
process with a text description. It does not touch LoRA, does not touch ElevenLabs, does not
let the user build or reuse an identity. This is the exact gap the user flagged: "I'd be
surprised if we had that functionality even as a skeleton" — confirmed, we didn't.

**The chain that makes it real** (per-tool detail from `../connectors/reference/`):

1. **Identity — Krea/fal LoRA** (`lora-train` → `lora-use`). Train a subject LoRA on reference
   photos of the person (fal's `krea-2-trainer` or `flux-krea-trainer`, `auto_captioning:
   "Object/Character"`). The trained style's `loraUrl` becomes a reusable identity asset —
   already modeled in `TrainedStyle`, just not yet consumed outside the image tile.
2. **Voice — ElevenLabs** (`voice-clone` → `audio-tts`). Clone the person's voice from short
   samples (`voice_clone {name, files[]}`), then drive the script through `text_to_speech` with
   that voice. This is already built (`elevenlabs-tools.ts`) — Deepfake has just never called
   it; it hand-waves "the agent generates speech if needed."
3. **Face + motion — Yapper `video-lipsync`**, OR **muapi `muapi_enhance_face_swap`**
   (image+video modes — the capability we thought didn't exist and does). Yapper needs a
   *source video* asset + the *audio* asset from step 2 (asset ids, not raw files — needs
   `asset-upload` first). muapi's face-swap is the template-based alternative when there's no
   source performance video, only a still photo of the person.
4. **Optional finishing — muapi enhance/upscale** on the result.

**Concrete build order** (this is what the overnight routine should implement, in this
sequence, each step independently shippable):
1. A "Reference person" concept: reuse `TrainedStyle` (already has `id`/`name`/`loraUrl`) as the
   identity record, extend with an optional `voiceId` (ElevenLabs voice id/name) so one record
   holds both likeness and voice.
2. Deepfake screen gains: pick-a-person (existing trained styles filtered/extended with voice)
   → script → **explicit stage progression** (Speech → Face) instead of one opaque call, each
   stage using the actual tool (`textToSpeech` then a lipsync/face-swap call), each stage's
   output visible as its own node (matches the Motion graphics wizard's proven pattern).
3. `asset-upload` helper shared across Yapper/muapi/fal (`uploadLocalAssetTo(connectorId,
   path): Promise<string>`) — the one piece of missing plumbing that unblocks Deepfake, i2v
   generally, and face-swap simultaneously. Build once, reuse three ways (capability map §4).
4. Route: face-swap when only a still photo exists (muapi), lip-sync when a source performance
   video exists (Yapper) — offer both modes once asset-upload exists, restoring the face-swap
   mode the Deepfake screen dropped when Yapper turned out not to have it.

**Status (2026-08-09 enrichment run — steps 1, 2 and a variant of 3/4 shipped):**

- Step 1 done: `TrainedStyle.voiceName` (shared/types.ts), `setTrainedStyleVoice`
  (fal-training.ts) + `lora:set-voice` IPC, and an inline voice field on each Settings › Trained
  styles card.
- Step 2 done: `DeepfakeScreen` (AsidePanel.tsx) is now Reference person → script → **Stage 1
  "Generate speech"** (direct `textToSpeech` call, lands as its own audio node) → **Stage 2
  "Lip-sync / face"** (agent call, source video/photo node picker).
- Steps 3/4, pivoted rather than built as spec'd: no standalone `uploadLocalAssetTo` helper.
  Instead `GenerationParams` gained `connectorIds` (restrict the agent to an exact SET of
  connectors, not just one — `buildMcpServers` in generation.ts now takes `restrictIds: string[]`)
  plus `referenceAudioPaths`/`sourceMediaPath` (local paths resolved and handed to the agent the
  same way `referenceImagePaths` already was). Stage 2 restricts to exactly the connected
  `yapper`/`muapi` pair and instructs the agent to prefer muapi's *own* `muapi_upload_file` tool
  chained into `muapi_edit_lipsync` (or `muapi_enhance_face_swap` for a stills-only reference) —
  both tools it already has — falling back to Yapper's `video-lipsync` process when only Yapper
  is connected. This reuses tools the agent already holds instead of Lyme Hype owning a second
  upload implementation per connector; it only works where an attached connector exposes its own
  upload tool (muapi does, stdio-side) or the source is already a URL. A real
  `uploadLocalAssetTo` helper — specifically for Yapper's REST signed-upload flow, which needs a
  *second*, non-OAuth `yap_live_…` credential Lyme Hype doesn't model yet — is still open; see the
  progress queue's resume note.
- **Not run live** — no connector API keys are configured in this sandbox, and live generation
  spend is explicitly out of scope for the autonomous routine (`AGENTS.md` §0). `npm run
  typecheck` passes; the actual tool-chain prompt (does the agent really call
  `muapi_upload_file` → `muapi_edit_lipsync` in that order, correctly) is unverified until a
  joint session with real keys.
- **2026-08-09, second pass — resume item (c) closed:** `voice_clone` (already implemented in
  `elevenlabs-tools.ts`, already exposed as the Create panel's Generate audio · **Clone** job) was
  never connected to the Reference person concept — cloning a voice and attaching it to a
  `TrainedStyle` were two disconnected screens (clone here, then copy the name and paste it into
  Settings › Trained styles by hand). `AudioScreen`'s clone job now takes an optional "attach to
  Reference person" picker (`props.styles`, already fetched once at the `AsidePanel` level and
  already threaded into `ImageScreen`/`DeepfakeScreen` the same way); on a successful clone with a
  style selected, it calls `bridge.lora.setVoice` with the clone's own `name` — no reply-parsing
  needed, since `voice_clone`'s only file-free confirmation text already echoes the name the
  caller chose and the caller already has it in state — and lifts the updated `TrainedStyle` back
  up via a new `onStyleUpdated` callback prop so the Deepfake screen sees the freshly-paired voice
  without navigating away and back. Nothing here fires a live call beyond the same voice_clone
  call the button already made before this change; only the *what happens after success* path is
  new. `npm run typecheck` clean. Resume items (a) and (b) are still open — see the progress
  queue's row 1 resume note.
- **2026-08-09, third pass — resume item (a) closed:** built the Yapper REST signed-upload path.
  New `src/main/yapper-rest.ts`: `hasYapperRestKey()` + `uploadLocalMediaToYapper(path)` implement
  the flow from `docs/connectors/reference/yapper.md` (`POST /assets/uploads` → PUT the bytes →
  `POST completeUrl` → Asset), reading the `yap_live_…` key from the *same generic secret vault*
  (`credential-vault.ts`) every other connector credential uses, keyed by a synthetic id
  (`yapper-rest`) rather than a real `ConnectorDef` — a fake MCP ConnectorDef would make
  `testConnector` try to MCP-handshake a REST base URL and fail, so this rides the vault directly
  instead of forcing the credential through the MCP connector model it doesn't actually fit.
  `generation.ts` now calls it: when `yapper` is attached and `muapi` is not (the case the hosted
  MCP connector alone can't handle, since it has no upload tool of its own), it pre-uploads
  `sourceMediaPath`/`referenceAudioPaths` before the agent turn starts and hands the agent the
  resulting Yapper asset ids directly in the prompt (`sourceVideoAssetId`/`audioAssetId`), instead
  of asking the agent to discover an upload tool that isn't there. `ConnectorsTab.tsx` gained a
  small "REST upload key" row under the Yapper card (same `bridge.secrets.request`/`list`
  mechanism, no new IPC channel needed — it was already generic over connector id).
  `docs/architecture/capability-map.md` and `docs/ui/creative-nodes.md` updated in this commit.
  `npm run typecheck` clean (fresh `npm install` in this sandbox, no prior `node_modules`). **Not
  run live** — same as every prior pass, no Yapper REST key is configured in this sandbox, and
  live spend is out of scope for the autonomous routine; the actual request/response shapes for
  `POST /assets/uploads` (exact body field names, `completeUrl`'s exact response shape) are
  best-effort from the reference doc's [verified — live OpenAPI enumeration] summary, not
  hand-verified against a real response body — flagging this explicitly since it's the one part
  of this pass that's a documented shape, not a tested one. Resume item (b) — live-verify the
  whole chain (muapi upload→lipsync AND this Yapper REST fallback) — is the only thing left on
  row 1, and it needs real keys, i.e. a joint session.

---

## Node queue (priority order — the routine works top to bottom, one per run)

See `../reports/node-enrichment-progress.md` for live status. Seed ordering and rationale:

1. **Deepfake** — flagship, analyzed above; build order ready to implement.
2. **Motion graphics** — already the most chained node (refs → variations → batch → final →
   frame-conditioned video → alpha); enrichment = deepen reference conditioning (Nano Banana 2's
   10-image cap, not the stale 3), add Veo model choice UI (lite for cheap iterations, full for
   the final render), consider muapi's image-edit tool as an alternative batch source.
3. **Generate video** — currently single-shot t2v; enrich with i2v (a canvas image node as the
   starting frame — Gemini already supports this structurally, just not surfaced on this tile)
   and per-model routing beyond muapi (Yapper's ~20-model catalog is currently invisible here).
4. **Generate image** — LoRA integration exists for storyboard tier; extend the same
   `lora-use` path to production tier, and consider Krea 2 direct (`styles:[{id,strength}]`) as
   a second LoRA-application route alongside fal.
5. **Generate audio** — voice library is solid; add Yapper's free daily-tier TTS as a zero-cost
   fallback route, and Suno-via-muapi as a music alternative when ElevenLabs isn't connected.
6. **Create a LoRA** — already dual-trainer (Krea 2 / FLUX Krea); enrich with a "train from
   this deepfake's reference photos" shortcut once step 1's Reference-person concept exists.
7. **Combine (canvas drag-onto-node)** — still a stub. Real semantics belong here:
   image+image → `image-ref-conditioning` mix; image+audio → `video-gen-i2v` with lip-sync if
   the image is a face. This is where several matrix ○ cells become real UI.
8. **Storyboard / Scripting** — agent-plumbing enrichment: let a script's tone inform which
   voice/LoRA a Deepfake-shot panel should default to.
9. **Timeline overlay / export** — lower priority; the ffmpeg pipeline is already deep.
10. **Listing photos (ChatRealty)** — the connector's staging/cover/carousel tools are paid-for
    and unused; natural next tiles once the core queue is through.

## What "enrichment" means per run (guardrails for the automated routine)

- Real code where safe: new plumbing (asset-upload helper, Reference-person type, stage UI),
  wiring existing-but-unused tools (ElevenLabs voice_clone into Deepfake, muapi face-swap) —
  all of this is zero-risk because none of it fires a live paid call on its own; the user still
  presses Generate.
- **Never** make a live billed API call autonomously — the standing project rule
  (`AGENTS.md` §0) that live generation verification is joint-session work.
- Docs updated in the same commit as code, per `AGENTS.md` §1.3 — this file, the capability
  map, and `creative-nodes.md` all stay in sync with what actually got built.
- Every run appends to `../reports/node-enrichment-report.md`, whether or not it shipped code —
  a research-only or blocked run is still worth a paragraph.
