# Product vision — what Lyme Hype is for

Decided with Joseph 2026-08-29. This is the theory document the projects/memory
infrastructure is built against; `build-plan.md` sequences the work, this explains why the
structure is what it is. When a structural decision here changes, change it here first.

## Purpose

Lyme Hype is a **premiere social media content creation tool** — shorts-first, long-form
capable, with no loose strings: from channel identity all the way to the scheduled post
landing on YouTube or Instagram, every step happens inside the tool.

## The core hierarchy: Channel → Production → assets

What Phase 23 called a "project" is really the **production** — one unit of content
(idea → script → storyboard → generated assets → cut → title/description/tags → publish
record). Above it sits the **channel**, a first-class concept the current codebase doesn't
have yet:

- A channel maps to a real YouTube channel or Instagram account (connected via their APIs).
- A channel owns an **identity** — niche, voice, audience, visual language, channel art —
  which Lyme Hype can *create from scratch* (spin up a new dogs-information channel:
  art, descriptions, everything) or *learn from what exists* (repurpose a live account).
- A channel owns a **content calendar / production schedule**: which videos to make, when
  each posts. Calendar entries become productions.

## The two modes

The modes are **context-loading rules**, not separate features — the same semantics as
CLAUDE.md scoping in Claude Code (which is the model this wrapper is built on):

- **Production mode** — every agent call loads the channel's memory (identity,
  competitors, past ideas, calendar). The pipeline: Claude audits competition and pitches
  video ideas onto the calendar → Scripting/Storyboard pre-produce them → the studio
  generates image/video/voiceover/music → ffmpeg cuts and burns subtitles → the publish
  layer posts on schedule with the pre-produced title/description/tags.
- **Creative mode** — Joseph at the UI in a focused session. Agents load **no** channel
  context and no historical generations; fully agnostic. A creative-mode piece can later be
  **adopted into a channel** (one-way: it then enters the calendar and gets channel-styled
  metadata). Channel context never leaks the other direction.

## Decisions (2026-08-29, multiple-choice with Joseph)

1. **Publishing is always approval-gated — no exceptions.** Every video must be approved
   by a human before it can publish; approval is what arms its calendar slot, and the
   scheduler then fires at the scheduled time. There is no per-channel auto-publish
   opt-in. This extends AGENTS.md §6 (publish is immediate at the API level, deliberate
   confirm required) from a UI rule into the production pipeline's state machine:
   `draft → ready → approved → posted`, and only `approved` items are visible to the
   scheduler.
2. **A background service runs scheduled work, plus platform-native scheduling.** A small
   always-on service (installed by the app) handles Instagram posting and scheduled agent
   jobs (audits, batch pre-production). YouTube uploads happen early as private with
   `publishAt`, so Google fires those even when the machine is off. Instagram has no
   native scheduling, so IG posts depend on the service being awake.
3. **Channel memory is plain editable files** in the channel folder — Claude drafts them,
   Joseph can open and edit them in any editor, and they are exactly what production mode
   loads. No opaque store:
   - `identity.md` — niche, voice, audience, visual language
   - `competitors.md` — the audited landscape
   - `calendar.json` — schedule entries → production folders
   - `ideas.md` — ledger of pitched/made ideas so Claude never re-pitches what exists
4. **Competition auditing is asymmetric by design.** YouTube audits use real Data API
   numbers (competitor channels, cadence, titles, views). Instagram exposes almost nothing
   for accounts you don't own, so IG auditing is Claude doing web research on public
   profiles/trends. No third-party IG data provider for now.
5. **Research goes beyond analytics — it sources real media.** A production about a real
   event wants the actual photos/footage (the real crash photos) alongside generations, on
   the canvas, pinned to storyboard shots, and cut into the final video. The research flow:
   the agent hunts the web for the best candidate media on the topic → candidates land in a
   pick grid → picks import as assets with a `research` source badge and their source URL
   attached. **Rights are the creator's judgment, not the tool's** (Joseph, 2026-08-29):
   fair use covers most of this work and that call belongs to him — the LLM's job is to
   find the best references and content possible, never to gate, steer, or warn. Source
   URLs are kept as useful metadata (re-finding, optional crediting), not compliance.

## The research process (both modes)

Research is available in creative mode too — same flow, minus the channel/competitive
layer. For any topic ("informational video about dinosaurs"), the research agent runs
parallel hunts:

1. **Content research** — Claude web research condensed into `research.md` in the
   production folder: key facts with sources, candidate angles, hook options. The script is
   written FROM this brief; it is the ground truth that keeps informational content
   factual.
2. **Media research** — real photos/footage/diagrams of the topic → candidate pick grid →
   picks become `research`-badged assets (source URL attached).
3. **Competitive research** (production mode only) — YouTube Data API numbers on what
   performs in the niche, checked against the channel's `ideas.md`.

Research is the substrate, not a stage: the brief feeds the storyboard and then the
script; storyboard panels pin research media and mark each shot real / generated /
motion-graphics; generations run reference-conditioned on the pinned real media (the
generated T-rex inherits anatomy from the fossil photos); sources ride along to the final
cut.

## The production pipeline (decided 2026-08-29)

Stages, in order, each ending at a human approval gate:

```
intake → research → STORYBOARD → SCRIPT → production (generate/cut) → publish-ready → approved → posted
```

- **Storyboard before script — canon, with reasoning** (Joseph): storyboarding first
  creates a visual-driven, content-driven experience from the research and generations —
  the storyboard outlines the "bullet points" of the pre-script as a **shot catalogue**,
  and scripting then *refines against that catalogue*, instead of writing a script and
  hunting for shots that fit it. This REVERSES the built script→storyboard handoff
  (scripting-panel.md); the pipeline needs the storyboard→script direction.
- **Intake differs by mode.** Production mode: not questions — the topic comes automated
  off the calendar, so the LLM presents its plan as **bullet points to approve** (angle,
  beats, media strategy). Creative mode: a real interview — a chat UI where the LLM asks
  specifics about the video and offers creative proposals, driven as **multiple choice
  with a free-text option** (the AskUserQuestion pattern as a product surface).
- **Priority queue, never idle.** While video A waits at a gate (say, script approval),
  the orchestrator advances video B per the calendar — researching the next topic, and so
  on. Approvals across all in-flight productions surface in one queue view.
- **Work-ahead horizon: content stays ~3–5 days out** ahead of the posting calendar — far
  enough for momentum, not so far that spend piles up behind an unapproved gate.
- **Breaking-news interrupts.** Each channel's scheduled jobs include monitoring news on
  its topic. A big story (a new dinosaur fossil discovered, for the dinosaur-facts
  channel) **interrupts the schedule**: a rush production is inserted at the head of the
  queue to cover it, and scheduled items shift. This is a standing per-channel variable,
  not an occasional manual action.

## Analytics — closing the loop (decided 2026-08-29)

Analytics is not a bolt-on dashboard; its job is feeding what happened back into what gets
made next.

**Sources.** YouTube Analytics API (views, watch time, impressions/CTR, subscriber deltas,
demographics, and per-video audience-retention curves) and Instagram Graph insights (reach,
plays, saves/shares, follower growth) — both on the same OAuth connections the publishing
port requires, with analytics scopes added.

**Collection & storage.** The background service pulls per-channel daily. Raw snapshots
land as data (`channels\<name>\analytics\*.json`); Claude maintains a human-readable
`performance.md` digest, and that digest — not raw dumps — is what production mode loads.

**Learnings are segmented by content type.** "What works" differs by short-form vs
long-form, informational vs creative, etc. — so baselines and derived learnings are keyed
per content style, never blended channel-wide. **Open task:** the segmentation schema
itself (which content types, which strategy dimensions per type) comes from a dedicated
deep-research session — competition analysis exposing the best strategies per content
style — before the digest structure is finalized.

**The three loops:**
1. **Postmortems** — after posting, the agent compares a video against its content-type
   baseline and writes `postmortem.md` into the production folder.
2. **Ideation feedback** — calendar/ideation reads `performance.md`, so pitches are shaped
   by measured performance.
3. **Retention mapped to the edit (differentiator).** Lyme Hype has the timeline that made
   the video: overlay YouTube's retention curve on the cut's shot boundaries and the
   postmortem says "viewers drop at the second talking-head segment (storyboard shot 4)",
   not "viewers drop at 0:14". Rendered as an overlay under the Cut Room timeline;
   per-shot attribution feeds future storyboard-stage decisions.

**Post-publish interventions.** Cron checkpoints at **1 week, 2 weeks, and 1 month** after
posting: the agent evaluates against baseline, and on underperformance **asks** for a
post-publish intervention (retitle, new thumbnail, description tweak) through the approval
queue. At most **1–2 revisions per video**. Never unprompted changes to a live channel.

**Surfaces.** In-app **channel dashboard** (charts + the retention-on-timeline overlay) is
primary. Digests also flow OUT of Lyme Hype into the **thinkbigjoe ecosystem**, where the
agent **Venus** delivers them via Telegram — the natural surface is the app's own MCP
server (a digest/analytics tool Venus's stack can call) and/or the digest files themselves.
Integration mechanics TBD with the thinkbigjoe side.

## Folder layout (extends the Phase 23 model)

```
Documents\Lyme Hype\
  channels\
    dogs-info\
      identity.md  competitors.md  calendar.json  ideas.md
      art\                         ← channel art, thumbnails templates
      productions\
        2026-09-02_why-dogs-tilt-their-heads\
          project.json             ← the existing production unit
          script.md  storyboard…   ← pre-production artifacts
          assets\2026-08-29\…      ← date subdirs, prompt-named files
          publish.json             ← title/desc/tags, approval state, post record
  scratch\                         ← creative mode: productions with no channel parent
```

Assets within a production use **date subdirectories with prompt-derived names** and a
`.thumbs\` mirror (decided the same day; supersedes the flat-uuid store — the
`lyme-asset://` resolver gains sanitized relative paths with legacy-flat fallback).

## What this implies for the build (pointers, not specs)

- **Channel store + memory files** — new layer above `project-store.ts`.
- **Publishing connectors** (YouTube/Instagram OAuth, ported from jpsrealtor per
  `connectors/publishing.md`) become load-bearing, with the approval state machine.
- **Scheduler service** — the always-on piece; new build target alongside app and UXP.
- **Audit + ideation flows** — scheduled agent jobs writing into the memory files and
  calendar; YouTube Data API connector for competitive data.
- **Media research flow** — agent web-hunt → candidate pick grid (BatchResultsGrid's
  shape) → import with source URL; a `research` source badge joining gen/file/link/gfx;
  storyboard panels able to pin researched media as shot references.
- **Storyboard→script handoff** — the reverse of the built script→storyboard direction:
  the shot catalogue (panel labels, notes, pinned media) becomes the scripting context.
- **Intake surfaces** — creative mode's MC-plus-freetext interview chat; production
  mode's bullet-plan approval cards; the cross-production approval queue view.
- **Pipeline orchestrator** — the per-stage state machine, priority queue, 3–5-day
  work-ahead horizon, and news-interrupt insertion; runs under the background service.
- **News monitoring** — per-channel scheduled scans for big stories on the channel's
  topic, feeding the interrupt path.
- **Analytics layer** — daily puller job (YT Analytics + IG insights), per-content-type
  digest writer (`performance.md`), postmortem job with 1w/2w/1mo cron checkpoints and
  intervention proposals, channel dashboard view, retention-on-timeline overlay in the
  Cut Room, and a digest surface on the MCP server for Venus/Telegram (thinkbigjoe).
- **Content-type strategy research** — the pending deep-research session that defines the
  segmentation schema (content types × winning strategies) the analytics digest is built
  around.
- The studio (canvas/storyboard/scripting/Cut Room) and the MCP tool surface already built
  are the production engine these layers drive.

Sequencing lives in `build-plan.md`. Its Part four (2026-08-29) deliberately comes first:
every connector wired and live-tested through the tooling layer, images → video → the rest.
Production mode is Part five, sequenced from this document when Part four is done.
