---
name: deepfake
description: Lipsync a real talking-head video to new speech through Lyme Hype's pipeline (Yapper/muapi + ElevenLabs TTS). Use this whenever the user asks for a lipsync, a deepfake, a talking-head video, "make this person say X", or syncing a face video to an audio track. Requires a real face video the user provides, fires billed calls, and — because this manipulates a real person's likeness — only proceed with the user's own likeness or footage they confirm they have rights to use.
---

# Deepfake / lipsync

Call the project's own MCP server: **`mcp__lyme-hype__lipsync`**.

## Before calling

- Get the source video path from the user — a real talking-head clip; faceless footage has
  nothing for the model to sync.
- Confirm consent: this is for the user's own likeness and content they own. If the request
  is about a public figure or someone who hasn't consented, don't run it.

## Call

- `face_video_path` — absolute path to the talking-head video.
- `speech_text` — the line to speak (TTS'd verbatim first, one extra ElevenLabs call), OR
- `audio_path` — when the user already has the speech audio.
- `voice_name` — optional voice for the TTS.

The render takes minutes — wait for the tool. The result carries `path`; send it with
SendUserFile (display: render) and relay `note`/`costUsd`. On `ok: false`, report `error`
verbatim — "neither yapper nor muapi is installed" is fixed in the app under Settings ›
Connectors. Don't retry billed renders without telling the user. If the lyme-hype tools
aren't available, the server needs `npm run build` and/or `.mcp.json` approval.
