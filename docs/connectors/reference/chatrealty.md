# ChatRealty — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

Real-estate MLS data — the Phase 3 origin connector. Today the app calls exactly two tools, deterministically (no agent turn): `search_listings` (with `embedPhotos: 0`) then `get_listing_photos` (with `embed: 6`) in `src/main/chatrealty.ts` `pullListingPhotos()`, saving the returned base64 image blocks as canvas Image nodes. [verified]

The live server exposes **35 tools** — far more than the two in use. Untapped surfaces that could feed creative nodes directly:

- **`stage_listing_with_agent`** — server-side Gemini 2.5 Flash Image (Nano Banana) compositing that places the agent's headshot into listing photos; returns 4:5 Cloudinary URLs. A ready-made "agent showing the home" image source. [verified]
- **`create_listing_cover` / `create_carousel_slide`** — templated 4:5 Instagram cover + slide renders (banner/CMA/text/CTA kinds) returning Cloudinary URLs; brandable per call via `accentColor`. [verified]
- **`plan_listing_carousel`** — one call returning listing facts, photo index list, pre-formatted subdivision CMA stats, and the agent's brand color/handle/license — exactly the material a Scripting-panel carousel workflow needs. [verified]
- **`get_market_stats` / `get_subdivision_cma` / `find_comparables` / `get_going_rate` / `get_mortgage_rates`** — real numbers for script copy ("6 homes sold, median $2.36M") instead of invented stats. [verified]

## Connection

- **Transport:** stdio MCP. Shipping shape: `npx -y @chatrealty/mcp-server`. Local dev uses the sibling build `F:\web-clients\joseph-sardella\jpsrealtor\packages\mcp-server\dist\index.js` when present (`chatRealtyConnectorDef()` in `src/main/chatrealty.ts`). [verified]
- **Auth:** bearer token in env var `CHATREALTY_API_TOKEN` (`crt_live_…`). Base URL in `CHATREALTY_API_BASE` = `https://jpsrealtor.com`. [verified]
- **Key page:** `https://jpsrealtor.com/agent/settings` (also the connector's `docUrl`). [verified]
- **Install shape** (`connector-suggestions.ts` catalog entry): `id: 'chatrealty'`, category `data`, `available: true`, template from `chatRealtyConnectorDef()` — `kind: 'stdio'`, `authType: 'bearer'`, `secretKey: 'CHATREALTY_API_TOKEN'`, `builtin: true`. Token resolution is vault-first, then a dev-only `.env.local` fallback; `reconcileInstalledConnectors()` re-installs the def if the token exists without one. [verified]
- **Account gating:** `whoami` returns `dataSource` — `tenant` (agent's own MLS connected), `none` (listing/market tools **refuse**), or `dogfood` (ChatRealty-internal owner account). Live probe 2026-08-09 for this token: agent "Joseph Sardella", `dataSource: "dogfood"`, `lpBaseUrl: "https://josephsardella.com/lp"`. [verified]

## Tool surface

All 35 tools enumerated from the live server 2026-08-09 — every entry below is [verified] against the live schema. **Every tool is synchronous — there is no job-id/poll pattern anywhere in this connector.** The slowest call is `stage_listing_with_agent` (~30 s for 10 photos), still a single blocking call.

### Identity & account

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `whoami` | Agent name/email, token info, `dataSource` gate. Call first each session. | none | JSON text block |
| `my_agent_profile` | Bio, headline, service areas, headshot URL, social links, brand colors — context for drafting. | none | JSON text block |
| `my_stats` | Draft/published/archived counts by category. | none | JSON text block |

### MLS search & listing data

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `search_listings` | Active-feed search. | `city`, `subdivision`, `propertyType` (default `Residential`; `Residential Lease`/`Land`/`all`; raw codes A–D), `minPrice`/`maxPrice`, `minBeds`/`maxBeds`, `minBaths`/`maxBaths`, `minYearBuilt`/`maxYearBuilt`, `hasPool: boolean`, `minDaysOnMarket`/`maxDaysOnMarket`, `near` (ZIP/city/address/"lat,lng") + `radiusMiles` (default 10, max 50), `status`, `limit` (1–50, default 20), `skip`, **`embedPhotos` (0–12, default 5 — set 0 for text-only)** | JSON `{items: […]}` text block + up to 12 base64 image blocks; each item has `listingKey`, `thumbUrl`, `detailUrl`, lat/lng |
| `get_listing` | Full detail sheet for one listing: prices (original + current), HOA, pool/spa, remarks, list agent, DOM, `detailUrl`. | `listingKey` (required), `embedPhoto` (default true) | JSON text block + hero image block |
| `get_listing_photos` | Photo pull. **This is the base64 pipeline Lyme Hype ingests.** | `listingKey` (required), `embed` (0–12, default 6 — rendered base64 blocks), `limit` (URL count, 1–60, default 12) | image blocks (base64 + mimeType) + text block with photo URLs and `galleryUrl` |
| `search_closed_listings` | Sold/closed comps; same filters as search plus `lookbackMonths` (1–60, default 12). | as above minus geo/pool/era extras | JSON text block |
| `show_listing_board` | Interactive card-grid board (Claude-chat UI affordance; `limit` 1–30, default 12). Not useful inside Lyme Hype — prefer `search_listings`. | same filter surface | rendered board + embedded photos |

### Market data & investment math

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `get_market_stats` | Median list price, active count, median DOM, price range for a city/subdivision. | `city` and/or `subdivision` (≥1 required), `propertyType` | JSON text block |
| `get_subdivision_cma` | Nightly-built CMA for one subdivision (1,400+ pre-built): medians, distributions, $/sqft, active vs closed. | `slug` (e.g. `"pga-west"`, required) | JSON text block |
| `get_neighborhood_info` | City aggregate: active count, price range, avg/median list, property-type breakdown, subdivision count, MLS sources. **No demographics/schools/POIs.** | `slug` (e.g. `"palm-desert"`, required) | JSON text block |
| `find_comparables` | Closed comps for a listing: same subdivision/type, ±1 bed/bath, ±20% price, last 6 months, with median close. | `listingKey` (required) | JSON text block |
| `get_going_rate` | Median long-term rent, by-bedroom breakdown, rent/sqft, sample size + confidence. Long-term annual only — not seasonal/furnished. | `postalCode` (most reliable), `subdivision`, `city` | JSON text block |
| `get_mortgage_rates` | National 30-yr/15-yr fixed rates, cached hourly server-side. | none | JSON text block |
| `analyze_listing_cashflow` | One listing's rent estimate + confidence, cap rate, NOI, gross yield, cash flow at 20%/25% down, debt-free fixed costs. `cashflowStats` may be null. | `listingKey` (required) | JSON text block |
| `find_cashflowing_listings` | Cash-flow-positive actives in an area; default 20% down @ ~7%/30-yr, re-derivable. | `city`/`postalCode`/`subdivision`, `beds`, `maxPrice`, `downPaymentPct` (decimal, default 0.20), `mortgageRate` (decimal), `minMonthlyCashflow`, `sortBy` (`cashflow`\|`capRate`\|`cashOnCash`\|`price`), `limit` (1–30, default 20) | rendered board + JSON |

### Creative rendering (the untapped surface)

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `create_listing_cover` | Templated 4:5 Instagram cover — hook, price, address, specs, body, agent headshot. Template `simple-luxury` (more planned: `dark-modern`, `magazine`, `minimal`). | `listingKey` (required), `hook` (2–3 words), `body` (≤260 chars), `city`, `accentColor` (hex, no `#`, default `1C4A5A`), `photoIndex` (0-based, **default 8** — heuristic), `template` | **Cloudinary URL** in text block |
| `plan_listing_carousel` | One-call carousel kit: listing facts, photo list with indices, pre-formatted subdivision CMA stats, agent brand color/handle/license, slide-by-slide outline with renderer limits. Material, not copy. | `listingKey` (required) | JSON text block |
| `create_carousel_slide` | Render one non-cover 4:5 slide. Kinds: `banner` (room label + caption band over a staged photo — pass `imageUrl` from `stage_listing_with_agent`), `cma` (2×2 stat grid — exactly 4 `stats` entries + `listingPrice`/`scope`/`period`/`pitch`), `text` (paragraphs ≤220 chars each + `italicLast`), `cta` (exactly 2 `paragraphs`; agent name/DRE/headshot/logo injected server-side, not passable). | `kind` (required) + per-kind fields; `color`/`bg` hex, `handle` defaults to agent's IG | **Cloudinary URL** in text block |
| `stage_listing_with_agent` | Gemini 2.5 Flash Image (Nano Banana) composites the agent's headshot INTO listing photos, color-graded, 4:5. ~30 s for 10 photos, ~$0.04 each. **Always pass `photoIndexes` of interior rooms** — aerials/exteriors produce a giant floating agent, and MLS feeds lead with drone shots, so default first-N selection is usually unusable. | `listingKey` (required), `photoIndexes` (0-based, max 10, strongly preferred), `count` (1–10, default 5), `headshotUrl` override, `prompt` override | **Cloudinary URLs** in text block |

### CMS content (agent's site — drafts only)

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `create_article` | Blog/market-insight/tips DRAFT for the agent's CMS. | `title` (10–200 chars), `content` (MDX, ≥500 chars), `category` (`articles`\|`market-insights`\|`real-estate-tips`), `excerpt` (≤300), `seo`, `tags`, `featuredImage` | JSON text block (slug) |
| `get_article` / `list_my_articles` | Fetch one / list all (filter `status`, `category`; `limit` 1–50). | `slugId` / filters | JSON text block |
| `update_article` | Patch a draft; `status: 'published'` publishes (runs CMS pipeline **+ Google Business cross-post**). Refuses content edits on published articles (HTTP 409). | `slugId` (required) + any create fields | JSON text block |
| `create_landing_page` | Landing-page DRAFT: MDX body plus `landingPage` block (lead form fields/recipients, `heroType` photo/video, `youtubeUrl`, `themeOverride`). Returns `editUrl` + `previewUrl`. | `title`, `content` (≥500 chars) required | JSON text block |
| `get_landing_page` / `list_my_landing_pages` / `update_landing_page` | Same CRUD pattern; update refuses published pages (HTTP 409). | `slugId` / filters | JSON text block |

### CRM (PII — flows into agent context)

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `search_my_contacts` | Contact search, minimal projection (id, name, primary phone/email, status, tags). | `q`, `status`, `tag`, `limit` (1–50) | JSON text block |
| `get_contact` | Full record incl. notes history. Schema warns: never loop over search results. | `id` (required) | JSON text block |
| `my_recent_leads` | New contacts, `days` lookback (1–180, default 14), `source` filter (`followupboss`, `website`, …). | `days`, `source`, `limit` | JSON text block |

### Support & meta

| Tool | Purpose | Key params | Returns |
|---|---|---|---|
| `get_build_guide` | ChatRealty site-scaffold prompts (bring-your-own-MLS-data model). Not relevant to Lyme Hype. | optional `id` | text |
| `give_feedback` | Testing-phase feedback package: returns one-time `uploadUrl` for a ≤4 MB source zip. | `summary` (required), `kind` | JSON text block |
| `report_bug` | Structured defect report → `bugId`. | `title`, `description` required; `area`, `severity`, repro fields | JSON text block |
| `report_data_issue` | Data-pipeline failure report; field NAMES/shapes only, never values; duplicates cluster server-side. | `association`, `failingStep`, `errorText` required | JSON text block |

## Models

Not a model-hosting connector — one model is reachable indirectly:

| id | media | role | cost |
|---|---|---|---|
| Gemini 2.5 Flash Image ("Nano Banana") | image | server-side compositing inside `stage_listing_with_agent` only — no prompt-to-image surface, no model choice | ~$0.04/photo, billed to ChatRealty's side [verified schema] |

Cover/slide rendering (`create_listing_cover`, `create_carousel_slide`) is templated server-side layout, not generative.

## Result handling

- **Search/data tools:** JSON inside a `text` content block (`{items: […]}` etc.). `parseListings()` in `src/main/chatrealty.ts` parses it. [verified]
- **Photo tools:** mixed content — `image` blocks (base64 `data` + `mimeType`) plus a text block of photo URLs and `galleryUrl`. `imagesToAssets()` saves each base64 block via `saveImageAsset()` into `userData/assets` and hands back `lyme-asset://` URLs for canvas Image nodes. [verified]
- **Embed knobs are the context-size control:** `search_listings.embedPhotos` (default **5**), `get_listing_photos.embed` (default **6**), `get_listing.embedPhoto` (default true). Set 0 for URL-only programmatic flows — Lyme Hype's pull path does exactly this on search. [verified]
- **Creative renders** (`create_listing_cover`, `create_carousel_slide`, `stage_listing_with_agent`): **Cloudinary `https` URLs**, not base64. Ingesting these into Lyme Hype means downloading via `asset-store.ts`'s URL-import path — not the existing base64 pipeline. Cloudinary asset lifetime is on ChatRealty's account and not documented; download promptly rather than hot-linking. [unverified lifetime]
- **No polling anywhere** — every call returns its final result synchronously. [verified]

## Pricing & limits

- The API itself is unmetered to the token holder during ChatRealty's testing phase; the token is per-agent. [unverified — no published pricing page]
- `stage_listing_with_agent`: ~$0.04 per photo (schema-stated Gemini cost), max 10 photos/call. [verified schema]
- Caps that matter for batch work: search `limit` 50/page; photo URLs 60, embedded renders 12; boards 30; closed-listing lookback 60 months; `radiusMiles` 50; leads lookback 180 days; article/LP `content` ≥500 chars, `title` 10–200; feedback zip ≤4 MB. [verified schema]

## Gotchas

- **`post_instagram_carousel` does not exist in this MCP surface** despite being named in `plan_listing_carousel` and `create_carousel_slide` descriptions as the publish step. Publishing is gated elsewhere (ChatRealty host side). If it ever appears, treat it under Lyme Hype hard rule 6 — publish is immediate, confirm explicitly. [verified — live enumeration, 35 tools, no publish tool]
- **`dataSource` gating:** when `whoami` reports `none`, all listing/market tools refuse by design — don't work around it. This token currently reports `dogfood`. [verified]
- **Default photo embedding will flood an agent turn** — search embeds 5 rendered photos and `get_listing_photos` embeds 6 unless told otherwise. Programmatic callers must pass `embedPhotos: 0` / `embed: 0`. [verified]
- **Rentals:** `listPrice` on `Residential Lease` results is monthly rent ($1.5k–$15k), not a sale price; `get_market_stats` defaults to sales for the same reason. [verified schema]
- **`get_going_rate` is long-term annual rent** — furnished/seasonal is a separate, higher model that this tool does not return. [verified schema]
- **`get_neighborhood_info` has no neighborhood color** — no population, schools, parks, dining, demographics. City market aggregates only. [verified schema]
- **`create_listing_cover` `photoIndex` defaults to 8** — a rough front-exterior heuristic for GPS-sourced feeds; front-exterior auto-detection does not exist yet. Pick the index yourself from `plan_listing_carousel`'s photo list. [verified schema]
- **`stage_listing_with_agent` default selection is usually wrong** — first-N photos are typically drone/exterior shots that composite as a giant floating agent. Always pass interior `photoIndexes`. [verified schema]
- **Published content is immutable via API:** `update_article`/`update_landing_page` return HTTP 409 on published items; publishing an article also cross-posts to Google Business automatically. [verified schema]
- **`near` requires a user-supplied location** — the server cannot see device location; a bare "near me" must be resolved to ZIP/address first. [verified schema]
- **CRM tools pipe PII into model context** — schema-level warnings; keep them out of any automated Lyme Hype flow. [verified schema]
- **`analyze_listing_cashflow` can return `cashflowStats: null`** — surface "unavailable", never synthesize a rent. [verified schema]
- Local dev launches the sibling repo's built server (`jpsrealtor/packages/mcp-server/dist/index.js`) when present — schema drift between that build and the published `@chatrealty/mcp-server` npm package is possible. [verified code path]

## Sources

- Live schema enumeration via MCP ToolSearch, 2026-08-09 — all 35 tools, full parameter schemas.
- Live probe: `whoami` call, 2026-08-09 (agent identity, `dataSource: "dogfood"`).
- `F:\web-clients\joseph-sardella\lyme-hype\src\main\chatrealty.ts` (connector def, token resolution, base64→asset ingestion).
- `F:\web-clients\joseph-sardella\lyme-hype\src\main\connector-suggestions.ts` (catalog entry, reconcile logic).
- `F:\web-clients\joseph-sardella\lyme-hype\docs\connectors\catalog.md` §ChatRealty.
- Key page: https://jpsrealtor.com/agent/settings
