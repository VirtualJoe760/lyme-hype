---
name: generate-video
description: Generate a video clip through Lyme Hype's real agent-driven generation pipeline (Veo via the Gemini wrapper, muapi, fal). Use this whenever the user asks to generate, create, or make a video, clip, animation, b-roll, or reel footage — including "let's generate a video", "animate this image", "make a clip of X", extending an existing generated video, or animating between a start and end frame. This fires a real billed connector call.
---

# Generate a video

Call the project's own MCP server: **`mcp__lyme-hype__generate_video`**.

## Fill in the blanks first

Video bills per second and the model choice swings cost ~8× — when the request doesn't pin
these down, ask ONE round of multiple-choice questions (AskUserQuestion, free-text always
available) before rendering. Skip anything already specified or obvious:

- **Model** (Veo via gemini) — `veo-3.1-lite-generate-preview` (~$0.05/s — recommend for
  drafts/overlays; no 4k, no refs, no extension), `veo-3.1-fast-generate-preview`
  (~$0.10/s), `veo-3.1-generate-preview` (best, ~$0.40/s) — or muapi/fal models.
- **Duration** — 4, 6, or 8 seconds (8 is forced for interpolation/refs/1080p+).
- **Resolution** — 720p default; 1080p/4k for finals (4k standard model only, bills higher).
- **Conditioning** — animate an existing image (start frame)? Loop (same frame both ends)?
  Keep a subject consistent via ≤3 reference images (standard/fast only)?

An 8 s default-model 720p clip is ~$3.20; the same on lite is ~$0.40 — that's why the
interview matters.

## Parameters

- `prompt` — write it like a shot description (camera move, subject, mood), keeping the
  user's intent exactly.
- `connector_id` — when the user names one (`gemini` for Veo, `muapi`, `fal`).
- `model` / `resolution` / `duration_seconds` / `person_generation` — from the interview.
- `reference_image_paths` — ≤3 subject-consistency refs (absolute paths).
- `start_frame_path` / `end_frame_path` — absolute paths. "Animate this image" = pass it as
  the start frame; the same image as both = a seamless loop.
- `aspect_ratio` — `9:16` default or `16:9`.

Renders take minutes — that's normal, wait for the tool. To continue a finished clip,
call **`mcp__lyme-hype__extend_video`** with `source_video_path` (the prior result's
`path`) and a prompt for the next ~7 seconds.

The result JSON carries `path`, `note`, and `costUsd` (orchestration only — the connector
bills separately). Send `path` with SendUserFile (display: render) and relay the note.

On `ok: false`, report `error` verbatim; use `mcp__lyme-hype__list_generation_connectors`
to diagnose missing connectors/credentials (fixed in the app under Settings › Connectors).
If the lyme-hype tools aren't available, the server needs `npm run build` and/or `.mcp.json`
approval. Don't retry a billed call without telling the user.
