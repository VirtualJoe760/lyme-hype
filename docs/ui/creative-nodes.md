# Creative nodes — what the studio can make, and what each one needs

The connector reference files (`../connectors/reference/`) document what the outside tools can
do. This doc is the other half: **Lyme Hype's own creative building blocks** — every surface
that produces or transforms media — described by what goes in, what comes out, and which
*capabilities* (not which specific connectors) each one consumes. The join between the two
halves lives in [`../architecture/capability-map.md`](../architecture/capability-map.md);
capability names used here are defined there.

A "creative node" in this doc means any unit of creative work, not just a canvas node object:
canvas media nodes, storyboard panels, Create-panel tasks, the Motion graphics wizard's stages,
and timeline clips are all creative nodes at different lifecycle stages of the same media.

---

## The media lifecycle

```
   idea ──► Scripting (chat) ──► Storyboard panel ──► Canvas node ──► Timeline clip ──► Export
                                        ▲                  ▲
                 Create tasks ──────────┘──────────────────┘
                 (generate / upload / link / pull / transform)
```

Everything lands on the **canvas as a media node**; the timeline consumes ready nodes; export
bakes the timeline. Create tasks are the entry points that make or fetch media.

---

## Canvas media node

The atom. `MediaNodeData`: media type (image/video/audio), source (generate/upload/link),
status (rendering/ready/error), real media `src` (lyme-asset://), non-destructive `trimIn/Out`,
`audioMuted`, provenance (`genNote`, listing keys).

- **Inputs:** anything — every other creative node resolves into one of these.
- **Outputs:** Play view review (trim/split/detach audio), timeline placement (→ button appends;
  ⣿ grip drag places at an exact track/time), Combine (drag-onto-node), Motion graphics
  references (image nodes), Isolate audio source (video nodes).
- **Capabilities consumed:** none directly — nodes are the *results* of capabilities.

## Storyboard panel

A canvas node flagged `panel: true` — a cheap planning sketch that becomes the real node on
promote (same object, never a copy). Carries `label`, `note` (the generation prompt),
`shotDescription`/`feeling` when born from a script breakdown, and `connectorId` (the
storyboard-tier image model choice).

A script-born panel (has `shotDescription`) can also be sent to the **Deepfake** tile (☺ button
next to ✨) instead of promoted normally — for a shot that's really a talking-avatar line, not a
generic video/image/audio render. This sets `deepfakeHandoff` (`{script, toneHint}`, script =
`shotDescription`, toneHint = `feeling`) in the store; the Create panel's aside watches it, jumps
to the Deepfake screen, prefills the script, and auto-suggests a Reference person by matching
`toneHint` against each Reference person's `personaTone` tag (word-overlap scoring — see
"Reference person" below). 2026-08-09 enrichment run, row 8.

- **Capabilities consumed on promote:** `image-gen` (storyboard tier) / `video-gen-t2v` /
  `audio-*` per panel type, restricted by the per-panel model choice when set.

## Scripting conversation

The chat surface (per-session, persisted). Produces: the script itself, the shot breakdown
(→ fresh storyboard panels with `shotDescription`), and per-shot agent-authored prompts
(shot + feeling → panel `note`).

- **Capabilities consumed:** agent LLM only (no generation connectors). Its multi-turn plumbing
  (`conversations.ts`) is shared with the Motion graphics wizard.

## Create tasks (the tiles)

Every tile answers three questions before input (run-line): will this work, what runs it,
what does it cost. Readiness derives from the capability map's node→capability table.

| Tile | In | Out | Capabilities consumed |
|---|---|---|---|
| **Generate video** | prompt + aspect/duration/res (+ connector override, optional canvas-image starting frame, optional Yapper model pick) | video node | `video-gen-t2v` (any provider of it — muapi default when present); `video-gen-i2v` via a starting-frame image node (Gemini/Veo only — forces that connector, since it's the only wired i2v path today) |
| **Generate image** | prompt + aspect + tier toggle (+ trained style) | image node | `image-gen` (storyboard tier) or `image-production` (Midjourney-class); `lora-use` when a trained style is picked — routes through whichever backend trained it (fal weights-URL, or Krea `styles:[{id}]`; tier only changes which Krea 2 quality tier is hinted for a Krea-trained style, since fal's route is tier-agnostic) |
| **Generate audio · Voice** | voice pick (browse/preview) + line, or a plain line if ElevenLabs isn't connected | audio node | `audio-tts` (+ `voice-library`) via direct ElevenLabs call; zero-cost fallback to Yapper's free daily-character `/audio/speech` REST call (one default voice, no browsing) when ElevenLabs isn't connected and a Yapper REST key is set |
| **Generate audio · Music** | prompt + length | audio node | `audio-music` via direct ElevenLabs `compose_music` call; agent-routed fallback to muapi's Suno wrapper (`muapi_audio_create`, full songs incl. an instrumental-only toggle, credits not a fixed price) when ElevenLabs isn't connected and muapi is |
| **Generate audio · SFX** | prompt + duration (0.5–5s) | audio node | `audio-sfx` |
| **Generate audio · Clone** | name + sample files (+ optional Reference person to attach to) | a reusable voice (not a node) | `voice-clone` |
| **Motion graphics** | references + instruction (wizard below) | image nodes + video node + alpha webm node | `image-gen`, `image-ref-conditioning`, `video-frame-conditioning`, local ffmpeg alpha |
| **Isolate audio** | video node / file / direct URL | audio node | none — local ffmpeg (standing principle: local beats paid) |
| **Create a LoRA** | trainer pick (fal krea-2 / fal flux-krea / Krea direct) + style/subject + images (local files, or a canvas node's `lyme-asset://` URL — e.g. Deepfake's "train a LoRA from this photo" shortcut) + steps + trigger | trained style (Settings › Trained styles; `loraUrl` for fal trainers, a Krea `style_id` for the Krea-direct trainer) | `lora-train` |
| **Deepfake** | Reference person (identity + voice) + script + source video/photo | audio node (speech) then video node (lip-sync/face) | `audio-tts` (direct ElevenLabs call) then `lipsync` / `face-swap` (agent call, restricted to the connected `yapper`/`muapi` pair) |
| **Upload / Link** | file / direct URL | node of inferred type | none — local |
| **Listing photos** | listing query | image nodes (with MLS provenance) | `data-mls` |

## Reference person (Deepfake's identity + voice pairing)

A `TrainedStyle` (Settings › Trained styles) can carry an optional `voiceName` — an ElevenLabs
voice paired with the trained likeness, turning a plain LoRA record into a reusable "who talks"
identity. Deepfake picks one; the pairing itself is account-level state, edited from two places:
inline in Settings › Trained styles (type an *existing* voice's name), or — the faster path when
the voice doesn't exist yet — the Create panel's **Generate audio · Clone** job, which can attach
its freshly-cloned voice to a chosen Reference person in the same action instead of requiring a
trip to Settings afterward to paste the name in by hand.

A Reference person can also carry an optional `personaTone` — a free-text tag ("calm authoritative
newsreader", "energetic upbeat vlogger"), set the same inline way as the voice field in Settings ›
Trained styles. It exists solely to be matched against a Storyboard shot's `feeling` annotation
(see "Storyboard panel" above): when a script-born panel is sent to Deepfake, `personaTone` and
`feeling` are lowercased and split on word boundaries, and the Reference person (that also has a
voice — a bare LoRA can't drive Stage 1's speech) whose tone words overlap the feeling words most
wins the auto-pick. No overlap on any Reference person, or no `feeling` set, means no suggestion —
the screen says so and leaves the picker on "none" rather than guessing. Pure client-side string
matching, no agent call and no live spend (`suggestReferencePerson` in `AsidePanel.tsx`).

## Deepfake (stages as nodes)

Same "each stage its own visible node" pattern as the Motion graphics wizard below, not one
opaque call:

1. **Reference person + script** — pick a trained identity (optional) and its paired voice
   (or type a voice name), write the script.
2. **Speech** — direct ElevenLabs `text_to_speech` call (no agent turn, same plumbing as the
   Generate audio · Voice job) → an audio node lands on the canvas.
3. **Face** — an agent turn restricted to exactly the connected `yapper`/`muapi` pair
   (`GenerationParams.connectorIds`), given the local speech-audio path and the chosen
   source-video/photo canvas node's path (`referenceAudioPaths`/`sourceMediaPath`). The prompt
   tells it to prefer muapi's self-contained chain (its own upload tool → `muapi_edit_lipsync`,
   or `muapi_enhance_face_swap` when only a still photo exists) since that needs no extra
   credentials; Yapper is the fallback path when only Yapper is connected. In the Yapper-only
   case, `generation.ts` no longer leans on the agent to find an upload tool that doesn't exist
   on the hosted connector — it pre-uploads the local source video/audio itself via
   `yapper-rest.ts`'s REST signed-upload (a second, non-OAuth `yap_live_…` key set from
   Settings › Connectors, independent of Yapper's OAuth MCP login) and hands the agent the
   resulting `sourceVideoAssetId`/`audioAssetId` directly. **Unverified live** — no API keys are
   configured to fire this chain yet; the wiring is real, the call itself isn't.

When the picked face/performance node is a still image, a **"Train a LoRA from this photo"**
button next to the picker jumps to the Create a LoRA screen with that image already loaded as the
first training image (kind defaults to "Subject / character," name defaults to the Reference
person's name when one is picked) — the LoRA screen's file picker adds to that starting image
rather than replacing it, so the shortcut is a head start, not the whole training set. This closes
the loop the other way too: identity built with **Create a LoRA** and voice attached (§ above)
can start from a photo Deepfake already had on the canvas, instead of a separate file-picker round
trip through the OS dialog.

## Motion graphics wizard (stages as nodes)

1. **References** — image nodes in (≤10, matching Gemini's Nano Banana 2 object-reference cap;
   the wrapper itself slices to 10 and OpenAI's wrapper accepts even more. Raised from a
   UI-side cap of 5 in the 2026-08-09 enrichment run — the wrapper had already supported 10 since
   the "Connector reality check" pass, the UI just never let the user reach it).
2. **Prompt variations** — agent turn with vision input (no generation spend).
3. **Batch review** — N×M cheap generations → `BatchResultsGrid` pick. `image-gen`.
4. **Final pass** — winning prompt + references. `image-ref-conditioning`.
5. **Animate** — locally-drawn solid start frame (or loop = final frame both ends) + final
   image as end frame → reveal video. `video-frame-conditioning` (8s duration rule rides the
   wrapper). A quality-tier picker (default `veo-3.1-generate-preview` / fast / lite, shown
   whenever Gemini is connected) sets `GenerationParams.modelHint` to the literal Veo model id,
   so an iteration pass can render on the ~8× cheaper `lite` tier and only the final render pays
   for full quality — wired 2026-08-09; the wrapper's `model` arg existed before this, nothing
   in the UI ever set it.
6. **Alpha** — colorkey → VP9/WebM with real alpha, local ffmpeg. Lands as a `motionGfx` node
   ready for an overlay track.

## Timeline clip / overlay track

Clips are their own edit (trim independent of the node's Play trim). Video tracks composite
ascending; alpha overlays blend natively at export. Audio tracks mix. Mute is real; solo is
preview-only and structurally absent from the export payload.

- **Capabilities consumed:** none at edit time; export is local ffmpeg.

## Combine (drag node onto node)

Two pairs now run a real generation instead of the Phase 2 placeholder timer (2026-08-09
enrichment run, row 7): **image+image** prompts a merge and passes both nodes' `src` as
`referenceImagePaths` (`image-ref-conditioning`, the same field Motion graphics' References
stage uses); **audio+image** (either drag order) passes the image as `sourceMediaPath` and the
audio as `referenceAudioPaths`, with the dialog's prompt telling the agent to lip-sync if the
image shows a face and otherwise animate-and-score it — the same `sourceMediaPath` +
`referenceAudioPaths` chain Deepfake's Stage 2 established, reused rather than restricted to a
connector pair since Combine has no upload-chain complexity to steer around. Both require the
dragged nodes to already be `ready` (the Combine button disables otherwise) since the paths need
real files on disk, not an in-flight render. The dialog gained a prompt textarea for these two
pairs to carry the "how should these combine" instruction the stub never had anywhere to put.

The other four pairs (video+video, image+video, audio+video, audio+audio) closed the placeholder
gap too (2026-08-09 enrichment run, row 9): each is a deterministic local ffmpeg composite, not an
agent generation, so none of them show the prompt textarea or route through `generateMedia` — no
agent judgment is needed since which filter graph applies follows directly from the two media
types (`localCombineFor` in `store.ts`). **video+video** ("Stitch clips") concats both clips after
normalizing to the shared 1080×1920/30fps export canvas, keeping audio only when both sides have a
stream (no ffprobe here to pad a missing track to the right length, so the honest v1 behavior is
video-only output rather than a guessed-length dub). **image+video** ("Composite overlay") draws
the still centered and scaled-to-fit over the clip's full duration, passing the clip's own audio
through untouched. **audio+video** ("Score the clip") lays the new audio under the clip, mixed
with the clip's own audio when it has one; output runs to the shorter of the two (`-shortest`) as
the deliberate v1 default. **audio+audio** ("Mix tracks") blends both into one stream
(`amix`/`normalize=0`, matching the Cut Room export's own mix). All four go through one new IPC
round trip, `media:combine-local` (`combineLocal()` in `media-tools.ts`), and produce a real node
exactly like `IsolateScreen`'s ffmpeg output does — `source: 'upload'`, not `'generate'`, since no
connector or agent turn is spent. Every pair now requires both dragged nodes to be `ready` with a
real `src` (the Combine button disables otherwise), the same guard the two generative pairs
already had.

---

## Where routing happens

- Tile readiness + run-line: renderer, from the capability map's node table.
- `GenerationParams.connectorId` restricts a call to one connector; `modelHint` nudges the
  model inside it (Midjourney via muapi; LoRA weights URL via fal).
- Unrestricted calls let the agent pick among every attached connector — the capability map's
  matrix is what a future smarter router (or the agent's own system prompt) should be fed.
