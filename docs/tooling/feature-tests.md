# Feature-test harness

Live tests for the creative pipeline — unlike `LYME_SELFTEST` (plumbing only, no billed
calls), these drive real generation against whatever connectors are installed, and the
connector bills on its own account. Built 2026-08-29; the per-feature scripts in
`src/main/utils/*_test.ts` are also the engines the skills and MCP tools wrap, so they are
the first place a new connector or capability gets wired and proven.

## Running

```
LYME_TEST=<feature>[,<feature>...] npm run dev     # or LYME_TEST=all
```

Features: `image`, `video`, `audio`, `motion_graphics`, `lora`, `deepfake`,
`isolate_audio`, `chatrealty`. Runs are headless-ish (the window opens briefly), log
`[test:<feature>]` lines, and exit non-zero on any failure. One run at a time — the dev
server port collides otherwise. Naming a feature IS the opt-in to its billed calls; extra
spends inside a feature are gated behind their own env flags.

## Env knobs

| Knob | Used by | Meaning |
|---|---|---|
| `LYME_TEST_PROMPT` | image, video, audio, motion_graphics, deepfake | The prompt / spoken text (verbatim for tts) |
| `LYME_TEST_CONNECTOR` | image, video | Connector id, or comma list → one generation per connector, side by side |
| `LYME_TEST_REF_IMAGE` | image | Reference image path (conditioning) |
| `LYME_TEST_ASPECT` | image, video | Aspect ratio (default 9:16; gemini image takes all 10 API values) |
| `LYME_TEST_MODEL` | image, video | Exact model id for the tool's `model` param; a comma list runs one generation PER MODEL side by side (image: nano banana 1 vs 2; video: Veo ids or muapi aliases — seedance-lite/-pro-fast, kling-v2.5-turbo, sora-2, …) |
| `LYME_TEST_SIZE` | image | Image size tier: 0.5K \| 1K \| 2K \| 4K |
| `LYME_TEST_THINKING` | image | minimal \| high (gemini-3.1-flash-image only) |
| `LYME_TEST_STEPS` | image | Sampling steps for local comfyui models |
| `LYME_TEST_CHAR_REFS` / `LYME_TEST_STYLE_REFS` | image | Comma lists of CHARACTER / STYLE reference paths |
| `LYME_TEST_REFS=1` | image | Extra pass reusing the first result as reference |
| `LYME_TEST_RESOLUTION` | video | 720p \| 1080p \| 4k |
| `LYME_TEST_PERSON` | video | person_generation: allow_all \| allow_adult |
| `LYME_TEST_REF_IMAGES` | video | Comma list of ≤3 subject-consistency reference paths |
| `LYME_TEST_DURATION` | video, audio | Seconds (Veo: 4 \| 6 \| 8) |
| `LYME_TEST_START_FRAME` / `LYME_TEST_END_FRAME` | video | Frame conditioning (same file both = loop) |
| `LYME_TEST_FRAMES=1` / `LYME_TEST_EXTEND=1` | video | Synthetic-frame render / extend pass |
| `LYME_TEST_AUDIO_KIND` | audio | `tts` \| `sfx` \| `music` \| `voices` (omit = suite) |
| `LYME_TEST_VOICE` | audio, deepfake | Voice name |
| `LYME_TEST_MUSIC=1` / `LYME_TEST_CLONE_DIR` | audio | Include music / run voice clone from sample dir |
| `LYME_TEST_LORA_DIR` / `LYME_TEST_LORA_STEPS` | lora | Training images (≥4) / step count |
| `LYME_TEST_FACE_VIDEO` / `LYME_TEST_AUDIO` | deepfake | Talking-head source / pre-made speech |
| `LYME_TEST_INPUT` | isolate_audio | File path or direct https file URL |
| `LYME_TEST_LISTING_QUERY` | chatrealty | Listing search |

## Contracts

- `OUTPUT — <absolute path>` log lines mark produced files (stable format — skills and
  drivers grep for it).
- `test-harness.ts` provides pass/fail/skip accounting and free synthetic media via lavfi
  (`synthClip`, `synthFrame`) so local-only paths never need a billed call.

## Connector probe

```
LYME_PROBE_CONNECTOR=<id> npm run dev
```

Runs the live connection test headless and records the connector's FULL observed tool
schemas (names, params, model enums) to `userData/connector-tools/<id>.json` — the
ground truth the utility knobs and UI model catalog are built from (doc aliases have
been wrong twice; the recorded schema hasn't).

## Credential import

```
LYME_IMPORT_CONNECTOR=<id> LYME_IMPORT_ENVFILE=<path> npm run dev
```

Installs a catalog connector and moves its secret from an env file into the DPAPI vault —
main-process-only, logged as name/length/last-4 (the secure modal's reporting contract).
For keys already on this machine's disk; anything else goes through the secure modal as
ever (AGENTS.md §1.5).

## Verified so far (2026-08-29)

- image: gemini + muapi side by side, live ✅ · audio/video/motion_graphics/lora/deepfake:
  built, not yet live-run · isolate_audio: live ✅ · chatrealty: needs token.

## `comfy_watchdog` — the ComfyUI memory kill switch, without ComfyUI (2026-09-02)

`LYME_TEST=comfy_watchdog`. Spawns a Python process that allocates 1.2 GB and sleeps,
then runs `src/main/comfyui-watchdog.ts` against it with a 0.5 GB limit at 700 ms:
expects the sampler to read > 1 GB of committed memory and the policy to go
relieve → relieve → kill. Free, local, ~6 s. Skips when `python` is not on PATH.
