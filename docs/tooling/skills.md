# Claude Code skills

Built 2026-08-29. `.claude/skills/` wraps the MCP tools as natural-language entry points —
"let's generate a photo" in a Claude Code session triggers the matching skill, which calls
the `mcp__lyme-hype__*` tool and hands back the produced file. Architecture:

```
user phrase → skill (.claude/skills/<name>/SKILL.md) → mcp__lyme-hype__* tool → app engine
```

| Skill | Tool(s) | Notes |
|---|---|---|
| generate-image | generate_image | connector_id when the user names a tool; refs supported |
| generate-video | generate_video, extend_video | start/end-frame = "animate this image" / loops |
| generate-audio | generate_speech, generate_sound_effect, generate_music, list_voices, clone_voice | one tool per request; tts text is verbatim; clone needs explicit confirmation |
| motion-graphics | generate_image + generate_video + key_alpha | composed; only the stages asked for |
| train-lora | train_lora_style | confirm images + spend first |
| deepfake | lipsync | real talking-head only; consent required |
| isolate-audio | isolate_audio | free |
| listing-photos | pull_listing_photos | neutral presentation of listing data |

Conventions all skills follow: send produced files via the file tool (render display),
relay the result's `note`, report errors verbatim, diagnose missing connectors with
`list_generation_connectors`, never retry a billed call silently. If the tools are
missing, the server needs `npm run build` and/or `.mcp.json` approval.

Skill content is cached per session — edits to a SKILL.md load next session.
