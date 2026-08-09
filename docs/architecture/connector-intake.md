# Connector intake — making the registry self-extending

How a newly added connector gets its tools mapped onto the app's capability vocabulary, its
models into [`src/shared/model-catalog.ts`](../../src/shared/model-catalog.ts), and — when
nothing existing fits — how that failure becomes the argument for a new capability or a new
creative node.

Companion to [`capability-map.md`](capability-map.md) (connector × capability) and the model
registry (model × capability). This doc is the *pipeline* that keeps both current without a
human hand-transcribing a reference doc every time.

**Status: designed, first slice landed.** Step 1 (retain `inputSchema`) is built. Steps 2–5 are
not. Nothing in this pipeline auto-applies to routing today.

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
   → classify tools → capabilities step 2
   → harvest models from docs      step 3
   → residue review                step 4
   → node proposals                step 5
```

### Step 1 — Retain what we already fetch ✅

`McpToolInfo` keeps `inputSchema`; `testConnector` writes an observed-tools record to
`userData/connector-tools/<id>.json` with the server name/version and a timestamp. No mapping,
no model calls, no behavior change — this exists so later steps have a real corpus to be
designed against rather than a hypothesis.

### Step 2 — Classify tools onto the capability vocabulary

For each observed tool, decide which of the `ModelCapability` keys it satisfies, using the
schema first: a tool taking `image_url` + `mask` + `prompt` is `image-inpaint`; one taking
`prompt` + `image_url` with no mask is `image-edit`; `video_url` + `audio_url` is `lipsync`.

Output is a **proposal record**, never a live edit:

```
{ connectorId, toolName, capability, confidence, evidence: {schemaFields[], docQuote?}, verdict }
```

Auto-apply only on a schema-grounded match against the closed vocabulary. Anything resting on
prose stays a proposal.

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
   ElevenLabs's call/agent tools. A blocklist cannot cover connectors nobody has seen yet. Newly
   observed tools whose name or schema suggests publishing, sending, deleting, purchasing, or
   key management are **denied until a human allows them**, inverting the default for anything
   unknown.

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
