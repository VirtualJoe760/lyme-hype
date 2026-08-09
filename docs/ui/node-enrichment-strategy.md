# Node enrichment strategy

**Living document.** Where [`creative-nodes.md`](creative-nodes.md) says what each node does and
[`../architecture/capability-map.md`](../architecture/capability-map.md) says what each connector
can do, this doc says **how to chain those capabilities so each node is as good as it can
possibly be** — not "one connector satisfies one node," but "which connectors compose, in what
order, to make this node excellent." Seeded 2026-08-09; expanded automatically by the nightly
enrichment routine (see `../reports/node-enrichment-progress.md` for the queue and
`../reports/node-enrichment-report.md` for the run-by-run log).

## Method, per node

For every node: (1) what is the user actually trying to accomplish — the *feeling*, not the
mechanism; (2) which capabilities from the matrix currently serve it and how thinly; (3) what a
**chain** of 2+ connectors produces that no single connector can; (4) what's missing entirely
(new connector or genuinely new feature); (5) a concrete build-order.

---

## Flagship example: Deepfake — the chain that was missing entirely

**What the user is trying to accomplish:** put a specific face and a specific voice into a
script and get a believable talking clip — a virtual spokesperson, not a generic AI avatar.

**Current state (pre-enrichment):** the Deepfake tile is a single call to Yapper's lipsync
process with a text description. It does not touch LoRA, does not touch ElevenLabs, does not
let the user build or reuse an identity. This is the exact gap the user flagged: "I'd be
surprised if we had that functionality even as a skeleton" — confirmed, we didn't.

**The chain that makes it real** (per-tool detail from `../connectors/reference/`):

1. **Identity — Krea/fal LoRA** (`lora-train` → `lora-use`). Train a subject LoRA on reference
   photos of the person (fal's `krea-2-trainer` or `flux-krea-trainer`, `auto_captioning:
   "Object/Character"`). The trained style's `loraUrl` becomes a reusable identity asset —
   already modeled in `TrainedStyle`, just not yet consumed outside the image tile.
2. **Voice — ElevenLabs** (`voice-clone` → `audio-tts`). Clone the person's voice from short
   samples (`voice_clone {name, files[]}`), then drive the script through `text_to_speech` with
   that voice. This is already built (`elevenlabs-tools.ts`) — Deepfake has just never called
   it; it hand-waves "the agent generates speech if needed."
3. **Face + motion — Yapper `video-lipsync`**, OR **muapi `muapi_enhance_face_swap`**
   (image+video modes — the capability we thought didn't exist and does). Yapper needs a
   *source video* asset + the *audio* asset from step 2 (asset ids, not raw files — needs
   `asset-upload` first). muapi's face-swap is the template-based alternative when there's no
   source performance video, only a still photo of the person.
4. **Optional finishing — muapi enhance/upscale** on the result.

**Concrete build order** (this is what the overnight routine should implement, in this
sequence, each step independently shippable):
1. A "Reference person" concept: reuse `TrainedStyle` (already has `id`/`name`/`loraUrl`) as the
   identity record, extend with an optional `voiceId` (ElevenLabs voice id/name) so one record
   holds both likeness and voice.
2. Deepfake screen gains: pick-a-person (existing trained styles filtered/extended with voice)
   → script → **explicit stage progression** (Speech → Face) instead of one opaque call, each
   stage using the actual tool (`textToSpeech` then a lipsync/face-swap call), each stage's
   output visible as its own node (matches the Motion graphics wizard's proven pattern).
3. `asset-upload` helper shared across Yapper/muapi/fal (`uploadLocalAssetTo(connectorId,
   path): Promise<string>`) — the one piece of missing plumbing that unblocks Deepfake, i2v
   generally, and face-swap simultaneously. Build once, reuse three ways (capability map §4).
4. Route: face-swap when only a still photo exists (muapi), lip-sync when a source performance
   video exists (Yapper) — offer both modes once asset-upload exists, restoring the face-swap
   mode the Deepfake screen dropped when Yapper turned out not to have it.

**Status (2026-08-09 enrichment run — steps 1, 2 and a variant of 3/4 shipped):**

- Step 1 done: `TrainedStyle.voiceName` (shared/types.ts), `setTrainedStyleVoice`
  (fal-training.ts) + `lora:set-voice` IPC, and an inline voice field on each Settings › Trained
  styles card.
- Step 2 done: `DeepfakeScreen` (AsidePanel.tsx) is now Reference person → script → **Stage 1
  "Generate speech"** (direct `textToSpeech` call, lands as its own audio node) → **Stage 2
  "Lip-sync / face"** (agent call, source video/photo node picker).
- Steps 3/4, pivoted rather than built as spec'd: no standalone `uploadLocalAssetTo` helper.
  Instead `GenerationParams` gained `connectorIds` (restrict the agent to an exact SET of
  connectors, not just one — `buildMcpServers` in generation.ts now takes `restrictIds: string[]`)
  plus `referenceAudioPaths`/`sourceMediaPath` (local paths resolved and handed to the agent the
  same way `referenceImagePaths` already was). Stage 2 restricts to exactly the connected
  `yapper`/`muapi` pair and instructs the agent to prefer muapi's *own* `muapi_upload_file` tool
  chained into `muapi_edit_lipsync` (or `muapi_enhance_face_swap` for a stills-only reference) —
  both tools it already has — falling back to Yapper's `video-lipsync` process when only Yapper
  is connected. This reuses tools the agent already holds instead of Lyme Hype owning a second
  upload implementation per connector; it only works where an attached connector exposes its own
  upload tool (muapi does, stdio-side) or the source is already a URL. A real
  `uploadLocalAssetTo` helper — specifically for Yapper's REST signed-upload flow, which needs a
  *second*, non-OAuth `yap_live_…` credential Lyme Hype doesn't model yet — is still open; see the
  progress queue's resume note.
- **Not run live** — no connector API keys are configured in this sandbox, and live generation
  spend is explicitly out of scope for the autonomous routine (`AGENTS.md` §0). `npm run
  typecheck` passes; the actual tool-chain prompt (does the agent really call
  `muapi_upload_file` → `muapi_edit_lipsync` in that order, correctly) is unverified until a
  joint session with real keys.
- **2026-08-09, second pass — resume item (c) closed:** `voice_clone` (already implemented in
  `elevenlabs-tools.ts`, already exposed as the Create panel's Generate audio · **Clone** job) was
  never connected to the Reference person concept — cloning a voice and attaching it to a
  `TrainedStyle` were two disconnected screens (clone here, then copy the name and paste it into
  Settings › Trained styles by hand). `AudioScreen`'s clone job now takes an optional "attach to
  Reference person" picker (`props.styles`, already fetched once at the `AsidePanel` level and
  already threaded into `ImageScreen`/`DeepfakeScreen` the same way); on a successful clone with a
  style selected, it calls `bridge.lora.setVoice` with the clone's own `name` — no reply-parsing
  needed, since `voice_clone`'s only file-free confirmation text already echoes the name the
  caller chose and the caller already has it in state — and lifts the updated `TrainedStyle` back
  up via a new `onStyleUpdated` callback prop so the Deepfake screen sees the freshly-paired voice
  without navigating away and back. Nothing here fires a live call beyond the same voice_clone
  call the button already made before this change; only the *what happens after success* path is
  new. `npm run typecheck` clean. Resume items (a) and (b) are still open — see the progress
  queue's row 1 resume note.
- **2026-08-09, third pass — resume item (a) closed:** built the Yapper REST signed-upload path.
  New `src/main/yapper-rest.ts`: `hasYapperRestKey()` + `uploadLocalMediaToYapper(path)` implement
  the flow from `docs/connectors/reference/yapper.md` (`POST /assets/uploads` → PUT the bytes →
  `POST completeUrl` → Asset), reading the `yap_live_…` key from the *same generic secret vault*
  (`credential-vault.ts`) every other connector credential uses, keyed by a synthetic id
  (`yapper-rest`) rather than a real `ConnectorDef` — a fake MCP ConnectorDef would make
  `testConnector` try to MCP-handshake a REST base URL and fail, so this rides the vault directly
  instead of forcing the credential through the MCP connector model it doesn't actually fit.
  `generation.ts` now calls it: when `yapper` is attached and `muapi` is not (the case the hosted
  MCP connector alone can't handle, since it has no upload tool of its own), it pre-uploads
  `sourceMediaPath`/`referenceAudioPaths` before the agent turn starts and hands the agent the
  resulting Yapper asset ids directly in the prompt (`sourceVideoAssetId`/`audioAssetId`), instead
  of asking the agent to discover an upload tool that isn't there. `ConnectorsTab.tsx` gained a
  small "REST upload key" row under the Yapper card (same `bridge.secrets.request`/`list`
  mechanism, no new IPC channel needed — it was already generic over connector id).
  `docs/architecture/capability-map.md` and `docs/ui/creative-nodes.md` updated in this commit.
  `npm run typecheck` clean (fresh `npm install` in this sandbox, no prior `node_modules`). **Not
  run live** — same as every prior pass, no Yapper REST key is configured in this sandbox, and
  live spend is out of scope for the autonomous routine; the actual request/response shapes for
  `POST /assets/uploads` (exact body field names, `completeUrl`'s exact response shape) are
  best-effort from the reference doc's [verified — live OpenAPI enumeration] summary, not
  hand-verified against a real response body — flagging this explicitly since it's the one part
  of this pass that's a documented shape, not a tested one. Resume item (b) — live-verify the
  whole chain (muapi upload→lipsync AND this Yapper REST fallback) — is the only thing left on
  row 1, and it needs real keys, i.e. a joint session.

---

## Listing photos (ChatRealty) — the chain from "pulled photos" to "postable creative"

**What the user is trying to accomplish:** turn a real MLS listing into something they can post,
not just a folder of raw agent photos on the canvas. The gap isn't data — `pullListingPhotos()`
already gets real photos with real provenance — it's that the tile stops at "here are the photos,"
when ChatRealty's own connector can turn those same photos into branded, Instagram-ready creative
without leaving the app or paying a second generation connector for work ChatRealty already does
server-side.

**Current state (pre-enrichment):** two deterministic tool calls (`search_listings` →
`get_listing_photos`), base64 → `saveImageAsset` → image nodes. None of the connector's 6 "creative
rendering" tools (`create_listing_cover`, `plan_listing_carousel`, `create_carousel_slide`,
`stage_listing_with_agent`) were ever called — `docs/architecture/capability-map.md` flagged them
as paid-for and unused since the map was first written.

**The chain that makes it real** (per-tool detail from `../connectors/reference/chatrealty.md`):

1. **Cover — `create_listing_cover`.** One call, `listingKey` + user-authored `hook`/`body` +
   defaulted `city`/`accentColor`/`photoIndex`, returns a Cloudinary URL. The lowest-friction of
   the four creative tools: no photo selection needed (the template picks a reasonable default,
   `photoIndex: 8`, itself a known-rough heuristic per the reference doc's gotchas), no multi-step
   plan, one screen's worth of copy. Ships first.
2. **Carousel material — `plan_listing_carousel`.** One call returning listing facts, a photo
   index list, pre-formatted subdivision CMA stats, and the agent's brand color/handle/license —
   exactly the structured material a Scripting-panel or Storyboard carousel workflow needs instead
   of an agent guessing stats. Feeds step 3, and separately feeds script copy generally (real
   numbers — "6 homes sold, median $2.36M" — instead of invented ones, the same principle
   `get_market_stats`/`get_subdivision_cma`/`find_comparables` offer to any Scripting turn that
   touches a listing).
3. **Carousel slides — `create_carousel_slide`.** Four kinds (`banner`/`cma`/`text`/`cta`), each
   with its own required-field shape (`cma` wants exactly 4 `stats` entries; `cta` wants exactly 2
   `paragraphs`). `banner` is the one kind that composes with step 4 — it takes an `imageUrl` from
   `stage_listing_with_agent` rather than a plain listing photo. Real scope: a slide-kind picker +
   per-kind form, closer to the Motion graphics wizard's staged-screens pattern than a single call.
4. **Agent-in-photo staging — `stage_listing_with_agent`.** Nano Banana composites the agent's own
   headshot into up to 10 interior listing photos (~$0.04/photo, ~30s for 10) — a materially
   different creative move than a template render, and the one tool in this chain that's a real
   generation call, not templated layout. **Always pass interior `photoIndexes`** — the reference
   doc's gotcha about default-selection landing on aerial/exterior shots (giant floating agent) is
   not a hypothetical, it's the documented default behavior. This is real generation spend, same
   category as every muapi/ElevenLabs/Krea call elsewhere in the app — build the picker, never fire
   it autonomously.

**Concrete build order:**
1. Cover render on the Listing photos tile, scoped to the top-matched listing from a pull (no new
   listing-picker UI needed — the pull already surfaces one listing's photos at a time). **Shipped**,
   see below.
2. Feed `plan_listing_carousel`'s structured facts/CMA material into the Scripting panel's context
   when a listing-sourced node is in play — real numbers over invented ones, zero new UI (an
   agent-context enrichment, not a new tile). **Shipped**, see below.
3. Carousel slide builder — a `kind` picker + per-kind form on the Listing photos tile (or a new
   tile), each slide landing as its own image node the same way the cover does.
4. Agent-in-photo staging — an interior-photo picker (reusing the existing pulled-photo nodes,
   filtered by user selection since the app has no room-classifier) feeding `photoIndexes`; this is
   the one step that's a real paid call the user explicitly presses Generate on, same posture as
   every other billed connector call in the app.

**Status (2026-08-09 enrichment run — step 1 shipped):**

- `createListingCover()` in `chatrealty.ts`: one `create_listing_cover` MCP call (deterministic, no
  agent turn — matches `pullListingPhotos()`'s own pattern), Cloudinary URL extracted from the text
  response and downloaded via `importUrlAsset()` into a real image node. New IPC round trip
  (`chatrealty:create-cover`), `ChatRealtyCoverResult` shared type, `bridge.chatRealty.createCover`,
  and a `createChatRealtyCover` store action following `pullChatRealtyPhotos`'s existing shape.
  `ChatRealtyPull.tsx` now surfaces a small hook/body form for the top-matched listing after a
  successful pull (both fields required and user-authored — cover copy is not something to
  auto-generate blind) and renders the result as a new canvas node exactly like a pulled photo.
- **Not run live** — no ChatRealty token is configured in this sandbox, and even with one, firing a
  real `create_listing_cover` call autonomously would violate the standing "never make a live billed
  call" guardrail regardless of how cheap/templated the call actually is; the button exists,
  nothing fires until a human clicks it. The one thing worth a human's eye once a token exists: the
  Cloudinary-URL regex extraction (`https:\/\/\S+` against the tool's text response) is a
  best-effort parse of a documented-not-tested response shape, same caveat row 1's Yapper REST pass
  flagged for its own regex-free but similarly untested parsing.
- `npm run typecheck` clean (fresh `npm install`, no `node_modules` at run start).

**Status (2026-08-09 enrichment run, step 2 shipped — row 10 stays in-progress):**

- `planListingCarousel()` in `chatrealty.ts`: one `plan_listing_carousel` MCP call (deterministic,
  no agent turn, same shape as `pullListingPhotos`/`createListingCover`), raw text response capped
  at 6,000 chars. New `chatrealty:listing-context` IPC channel end-to-end (`ipc-channels.ts` →
  `ipc.ts` → `preload/index.ts` → `bridge.ts`, including the browser-preview mock's honest
  "unavailable" stub) and a `ChatRealtyListingContextResult` shared type.
- `sendScriptingMessage` in `store.ts`: on a conversation's first turn only (`history.length === 0`
  — the same point `conversations.ts`'s own transcript-replay preamble is conditional on), it looks
  for the session's most recently added canvas node carrying a `listingKey` (a ChatRealty-sourced
  Listing photos node) and, if one exists, fetches the carousel material and prepends it to the
  prompt actually sent to the agent — not to the message shown in the chat transcript, so the user
  still sees their own plain text. Every later turn already has the material in the agent's
  resumed session context, so it's fetched exactly once per conversation, not on every message.
- **Not run live** — no ChatRealty token configured in this sandbox; the wiring reuses the same
  no-agent-turn call pattern the cover render already established and typechecked clean, but the
  actual `plan_listing_carousel` response shape (and the value of prepending ~6k chars of it ahead
  of a user's first message) is unverified against a real reply.
- `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`). `creative-nodes.md` and
  `capability-map.md` updated in the same commit.
- Steps 3–4 remain open, real, separately-scoped features for future passes — no ordering
  dependency between them.

**Status (2026-08-09 enrichment run, step 3 shipped):**

- `createCarouselSlide()` in `chatrealty.ts`: one `create_carousel_slide` MCP call (deterministic,
  no agent turn, same shape as the other three ChatRealty creative calls) dispatching on a new
  `ChatRealtyCarouselSlideInput` discriminated union (`shared/types.ts`) — `banner`/`cma`/`text`/
  `cta`, each carrying only its own kind's required fields per the reference doc's field list.
  Unlike `create_listing_cover`/`stage_listing_with_agent`, this tool takes **no `listingKey`** —
  the reference doc's own param column omits it, and every kind's content is literal fields the
  caller already supplies (stats/paragraphs/an image URL), not a server-side lookup — so the main-
  process call doesn't send one, only the resulting canvas node tags itself with the top listing's
  key for provenance, same as the cover.
- Full plumbing: new `chatrealty:create-carousel-slide` IPC channel end-to-end, `bridge.chatRealty
  .createCarouselSlide`, a `createChatRealtyCarouselSlide` store action (reuses `addNode` the same
  way `createChatRealtyCover` does), and a kind-picker + four per-kind forms on `ChatRealtyPull.tsx`
  beneath the cover form — first UI in this file to use the shared `Button` component
  (`src/renderer/src/components/ui/Button.tsx`) instead of hand-picked classes, per `AGENTS.md`'s
  buttons-are-components rule; the pre-existing cover buttons in the same file were left as-is
  (not a regression to fix mid-feature, but worth a follow-up pass noting them for consistency).
- The `banner` kind structurally depends on `stage_listing_with_agent` (step 4, unbuilt) for a real
  `imageUrl`; rather than disable the kind, its form takes a manually pasted URL with help text
  saying exactly that — an honest partial rather than a fake-looking full build.
- `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`, fresh `npm install`, no
  `node_modules` at run start). **Not run live** — no ChatRealty token configured in this sandbox;
  the request shape is inferred from the reference doc's prose field list (`stats`, `listingPrice`/
  `scope`/`period`/`pitch` for `cma`; `paragraphs`/`italicLast` for `text`; exactly 2 `paragraphs`
  for `cta`; `label`/`caption`/`imageUrl` for `banner`) since no field-level JSON schema was
  captured when the reference doc was written — same confidence tier as the Krea asset-upload
  field-name guesswork from row 4, worth a live check once a token exists (does each `cma` stat
  really take `{label, value}`, does `text` really accept 1–3 paragraphs or a fixed count).
- Step 4 (agent-in-photo staging picker) shipped in the same overnight pass window by an
  independent run — see below; the two were merged together rather than one deferring to the other,
  since they're complementary, not duplicate, work. Row 10's build order is now fully closed.

**Status (2026-08-09 enrichment run, step 4 shipped):**

- `stageListingWithAgent()` in `chatrealty.ts`: one `stage_listing_with_agent` MCP call
  (`listingKey` + `photoIndexes`, capped to the tool's own 10-photo max), all Cloudinary URLs
  extracted from the text response (a global regex + dedup, since this tool can return several
  URLs unlike the single-URL cover/carousel-context calls) and downloaded via `importUrlAsset()`
  into real image nodes, one per staged photo.
- `imagesToAssets()` (the same helper `pullListingPhotos()` already used) now stamps each pulled
  photo with its 0-based `get_listing_photos` position as `ChatRealtyPulledImage.photoIndex` — the
  exact value `photoIndexes` expects — so the picker never has to guess an index from a list
  position; it reads the real one back off the pull result.
- `ChatRealtyPull.tsx` gained an interior-photo checkbox grid (rendered once photos exist,
  10-pick cap matching the tool's own limit) and a "Stage agent into N photos" button, following
  the cover form's established shape (own `stageState`/`stageMessage` local state, `ResultRow`-free
  since this is a direct bridge call like the cover, not an agent-routed `generateMedia` call).
  Full plumbing thread: `ChatRealtyStageResult` shared type, `chatrealty:stage-listing` IPC channel
  end to end (`ipc-channels.ts` → `ipc.ts` → `preload/index.ts` → `bridge.ts`, mock included), and
  a `stageChatRealtyListing` store action shaped like `createChatRealtyCover`.
- **This is real generation spend** (~$0.04/photo) — unlike the templated cover/carousel-material
  calls, so this button is the one place in the whole Listing photos tile where a press has a real
  dollar cost, same category as every other Generate button elsewhere in the app. The picker exists
  to make interior-only selection easy (the reference doc's documented gotcha: default/first-N
  selection is usually aerial/exterior and composites a giant floating agent) — nothing here fires
  it autonomously.
- **Not run live** — no ChatRealty token configured in this sandbox, and even with one this routine
  would never press the button itself; the request/response shape (`photoIndexes` in, multiple
  Cloudinary URLs out) is read directly from the reference doc's verified schema, same confidence
  level as every prior ChatRealty pass.
- `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`). `creative-nodes.md` and
  `capability-map.md` updated in the same commit.
- Step 3 (carousel slide builder) shipped in the same overnight pass window by an independent run
  — see above. Row 10's build order is now fully closed: cover, CMA context, carousel slides, and
  agent staging are all shipped.

---

## Node queue (priority order — the routine works top to bottom, one per run)

See `../reports/node-enrichment-progress.md` for live status. Seed ordering and rationale:

1. **Deepfake** — flagship, analyzed above; build order ready to implement.
2. **Motion graphics** — already the most chained node (refs → variations → batch → final →
   frame-conditioned video → alpha); enrichment = deepen reference conditioning (Nano Banana 2's
   10-image cap, not the stale 3), add Veo model choice UI (lite for cheap iterations, full for
   the final render), consider muapi's image-edit tool as an alternative batch source.

   **Status (2026-08-09 enrichment run — first two items shipped):** on inspection, the
   `resources/gemini-mcp.cjs` wrapper already had both underlying capabilities from the
   "Connector reality check" pass (`4f93dc3`, predates this routine) — `MAX_REFERENCE_IMAGES = 10`
   on `gemini_generate_image`, and a `model` param on `gemini_generate_video` accepting the three
   Veo 3.1 variants. Neither was reachable from the UI: `MotionGraphicsWizard.tsx`'s References
   stage capped picks at 5 (`ids.length < 5`), and nothing ever set `modelHint` for the Animate
   stage's `generateMedia` call. Fixed both: raised the picker cap to `MAX_REF_IMAGES = 10`
   (matches Gemini's harder limit; OpenAI's wrapper takes even more, uncapped), and added a
   quality-tier `<select>` on the Animate stage (default veo-3.1 / fast / lite) that sets
   `modelHint` to the literal Veo model id — `generation.ts`'s `buildPrompt` already turns
   `modelHint` into a prompt line, and the literal id matches `gemini_generate_video`'s own
   `model` enum exactly, so the agent has an unambiguous string to pass through rather than a
   label to interpret. Only shown when Gemini is connected, since Animate's `connectorId` already
   restricts to Gemini in that case. `npm run typecheck` clean. **Not run live** — no Gemini key
   configured in this sandbox; the wiring is real, the actual Veo call is unverified, same
   ceiling as every other pass. Third item (muapi image-edit as a second batch source) is real
   scope — a genuinely different generation path, not a parameter wire-up — and is left for a
   future pass rather than rushed in the same run as the two smaller fixes above.
3. **Generate video** — currently single-shot t2v; enrich with i2v (a canvas image node as the
   starting frame — Gemini already supports this structurally, just not surfaced on this tile)
   and per-model routing beyond muapi (Yapper's ~20-model catalog is currently invisible here).

   **Status (2026-08-09 enrichment run — both items shipped):** `VideoScreen` (`AsidePanel.tsx`)
   gained two "More options" pickers. A **starting-frame picker** lists ready, non-panel canvas
   image nodes; picking one sets `GenerationParams.startFramePath` to that node's `src` and forces
   `connectorId: 'gemini'` — the only wired i2v path per the capability matrix (muapi/fal both need
   `asset-upload` first, still open plumbing). This reuses `startFramePath` exactly as the Motion
   graphics wizard's Animate stage already does; no new main-process plumbing was needed, only the
   picker UI and the routing override. A **Yapper model picker** (`YAPPER_VIDEO_MODELS`, ~20
   entries transcribed from `docs/connectors/reference/yapper.md`'s model table) sets `modelHint`
   to the literal model id (`sora-2`, `kling-3.0-pro`, `seedance-2.5`, …) and forces
   `connectorId: 'yapper'` — same literal-id-as-modelHint pattern the Veo quality-tier picker
   established in row 2, so the agent gets an unambiguous string to match against
   `yapper_start_process`'s own `model` enum rather than a label to interpret. The two pickers are
   mutually exclusive by precedence (a starting frame always wins, since only Gemini can honor it);
   the existing manual connector `<select>` still works when neither is set. `npm run typecheck`
   clean (ran `npm install --include=dev` first — this sandbox's `node_modules` was missing
   `@types/node` and other devDependencies despite `node_modules/` existing, a stale/partial
   install from an earlier pass rather than a truly fresh one). **Not run live** — no Gemini or
   Yapper key configured in this sandbox; the wiring is real (both fields reuse already-verified
   plumbing — `startFramePath` from row 2, `modelHint` from rows 1/2), but the actual tool calls
   are unverified, same ceiling as every prior pass. Nothing left unbuilt on this row's two named
   items; muapi/fal i2v (blocked on `asset-upload`) is out of scope for a "surface what already
   works" pass and belongs with the cross-cutting `asset-upload` helper instead.
4. **Generate image** — LoRA integration exists for storyboard tier; extend the same
   `lora-use` path to production tier, and consider Krea 2 direct (`styles:[{id,strength}]`) as
   a second LoRA-application route alongside fal.

   **Status (2026-08-09 enrichment run — both items shipped):** on inspection, `ImageScreen`
   (`AsidePanel.tsx`) had a real bug, not just a missing feature: a picked `TrainedStyle` always
   forced `connectorId: 'fal'`, ignoring the style's own `connectorId` field entirely (`'krea' |
   'fal'`, per `shared/types.ts` — a field that's existed since before fal became the default
   trainer, for exactly this routing purpose, and was simply never read). Fixed the routing to
   dispatch on `style.connectorId` instead of hardcoding `fal`. To make that reachable, resurrected
   `src/main/krea-training.ts` (removed at `4e96389` when fal's published per-step pricing became
   the default trainer, kept in git history for "if that route ever comes back" — it has, as a
   second, opt-in trainer, not fal's replacement): `POST /styles/train` (Krea's own REST-only
   training endpoint, `model: 'k2'`), asset upload for local training images (`POST /assets`,
   multipart, response field name undocumented so several candidates are tried before falling back
   to a base64 data URI), then `GET /jobs/{id}` polling for the resulting `style_id`. `fal-
   training.ts`'s `trainStyle()` dispatches to it when `trainer === 'krea-k2'`, so the existing
   `lora:train` IPC channel/preload/bridge needed zero new plumbing — the Create › Create a LoRA
   screen just gained a third trainer option ("Krea 2 direct — production styles route") beside
   the existing fal krea-2/flux-krea picks. **This closes both queue items in one fix**: it's the
   second LoRA-application route (Krea's `styles:[{id,strength}]`, which only Krea 2 endpoints
   accept), and it's the first genuine *production-tier* LoRA path — a Krea-trained style now
   honors the Storyboard/Production tier toggle (K2 medium $0.03 vs. K2 large $0.06, "highest
   quality K2"), where fal's weights-URL route is and remains tier-agnostic (a fal-trained style
   always uses the same weights regardless of tier — there's no fal equivalent to swap in for
   "production quality," so that half of the gap can't close without Krea). `npm run typecheck`
   clean (`tsconfig.node.json` + `tsconfig.web.json`). **Not run live** — no Krea key configured in
   this sandbox, and live spend is out of scope for the autonomous routine either way; the
   `/styles/train` request shape and `GET /jobs/{id}` poll match the prior (verified-against-docs,
   never live-tested) implementation exactly, so risk is concentrated in the one part that was
   always undocumented — the `POST /assets` upload response's field name — which is why that call
   defensively tries three candidate field names before falling back to a data URI rather than
   assuming any single shape. `catalog.md`'s Krea section and `capability-map.md` updated in this
   commit to stop describing this as a removed/unrouted path.
5. **Generate audio** — voice library is solid; add Yapper's free daily-tier TTS as a zero-cost
   fallback route, and Suno-via-muapi as a music alternative when ElevenLabs isn't connected.

   **Status (2026-08-09 enrichment run — first item shipped):** the Voice job now auto-routes to
   Yapper's synchronous `POST /audio/speech` (free daily-character tier, `yapper-rest.ts`'s new
   `synthesizeYapperSpeech()`) when ElevenLabs isn't connected and the `yapper-rest` REST key
   (already built for Deepfake's upload path) is set — no agent turn, a direct fetch call exactly
   like `elevenlabs-tools.ts`'s pattern. New `audio:yapper-tts` IPC channel end-to-end
   (`ipc-channels.ts` → `ipc.ts` → `preload/index.ts` → `bridge.ts`). The Voice tab's ElevenLabs-only
   browse/preview/voice-picker UI is hidden in fallback mode (one default voice, no browsing wired
   this pass) with a status line surfacing `freeCharactersRemainingToday` from the response.
   `npm run typecheck` clean. **Not run live** — no Yapper REST key configured in this sandbox; the
   request/response shape (`script`/`voiceId` in, `{url, freeCharactersRemainingToday}` out) is
   read directly from `docs/connectors/reference/yapper.md`'s verified OpenAPI enumeration, same
   confidence level as the upload flow it sits beside. **Left undone (closed next pass):**
   Suno-via-muapi as a music alternative — a materially different build than the TTS fallback, since
   `muapi_audio_create` is an agent-driven MCP tool (needs `generation.ts`'s agent path), not a
   synchronous REST call like Yapper's speech endpoint. Real scope for a future pass, not rushed
   into this one.

   **Status (2026-08-09 enrichment run, second pass — Suno-via-muapi shipped, row 5 fully closed):**
   `AudioScreen`'s Music job gained a `useMuapiMusicFallback` route (`!ready && muapiReady`, same
   naming/gating pattern as the Voice job's `useYapperVoiceFallback`) that calls the store's
   `generateMedia` (agent path, `connectorId: 'muapi'`, `modelHint: 'suno'` to disambiguate from
   muapi's other audio tool, `muapi_audio_from_text` — MMAudio SFX, not music) instead of the
   direct `bridge.audioTools.music()` call ElevenLabs's `compose_music` uses. This is a genuinely
   different UI shape than the rest of `AudioScreen`'s uniform `run()`/`addNode`-on-completion
   pattern: `generateMedia` creates a rendering canvas node immediately and resolves async, so the
   fallback branch renders through `ResultRow` (the same rendering→ready/error tracker Video and
   Deepfake already use) instead of this screen's synchronous status line. Added a small,
   real feature riding along for free: an "Instrumental only" checkbox that appends "Instrumental
   only, no vocals." to the prompt — `muapi_audio_create`'s own `make_instrumental` param, exposed
   without adding a new `GenerationParams` field, the same embedded-directive pattern Deepfake's
   Stage 2 chain note already established for the agent to read and act on. `npm run typecheck`
   clean (`tsconfig.node.json` + `tsconfig.web.json`, fresh `npm install` in this sandbox — no
   `node_modules` present). **Not run live** — no muapi key configured in this sandbox, and live
   spend is out of scope for the autonomous routine regardless; the wiring reuses the same
   `generateMedia`/`buildMcpServers` plumbing that rows 1–3 already exercised (not a new mechanism),
   so risk is concentrated in whether the agent actually calls `muapi_audio_create` over
   `muapi_audio_from_text` given the `modelHint`, which is unverified until a joint session. Row 5
   has nothing left buildable blind; next run should move to row 6 (Create a LoRA).
6. **Create a LoRA** — already dual-trainer (Krea 2 / FLUX Krea); enrich with a "train from
   this deepfake's reference photos" shortcut once step 1's Reference-person concept exists.

   **Status (2026-08-09 enrichment run — shipped):** the Deepfake screen's face/performance node
   picker now shows a "Train a LoRA from this photo" button whenever the currently-picked node is
   a still image (video source nodes are excluded — neither trainer accepts a video input, and
   picking a representative still is a design choice a real user should make, not one to guess
   automatically by grabbing a frame). Clicking it navigates to the Create a LoRA screen with that
   image already in the training set (`kind` defaults to "Subject / character" rather than
   "Style," and `name` defaults to `"<Reference person> — LoRA"` when a person was picked, or the
   node's own label otherwise) — a genuine shortcut, not a dead end: the LoRA screen's own file
   picker now *adds* newly-picked images to whatever's already selected (a small dedup'd merge,
   `[...new Set([...prev, ...picked])]`) instead of replacing the selection outright, so the
   prefilled photo survives the user rounding out the set to 4+ images afterward — previously each
   picker click silently discarded the prior batch, which would have undone the whole point of the
   shortcut.

   The part of this that took actual investigation rather than being a straightforward UI wire-up:
   the shortcut is only real if the resulting `imagePaths` array can *contain* a canvas node's
   `src`, and canvas node sources are `lyme-asset://<file>` URLs (everything generated, uploaded,
   or downloaded gets copied into `userData/assets` and referenced that way — see
   `asset-store.ts`), never raw filesystem paths. Both trainers (`fal-training.ts`,
   `krea-training.ts`) call `readFileSync(path)` directly on each entry in `imagePaths` — correct
   for what the native file-picker (`bridge.media.pickFiles`) always returned before now, wrong for
   a `lyme-asset://` URL, which would have thrown `ENOENT` trying to open a string that isn't a
   filesystem path at all. Checked whether this resolution already existed anywhere before adding
   it: `ipc.ts`'s `scriptingTurn` handler *does* already resolve `lyme-asset://` URLs via
   `assetPathForUrl()` for the Motion graphics wizard's vision input (a case of exactly this same
   canvas-node-as-input-to-a-main-process-call shape) — but the `lora:train` handler two cases
   below it in the same file never got the equivalent treatment, because until this shortcut
   existed there was no code path that could hand it a `lyme-asset://` URL in the first place.
   Added the same one-line resolve-and-filter to `lora:train`'s handler, matching the existing
   pattern exactly rather than inventing a new one. This also means any *future* caller that wants
   to train a LoRA from a canvas node (not just this one shortcut) gets the capability for free —
   it's IPC-layer plumbing, not shortcut-specific code.

   `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`). **Not run live** — no
   fal or Krea key configured in this sandbox; unlike most rows so far, this one has almost no
   live-call risk to flag even once keys exist, since nothing about *how* the trainer consumes
   `imagePaths` changed — only *which strings* can validly appear in that array before reaching the
   unchanged `readFileSync` call. `creative-nodes.md`'s Create a LoRA tile row and Deepfake stage
   list updated in this commit. Row 6 has nothing left buildable blind; next run should move to
   row 7 (Combine).
7. **Combine (canvas drag-onto-node)** — still a stub. Real semantics belong here:
   image+image → `image-ref-conditioning` mix; image+audio → `video-gen-i2v` with lip-sync if
   the image is a face. This is where several matrix ○ cells become real UI.

   **Status (2026-08-09 enrichment run — the two named pairs shipped):** on inspection, no new
   main-process plumbing was needed at all — `GenerationParams.referenceImagePaths` (image+image)
   and `sourceMediaPath`/`referenceAudioPaths` (audio+image) already exist and are already
   resolved from `lyme-asset://` URLs to disk paths by `generation.ts`'s `toDiskPath`, because
   rows 1 and 2 built and proved that exact plumbing for Deepfake's Stage 2 and Motion graphics'
   References stage. The actual gap was narrower than it looked: `CombineDialog.tsx` never called
   `generateMedia` at all — `confirmCombine` in `store.ts` always spawned a placeholder node on a
   stub timer, for every pair, with no way for the user to even type what the combination should
   produce (the dialog's blurb said "prompt how they should mix" but there was no textarea).
   Fixed both gaps together: the dialog gained a prompt textarea (shown only for the two
   generative pairs), and `confirmCombine` now dispatches image+image through `generateMedia`
   with `referenceImagePaths: [source.src, target.src]` and mediaType `'image'`, and audio+image
   (either drag order) through `generateMedia` with mediaType `'video'`,
   `sourceMediaPath: <image src>`, `referenceAudioPaths: [<audio src>]` — the identical chain
   Deepfake's Stage 2 uses, minus the `connectorIds` restriction: Deepfake restricts to
   muapi+Yapper because its chain note steers a specific upload-then-lipsync sequence across
   exactly those two; Combine has no such sequence to steer, so it leaves the connector
   unrestricted and lets the agent pick from whatever's installed, same posture as Generate
   video/image's default routing. Since nothing can detect whether the image is actually a face,
   the prompt embeds the branch as an instruction for the agent to judge itself: "If the image
   shows a face, lip-sync its mouth to the audio like a talking avatar. Otherwise animate the
   still to the mood and pacing of the audio and use the audio as its soundtrack." — the same
   prompt-embedded-directive pattern row 5's instrumental-only checkbox and row 1's chain note
   already established for steering agent judgment through plain text rather than a new typed
   field. The Combine button now disables until both dragged nodes are `status: 'ready'` (real
   file paths are required; a stub-rendering node has none yet), a guard the placeholder path
   never needed since it didn't touch a real file. The other four pairs (video+video,
   image+video, audio+video, audio+audio) deliberately keep the placeholder-node stub — those are
   ffmpeg-level compositing jobs (stitch/score/mix), not agent generations, and belong with the
   Cut Room's export pipeline (row 9) rather than this dialog; scoping them into this pass would
   have meant inventing a new local-compositing mechanism blind, not wiring an existing one.
   `npm run typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`, fresh `npm install` in
   this sandbox — no `node_modules` present at run start). **Not run live** — no connector keys
   configured in this sandbox; the wiring reuses `generateMedia`/`buildMcpServers`/`toDiskPath`
   exactly as rows 1 and 2 already exercised it, so the only genuinely new-and-unverified part is
   whether the agent reliably follows the face-vs-not branch instruction, which needs a joint
   session to actually watch. `creative-nodes.md`'s Combine section and `capability-map.md` (§3's
   node table gained three Combine rows, §4's muapi image-edit bullet corrected) updated in this
   commit. Row 7's two named items are both closed; the four ffmpeg-compositing pairs are a
   distinct, larger piece of scope better left for whoever tackles row 9 (Timeline / export).
8. **Storyboard / Scripting** — agent-plumbing enrichment: let a script's tone inform which
   voice/LoRA a Deepfake-shot panel should default to.

   **Status (2026-08-09 enrichment run — shipped):** the missing link was that Storyboard panels
   and the Deepfake tile had no relationship at all — a script-born panel's `feeling` annotation
   (the "generalized feeling," already the exact tone signal `scripting-panel.md` describes) had
   nowhere to go except a panel's own `note` via the ✨ improve call, and the Deepfake screen had
   no way to receive anything from outside itself. Two pieces closed the loop. First, `TrainedStyle`
   gained an optional `personaTone` free-text tag (Settings › Trained styles, same inline
   input+Save shape as the existing `voiceName` field it sits beside) — a Reference person can now
   describe its own tone ("calm authoritative newsreader") the same way it already describes its
   voice. Second, a script-born panel (has `shotDescription`) gained a "☺ Send to Deepfake" action
   beside its existing ✨ button: it writes `{script: shotDescription, toneHint: feeling}` into a
   new `deepfakeHandoff` store field, which the Create panel's aside (`AsidePanel.tsx`) watches to
   auto-navigate to the Deepfake screen, prefill the script textarea, and auto-select whichever
   Reference person's `personaTone` shares the most words with the shot's `feeling`
   (`suggestReferencePerson` — plain lowercase word-set overlap scoring, deliberately not an agent
   call, since matching two short tags doesn't need one and every avoided agent call is one less
   thing to verify live). No tagged Reference person, or no overlap at all, is treated as a real
   "no suggestion" rather than a forced guess: the screen still prefills the script and shows a
   status line explaining why nothing was picked, so the user isn't left wondering whether it tried.
   This is a genuinely different shape than the fields-only wire-ups most other rows shipped — it's
   the first row-8-style feature to move state *between* two different Create-panel screens rather
   than adding a parameter inside one, using the same `loraPrefill`/`onTrainFromFace` cross-screen
   state-lift pattern row 6 established for "Train a LoRA from this photo," generalized from
   component-local state (that one lived inside `AsidePanel` itself) to the zustand store (this one
   has to cross from `StoryboardView`, a sibling component, into `AsidePanel`). `npm run typecheck`
   clean (`tsconfig.node.json` + `tsconfig.web.json`, fresh `npm install` in this sandbox — no
   `node_modules` present at run start). **Not exercised in a running browser** — no display in this
   sandbox to click through the actual handoff, so the wiring is typecheck-verified but not
   click-verified; flagging this explicitly since every other row at least got a live-key caveat
   while this one has no connector call to caveat about, and a UI-flow bug (wrong screen, stale
   state) would be a different failure mode than the "unverified API shape" risk every prior row
   carries. `creative-nodes.md`'s Storyboard panel and Reference person sections, and
   `capability-map.md`'s node table, updated in this commit. Row 8 has nothing named left to build;
   the queue moves to row 9 (Timeline / export) next, per priority order — lower priority per this
   doc's own seed note, so a future pass should treat it as a gap-search rather than assume there's
   a ready-made build order waiting the way rows 1–8 had.
9. **Timeline overlay / export** — lower priority; the ffmpeg pipeline is already deep.

   **Status (2026-08-09 enrichment run — the gap row 7 explicitly left open closed):** row 7's own
   writeup named the concrete gap here: Combine's four non-generative pairs (video+video,
   image+video, audio+video, audio+audio) still spawned the Phase 2 placeholder "combined" node
   because giving them real semantics meant designing local ffmpeg compositing this codebase didn't
   have yet — scoped out of row 7 as "belongs with row 9." This pass built exactly that, as a
   self-contained addition alongside the existing multitrack export code rather than a rewrite of
   it: four new pure args builders in `media-tools.ts` (`buildStitchArgs`, `buildOverlayImageArgs`,
   `buildScoreArgs`, `buildMixAudioArgs`, following `buildAlphaKeyArgs`'s existing shape exactly —
   a pure function returning an argv array, unit-testable without spawning ffmpeg), one dispatcher
   (`combineLocal`, keyed on a new `CombineLocalKind` union), one IPC round trip
   (`media:combine-local`), and `store.ts`'s `confirmCombine` gained a `localCombineFor` helper that
   maps a dragged pair's two `MediaType`s onto the right kind — mirroring the store's own
   `generateMedia` node-lifecycle pattern (add a `rendering` node synchronously, patch it to
   `ready`+`src` or `error` when the async ffmpeg call resolves) rather than `addNode`'s old
   fake-timer stub, which never touched a real file at all. video+video normalizes both clips to
   the shared 1080×1920/30fps export canvas before `concat` (two independently generated clips can
   differ in resolution/fps); its one real judgment call is what happens when only one clip has
   audio — concat's `a=1` requires every segment to carry a stream, and there's no ffprobe here to
   measure a missing track's duration for a matching silent filler, so the honest choice was
   video-only output when either side is silent, documented as a real decision rather than a silent
   gap. image+video draws the still centered/scaled-to-fit over the clip's full duration
   (`overlay=...:shortest=1`), passing the clip's own audio through unmixed via `0:a?`.
   audio+video mixes the new audio with the clip's own (when it has one) rather than silently
   replacing it, `-c:v copy` since the video stream itself is untouched. audio+audio reuses the
   *exact* `amix=...:normalize=0` convention `ffmpeg.ts`'s own multitrack export already
   established, deliberately not inventing a second mixing convention. `CombineDialog.tsx` now
   requires both dragged nodes to be `ready` with a real `src` for every pair (previously only the
   two generative pairs enforced this), and only shows the prompt textarea for the two pairs that
   still need one — the four local pairs are deterministic per the media-type pair, so there's
   nothing for a prompt to disambiguate; the "Stub for now" placeholder text is gone. `npm run
   typecheck` clean (`tsconfig.node.json` + `tsconfig.web.json`, fresh `npm install
   --include=dev` in this sandbox — no `node_modules` at run start). **Not run live** — but unlike
   every other row, "live" here just means "against a real ffmpeg binary with real media," not a
   billed connector call at all, so this is the lowest-risk kind of unverified code this queue has
   shipped: no API key, no spend, no agent-tool-choice uncertainty to flag, only "does this exact
   filter graph run clean," the same category of risk `buildMultitrackArgs` already carries and was
   verified for real at Phase 7. A human should still run one of each pair once in the app to
   confirm — this sandbox has no display and no sample media to hand-run ffmpeg against outside the
   app's own asset store. `creative-nodes.md`'s Combine section and `capability-map.md`'s §3 table
   row updated in this commit. Nothing named is left open on row 9 from row 7's handoff; a future
   pass should treat any further row-9 work as its own gap-search (transition dialog, clip-onto-
   clip stretch goal, etc.) rather than assume more is queued here.
10. **Listing photos (ChatRealty)** — analyzed above; all four build-order items shipped: cover
    render, Scripting-panel CMA context, the carousel slide builder, and agent-in-photo staging.
    Row 10 is fully closed, and with it the entire ten-row queue.

## What "enrichment" means per run (guardrails for the automated routine)

- Real code where safe: new plumbing (asset-upload helper, Reference-person type, stage UI),
  wiring existing-but-unused tools (ElevenLabs voice_clone into Deepfake, muapi face-swap) —
  all of this is zero-risk because none of it fires a live paid call on its own; the user still
  presses Generate.
- **Never** make a live billed API call autonomously — the standing project rule
  (`AGENTS.md` §0) that live generation verification is joint-session work.
- Docs updated in the same commit as code, per `AGENTS.md` §1.3 — this file, the capability
  map, and `creative-nodes.md` all stay in sync with what actually got built.
- Every run appends to `../reports/node-enrichment-report.md`, whether or not it shipped code —
  a research-only or blocked run is still worth a paragraph.
