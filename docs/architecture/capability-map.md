# Capability map — connectors × creative nodes

The join between what the outside tools can do (`../connectors/reference/`) and what the studio
makes (`../ui/creative-nodes.md`). Three parts: the capability vocabulary, the connector matrix,
and the node→capability table that UI readiness and routing derive from.

Maintenance rule: when a connector reference file changes, re-check its matrix row; when a
creative node gains an input type, add its capability here first. This file is the routing
source of truth — code (`TILE_NEEDS`, run-lines, routing defaults) follows it, not the other
way around.

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
| `video-gen-i2v` | ○ video-from-image (single image_url) | — | ○ | ○ (needs `asset-upload`) | ✓ start frame | — | ○ | — |
| `video-frame-conditioning` | ○ **REST-only** (MCP tool can't express it) | — | ○ | ○ (5 different param spellings — check per model) | ✓ image+lastFrame (dur must be 8) | — | ○ | — |
| `video-extension` | — | — | ○ Seedance 1.0 Pro `start_video` | — | ○ Veo 3.1 (+7s ×20, 720p) | — | — | — |
| `image-gen` | ✓ flux/nano-banana/imagen4 | — | ✓ K2 family (1K only) | ○ (nano-banana here = resold Gemini — prefer direct) | ✓ Nano Banana 2 | ✓ gpt-image-2 (quality = price lever) | ○ 11 models | ○ covers/carousel/staging (templated, Cloudinary URLs) |
| `image-production` | ✓ Midjourney V7/V8/Niji (muapi-exclusive: MJ/Suno/Sora have ZERO fal endpoints) | — | ○ K2 Large | — | — | — | — | — |
| `image-ref-conditioning` | ○ image-edit tool | — | ○ | ○ | ✓ ≤10 obj +4 char +3 style refs (NB2) | ✓ edits ≤16 refs | — | ○ staging composites agent headshots |
| `audio-tts` | — | ✓ text_to_speech | — | ○ | — | — | ○ /audio/speech — **sync + free daily tier** (ElevenLabs/Cartesia under the hood) | — |
| `audio-music` | ✓ Suno | ✓ compose_music | — | ○ | — | — | — | — |
| `audio-sfx` | ○ MMAudio (from video) | ✓ text_to_sound_effects | — | — | — | — | — | — |
| `voice-clone` | ○ Suno singing clone ($0 + liveness check) | ✓ voice_clone | — | — | — | — | ○ | — |
| `voice-library` | — | ✓ search_voices (+▶ preview) | — | — | — | — | ○ /audio/voices | — |
| `lipsync` | ○ edit-lipsync tool | — | — | ○ | — | — | ✓ Max (auto-trains, returns reusable trainingId) | — |
| `face-swap` | ○ **muapi_enhance_face_swap (image + video)** | — | — | — | — | — | — (absent from OpenAPI, re-verified) | — |
| `lora-train` | — | — | ○ REST (unpublished price) | ✓ krea-2 + flux-krea trainers (flux-krea delisted from catalog but endpoint live — route by exact id) | — | — | — | — |
| `lora-use` | — | — | ✓ styles:[{id,strength}] | ✓ loras param (weights URL) | — | — | — | — |
| `upscale` / `bg-remove` | ✓ enhance tools | — | ○ | ○ | — | — | ○ image/video-upscale processes | — |
| `asset-upload` | ✓ upload_file (stdio only) | n/a (local files in) | ○ get_upload_url | ✓ upload_file / storage REST | n/a (inline bytes) | n/a (multipart) | ✓ import-by-URL / REST signed upload | — |
| `data-mls` | — | — | — | — | — | — | — | ✓ 35 tools |

Cross-cutting corrections from the reference aggregation (2026-08-09): **face-swap DOES exist —
on muapi** (`muapi_enhance_face_swap`); it's Yapper that lacks it. **Yapper is a full
aggregator** (~20 video + 11 image models + free-tier sync TTS), not lipsync-only — routing
still treats it as specialty, deliberately, but the tiles count it as a video/image provider.
**ChatRealty is not data-only**: server-side staging (Nano Banana composites, ~$0.04/photo),
listing covers, and carousel slides return Cloudinary URLs — a second ingestion path.
**OpenAI cannot output transparency** (gpt-image-2 rejects background:'transparent') — the
local colorkey pipeline is the only alpha path, by design. ElevenLabs cannot make video, and
its server ships side-effect tools (`make_outbound_call`, `create_agent`) that generation runs
deny-list alongside muapi's Stripe/keys tools.

## 3. Creative node → capabilities (drives readiness + routing)

| Creative node | Requires (ANY provider of) | Default route | Escape hatch |
|---|---|---|---|
| Generate video | `video-gen-t2v` | muapi (Seedance) | connector select incl. agent-pick |
| Generate image · storyboard | `image-gen` | gemini/openai pick | — |
| Generate image · production | `image-production` | muapi + hint "Midjourney" | tier toggle |
| Generate image · with style | `lora-use` | fal + weights-URL hint | — |
| Audio · voice | `audio-tts` (+`voice-library`) | ElevenLabs direct call | — |
| Audio · music | `audio-music` | ElevenLabs | muapi/Suno unwired ○ |
| Audio · SFX | `audio-sfx` | ElevenLabs | — |
| Audio · clone | `voice-clone` | ElevenLabs | — |
| Motion gfx · batch/final | `image-gen`, `image-ref-conditioning` | gemini/openai pick | — |
| Motion gfx · animate | `video-frame-conditioning` | gemini (Veo 3.1) | — |
| Deepfake | `lipsync` | yapper (restricted) | — |
| Create a LoRA | `lora-train` | fal trainer pick | — |
| Storyboard promote (image) | `image-gen` | per-panel choice | agent-pick |
| Listing photos | `data-mls` | chatrealty | — |
| Isolate / alpha / export / upload / link | *(local)* | ffmpeg / disk | never a connector |

The Create tiles' readiness (`TILE_NEEDS` in `AsidePanel.tsx`) is this table's "requires"
column flattened to connector ids — when the matrix changes, change the table here, then the
code. The chip on an unready tile phrases the need by capability ("needs a video tool"), since
several connectors can satisfy one node.

## 4. Known unwired paths worth planning around (the ○ cells)

- **muapi image-edit / video-from-image / lipsync / face-swap / upscale / bg-remove tools** —
  the installed connector already exposes them; no creative node drives them yet (Combine's
  real design should start here, and `muapi_enhance_face_swap` could revive the Deepfake
  tile's face-swap mode that Yapper couldn't serve).
- **i2v everywhere except Gemini** needs `asset-upload` first (muapi has it stdio-side; fal has
  it; Yapper imports by URL) — the missing plumbing is "give a local node a provider-visible
  URL", one mechanism reusable across all three.
- **muapi frame conditioning is REST-only** — the MCP tool takes a single image_url even
  though the model enum lists first-last-frame models; if muapi-side interpolation ever
  matters, it's a REST call, not a tool call. (Gemini's wrapper covers this need today, and
  its `model` arg now offers veo-3.1-lite at ~8× cheaper for reveals.)
- **Suno via muapi** as a music alternative when ElevenLabs isn't connected; **Yapper's free
  daily-tier TTS** as a zero-cost voice fallback (REST, separate key).
- **Veo video-extension** (+7s chained, 720p) — a natural "extend this clip" action on video
  nodes; extending also resets the 2-day server retention clock.
- **ChatRealty staging/covers/carousels** — creative tools already paid for; natural tiles,
  but note their results come back as Cloudinary URLs (importUrlAsset path, not base64).
- **muapi sandbox keys** return instant free mock data — the cheap way to integration-test
  the whole generation loop before the joint live session.
