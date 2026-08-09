# Yapper — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

Lip-sync / talking avatars: a specific person's or character's face + voice driving a clip (the Create panel's Deepfake screen is hard-restricted to `connectorId: 'yapper'`). It is a specialty tool in the routing table, **not** a video-generation fallback — even though its catalog turns out to be a full aggregator (Seedance/Sora/Kling/Veo/Wan and more, see Models). Routing intent: `docs/connectors/catalog.md`.

## Connection

- **Hosted MCP (what Lyme Hype installs):** Streamable-HTTP at `https://yapper.so/mcp/connector`, **OAuth** per the MCP authorization spec — protected-resource discovery confirmed live [verified]. No key to paste; approval happens in the browser via `mcp-oauth.ts` (discovery → dynamic registration → PKCE → loopback redirect).
- **Install shape** (`connector-suggestions.ts`, catalog id `yapper`): `{ kind: 'http', url: 'https://yapper.so/mcp/connector', authType: 'oauth', docUrl: 'https://yapper.so/account/developer' }` [verified — in-repo].
- **REST API (separate credential):** base `https://yapper.so/api/v1`, `Authorization: Bearer yap_live_…` [verified]. Keys minted at `https://yapper.so/account/developer`. The OAuth connector login and the REST key are **independent credentials** — having one does not grant the other [verified].
- **Scopes** (REST, per OpenAPI): `processes:read/write`, `assets:read/write`, `models:read`, `usage:read` [docs].
- Machine-readable docs: `https://yapper.so/api/v1/openapi.json` (OpenAPI 3.1), `/api/v1/llms.txt`, `/api/v1/llms-full.txt` [verified — fetched live].

## Tool surface

Hosted MCP tools, all listed Live [verified for the first eight; the two model/voice tools are [docs]]:

| Tool | Purpose | Key params | Returns | Sync/poll |
|---|---|---|---|---|
| `yapper_start_process` | Kick off any generation process | `type` (enum below), `model` (string), `input` (per-model object), `dryRun?`, `testMode?`, `metadata?`, `webhookUrl?` | Process (or DryRunEstimate when `dryRun`) | Job — poll |
| `yapper_get_process` | Poll one process | `processId` | Process incl. `status`, `outputs[]`, `creditsUsed`, `estimatedCompletionSeconds` | — |
| `yapper_list_processes` | Team generation history | `status?`, `type?`, `model?`, `createdAfter/Before?`, `limit?` (1–100, default 20), `cursor?` | `{data: Process[], nextCursor}` | Sync |
| `yapper_list_assets` | Team media library | `type` (image\|video\|audio, required), `favorite?`, `source?`, `genType?`, `model?`, `limit?`, `cursor?` | `{data: Asset[], nextCursor}` | Sync |
| `yapper_get_asset` | One asset | `assetId` | Asset (`url`, `thumbnailUrl`, dims, `duration`, `mimeType`, `sourceProcessId`, `trainingId`) | Sync |
| `yapper_import_asset` | Ingest external media **by URL** | `type`, `url`, `name?` | Asset | Sync (can fail `import_failed`) |
| `yapper_list_models` | Browse model catalog | — | `{data: Model[]}` | Sync |
| `yapper_list_audio_voices` | Voices for an audio model | `modelId` (required), `search?`, `limit?`, `cursor?` | `{data: AudioVoice[], nextCursor}` | Sync |
| `yapper_get_credits` | Team balance | — | `{totalCredits, usedCredits, availableCredits, purchaseUrl}` | Sync |
| `yapper_get_usage` | Consumption + limits | — | `{credits, memberLimit, blocked: {byTeamLimit, byMemberLimit}}` | Sync |
| `yapper_upload_asset` | Local file → asset | local path | Asset | **Only on an elusive local stdio server** — not on the hosted connector [verified] |

MCP resources: `yapper://processes/{processId}`, `yapper://assets/{assetId}`; JSON tools return typed `structuredContent` plus a text copy, with read/write/idempotency annotations [docs].

Key REST endpoints beyond the MCP mirror [verified — live OpenAPI enumeration 2026-08-09]:

- `POST /processes` (supports `Idempotency-Key` header; 200 = DryRunEstimate, 201 = Process). Process `type` enum: `image-generation`, `video-generation`, `audio-generation`, `image-upscale`, `video-upscale`, `video-lipsync`.
- `POST /audio/speech` — script→voice, **synchronous** ("No polling — the response returns the finished asset"). Body: `script` (required, ≤2500 chars), `voiceId?`, `provider?` (`elevenlabs`|`cartesia`), `voiceQuery?`, `baseLanguage?`. Returns `{assetId, type:"audio", url, duration, script, voice{voiceId,provider,name}, creditsCharged, freeCharactersRemainingToday}`.
- `GET /audio/voices?modelId=…` — voice list per audio model.
- `POST /assets/uploads` → `{assetId, uploadUrl, method:"PUT", headers, maxBytes, expiresAt, completeUrl}` → PUT the bytes → `POST /assets/uploads/{uploadId}/complete` → Asset. Accepted mimeTypes: jpeg/png/webp/gif, mp4/quicktime/webm, mpeg/wav/x-wav.
- `GET /models` + `GET /models/{modelId}/schema.json` (JSON Schema per model — the authoritative per-model input contract; requires auth, unexercised here [unverified]).

**Lipsync input schema** (`video-lipsync` processes) [docs — llms-full.txt]:

| Field | Type | Req | Notes |
|---|---|---|---|
| `sourceVideoAssetId` | string | yes | Team **video** asset id |
| `audioAssetId` | string | yes | Team **audio** asset id (e.g. from `/audio/speech`) |
| `trainingId` | string | no | Max model only — reuse a prior training for faster runs |
| `startTimeSeconds` / `endTimeSeconds` | number | no | Trim window on the source video |

## Models

Full catalog per `llms-full.txt` [docs]; credit ranges vary with duration/resolution — `dryRun: true` gives the exact quote.

**Video-lipsync models** (the reason this connector exists):

| id | Behavior | Cost |
|---|---|---|
| `max` | Per-video **trained**: a Max request without `trainingId` trains on the source video first, then generates; reuse the returned `trainingId` for faster later runs. Highest quality. Historically Creator-tier gated [verified as historical; current gating unverified] | input-dependent |
| `pro` | Single-shot, no training | input-dependent |
| `sync-lipsync-v3` | Single-shot, stronger alignment | input-dependent |

**Video generation** (audio = native audio track support; frames = start/end-frame conditioning):

| id | Duration (s) | Max res | Credits | Audio | Frames |
|---|---|---|---|---|---|
| `seedance-2.5` | 4–30 | 720 | 80–580 | yes | start+end |
| `seedance-2.0` | 4–15 | 2160 | 220–840 | yes | start+end |
| `seedance-2.0-fast` | 4–15 | 2160 | 180–680 | yes | start+end |
| `seedance-2.0-mini` | 4–15 | 720 | 30–90 | yes | start+end |
| `seedance-2.0-open` | 4–15 | 2160 | 310–1180 | yes | start+end |
| `kling-3.0` | 4–15 (even) | 1080 | 72–270 | yes | start+end |
| `kling-3.0-pro` | 4–15 (even) | 1080 | 96–360 | yes | start+end |
| `veo3-quality` | 8 | 1080 | 216 | yes | start+end |
| `veo3-fast` | 8 | 1080 | 80 | yes | start+end |
| `sora-2` | 4–20 (4s steps) | 1080 | 48–240 | yes | start |
| `sora-2-pro` | 4–20 (4s steps) | 1080 | 96–480 | yes | start |
| `wan-3.0` | 2–30 | 1080 | 100–1460 | yes | start+end |
| `wan-2.7` | 2–10 (even) | 1080 | 30–150 | yes | start+end |
| `flux-3` | 5–20 | 1080 | 310–1240 | yes | start+end |
| `minimax-h3` | 5–15 | 1440 | 90–260 | yes | start+end |
| `pixverse-v6` | 1–15 | 1080 | 20–370 | yes | start |
| `grok-imagine` | 4–15 | 720 | 58–135 | yes | start |
| `grok-imagine-v1.5` | 1–15 | 720 | 20–260 | yes | start |
| `gemini-omni-flash` | 3–10 | 1080 | 80–250 | yes | — |
| `happy-horse` | 3–15 | 720 | 90–450 | yes | start |

**Image generation:** `nano-banana-pro` (4k, 10–28cr), `nano-banana-2` (4k, 8–22), `nano-banana-2-lite` (1080, 9), `gemini-image` (1080, 8–10), `gpt-image-2` (4k, 10–20), `gpt-image-2-high` (4k, 30–80), `seedream-v4.5` (4k, 8–20), `seedream-v5.0-pro` (3k, 42), `seedream-v5.0-lite` (4k, 24), `flux-2-pro` (2k, 10–20), `grok-imagine-image` (2k, 6). All support generation + editing.

**Audio (speech):** `sonic-3.5` (Cartesia; 1 ref-audio clone), `eleven_v3` (ElevenLabs; preset voices only), `bytedance/seed-audio-1.0` (text-only voice design; up to 3 ref clips / 90s). All list **0 credits** — a free daily character tier applies (see Pricing).

**Upscale:** `topaz-image-upscale` (image), `topaz-video-upscale` (conservative 2x), `topaz-starlight-precise-2.5` (generative realism), `flow-upscaling` (1080p/4k), `mmaudio-2` (AI audio-for-video, filed under video-upscale). All input-dependent cost.

**Non-startable in API v1** (read-only history only): `background-removal`, `image-to-avatar`, `lip-sync` (legacy), `motion-control`, `music-generation` [docs].

## Result handling

- Async everywhere except `POST /audio/speech`. Poll `GET /processes/{processId}` (or `yapper_get_process`) until `status` ∈ `completed`|`failed`; statuses are `queued|processing|completed|failed` [verified — OpenAPI]. `estimatedCompletionSeconds` on both Process and DryRunEstimate is the only turnaround signal — no published typical times [docs].
- `Process.outputs[]` = `{type, assetId, url, thumbnailUrl, width, height, duration, mimeType}` — **both** an asset id and a direct URL [verified — OpenAPI]. No documented URL expiry; assets persist in the team library and stay fetchable via `GET /assets/{assetId}` [docs; expiry behavior unverified].
- Optional `webhookUrl`: one-shot, at-most-once `{event, processId, status, creditsUsed, error?, metadata?, links}` notification on completed/failed — treat `GET /processes/{id}` as authoritative [docs]. Lyme Hype polls; it runs no inbound webhook listener.
- Hosted MCP process/asset reads return native media content blocks and video resource links with poster images [docs]; Lyme Hype ingests by downloading the output URL through `asset-store.ts` into `userData/assets` (`lyme-asset://`).
- **Getting local media INTO Yapper** (the Deepfake screen's reference upload): the hosted connector cannot read local paths [verified] — either `yapper_import_asset` with a URL, or the REST signed-upload flow with a `yap_live_` key. The signed-upload flow is wired (`uploadLocalMediaToYapper` in `src/main/yapper-rest.ts`, `net.fetch` throughout — see Gotchas); live verification against a real key is still joint-session scope.

## Pricing & limits

- Credits are the cost unit. Plans (2026-08-09, yapper.so/pricing) [docs]: Starter $9.99/mo → 1,000 cr; Personal $24.99 → 3,000; Creator $49.99 → 7,000 (adds commercial-use license, 2 seats); Max $149.99 → 22,500 (7 seats). Top-ups: 700/$10, 2,000/$25, 5,000/$50, 11,000/$100. Roughly 100–150 credits per $1 depending on tier — so a Veo3-quality 8s clip (216 cr) ≈ $1.50–2.
- Speech has a **free daily character tier** (UTC-reset; `freeCharactersRemainingToday` in the response; `creditsCharged: 0` while within it) [verified — OpenAPI].
- `dryRun: true` on any process returns `{creditsEstimated, canStart, blockedBy: team_limit|member_limit|null, estimatedCompletionSeconds}` without charging [verified]. `testMode: true` runs against a local test provider, dev environments only, no credits [docs].
- Rate limits per API key: 60 req/min default, 300 req/min high tier, fixed window across all endpoints; `X-RateLimit-*` headers, 429 with `Retry-After` [docs].
- 403 `subscription_required` when the team has no active paid subscription [docs].

## Gotchas

- **No face-swap process exists** — verified against the full OpenAPI: zero occurrences [verified]. Anything claiming Yapper face-swap at the API layer is wrong; the closest thing is `image-to-avatar`, which is non-startable in v1.
- Public claims that "Yapper has no API" (e.g. AppSumo Q&A) are **stale** — the v1 REST API + OpenAPI 3.1 spec + hosted MCP are live [verified 2026-08-09].
- Two credentials, easy to conflate: the MCP connector uses OAuth; REST uploads/keys use `yap_live_…` Bearer. Neither substitutes for the other [verified].
- Script→voice is **not** a process type: the `CreateProcessRequest.type` enum has `audio-generation`, but the practical TTS path is the synchronous `POST /audio/speech` endpoint [verified].
- `max` lipsync silently trains on the source video when called without `trainingId` (slower, likely costlier first run); capture and reuse the returned `trainingId`. Don't send `trainingId` to `pro`/`sync-lipsync-v3` [docs].
- Legacy `lip-sync` model id exists in the catalog but is non-startable; real lipsync goes through process type `video-lipsync` with models `max`/`pro`/`sync-lipsync-v3` [docs].
- `yapper_upload_asset` only exists on a local stdio MCP server whose distribution is unclear [verified as absent from the hosted connector]; from the hosted connector, local files must round-trip via URL import or REST signed upload.
- `GET /assets` requires `type` — an untyped "list everything" call is rejected [verified — OpenAPI].
- Idempotency: reusing an `Idempotency-Key` with a different body returns `idempotency_conflict` (409) [docs].
- `src/main/yapper-rest.ts`'s three REST calls (`uploadLocalMediaToYapper`, `synthesizeYapperSpeech`, `listYapperVoices`) use Electron's `net.fetch`, not the global Node `fetch` — every other main-process REST caller (`fal-training.ts`, `krea-training.ts`, `mcp-http.ts`, `mcp-oauth.ts`) already did; global `fetch` (Node's `undici`) doesn't pick up the user's system proxy/CA config the way Chromium's network stack does, so it was a real latent gap on any machine behind a corporate proxy. Fixed 2026-08-09 (thirty-first autonomous enrichment run) — keep new REST modules on `net.fetch` too.

## Sources

- https://yapper.so/api/v1/openapi.json — live schema enumeration, 2026-08-09
- https://yapper.so/api/v1/llms-full.txt — model catalog, lipsync schema, rate limits, MCP tool list
- https://yapper.so/api/v1/llms.txt · https://yapper.so/docs — API overview
- https://yapper.so/pricing — plans/top-ups, 2026-08-09
- https://yapper.so/mcp/connector — live probe (OAuth protected-resource discovery), prior verification 2026-08-09
- https://appsumo.com/products/yapper/ — the stale "no API" claim
- In-repo: `src/main/connector-suggestions.ts` (install shape), `docs/connectors/catalog.md` (routing intent)
