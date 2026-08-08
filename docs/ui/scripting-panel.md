# Scripting panel

**Not built yet.** A third middle-panel view, alongside [Canvas and Storyboard](canvas-and-storyboard.md) — a traditional chat interface with the agent for developing a script before any shot exists. `StudioView` becomes three-way (`'canvas' | 'storyboard' | 'scripting'`), not two.

## Why a chat here, when the rest of the app deliberately isn't one

The stephenlawyer.clothing precedent (`../history.md`) settled that the app's *primary* surface is a canvas, not a chat log — a single-shot prompt form was proven enough for driving generation, and that's still true for generation. Scripting is a different job: developing a narrative/script is iterative, conversational, and genuinely benefits from back-and-forth with an LLM the way a spatial canvas doesn't — nobody drafts a script by dragging nodes around. This isn't a reversal of the earlier decision, it's recognizing that "the app's main surface is spatial" and "one specific task inside the app is conversational" aren't in tension. jboogx's Night Shift used a chat thread as its *entire* app; Lyme Hype scopes that same interaction pattern down to the one view where it actually fits.

## Where it sits

Third button in the existing Canvas/Storyboard toggle (currently `CanvasArea.tsx`'s `view-toggle`, currently two buttons calling `setView`). Scripting is a session-scoped view like the other two — a session's script, canvas state, and generated assets all belong together, the same way Sessions already scope "canvas state, generated assets, and chat/agent history" per the existing model.

## The chat itself — a real architectural gap to close first

Every agent call Lyme Hype has built so far is **single-turn**: `runAgentPrompt` (the agent-link ping) and `runGeneration` (the generation orchestrator) both call the SDK's `query()` once per invocation with `maxTurns` capped and no persisted conversation state between calls. A genuine chat interface needs the opposite — a persistent, multi-turn conversation the user can keep adding to, with the agent's own prior replies as real context, not a fresh one-shot every message.

**This needs new plumbing, not just a new component:** a `runScriptingTurn`-shaped function (or a persistent `query()` session kept alive in the main process per active session-tab) that maintains conversation history and streams replies the way `agent:stream` already does for the existing single-shot agent-link card, but across many turns instead of one. Budget this as real work, not a thin UI wrapper around what exists.

Not the only place this plumbing is needed — the Create panel's Motion graphics tile (`create-panel.md`) has its own iterative prompt-refinement loop (abstract references → prompt variations → feedback → revise) that's the same conversational shape as this. Whichever gets built first should build the multi-turn plumbing generically enough for both, rather than solving it twice.

## The conversation

Standard chat layout — message list + input box, not the aside's single-shot prompt form. The agent's job here is straightforwardly "help develop a script": brainstorm, draft, revise, answer "what if" questions about structure or pacing. No tool calls, no MCP connectors attached (this is pure conversation, not generation) — same `settingSources: []` isolation the rest of the app's agent calls already use, so it doesn't inherit anything from the machine's own Claude Code config.

## Script → Storyboard handoff

Once a script feels solid, an explicit action moves it into Storyboard — not an automatic sync, a deliberate "send to storyboard" step:

1. **Break the script into shots.** The agent (or the user manually) segments the script into a shot list — this is itself worth doing as an agent turn in the same conversation ("break this into shots") rather than a separate mechanism, since the agent already has the full script in context.
2. **One Storyboard panel per shot**, created via the existing `addPanel` action — the panel's `label` gets a short shot description, and critically, the panel does **not** get a finished generation prompt yet.
3. **The user supplies a "generalized feeling" per shot** — mood, tone, a couple of words, not a full prompt. This is the human judgment step: the script says *what happens*, the feeling says *how it should land*.
4. **The agent improves the prompt from both inputs.** Script content for that shot + the user's feeling annotation go back to the agent (a lighter one-shot call, not the ongoing chat conversation) to produce the panel's actual `note` — the field that already feeds `generateMedia` when a panel is promoted. This is the same "structured, agent-authored shot prompt" idea jboogx's Night Shift used (a multi-field schema — lighting, action, production design, motion continuity, subtext) rather than the user hand-writing a single prompt string from scratch; Lyme Hype's panel only has one `note` text field today, so the agent's job is to produce good structured *prose* into that one field rather than the app rendering separate schema fields — simpler UI, same underlying quality idea.

## Nice-to-have, not core scope

jboogx's Night Shift let the chat reference specific assets by an addressable token (`@image1`, `@video1`, `@audio1`) that a console UI resolved into real drop targets. An analogous idea here: letting the Scripting chat reference existing canvas nodes or storyboard panels by name, so the agent can propose "combine shot 3 with the establishing clip we already generated" concretely rather than abstractly. Interesting, not required for v1 — the script → storyboard handoff above doesn't depend on it.

## Decisions (firm, for an unattended build)

- **The conversation persists**, same mechanism as everything else — an array of messages on `Session` (alongside `nodes`/`cutRoom`), written through the existing debounced `persist()` path. No new persistence mechanism to design; it's plain JSON like the rest of session state. Size/pruning isn't a v1 concern — revisit only if it becomes one in practice.
- **Cost visibility**: reuse the store's existing `agent` cost-tracking shape (`lastCostUsd`/`totalCostUsd`, already tracked per the single-shot agent-link card) — the Scripting panel's header shows a running per-session total, updated after each turn. No new tracking infrastructure, just a second place that reads the same numbers.
- **"Break into shots" always creates fresh panels** — no matching against or updating existing panels from a prior draft. Simplest correct behavior for v1; the user deletes stale panels manually if iterating on an already-storyboarded script. Revisit only if that proves annoying in practice.

## Open questions

None left that would block an unattended build — the three above were the only ones and are now decided.

## Done when

A user can hold a multi-turn conversation refining a script, trigger a shot breakdown that creates one Storyboard panel per shot, annotate a panel with a short feeling, and get back an agent-improved prompt in that panel's note field — ready to promote the normal way.
