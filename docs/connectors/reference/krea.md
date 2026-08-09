# Krea — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

General-generation aggregator: image + video + 3D + enhancement across ~71 models over one key, via hosted MCP. It is **not** the LoRA-training path anymore — training moved to fal's Krea trainers (`fal-ai/krea-2-trainer`, user call 2026-08-09); `src/main/krea-training.ts` remains as the deliberate REST exception but is unrouted. Krea IS the routed connector when a trained Krea style is selected in Create › Generate image (`connectorId: 'krea'`), because only Krea 2 endpoints accept `styles:[{id,strength}]` [verified]. Per routing philosophy (catalog.md): aggregators cost more than going direct — use Krea for model breadth (3D, enhance, Krea 2 + styles), not as a default.

## Connection

- **MCP (how Lyme Hype connects):** `https://api.krea.ai/mcp`, Streamable HTTP; OAuth **or** Bearer token [verified].
- **REST base:** `https://api.krea.ai`, header `Authorization: Bearer <token>`, `Content-Type: application/json` [docs].
- **Key page:** `https://www.krea.ai/settings/api-tokens` (docs also reference `krea.ai/app/api/tokens`). Tokens are workspace-scoped, creatable by workspace **owners/admins only**, displayed once [docs].
- **Install shape** (`connector-suggestions.ts`, id `krea`): `{ kind: 'http', url: 'https://api.krea.ai/mcp', authType: 'bearer', secretKey: 'Authorization', secretFieldLabel: 'Krea API token', docUrl: 'https://www.krea.ai/settings/api-tokens' }`.
- **Billing split by auth method** [verified]: OAuth MCP sessions bill the selected workspace's **compute units** (a workspace picker runs at connect; the binding is permanent per session — reconnect to switch). Token sessions (MCP or REST) bill the workspace's separate **API USD balance**.

## Tool surface

Exactly seven MCP tools [verified] — no styles/training tools exist via MCP:

| Tool | Purpose | Key params | Returns | Sync? |
|---|---|---|---|---|
| `list_models` | Enumerate reachable models | none | Model ids matching REST paths (e.g. `image/krea/krea-2/medium`); ~71 models [verified] | sync |
| `get_model_schema` | Inspect a model's input schema before generating | model id (string) | JSON schema of that model's params | sync |
| `generate` | Submit a generation job | model id + model-specific params per its schema | job payload with `job_id`; async default, sync mode available [docs] | job-id-poll |
| `execute_node_app` | Run a saved node-app workflow by version id | node-app version id + inputs | job payload with `job_id` | job-id-poll |
| `get_job` | Poll status / fetch outputs | `jobId` | Job object incl. `status`, `result` | sync |
| `cancel_job` | Kill an in-flight job (unbilled) | job id | `{ job_id, deleted: true }`; non-terminal jobs only | sync |
| `get_upload_url` | Presigned upload for local files | none (workspace from session) | Presigned URL valid **3 hours** [docs]; POST `multipart/form-data`, single `file` field → asset URL usable in generation params | sync |

REST-only surfaces (not reachable through MCP):

- `POST /styles/train` [verified] — `{name, urls[], model, type?, trigger_word?, max_train_steps 1–2000}` → `{job_id}`. `model`: Flux family `flux_dev`/`flux_schnell` (these also take `learning_rate`, `batch_size`) or Krea family `qwen`/`z-image`/`k2`/`k2-large` [docs]. `type`: Style/Object/Character/Default. Completed job's `result` carries `style_id` [docs].
- Styles CRUD: search / get by id / update / remove / `GET /styles/{id}/share-link` / `POST /styles/{id}/share/workspace` [docs].
- `POST /assets` (multipart, 75 MB max; JPEG/PNG/WebP/HEIC/MP4/MOV/WebM/GLB/WAV/MP3) + get/list/delete assets [docs].
- `GET /jobs/{id}` [verified], list jobs (paginated, filterable), delete job [docs].
- `POST /export/3d` — `{job_id, file_format: OBJ|FBX|STL|PLY, node_app_key?}` → `{url}` (zip). 409 if the job isn't finished [docs].
- Node apps: list runnable apps / versions, get app by version id (input/output schemas) [docs].

## Models

~71 models via live `list_models` [verified]; the API reference enumerates ~80 model endpoints as of 2026-08-09 [docs] — the catalog changes weekly, trust the live enum over any static list. Model id = REST path segment (`<family>/<provider>/<model>`).

**Family coverage of `generate`: image, video, 3D, image-enhance, video-enhance.** No audio generation of any kind (see Gotchas).

### Krea-native image (the only endpoints that take trained styles) [docs unless noted]

| id | Notes | Cost/image |
|---|---|---|
| `krea/krea-2/large` | Highest quality K2 | $0.06 [verified] |
| `krea/krea-2/medium` | Default K2 | $0.03 [verified] |
| `krea/krea-2/medium-turbo` | Fast/cheap K2 | $0.015 [verified] |

Krea 2 params (from `krea-2/medium` schema [docs]): `prompt`, `aspect_ratio` (1:1, 4:3, 3:2, 16:9, 2.35:1, 4:5, 2:3, 9:16), `resolution` (only `1K` today), `seed`, `creativity` (raw/low/medium/high), generative sliders `intensity`/`complexity`/`movement` (−100..100), `image_url` + `strength` (0–1, default 0.99) for i2i, **`styles: [{id, strength −2..2}]`** [verified], `image_style_references` (≤10, each `{url, strength 0–1}`; +$0.0025–0.005 [verified]), `moodboards` (max 1, `{id, strength 0–1 default 0.23}`; $0.04 tier on medium).

### Third-party image (24 endpoints) [docs]

Flux (`flux`, `flux-11-pro`, `flux-11-pro-ultra`, `flux-kontext` — editing), Google (`imagen-3`, `imagen-4`, `-fast`, `-ultra`, `nano-banana`, `nano-banana-2`, `-2-lite`, `nano-banana-pro`), OpenAI (`chatgpt-image`, `chatgpt-2` = gpt-image-2 at `/generate/image/openai/gpt-image-2`, from $0.009), ByteDance (`seedream-4`, `seedream-5-lite`, `seedream-5-pro`, `seededit`), Ideogram (`2.0a-turbo`, `3.0` — text rendering), `qwen-2512`, `z-image`, `luma-uni-1`, `runway-gen-4` (image). Typical price band $0.03–$0.15/image; Nano Banana Pro $0.15 is the ceiling [docs].

### Video (37 endpoints) [docs]

| Family | ids | Router-relevant capabilities |
|---|---|---|
| Veo (Google) | `veo-2`, `veo-3`, `veo-3-fast`, `veo-3.1`, `veo-3.1-fast`, `veo-3.1-lite` | Veo 3.1: duration 4/6/8 s, 720p/1080p/4K, 16:9 or 9:16, `start_image` + `end_image` (frame conditioning), `reference_images[]`, `generate_audio` (roughly doubles cost). $0.84 (720p/4s/mute) → $5.04 (4K/8s/audio) per job ≈ $0.20+/s |
| Kling | `kling-1.0` … `kling-2.6`, `kling-3.0`, `kling-o1` | Kling 3.0: 3–15 s, modes std/pro/4k, `start_image` + `end_image`, `multi_prompt[]` (timed prompt segments), `generate_audio`; $0.176–$0.441/s. No negative prompt/CFG exposed. `kling-o1` takes up to 10 reference images |
| Seedance (ByteDance) | `seedance-1.0-pro` (`seedance-pro`), `-pro-fast`, `seedance-20-mini`, Seedance 2.0 entries | 1.0 Pro: `start_image`, **`start_video`** (continuation), `end_image`, `reference_images` ≤4, 5 s default, 720p/1080p, 7 aspect ratios incl. 21:9/9:21; from $0.25/job |
| Hailuo (MiniMax) | `hailuo`, `hailuo-02`, `hailuo-23`, `hailuo-23-fast` | from $0.28/job (2.3) |
| Wan (Alibaba) | `wan-21`, `wan-22`, `wan-25` | 2.5: from $0.05/s — cheapest per-second tier |
| Runway | `runway-gen-3`, `gen-4`, `gen-45`, `runway-aleph` (video-to-video editing) | Gen-4.5 $0.12/s |
| Other | `ray-2` (Luma, $0.40/job), `ltx-23-22b`, `vidu-q3`, `grok-imagine`, `grok-imagine-15`, `gemini-omni-flash` | — |

### 3D (5 endpoints) [docs]

`hunyuan3d-21`, `hunyuan3d-31-pro` (text/image-to-3D, optional PBR materials), `trellis`, `trellis-2`, `tripo`. Output is a mesh asset on the job; convert with `POST /export/3d` → OBJ/FBX/STL/PLY zip. App compute costs: Hunyuan 3.1 Pro ~300, TRELLIS 2 ~250, Hunyuan3D-2.1 ~25, TRELLIS ~10, Tripo ~8 units; API USD prices unpublished.

### Image enhance (5) / video enhance (6) [docs]

- `enhance/krea/enhance` (Krea Enhance): `image_url`, `image_scaling_factor` (default 2, no hard cap; 8K max output), `ai_strength` 0.1–1, `clarity_strength` 1–12, `resemblance_strength` 0–2.5, `sharpness`, `rescale_color`, `prompt`, `seed`.
- `enhance/topaz/standard-enhance` (Topaz): faithful upscale to **22K** / 32× (`image_scaling_factor` 1–32, `width`/`height` ≤32000), sub-model enum (Standard V2, Low Resolution V2, CGI, High Fidelity V2, Upscale High Fidelity V3, Text Refine), face enhancement knobs, denoise/sharpen/fix_compression. $0.10/image.
- `topaz-bloom` ($0.51, creative), `topaz-generative` ($0.27, 16K max), `krea-legacy`.
- `enhance/topaz/video-upscale` (Topaz Video): `video_url`, target W/H up to **8000 px (8K)**, `enhancement_model` (20+ options, default `prob-4`), frame interpolation 15–240 fps (default 60), output presets H.264/H.265 (default `h265-main`)/ProRes/AV1/VP9.
- `astra`, `astra-2`, `starlight`, `starlight-25`, `seedvr2` — alternative video upscalers.

### Not on Krea (route elsewhere)

- **Midjourney** — no API anywhere incl. Krea; that's muapi's job [verified via catalog routing].
- **Suno / any audio generation** — zero audio models (voice, music, SFX). ElevenLabs covers this.
- **Sora 2** — priced on the marketing page ($0.10/s) but **no API reference page exists** (`api-reference/video/sora-2.md` 404s, absent from the docs index) [verified 2026-08-09]. Treat as app-only until a live `list_models` shows it.

## Result handling

- **Pattern:** every generation/enhance/3D/training call returns `{job_id, status, created_at, completed_at, result, error}` immediately; poll `GET /jobs/{id}` (REST guidance: every 2–5 s) or MCP `get_job`. Status enum: `backlogged | queued | scheduled | processing | sampling | intermediate-complete | completed | failed | cancelled` [verified].
- **Webhooks:** per-request `X-Webhook-URL` header (no account-level config); POSTs the job object on terminal states (completed/failed/cancelled). No signature/HMAC documented [docs] — treat the payload as untrusted and re-fetch the job by id before acting.
- **`result` shape is polymorphic** [docs]: an array of URL strings, OR an array of `{type: "model"|"preview", url}` objects (3D), OR a string-keyed URL map (node apps). LoRA-training jobs add `style_id`. Handle all three.
- **URLs, not base64:** outputs are hosted HTTPS URLs. **Expiry/retention is undocumented** [docs] — download immediately; Lyme Hype ingests by pulling the URL into the asset store (`lyme-asset://`) during the generation turn.
- **Inputs:** any media param accepts public HTTPS URL, base64 data URI, or a Krea asset URL (from `POST /assets` or `get_upload_url`). No comma-separated URL lists — one field per file [docs].
- A "Zero Data Retention" compliance mode exists to avoid server-side storage of prompts/outputs [docs].

## Pricing & limits

- **Two wallets** [verified]: compute units (app subscription; billed by OAuth MCP sessions) vs. the API USD balance (billed by token auth). They do not mix. Top-ups at `krea.ai/app/api` (owners only): presets $10/$25/$50/$100, custom $5–$10,000. **No programmatic balance endpoint** — 402 is the only signal; in-flight jobs still complete when the balance hits zero. Failed and cancelled jobs are not billed [docs]. Net-30 invoicing via sales@krea.ai.
- **Headline prices** [docs, features/api 2026-08-09]: images $0.015 (K2 Turbo [verified]) – $0.15 (Nano Banana Pro); video $0.05/s (Wan 2.5) – $0.50/s (Veo 2), Veo 3.1 $0.20/s, Kling 2.6 $0.07/s; enhance $0.10–$0.51/image. Price varies with resolution/duration/audio/style-refs on the same endpoint.
- **Style training: per-job price unpublished** [verified] — bills the API balance at an unlisted rate (this is why training moved to fal's $0.003/step trainer).
- **Rate limiting is concurrency-based, not RPM** [docs]: each plan tier (Free base / Pro higher / Enterprise custom) has a concurrent-job cap; jobs beyond it are **auto-backlogged, not rejected** — `backlogged` status, and 429 only at the concurrent-submission limit. Use webhooks over tight polling.
- Uploads: 75 MB/asset; presigned MCP upload URLs live 3 hours [docs].

## Gotchas

- **App-trained styles are invisible to the API, and API-trained styles are private to the API user that trained them** [verified]. Workspace sharing via `POST /styles/{id}/share/workspace` is the only widening. Don't promise a style trained in Krea's consumer app will resolve via `styles:[{id,…}]`.
- **`styles[]` works only on Krea 2 endpoints** [verified] — no other image/video model takes it. Whether the MCP `generate` schema for `krea-2/*` exposes it needs one authenticated `get_model_schema` look (joint session, per catalog.md).
- **No training via MCP** [verified] — seven tools, none train. `/styles/train` is REST-only.
- **1024-char cap on URI fields** ( `image_url`, `start_image`, etc. on several models) [docs] means base64 data URIs — nominally accepted — physically don't fit; upload as an asset instead [unverified inference].
- **OAuth workspace binding is permanent per MCP session**; reconnect to re-pick the workspace [docs]. Token auth must be exactly `Authorization: Bearer <token>` — malformed headers hard-fail auth [docs].
- **Frame-conditioning support is per-model, not uniform**: Veo 3.1/Kling 3.0/Seedance Pro take `start_image`+`end_image`; many others are t2v-only. Always `get_model_schema` before routing a start/end-frame job.
- No negative-prompt/CFG params on Veo 3.1 or Kling 3.0 despite upstream APIs having them [docs].
- Docs pages enumerate ~80 endpoints vs. ~71 in the live tool enum [verified] — some documented models (and marketing-page models like Sora 2) aren't actually reachable; the live `list_models` is the source of truth.
- `cancel_job` only works on non-terminal jobs; cancellation is what makes a job unbilled — a completed bad render is paid for.
- 3D outputs need the separate `POST /export/3d` call to get OBJ/FBX/STL/PLY; the raw job result is a model/preview URL pair.

## Sources

- Live probe + schema enumeration, prior verification sessions 2026-08-09 (endpoint/auth probe, tools/list, model count, /styles/train shape, K2 pricing) — facts marked [verified].
- https://www.krea.ai/docs/developers/mcp.md — MCP transport, auth, tools, billing, upload flow.
- https://www.krea.ai/docs/developers/introduction.md — base URL, endpoint pattern, job model.
- https://www.krea.ai/docs/developers/api-keys-and-billing.md — token rules, dual balances, top-ups, 402 behavior.
- https://www.krea.ai/docs/developers/rate-limits.md · https://www.krea.ai/docs/developers/webhooks.md
- https://www.krea.ai/docs/llms.txt — full API-reference endpoint index (model families).
- https://www.krea.ai/docs/api-reference/krea/krea-2-medium.md · …/video/veo-31.md · …/video/kling-30.md · …/video/seedance-pro.md — generate param schemas.
- https://www.krea.ai/docs/api-reference/image-enhance/krea-enhance.md · …/image-enhance/topaz.md · …/video-enhance/topaz-video.md — enhance surfaces.
- https://www.krea.ai/docs/api-reference/styles/train-a-custom-style-lora.md · …/general/get-a-job-by-id.md · …/assets/upload-an-asset.md · …/utilities/export-a-3d-model.md
- https://www.krea.ai/docs/3-d.md · https://www.krea.ai/docs/user-guide/features/model-overview.md · https://www.krea.ai/features/api (pricing; Sora 2 listed) — `api-reference/video/sora-2.md` confirmed 404.
- Repo: `F:\web-clients\joseph-sardella\lyme-hype\src\main\connector-suggestions.ts` (install shape), `F:\web-clients\joseph-sardella\lyme-hype\docs\connectors\catalog.md` (routing intent).
