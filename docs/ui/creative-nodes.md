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
| **Generate video** | prompt + aspect/duration/res (+ connector override) | video node | `video-gen-t2v` (any provider of it — muapi default when present) |
| **Generate image** | prompt + aspect + tier toggle (+ trained style) | image node | `image-gen` (storyboard tier) or `image-production` (Midjourney-class); `lora-use` when a trained style is picked |
| **Generate audio · Voice** | voice pick (browse/preview) + line | audio node | `audio-tts` (+ `voice-library`) |
| **Generate audio · Music** | prompt + length | audio node | `audio-music` |
| **Generate audio · SFX** | prompt + duration (0.5–5s) | audio node | `audio-sfx` |
| **Generate audio · Clone** | name + sample files | a reusable voice (not a node) | `voice-clone` |
| **Motion graphics** | references + instruction (wizard below) | image nodes + video node + alpha webm node | `image-gen`, `image-ref-conditioning`, `video-frame-conditioning`, local ffmpeg alpha |
| **Isolate audio** | video node / file / direct URL | audio node | none — local ffmpeg (standing principle: local beats paid) |
| **Create a LoRA** | trainer pick + style/subject + images + steps + trigger | trained style (Settings › Trained styles; `loraUrl`) | `lora-train` |
| **Deepfake** | who talks + script | video node | `lipsync` (+ `audio-tts` chained by the agent) |
| **Upload / Link** | file / direct URL | node of inferred type | none — local |
| **Listing photos** | listing query | image nodes (with MLS provenance) | `data-mls` |

## Motion graphics wizard (stages as nodes)

1. **References** — image nodes in (≤5; wrapper caps at 3 for Gemini).
2. **Prompt variations** — agent turn with vision input (no generation spend).
3. **Batch review** — N×M cheap generations → `BatchResultsGrid` pick. `image-gen`.
4. **Final pass** — winning prompt + references. `image-ref-conditioning`.
5. **Animate** — locally-drawn solid start frame (or loop = final frame both ends) + final
   image as end frame → reveal video. `video-frame-conditioning` (8s duration rule rides the
   wrapper).
6. **Alpha** — colorkey → VP9/WebM with real alpha, local ffmpeg. Lands as a `motionGfx` node
   ready for an overlay track.

## Timeline clip / overlay track

Clips are their own edit (trim independent of the node's Play trim). Video tracks composite
ascending; alpha overlays blend natively at export. Audio tracks mix. Mute is real; solo is
preview-only and structurally absent from the export payload.

- **Capabilities consumed:** none at edit time; export is local ffmpeg.

## Combine (drag node onto node)

Still the stub lifecycle from Phase 2 — the combine dialog spawns a placeholder "combined"
node. Real combine semantics (image+audio → video? style transfer?) should be designed against
the capability map (`image-ref-conditioning`, `video-gen-i2v`) rather than ad hoc. Open item.

---

## Where routing happens

- Tile readiness + run-line: renderer, from the capability map's node table.
- `GenerationParams.connectorId` restricts a call to one connector; `modelHint` nudges the
  model inside it (Midjourney via muapi; LoRA weights URL via fal).
- Unrestricted calls let the agent pick among every attached connector — the capability map's
  matrix is what a future smarter router (or the agent's own system prompt) should be fed.
