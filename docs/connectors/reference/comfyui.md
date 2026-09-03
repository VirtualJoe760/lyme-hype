# ComfyUI (local, free) — reference

> Aggregated 2026-08-30 from Joseph's live install + the repo's own openapi.yaml + web
> research. Facts marked [verified] were read off the machine/spec directly.

## What Lyme Hype uses it for

The **$0 image tier**: local generation on Joseph's RTX 3090 via ComfyUI's HTTP API —
storyboard volume work and cinematic stills without per-image connector billing. Routed
through a bundled owned wrapper (`resources/comfyui-mcp.cjs`, planned — build-plan Part
four "ComfyUI local engine"). Later: the same engine's Wan video fleet as a free video
tier.

## Joseph's install (the target environment)

- Path: `X:\_ai\comfy\ComfyUI` — **source git clone**, v0.34.0, commit `8a33128f`
  (2026-08-29). [verified]
- Runtime: system Python 3.12.7 at `F:\python12` (no venv/venv-embedded), torch
  **2.10.0.dev20251024+cu130**, CUDA available, `NVIDIA GeForce RTX 3090` (24GB).
  [verified]
- Performance extras: **sage-attention built from source** (`sage-attention-source/` in the
  repo). A bundled runtime would not replicate this — one reason the source install wins.
  [verified]
- Models on disk: ~600GB across checkpoints (188GB), diffusion_models (177GB), unet
  (109GB), clip (36GB), controlnet (22GB), loras (17GB), AnimateDiff, IPAdapter,
  insightface/pulid/reactor face stacks. Relevant to this work: **flux1-schnell (Apache
  2.0, present — the day-one $0 test model)**, flux1-dev + kontext (present but
  NON-commercial license — do not route channel content through them), full Wan 2.1/2.2
  video family (future free video tier). **Downloaded since (verified 2026-09-01):**
  `z_image_turbo_bf16.safetensors` (11.5 GB) and `krea2_turbo_fp8_scaled.safetensors`
  (12.2 GB) are now on disk. Qwen-Image 2.0 still absent. [verified]

## Distro decision (2026-08-30, refined same day)

**Resolution order — existing install first, bundled runtime as fallback** (the
`resolveFfmpeg()` pattern generalized). The HTTP API is identical across source /
portable-zip / ComfyUI Desktop; what differs is environment:

- On THIS machine the source install always wins: nightly torch cu130 + sage attention
  compiled for this GPU (sm_86) beat any pinned stable bundle *here* — sage attention has
  no universal prebuilt, so a bundle would run slower attention or none.
- **Bundling is a committed product goal** (Joseph, 2026-08-30): shipped builds — the Mac
  version especially — must not require installing ComfyUI or ffmpeg separately. Bundles
  are per-platform by necessity (Windows `python_embeded` portable; macOS Python+venv with
  torch-MPS — no CUDA on Apple Silicon). Built at packaging time (build-plan Part four-C
  C6). ComfyUI Desktop stays irrelevant (an Electron wrapper inside our Electron app).
- Model weights are never bundled (6–25GB each); the guided download flow serves both the
  existing-install and bundled cases.

Config surface: `COMFYUI_URL` (default `http://127.0.0.1:8188` — attach when healthy),
`COMFYUI_PATH` (`X:\_ai\comfy\ComfyUI`) + `COMFYUI_PYTHON` (`F:\python12\python.exe`) for
spawn-if-down.

## API surface (from the install's own openapi.yaml, v0.34) [verified]

- `POST /api/prompt` — submit a workflow graph (API format JSON); returns `prompt_id`.
- `GET /api/history_v2/{prompt_id}` — poll for completion + output metadata (v2 preferred;
  bare `/api/history` is legacy, `POST /api/queue` deprecated).
- `GET /api/view` — fetch an output image (an id-addressed variant is preferred over the
  filename-addressed one per the spec).
- `GET /api/system_stats` — the health check for attach-or-spawn.
- `GET /api/queue` — queue state; the wrapper still single-flights jobs itself (one GPU).
- WebSocket progress events exist; the wrapper polls instead (same pattern as the Gemini
  wrapper's long-running ops — no extra dependency).

## Recommended model loadout (researched 2026-08-30; weights to download)

| Model | Size/params | Role | 3090 speed | License |
|---|---|---|---|---|
| Z-Image Turbo | 6B | storyboard/draft tier | ~3s/image | Apache 2.0 (all variants) |
| Krea 2 Turbo (FP8) | 12.9B, ~12GB + Qwen3-VL-4B text encoder (~18.6GB loaded) | cinematic hero tier | 8-step 2K ≈ 13s | Krea community license — free commercial for individuals/small teams |
| Qwen-Image 2.0 (2026-02-10) | 7B, native 2K | text/thumbnail tier + instruction editing | fast | Apache 2.0 |
| flux1-schnell | 12B (already on disk) | day-one wrapper verification | 4-step, quick | Apache 2.0 |

Krea 2 Raw (undistilled) additionally serves LoRA training → Trained Styles integration.
**Avoid for channel content:** flux1-dev / Flux.2-dev (non-commercial weights).

## Lifecycle: the app owns the server (rewritten 2026-09-02)

**Main starts ComfyUI at boot and stops it at quit** (`src/main/comfyui-host.ts`).
The wrapper only attaches. The previous design — wrapper spawns it detached and
leaves a pid file in `%TEMP%` for the app to find — failed in practice: `%TEMP%`
is virtualized per launcher on Windows, so a server started under one launcher
was invisible to the app closed under another, and 12 GB of models outlived the
window until the machine OOM'd.

- Boot: attach if something already listens on the port. If its command line
  carries our spawn flags it is an orphan of a crashed run → adopted, stopped at
  quit. Otherwise it is the user's own server and is left alone. If nothing
  listens and `COMFYUI_PATH`/`COMFYUI_PYTHON` are set, spawn as a real child
  (not detached), stdout/stderr piped and parsed into a state the studio shows
  on its **status strip**: starting → ready → loading `<model>` → ready, or
  error. `LYME_COMFY_AUTOSTART=0` disables the autostart.
- Quit: `before-quit` and `will-quit` both run `stopComfyUI()`, which kills the
  process TREE (`taskkill /T /F`) by three independent routes — the child
  handle, the pid file (now in userData, not `%TEMP%`), and the port owner if its
  flags are ours.
- The wrapper's own spawn path remains as a fallback (headless tests, autostart
  off); it now writes its pid to `LYME_COMFY_PID_FILE`, which main injects.

Practical note: ComfyUI caches models in RAM and does not evict aggressively. On
this 32GB machine, loading flux (16GB) + z-image (12GB) + krea2 (13GB) in one
session drove free memory to 7.5GB and a generation stalled past the pipeline's
600s timeout. Restarting ComfyUI clears it.

**The same exhaustion has a second, faster failure mode (2026-09-01).** At 3GB
free, a z-image job did not stall — it died instantly inside the KSampler:

```
RuntimeError: HostBuffer.read_file_slice failed
  comfy_aimdo/host_buffer.py:109 in read_file_slice
  comfy/memory_management.py:70 in read_tensor_file_slice_into
```

`comfy_aimdo` streams weights from the safetensors file through a pinned host
buffer; with no host memory to pin, the read fails and the node raises. Read it
as "out of RAM", not as a corrupt model or a bad workflow — the file was intact
and an identical earlier job had succeeded. Same fix: restart ComfyUI. Worth
surfacing in the app, since from Lyme Hype's side this looks like a generation
that silently produced nothing.

## Negative prompts do nothing here (2026-09-02)

All three templates sample at **CFG 1.0** (checked: flux1-schnell, krea2-turbo,
z-image-turbo). Negative prompts act through classifier-free guidance — the
sampler steers away from the negative by the CFG margin — and at 1.0 that margin
is zero. z-image's template carries `blurry ugly bad` as its negative and it has
never had any effect. Distilled/turbo models are built for CFG 1; raising it
wrecks them.

So the safeguard against hallucinations (the second dog head, 2026-09-02) does
not go through negatives. It is `src/main/generation-guard.ts`: state count,
anatomy and framing in the POSITIVE prompt (the only thing a CFG-1 model reads),
then a vision check of the result with free local retries. Details in the
build plan. If a non-distilled model is ever added (SDXL at CFG 5–7), plumbing a
real negative through the wrapper becomes worthwhile; today it would be theatre.

## Memory policy (2026-09-02)

Images only — video is outsourced — so the policy is simple: **one model, in
VRAM, never parked in RAM.** The wrapper spawns with `--highvram` (a finished
model stays on the 24 GB GPU instead of being copied to system RAM for a faster
switch later) and `--cache-none` (no node-output cache between runs), and calls
`POST /api/free {unload_models, free_memory}` whenever the requested checkpoint
differs from the last one. Same model twice in a row stays warm. The cost is one
model load (~tens of seconds from X:) per switch; the alternative was 40 GB of
parked models on a 32 GB machine, which is exactly what OOM'd the box.

A user-started ComfyUI (attach path) keeps whatever flags it was started with —
this policy only applies to the server the app spawns.

## Gotchas (all paid for live, 2026-08-30)

- **A `git pull` without `pip install -r requirements.txt` breaks the server.** The fresh
  v0.34 pull failed twice from dependency skew: `av` needed ≥17 (had 15.1 — boot died on
  `ColorPrimaries` import) and `comfy-aimdo` needed 0.4.15 (had 0.3.0 — every checkpoint
  load died on `ModelMMAP.get_file_handle`). Rule: after every ComfyUI pull, re-run the
  requirements install into `F:\python12`.
- **Custom-node loading can hang boot indefinitely** (observed: startup frozen for 5+
  minutes mid-node-list). The wrapper's spawn passes `--disable-all-custom-nodes` — our
  templates are core-nodes-only, boot drops to seconds, and a user-started server with
  custom nodes still wins via attach.
- **`/api/history_v2/{id}` returns an EMPTY body on this build** even for completed jobs;
  the wrapper polls legacy `/api/history/{id}` (classic `{id: {outputs, status}}` shape,
  verified live), 404-tolerant while the job runs. Revisit when `/api/jobs` settles.
- **Cold-start arithmetic**: server boot + first checkpoint load + sampling exceeded the
  pipeline's old 5-minute cap — `generation.ts` now allows 10 (first flux1-schnell run:
  ~93s once booted; warm runs: seconds).

## Older gotchas

- One GPU = one job: the wrapper must serialize generations (ComfyUI queues internally,
  but interleaving Lyme jobs with Joseph's own ComfyUI sessions needs polite queueing, not
  parallel submissions).
- Model load/swap between different checkpoints costs tens of seconds on first use —
  successive same-model generations are fast; the wrapper should surface "loading model"
  vs "generating" in its progress.
- Workflow templates must be **API-format** JSON (the export from "Save (API format)"),
  not the UI-format graph. Each `_meta` may carry an `i2i` block (latentNode/samplerNode/
  vaeFrom) — with it, `comfy_generate_image`'s `reference_image_path` + `strength` run
  img2img: reference uploaded via `/api/upload/image`, empty latent replaced by
  LoadImage→ImageScale→VAEEncode, strength → KSampler denoise. Live-verified 2026-08-30.
- `extra_model_paths.yaml` exists if Lyme-managed weights ever need a separate tree;
  default is to download into the install's own `models/` dirs.
- The spawn path must set cwd to the ComfyUI repo root (folder_paths resolves relative).

## Sources

- Live machine inspection 2026-08-30 (version file, git log, python/torch probe, models
  dir listing) — [verified]
- `X:\_ai\comfy\ComfyUI\openapi.yaml` — API endpoints [verified]
- Model research: comfyui-wiki.com (Krea 2 open-source announcement 2026-06-22),
  localaimaster.com (Krea 2 local guide + license), comfylab.dev (Krea 2 on RTX 3090),
  github.com/Raigor2/local-inference-benchmarks (3090 turbo benchmarks),
  zimage.design (Z-Image licensing), medium.com/diffusion-doodles (Z-Image/Qwen-2512/
  Flux.2 rundown) — fetched 2026-08-30
