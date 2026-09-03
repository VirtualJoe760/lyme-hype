---
name: train-lora
description: Train a custom style LoRA on Krea from a folder of the user's images, through Lyme Hype's Krea REST training client. Use this whenever the user asks to train a style, train a LoRA, create a custom model from their photos, teach the system a look/aesthetic/character, or make "a model of me/my product". This is the most expensive single call in the app (a multi-minute billed training job) — always confirm the image folder and the spend with the user before running.
---

# Train a LoRA

Call the project's own MCP server: **`mcp__lyme-hype__train_lora_style`**.

## Before calling

1. Confirm the training images with the user — at least 4 png/jpg/webp of the
   style/subject; more and varied is better. Collect the absolute paths (list the folder
   they name).
2. Confirm they're OK with the spend: training is a real multi-minute billed job on Krea.
   Never kick it off on an ambiguous request.

## Call

- `name` — a name for the style (ask, or derive from their description).
- `image_paths` — the absolute paths collected above.
- `steps` — keep low when the user just wants to try the pipeline.

Training polls up to 20 minutes inside the tool — wait for it; don't assume a hang.

On success the result carries the style's id and name — tell the user it's ready and lives
in the app under Settings › Trained styles (it generates through Krea 2 endpoints). On
`ok: false`, report `error` verbatim — a missing Krea token is fixed in the app under
Settings › Connectors. Never silently re-run a training job. If the lyme-hype tools aren't
available, the server needs `npm run build` and/or `.mcp.json` approval.
