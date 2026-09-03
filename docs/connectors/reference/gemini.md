# Google Gemini (media) — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

Storyboard-tier image generation (Nano Banana family, with reference-image conditioning) and
frame-conditioned short video (Veo 3.1) — the reveal/loop mechanism behind the Motion graphics
wizard (start frame → end frame interpolation). Routed through Lyme Hype's **owned wrapper**
`resources/gemini-mcp.cjs`, not a third-party MCP.

## Connection

- Transport: **stdio MCP** — the bundled dependency-free wrapper `resources/gemini-mcp.cjs`
  (newline-delimited JSON-RPC, plain Node, global `fetch`). [verified]
- Install shape (`connector-suggestions.ts`, id `gemini`): `kind: 'stdio'`, `command: 'node'`,
  `args: [<appPath>/resources/gemini-mcp.cjs]`, `authType: 'apiKey'`, `secretKey: 'GEMINI_API_KEY'`. [verified]
- Auth: `GEMINI_API_KEY` env var injected by the connector runtime from the vault; the wrapper
  sends it as the **`x-goog-api-key` header** on every call, including the video download. The key
  never appears in tool results. [verified]
- API base: `https://generativelanguage.googleapis.com/v1beta`. [verified]
- Key page: <https://aistudio.google.com/apikey>. Image/video models need a **paid-tier** key —
  neither Nano Banana output nor Veo is served on the free tier. [docs]
- Model selection is env-var only, not per-call: `GEMINI_IMAGE_MODEL` (default
  `gemini-3.1-flash-image`, automatic fallback `gemini-2.5-flash-image` on 404/"not supported")
  and `GEMINI_VIDEO_MODEL` (default `veo-3.1-generate-preview`). [verified]

## Tool surface

Three tools, all **synchronous from the agent's point of view** (the wrapper does any polling internally and only returns when the file is on disk).

### `gemini_generate_image`
- Purpose: text→image, optionally conditioned on local reference images (compose/edit — Nano Banana takes input images natively). [verified]
- Params (full surface exposed 2026-08-29): `prompt` (required); `model` (enum: 3.1-flash / 3.1-flash-lite / 3-pro / 2.5-flash, default env); `aspect_ratio` (10 values, sent as `generationConfig.imageConfig.aspectRatio` — **live-verified**: 16:9 request → 1376×768 output); `image_size` (`0.5K|1K|2K|4K` → `imageConfig.imageSize` [live-verified at 1K]); `thinking_level` (`minimal|high`, sent as `generationConfig.thinkingLevel`, 3.1-flash only [unverified against live API]); typed refs — `object_reference_paths` (≤10), `character_reference_paths` (≤4), `style_reference_paths` (≤3), plus legacy `reference_image_paths` (counted as object refs). generateContent has no structured ref-type field, so the wrapper labels each image's role in a text preamble (Interactions API is the structured path). [verified wrapper]
- Wire: `POST models/{model}:generateContent` with `contents[0].parts` = inline image parts (`inlineData: {mimeType, data<base64>}`) followed by the text part; `generationConfig.imageConfig` for aspect/size. [verified]
- Returns: `RESULT_FILE: <absolute path>` text line (image written to `%TEMP%\lyme-hype-gemini\<uuid>.<ext>`). On refusal, surfaces the model's text as the error. [verified]

### `gemini_generate_video`
- Purpose: text→video (Veo), optionally frame-conditioned: start frame, end frame, or both (both = seamless loop when identical). [verified]
- Params (full surface exposed 2026-08-29): `prompt` (required — time-segmented beats work well); `model` (Veo variant enum); `aspectRatio` (`9:16`/`16:9`); `resolution` (`720p|1080p|4k` — 4k refused on lite by the wrapper); `duration_seconds` (4|6|8; wrapper forces 8 for lastFrame/refs/1080p+); `person_generation` (`allow_all|allow_adult`); `reference_image_paths` (≤3, refused on lite) + `reference_type` (`asset|style`) → `instances[0].referenceImages` [{image, referenceType}] [unverified wire against live API — first live-check target]; `start_frame_path`, `end_frame_path`. [verified wrapper]
- Wire: `POST models/{model}:predictLongRunning`; `instances[0].image` = start frame, `instances[0].lastFrame` = end frame, both as `{bytesBase64Encoded, mimeType}` — that wire shape is valid. [verified] When `lastFrame` is present the wrapper sets `parameters.durationSeconds = 8` (required by the API). [verified]
- Job pattern: long-running operation; the wrapper polls `GET {operation.name}` every 10 s, 6-minute timeout, then downloads the result URI itself (URI requires `x-goog-api-key` and follows redirects). [verified]
- Returns: `RESULT_FILE: <absolute path>.mp4`. [verified]
- Still not exposed: `negativePrompt` and `seed` (not supported on Veo 3.1 at all — nothing to expose). [docs]

### `gemini_extend_video`
- Purpose: append ~7 s of new content onto a Veo-generated clip (the "extend" mechanism the model table's Video row already documented as a capability, but the wrapper never exposed until now). Not supported on `veo-3.1-lite-generate-preview`. [docs]
- Params: `source_video_path` (string, required — absolute local path of a prior `gemini_generate_video`/`gemini_extend_video` result mp4); `prompt` (string, required — what happens next); `model` (optional, non-lite Veo variant); `previous_duration_seconds` (number, optional — lets the wrapper reject an extension that would exceed the 148 s cap before spending a call on it). [verified wrapper]
- Wire: `POST models/{model}:predictLongRunning`; `instances[0].video = {inlineData: {mimeType: 'video/mp4', data: <base64 of the local file>}}`, `parameters.durationSeconds = 8` (mandatory for extension, same as `lastFrame`). **[unverified]** — this is the shape shown in Google's own Veo docs page, but at least one third-party report (a Google AI developer forum thread, 2026) claims the live REST endpoint rejects base64 video on this field with "bytesBase64Encoded isn't supported by this model" and wants `video: {uri: <files/...:download URL>}` instead — the short-lived (2-day) authed URI from the *original* generation's operation response, not something you can construct from a local file. The wrapper deliberately re-encodes the local mp4 instead of threading that URI through, because it already discards the URI after downloading the source clip (no operation state is retained across calls) — re-architecting to keep it alive would be a bigger change than this pass scoped. **First thing to try if this 400s against a real key**: swap to the `uri` shape and have callers pass the original operation's video URI (would require the wrapper to return it alongside `RESULT_FILE` from `gemini_generate_video`, a breaking response-shape change for callers). [unverified — flagging for a live check, same pattern as Krea's undocumented `/assets` response field and Yapper's `AudioVoice` shape]
- Job pattern / returns: identical to `gemini_generate_video` (long-running op, 10 s poll, 6-minute timeout, `RESULT_FILE: <path>.mp4`). [verified wrapper]
- Not yet wired to a UI picker — `generation.ts` accepts `GenerationParams.extendVideoPath`/`extendVideoDurationSec` and hints the agent toward this tool, but nothing on the canvas sets those fields yet (no "Extend +7s" button on a video node). Backend-only as of 2026-08-09.

## Models

### Image (all reachable via `{model}:generateContent`; Interactions API is the recommended new path — see Gotchas)

| id | media | headline capabilities | cost tier |
|---|---|---|---|
| `gemini-3.1-flash-image` (Nano Banana 2; also seen as `gemini-3.1-flash-image-preview`) | image | Wrapper default. [verified] Up to 10 object + 4 character + 3 style reference images [docs]; 0.5K/1K/2K/4K output; strong text rendering; video-to-image (3.1 Flash only); Google Image Search grounding (Interactions API only) [docs] | mid ($0.067/1K image) |
| `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) | image | Fastest/cheapest; up to 14 object refs, **no character-consistency refs**; **1K output only**; aspect ratios 1:1→21:9 incl. 9:16; no Search grounding [docs] | low (~$0.034/1K image) |
| `gemini-3-pro-image` (Nano Banana Pro) | image | Premium reasoning/complex composition; up to 6 object refs; 1K/2K/4K; interleaved text+image output [docs] | high (~$0.134/1K–2K [unverified], derived from $120/1M image-token rate) |
| `gemini-2.5-flash-image` (original Nano Banana) | image | Wrapper's automatic fallback. [verified] **Shuts down 2026-10-02.** [verified] 1K/2K/4K; fewer ref inputs than 3.1 family [docs] | low ($0.039/image) |

### Video (all `{model}:predictLongRunning`; all preview status, no GA ids yet [docs])

| id | headline capabilities | cost tier |
|---|---|---|
| `veo-3.1-generate-preview` | Wrapper default. [verified] i2v (start frame) + `lastFrame` interpolation [verified]; `referenceImages` ≤3 (style/content assets) [verified/docs]; video extension +7 s per request, ≤20 extensions, ≤148 s total, 720p only [verified/docs]; 4/6/8 s; 16:9 + 9:16 [verified]; 720p/1080p/4K [verified]; audio always generated [verified] | high ($0.40/s) |
| `veo-3.1-fast-generate-preview` | Same feature set incl. extension and refs; faster/cheaper [docs] | mid ($0.10–0.12/s) |
| `veo-3.1-lite-generate-preview` | Cheapest; frame interpolation + refs supported, **no video extension, no 4K** (720p/1080p) [docs/verified — "no 4K on lite"] | low ($0.05/s) |

Veo cross-variant constraints [docs]: `durationSeconds` ∈ {4, 6, 8}; **8 s is mandatory** for 1080p, 4K, `referenceImages`, `lastFrame` interpolation, and extension. `personGeneration`: text-to-video/extension = `allow_all` only; anything image-conditioned (i2v, interpolation, refs) = `allow_adult` only (also the ceiling in EU/UK/CH/MENA). `seed` is **not** supported on Veo 3.1 (it was Veo 3-only). Prompt limit 1,024 tokens. SynthID watermark on all output.

## Result handling

- Image: API returns base64 `inlineData` in the response parts; wrapper writes it to a temp file. [verified]
- Video: operation completes with a **short-lived authed URI** (`generatedSamples[0].video.uri` or `generatedVideos[0]` variant), not a public URL; download requires the `x-goog-api-key` header and redirect-following. Wrapper downloads in-process so the key never leaves it. [verified]
- Both tools hand off as a `RESULT_FILE: <absolute path>` line; `generation.ts` imports that file into the asset store (`lyme-asset://`). [verified]
- Server-side storage: generated videos are kept **2 days**, then deleted; using a stored video as extension input resets its 2-day clock. [verified/docs] Images are not stored server-side at all — the base64 response is the only copy. [docs]
- Veo latency: ~11 s minimum, up to 6 min at peak — matching the wrapper's 6-minute timeout. [docs]

## Pricing & limits

Per-output pricing (paid tier; standard, not batch) [docs, pricing page 2026-08]:

| output | price |
|---|---|
| Nano Banana 2 image | $0.045 (0.5K) / $0.067 (1K) / $0.101 (2K) / $0.151 (4K) |
| Nano Banana 2 Lite image | ~$0.034 (1K) |
| Nano Banana Pro image | $0.067 (1K/2K) / $0.12 (4K) at batch rate; standard ≈ 2× [unverified] |
| gemini-2.5-flash-image | $0.039/image |
| Veo 3.1 (audio incl.) | $0.40/s (720p, 1080p) / $0.60/s (4K) |
| Veo 3.1 Fast | $0.10/s (720p) / $0.12/s (1080p) / $0.30/s (4K) |
| Veo 3.1 Lite | $0.05/s (720p) / $0.08/s (1080p) |

Rule of thumb: one default wrapper video call (8 s, 720p, veo-3.1-generate-preview) ≈ **$3.20**; the same shot on Lite ≈ $0.40. One default image ≈ $0.07.

Rate limits are tier-dependent and not published per-model — check <https://aistudio.google.com/rate-limit>; preview models (all of Veo 3.1) are throttled harder than stable ones. [docs] No free-tier access to any model in this file. [docs]

## Gotchas

- **`generateContent` is now "legacy."** The Interactions API went GA June 2026 and is Google's recommended path for all new work; `generateContent` remains fully supported with **no announced sunset**, so the wrapper works as-is — but new features (Google Image Search grounding via `tools: [{type: "google_search", search_types: ["image_search"]}]`, multi-turn editing via `previous_interaction_id`, `background` async mode) ship **only** on Interactions. A future wrapper revision should target `interactions` for images; note the Interactions docs list **no Veo support** — video stays on `predictLongRunning`. [docs]
- **Image model id churn is real**: docs use `gemini-3.1-flash-image` in some places and `gemini-3.1-flash-image-preview` in others (the image-search grounding requires the `-preview` id per current guides). The wrapper's 404-triggered fallback to `gemini-2.5-flash-image` exists precisely for this. [verified/docs]
- **Deprecation dates**: `veo-3.0-*` was **shut down 2026-06-30** — any doc/example still naming it is dead. [verified] `gemini-2.5-flash-image` dies **2026-10-02**, which also kills the wrapper's fallback — remove or replace it before then. [verified]
- The wrapper's 3-reference-image cap matches old Nano Banana guidance; Nano Banana 2 accepts up to 10 object + 4 character + 3 style refs. The cap is now conservative, not an API limit. [verified wrapper / docs]
- `lastFrame` forces `durationSeconds: 8` (API requirement, wrapper enforces it) — you cannot get a 4 s interpolated clip. [verified]
- The wrapper never sends `resolution`, so Veo output is the 720p default; 1080p/4K (and the $0.60/s 4K rate) are unreachable without a wrapper change. Image size/aspect controls are likewise not plumbed. [verified]
- **Audio is always generated** by Veo 3.1 — there is no silent mode; strip audio locally (ffmpeg) if unwanted. [verified/docs]
- `seed` does **not** exist on Veo 3.1 despite appearing in older Veo 3 examples. [docs]
- Video URIs are useless without the API key header and expire with the 2-day retention — never hand the raw URI to the renderer; only the downloaded file matters. [verified]
- Early-preview forum reports of `lastFrame`/`referenceImages` "not supported" errors (Oct–Nov 2025) were id/rollout issues, since resolved — the shapes in this file are the live ones. [verified]

## Sources

- Wrapper source: `F:\web-clients\joseph-sardella\lyme-hype\resources\gemini-mcp.cjs` + install template in `F:\web-clients\joseph-sardella\lyme-hype\src\main\connector-suggestions.ts` (live code)
- Prior live-probe verification (this project, 2026-08): endpoint/auth/wire shapes, model successions, retention, download auth — items marked [verified]
- <https://ai.google.dev/gemini-api/docs/pricing> (image + Veo per-unit pricing)
- <https://ai.google.dev/gemini-api/docs/veo> (Veo 3.1 variants, durations, resolutions, refs, extension, personGeneration, retention)
- <https://ai.google.dev/gemini-api/docs/image-generation> (Nano Banana family via Interactions API; per-model ref/resolution matrix)
- <https://ai.google.dev/gemini-api/docs/generate-content/image-generation> (legacy generateContent image path — still-working ids and shapes)
- <https://ai.google.dev/gemini-api/docs/interactions> (Interactions API GA status, params, no-Veo coverage)
- <https://ai.google.dev/gemini-api/docs/rate-limits> (tier-based limits; preview throttling)
- <https://www.philschmid.de/nano-banana-2-interactions-api> (Interactions image flow, image-search grounding)
