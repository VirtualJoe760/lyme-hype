# OpenAI Images — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

Storyboard-tier still images — the second image option alongside Gemini (`docs/connectors/catalog.md`). Two jobs: plain text-to-image, and reference-conditioned stills (character/style continuity across a storyboard) via the edits-with-references endpoint. Images only — no video, no audio, no upscale/background-removal through this connector.

## Connection

- **Transport:** stdio MCP — Lyme Hype's owned wrapper `resources/openai-image-mcp.cjs` (plain Node, zero dependencies, newline-delimited JSON-RPC; global `fetch`/`FormData` against `https://api.openai.com/v1`).
- **Auth:** `OPENAI_API_KEY` env var, injected by the connector runtime from the vault; sent as `Authorization: Bearer` on every call. The key never appears in tool results.
- **Optional env:** `OPENAI_IMAGE_MODEL` overrides the wrapper's model (default `gpt-image-2`).
- **Key page:** https://platform.openai.com/api-keys
- **Install shape** (`src/main/connector-suggestions.ts`, id `openai`): `{ kind: 'stdio', command: 'node', args: [<appPath>/resources/openai-image-mcp.cjs], authType: 'apiKey', secretKey: 'OPENAI_API_KEY' }`.

## Tool surface

One tool. Both underlying HTTP calls are synchronous — response comes back in the same request, no job id, no polling.

### `openai_generate_image`

| Param | Type | Notes |
|---|---|---|
| `prompt` | string, **required** | What to draw. API accepts up to 32,000 chars for GPT image models [docs]. |
| `size` | enum `1024x1024` \| `1024x1536` (portrait) \| `1536x1024` (landscape) \| `auto` | Default `auto`. Wrapper enum is deliberately narrower than what gpt-image-2 accepts (see Gotchas). |
| `reference_image_paths` | string[] of absolute local paths | Optional. Zero refs → `POST /v1/images/generations` (JSON) [verified]. One-plus refs → `POST /v1/images/edits` (multipart, repeated `image[]` fields; single ref uses the same field) [verified]. png/jpg/jpeg/webp inferred from extension, unknown falls back to `image/png`. |

Returns a single text line `RESULT_FILE: <absolute path>` pointing at a decoded PNG on disk. Errors return `isError: true` with the API's error message.

**Not exposed by the wrapper** (all exist on the API): `quality` (low/medium/high/auto), `n` (1–10) [verified], `background`, `output_format`/`output_compression`, `mask`, `input_fidelity`, streaming partials.

## Models

All reachable by setting `OPENAI_IMAGE_MODEL`; the wrapper's two endpoints accept every model below [docs].

| id | Media | Ref images (edits) | Transparent bg | Sizes | Status / cost tier |
|---|---|---|---|---|---|
| `gpt-image-2` (default; snapshot `gpt-image-2-2026-04-21`) | image | yes, up to 16 | **no — errors** [docs] | arbitrary `WIDTHxHEIGHT`, multiples of 16, max edge 3840, aspect ≤3:1 [verified]; total pixels 655,360–8,294,400 [docs] | current flagship; mid — square medium ≈ $0.053 |
| `gpt-image-1.5` | image | yes, up to 16 | yes (png/webp out) [docs] | fixed: 1024×1024, 1024×1536, 1536×1024 [docs] | deprecated, shutdown 2026-12-01 [docs]; cheaper than 2 |
| `gpt-image-1` | image | yes, up to 16 | yes (png/webp out) [docs] | fixed, same three | deprecated, shutdown 2026-12-01 [verified] |
| `gpt-image-1-mini` | image | yes | yes | fixed, same three | deprecated, shutdown 2026-12-01 [docs]; cheapest (~⅓ token rates) |
| `chatgpt-image-latest` | image | yes | — | — | deprecated, shutdown 2026-12-01 [docs] |
| `dall-e-2` / `dall-e-3` | image | — | — | — | **gone** — shut down 2026-05-12 [verified]; requests fail |

## Result handling

- GPT image models **always** return base64 (`data[0].b64_json`) — never URLs [verified]. (URL responses were a dall-e-2-only behavior, 60-minute lifetime, now irrelevant [docs].)
- Wrapper decodes `data[0].b64_json` to `%TEMP%\lyme-hype-openai\<uuid>.png` and hands back `RESULT_FILE: <path>`; the generation agent ingests that file into `userData/assets` via `asset-store.ts` (`lyme-asset://`). Nothing to expire server-side.
- Only `data[0]` is saved; `n` is not exposed, so multi-image responses can't occur through the wrapper.
- API responses include `usage` token counts (input/output breakdown) [docs]; the wrapper discards them.

## Pricing & limits

**gpt-image-2 per image** (official guide table [docs]):

| Quality | 1024×1024 | 1024×1536 / 1536×1024 |
|---|---|---|
| low | $0.006 | $0.005 |
| medium | $0.053 | $0.041 |
| high | $0.211 | $0.165 |

Larger flexible sizes bill by output tokens and climb steeply — third-party math puts 4K-high around $0.41/image [unverified]. Underlying token rates (official pricing page [docs]): gpt-image-2 $5/1M text in, $8/1M image in, $30/1M image out; Batch API is half. gpt-image-1.5: same input rates, $32/1M image out; gpt-image-1-mini: $2 / $2.50 / $8.

**gpt-image-1.5 per image** [unverified — third-party (aifreeapi.com), consistent across sources]: $0.009 / $0.034 / $0.133 square; $0.013 / $0.05 / $0.20 portrait-landscape.

Limits:
- `quality` low/medium/high is the price lever — ~5–35× spread low→high [verified].
- `n` 1–10 per request [verified].
- Edits input: up to **16** images per request, each **<50MB**, png/jpg/webp [docs]; optional mask is PNG <4MB, same dimensions as the image [docs].
- Rate limits by account tier: Tier 1 = 100k TPM / 5 images-per-minute up to Tier 5 = 8M TPM / 250 IPM [docs].

## Gotchas

- **No transparent backgrounds on gpt-image-2.** `background: "transparent"` returns an error for `gpt-image-2` / `gpt-image-2-2026-04-21`; only its deprecated predecessors support alpha output, and they shut down 2026-12-01 [docs]. For overlay-with-alpha work, generate on a flat key color and run Lyme Hype's local colorkey→VP9-alpha pipeline (`src/main/media-tools.ts`) instead of expecting alpha from OpenAI.
- **The wrapper can't pull the price lever.** `quality` isn't exposed, so every call runs at `auto` — a square image can bill $0.211 instead of $0.006. If OpenAI routing starts costing real money, exposing `quality` in the wrapper is the first fix.
- **The wrapper's size enum undersells gpt-image-2.** The model takes arbitrary multiples-of-16 up to a 3840 edge [verified], but the tool only offers the three classic sizes + auto. 2K/4K output needs a wrapper change.
- `input_fidelity` (high/low) exists on edits for older GPT image models but is **not applicable to gpt-image-2**, which always processes inputs at high fidelity [docs].
- Docs conflict on flexible sizing for gpt-image-1/1.5: the guide says fixed-three-sizes, the generate reference implies arbitrary for GPT models generally. Treat flexible sizing as gpt-image-2-only [unverified either way].
- Non-square (1024×1536) is *cheaper* than square at medium/high despite having 1.5× the pixels — counterintuitive but official [docs].
- Deprecation dates: dall-e-2/3 already gone (2026-05-12) [verified]; gpt-image-1, gpt-image-1.5, gpt-image-1-mini, chatgpt-image-latest all shut down **2026-12-01** (announced 2026-06-02) [verified for gpt-image-1, docs for the rest]. Don't point `OPENAI_IMAGE_MODEL` at any of them past that date.
- The tool's description string still says "gpt-image-1" — cosmetic drift in `resources/openai-image-mcp.cjs`; the default is gpt-image-2.
- On the edits path the wrapper omits `size` when `auto`; on generations it sends `size: "auto"` literally (valid) [verified].
- There is no first-party OpenAI image MCP server — the owned wrapper exists on purpose (same precedent as `resources/gemini-mcp.cjs`); don't swap in a community package.

## Sources

- Live probe / schema verification (this project, 2026-08): generations b64_json shape, edits multipart `image[]`, gpt-image-2 size rules, n range, deprecation of gpt-image-1 and dall-e-2/3 — marked [verified].
- `F:\web-clients\joseph-sardella\lyme-hype\resources\openai-image-mcp.cjs` (wrapper source), `F:\web-clients\joseph-sardella\lyme-hype\src\main\connector-suggestions.ts` (install shape).
- https://developers.openai.com/api/docs/guides/image-generation — sizes, quality, transparency, per-image gpt-image-2 pricing, edits limits.
- https://developers.openai.com/api/reference/python/resources/images/methods/generate and `.../methods/edit` — background/size/quality/n parameter docs, 16-image / 50MB / mask limits, response shape.
- https://developers.openai.com/api/docs/models/gpt-image-2 — snapshot id, endpoints, rate-limit tiers.
- https://developers.openai.com/api/docs/pricing — token rates, batch rates.
- https://developers.openai.com/api/docs/deprecations — shutdown dates and replacements.
- Third-party (marked [unverified]): aifreeapi.com gpt-image-1.5 per-image tables; costgoat.com / unifically.com 2K–4K cost estimates.
