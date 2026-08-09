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
