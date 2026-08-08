# Connections and credentials

How Lyme Hype connects to generation tools and data sources (ChatRealty, Seedance, ElevenLabs, and anything else the user adds), and — the part that actually matters — how it handles the secrets that requires without an agent ever touching them. Split out from [canvas-node-model.md](canvas-node-model.md) once this grew past "a section about MCP" into its own real design surface.

## The connector model is generic, not a predetermined list

A connection is four things: **name**, **endpoint** (a URL, or a local command for a stdio MCP server), **auth type** (none / API key / bearer token / OAuth), and **the credential itself**. Any MCP server fits that shape — nothing about it is specific to ChatRealty or Seedance.

Known services (ChatRealty, Seedance, ElevenLabs) are **templates**, not hardcoded integrations: a name, a doc link, and the expected auth shape, pre-filled so setup for the common cases is faster. The mechanism underneath has to handle a fully custom connector from day one — that's the actual requirement, not a fallback path for power users. A Connections panel that's just "three pre-built rows plus a generic Add button" doesn't satisfy this; the generic path *is* the product.

## The agent as setup copilot — not an OAuth bypass

First framing, and why it's wrong: having the agent autonomously click through a provider's OAuth consent screen on the user's behalf. Rejected — a consent screen exists specifically so a *human* approves "this app gets access to that data." An agent doing that instead likely violates the provider's ToS and defeats the one moment in the flow that's supposed to require a person.

What Joseph actually asked for is different and reasonable: the agent drives the user *to* the right screen and helps them get set up — signup pages, an API-keys settings page, wherever the MCP endpoint or key actually lives — the same way Claude Code already drives a browser for Joseph rather than describing where to click. Two things make this concretely buildable:

- **No dependency on Anthropic's "Claude in Chrome" extension.** That's Anthropic's own consumer product, tightly paired with claude.ai/Claude Code sessions — not published as something a third-party app connects to generally.
- **Electron already is Chromium.** Lyme Hype's own Agent SDK session can drive a real browser view directly — via Claude's Computer Use capability, or a library like Playwright — with no external extension needed.

For an unfamiliar service the agent hasn't seen before, this also means it can research how to get an API key or MCP endpoint for that specific platform and walk the user through whatever it finds, rather than only working for services someone pre-documented.

## The credential boundary (this is the part that doesn't bend)

The agent navigates and explains. A human types the actual secret. This isn't about distrusting the model — it's about blast radius: Lyme Hype will be driving to arbitrary third-party sites it has never seen before, some unfamiliar, some possibly spoofed. "The agent never sees or types the password/key" is what keeps one bad signup page from becoming a real credential leak, regardless of which site it turns out to be.

Concretely: the copilot flow can navigate, click, and explain right up to the point a secret needs to be entered. At that point, control passes to the native secure-credential component below — not a form field the agent's own context can read.

## Native secure-credential component

Joseph already uses `~/.claude/tools/secure-input.js` with Claude Code for exactly this — a one-shot local page that collects a secret and writes it straight to its destination, reporting back only field name, length, and last-4, never the value itself. Lyme Hype needs the same *contract*, but built natively rather than depending on that external script (which exists specifically because Claude Code's chat transcript can't render an inline form — Lyme Hype doesn't have that constraint; it's a full Electron app).

**Status: built and self-tested (2026-08-08)** — `src/main/secure-credential.ts` +
`src/main/credential-vault.ts` + the `secure.html` modal page. A "Test secure input (fake
connector)" button lives in the Connections sheet; `LYME_SELFTEST=1 npm run dev` verifies the
vault round-trip on real DPAPI and that dismissing the modal stores nothing. One implementation
detail worth knowing: the modal window is identified by a per-request id passed via
`webPreferences.additionalArguments`, and the submit handler only accepts the value from that
specific window's webContents — a stray renderer can't impersonate the modal.

The native version is simpler than the original, not just a port of it:

- **A real modal `BrowserWindow`**, not a localhost HTTP server plus a system browser tab. No listening port, ever — the form lives inside Lyme Hype's own process, and the value returns to the main process over a narrowly-scoped IPC channel the preload script exposes, never over a network socket.
- **Same reporting contract to the agent**: field name, length, last 4 characters. Never the value. This is the one piece that has to carry over exactly.
- **Storage in OS-native secure storage** — Electron's `safeStorage` (DPAPI on Windows, Keychain on Mac), keyed per connector. Not a plaintext file, not an env var. Decided now on purpose: retrofitting real credential storage after several connector flows already assume "just an env var" is a much worse migration than starting with it.
- **Trigger shape**: `requestSecret({ connector, fieldLabel })` — the same component whether the agent's browser-copilot flow just walked the user to an API-keys page, or the user is adding a fully custom connector by hand with no agent involved at all.

### Design rule

Connector setup UI has **no path that collects a secret outside this component.** No plain `<input>` for a key living anywhere in agent-observable state, ever — not as a shortcut, not for a "trusted" template connector. One component, one contract, no exceptions, so the boundary above is actually enforced rather than just intended.

## Scope note: OAuth-shaped custom connectors

Not every custom connector will be API-key/bearer-token shaped — a user might add one that's genuinely OAuth-based. For those, the flow should still end in a real OAuth redirect with the human clicking "Allow" on the provider's own screen; the copilot/secure-component pattern above covers the API-key and bearer-token cases, not a replacement for OAuth where OAuth is what the service actually offers.

## Publishing accounts (Instagram, YouTube, etc.) — a different thing from MCP connections

Cut Room's export should be able to go straight to a connected social account instead of just a local file — finish a reel, publish it to Instagram or YouTube without leaving Lyme Hype. ChatRealty already does something like this (it links to social platforms), so this isn't a new idea, just a new place to apply it.

**This is not another entry in the MCP connector model above, even though it's "another external connection" in the loose sense.** The two are genuinely different things:

- **MCP connections** (ChatRealty, Seedance, ElevenLabs, custom) are generation/data tools the *agent* calls mid-session — API key or bearer-token auth, the generic connector shape described above.
- **Publishing accounts** are OAuth social-media logins — Instagram via Meta's Graph API, YouTube via Google's Data API. The user authenticates directly with Meta or Google; Lyme Hype gets an OAuth token back and never sees a password. Same shape as "Connect your Instagram" in any social scheduling tool — nothing generic or pluggable about it, it's platform-specific by nature.

**Reuse, don't reinvent.** jpsrealtor — a sibling project — already has a working, in-production account-linking flow for Instagram (and other platforms). Lyme Hype should port that flow rather than build a new one from scratch. The actual review of jpsrealtor's implementation is happening in a separate session against the real project directory; this doc will get more specific about the exact mechanics once that's done. Recorded here now so the *decision* (reuse jpsrealtor's flow, treat this as OAuth-not-MCP) doesn't get lost waiting on that review.

**The one rule that has to carry over.** jpsrealtor's own operating rules are blunt about this: publishing to Instagram is immediate at the API level — there's no draft step. That's a lesson already paid for once; it doesn't need repeating. Whatever the ported flow looks like, Lyme Hype's UI needs an explicit, deliberate confirm step before any publish action fires — never publish just because a connected account exists and a button was clickable.

**Open, pending the jpsrealtor review:**
- Which platforms are actually in scope beyond Instagram and YouTube — TikTok is a natural fit given the whole project's short-form/reels framing, but hasn't been explicitly asked for.
- Does Publish live on Cut Room only (post-export), or should Play view also be able to publish a single clip directly without an export step in between?

## Open questions

- **Visible vs. background browser automation.** Given the goal is trust as much as convenience, the copilot's browser should probably run visibly (the user watches it navigate) rather than headless — leaning toward visible, not fully decided.
- **Mid-flow interruptions.** What happens when a signup requires 2FA or email verification partway through? Does the copilot pause and wait for the user to complete that step, or hand off entirely at that point? Unresolved.
- **Auth-type detection.** Settings needs to handle none/API-key/bearer/OAuth without the UI caring which one a given connector uses — probably means the connector form asks the user (or the agent infers from what it found while browsing), rather than Lyme Hype trying to auto-detect it from the endpoint alone.
- **Agent tool-selection with multiple similar connections.** Carried over from the node model doc: if two connected tools could both handle a request (e.g. two video-gen connections), does the agent just pick, Claude Desktop/Code-style? Probably yes by default; unconfirmed.
