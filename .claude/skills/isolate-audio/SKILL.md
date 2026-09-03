---
name: isolate-audio
description: Extract the audio track from a video file as an mp3, using Lyme Hype's local ffmpeg pipeline — free, no connector, no billing. Use this whenever the user asks to isolate, extract, rip, or pull the audio/sound/music out of a video or clip, or wants "just the audio" from a file or direct video URL.
---

# Isolate audio

Call the project's own MCP server: **`mcp__lyme-hype__isolate_audio`**.

- `input` — the video's absolute path, or a direct https file URL (ffmpeg reads those
  natively). Hosting-page URLs (YouTube etc.) are out of scope — say so rather than
  attempting them. Convert relative paths to absolute first.

Free — no connector, no billing. The result carries `path` (the mp3 on disk); send it with
SendUserFile. On `ok: false`, report `error` verbatim — usually the input is unreadable or
no ffmpeg binary is on PATH. If the lyme-hype tools aren't available, the server needs
`npm run build` and/or `.mcp.json` approval.
