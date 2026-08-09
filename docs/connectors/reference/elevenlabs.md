# ElevenLabs — reference

> Aggregated 2026-08-09 from official sources for Lyme Hype. Facts marked [verified] were confirmed against live endpoints/schemas; [docs] come from official documentation; [unverified] are best-understanding.

## What Lyme Hype uses it for

Voice, music, and SFX — direct-to-source, no aggregator markup (`docs/connectors/catalog.md` routing table). All three run as **direct MCP tool calls with no agent turn**: `src/main/elevenlabs-tools.ts` spins up the stdio server per call, invokes exactly one tool, parses the output-file path from the text reply, and imports it into the asset store. Used by the Create panel's Voice / Music / SFX jobs, voice preview, and voice cloning ("their own audio LoRA"). The server is *also* attached as a regular connector for agent-driven generation via `generation.ts`.

## Connection

- **Transport:** stdio — `uvx elevenlabs-mcp` (official package; pip alternative `pip install elevenlabs-mcp` → `python -m elevenlabs_mcp`). [docs]
- **Auth:** `ELEVENLABS_API_KEY` env var. [verified — the install template in `src/main/connector-suggestions.ts` and the live server both use it]
- **Key page:** <https://elevenlabs.io/app/settings/api-keys>
- **Install shape** (`connector-suggestions.ts`, id `elevenlabs`): `kind: 'stdio'`, `command: 'uvx'`, `args: ['elevenlabs-mcp']`, `authType: 'apiKey'`, `secretKey: 'ELEVENLABS_API_KEY'`. Needs the `uv` runtime on the machine. [verified]
- **Other env vars** [docs]:
  - `ELEVENLABS_MCP_BASE_PATH` — directory for file I/O; default `~/Desktop`. Lyme Hype sets it to `<tmpdir>/lyme-hype-elevenlabs` on every launch. Also described as a security boundary for *input* files (see Gotchas).
  - `ELEVENLABS_MCP_OUTPUT_MODE` — `files` (default; write to disk, return path in text) | `resources` (base64 MCP resources) | `both`. Lyme Hype relies on the default `files` mode.
  - `ELEVENLABS_API_RESIDENCY` — data residency, default `"us"`; enterprise-only feature.
  - `ELEVENLABS_MODEL_ID` — overrides the default TTS model. [verified — referenced in the live `text_to_speech` schema description]

## Tool surface

27 tools on the live server (enumerated 2026-08-09). All generation tools are **synchronous** — no job ids, no polling anywhere on this server; the call blocks until the file is written. Every file-producing tool takes `output_directory` (default `$HOME/Desktop` when neither it nor base path is set). [verified]

### Audio generation (file-producing, sync)

| Tool | Purpose | Key parameters | Returns |
|---|---|---|---|
| `text_to_speech` | TTS with a chosen voice | `text` (str, req); `voice_id` **or** `voice_name` (str, only one; server default voice if neither); `model_id` (str, default `eleven_multilingual_v2` or `ELEVENLABS_MODEL_ID`); `stability` 0–1 (0.5), `similarity_boost` 0–1 (0.75), `style` 0–1 (0), `use_speaker_boost` (true), `speed` (1), `language` (ISO 639-1, "en"), `output_format` (default `mp3_44100_128`), `output_directory` | Text reply containing saved file path + voice used [verified] |
| `text_to_sound_effects` | SFX from a description | `text` (str, req); `duration_seconds` (number, **0.5–5**, default 2); `loop` (bool, false); `output_format`; `output_directory` | Text reply with file path [verified] |
| `compose_music` | Music from prompt or plan | `prompt` XOR `composition_plan` (dict); `music_length_ms` (int, **3000–600000**, not combinable with a plan); `model_id` `music_v1`\|`music_v2` (default v2); `force_instrumental` (false); `store_for_inpainting` (false — true returns a `song_id` for later inpainting); `seed` (int, v2 only); `output_directory` | Text reply with file path [verified] |
| `video_to_music` | Score for video file(s) | `input_file_paths` (str[], req — 1–10 videos, concatenated server-side, ≤200 MB and ≤600 s combined); `description` (str); `tags` (≤10 str); `model_id` (default `music_v2`); `output_directory` | Text reply with file path [verified] |
| `speech_to_speech` | Re-voice an audio file | `input_file_path` (req); `voice_name` (default "Adam"); `output_directory` | Text reply with file path [verified] |
| `isolate_audio` | Strip background noise/music from a recording | `input_file_path` (req); `output_directory` | Text reply with file path [verified] |
| `text_to_voice` | Voice design: 3 preview mp3s from a description | `voice_description` (req); `text` (optional — auto-generated if absent); `output_directory` | Three files named `voice_design_(generated_voice_id)_(timestamp).mp3` [verified] |

### Transcription

| Tool | Purpose | Key parameters | Returns |
|---|---|---|---|
| `speech_to_text` | Transcribe audio (candidate for the subtitle-text connection AGENTS.md §4 says isn't wired yet) | `input_file_path` (req); `language_code` (ISO **639-3**, auto-detect if omitted); `diarize` (false); `save_transcript_to_file` (true); `return_transcript_to_client_directly` (false — true always returns text inline); `output_directory` | Transcript file and/or inline text [verified] |

### Voices

| Tool | Purpose | Key parameters | Returns |
|---|---|---|---|
| `search_voices` | Search/list **the user's own voice library**. There is NO `list_voices` tool — calling this with no `search` IS the listing call [verified] | `search` (optional; matches name/description/labels/category); `sort` `name`\|`created_at_unix` (default name); `sort_direction` `asc`\|`desc` (desc) | Prose voice listing (Name/ID/Category blocks — not JSON) [verified] |
| `search_voice_library` | Search the global shared library | `page` (0-indexed), `page_size` 1–100 (10), `search` | Prose listing [verified] |
| `get_voice` | One voice's details | `voice_id` (req) | Voice details [verified] |
| `voice_clone` | Instant voice clone from samples | `name` (str, req); `files` (str[] of local audio paths, req); `description` (optional) | Confirmation text with new voice id — no file output [verified] |
| `create_voice_from_preview` | Promote a `text_to_voice` preview into the library | `generated_voice_id`, `voice_name`, `voice_description` (all req) | Confirmation [verified] |

### Music planning (free)

| Tool | Purpose | Key parameters | Returns |
|---|---|---|---|
| `create_composition_plan` | Build a plan for `compose_music`. **Costs no credits** (rate-limited by tier) [verified] | `prompt` (req); `music_length_ms` (**10000–300000** — narrower than compose_music's range); `source_composition_plan` (dict to mutate); `model_id` (default `music_v2`) | Plan dict. v2 shape: `{chunks: [GenerationChunk \| AudioRefChunk]}`; v1 shape: `{positive_global_styles, negative_global_styles, sections}` [verified] |
| `upload_music_for_inpainting` | Upload audio to reference in music_v2 inpainting | `input_file_path` (req); `extract_composition_plan` `music_v1`\|`music_v2`\|null (default v2) | `song_id` for `AudioRefChunk`/`conditioning_ref`. **Enterprise-gated** [verified — stated in live schema] |

### Account / utility

| Tool | Purpose | Parameters |
|---|---|---|
| `check_subscription` | Subscription status + usage | none [verified] |
| `list_models` | All available models | none [verified] |
| `play_audio` | Play a WAV/MP3 **on the host machine** | `input_file_path` [verified] |

### Conversational-AI agents platform (present but unused by Lyme Hype)

| Tool | Purpose | Key parameters |
|---|---|---|
| `create_agent` | Create a voice agent | `name`, `first_message`, `system_prompt` (req); `voice_id` (default `cgSgspJ2msm6clMCkdW9`); `llm` (default `gemini-2.0-flash-001`); `model_id` (default `eleven_turbo_v2`); `language`, `temperature`, `stability`, `similarity_boost`, `turn_timeout`, `max_duration_seconds`, `record_voice`, `retention_days`… [verified] |
| `get_agent` / `list_agents` | Inspect agents | `agent_id` / none [verified] |
| `add_knowledge_base_to_agent` | Attach KB (epub/pdf/docx/txt/html) | `agent_id`, `knowledge_base_name` (req); one of `url` / `input_file_path` / `text` [verified] |
| `list_conversations` / `get_conversation` | Call history + transcripts | filters/cursor/`page_size` 1–100 / `conversation_id` [verified] |
| `simulate_conversation` | Text-simulate an agent call with a persona, returns transcript + analysis | `agent_id`, `simulated_user_prompt` (req); `extra_evaluation_criteria`, `max_turns` (10) [verified] |
| `list_phone_numbers` | Account phone numbers | none [verified] |
| `make_outbound_call` | **Places a real phone call** via Twilio/SIP | `agent_id`, `agent_phone_number_id`, `to_number` (E.164) [verified] |

## Models

The MCP tools mostly hide model choice ( `speech_to_text`, `speech_to_speech`, `text_to_sound_effects` take none); only `text_to_speech` (`model_id`) and the music tools (`music_v1`/`music_v2`) expose it. Full platform roster for context [docs — elevenlabs.io/docs/models, 2026-08]:

| id | Media | Capabilities | Limits | Cost tier |
|---|---|---|---|---|
| `eleven_v3` | TTS | Most expressive; 70+ languages; audio-tag emotion control | 5,000 chars/request | High |
| `eleven_multilingual_v2` | TTS | **MCP default.** Most lifelike/stable; 29 languages | 10,000 chars/request | High (1 credit/char) |
| `eleven_flash_v2_5` | TTS | ~75 ms latency; 32 languages | 40,000 chars/request | Low (0.5 credit/char) |
| `eleven_flash_v2` | TTS | ~75 ms; English only | 30,000 chars/request | Low |
| `eleven_turbo_v2_5` | TTS | **Deprecated** — docs point to flash_v2_5; still accepted by the tool enum | — | Low |
| `eleven_turbo_v2` | TTS | **Deprecated** — yet still the `create_agent` default [verified] | — | Low |
| `music_v2` | Music | **MCP default.** Composition plans (`chunks`), inpainting via song_id refs, `seed`, vocals or instrumental | 3 s – 10 min | High |
| `music_v1` | Music | Legacy plan shape (`sections`); superseded | 3 s – 10 min | High |
| `scribe_v2` / `scribe_v2_realtime` | STT | 90+ languages; realtime variant ~150 ms (`scribe_v1` deprecated) | — | Low |
| `eleven_multilingual_sts_v2` / `eleven_english_sts_v2` | STS | Voice changer backing `speech_to_speech` | 10,000 chars | Mid |
| `eleven_ttv_v3` / `eleven_multilingual_ttv_v2` | Voice design | Backing `text_to_voice` | — | Mid |
| `eleven_text_to_sound_v2` | SFX | Backing `text_to_sound_effects` | 0.5–5 s via MCP | Low |

## Result handling

- **Files, not URLs, not job ids.** Default output mode writes the audio to `ELEVENLABS_MCP_BASE_PATH`/`output_directory` and reports the absolute path inside a prose text reply (e.g. `Success. File saved as: C:\...\voice.mp3. Voice used: Rachel`). No polling pattern exists — calls block until done. [verified]
- **Lyme Hype ingestion:** `elevenlabs-tools.ts` passes `output_directory: <tmpdir>/lyme-hype-elevenlabs` explicitly on every file-producing call, regexes the path out (`extractFilePath` — handles Windows and POSIX paths, covered by selftest), then `importFileAsset()` copies it into `userData/assets` and returns a `lyme-asset://` URL. A reply with no parseable path is surfaced as an error, not papered over. [verified]
- **Per-tool timeouts (Lyme Hype's own MCP client, default 45 s):** voice preview 120 s · TTS 180 s · SFX 180 s · music 600 s · voice_clone 600 s. Music composition is the reason the default is far too tight. [verified]
- Voice listings come back as prose, parsed best-effort by `parseVoiceListing`; raw text is kept as fallback. [verified]
- Storage lifetime: local disk only — the server keeps nothing except voices/agents created on the account, plus music stored server-side when `store_for_inpainting=true`. [docs]

## Pricing & limits

- Credit model, roughly 1 credit ≈ 1 character of multilingual_v2 TTS; flash/turbo cost 0.5 credit/char. [docs]
- Plans [docs, 2026]: Free 10k credits/mo (~10 min TTS) · Starter $5 30k + instant voice cloning + commercial license · Creator $22 100k + professional voice cloning + 192 kbps output · Pro $99 500k + 44.1 kHz PCM API output · Scale $330 2M · Business $1,320 11M.
- Output-format gates are enforced per plan and stated in the live schema: `mp3_44100_192` needs **Creator+**, `pcm_44100` needs **Pro+**. Full enum: `mp3_22050_32`, `mp3_44100_32/64/96/128/192`, `pcm_8000/16000/22050/24000/44100`, `ulaw_8000`, `alaw_8000`, `opus_48000_32/64/96/128/192`. [verified]
- Instant voice clone (`voice_clone`) needs Starter+; free-tier keys will fail it. [docs]
- Concurrency (TTS): Free 2–4 · Starter 3–6 · Creator 5–10 · Pro 10–20 · Scale 15–30. [docs]
- `create_composition_plan` is free of credits but rate-limited by tier. [verified]

## Gotchas

- **No `list_voices` tool.** Anything that wants "all my voices" must call `search_voices` with no search term. (Lyme Hype's `searchVoices('')` does exactly this.) [verified]
- **Output lands on the user's Desktop by default.** Any caller that skips both `output_directory` and `ELEVENLABS_MCP_BASE_PATH` litters `$HOME/Desktop`. Lyme Hype always passes both. [verified]
- **Replies are prose, not structured.** File paths and voice listings must be parsed out of English sentences; a server wording change can break parsers (Lyme Hype degrades to raw text / explicit error). [verified]
- **SFX duration is capped at 5 s by the MCP tool** — tighter than the platform's own SFX product. Longer effects need multiple calls or a different route. [verified]
- **`music_length_ms` bounds differ by tool:** 3000–600000 on `compose_music`, but 10000–300000 on `create_composition_plan`. [verified]
- **`upload_music_for_inpainting` is enterprise-only** — schema says so explicitly; expect a 4xx on normal keys. [verified]
- **`make_outbound_call` places real phone calls** and `create_agent`/`add_knowledge_base_to_agent` create persistent billable account objects — reasons the direct-call path (no agent turn) exists, and worth `disallowedTools`-blocking if this connector is ever exposed to agent-driven generation the way muapi's topup tool is. [verified surface / project policy]
- **Turbo TTS models are deprecated** (docs recommend flash equivalents) yet `eleven_turbo_v2` is still the live `create_agent` default. [docs + verified]
- **Base path is described as a security boundary for input files** in the README — input paths (e.g. `voice_clone` samples, `speech_to_text` sources) may need to resolve under `ELEVENLABS_MCP_BASE_PATH`; Lyme Hype points base path at a temp dir while clone inputs come from user-picked locations, so this is worth a live check before the joint-session billed run. [docs; interaction unverified]
- **`voice_id` XOR `voice_name`** on `text_to_speech` — passing both is an error. [verified]
- **`speech_to_text` wants ISO 639-3** (`eng`), while `text_to_speech.language` is ISO 639-1 (`en`). [verified]
- Every generation tool carries the package's cost warning — there is no dry-run or cost-preflight on this server (`check_subscription` before/after is the only usage measure). [verified]

## Sources

- Live schema enumeration of the connected `elevenlabs-mcp` server (27 tools), 2026-08-09 — primary source for everything marked [verified].
- <https://github.com/elevenlabs/elevenlabs-mcp> — install, env vars, output modes.
- <https://elevenlabs.io/docs/models> — model roster, character limits, deprecations, concurrency.
- <https://elevenlabs.io/app/settings/api-keys> — key page.
- Plan pricing cross-checked via 2026 pricing roundups (bigvu.tv, quiq.com, gptprompts.ai) reporting official elevenlabs.io/pricing figures.
- `F:\web-clients\joseph-sardella\lyme-hype\src\main\elevenlabs-tools.ts`, `connector-suggestions.ts`, `selftest.ts` — Lyme Hype call paths, timeouts, install shape.
