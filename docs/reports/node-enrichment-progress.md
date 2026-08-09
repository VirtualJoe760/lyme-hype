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
| 1 | Deepfake | in-progress | Reference person (TrainedStyle.voiceName) + staged Speech→Face UI shipped; Stage 2 chains muapi's own upload tool into edit_lipsync/face_swap via new `GenerationParams.connectorIds`/`referenceAudioPaths`/`sourceMediaPath` instead of a standalone asset-upload helper. Clone-and-attach (former resume item c) now shipped: the Create panel's Clone-voice job can attach its result to a Reference person in one step. resume: (a) build the Yapper REST signed-upload path (`yap_live_…` key — a second, non-OAuth credential ConnectorDef doesn't model yet) so the Yapper-only fallback can actually ingest local media, not just URL imports; (b) live-verify the muapi upload→lipsync chain once real keys exist (joint session). |
| 2 | Motion graphics | pending | Deepen reference conditioning (10-image cap, not 3), add Veo model choice (lite vs full), consider muapi image-edit as a second batch source. |
| 3 | Generate video | pending | Add i2v from a canvas image node; surface Yapper's ~20-model catalog as a routing option. |
| 4 | Generate image | pending | Extend lora-use to production tier; add Krea 2 direct styles param as a second LoRA route. |
| 5 | Generate audio | pending | Yapper free-tier TTS fallback; Suno-via-muapi as a music alternative. |
| 6 | Create a LoRA | pending | "Train from this deepfake's reference photos" shortcut once Reference-person exists (needs #1). |
| 7 | Combine (canvas) | pending | Give the stub real semantics: image+image → ref-conditioning mix; image+audio(face) → i2v + lipsync. |
| 8 | Storyboard / Scripting | pending | Let script tone default a shot panel's voice/LoRA pick. |
| 9 | Timeline / export | pending | Lower priority — pipeline already deep; look for gaps only. |
| 10 | Listing photos (ChatRealty) | pending | Staging/cover/carousel tools are paid-for and unused — candidate new tiles. |

## Cross-cutting plumbing (build once, benefits multiple rows)

- [ ] `asset-upload` helper — local file/asset → provider-hosted URL, shared by muapi/fal/Yapper. Blocks rows 1, 3, 7.
- [ ] "Reference person" concept — extends `TrainedStyle` with an optional `voiceId`. Blocks rows 1, 6.

## Session log (routine writes one line per run here, newest first)

- 2026-08-09 (second autonomous run) — Deepfake: wired `voice_clone` into the Reference person
  flow (former resume item c). Create panel's Clone-voice job can now attach a freshly-cloned
  voice to a `TrainedStyle` in one action instead of a manual copy/paste round-trip through
  Settings. Left in-progress — see row 1's resume note (Yapper REST upload credential + live
  verification still open, both real scope needing a joint session).
- 2026-08-09 (first autonomous run) — Deepfake: Reference person concept + staged Speech/Face UI
  + `connectorIds`/`referenceAudioPaths`/`sourceMediaPath` plumbing. Left in-progress — see row 1's
  resume note (Yapper REST upload credential + live verification still open).
- 2026-08-09 06:2x UTC — seeded by main session ahead of the first autonomous run.
