# Connector intake — making the registry self-extending

How a newly added connector gets its tools mapped onto the app's capability vocabulary, its
models into [`src/shared/model-catalog.ts`](../../src/shared/model-catalog.ts), and — when
nothing existing fits — how that failure becomes the argument for a new capability or a new
creative node.

Companion to [`capability-map.md`](capability-map.md) (connector × capability) and the model
registry (model × capability). This doc is the *pipeline* that keeps both current without a
human hand-transcribing a reference doc every time.

**Status: designed, first two slices landed.** Step 1 (retain `inputSchema`) and step 2 (the
classifier + the default-deny screen, `src/main/connector-intake.ts`) are built. Steps 3–5 are
not. Nothing in this pipeline auto-applies to routing today, and nothing calls the classifier
yet — it is a pure function with no caller, deliberately.

---

## 1. Why this is tractable

The instinct is "build an agent that reads a connector's documentation." That is the expensive,
error-prone half of the problem, and it is mostly unnecessary — because **MCP servers already
publish machine-readable contracts and Lyme Hype already fetches them.**

`mcp-probe.ts` / `mcp-http.ts` call `tools/list` on every connector at connect time. The
response carries each tool's `name`, `description`, **and `inputSchema`** — a JSON Schema with
exact parameter names, types, enums, and required fields. Until the first slice below, the app
mapped that down to `{name, description}` and discarded the schema on arrival.

So the split is:

| Source | Carries | Trust |
|---|---|---|
| `tools/list` `inputSchema` | tool surface, parameter contracts, enums | **ground truth** — it is the server's own declaration |
| Provider docs | pricing, rate limits, model catalogs, gotchas, retirement dates | inference — needs review |

Schemas answer *"what can this connector do and how is it called."* Docs answer *"which of its
many models should a human pick, and what will bite us."* Only the second needs a language
model, and only the second can be confidently wrong.

## 2. The pipeline

```
connect connector
   → tools/list                    (already happens)
   → persist observed tools        step 1 ✅ landed
   → classify tools → capabilities step 2 ✅ landed
   → harvest models from docs      step 3
   → residue review                step 4
   → node proposals                step 5
```

### Step 1 — Retain what we already fetch ✅

`McpToolInfo` keeps `inputSchema`; `testConnector` writes an observed-tools record to
`userData/connector-tools/<id>.json` with the server name/version and a timestamp. No mapping,
no model calls, no behavior change — this exists so later steps have a real corpus to be
designed against rather than a hypothesis.

### Step 2 — Classify tools onto the capability vocabulary ✅

For each observed tool, decide which of the `ModelCapability` keys it satisfies, using the
schema first: a tool taking `image_url` + `mask` + `prompt` is `image-inpaint`; one taking
`prompt` + `image_url` with no mask is `image-edit`; `video_url` + `audio_url` is `lipsync`.

Output is a **proposal record**, never a live edit:

```
{ connectorId, toolName, capability, confidence, evidence: {schemaFields[], docQuote?}, verdict }
```

Auto-apply only on a schema-grounded match against the closed vocabulary. Anything resting on
prose stays a proposal.

Built as `classifyTool` / `classifyObservedTools` / `reportResidue` in
[`src/main/connector-intake.ts`](../../src/main/connector-intake.ts), with the record shapes in
`src/shared/intake-types.ts`. Pure and deterministic — no model call, no network, no disk, no
Electron import. `confidence` is the *weakest* evidence tier a proposal rests on (`schema` >
`name` > `description`), and only `schema` yields `verdict: 'auto-applicable'`. The medium a
tool outputs is the usual weak link, since a schema declares inputs and never outputs: some
parameters still pin it (`duration` + `aspect_ratio` is a video — audio has no aspect ratio;
`num_images`/`width` with no duration is an image; a voice field is audio), and where they
don't, the tool's name does the work and the tier drops to `name` to say so out loud.

**The classifier is structurally blind to three of the eight connectors.** fal, Krea and Yapper
are *generic-dispatch* servers: `run_model{endpoint_id, input}`, `generate{model, params}`,
`yapper_start_process{type, model, input}`. The capability lives in a `model` string chosen at
call time, not in the schema — so all 27 of their tools classify to nothing, while
[`capability-map.md`](capability-map.md) correctly marks all three ✓ for real capabilities.

This is an architecture limit, not a residue-vocabulary gap, and it has a sharp consequence:
**any later step that reads "no proposal" as "no capability" will silently mark half the catalog
dead.** Dispatch servers need their capability from `search_models`/`get_model_schema` output or
from the reference docs (step 3), never from `tools/list` alone.

### Step 3 — Harvest models from documentation

The model catalog (which of muapi's 591 models are worth showing) is genuinely a docs problem.
This step produces `CatalogModel` candidates with the same `[verified]`/`[docs]`/`[unverified]`
tiering the reference docs already use, and it must fill `retiresOn` and `unavailable` — the
two fields that stop a picker offering something that will fail or vanish.

### Step 4 — Residue review: the part that actually matters

**Tools that map to nothing are the valuable output, not the failure.** A connector arriving
with `image-to-3d`, `motion-control`, or `video-to-music` and matching no existing capability is
the app discovering a gap in its own model of the world.

Residue is never auto-resolved. It accumulates into a report, and a human decides whether it is:
noise (a tool we will never surface), a **new capability** (extend the vocabulary and the
matrix), or evidence for a **new node**.

`reportResidue` groups it by connector and marks anything the screen denied, so a side-effect
tool is never mistaken for a capability gap. Its first pass over the catalog's own eight
connectors surfaces a drift finding rather than a new-node argument: `voice-library`,
`asset-upload` and `data-mls` are in [`capability-map.md`](capability-map.md)'s vocabulary but
have no `ModelCapability` counterpart, so `search_voices`, `muapi_upload_file` and every
ChatRealty tool land in residue permanently. That is the two-vocabulary split doing its job —
the model registry only keys things a *model* does — but it means residue has a known floor
that a reviewer should not keep re-reading as a gap.

### Step 5 — Node proposals, and why nodes must become manifests

Enough residue clustering in one area is the argument for a new creative node. But
"auto-generate a node" only becomes safe if a node stops being hand-written TSX.

Everything the redesigned image panel does is declarative: a preview, a toolbar whose buttons
each map to a capability, setting squares, a model pill row derived from the selected tool's
capability, one prompt, a parameter row, a primary action, a commit action. That is a manifest:

```
{ id, title, media, tools: [...], settings: [...], parameters: [...], commit }
```

One renderer, many declared nodes. Then "add a node" is adding a *record* — the same risk class
as adding a model — instead of generating React. **This is the architectural precondition for
the whole idea.** See [`../ui/creative-nodes.md`](../ui/creative-nodes.md).

---

## 3. Hard rules

These are not preferences. The pipeline consumes third-party text and configures an app that
holds a credential vault.

1. **Generated output is data, never code.** Proposals are records validated against a schema on
   the way in. Nothing in this pipeline emits an executable path, a shell command, or a URL the
   app then calls unprompted.

2. **Default-deny side-effecting verbs on discovery.** `DANGEROUS_TOOLS_BY_SERVER` in
   `generation.ts` is a hand-maintained blocklist naming muapi's Stripe/key tools and
   ElevenLabs's call/agent tools. A blocklist cannot cover connectors nobody has seen yet, so the
   rule is that anything unrecognised must be denied, not allowed.

   **`screenTool` / `deniedToolNames` does NOT yet satisfy this rule.** It returns `deny` when a
   keyword matches and `allow` otherwise — a bigger blocklist, not an inversion. An adversarial
   review (2026-08-09) walked straight past `wire_transfer`, `place_bid`, `create_post`,
   `sql_query`, `drop_table`, `grant_access`, `set_webhook` and a nested `{input:{command}}`
   wrapper. It also over-denies read-only `muapi_account_balance` and `muapi_keys_list`, which
   `generation.ts` allows on purpose.

   This matters more than a normal false-negative list, because `generation.ts` grants
   `allowedTools = ['mcp__<server>']` server-wide — the deny list is the **only** tool-level gate.
   **Do not wire `deniedToolNames()` into `generation.ts` in its current form.** The fix is the
   inversion the rule actually asks for: the classifier already knows which tools *are* generation
   tools, so emit an allowlist of classified tools and deny everything else. Until then the screen
   is advisory triage for a human reviewing residue, and nothing more.

   It deliberately does **not** screen `upload` — asset upload is a prerequisite for half the
   catalog's i2v paths, and denying it by keyword would break generation to prevent nothing.

3. **Connector documentation is untrusted input.** It is fetched content, not instruction. Text
   inside a provider's docs that addresses the agent, claims authority, or asks for a credential
   to be forwarded is data to be reported, never followed. This is the same boundary as
   `AGENTS.md` §1.5 — the credential rule doesn't bend for an automated pipeline either.

4. **Never auto-extend the vocabulary.** Adding a `ModelCapability` changes routing everywhere.
   Classification picks from the closed set or reports residue; it does not invent keys.

5. **Provenance on every generated record** — source, method (schema vs doc), and date — so any
   entry can be re-derived and staleness is visible. `MODEL_CATALOG_VERIFIED_ON` is the coarse
   version of this today.

6. **No live billed calls to verify a mapping.** Same standing rule as everywhere else: build the
   wiring, don't fire it. Schema enumeration and doc reading are free; generation is not.

## 4. The failure mode this must survive

Doc-derived facts are *confidently wrong*, and this project has two proofs already.

The overnight enrichment routine shipped 31 runs of real, typechecked, doc-faithful wiring
across every connector — none of which has ever been exercised against a live key. And during
the image-panel redesign, the toolbar was drawn with Expand routed to a Yapper `outpaint_image`
tool inferred from a plausible-looking tool list; checking the reference doc showed **no
connector in the catalog exposes a dedicated outpaint endpoint at all.** That error happened
inside a conversation with a human reading every message.

An unattended pipeline has none of that friction. Which is the entire reason for the
schema-first split: the parts that can be checked mechanically are applied automatically, and
the parts that cannot are queued for a person.

## 5. Open questions

- **Where do proposals live?** A JSON file under `userData`, or committed to the repo so review
  happens in a diff? The repo makes review real but puts machine output in version control.
- **Re-probe cadence.** Connectors change under us — models retire, tools appear. Re-probe on
  every launch, on connector test, or on a schedule?
- **Does the classifier run locally through the Agent SDK** (the app already hosts it) **or as a
  build-time script?** In-app means it works for connectors the user adds themselves, which is
  the whole point — but it also means the app is modifying its own routing data at runtime.
