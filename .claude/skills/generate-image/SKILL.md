---
name: generate-image
description: Generate an image through Lyme Hype's real agent-driven generation pipeline (installed MCP connectors — Gemini, OpenAI Images, Krea, fal, muapi). Use this whenever the user asks to generate, create, or make a photo, image, picture, graphic, artwork, thumbnail, poster, or product shot — including casual phrasings like "let's generate a photo", "make me an image of X", or "can we get a picture of Y" — and when they want an image styled after a reference image. This fires a real billed connector call.
---

# Generate an image

Call the project's own MCP server: **`mcp__lyme-hype__generate_image`**.

## Fill in the blanks first

When the user's request doesn't pin down the choices below, ask ONE round of multiple-choice
questions (AskUserQuestion, free-text always available) before generating — don't guess
silently, and don't ask about things they already specified or that follow obviously from
the request:

- **Model** — cheap-first unless the user wants a paid final:
  - **LOCAL, $0** (connector `comfyui`, runs on this machine's GPU): `z-image-turbo`
    (fastest, drafts/storyboards — recommend as default), `krea2-turbo` (cinematic
    photorealism tier), `flux1-schnell` (fallback). Free means free — prefer these for
    volume and draft work always.
  - Paid API: gemini `gemini-2.5-flash-image` (nano banana 1, $0.039; retires 2026-10-02),
    `gemini-3.1-flash-lite-image` (~$0.034, 1K only), `gemini-3.1-flash-image` (nano
    banana 2, ~$0.07/1K — hero shots), `gemini-3-pro-image` (premium, ~2×), or muapi/openai
    models.
- **Aspect ratio** — `9:16` reels default; `1:1`, `16:9`, `4:5`, `21:9` etc. all real API values.
- **Size** — `1K` default; `0.5K` cheap draft; `2K`/`4K` finals (price scales with size).
- **References** — do they have images to condition on, and are they OBJECT (include this
  thing), CHARACTER (this exact person's likeness), or STYLE (this look) references?

A quick draft request ("just show me something") skips the interview — lite model, 1K, done.

## Parameters

- `prompt` — improve the user's phrasing into a proper image prompt (subject, style,
  lighting, composition) while keeping their intent exactly.
- `connector_id` — when the user names a tool (`gemini`, `openai-images`, `krea`, `fal`, `muapi`).
- `model` / `image_size` / `thinking_level` — from the interview above (thinking_level
  `high` only for complex compositions on the default gemini model).
- `reference_image_paths` / `character_reference_paths` / `style_reference_paths` —
  absolute paths, typed per the interview.
- `aspect_ratio` — a real API field on gemini, not prompt text.

The result JSON carries `path` (the produced file on disk), `note` (which connector/model
ran), and `costUsd` (orchestration cost — the connector bills separately on its own
account). Send `path` to the user with SendUserFile (display: render) and relay the note.

On `ok: false`, report `error` verbatim. If it says no connector is usable, call
`mcp__lyme-hype__list_generation_connectors` and tell the user which connector is missing
its credential (fixed in the app under Settings › Connectors). If the lyme-hype MCP tools
aren't available at all, the server needs `npm run build` in the repo and/or approval of
the project's `.mcp.json`. Don't retry a billed call without telling the user.
