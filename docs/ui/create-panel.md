# Create panel (formerly "Add to canvas")

**Built (2026-08-08).** Replaced `src/renderer/src/components/AsidePanel.tsx`'s flat form — media tabs, mode tabs, one prompt box, dimension chips, Generate/Upload/Link buttons, and an agent-link test card all stacked in one scroll — with the two-level, task-first UI this doc specifies. The old panel read as "functionality and testing slapped together" because it was one: every control for every job lived on screen at once.

**Implementation calls made during the build, where this spec left room:**

- **ChatRealty's pull card became its own tile** ("Listing photos") rather than staying pinned under every screen — it's a task like any other. The agent-link card stays at the bottom of the Home grid only (it's a diagnostic, not a task).
- **All four architecture gaps this doc confirmed are now closed:** `GenerationParams` gained `referenceImagePaths` + `startFramePath`/`endFramePath` (renderer sends asset URLs, main resolves to disk paths, the agent is instructed to pass them to the wrappers' matching tool params); both owned wrappers accept `reference_image_paths` (Gemini via inline image parts, OpenAI via the images/edits endpoint); the Gemini wrapper's Veo tool accepts `start_frame_path`/`end_frame_path` (`instance.image` + `instance.lastFrame`); and `media-tools.ts` adds the alpha-capable export path — `colorkey` → VP9/WebM `yuva420p`, chosen over qtrle/prores because Chromium plays VP9 alpha, so the keyed overlay previews in-app. The exact key command was run for real (output verified `alpha_mode=1`).
- **Isolate audio and alpha keying are `src/main/media-tools.ts`** — local ffmpeg, no agent, no connector spend, per this doc's standing principle. Direct-file URLs feed ffmpeg as the input verbatim; hosting-site URLs error with an explanation, per the firm v1 scope.
- **The audio jobs are `src/main/elevenlabs-tools.ts`** — direct `McpStdioClient` calls (the ChatRealtyPull shape), with `ELEVENLABS_MCP_BASE_PATH` pointed at a temp dir and the produced file's path parsed out of the tool's text reply and imported into the asset store. **v1 voice browsing shows the tool's raw text listing** and the user types the chosen voice name into a field — parsing the listing into structured picker rows was judged too fragile against an unpinned community server's output format; revisit if it grates. The path parser doesn't handle spaces in paths (the temp dir has none).
- **LoRA training is `src/main/fal-training.ts`** (superseding the short-lived Krea-native client — user call 2026-08-09, published pricing won): both fal Krea trainers (`krea-2` and `flux-krea`) selectable per run, style-vs-subject mode mapped to each trainer's captioning params, trigger word supported, images packed by a dependency-free store-only ZIP writer (verified against Python's zipfile) and uploaded via fal storage. Trained styles persist to `trained-styles.json` (now carrying the trainer + LoRA weights URL) and show in **Settings › Trained styles**.
- **A trained style in the Image tile routes via `connectorId: 'fal'`** with the weights URL in the model hint so the agent passes it to the paired inference model (`Krea 2 LoRA` / `fal-ai/flux-krea-lora`). Live verification of the hint → lora-param handoff is joint-session work.
- **Deepfake v1 is prompt + mode (lip-sync/face-swap) restricted to Yapper.** Local reference video/image upload is NOT wired: Yapper is a remote http MCP, and pushing a local file to it needs an upload mechanism its tool surface may or may not offer — check its live `tools/list` in a joint session before designing that flow. The screen says so when Yapper isn't connected.
- **Motion graphics** is `MotionGraphicsWizard.tsx`, all six stages + the loop bonus + the alpha pass, riding the Scripting panel's conversation plumbing for stages 2/4 exactly as Phase 11 intended. The animate stage draws the solid start frame locally on a `<canvas>` (a flat rectangle needs no generation call) and defaults its connector to Gemini/Veo when installed. `BatchResultsGrid` is the generic compare-and-pick component the decision below required.

## Title change

"Add to canvas" → **"Create."**

## Navigation model: tile grid → task screen → back

- **Home is a tile grid** — thumbnail icon tiles, one per task, reusing the visual language already established by `ConnectorsTab.tsx`'s suggestion tiles (`.suggestion-tiles`/`.suggestion-tile`: a colored thumbnail + label) rather than inventing a new tile pattern.
- **Tapping a tile replaces the panel's content with that task's screen** — only the controls relevant to that specific job, nothing else.
- **A back arrow returns to the tile grid.** Same interaction language Play view already uses for "← Back to Canvas/Storyboard" — this app already has a working back-arrow-from-a-takeover pattern, reuse it rather than inventing a second one.
- Navigation state (which screen is showing) is local UI state, not persisted `PersistedState` — there's nothing to lose by returning to the tile grid, it's pure navigation, not content.

## Cross-cutting principle: local ffmpeg over a paid API call, when they'd produce the same result

Stated directly while designing Isolate Audio, but it applies wherever it's true, not just there: **if ffmpeg can do the job locally, do it locally — it costs nothing and spends no connector tokens.** Reach for a connector only when the job genuinely needs a model (generation, training, transformation a local tool can't do). This is now a standing principle for future tile/connector decisions, not a one-off call — see the note added to `../connectors/catalog.md`'s routing philosophy.

## Tile catalog

### Generate video
Prompt box, aspect ratio / duration / resolution chips, model select — the controls that already exist in today's form, just given their own screen instead of sharing space with every other media type. Routes through `generation.ts` to the video-tier connector (muapi/Seedance primary, per `../connectors/catalog.md`).

### Generate audio
Per the original ask — this isn't one prompt box, it's a small set of ElevenLabs-backed jobs, most of which are direct tool calls (cheap, deterministic, no full agent turn needed) rather than agent-driven generation:

- **Voice (text-to-speech)** — browse/preview the ElevenLabs voice library (`search_voices` / `search_voice_library` — verified against the official server's live schemas; there is NO `list_voices` tool, an empty `search_voices` is the listing call), pick one, type the line, get audio back. The voice browser is a direct tool call pattern, same shape as `ChatRealtyPull`'s deterministic `search_listings` call — not routed through the full agent-driven `generation.ts` path.
- **Clone a voice** — "create their own audio LoRA," confirmed real and API-reachable: ElevenLabs' `create_voice_from_preview` / `create_voice_from_confirmed_audio` / `voice_clone` tools. Needs sample audio (upload or record) and produces a new voice usable in the picker above.
- **Music** — `compose_music`, prompt-driven.
- **Sound effects** — `text_to_sound_effects`, prompt-driven.

All four are real tools on the connector Lyme Hype already installs — nothing here is speculative.

### Generate image
Prompt box + aspect/resolution controls, plus — newly wired by this redesign — an explicit **tier choice**: Storyboard (cheap: Gemini or OpenAI, whichever is installed, or a picker if both are) vs. Production (Midjourney via muapi). This is the first place `GenerationParams.connectorId` actually gets driven from the UI — see the "Wiring the tiers" gap already flagged in `../connectors/catalog.md`; this tile is what closes it.

### Generate character (built 2026-09-03)
Lock list + up to three reference photos + one of twelve cartoon styles (Illustrious /
Pony checkpoints with a Civitai LoRA each) → N candidates side by side → a vision review
→ approve. The approved image becomes a **character node** on the canvas that any
Generate image run can take as its character reference. Local ComfyUI, deterministic
graphs, no agent turn, $0. Spec: [`character-sheets-and-assets.md`](character-sheets-and-assets.md);
provenance: `lyme-hype-lab`, where every engine step was live-verified first.

### Isolate audio
**Local ffmpeg, not a connector call, per the stated principle above.** Two source shapes:

- **An existing video node, or an uploaded file** — direct: `ffmpeg -i <file> -vn -c:a ...` extracts the audio track. Confirmed straightforward — no new external dependency.
- **A pasted video URL — including "ripping audio from different videos on the internet."** Split into two real cases, confirmed 2026-08-08:
  - **Direct file URLs** (a link that resolves straight to a `.mp4`/etc.) — ffmpeg can read the URL directly as its input and extract audio in one command, no download step needed. Verified for real against a live URL.
  - **Hosting-site URLs** (YouTube and similar, where the page isn't the media file itself) — ffmpeg alone can't resolve these; that needs a URL resolver like `yt-dlp` first, which isn't a dependency Lyme Hype has today. **The user mentioned possibly already having tooling built for this — worth checking before building a resolver from scratch.** Flagged as an open item, not assumed solved.
- Output lands as a new **Audio** node, same shape as any other audio node (upload-equivalent, not generate-equivalent) — no `MediaNodeData.source: 'generate'`, this didn't spend a generation call.

### Create a LoRA
Routes to Krea's **training** REST endpoint (`api.krea.ai/styles/train`), which — per `../connectors/catalog.md` — is confirmed NOT reachable through Krea's MCP server. This tile's screen is therefore a genuinely different mechanism from every generate tile above: a dedicated flow (upload training images, name the style, submit → the main process polls the job status directly, not through `generation.ts`'s agent-driven MCP path) rather than a prompt box.

**Open design question this raises:** a trained LoRA isn't a playable clip — it's a reusable input to *future* generations, not something that fits `MediaNodeData`'s node model at all. Where does it live once trained (a canvas node that just represents "this style exists," a separate list in Settings, something else), and how does a later Image generation pick it up as an input? Not designed — flagging honestly rather than forcing it into the existing node shape just for consistency.

### Generate a deepfake
Routes to Yapper (`../connectors/catalog.md`'s confirmed Max Lip-Syncing / Face Swap capability): reference video or image, a script or an existing voice to drive the lip-sync, or a template pick for the face-swap mode. Produces a video node, same as Generate video, just via a connector restricted to Yapper specifically rather than the agent choosing freely.

### Upload
The existing native-file-picker flow, unchanged in mechanism — promoted from a button inside the old form to its own top-level tile (per your call: Upload/Link get separate tiles, not folded into each generate task).

### Link
The existing paste-a-URL-and-download flow, unchanged in mechanism — same promotion to a top-level tile.

### Motion graphics
**One tile, not two.** The reference workflow (a JBook's Creative tutorial, transcript reviewed 2026-08-08) doesn't treat "motion effects" and "text animations" as separate jobs — a logo reveal *is* a typographic animation. Folding "Generate motion effects" and "Text animations" from the original tile list into a single **Motion graphics** tile matches what the real workflow actually does, rather than forcing an artificial split.

This is a genuinely multi-stage job, not a single prompt box — the tile's screen is a short wizard, stage by stage, each stage's output feeding the next:

1. **References.** The user supplies 4–5 reference images (existing Upload mechanism, or dragging in existing canvas nodes) — mood-boarding itself (the tutorial's `cosmos.so` browsing) happens outside Lyme Hype; the app's job starts once references are in hand, not before.
2. **Abstraction — an agent turn, not a generation call.** The references (as vision input) plus an instruction ("combine the style of these into a logo for the word '<X>'") go to the agent, which returns several **distinct text-prompt variations** — not images yet. This is new: nothing in the app today takes image input and returns *text*. Natural fit with the Scripting panel's planned persistent multi-turn conversation plumbing (`scripting-panel.md`) — this tile is a second concrete use case for that same infrastructure, worth building it generically enough to serve both rather than twice.
3. **Batch generate + grid review.** Each prompt variation generates a small batch of images (the tutorial ran 4 prompts × 4 images = 16 at once) laid out as a **comparison grid**, not added to the canvas one at a time as individual nodes. The user picks a favorite (or a few) to carry forward. **New UI surface** — nothing in the app today shows multiple generation results side by side for selection; every existing generate flow produces exactly one node per call.
4. **Iterate.** Plain-language feedback ("make it blue-purple, remove red") goes back to the agent, which revises the prompt; regenerate; repeat. Same underlying conversational mechanism as stage 2.
5. **Reference-reinforced final pass.** The winning prompt gets regenerated **together with the original reference images as input**, not text alone — "mix the styles of the reference images into the output of this prompt." **This is the single biggest architecture gap this workflow surfaces: `GenerationParams` today is text-prompt-only.** Nothing in `generation.ts` or any connector wrapper (`gemini-mcp.cjs` included) accepts reference images as generation input. Confirming this gap here rather than assuming it's already covered.
6. **Animate — start-frame/end-frame video.** The finished image becomes the **end frame**; a plain solid-color frame (matching its background) is the **start frame**; both feed a video model for a reveal animation. The tutorial uses Veo 3.1 specifically for this — which Lyme Hype already has wired (`resources/gemini-mcp.cjs`'s `gemini_generate_video`) — but **that wrapper is prompt-only today; it doesn't pass start/end frame images through to Veo's API, even though Veo supports that natively.** A second confirmed gap, same shape as #5 but on the video side. Prompt structure for this stage should be **time-segmented** (the tutorial breaks the animation into 2-second beats rather than one blob) — consistent with the structured-shot-prompt idea already noted from the jboogx precedent in `../history.md`.
7. **Bonus: looping variant.** Identical image as *both* start and end frame produces a seamless loop — same mechanism as #6, just both frame inputs set to the same image. Requires the source logo be generated on a flat, fully opaque background (no partial transparency in the letters) — a prompt-template constraint to carry into whatever default prompt scaffolding this tile ships with.
8. **Local transparency pass — ffmpeg, not After Effects.** The tutorial's last step keys out the black background in After Effects (Luma Key + an optional "Deep Glow" plugin) and exports QuickTime with an RGB+Alpha channel so the result can overlay on anything. **Per this doc's own stated principle (local ffmpeg over an external paid tool when equivalent), ffmpeg's own `lumakey`/`colorkey` filter can do the black-to-alpha keying natively** — no After Effects dependency needed for the core transparency step (the "Deep Glow" glow effect is a cosmetic AE-plugin nicety this wouldn't replicate exactly; an acceptable tradeoff to note, not silently drop). **Third confirmed gap:** the export pipeline's current codec (`libx264` targeting opaque 1080×1920 reels) has no alpha channel support at all — a watermark/overlay output needs a different, alpha-capable codec path (e.g. `qtrle` or `prores_ks` with alpha, or `vp9`/`webm` with alpha), which `ffmpeg.ts` doesn't have today.

**Summary of new architecture gaps this workflow confirmed** (none assumed solved, all real): (a) generation needs to accept reference images as input, not just text — image gen and video gen both; (b) a batch-generate-then-grid-review UI doesn't exist yet; (c) video generation needs start/end frame conditioning, at minimum for the Gemini/Veo wrapper; (d) the export pipeline needs an alpha-capable codec path alongside the existing opaque reels path. Cross-referenced in `../connectors/catalog.md`'s gap list so it's visible from that doc too, not buried only here.

## Architecture implications

Most tiles (Generate video/audio/image, Deepfake) funnel into the existing `generateMedia`/`generation.ts` path, now finally driven by `connectorId` restriction from the UI — this redesign is what wires the tier-routing gap `../connectors/catalog.md` already flagged as unbuilt. Several tiles need genuinely new main-process work, not just new UI:

- **Isolate audio** — a new ffmpeg-based extraction function + IPC channel (no agent, no connector spend). The internet-hosting-site case needs a resolver dependency decision first.
- **Create a LoRA** — a new Krea REST-training client (submit + poll), parallel to but separate from `generation.ts`'s MCP-only path.
- **Generate audio's voice browser** — a new direct-tool-call path against the ElevenLabs connector (list/search/preview voices) that doesn't go through a full agent turn, same shape as `ChatRealtyPull`.
- **Motion graphics** is the largest of these by far — it's the one tile whose stages don't fit the existing single-prompt-in, single-node-out shape at all. Four separate extensions, each real and each confirmed against a working reference workflow, not hypothetical: reference-image-conditioned generation (`GenerationParams` needs an image-input field; no connector wrapper accepts one today), a batch-generate-plus-grid-review UI (nothing like it exists), start/end-frame video conditioning (at least for the Gemini/Veo wrapper, since Veo supports it natively and `gemini-mcp.cjs` doesn't expose it), and an alpha-capable export codec path alongside the existing opaque-reels `libx264` path. None of these are needed by any other tile in this doc — they're specific to Motion graphics, and probably the right scope for a dedicated implementation pass rather than folded into a general Create-panel build.

## Decisions (firm, for an unattended build)

- **Where a trained LoRA lives:** a new **"Trained styles"** list in Settings (its own section, alongside Connectors/Models/Appearance) — `{ id, name, connectorId: 'krea', trainedAt, referenceImageCount }`. The Image generation tile's screen gets an additional picker (only shown when at least one trained style exists) to select one as an input alongside the tier choice. Simple, buildable, not forced into the `MediaNodeData` node model it genuinely doesn't fit.
- **Internet-audio-ripping resolver:** **v1 supports direct-file URLs only** (already proven to work with ffmpeg alone, no extra dependency). Hosting-site URLs (YouTube and similar) are explicitly **out of scope for v1** — the Isolate Audio tile's URL field can simply error clearly ("this site isn't a direct media link") rather than the build stalling on a resolver dependency nobody has handed over yet. Revisit if/when existing tooling gets shared or a resolver becomes a real priority.
- **Motion graphics batch size:** **2 prompt variations × 2 images each = 4 total** for v1, not the tutorial's 4×4=16 — real generation cost, and configurable later once actual usage shows the right number.
- **Motion graphics' agent-conversation plumbing is a hard dependency on Phase 11 (Scripting panel), not a parallel option.** Build Phase 11 first; Phase 13's Motion graphics stages 2 and 4 (abstraction, iterate) call the same multi-turn plumbing rather than building a second copy. If Phase 13 is ever started before Phase 11 for some reason, build the multi-turn plumbing generically at that point (main-process persistent `query()` session + streaming) so Phase 11 can then adopt it rather than the reverse.
- **The batch-results grid (stage 3) is a general, reusable component from the start**, not Motion-graphics-specific — `BatchResultsGrid` (or similar), taking N candidate results and returning the user's pick(s). Not meaningfully more work to build generally than bespoke, and other tiles (Generate image producing several options instead of one) are an obvious future consumer.
- Exact tile icon/thumbnail treatment — visual detail, not designed here; reuses the suggestion-tile CSS pattern as a starting point. Genuinely cosmetic, doesn't block logic.

## Open questions

None left that would block an unattended build.

## v2 (built 2026-08-09, same day as v1 — user-directed redesign)

After using v1, the user called for a redesign: "robust functionality, presented simply." The concept was designed first as an interactive page — **[`../concepts/create-panel-v2.html`](../concepts/create-panel-v2.html)** — then built to it after sign-off (full v2, all four questions answered):

- **Status-aware tiles**: every tile carries a readiness dot computed from the installed-connectors list (`hasCredential` included); unready tiles dim with a "needs X" chip but still open, and their screen's run-line shows a one-tap **Connect →** into Settings › Connectors. The three local tools (Isolate/Upload/Link) are always green.
- **The run-line** on every task screen: which connector/model the job will run on and its cost tier — the tier routing became a visible label instead of invisible policy.
- **Result rows replace silent-return-home**: Generate keeps you on the screen with a row tracking the node's rendering → ready/failed lifecycle (failure reason inline), and **view →** pans the canvas straight to the node (instant `setCenter`, deliberately un-animated — a cancelled animation silently goes nowhere).
- **A real voice picker**: the ElevenLabs listing parses into rows (name + tags, raw-text fallback if parsing fails) with a ▶ preview per voice — a tiny cached TTS call each (user opted in), selection fills the voice field. Music gained a length control (30s/60s/120s → `music_length_ms`), SFX a duration chip row (schema bound 0.5–5s).
- **The Motion graphics stepper**: six labeled dots, done stages clickable (state is retained, so "iterate" is just walking back), future stages gated on their prerequisites, everything locked while busy.
- **More options** discloses the sometimes-controls (resolution, connector override) so the prompt stays the hero.
- **The agent-link card moved to Settings › Models** — Create's home is tasks only.
- **Header layout (2026-08-09 markup feedback):** the back button sits top-left (where the collapse chevron used to be), the title is centered, and the collapse chevron is right-aligned; the interim full-width back row was removed.
- **LoRA routing** is the fal trainers (see the decision above), with the trainer picker, style/subject mode, and trigger word on the tile.

## Done when

The tile grid replaces today's flat form, and every tile opens its own focused screen with a working back arrow. Generate video / Generate audio / Generate image / Deepfake produce real nodes through the existing generation pipeline, just entered through a task-specific screen instead of one shared form. Motion graphics is its own, larger done-criteria given its scope: references in → agent-authored prompt variations → batch-generated grid → iterate → reference-reinforced final image → start/end-frame animated video → (bonus) a looping variant with its black background keyed to real alpha transparency via ffmpeg, no After Effects required.

*(Structurally met 2026-08-08: every tile + screen + back arrow verified in the browser preview; the local ffmpeg paths (audio extraction, colorkey → VP9 alpha with `alpha_mode=1`) executed for real against the machine's binary; the wizard's full stage flow is wired end to end. What remains untested is the same class of thing deferred everywhere else — live billed calls (a real batch generation, a real Veo frame-conditioned render, a real Krea training job, live ElevenLabs/Yapper tool output shapes), which are joint-session work.)*
