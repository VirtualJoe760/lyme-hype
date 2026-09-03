---
name: generate-audio
description: Generate audio through Lyme Hype's direct ElevenLabs pipeline — spoken voiceover/narration (text-to-speech), sound effects, music, voice browsing, and voice cloning. Use this whenever the user asks to generate, create, or make a voiceover, narration, someone saying something, a sound effect, a jingle, background music, a track, or wants to hear/browse available voices — including casual phrasings like "make it say X", "give me a whoosh sound", or "write me a beat". Fires real billed ElevenLabs calls.
---

# Generate audio

Call the matching tool on the project's own MCP server — pick ONE per request:

- **`mcp__lyme-hype__generate_speech`** — `text` is spoken VERBATIM (pass the user's words
  exactly, not a description); `voice_name` when they name a voice.
- **`mcp__lyme-hype__generate_sound_effect`** — `prompt` describes the sound;
  `duration_seconds` 0.5–5 (default 2).
- **`mcp__lyme-hype__generate_music`** — `prompt` describes the track; `duration_seconds`
  (default 10). Composition can take minutes — wait for the tool.
- **`mcp__lyme-hype__list_voices`** — browse/search voices (effectively free); relay the
  listing.
- **`mcp__lyme-hype__clone_voice`** — `name` + `sample_paths` (absolute paths to mp3/wav).
  Creates a PERSISTENT voice on the account — confirm with the user before calling.

Results carry `path` (the produced mp3 on disk) — send it with SendUserFile. On
`ok: false`, report `error` verbatim; a missing ElevenLabs key is fixed in the app under
Settings › Connectors. If the lyme-hype tools aren't available, the server needs
`npm run build` and/or `.mcp.json` approval. Don't retry a billed call without telling the
user.
