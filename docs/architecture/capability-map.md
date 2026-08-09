# Capability map — connectors × creative nodes

The join between what the outside tools can do (`../connectors/reference/`) and what the studio
makes (`../ui/creative-nodes.md`). Three parts: the capability vocabulary, the connector matrix,
and the node→capability table that UI readiness and routing derive from.

Maintenance rule: when a connector reference file changes, re-check its matrix row; when a
creative node gains an input type, add its capability here first. This file is the routing
source of truth — code (`TILE_NEEDS`, run-lines, routing defaults) follows it, not the other
way around.

**Model-level companion:** this file answers "which *connector* can do X". Users don't pick
connectors, they pick models — "midjourney", not "muapi" — so the model-level half lives in
[`src/shared/model-catalog.ts`](../../src/shared/model-catalog.ts), a typed registry keyed on
the same capability vocabulary below. It is curated, not exhaustive (muapi alone lists 591
models); it feeds the model pill row in every creative node and carries per-model reference
caps and announced shutdown dates. When a reference doc's model table changes, update the
registry in the same commit as this file's matrix row.

---

## 1. Capability vocabulary

| Key | Meaning |
|---|---|
| `video-gen-t2v` | text → video |
| `video-gen-i2v` | image → video (single conditioning image) |
| `video-frame-conditioning` | explicit start **and/or** end frame control |
| `video-extension` | continue an existing video |
| `image-gen` | text → image (storyboard-cheap acceptable) |
| `image-production` | Midjourney-class committed-spend image |
| `image-ref-conditioning` | reference images mixed into generation |
| `image-edit` | instruction-driven edit of an existing image (no mask) |
| `image-inpaint` | masked region regenerated in place |
| `audio-tts` | text → speech |
| `audio-music` | prompt → music |
| `audio-sfx` | prompt → sound effect |
| `voice-clone` | samples → reusable named voice |
| `voice-library` | browse/search selectable voices |
| `lipsync` | drive a face with audio (talking avatar) |
| `lora-train` | images → reusable style/subject weights |
| `lora-use` | apply trained weights at generation |
| `upscale` / `bg-remove` | enhancement transforms |
| `asset-upload` | local file → provider-hosted URL |
| `data-mls` | real-estate listing data/photos |
| *(local)* `ffmpeg-*` | isolate-audio, alpha-key, multitrack export — never a connector |

## 2. Connector × capability matrix

✓ = verified working path · ○ = provider supports it, not yet wired in Lyme Hype · — = absent

| Capability | muapi | ElevenLabs | Krea | fal | Gemini | OpenAI | Yapper | ChatRealty |
|---|---|---|---|---|---|---|---|---|
| `video-gen-t2v` | ✓ Seedance/Kling/Veo/Sora (591 models) | — | ○ video models | ○ Seedance/WAN etc. | ✓ Veo 3.1 (lite = $0.05/s) | — | ○ ~20 models (sora-2, kling-3, seedance-2.x…) | — |
| `video-gen-i2v` | ○ video-from-image (single image_url) | — | ○ | ✓ Generate video's i2v picker offers "via: fal" once fal is connected (`run_model`/`submit_job`, model picked by the agent from the i2v catalog) | ✓ start frame | — | ○ | — |
| `video-frame-conditioning` | ○ **REST-only** (MCP tool can't express it) | — | ○ | ○ (5 different param spellings — check per model) | ✓ image+lastFrame (dur must be 8) | — | ○ | — |
| `video-extension` | — | — | ○ Seedance 1.0 Pro `start_video` | — | ✓ Veo 3.1 wrapper tool + canvas "Extend +7s" picker (720p; client-probed `videoDurationSec` enforces the 148s cap client-side, wire shape unverified) | — | — | — |
| `image-gen` | ✓ flux/nano-banana/imagen4 | — | ✓ K2 family (1K only) | ○ (nano-banana here = resold Gemini — prefer direct) | ✓ Nano Banana 2 | ✓ gpt-image-2 (quality = price lever) | ○ 11 models | ○ covers/carousel/staging (templated, Cloudinary URLs) |
| `image-production` | ✓ Midjourney V7/V8/Niji (muapi-exclusive: MJ/Suno/Sora have ZERO fal endpoints) | — | ○ K2 Large | — | — | — | — | — |
| `image-ref-conditioning` | ✓ image-edit tool, single ref only — Motion graphics' "Batch via muapi image-edit" toggle (wire unverified, no key) | — | ○ | ○ | ✓ ≤10 obj +4 char +3 style refs (NB2) | ✓ edits ≤16 refs | — | ○ staging composites agent headshots |
| `audio-tts` | — | ✓ text_to_speech | — | ○ | — | — | ✓ /audio/speech — **sync + free daily tier** (ElevenLabs/Cartesia under the hood), direct REST call from the Generate audio · Voice job when ElevenLabs isn't connected | — |
| `audio-music` | ✓ Suno | ✓ compose_music | — | ○ | — | — | — | — |
| `audio-sfx` | ○ MMAudio (from video) | ✓ text_to_sound_effects | — | — | — | — | — | — |
| `voice-clone` | ○ Suno singing clone ($0 + liveness check) | ✓ voice_clone | — | — | — | — | ○ | — |
| `voice-library` | — | ✓ search_voices (+▶ preview) | — | — | — | — | ✓ /audio/voices — wired as the Yapper-fallback Voice job's provider (Cartesia/ElevenLabs) picker | — |
| `lipsync` | ○ edit-lipsync tool | — | — | ○ | — | — | ✓ Max (auto-trains, returns reusable trainingId) | — |
| `face-swap` | ○ **muapi_enhance_face_swap (image + video)** | — | — | — | — | — | — (absent from OpenAPI, re-verified) | — |
| `lora-train` | — | — | ✓ `/styles/train` REST (unpublished price) | ✓ krea-2 + flux-krea trainers (flux-krea delisted from catalog but endpoint live — route by exact id) | — | — | — | — |
| `lora-use` | — | — | ✓ styles:[{id,strength}] | ✓ loras param (weights URL) | — | — | — | — |
| `upscale` / `bg-remove` | ✓ enhance tools | — | ○ | ○ | — | — | ○ image/video-upscale processes | — |
| `asset-upload` | ✓ upload_file (stdio only) | n/a (local files in) | ○ get_upload_url | ✓ upload_file / storage REST | n/a (inline bytes) | n/a (multipart) | ✓ import-by-URL / REST signed upload | — |
| `data-mls` | — | — | — | — | — | — | — | ✓ 35 tools |

Cross-cutting corrections from the reference aggregation (2026-08-09): **face-swap DOES exist —
on muapi** (`muapi_enhance_face_swap`); it's Yapper that lacks it. **Yapper is a full
aggregator** (~20 video + 11 image models + free-tier sync TTS), not lipsync-only — routing
still treats it as specialty, deliberately, but the tiles count it as a video/image provider. Its
video catalog is now reachable by name from the Generate video tile (2026-08-09 enrichment run,
row 3) — a model picker sets `modelHint` to the literal model id (`sora-2`, `kling-3.0-pro`, …)
and forces `connectorId: 'yapper'`, matching the Motion graphics wizard's literal-model-id pattern.
**ChatRealty is not data-only**: server-side staging (Nano Banana composites, ~$0.04/photo),
listing covers, and carousel slides return Cloudinary URLs — a second ingestion path.
**OpenAI cannot output transparency** (gpt-image-2 rejects background:'transparent') — the
local colorkey pipeline is the only alpha path, by design. ElevenLabs cannot make video, and
its server ships side-effect tools (`make_outbound_call`, `create_agent`) that generation runs
deny-list alongside muapi's Stripe/keys tools.
**`lora-use` on Krea is now wired, not just possible** (2026-08-09 enrichment run, row 4): a
second "Create a LoRA" trainer option (`krea-training.ts`, `POST /styles/train`) produces a style
with `connectorId: 'krea'`; Generate image routes a picked style through whichever backend
trained it instead of always forcing `fal` — the fix closes a real bug where a legacy
`connectorId: 'krea'` `TrainedStyle` would have silently been routed through fal anyway. This is
also the first genuine production-tier LoRA path: fal's weights-URL route ignores the
storyboard/production tier entirely, but a Krea-trained style honors it (K2 medium vs. K2 large,
$0.03 vs. $0.06/image).

## 3. Creative node → capabilities (drives readiness + routing)

| Creative node | Requires (ANY provider of) | Default route | Escape hatch |
|---|---|---|---|
| Generate video | `video-gen-t2v` | muapi (Seedance) | connector select incl. agent-pick; picking a canvas image as a starting frame routes `video-gen-i2v` through gemini by default, or fal (agent picks a catalog i2v model) via an "i2v via" picker shown once fal is connected; a Yapper model pick routes through yapper with that model as `modelHint` |
| Generate image · storyboard | `image-gen` | gemini/openai pick | — |
| Generate image · production | `image-production` | muapi + hint "Midjourney" | tier toggle |
| Generate image · with style | `lora-use` | routes by the style's own `connectorId` — fal (weights-URL hint) or krea (`styles:[{id}]` hint, tier picks K2 medium/large) | — |
| Audio · voice | `audio-tts` (+`voice-library`) | ElevenLabs direct call | Yapper `/audio/speech` direct REST call (free daily tier) when ElevenLabs isn't connected and a Yapper REST key is set — `GET /audio/voices` browsable via a Cartesia/ElevenLabs-via-Yapper toggle, defaulting to Yapper's own default voice when none is picked |
| Audio · music | `audio-music` | ElevenLabs | muapi's Suno wrapper (agent-routed, `connectorId: 'muapi'`) when ElevenLabs isn't connected and muapi is |
| Audio · SFX | `audio-sfx` | ElevenLabs | — |
| Audio · clone | `voice-clone` | ElevenLabs | — |
| Motion gfx · batch/final | `image-gen`, `image-ref-conditioning` | gemini/openai pick | — |
| Motion gfx · animate | `video-frame-conditioning` | gemini (Veo 3.1) | quality-tier picker (default/fast/lite via `modelHint`) |
| Deepfake · speech | `audio-tts` | ElevenLabs direct call | — |
| Deepfake · face | `lipsync` / `face-swap` | muapi+yapper chain (both restricted via `connectorIds`) | either alone |
| Create a LoRA | `lora-train` | fal trainer pick | — |
| Storyboard promote (image) | `image-gen` | per-panel choice | agent-pick |
| Storyboard → Deepfake handoff | *(none — local)* | word-overlap match of panel `feeling` against Reference people's `personaTone` | no match found (screen just prefills the script, picker stays "none") |
| Listing photos | `data-mls` | chatrealty | top-matched listing also offers a branded Instagram cover render (`create_listing_cover`, hook+body required), a carousel slide render (`create_carousel_slide`, kind picker: cma/text/cta/banner), an interior-photo picker for agent staging (`stage_listing_with_agent`, real ~$0.04/photo generation, checkboxes feed exact `photoIndexes` from each pulled photo's `ChatRealtyPulledImage.photoIndex`), a CMS article draft (`create_article`, DRAFT-only, category/title/excerpt/content form, optional prefill from `plan_listing_carousel`'s facts via the same `listingContext` call the Scripting panel uses — no canvas node, a CMS slug), and a CMS landing-page draft (`create_landing_page`, DRAFT-only, title/content/hero-type/YouTube/theme form, same prefill button — no canvas node, an editUrl+previewUrl) — same connector, renders downloaded via `importUrlAsset` |
| Isolate / alpha / export / upload / link | *(local)* | ffmpeg / disk | never a connector |
| Combine · image+image | `image-ref-conditioning` | agent-pick (unrestricted) | — |
| Combine · audio+image | `lipsync` or `video-gen-i2v` | agent-pick (unrestricted) | prompt tells the agent to branch on whether the image shows a face |
| Combine · video+video / image+video / audio+video / audio+audio | *(local)* | ffmpeg (`combineLocal` in `media-tools.ts`) | never a connector — deterministic per pair, no agent turn |

The Create tiles' readiness (`TILE_NEEDS` in `AsidePanel.tsx`) is this table's "requires"
column flattened to connector ids — when the matrix changes, change the table here, then the
code. The chip on an unready tile phrases the need by capability ("needs a video tool"), since
several connectors can satisfy one node.

## 4. Known unwired paths worth planning around (the ○ cells)

- **muapi image-edit** is now steered toward by name in one place: Motion graphics' Batch stage
  (2026-08-09 enrichment run, Recommendations item 5) gained a "Batch via muapi image-edit"
  checkbox that forces `connectorId: 'muapi'` and `referenceImagePaths: [<first ref>]` — since
  `muapi_image_edit` takes exactly one `image_url`, not a reference list, each variation prompt
  becomes an edit instruction against that one photo instead of a fresh text-to-image call.
  `generation.ts`'s upload-tool prompt hint (previously only fired for `sourceMediaPath`/
  `referenceAudioPaths`) now also fires for `referenceImagePaths`, so the agent knows to call
  muapi's own `muapi_upload_file` before handing a local path to `image_url`. **Unverified live**
  — no muapi key configured to exercise the chain. `video-from-image` / `upscale` / `bg-remove`
  remain unsteered — the installed connector already exposes them; no creative node drives them by
  name yet, though Combine's image+image and audio+image pairs (2026-08-09 enrichment run, row 7)
  leave the connector unrestricted, so they're reachable there if the agent picks them — just not
  steered toward specifically the way Deepfake's chain note steers muapi/Yapper. `muapi_edit_lipsync` /
  `muapi_enhance_face_swap` are now wired into the Deepfake tile's
  Stage 2 prompt (2026-08-09 enrichment run) — `GenerationParams.connectorIds` restricts the
  agent to exactly the connected `yapper`/`muapi` pair so it can chain muapi's own upload tool
  into either tool, or fall back to Yapper's `video-lipsync` process when only Yapper is
  connected. When Yapper is the *only* attached connector, `generation.ts` pre-uploads
  `sourceMediaPath`/`referenceAudioPaths` itself via `yapper-rest.ts`'s REST signed-upload
  (`yap_live_…` key, second run 2026-08-09) and hands the agent the resulting Yapper asset ids
  directly, rather than asking the agent to find an upload tool that doesn't exist on the
  hosted MCP connector. **Unverified live** — no keys configured to fire it yet.
- **i2v everywhere except Gemini** needs `asset-upload` first (muapi has it stdio-side; fal now
  has it wired too, see below; Yapper imports by URL, or now the Deepfake-scoped REST signed-upload
  above for local files) — a general-purpose helper spanning all three connectors and every node
  (not just Deepfake's local-media case) is still the open plumbing item, though fal's slice of it
  closed 2026-08-09 (see below). Gemini's i2v path itself is now reachable from the Generate video
  tile (2026-08-09 enrichment run, row 3): picking a ready canvas image node as a starting frame
  sets `GenerationParams.startFramePath` and forces `connectorId: 'gemini'`, reusing the same
  `startFramePath` plumbing the Motion graphics wizard's Animate stage already exercised — muapi/
  Yapper i2v are still blocked on their own slice of `asset-upload`.
- **fal's `asset-upload` gap closed** (2026-08-09 enrichment run, off the report's own
  Recommendations #1 — "the single biggest unblocked gap"): fal's hosted MCP `upload_file` tool
  only accepts a remote URL (the server is stateless and can't read a local disk path), unlike
  muapi's stdio `muapi_upload_file`, so a generation agent had no way to get a local reference
  image/source video/audio file onto fal at all — any tile that ended up routed to fal with local
  media would have failed or hallucinated a path. `fal-training.ts`'s existing zip-upload REST flow
  (already used for LoRA training images) is now generalized into an exported single-file
  `uploadLocalFileToFal(path)` (same `POST /storage/upload/initiate` → PUT bytes flow, extension→
  content-type map for images/video/audio). `generation.ts` calls it before the agent turn — same
  shape as the existing Yapper-only pre-upload block just above it — whenever fal is the *sole*
  attached connector (i.e. `GenerationParams.connectorId: 'fal'` via any tile's manual connector
  picker, or `connectorIds: ['fal']`), pre-uploading every local `referenceImagePaths`/
  `startFramePath`/`endFramePath`/`sourceMediaPath`/`referenceAudioPaths` entry and handing the
  agent the resulting fal.media URLs directly with an explicit "already uploaded, don't try
  yourself" instruction, mirroring the Yapper block's own wording. **Not run
  live** — no fal key configured in the sandbox that built this, and the `POST /storage/upload/
  initiate` request/response shape is read from the same verified reference-doc entry
  `fal-training.ts`'s zip upload already used (not newly re-verified), so risk is limited to the
  single-file case (arbitrary extension/content-type) never having been exercised before.
- **fal i2v picker** (2026-08-09 enrichment run, closing the "no fal-forcing picker" gap the prior
  entry left open): `VideoScreen`'s starting-frame select now shows a second "i2v via" picker
  (gemini/fal) whenever a starting frame is chosen *and* fal is connected — picking fal forces
  `connectorId: 'fal'` and still sends `startFramePath`, same as gemini's existing forced route.
  fal's tool surface has no fixed `start_frame_path` param the way Gemini's bundled wrapper does
  (its generic `run_model`/`submit_job` take `endpoint_id` + `input`, and the image field name
  varies per model — `image_url`, `start_image_url`, `first_frame_image`, see fal.md's model
  table), so `generation.ts`'s `buildPrompt()` now phrases the `startFramePath` hint conditionally:
  use `start_frame_path` literally for a tool that has it, otherwise call `get_model_schema` first
  and match the schema's own field name. Default stays gemini (verified, unchanged) — fal only
  appears as an option, never auto-selected, and gemini-only setups see no UI change at all. **Not
  run live** — no fal key in this sandbox; which of the field-name guesses an agent actually picks,
  and whether it reliably calls `get_model_schema` first rather than guessing, is unverified.
- **muapi frame conditioning is REST-only** — the MCP tool takes a single image_url even
  though the model enum lists first-last-frame models; if muapi-side interpolation ever
  matters, it's a REST call, not a tool call. (Gemini's wrapper covers this need today, and
  its `model` arg now offers veo-3.1-lite at ~8× cheaper for reveals — the Motion graphics
  wizard's Animate stage surfaces this as a quality-tier picker, 2026-08-09 enrichment run;
  previously the wrapper supported it but nothing in the UI ever set the `model` arg.)
- **Suno via muapi** as a music alternative when ElevenLabs isn't connected — now wired (2026-08-09
  enrichment run, row 5 second pass): unlike the TTS fallback below, `muapi_audio_create` is an
  agent-driven MCP tool, not a direct REST call, so the Generate audio · Music job routes through
  `generateMedia`/`generation.ts`'s agent path (`connectorId: 'muapi'`, `modelHint: 'suno'`) instead
  of a synchronous fetch, and renders through the same `ResultRow` rendering-node lifecycle Video
  and Deepfake already use rather than this screen's `ok`/`src` status line. An instrumental-only
  checkbox appends "Instrumental only, no vocals." to the prompt for `make_instrumental` rather than
  adding a new `GenerationParams` field, the same free-text-directive pattern Deepfake's chain note
  already established. **Yapper's free daily-tier TTS** is also wired (2026-08-09 enrichment run,
  row 5 first pass): `yapper-rest.ts`'s `synthesizeYapperSpeech()` calls the same
  `POST /audio/speech` endpoint documented above directly (no agent turn, no polling — the endpoint
  is synchronous), and the Generate audio · Voice job auto-routes to it when ElevenLabs isn't
  connected and the `yapper-rest` REST key is set. **Voice browsing** shipped in a later pass:
  `listYapperVoices()` calls `GET /audio/voices?modelId=…`, mapping a Cartesia/ElevenLabs provider
  toggle to the two browsable TTS models in Yapper's audio catalog (`sonic-3.5`/`eleven_v3` — the
  third, `bytedance/seed-audio-1.0`, is ref-clip voice design, nothing to browse). The response's
  per-voice field names aren't captured in the reference doc beyond the bare `AudioVoice[]` type,
  so parsing reads defensively across the field names the sibling `/audio/speech` response's own
  `voice{voiceId,provider,name}` object uses — worth a live check once a REST key exists. Picking
  no voice still falls back to Yapper's own default, same as before.
- **Veo video-extension** (+7s chained, 720p) — the wrapper tool (`gemini_extend_video`, 2026-08-09
  enrichment run) and `GenerationParams.extendVideoPath`/`extendVideoDurationSec` now have a canvas
  front end: an "Extend an existing clip" picker in `VideoScreen` (2026-08-09, later enrichment
  run) lists ready video nodes, forces `connectorId: 'gemini'`, and sends the picked node's real
  `MediaNodeData.videoDurationSec` as `extendVideoDurationSec`. Duration tracking is **real, not
  requested-duration guesswork**: `store.ts`'s `generateMedia` reuses the Cut Room's existing
  `probeDuration()` helper (a detached `<video>` element's `loadedmetadata`, already used for
  `TimelineClip.sourceDuration`) to measure every video node's actual length off its own media file
  right after generation or extension completes, and the run-line blocks a call client-side once
  `videoDurationSec + 7 > 148`. The wrapper itself still can't independently verify a running total
  it wasn't told, so a node whose `videoDurationSec` is still unset (migrated/legacy nodes, or if
  the probe ever fails) shows "length unknown, cap unenforced client-side" rather than silently
  guessing. The wire shape for the prior-video reference itself is still **unverified** — see
  `docs/connectors/reference/gemini.md`'s `gemini_extend_video` entry for the two conflicting shapes
  found (official docs' `inlineData` vs. a forum report wanting `uri`) and why the wrapper went with
  `inlineData` from a local re-read rather than threading Google's short-lived video URI through (the
  wrapper already discards it after downloading). Extending also resets the 2-day server retention
  clock, moot for the wrapper since it downloads immediately either way. First live click is still
  the real verification of which shape is correct.
- **ChatRealty's whole creative-rendering chain is now wired** — all four tools
  (`create_listing_cover`, `plan_listing_carousel`, `create_carousel_slide`,
  `stage_listing_with_agent`), the last two both landing in the same overnight pass window
  (2026-08-09, two independent runs merged together — see the enrichment report's twentieth-run
  entry). Covers render from the Listing photos tile's top-matched listing, downloaded via the
  `importUrlAsset` path this note originally predicted — first proof that path works end-to-end for
  a ChatRealty Cloudinary URL. `plan_listing_carousel` isn't a tile — it feeds the Scripting panel's
  agent context (real listing facts/CMA numbers, once per conversation) rather than rendering
  anything itself; see `docs/ui/creative-nodes.md`'s Scripting conversation section.
  `create_carousel_slide` is a kind picker + per-kind form beside the cover, four kinds
  (cma/text/cta/banner), same `importUrlAsset` ingestion; unlike the cover/staging tools it takes no
  `listingKey` — every kind's content is literal caller-supplied fields, not a lookup.
  `stage_listing_with_agent` is an interior-photo checkbox picker after a pull, each photo carrying
  its real `get_listing_photos` position (`ChatRealtyPulledImage.photoIndex`) so the picker feeds
  exact `photoIndexes` rather than guessing — this is the one tool in the chain that's a real billed
  generation call (~$0.04/photo), so the picker only builds the request; nothing fires until a human
  presses the button, same posture as every other connector's Generate action.
- **A fifth ChatRealty tool, `create_article`, is now wired too** (Recommendations item 2 in the
  enrichment report) — a DRAFT-only CMS post, distinct from the four Cloudinary-returning creative
  tools above in that its result is a slug, not media, so nothing lands on the canvas; a "Prefill
  from listing facts" button reuses `plan_listing_carousel`'s material (the same `listingContext`
  call the Scripting panel's context enrichment already makes) so the draft can start from real
  numbers instead of an agent inventing them. `update_article`'s `status: 'published'` transition
  (the actual publish step, cross-posting to Google Business) stays untouched, per AGENTS.md rule 6.
- **A sixth ChatRealty tool, `create_landing_page`, is now wired too** (the "still open" half of
  Recommendations item 2 — a structurally bigger sibling to `create_article`, deliberately left for
  its own pass at the time). Same DRAFT-only posture and same slug-not-media result shape (here
  `editUrl`/`previewUrl` per the reference doc, not a slug — `createLandingPageDraft()` tries those
  two JSON keys, falls back to scanning the raw text for URLs since no field-level schema exists).
  Only `title`/`content` (the reference doc's two documented required fields) plus the three
  simplest `landingPage` block fields (`heroType`, `youtubeUrl`, `themeOverride`) are sent — the
  block's lead-form fields/recipients sub-shape has no field-level documentation anywhere in the
  reference doc, so it's deliberately left unwired rather than guessed at; a human configures lead
  capture in the CMS's own editor once the draft exists. `update_landing_page`'s
  `status: 'published'` transition stays untouched, same AGENTS.md rule 6 boundary.
- **muapi sandbox keys** return instant free mock data — the cheap way to integration-test
  the whole generation loop before the joint live session.
