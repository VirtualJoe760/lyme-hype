# Connector catalog — what each tool is for

The generic mechanism is [model.md](model.md). This doc is the opposite of generic: which specific tools are connected, why *that* tool for *that* job, and the exact connect shape for each. Researched 2026-08-08, routing intent refined the same day once real usage patterns (cost, quality, specialty) became clear.

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
| LoRA / custom style training | — | **Krea** | The one thing in this catalog that isn't "generate media" — trains a reusable style/character weight from example images |
| Deepfake / face-swap / lip-sync | — | **Yapper** | Purpose-built for likeness — talking avatars, face-swapped templates, voice-cloned lip-sync. Not what muapi/fal's general video models are for |
| Real-estate listing data | — | **ChatRealty** | Not generation at all — the data connector that started this whole model (Phase 3) |

## muapi — video primary, general fallback

- **Key page:** `muapi.ai/access-keys` · **Connect:** stdio `npx -y muapi-cli mcp serve`, `MUAPI_API_KEY` · **Status: built-in, installs today.**
- Covers image + video + audio (Seedance, Kling, Veo, Flux, Midjourney V7, Suno) behind one key — the practical reason it exists in the catalog at all despite the markup, since Seedance's only broadly-accessible direct path (BytePlus ModelArk) has meaningfully higher signup friction.
- **Routing intent:** the agent's default video connector. Midjourney access also happens through here (see below) since Midjourney has no API of its own.

## ElevenLabs — voice, music, SFX

- **Key page:** `elevenlabs.io/app/settings/api-keys` · **Connect:** stdio `uvx elevenlabs-mcp`, `ELEVENLABS_API_KEY` (needs the `uv` runtime on the machine) · **Status: built-in, installs today.**
- Direct-to-source — no aggregator sits between Lyme Hype and ElevenLabs. Covers all three of voice, music, and SFX; they don't need separate connections, it doesn't matter to Lyme Hype that they're conceptually different products under the hood.

## Midjourney — production-tier image, via muapi

- **No standalone connector** — Midjourney has no accessible official API as of 2026. Reached exclusively as a model inside muapi (V7/V8/Niji).
- **Routing intent:** the "I'm committing to this shot" image tier. When a Storyboard panel is promoted and its media type is image, generation should prefer Midjourney (via muapi) over the cheap storyboard-tier models — see [Wiring the tiers](#wiring-the-tiers-not-yet-built) below for the mechanism that will enforce this.

## Gemini — storyboard-tier image (+ video)

- **Key page:** `aistudio.google.com/apikey` · **Connect:** stdio, `GEMINI_API_KEY` · **Status: built and installable.**
- **Built in-house, not a community package.** `resources/gemini-mcp.cjs` is a dependency-free plain-Node stdio MCP server hitting Google's Generative Language REST API directly — no first-party Gemini media MCP exists, and per the direct-to-source preference, a thin owned wrapper beats depending on an unvetted community server. Two tools: `gemini_generate_image` (Nano Banana) and `gemini_generate_video` (Veo — long-running op, polled, downloaded in-process with the key so the file never needs a public URL).
- Image/video are **paid-tier keys** on Google's side (the free tier is text-only).
- **Routing intent:** one of two interchangeable storyboard-tier image options (see OpenAI below) — cheap, fast, good enough to judge a shot before spending on Midjourney.

## OpenAI — storyboard-tier image

- **Key page:** `platform.openai.com/api-keys` · **Connect:** stdio, `OPENAI_API_KEY` · **Status: built and installable (2026-08-08).**
- **Built in-house, not a community package** — same situation and same call as Gemini: no first-party OpenAI image MCP exists, community servers (`SureScaleAI/openai-gpt-image-mcp`, `spartanz51/imagegen-mcp`) were passed over for a small **owned** wrapper. `resources/openai-image-mcp.cjs` is a dependency-free plain-Node stdio server, one tool: `openai_generate_image` — `POST /v1/images/generations` (model `gpt-image-1`) for text-only prompts, and `POST /v1/images/edits` (multipart) when `reference_image_paths` are passed, so reference-conditioned generation (the Motion graphics workflow's stage-5 need) is supported from day one. gpt-image-1 returns base64, so results hand off as `RESULT_FILE:` like Gemini's.
- **Routing intent:** the second of the two interchangeable storyboard-tier image options. Per the user's call: both Gemini and OpenAI get installed, and the Storyboard's per-node model choice is just "whichever the user picks" — Lyme Hype doesn't need to pick a winner between them.
- The selftest now includes a protocol smoke test for **both** bundled wrappers (spawn, handshake, tools/list with a dummy key — no billed call); the Gemini wrapper never actually had one before this.

## Krea — LoRA / custom style training

- **Key page:** `krea.ai/settings/api-tokens` · **Connect (general image/video/3D):** http MCP `api.krea.ai/mcp`, bearer `Authorization` · **Status: general connector built and installable; training is NOT reachable through it (see gap below).**
- **What LoRA training actually is:** teaching a model (Flux, Wan, and others Krea supports) a new subject, character, or visual style from a small set of example images, producing reusable LoRA weights usable at inference time. This is a genuinely different capability from "generate an image" — it's a training job, not a generation call.
- **Confirmed API surface (2026-08-08 research):** `POST https://api.krea.ai/styles/train`, bearer token auth, async (submit → job id → poll `queued`/`processing`/`completed`, or a webhook), priced at $0.003/step with a 100-step minimum (~$0.30 minimum, $3.00 for 1000 steps).
- **Known gap — training is REST-only, not exposed over Krea's MCP server.** Krea's own developer docs describe `/styles/train` purely as a standalone REST endpoint; there's no mention of it appearing in `api.krea.ai/mcp`'s `tools/list`. That means Lyme Hype's current agent-driven generation path (which only ever calls MCP tools — `allowedTools` is scoped to `mcp__<server>`, nothing else) **cannot reach LoRA training today**, even with the Krea connector installed and working for general generation. Confirm by actually testing the connector and reading its live tool list before assuming this is permanent — Krea may add it to the MCP surface later, or the general connector's tool list may already include something this research missed.
- **What it would take to build:** either (a) Krea exposes training via MCP later and it just works through the existing agent path once discovered, or (b) a dedicated one-off "Train a style" action that calls the REST endpoint directly, outside the normal `mcp__` tool-call pattern — a deliberate exception to the "everything through MCP" model, not a pattern to generalize.

## Yapper — deepfake, face-swap, lip-sync

- **Key page:** `yapper.so/account/developer` · **Connect:** http MCP `yapper.so/mcp/connector`, **OAuth** (no key to paste) · **Status: built and installable.**
- **Confirmed capability (2026-08-08 research):** Yapper's actual differentiator is its "Max Lip-Syncing" model — talking avatars and character vlogs from a reference video/image plus a cloned voice and a script, plus a template-based Face Swap tool (swap a face into a trending meme/video template). This is a genuinely different job from muapi/fal's general video generation — it's likeness manipulation specifically, not "generate a video from a text prompt."
- **Routing intent:** the connector to reach for whenever a shot needs a specific person's (or character's) face/voice driving a clip, rather than a generated scene. Not a video-generation fallback alongside muapi — a specialty tool for a specialty job.
- **Credential mechanism:** OAuth via `mcp-oauth.ts` — the connector card shows "Connect account" instead of a secret prompt; nobody types anything.

## ChatRealty — real-estate data

- Not generation — a data connector. Full detail already lives in [model.md](model.md)'s history and the original Phase 3 build notes in `build-plan.md`; kept out of the routing table's "why this tool" framing above since it isn't competing with anything else in the catalog for a job. Stdio, bearer token (`CHATREALTY_API_TOKEN`, must be `crt_live_…`), hosted base `https://jpsrealtor.com`.

## Wiring the tiers (not yet built)

The routing intent above (video → muapi; production image → Midjourney/muapi; storyboard image → Gemini or OpenAI; LoRA → Krea; deepfake → Yapper) is currently **enforced by nothing** — `src/main/generation.ts`'s `GenerationParams` already has an optional `connectorId` field to restrict a call to exactly one connector, but no caller in the UI passes it today. The aside's Generate button and Storyboard's promote-with-a-note both call `generateMedia` with no `connectorId`, so the agent freely picks among *every* installed connector for the requested media type — including picking a storyboard-tier model when the user meant to spend on Midjourney, or vice versa.

**To build:** wire `connectorId` through from the UI —
- Storyboard panels: a per-panel model choice (Gemini vs. OpenAI) for image panels, defaulting to whichever is installed if only one is.
- Canvas Generate (the "real spend" tier): either leave unrestricted so the agent picks the best available, or explicitly bias toward Midjourney-via-muapi for image and muapi for video by default, with an escape hatch to pick a specific connector.

This is UI + a small amount of store/IPC wiring, not a new architectural idea — the restriction mechanism already exists in `generation.ts`.

## Known gaps, summarized

- ~~OpenAI image connector~~ — built 2026-08-08 (see above).
- Krea LoRA training — REST-only, not reachable through the current agent-driven MCP-only generation path (see above).
- Connector-tier routing — the mechanism exists (`connectorId`), the UI doesn't wire it yet (see above).
- Agent tool-selection with multiple similar connections generally (not just image tiers) — still unconfirmed by an actual multi-connector generation test; see the open question carried in `../architecture/platform-decisions.md`.
- **Generation is text-prompt-only — no reference-image input, no frame conditioning.** Confirmed while designing the Motion graphics workflow (`../ui/create-panel.md`): `GenerationParams` has no field for passing images into a generation call, so techniques like "mix these reference images' style into the output" (image generation) or "animate from this start frame to this end frame" (Veo video, which supports it natively — `resources/gemini-mcp.cjs` just doesn't expose it) aren't reachable today. A real gap, not a hypothetical one — surfaced by a concrete reference workflow, not speculation.
- **No batch-generate-and-compare UI.** Every generate flow today produces exactly one node per call. Techniques that generate several variations and let the user pick a favorite (also from the Motion graphics workflow) have no UI surface to land in yet.
- **Export has no alpha-channel path.** `ffmpeg.ts`'s `buildConcatArgs` targets opaque 1080×1920 `libx264` reels only; a transparent watermark/overlay output (also from Motion graphics) needs a different, alpha-capable codec this pipeline doesn't build yet.
