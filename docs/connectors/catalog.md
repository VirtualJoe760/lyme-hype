# Connector catalog — what each tool is for

The generic mechanism is [model.md](model.md). This doc is the opposite of generic: which specific tools are connected, why *that* tool for *that* job, and the exact connect shape for each. Researched 2026-08-08, routing intent refined the same day once real usage patterns (cost, quality, specialty) became clear.

**Deeper per-connector documentation lives in [reference/](reference/)** — aggregated 2026-08-09 from official docs and live schema enumeration: full tool surfaces, model catalogs, pricing, and gotchas. The connector × creative-node join is [`../architecture/capability-map.md`](../architecture/capability-map.md); this catalog stays the short "why this tool" summary.

## Routing philosophy

Lyme Hype doesn't have one "generation connector" — it has several, each earning its place for a specific job rather than being interchangeable:

- **Aggregators (muapi, Krea, fal, Yapper) cost more per call than going direct**, because they're a reseller layer on top of the real model providers. Use one only when there's no practical direct path to the model you actually want (Seedance, Midjourney) — not as a default preference for convenience.
- **Cost-tier the same *kind* of output differently depending on how committed you are to it.** A Storyboard panel is a cheap exploratory sketch; the same panel promoted to a real Canvas node is a real spend. Image generation specifically now has two tiers for exactly this reason — see below.
- **A tool's "why" belongs in this doc, not just its transport shape.** Two connectors can both technically produce an image; that doesn't mean either is the right choice for a given moment. The table below is the routing intent; each tool's own section has the mechanical detail.
- **Prefer local ffmpeg over any connector when ffmpeg alone can do the job** — extracting an audio track, keying a background to transparency, format conversion. It costs nothing and spends no connector tokens; a connector is for jobs that genuinely need a model. Confirmed while designing Isolate Audio and the Motion graphics tile — see `../ui/create-panel.md`.

## Routing table

| Job | Tier | Route | Why |
|---|---|---|---|
| Video generation | Primary | **muapi** → Seedance (primary model), with Kling / Veo / Flux as fallback models in the same connector | One key covers Seedance plus fallbacks if a specific model is down or wrong for the shot — no separate connection per video model |
| Voice, music, SFX | — | **ElevenLabs** | Direct-to-source, no aggregator markup; the clear best-in-class for voice specifically |
| Image — production | Committed spend | **Midjourney**, reached via **muapi** (no direct Midjourney API exists) | Best stylized-image quality; worth the aggregator markup once a shot is worth actually generating for real |
| Image — storyboard | Cheap exploration | **Gemini** (Nano Banana) or **OpenAI** (gpt-image-1) — user picks per node/panel | Direct-to-source, cheap, fast — good enough to judge composition/mood before spending on Midjourney |
| LoRA / custom style training | — | **fal's Krea trainers** (`fal-ai/krea-2-trainer`, `fal-ai/flux-krea-trainer`) | Published pricing ($0.003/step · ~$2/run) on the existing fal key — chosen over Krea's own unpublished-price API trainer (user call 2026-08-09) |
| Lip-sync / talking avatars | — | **Yapper** | Purpose-built for likeness — per-video-trained Max lip-sync. (Face swap turned out NOT to exist at Yapper's API layer.) Not what muapi/fal's general video models are for |
| Real-estate listing data | — | **ChatRealty** | Not generation at all — the data connector that started this whole model (Phase 3) |

## muapi — video primary, general fallback

- **Key page:** `muapi.ai/access-keys` · **Connect:** stdio `npx -y muapi-cli mcp serve`, `MUAPI_API_KEY` · **Status: built-in, installs today. Fully verified 2026-08-09** — `muapi-cli` 0.2.7 was actually executed during the audit: it starts a stdio MCP server (25 tools) and completes the handshake.
- Covers image + video + audio (Seedance incl. v2, Kling incl. v3, Veo up to veo4, Flux, Midjourney V7/V8/Niji, Suno; also sora-2, nano-banana, imagen4 and more — the live `tools/list` enum is authoritative) behind one key.
- **Async result pattern (matters for the agent prompt):** video/audio tools return `{request_id, status: "processing"}`; the final `{status: "completed", outputs: ["https://cdn.muapi.ai/…"]}` comes from polling the `muapi_predict_result` tool. `generation.ts`'s prompt now instructs the agent to poll id-returning tools to completion.
- **Safety:** the server also ships `muapi_account_topup` (a Stripe checkout — real money), `muapi_keys_create`/`muapi_keys_delete`, and a stdio-only `muapi_upload_file`. The first three are hard-blocked during agent-driven generation via `disallowedTools` + a canUseTool name-pattern backstop; `upload_file` is legitimately useful (local file → hosted URL for image-to-video).
- muapi also runs an official **hosted** MCP at `https://api.muapi.ai/mcp` (Bearer) — a zero-Node-dependency alternative to the stdio CLI if npx ever grates; stdio is kept as the default because `upload_file` is stdio-only.
- **Routing intent:** the agent's default video connector. Midjourney access also happens through here (see below) since Midjourney has no API of its own.

## ElevenLabs — voice, music, SFX

- **Key page:** `elevenlabs.io/app/settings/api-keys` · **Connect:** stdio `uvx elevenlabs-mcp`, `ELEVENLABS_API_KEY` (needs the `uv` runtime on the machine) · **Status: built-in, installs today.**
- Direct-to-source — no aggregator sits between Lyme Hype and ElevenLabs. Covers all three of voice, music, and SFX; they don't need separate connections, it doesn't matter to Lyme Hype that they're conceptually different products under the hood.

## Midjourney — production-tier image, via muapi

- **No standalone connector** — Midjourney has no accessible official API as of 2026. Reached exclusively as a model inside muapi (V7/V8/Niji).
- **Routing intent:** the "I'm committing to this shot" image tier. When a Storyboard panel is promoted and its media type is image, generation should prefer Midjourney (via muapi) over the cheap storyboard-tier models — see [Wiring the tiers](#wiring-the-tiers-not-yet-built) below for the mechanism that will enforce this.

## Gemini — storyboard-tier image (+ video)

- **Key page:** `aistudio.google.com/apikey` · **Connect:** stdio, `GEMINI_API_KEY` · **Status: built and installable.**
- **Built in-house, not a community package.** `resources/gemini-mcp.cjs` is a dependency-free plain-Node stdio MCP server hitting Google's Generative Language REST API directly — no first-party Gemini media MCP exists, and per the direct-to-source preference, a thin owned wrapper beats depending on an unvetted community server. Two tools: `gemini_generate_image` (Nano Banana, reference-image input capped at 3 per the current guide) and `gemini_generate_video` (Veo — long-running op, polled, downloaded in-process with the key so the file never needs a public URL; start/end-frame conditioning via `instance.image`/`instance.lastFrame`, both field names verified against the live docs + SDK source).
- **Model succession (verified 2026-08-09):** `veo-3.0-generate-001` was shut down 2026-06-30 — the wrapper now defaults to `veo-3.1-generate-preview` (the whole 3.1 family carries `lastFrame`; interpolation requires `durationSeconds: 8`, which the wrapper sets automatically). `gemini-2.5-flash-image` shuts down 2026-10-02; the wrapper tries `gemini-3.1-flash-image` (Nano Banana 2) first and falls back to 2.5 automatically if the id isn't recognized. Both remain env-overridable. Veo output is stored server-side for only 2 days — the wrapper's immediate download matters.
- Image/video are **paid-tier keys** on Google's side (the free tier is text-only).
- **Routing intent:** one of two interchangeable storyboard-tier image options (see OpenAI below) — cheap, fast, good enough to judge a shot before spending on Midjourney.

## OpenAI — storyboard-tier image

- **Key page:** `platform.openai.com/api-keys` · **Connect:** stdio, `OPENAI_API_KEY` · **Status: built and installable (2026-08-08).**
- **Built in-house, not a community package** — same situation and same call as Gemini: no first-party OpenAI image MCP exists, community servers (`SureScaleAI/openai-gpt-image-mcp`, `spartanz51/imagegen-mcp`) were passed over for a small **owned** wrapper. `resources/openai-image-mcp.cjs` is a dependency-free plain-Node stdio server, one tool: `openai_generate_image` — `POST /v1/images/generations` for text-only prompts, and `POST /v1/images/edits` (multipart, repeated `image[]` field — verified shape) when `reference_image_paths` are passed. GPT image models return base64, so results hand off as `RESULT_FILE:` like Gemini's.
- **Model succession (verified 2026-08-09):** `gpt-image-1` is deprecated with a **Dec 1, 2026 shutdown**; the wrapper now defaults to `gpt-image-2` (2026-04-21 flagship — same generations+edits flow, better in-image text rendering, up to 4K) with `OPENAI_IMAGE_MODEL` as the override. dall-e-2/3 are already gone (May 2026) — never fall back to them.
- **Routing intent:** the second of the two interchangeable storyboard-tier image options. Per the user's call: both Gemini and OpenAI get installed, and the Storyboard's per-node model choice is just "whichever the user picks" — Lyme Hype doesn't need to pick a winner between them.
- The selftest now includes a protocol smoke test for **both** bundled wrappers (spawn, handshake, tools/list with a dummy key — no billed call); the Gemini wrapper never actually had one before this.

## Krea — general generation (training moved to fal)

- **Key page:** `krea.ai/settings/api-tokens` · **Connect (general image/video/3D):** http MCP `api.krea.ai/mcp`, bearer `Authorization` (endpoint + Bearer/OAuth both live-probed 2026-08-09) · **Status: general connector built and installable.**
- **Training's default route is fal** (`src/main/fal-training.ts`, user call 2026-08-09): fal hosts both `fal-ai/krea-2-trainer` ($0.003/step, outputs `lora_file` safetensors) and `fal-ai/flux-krea-trainer` (FLUX.1 Krea [dev], ~$2/run, outputs `diffusers_lora_file`) with published pricing on the already-installed fal key — training images are packed into a store-only ZIP locally (dependency-free writer, verified against Python's zipfile), uploaded via fal storage, then queue-submitted and polled. **A second, opt-in trainer is back** (2026-08-09 enrichment run, row 4 of `../ui/node-enrichment-strategy.md`): "Krea 2 direct" in Create › Create a LoRA calls `src/main/krea-training.ts`'s `/styles/train` client — the same one this doc originally anticipated, removed at `4e96389` and resurrected verbatim from git history — for the one case fal can't cover: applying the trained style through Krea's own production-tier K2 Large endpoint via `styles:[{id,strength}]`, which fal's weights-URL route has no equivalent for.
- **What LoRA training actually is:** teaching a model (Flux/Wan family, or Krea 2 via `k2`/`k2-large`) a new subject, character, or visual style from example images, producing reusable LoRA weights usable at inference time.
- **Verified API surface (2026-08-09, official API reference):** `POST https://api.krea.ai/styles/train` — **JSON body, not multipart**: required `name` + `urls[]` (external URLs, base64 data URIs, or uploaded asset URLs via `POST /assets`); optional `model`, `type` (Style/Object/Character/Default), `trigger_word`, `max_train_steps` (1–2000). Returns `{job_id, …}`; progress polls **`GET /jobs/{id}`** (status enum: backlogged/queued/scheduled/processing/sampling/intermediate-complete/completed/failed/cancelled). `src/main/krea-training.ts` implements exactly this shape.
- **Pricing correction:** the earlier "$0.003/step, 100-step minimum" figure was **fal.ai's** price for their hosted `fal-ai/krea-2-trainer`, not Krea's. Krea bills training to the workspace's separate API USD balance at an unpublished per-job rate (402 when short). If published per-step pricing ever becomes a requirement, fal's trainer is the alternative (different service, credential, and schema).
- **Trained-style USE is real:** Krea 2 generation endpoints accept `styles: [{id, strength(-2..2)}]`. Whether the MCP `generate` tool takes the same param needs one authenticated `get_model_schema` look — joint session. Two boundaries worth remembering: **styles trained in Krea's consumer app are NOT visible to the API**, and API-trained styles are private to the API user that trained them.
- **Training via MCP: confirmed absent.** Krea's hosted MCP documents exactly seven tools (list_models, get_model_schema, generate, execute_node_app, get_job, cancel_job, get_upload_url) — no train tool. The REST exception stands.

## Yapper — lip-sync / talking avatars

- **Key page:** `yapper.so/account/developer` · **Connect:** http MCP `yapper.so/mcp/connector`, **OAuth** (no key to paste; endpoint + MCP-spec OAuth discovery live-probed 2026-08-09) · **Status: built and installable.**
- **Capability, corrected (2026-08-09, against Yapper's OpenAPI + MCP docs):** the real differentiator is the **Max lip-sync model** (per-video trained; talking avatars). The pipeline shape is: script → `audio-speech` step → `video-lipsync` process over a **source video asset + audio asset (by asset id)** in the user's Yapper library. **There is no Face Swap at the API/MCP layer** — the process-type enum has no face/swap entry; the earlier face-swap claim came from third-party reviews of the web UI and is dropped from this catalog (the Create panel's Deepfake screen is lip-sync only now).
- **Local-file boundary:** the hosted connector **cannot read local paths**. Local media reaches Yapper via `yapper_import_asset` (a URL) or the REST signed-upload flow (`POST /assets/uploads` → upload → complete, Bearer `yap_live_…` key — a separate credential from the OAuth connector). Wiring one of those is what the Deepfake screen's reference-upload needs — joint session.
- MCP tools (docs, all "Live"): `yapper_start_process`, `yapper_get_process`, `yapper_list_processes`, `yapper_list_assets`, `yapper_get_asset`, `yapper_import_asset`, credits/usage; `yapper_upload_asset` exists only on a local stdio variant whose distribution is unclear.
- **Routing intent:** the connector for a specific person's/character's face+voice driving a clip. Not a video-generation fallback — a specialty tool.

## ChatRealty — real-estate data

- Not generation — a data connector. Full detail already lives in [model.md](model.md)'s history and the original Phase 3 build notes in `build-plan.md`; kept out of the routing table's "why this tool" framing above since it isn't competing with anything else in the catalog for a job. Stdio, bearer token (`CHATREALTY_API_TOKEN`, must be `crt_live_…`), hosted base `https://jpsrealtor.com`.

## Wiring the tiers — BUILT (2026-08-08)

The routing intent above (video → muapi; production image → Midjourney/muapi; storyboard image → Gemini or OpenAI; LoRA → Krea; deepfake → Yapper) is now enforced from the UI via `GenerationParams.connectorId` (+ a new advisory `modelHint` the prompt carries into the agent turn):

- **Storyboard panels:** image panels have a per-panel model select (Gemini/OpenAI, whichever are installed); a panel promoted with no explicit choice defaults to the single installed storyboard connector when there's exactly one.
- **Create › Generate video:** defaults to muapi when installed (the explicit-bias option this doc offered), with a connector select as the escape hatch (including "agent picks").
- **Create › Generate image:** the tier toggle — Storyboard (Gemini/OpenAI select) vs. Production (`connectorId: muapi` + `modelHint: "Midjourney"`). A trained Krea style, when selected, routes via `connectorId: 'krea'` instead (whether Krea's generation surface can reference the style by name needs a live-token check — joint session).
- **Create › Deepfake:** hard-restricted to Yapper.

## Known gaps, summarized

- ~~OpenAI image connector~~ — built 2026-08-08 (see above).
- ~~Krea LoRA training~~ — built 2026-08-09 (see above); `src/main/krea-training.ts` is live as the opt-in "Krea 2 direct" trainer. The exact request/response schema (esp. the undocumented `POST /assets` upload response field name) still needs live-token verification — joint session.
- ~~Connector-tier routing~~ — built 2026-08-08 (see "Wiring the tiers" above).
- Agent tool-selection with multiple similar connections generally (not just image tiers) — still unconfirmed by an actual multi-connector generation test; see the open question carried in `../architecture/platform-decisions.md`.
- ~~Generation is text-prompt-only~~ — closed 2026-08-08: `GenerationParams` carries `referenceImagePaths` + `startFramePath`/`endFramePath`, both owned wrappers accept reference images, and the Gemini/Veo wrapper accepts start/end frames. Live frame-conditioned renders still unexercised (billed) — joint session.
- ~~No batch-generate-and-compare UI~~ — closed 2026-08-08: `BatchResultsGrid` (generic) + the Motion graphics wizard's batch stage.
- ~~Export has no alpha-channel path~~ — closed 2026-08-08: `media-tools.ts`'s colorkey → VP9/WebM `yuva420p` path, verified against the real binary (`alpha_mode=1`).
