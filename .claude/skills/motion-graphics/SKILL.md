---
name: motion-graphics
description: Produce a motion-graphics style asset through Lyme Hype's pipeline — a reference-conditioned graphic (badge, logo treatment, overlay art) and/or a transparent-background (alpha) version of a clip via local ffmpeg colorkey → VP9 webm. Use this whenever the user asks for motion graphics, an overlay, a badge, a lower-third, transparent/alpha video, keying out a background, or a graphic that matches an existing image's style. The graphic generation is a billed call; the alpha keying is free local ffmpeg.
---

# Motion graphics

Two tools on the project's own MCP server, composed to fit the request:

1. **`mcp__lyme-hype__generate_image`** — the graphic itself (billed). Pass the user's
   style source via `reference_image_paths` when they have one. Prompt for a SOLID
   background (black is the default key color) — the cleaner the background, the cleaner
   the key.
2. **`mcp__lyme-hype__key_alpha`** — `input_path` (a video with a near-solid background) →
   transparent VP9 webm, free local ffmpeg. Options: `color` (default black),
   `similarity`, `blend`.

The full wizard chain for an animated overlay: generate the graphic → animate it with
`mcp__lyme-hype__generate_video` (`start_frame_path` = the graphic; same image as
`end_frame_path` for a loop) → `key_alpha` the rendered clip. Only run the stages the user
actually asked for.

Results carry `path` — send the file(s) with SendUserFile (display: render). On
`ok: false`, report `error` verbatim; missing connectors are fixed in the app under
Settings › Connectors, and a key_alpha failure usually means no ffmpeg on PATH. If the
lyme-hype tools aren't available, the server needs `npm run build` and/or `.mcp.json`
approval.
