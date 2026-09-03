# Character sheets, location sheets, and the asset library

Provenance: an AI-cartoon-pipeline tutorial ("AI Animation Pipeline: How I Make Cartoons
100% With AI"), transcript reviewed 2026-08-31. Documented here as a process first; the UI
recommendation follows. **Nothing in this doc is built yet** — see the gap table at the end
for what already exists to build on.

This is a different shape of work from [`create-panel.md`](create-panel.md)'s Motion
graphics wizard. That one is a *linear job*: references in, one finished animation out.
This is a *production pipeline*: you build a library of reusable assets once, then every
subsequent scene is assembled from them. The tutorial's own framing — "animation studios
always build their production pipeline first; then every new episode is simply another
story built on top of those same assets."

---

## 1. The process, as the tutorial describes it

### 1.1 Art direction before any generation

The stated mistake is jumping straight to prompting. First collect references — not one
perfect image, but **a library** of styles, colours, character designs and environments
that share a world. The output of this step is a *visual language*, not an asset.

Same conclusion the Motion graphics work already reached: gathering happens outside the
app (Pinterest / ArtStation / Instagram). What the app needs is somewhere for the
resulting set to LIVE, which it does not have.

### 1.2 Casting the lead — two reference kinds, not one

The step is framed as casting an actor, not generating an image. Two uploads, doing two
different jobs:

- **Who** — images of the character (or of yourself).
- **How** — a style reference from the library above.

Then describe everything that must stay fixed: hair, clothes, accessories, eye colour.
The rule stated twice in the video: **whatever you leave undefined, the model invents.**
Generate several variations, compare side by side, and keep going until one "feels like
the face of the show".

### 1.3 The character sheet — the single source of truth

One good image is not enough, because the model only knows the character from that one
angle. Ask for a new expression, pose or camera angle and it fills in what it does not
know — this is **drift**. A character sheet locks those decisions once: the approved
design rendered across the angles and expressions the series will need.

Two points worth keeping:

- The sheet is generated **using the approved image as the reference**, so it inherits the
  design rather than reinventing it.
- **Fix design problems at this step.** Cheaper now than after twenty scenes exist.

From here on, every image and video references the sheet instead of re-describing the
character.

### 1.4 Expanding the world from the sheet

New assets — a dog, a prop, a location — are generated **with the character sheet as the
style reference**, so they inherit the world's visual language. Everything then "feels
like it belongs together" because it descends from a common ancestor.

### 1.5 Organise as you go

The library grows fast. Favourite and clearly name every keeper — characters, locations,
props — or you cannot find anything later. The tutorial treats this as a load-bearing
discipline, not housekeeping.

### 1.6 Location sheets — master, then views

Identical workflow to characters. Reference the character sheet for visual language,
generate the **master** version of the location, then generate **multiple views of the
same environment**: toward the sofa, toward the window, from above, from floor level.
Each view becomes a reusable shot.

The stated payoff, using The Simpsons as the example: recurring recognisable locations are
what make a world feel complete.

**The escape hatch matters too:** for a one-off cutaway you do *not* build a location
sheet — reference the character sheet and just describe the environment. Sheets are for
places you will revisit.

### 1.7 Scene assembly

A scene is **character sheet + one location view + what happens**. Both stay consistent
because both are references, not descriptions. "All you're doing is telling it which
character goes to which location."

### 1.8 Voices as assets

Generate the same test line several times ("where's the TV remote?"), compare, pick the
one that fits, and **save it**. Voice references then live in the asset library exactly
like images, named per character.

### 1.9 The scene-prompt step — one sentence in, a production prompt out

The tutorial uses an LLM skill preloaded with the script, character sheets, location
sheets and voice references. One sentence of intent becomes a full production prompt:
camera shots planned, the scene broken into **timestamped moments**, visual directions
written, and each line of dialogue placed. Default 15 s; "make it 5 seconds" re-plans it.

(The timestamped-beats structure is the same one the Motion graphics animate stage already
uses. Worth noting that two independent tutorials converged on it.)

### 1.10 Tagging references explicitly — the step "most people get wrong"

Do not attach references and hope. **Tag them inline in the prompt.** Instead of "show the
man sitting on the sofa", write "show @image1 sitting on the sofa from @view1 shown in
image two". Same for dialogue: **every line gets the voice tagged after it.**

The stated failure mode when you skip it: the model starts mixing voices halfway through a
multi-character scene.

### 1.11 Iterate, don't restart

Almost never regenerate from scratch. Swap one key visual, rewrite one action, regenerate
one scene. Prefer simple, readable compositions — they generate more reliably. Fix a bad
head or tail with a trim rather than a re-render.

---

## 2. Recommended UI flow for Lyme Hype

The pipeline splits cleanly into **build the library** (occasional) and **assemble a
scene** (constant). The UI should reflect that split rather than presenting one long
wizard, because the second half is what you do fifty times.

### 2.1 A real Asset Library — the foundation everything else needs

A fourth thing alongside Sessions, Canvas and Timeline: a **Library**, stored in the
workspace (`Documents\Lyme Hype\_library\`) so it is shared by every project, exactly as
Trained Styles are today.

One typed store, not four:

```
LibraryAsset {
  id, name, kind: 'character' | 'location' | 'prop' | 'voice' | 'style',
  tags: string[], favorite: boolean,
  sheet?: { images: [{ role: 'master' | 'angle' | 'expression' | 'view', src, label }] },
  voiceId?, sampleSrc?,           // kind: 'voice'
  derivedFrom?: assetId,          // what it inherited its look from
  createdAt, lastUsedAt
}
```

`derivedFrom` is worth the field: it records that the dog came from the character sheet,
which is the mechanism that makes a world cohere. It also gives a "what else came from
this" view when a design changes.

**Where it appears:** a Library tab beside Canvas / Storyboard / Scripting, plus a compact
picker rail inside any generate screen. Not buried in Settings — Trained Styles is in
Settings because it is configuration; this is working material.

### 2.2 Character sheet: a task screen, not a wizard

The Motion graphics wizard is six stages because each stage genuinely feeds the next. A
character sheet is two decisions, so it should be one screen:

1. **Who** — drop images (canvas nodes, upload, or an existing library asset) → these bind
   to `characterReferencePaths`, which already means "preserve this exact likeness".
2. **How** — pick a style asset → binds to `styleReferencePaths`, which already means
   "match the look, not the content". *The distinction the tutorial makes in words is
   already a real distinction in this codebase — it just has no UI.*
3. **Lock list** — a plain textarea prompted with the tutorial's own checklist: hair,
   clothes, accessories, eye colour. Label it as what it is: anything omitted gets
   invented.
4. **Casting grid** — N variations side by side. `BatchResultsGrid` already does this.
5. **Approve → Generate sheet** — the approved image becomes the reference for a
   multi-cell sheet (front / three-quarter / profile / back, plus a chosen expression
   set). Saved as one library asset with its cells.

The one piece of interaction design worth insisting on: an explicit **"fix the design
now"** step between approval and sheet generation, because the tutorial is emphatic that
this is the last cheap moment to change anything.

### 2.3 Location sheet: the same screen, different defaults

Same component, `kind: 'location'`: reference a character sheet (or style asset) for
visual language, generate the master, then generate **views** — with the tutorial's four
as preset buttons (toward the main subject, toward the window/light, high angle, floor
level) plus free-form. Each view is a cell in the asset.

And the escape hatch as a first-class button — **"one-off cutaway"** — which skips sheet
creation entirely and just runs a generation with the character sheet attached. Without
it, people will build location sheets for shots they use once.

### 2.4 `@` reference tagging — the highest-leverage piece

This is the feature I would build first if only one thing gets built, because it is the
step the tutorial calls out as the common failure and it improves *every* existing prompt
box, not just this pipeline.

An `@` in any prompt field opens a picker over the library; choosing an asset inserts a
visible chip and, invisibly, binds that asset to the correct reference role when the call
is made:

- character asset → `characterReferencePaths`
- style asset → `styleReferencePaths`
- location view → `referenceImagePaths`
- voice asset → the voice id on the audio call

So the user writes one sentence with chips in it, and the app assembles the correctly-typed
multi-reference call underneath. The tutorial's manual discipline ("tag the exact
reference") becomes something the UI does for you.

Dialogue gets the same treatment: a line followed by a voice chip.

### 2.5 Scene composer — where the library gets spent

The Scripting panel is the right home; it already owns multi-turn conversation with vision
input, and this is that same shape.

- **Cast row**: chips for the characters and the location view in this scene.
- **One line of intent**: "he searches the couch for the remote and finds it".
- **Duration**: 15 s default, with 5 / 8 / 15 presets.
- Output: a **timestamped beat sheet** — the same 2-second-beat structure the Motion
  graphics animate stage already produces — with camera direction and dialogue placed, and
  every reference already tagged.
- Each beat is editable before it becomes a generation, and **regenerable on its own**.
  That is 1.11's "swap one thing" made literal, and it is the difference between a toy and
  a pipeline.

### 2.6 Iteration affordances

Directly from 1.11, and cheap to add once beats are objects:

- **Regenerate this beat** — not the scene.
- **Swap a reference** on a finished beat and re-run just that one.
- **Trim head/tail** — already exists in Play view; it should be reachable from a beat
  without a detour through the canvas.

---

## 3. What exists vs what this needs

| Pipeline step | Today | Needed |
|---|---|---|
| Typed reference roles (who vs how) | **`characterReferencePaths` / `styleReferencePaths` / `referenceImagePaths` all exist** in `GenerationParams` and the MCP tool | UI that exposes the distinction |
| Compare variations side by side | `BatchResultsGrid` | reuse as the casting grid |
| Timestamped beat prompts | Motion graphics animate stage | generalise into the scene composer |
| Voice generation + cloning | ElevenLabs connector, `list_voices` / `clone_voice` / `generate_speech` | naming and storing a voice as an asset |
| A persistent cross-project library | **Trained Styles only** (LoRA), in Settings | the general `LibraryAsset` store |
| Character sheet / location sheet | — | new |
| `@` tagging in prompts | — | new; the highest-leverage item |
| Scene composer with per-beat regeneration | — | new |
| Asset provenance (`derivedFrom`) | — | new |

## 4. The cartoon flow, end to end

Sections 1-2 cover building the library. This is the whole loop the tutorial runs, so the
later half does not get lost: **the library is built once, then every episode is assembled
from it.** Steps 1-5 happen rarely; 6-9 happen every scene.

1. **Art direction.** Collect references outside the app until a visual language is
   apparent. Output: a style asset, not a picture.
2. **Cast the lead.** Likeness references + a style reference + an explicit lock list.
   Several variations, compare, pick.
3. **Character sheet.** The approved image becomes the reference for a multi-angle,
   multi-expression sheet. Design problems get fixed *here*.
4. **Expand from the sheet.** Props, animals, secondary characters generated with the
   sheet as the style reference, so the world descends from one ancestor.
5. **Location sheets.** Master, then the views you will actually shoot. One-off places
   skip this and just borrow the character sheet's look.
6. **Voices.** Same test line several times, pick, name, save. One per speaking character.
7. **Scene prompt.** One sentence of intent + the cast → a timestamped beat sheet with
   camera direction and dialogue placed. 15s default, re-plannable to 5 or 8.
8. **Tag every reference inline.** Characters, locations AND the voice after each line of
   dialogue. This is the step the tutorial says people skip, and skipping it is what makes
   a multi-character scene drift mid-shot.
9. **Generate, then iterate narrowly.** Never restart a scene: swap one reference,
   rewrite one action, regenerate one beat, or trim a bad head/tail in the edit.

An episode is steps 7-9 repeated. That is the whole claim — "opening Claude, describing
the next scene, and letting the workflow do the rest" is only true because 1-6 already
happened.

## 5. Correction: this is channel-scoped, not workspace-scoped

The first draft of §2.1 put the library at workspace level, shared by every project. That
is wrong, and [`../product/vision.md`](../product/vision.md) is why.

A channel owns an **identity** — niche, voice, audience, **visual language**. A character
sheet, a style asset and a location sheet ARE visual language. And the two modes are
context-loading rules: production mode loads the channel's memory, creative mode loads
**none**, and adoption runs one way only. A workspace-wide library would put one channel's
cast in front of an agent during a creative session — exactly the leak the mode split
exists to prevent.

So:

- **The library lives in the channel folder**, beside `identity.md` / `competitors.md` /
  `calendar.json` / `ideas.md`. It is part of what production mode loads as context.
- **Creative mode gets an unscoped scratch library** — assets belonging to no channel —
  and an **adopt into channel** action, the same one-way door productions already have.
- The Library header needs a channel selector with an explicit **"Creative — no channel"**
  state, so which world you are working in is never ambiguous.

This also resolves §6's first open question: the answer is neither workspace nor project.
It is the channel — the level the codebase does not have yet, which makes the channel
concept a prerequisite for this pipeline rather than a parallel effort.

## 6. Open questions

- **When a creative-mode piece is adopted into a channel, do its assets come with it?**
  Carrying them over is more useful; leaving them unscoped is more faithful to the one-way
  rule. Unresolved — see §5.
- **Do sheet cells become canvas nodes?** They are generations, and the current rule is
  that everything lands on the canvas. Twelve cells per character would flood it. Probably
  the sheet is one node, expandable.
- **How much of the scene composer is agent vs template?** The tutorial's skill is one
  prompt template plus preloaded assets. Lyme Hype could do it with a template and no
  agent call for the common case, which is cheaper and more predictable.
