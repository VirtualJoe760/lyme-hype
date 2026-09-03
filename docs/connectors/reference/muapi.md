# muapi — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

The video-primary aggregator: one API key covers the models that have no practical direct path — Seedance (all generations), Kling, Sora 2, Midjourney — plus overlapping coverage of Veo, Flux, nano-banana, imagen4, seedream images and Suno music. It is the default route for video generation in connector-tier routing; ElevenLabs stays preferred for voice, Gemini/OpenAI connectors for frame-conditioned or reference-image work the muapi MCP tools can't express (see Gotchas). During agent-driven generation, `muapi_account_topup` (Stripe checkout), `muapi_keys_create`, and `muapi_keys_delete` are deny-listed [verified, in-app].

## Connection

| Surface | Transport | Auth | Notes |
|---|---|---|---|
| stdio MCP (what Lyme Hype installs) | `npx -y muapi-cli mcp serve` | `MUAPI_API_KEY` env var | muapi-cli@0.2.7 real on npm; 25 tools [verified] |
| Hosted MCP | Streamable HTTP `https://api.muapi.ai/mcp` | `Authorization: Bearer <key>` | Plain Bearer [verified]. Docs also offer key-in-URL `https://api.muapi.ai/mcp/<key>` — avoid (secret in URL) [docs] |
| REST | `https://api.muapi.ai/api/v1` | `x-api-key: <key>` header | Different header than hosted MCP [docs] |

- Key page: <https://muapi.ai/access-keys> (the URL `connector-suggestions.ts` opens); docs route is Dashboard → API Keys [docs].
- Two key types: **production** keys (spend credits) and **sandbox** keys (badge in dashboard, free, return instant mock data — useful for integration tests) [docs].
- CLI alternative auth: `muapi auth configure --api-key "..."` or `muapi auth login --email ... --password ...` writes a config; the MCP env var wins for Lyme Hype's purposes [docs].
- Install shape used by `src/main/connector-suggestions.ts` [verified, in-repo]:

```json
{
  "id": "muapi", "kind": "stdio",
  "command": "npx", "args": ["-y", "muapi-cli", "mcp", "serve"],
  "authType": "apiKey", "secretKey": "MUAPI_API_KEY",
  "docUrl": "https://muapi.ai/access-keys"
}
```

## Tool surface

All 25 stdio tools, from live schema enumeration of muapi-cli@0.2.7 on 2026-08-09 [verified]. Every generation tool is async: it returns `{request_id, status:"processing"}` and you poll `muapi_predict_result`.

### Generation

| Tool | Purpose | Key parameters | Returns |
|---|---|---|---|
| `muapi_image_generate` | Text-to-image | `prompt` (req, string); `model` (enum of 56, default `flux-dev`); `width`/`height` (int, default 1024); `num_images` (1–4); `aspect_ratio` (kontext/midjourney models) | job → image URLs |
| `muapi_image_edit` | Edit/transform image via prompt | `prompt` (req); `image_url` (req, uri); `model` (enum of 46, default `flux-kontext-dev`); `aspect_ratio`; `num_images` (1–4) | job → image URLs |
| `muapi_video_generate` | Text-to-video | `prompt` (req); `model` (enum of 66, default `kling-master`); `duration` (int sec, default 5); `aspect_ratio` (default `16:9`) | job → video URL |
| `muapi_video_from_image` | Animate ONE image into video | `prompt` (req); `image_url` (req, uri — single); `model` (enum of 79, default `kling-std`); `duration`; `aspect_ratio` | job → video URL |
| `muapi_audio_create` | Suno music | `prompt` (req — description or lyrics); `title`; `tags` (genre/style); `make_instrumental` (bool) | job → audio URL(s) |
| `muapi_audio_from_text` | MMAudio SFX/ambience | `prompt` (req); `duration` (number, default 10) | job → audio URL |

### Enhance / edit

| Tool | Purpose | Key parameters |
|---|---|---|
| `muapi_enhance_upscale` | AI super-resolution | `image_url` (req) |
| `muapi_enhance_bg_remove` | Background removal | `image_url` (req) |
| `muapi_enhance_face_swap` | Face swap, image or video | `source_url` (req, face); `target_url` (req, image/video); `mode` (`image`\|`video`, default `image`) |
| `muapi_enhance_ghibli` | Ghibli style transfer | `image_url` (req) |
| `muapi_edit_lipsync` | Sync video lips to audio | `video_url` (req); `audio_url` (req); `model` (`sync`\|`latentsync`\|`creatify`\|`veed`\|`ltx-2`\|`ltx-2.3`\|`kling-v1`\|`kling-v2`\|`wan2.2`, default `sync`) |
| `muapi_edit_clipping` | AI highlight clips from long video | `video_url` (req); `num_highlights` (default 3); `aspect_ratio` (default `9:16`) |

### Async, files, workflows, account

| Tool | Purpose | Key parameters |
|---|---|---|
| `muapi_predict_result` | Poll any job | `request_id` (req) — returns `{status, outputs:[urls]}` when done |
| `muapi_upload_file` | Local file → hosted URL (**stdio only**) | `file_path` (req, absolute local path) |
| `muapi_workflow_list` | List saved workflows | — |
| `muapi_workflow_create` | AI-architect a multi-step workflow from text | `prompt` (req); `sync` (default true) |
| `muapi_workflow_get` | Workflow definition (nodes + connections) | `workflow_id` (req) |
| `muapi_workflow_execute` | Run workflow | `workflow_id` (req); `inputs` (`{node_id:{param:value}}`) — returns `run_id` |
| `muapi_workflow_status` | Node-by-node run status | `run_id` (req) |
| `muapi_workflow_outputs` | Final output URLs of a run | `run_id` (req) |
| `muapi_keys_list` | List account API keys | — |
| `muapi_keys_create` | Create key (raw key returned once) | `name` (default `cli`) — **deny-listed in generation** |
| `muapi_keys_delete` | Delete key | `key_id` (int, req) — **deny-listed in generation** |
| `muapi_account_balance` | Credit balance | — |
| `muapi_account_topup` | **Stripe checkout URL** for credits | `amount` (USD int, min 1, default 10); `currency` — **deny-listed in generation** |

Hosted MCP differs: docs describe 19 tools — the generation/enhance/edit/predict/account/keys set plus a hosted-only `search_models`, minus `muapi_upload_file` and minus workflows [docs]. The docs/mcp page also claims five `muapi_social_*` publishing tools in the stdio build; **live 0.2.7 does not expose them** — it ships the six workflow tools instead [verified].

## Models

Live catalog: **591 models**, enumerable without auth at `GET https://api.muapi.ai/api/v1/models` (name, description, USD cost, `dynamic_pricing` flag, endpoint, per-model `/estimate-cost` endpoint) [verified 2026-08-09]. Category counts: Text-to-Video 99, Image-to-Video 157, Text-to-Image 68, Image-to-Image 69, Video-to-Video 69, Text-to-Audio 17, Audio-to-Video 13, 3D 8, Training 12, LoRA Support 13, Text-to-Text 44, other/tools 22.

MCP tool enums use short aliases (`seedance-2`, `veo3.1`, `kling-master`); the CLI maps them onto the REST endpoints below. **The authoritative enum lists live in `userData/connector-tools/muapi.json`** (recorded by `LYME_PROBE_CONNECTOR=muapi`, 2026-08-30): `muapi_video_generate` = 64 models (default `kling-master` — the EXPENSIVE tier), `muapi_video_from_image` = 82 (default `kling-std`), `muapi_edit_lipsync` = 9 engines (default `sync`). Aliases are hyphenated throughout — `seedance-2`, `seedance-2-fast`, `seedance-2-vip`; there is NO `seedance-2-mini` alias in the MCP enum (an earlier agent-reported "closest match" `seedance_2_0_mini` was wrong — 2.0 Mini is REST-only). Trust the recorded schema, not agent paraphrase. Listed costs are the live base price per generation (dynamic ones scale with duration/resolution). Cost tiers: $ <0.10 · $$ 0.10–0.50 · $$$ 0.50–1.50 · $$$$ >1.50.

### Seedance (ByteDance) — [verified, live catalog]

| Model / endpoint stem | Modes | Capabilities | Base cost |
|---|---|---|---|
| `seedance-lite-*` (v1) | t2v, i2v, reference-video | Lite reference mode blends **up to 4 reference images**; fast/cheap | $0.10 ($) |
| `seedance-pro-*` (v1) | t2v, i2v (+`-fast`) | 3–12 s clips; `-fast` variants are the cheapest usable i2v on the platform | $0.18; fast $0.06 ($) |
| `seedance-v1.5-pro-*` | t2v, i2v, **video-extend** (+`-fast`) | Extends existing footage with style/motion continuity | $0.34; fast $0.26 ($$) |
| `seedance-2-mini-*` (2.0 Mini) | t2v, i2v, omni-reference, spicy | 720p, ~2× faster than 2.0 Fast; cheapest Seedance 2 tier | $0.15–0.20 ($$) |
| `seedance-2-*` (2.0, family `sd-v2.0`) | t2v, i2v (720p/480p), omni-reference, video-edit, **extend** (by original request_id), character training | Native audio-video sync; omni reference: **up to 9 images + 3 video clips + 3 audio**, `@image1`/`@video1`/`@audio1` prompt syntax; trainable reusable characters (`@omni-character:<request_id>`) | $0.60–1.50 ($$$) |
| `seedance-2-*` Pro/Fast/VIP (family `sd-2`) | t2v, i2v, **first-last-frame** (1 img = start only, 2 = start+end), omni-reference; VIP adds 1080p/4K + priority queue; Spicy = reduced safety filtering | 4–15 s; up to 2K native; VIP 1080p $3.375, 4K $6.75 | Pro $1.25, Fast $0.75, VIP $1.50/$1.05, Spicy $1.05–1.50 ($$$–$$$$) |
| `seedance-2.1-*` | t2v, i2v | Up to 1080p, fixed price | $0.40 fixed ($$) |
| `seedance-2.5-*` (early-access preview; also `-intl` region twins) | t2v→n/a, i2v, first-last-frame, omni-reference | **Up to 30 s clips**; native 480p/720p only — the "1080p"/"4K" tiers are upscales of the 720p render | 480p $0.85, 720p $1.70, 1080p $4.25, 4K $8.50 ($$$–$$$$) |

### Kling (Kuaishou) — [verified, live catalog]

| Model | Modes | Capabilities | Base cost |
|---|---|---|---|
| `kling-v2.1-standard/pro/master` | i2v (all), t2v (master) | The `kling-master` MCP default lives here | i2v $0.225–0.40; master t2v $1.20 |
| `kling-v2.5-turbo-std/pro` | t2v, i2v | Strong motion/prompt precision at mid price | $0.28 / $0.45 ($$) |
| `kling-v2.6-pro` | t2v, i2v, **motion-control** (v2v) | Explicit camera-path control (pan/tilt/orbit/dolly) | $0.90; motion-control $0.145 ($$$) |
| `kling-v3.0-standard/pro` | t2v, i2v, motion-control | Realism + temporal consistency | $0.72 ($$$) |
| `kling-v3-turbo-standard/pro` | t2v, i2v | 720p / 1080p, **3–15 s** durations | $0.56 / $0.70 ($$$) |
| `kling-v3.0-4k` | t2v, i2v | Native 3840×2160 | $2.00 ($$$$) |
| `kling-v3.0-omni-standard/pro/4k` | t2v, i2v | **Multi-image reference (up to 4)** with `<<<image_N>>>` prompt syntax; 720p/$0.42, 1080p/$0.56, 4K/$2.68; "Apimart-backed" third-party relay | $$–$$$$ |
| `kling-o1` (+`-standard`) | t2v, i2v, reference-to-video, video-edit (+fast), t2i, image-edit | Unified multimodal engine; **i2v supports start/end frames**; reference-to-video from multiple images | video $0.50–0.72; edit $0.585–1.09 ($$$) |
| `kling-o3-image` / `-image-edit` | t2i, i2i | 1K/2K/4K, up to 9 outputs, up to 10 reference images (edit) | $0.027 ($) |
| `kling-v1/v2-avatar-*` | audio-to-video | Talking-avatar from image + audio | $0.35–0.75 |

### Veo (Google) — [verified, live catalog]

| Model | Modes | Capabilities | Base cost |
|---|---|---|---|
| `veo3` / `veo3-fast` | t2v, i2v | Photoreal + native audio | $2.50 / $0.60 |
| `veo3.1` / `-fast` / `-lite` | t2v, i2v | 8 s clips; lite is the budget tier | $2.50 / $0.60 / $0.30 |
| `veo3.1-reference-to-video` | ref→video | **Up to 3 reference images**, character/style consistency | $0.60 ($$$) |
| `veo3.1-extend-video` | extend | Continues an existing Veo 3.1 clip | $0.60 |
| `veo3.1-4k-video` | post-upgrade | Re-renders an existing veo3.1 task ID at 4K | $0.60 |
| `veo-4` | t2v, i2v | Up to 1080p, fine camera control | $3.00 ($$$$) |

No first/last-frame Veo endpoint exists in the live catalog — start+end-frame Veo conditioning in Lyme Hype goes through `resources/gemini-mcp.cjs` instead [verified].

### Sora (OpenAI) — [verified, live catalog]

| Model | Modes | Capabilities | Base cost |
|---|---|---|---|
| `openai-sora` | t2v | Legacy Sora 1 | $0.50 |
| `openai-sora-2` | t2v, i2v | 10 s clips with synchronized audio; **i2v rejects realistic human portraits** (launch policy) | $0.80 ($$$) |
| `openai-sora-2-pro` | t2v, i2v | High-fidelity tier | $2.40 ($$$$) |
| `openai-sora-2-pro-storyboard` | multi-scene t2v | Chained storyboard "cards" per scene | $0.58 |
| `openai-sora-2-pro-characters` | helper | Persistent character from a prior video task ID | $0.10 |

### Other video families worth routing to — [verified, live catalog]

- **Vidu**: `vidu-q2-start-end` (explicit start+end-frame), `vidu-q1-ref`/`vidu-q2-ref` (reference images), `vidu-q3-flf` (first-last-frame), q2/q3 pro & turbo tiers — the cheap route to frame conditioning.
- **Wan 2.1–3.0**: t2v/i2v, `wan2.2-spicy`, `-ref` reference variants, `wan-effects`.
- **Pixverse v4.5–v6** (incl. `-trans` transitions), **Hunyuan** (+fast), **Runway** (+`runway-act-two` performance transfer), **Minimax/Hailuo** (02, 2.3 std/pro/fast, 2.6, h3), **LTX-2/2.3** (also lipsync engines), `ovi`, `grok` video, `happy-horse` (+720/ref), `infinitetalk` (talking-portrait from image + script), `video-effects`.
- **Lipsync engines** (via `muapi_edit_lipsync` or REST): sync, latentsync, creatify ($0.04 base), veed, ltx-2/2.3, kling-v1/v2, wan2.2, volcengine, omnihuman.

### Images — [verified, live catalog]

| Family | Notables | Cost range |
|---|---|---|
| Midjourney | `midjourney-v7`, `midjourney-v8`, `midjourney-niji` — each returns **4 images per run**; reference-image guidance via `source_image_url`; aspect_ratio param. No upscale/variation/pan endpoints — batch-only. | $0.10 |
| Flux (BFL) | `flux-schnell` $0.003 → `flux-dev`/`flux-krea` $0.015 → kontext dev/pro/max t2i+i2i $0.02–0.06 → Flux 2 dev/pro/flex/klein-4b/9b (+turbo, +edit) $0.005–0.09 → **Flux 3** t2i $0.05 / i2i $0.06, plus `flux-3-text-to-video`/`image-to-video` $0.35 fixed; `flux-pulid` (face consistency), `flux-redux`. LoRA: `flux-dev-lora` use, `flux-lora-trainer` $3.20, Flux-2 klein style-LoRA trainers $4–4.50, klein LoRA inference $0.02–0.03. | $–$$ |
| nano-banana (Google) | `nano-banana` $0.03, `nano-banana-2`(-lite) $0.03–0.06, `nano-banana-pro` $0.12, each with `-edit`; `nano-banana-effects`. | $ |
| Imagen 4 | `google-imagen4-fast/`(std)`/-ultra` | $0.02/$0.03/$0.06 |
| Seedream (ByteDance) | v3/v4/v4.5/5.0-lite/5.0-pro + `-edit` twins; `bytedance-seededit-v3` masked edits; `seedance-character` (reusable video characters, beta) | $0.03–0.05 |
| GPT images | `gpt4o-*` $0.04, `gpt-image-1.5` $0.054, `gpt-image-2` $0.09 (up to 16 input images on edit, 20k-char prompts) | $–$ |
| Others | ideogram (+character/reframe), reve, qwen/qwen2 (+LoRA), z-image(-turbo), leonardo lucid/phoenix, grok, chroma, sdxl, hidream fast/dev/full, kling-o1/o3 images | $ |

### Audio — [verified, live catalog]

| Endpoint | Purpose | Cost |
|---|---|---|
| `suno-create-music` | Full songs (vocals + lyrics + instrumentation) from prompt; MCP params: prompt/title/tags/make_instrumental; Suno V5 per docs/models page | $0.09 |
| `suno-extend-music` / `suno-remix-music` | Extend a track / restyle keeping melody — both accept uploaded audio | $0.09 |
| `suno-generate-mashup` | Mashup of 1–5 tracks | $0.09 |
| `suno-add-vocals` / `suno-add-instrumental` | Complete an acapella or instrumental | $0.09 |
| `suno-generate-lyrics` / `suno-boost-music-style` | Lyrics / style-prompt helpers | $0.003 |
| `suno-convert-to-wav` | Uncompressed WAV of a prior generation (needs task_id + audio_id) | $0.01 |
| `suno-voice-clone` | Singing-voice clone: 10 s sample + read-back of a random phrase (anti-deepfake liveness check) → reusable voice_id | $0 |
| `suno-generate-sounds` | SFX via Suno chirp-crow | $0.02 |
| `mmaudio-v2-text-to-audio` / `-video-to-video` | SFX/speech from text; audio synced to video motion | $0.01 |

Also reachable: 3D (meshy, tripo3d, hunyuan), whisper STT, gemini-tts, LLM passthrough (gpt-5.x, grok, qwen3 — many $0), moderation, OCR, watermark removal, social-scraper, video-download utilities.

## Result handling

- **Everything media is async job-ID-poll.** Submit returns `{"request_id":"...","status":"processing"}` (plus a `cost` object) [verified]. Poll:
  - MCP: `muapi_predict_result {request_id}` → `{"status":"completed","outputs":["https://cdn.muapi.ai/…"]}` [verified].
  - REST: `GET /api/v1/predictions/{request_id}/result` with `x-api-key` [docs]. Status values: `queued`, `pending`, `processing`, `completed`, `failed` (+ `cancelled`) [docs].
- Outputs are **hosted URLs** (cdn.muapi.ai / S3), never base64 or inline files. Result-URL retention is **undocumented**, and upload presigned URLs expire after 1 hour — so Lyme Hype downloads every output into the asset store (`asset-store.ts` → `userData/assets`, served as `lyme-asset://`) immediately on completion rather than hot-linking [verified, in-app].
- Local inputs (start frames, reference images, audio) go up via `muapi_upload_file` (stdio-only; images ≤10 MB jpg/png/webp, videos ≤50 MB mp4/mov, other ≤10 MB) → hosted URL to pass as `image_url` etc. Upload itself is free but the account balance must be **> 0** [docs].
- Every response carries actual charges: body `cost` + headers `X-MuAPI-Cost-USD`, `X-MuAPI-Cost-Credits`, `X-Account-Balance` [docs]. Webhooks exist (`/docs/webhooks`) as a polling alternative [docs, not used by Lyme Hype].

## Pricing & limits

- Pay-as-you-go credits, no subscription; credits never expire; Stripe top-up (min $1) [docs].
- Per-model USD base prices are live and unauthenticated at `GET /api/v1/models`; dynamic-priced models also expose `/api/v1/models/{name}/estimate-cost` [verified]. Prefer the live feed — the docs' example prices drift (docs say flux-dev $0.025; live catalog says $0.015).
- Practical video ladder (base price per clip): seedance-pro-fast $0.06 → seedance-2-mini $0.20 → kling-v2.5-turbo $0.28–0.45 → kling-v3/seedance-2 $0.56–0.75 → sora-2 $0.80 → seedance-2-pro/kling-master $1.20–1.50 → veo3/veo3.1/sora-2-pro $2.40–2.50 → veo4 $3.00 → 4K tiers $2.00–8.50.
- Rate limits and concurrency caps: not documented anywhere found [docs gap].
- Enterprise/volume: support@vadoo.tv [docs].

## Gotchas

- **Three different auth carriages**: REST = `x-api-key` header; hosted MCP = `Authorization: Bearer`; stdio MCP = `MUAPI_API_KEY` env [verified]. Wiring the wrong one gives 401s that look like a bad key.
- **`muapi_video_from_image` breaks on Seedance V1 models specifically** [verified live +
  docs 2026-08-30]: `seedance-pro-fast` and `seedance-lite` i2v both fail with the server
  demanding `"image_url Field required"` while the CLI submits `images_list`. Root cause
  is muapi-cli's per-model payload mapping: muapi's own docs show the **Seedance 2.x**
  i2v endpoints (`seedance-v2.0-i2v`, 2.5) take `images_list`, while the older V1
  endpoints take `image_url` — the CLI apparently reuses the 2.x-style builder for V1
  models. NOT a Lyme Hype issue: the identical call path passes with `kling-std`
  (upload → hosted URL → image_url arg → dwarf animated, $0.26). The Seedance 2 family
  (`seedance_2_0_mini` — underscores) is a valid enum id but **plan-gated**: Higgsfield
  rejects with "account requires basic plan or higher" on this account [verified live
  2026-08-30]. Practical i2v rule on the current account: **kling-*** (verified working)
  or Veo via gemini; Seedance V1 i2v is upstream-broken via MCP, Seedance 2 i2v needs a
  muapi plan upgrade. V1 t2v stays fine and cheapest. The CLI ships as a compiled binary
  (npm tarball is an installer), so the payload fix belongs upstream.
- **The MCP video tools cannot do end-frame conditioning.** `muapi_video_from_image` takes exactly one `image_url`, yet its model enum lists first-last-frame models (`seedance-2-flf`, `vidu-q2-start-end`, `vidu-q3-flf`). Start+end-frame, multi-reference (`@image1…@image9`, `<<<image_N>>>`), and omni-reference generation are **REST-only** — the 25 MCP tools have no parameters for them [verified, live schema]. Route frame-conditioned work to the Gemini connector or call muapi REST directly.
- MCP tools also expose **no resolution parameter** — resolution is chosen by model variant (`…-480p`, `…-1080p`, `…-4k`), not an argument [verified].
- **docs/mcp is stale vs the shipped CLI**: it claims `muapi_social_*` publishing tools (stdio) and `search_models`; live 0.2.7 has neither — it ships six `muapi_workflow_*` tools the docs page doesn't mention [verified 2026-08-09].
- `muapi_account_topup` returns a live **Stripe checkout URL**; `muapi_keys_create` returns a raw secret. Lyme Hype deny-lists all three account-mutating tools during generation [verified, in-app].
- **Seedance 2.5 "1080p"/"4K" are upscales of a native 720p render**, at 2.5–5× the 720p price — the catalog says so itself. Native 1080p exists on Seedance 2 VIP; native 4K on Seedance 2 VIP and Kling 3.0 4K [verified].
- Midjourney here is generation-only: 4 images per run, reference guidance via `source_image_url` — **no upscale/variation/pan/describe job control** exists in the catalog [verified].
- "Spicy" Seedance tiers advertise *reduced content-safety filtering* — treat outputs accordingly [verified, catalog descriptions].
- **Chinese-native prompting (2026-08-30):** Seedance/Seedream, Kling, Wan, MiniMax/Hailuo,
  Vidu, PixVerse are Chinese-origin and follow Chinese prompts better. Lyme Hype's
  generation agent auto-translates the prompt into Simplified Chinese for these families
  (`promptLanguageFor()` in `model-catalog.ts` — catalog tag + family-pattern fallback)
  and reports back in English. Users always write English. **BUT muapi-cli rejects any
  non-ASCII prompt** (UTF-8 surrogate encoding error, verified live 2026-08-30) — so via
  the MCP connector the Chinese prompt bounces and the agent falls back to English (one
  retry, built into the generation brief). Chinese prompting works fully on connectors
  whose transport is UTF-8-clean (the local comfyui wrapper included); for muapi it's
  blocked upstream until the CLI fixes its encoding.
- Sora 2 i2v **rejects realistic human portraits** (launch policy) — use objects/scenes/stylized characters [verified, catalog description].
- Some flagship-looking entries are third-party relays, e.g. Kling v3 Omni is "Apimart-backed" [verified, catalog description]. Vendor identity generally: muapi is operated by SamurAIGPT/Vadoo (GitHub `SamurAIGPT/muapi-cli`, enterprise contact support@vadoo.tv) — not by any model lab.
- Face swap **does exist** (`muapi_enhance_face_swap`, image and video modes) despite the docs index not advertising it [verified, live schema].
- Sandbox keys return mock data instantly and free — use one for plumbing tests before spending credits [docs].
- Result-URL lifetime is undocumented; presigned upload URLs die in 1 hour. Always ingest outputs immediately [docs + in-app policy].

## Sources

- Live schema enumeration: `npx -y muapi-cli mcp serve` (muapi-cli@0.2.7), MCP `tools/list`, 2026-08-09 — 25 tools, full input schemas and model enums.
- Live probe: `GET https://api.muapi.ai/api/v1/models` (unauthenticated), 2026-08-09 — 591 models with USD pricing, endpoints, descriptions.
- <https://muapi.ai/docs> · <https://muapi.ai/docs/mcp> · <https://muapi.ai/docs/cli> · <https://muapi.ai/docs/authentication> · <https://muapi.ai/docs/api-reference> · <https://muapi.ai/docs/pricing> · <https://muapi.ai/docs/models> · <https://muapi.ai/docs/file-upload> · <https://muapi.ai/docs/music-and-speech>
- <https://github.com/SamurAIGPT/muapi-cli>
- Prior in-project verification: `src/main/connector-suggestions.ts`, generation deny-list in `src/main/generation.ts`, hosted-MCP Bearer probe.
