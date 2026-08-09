# fal (fal.ai) — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

- **General model catalog** over hosted MCP — direct Seedance, Kling, WAN, Veo 3.1, Pixverse, Hailuo and ~1,000 other endpoints behind one connector. Deliberately redundant with muapi; tier routing decides which fires.
- **LoRA training home** — `fal-ai/krea-2-trainer` and `fal-ai/flux-krea-trainer` called via direct REST queue from `src/main/fal-training.ts` (the one deliberate non-MCP exception in the app).
- **Trained-LoRA inference pairings** — `fal-ai/krea-2/turbo/lora` (Krea 2 LoRA) and `fal-ai/flux-krea-lora` (`loras` param takes the trainer's safetensors URL).

## Connection

- **Hosted MCP**: `https://mcp.fal.ai/mcp`, Streamable HTTP transport, plain `Authorization: Bearer <FAL_KEY>` [verified]. Stateless (Vercel-hosted); key sent per-request, never stored server-side [docs]. No OAuth support on this server [docs].
- **REST queue** (used by `fal-training.ts`): `POST https://queue.fal.run/<model-id>` with `Authorization: Key <FAL_KEY>`; status at `…/requests/{request_id}/status`, result at `…/requests/{request_id}` [verified].
- **Storage upload**: `POST https://rest.alpha.fal.ai/storage/upload/initiate` (Key auth) → `{upload_url, file_url}`; PUT the bytes to `upload_url`, pass `file_url` as model input [verified].
- **Key page**: https://fal.ai/dashboard/keys (one FAL_KEY works for MCP, queue, and storage).
- **Install shape** (`connector-suggestions.ts`) [verified]:
  `{ id: 'fal', name: 'fal', kind: 'http', url: 'https://mcp.fal.ai/mcp', authType: 'bearer', secretKey: 'Authorization', secretFieldLabel: 'fal API key', docUrl: 'https://fal.ai/dashboard/keys' }`
- **Auth scheme split**: MCP wants `Bearer <key>`, raw REST wants `Key <key>` — same key string, different prefix. `fal-training.ts` normalizes (`Key ` prefix, strips accidental `Bearer`) [verified].

## Tool surface

9 tools on the hosted MCP server [verified count; names/behavior per official MCP docs]:

| Tool | Purpose | Key parameters | Returns | Sync? |
|---|---|---|---|---|
| `search_models` | Search the ~1,000-model catalog | `query?: string`, `category?: string` (`text-to-image`, `image-to-video`, `text-to-video`, `text-to-speech`, `image-to-3d`, `image-editing`, `llm`, …), `limit?: number` (default 20, max 100) | `{models: [{endpoint_id, name, category, description}], total_shown, has_more}` | sync |
| `get_model_schema` | Full input/output JSON schema for a model | `endpoint_id: string` | JSONSchema of Input/Output | sync |
| `get_pricing` | Cost of a model before running it | `endpoint_id: string` | per-unit price info | sync |
| `search_docs` | Search fal documentation | `query: string` | doc excerpts/links | sync |
| `run_model` | Submit to queue, poll internally, return result | `endpoint_id: string`, `input: object` | model output JSON (CDN file URLs) | blocks until done — docs say use `submit_job` for video/3D/training to avoid client timeouts |
| `submit_job` | Fire-and-forget submit | `endpoint_id`, `input` | `request_id` immediately | async (job-id) |
| `check_job` | Status / result / **cancel** of a job | `endpoint_id`, `request_id`, `action?: "status"` (default) \| `"result"` \| `"cancel"` | status or result JSON | poll |
| `upload_file` | Put a file on the fal CDN for use as model input | `url: string` (remote file URL), `file_name?: string` | `cdn_url` | sync |
| `recommend_model` | Task description → ranked model recommendations | `task: string` | ranked list with usage tips | sync |

Notes:
- There is **no `cancel_job` tool** — cancel is `check_job` with `action: "cancel"` [docs; corrects the earlier `cancel_job?` guess from the live probe].
- Hosted `upload_file` only accepts a **URL** (the server is stateless and can't see local disks). Local files — e.g. training-image zips — go through the REST storage initiate flow instead, which is exactly what `fal-training.ts` does [verified].

## Models

Live catalog enumeration 2026-08-09 via `https://fal.ai/api/models` (the same index `search_models` serves). `keywords=video` alone matches 634 endpoints; below is the reels-relevant cut. Cost tier: $ ≈ ≤$0.05/s or ≤$0.05/img · $$ ≈ $0.05–0.15/s · $$$ ≈ $0.15–0.50/s · $$$$ above that.

### Video — Seedance (ByteDance)

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `bytedance/seedance-2.5/image-to-video` [verified schema] | i2v | 480p/720p, **4–30 s**, native audio (default on), `end_image_url` last-frame conditioning | $$$ ($0.221/s 480p, $0.473/s 720p) |
| `bytedance/seedance-2.5/text-to-video` / `reference-to-video` | t2v / ref2v | ref2v takes up to 50 multimodal refs (images/video/audio/style), locks character+set across a 30 s take | $$$ (token-priced: $0.0214/1k tokens; ×0.6 with video inputs) |
| `bytedance/seedance-2.0/image-to-video` [verified schema] | i2v | 480p/720p/1080p/**4k**, 4–15 s, `end_image_url`, audio, aspect incl. 9:16 | $$$ ($0.3034/s 720p, $0.682/s 1080p) |
| `bytedance/seedance-2.0/fast/*` (t2v/i2v/ref2v) | all | same family, faster | $$ ($0.2419/s 720p) |
| `bytedance/seedance-2.0/mini/*` (t2v/i2v/ref2v) | all | budget tier | $$ ($0.0721/s 480p, $0.1547/s 720p) |
| `fal-ai/bytedance/seedance/v1.5/pro/{text,image}-to-video` | t2v/i2v | audio; ~$0.26 per 720p 5 s | $ |
| `fal-ai/bytedance/seedance/v1/pro[/fast]/{text,image}-to-video` | t2v/i2v | 1080p 5 s ≈ $0.62 (pro) / $0.24 (fast) | $–$$ |

### Video — Kling (Kuaishou)

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `fal-ai/kling-video/v3/pro/image-to-video` [verified schema] | i2v | `start_image_url` + `end_image_url`, 3–15 s, native audio (EN/CN voice), `multi_prompt` multi-shot, `elements` (character/object refs: frontal + 1–3 angle images, optional voice binding per element) | $$ ($0.112/s audio-off, $0.168/s audio-on) |
| `fal-ai/kling-video/v3/standard/{text,image}-to-video` | t2v/i2v | as above, cheaper | $$ ($0.084/$0.126 per s) |
| `fal-ai/kling-video/v3/turbo/{pro,standard}/{text,image}-to-video` | t2v/i2v | newest turbo line (2026-06) | $$ ($0.14/s pro, $0.112/s standard) |
| `fal-ai/kling-video/v3/4k/*` and `o3/4k/*` (t2v/i2v/ref2v) | all | 4K output | $$$$ ($0.42/s) |
| `fal-ai/kling-video/o3/{pro,standard}/…` incl. `reference-to-video`, `video-to-video/edit`, `video-to-video/reference` | ref2v, v2v | O3 line adds video editing + reference-driven v2v | $$ ($0.084–0.168/s) |
| `fal-ai/kling-video/v2.6/pro/{text,image}-to-video` | t2v/i2v | $0.07/s silent, $0.14/s native audio | $$ |
| `fal-ai/kling-video/v2.5-turbo/pro/{text,image}-to-video`, `v2.5-turbo/standard/image-to-video` | t2v/i2v | 5 s = $0.35 (pro) / $0.21 (std) | $$ |
| `fal-ai/kling-video/v3/{pro,standard}/motion-control` | v2v | motion transfer | n/a |
| `fal-ai/kling-video/lipsync/{audio,text}-to-video`, `ai-avatar/v2/{pro,standard}` | lipsync/avatar | $0.014 per input-video-second (lipsync) | $ |
| `fal-ai/kling-image/{v3,o3}/{text-to-image,image-to-image}` | image | $0.028/img 1K–2K (o3) | $ |

### Video — WAN (Alibaba)

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `fal-ai/wan/v2.7/image-to-video` [verified schema] | i2v | 720p/1080p, 2–15 s, `end_image_url` (FLF), `video_url` continue-from-clip (2–10 s), `audio_url` driving audio (2–30 s), prompt expansion | $$ ($0.10/s 720p, $0.15/s 1080p) |
| `fal-ai/wan/v2.7/{text,reference}-to-video`, `edit-video`, `text-to-image`, `edit` | all | reference-to-video bills input+output duration | $$ |
| `wan/v2.6/{text,image}-to-video[/flash]`, `reference-to-video` | t2v/i2v/ref2v | flash i2v is half price ($0.05/s 720p) | $–$$ |
| `fal-ai/wan-25-preview/{text,image}-to-video` | t2v/i2v | 480p $0.05/s · 720p $0.10/s | $–$$ |
| `fal-ai/krea-wan-14b/{text-to-video,video-to-video}` | t2v/v2v | Krea-tuned WAN, $0.025/output-second (16 fps) | $ |
| `fal-ai/wan-flf2v` | i2v | legacy dedicated first-last-frame endpoint | $ |
| `fal-ai/wan/v2.2-14b/animate/{replace,move}`, `wan-vace-apps/*` | v2v | character replace/animate, reframe, video edit | $–$$ |

### Video — Veo 3.1 (Google, resold on fal)

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `fal-ai/veo3.1` / `image-to-video` [verified schema] | t2v/i2v | 4s/6s/8s only, 720p/1080p/4k, aspect **16:9 or 9:16 only**, audio toggle | $$$ ($0.20/s silent, $0.40/s audio) |
| `fal-ai/veo3.1/first-last-frame-to-video`, `reference-to-video`, `extend-video` | FLF/ref2v/extend | frame conditioning + extension | $$$ |
| `fal-ai/veo3.1/fast/*` (same five shapes) | all | $0.10/s silent, $0.15/s audio | $$ |
| `fal-ai/veo3.1/lite[/image-to-video,/first-last-frame-to-video]` | t2v/i2v/FLF | $0.03–0.05/s 720p | $ |

### Video — other headline families

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `minimax/h3/{text,image,reference}-to-video` [verified schema] | t2v/i2v/ref2v | 768P/2K/4K, `end_image_url` keyframe | $$ ($0.08/s 768p → $0.16/s 4K) |
| `fal-ai/minimax/hailuo-2.3[-fast]/{standard,pro}/{text,image}-to-video` | t2v/i2v | 6 s / 10 s clips | $–$$ ($0.19–0.49/clip) |
| `xai/grok-imagine-video/v1.5/{text,image,reference}-to-video` | t2v/i2v/ref2v | 480p/720p/1080p; also `edit-video`, `extend-video` | $$ ($0.08–0.25/s) |
| `blackforestlabs/flux-3/{text,image}-to-video`, `first-last-frame-to-video`, `keyframes-to-video`, `extend-video` | t2v/i2v/FLF/keyframes | FLUX 3 does video now; `/draft` variants at ~⅓ price + `draft-enhance` upgrade pass | $$ ($0.17/s 720p; draft $0.06/s) |
| `fal-ai/pixverse/{c1,v6,v5.6,v5.5,v5,v4.5}/{text,image}-to-video`, `transition` | t2v/i2v/**transition** = first→last frame | 360p–1080p, effects, extend, swap | $ (c1: $0.030/s 360p; 5 s 720p ≈ $0.20–0.45) |
| `fal-ai/vidu/q3/{text,image}-to-video[/turbo]`, `q2/*`, `q1/start-end-to-video` | t2v/i2v/start-end | turbo $0.035/s low-res | $–$$ |
| `luma/agent/ray/v3.2/{text,image}-to-video`, `reframe`, `video-to-video` | t2v/i2v/v2v | 540p–1080p | $$–$$$$ (i2v 5 s: $0.15–1.20) |
| `moonvalley/marey/{t2v,i2v}`, `motion-transfer`, `pose-transfer` | t2v/i2v/v2v | cinematic; flat per-video pricing | $$$$ ($1.50/5 s, $3/10 s) |
| `fal-ai/hunyuan-video-v1.5/{text,image}-to-video` | t2v/i2v | ~$0.075/s | $$ |
| `fal-ai/ltx-2.3[-quality]/*` (116 endpoints) | mostly v2v utility | extend, inpaint, outpaint, reframe, deblur, colorize, day-to-night, render-to-real …, most with `/lora` variants | $ (~$0.0024/megapixel of video data) |
| `decart/lucy-edit/pro`, `lucy-restyle` | v2v | instruction-based video editing | $$ ($0.10–0.15/s) |
| `fal-ai/sync-lipsync/v3[/image-to-video]`, `veed/lipsync/v2`, `fal-ai/pixverse/lipsync` | lipsync | audio-driven mouth sync | $ |
| `fal-ai/kling-video/video-to-audio`, `fal-ai/hunyuan-video-foley` | video→audio | foley/soundtrack for silent clips | $ ($0.035/video Kling) |

### Image (for canvas stills / video start frames)

| Endpoint | Type | Capabilities | Cost |
|---|---|---|---|
| `fal-ai/nano-banana[/edit]` | t2i/i2i | Gemini 2.5 Flash Image resold | $ ($0.039/img) |
| `fal-ai/nano-banana-pro[/edit]` | t2i/i2i | = `fal-ai/gemini-3-pro-image-preview`, 4K out | $$ ($0.15/img) |
| `fal-ai/nano-banana-2[/edit]` | t2i/i2i | = `fal-ai/gemini-3.1-flash-image-preview`, 2K | $ ($0.08/img) |
| `bytedance/seedream/v5/{pro,lite}/{text-to-image,edit}` | t2i/i2i | pro ≈ $0.0675/img ≤1536²; also `layerize` (image → layers) | $ |
| `fal-ai/flux-2/*` (turbo/flash/max/klein 4b/9b, `/edit`, `/lora`) | t2i/i2i | current FLUX line; klein LoRA endpoints pair with flux-2 trainers | $ ($0.005–0.02/MP; max $0.07 first MP) |
| `fal-ai/flux-krea-lora[/image-to-image,/inpainting,/stream]` [verified schema] | t2i/i2i | **takes `loras: [{path, scale}]`** — pair with `fal-ai/flux-krea-trainer` output; `sync_mode` returns data URI | $ |
| `fal-ai/krea-2/turbo[/lora,/style]`, `krea/v2/{medium,large}/text-to-image` | t2i | `/lora` pairs with `fal-ai/krea-2-trainer` output | $ ($0.015–0.065/img) |
| `xai/grok-imagine-image[/quality][/edit]` | t2i/i2i | 1K–2K | $ ($0.02–0.07/img) |
| `openai/gpt-image-2[/edit]`, `fal-ai/gpt-image-1[-mini]` | t2i/i2i | OpenAI image models resold | $–$$ |
| `fal-ai/recraft/v4/*`, `ideogram/v4/*`, `fal-ai/hidream-o1-image`, `microsoft/mai-image-2.5`, `reve/2.1`, `fal-ai/qwen-image*` | t2i/i2i | breadth; vector output (recraft `text-to-vector`), typography (ideogram) | $ |

### Trainers (LoRA) — Lyme Hype's actual usage

| Endpoint | Base model | Input | Output | Cost |
|---|---|---|---|---|
| `fal-ai/krea-2-trainer` [verified schema] | Krea 2 | `images_data_url*` (zip of PNG/JPG/JPEG/WebP, optional per-image .txt captions), `trigger_phrase`, `auto_captioning: Off\|Object/Character\|Style\|Custom`, `steps` (default 100), `learning_rate` (default 5e-4), `resolution: 768\|1024`, `debug_dataset` | `lora_file` (safetensors URL), `config_file`, `prompt_enhancement_system_prompt`, `debug_dataset?` | $0.003/step, min 100 steps ($0.30 floor) |
| `fal-ai/flux-krea-trainer` [verified schema — **delisted from catalog search but live**] | FLUX.1 Krea [dev] | `images_data_url*` (zip, ≥4 images), `trigger_word`, `steps`, `is_style` (true disables masks/captions for style LoRAs), `create_masks` | `diffusers_lora_file` (safetensors URL), `config_file` | ~$2/run (scales with steps) |
| `fal-ai/flux-2-trainer-v2[/edit]`, `fal-ai/flux-2-klein-9b-base-trainer` | FLUX 2 | zip + steps | LoRA | $0.0043–0.0064/step |
| `fal-ai/wan-22-trainer/{t2v-a14b,i2v-a14b}` | WAN 2.2 **video** | zip + steps | video LoRA | $0.004–0.005/step (min 100) |
| `fal-ai/ltx23-video-trainer`, `fal-ai/ltx23-trainer-v2/{i2v,t2v,v2v,…}` (20+ task shapes) | LTX 2.3 video | zip + steps | video LoRA | $0.0024–0.0135/step |
| `fal-ai/qwen-image-2512-trainer`, `fal-ai/z-image-turbo-trainer-v2`, `ideogram/v4/trainer`, `fal-ai/flux-lora-fast-training` | various image | zip + steps | LoRA | $0.0015/step → $2/run |

### Audio (present, but ElevenLabs connector is Lyme Hype's primary)

`fal-ai/minimax-music/{v2.5,v2.6}` (music), `fal-ai/minimax/speech-2.8-{hd,turbo}` (TTS), `fal-ai/elevenlabs/tts/multilingual-v2` (ElevenLabs resold — don't use, we have it direct), `fal-ai/chatterbox/text-to-speech/multilingual`, `sonilo/v1.1/text-to-music`, `fal-ai/stable-audio-3-trainer` (audio LoRA), `nvidia/nemotron-asr-multilingual/asr` (speech-to-text — candidate for the not-yet-built subtitle STT connection).

## Result handling

- **Shape**: every model output is JSON whose media fields are File objects `{url, content_type, file_name, file_size}` hosted on the fal CDN — `https://v3b.fal.media/files/b/{prefix}/{filename}` (SDK falls back v3.fal.media → fal.media) [docs; matches the `lora_file`/`video` outputs in the verified schemas]. `run_model`/`check_job(result)` return this JSON as MCP text content — media is never inlined, **except** endpoints exposing `sync_mode: true` (e.g. `fal-ai/flux-krea-lora`), which return a data URI and skip CDN hosting [verified schema].
- **REST polling pattern** [verified in `fal-training.ts` + docs]: `POST queue.fal.run/{model}` → `{request_id, status_url, response_url, cancel_url}` → poll `…/requests/{id}/status` (`IN_QUEUE` with `queue_position` → `IN_PROGRESS` → `COMPLETED`; append `?logs=1` for runner logs) → `GET …/requests/{id}` for the result JSON. Webhooks available as an alternative to polling [docs].
- **Storage lifetime**: CDN media (outputs *and* uploaded inputs) kept **at least 7 days by default**; override per request with header `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": N | null}` (null = keep forever; same header takes `initial_acl`). Expired files are unrecoverable. Request payload JSON kept **30 days** (disable with `X-Fal-Store-IO: 0`). CDN URLs are **public by default** — anyone with the link [docs].
- **Lyme Hype ingestion**: `generation.ts` has the agent reply `RESULT_URL: <https url>`; the asset store downloads it into `userData/assets` and serves it as `lyme-asset://`. LoRA safetensors URLs from trainers are subject to the same 7-day default — download promptly, never treat a fal.media URL as permanent storage.

## Pricing & limits

- Prepaid credit balance; purchased credits expire **365 days** after purchase; free credits/coupons 1 week–1 year [docs]. Billing is per output unit — per second of video, per image/megapixel, per training step (see Models tables for exact rates, all pulled live 2026-08-09).
- **Concurrency**: every account has a global cap on simultaneous `IN_PROGRESS` requests — new accounts start at **2**, scaling automatically with credit purchases up to **40** self-serve (more via sales). Queued requests are never rejected; they wait and dispatch with backoff. Raw HTTP 429 (`concurrent_requests_limit`, header `X-Fal-needs-retry: 1`) means retry with backoff [docs]. Per-endpoint caps may exist on hot models.
- The MCP server itself is free and adds no rate limits beyond the account's concurrency [docs].
- Krea-2 training floor: 100 steps × $0.003 = **$0.30 minimum per run**; a serious run (1000 steps) is $3. flux-krea-trainer ≈ $2/run.

## Gotchas

- **Two auth prefixes, one key**: `Bearer` for MCP, `Key` for queue.fal.run / rest.alpha.fal.ai. Sending `Bearer` to the queue fails auth. `fal-training.ts` normalizes [verified].
- **`cancel_job` does not exist** — the earlier probe's guess was wrong; cancel is `check_job(action: "cancel")`, and the ninth tool is `recommend_model` [docs].
- **No OAuth on the MCP server** (as of 2026-08) — clients requiring OAuth (Claude Desktop / claude.ai custom connectors) can't connect; header-auth clients like Lyme Hype's `mcp-http.ts` are the supported path [docs].
- **`fal-ai/flux-krea-trainer` is delisted from the catalog** — `search_models` and fal.ai/models won't find it, but the endpoint is live (model page 200, OpenAPI schema still served, 2026-08-09) [verified]. Route by exact id; don't "fix" a search miss by switching trainers.
- **Not on fal, despite aggregator assumptions**: Midjourney, Suno, and Sora/sora-2 have zero endpoints (live catalog check 2026-08-09) — those remain muapi-only in our routing. OpenAI presence is images only (`gpt-image-1/2`) [verified].
- **"nano-banana" is Gemini resold**: `fal-ai/nano-banana-pro` ≡ `fal-ai/gemini-3-pro-image-preview` (same price, same model). We already have a direct Gemini connector — routing image work to fal's nano-banana just adds fal margin [verified].
- **`run_model` can time out on video/3D/training** — official docs say use `submit_job` + `check_job` for those; treat `run_model` as image-only in practice [docs].
- **Hosted `upload_file` takes URLs only** — it cannot read local paths (stateless server). Local assets must go up via the REST storage initiate flow first [docs/verified].
- **Namespaces are inconsistent**: 2026-era partner models drop the `fal-ai/` prefix (`bytedance/seedance-2.5/…`, `minimax/h3/…`, `xai/…`, `blackforestlabs/…`, `wan/v2.6/…`) while older ones keep it. Never guess an id — confirm via `search_models`/`get_model_schema` [verified].
- **Frame conditioning is everywhere now, under different names**: `end_image_url` (Seedance 2.x, Kling v3, WAN 2.7, MiniMax H3), dedicated `first-last-frame-to-video` endpoints (Veo 3.1, FLUX-3, legacy `wan-flf2v`), `transition` (Pixverse), `start-end-to-video` (Vidu), `keyframes-to-video` (FLUX-3, multi-frame). Check the schema rather than assuming a `first_frame/last_frame` pair [verified schemas].
- **Seedance 2.5 goes to 30 s and Kling v3 multi-shot to 15 s** — both exceed the old 5–10 s single-clip assumption; the Cut Room can receive much longer single generations than planned [verified schemas].
- **CDN URLs are public and expire (~7 days default)** — ingest into the asset store immediately; never persist a fal.media URL in a session as the only copy [docs].

## Sources

- Live catalog enumeration: `https://fal.ai/api/models?keywords=…&categories=…` (2026-08-09; 634 video-keyword endpoints, 53 trainers enumerated)
- Live OpenAPI schema enumeration: `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…` for `bytedance/seedance-2.0/image-to-video`, `bytedance/seedance-2.5/image-to-video`, `fal-ai/kling-video/v3/pro/image-to-video`, `fal-ai/wan/v2.7/image-to-video`, `fal-ai/veo3.1/image-to-video`, `minimax/h3/image-to-video`, `fal-ai/krea-2-trainer`, `fal-ai/flux-krea-trainer`, `fal-ai/flux-krea-lora` (2026-08-09)
- Live probe (prior project verification): `mcp.fal.ai/mcp` Streamable HTTP + Bearer auth, 9-tool listing
- https://fal.ai/docs/documentation/model-apis/mcp (MCP tool reference)
- https://fal.ai/docs/documentation/model-apis/inference/queue (queue lifecycle)
- https://fal.ai/docs/documentation/model-apis/media-expiration + `/fal-cdn` + `/faq` (retention, CDN, credits)
- https://fal.ai/docs/documentation/model-apis/concurrency-limits
- Repo ground truth: `F:\web-clients\joseph-sardella\lyme-hype\src\main\fal-training.ts`, `F:\web-clients\joseph-sardella\lyme-hype\src\main\connector-suggestions.ts`
