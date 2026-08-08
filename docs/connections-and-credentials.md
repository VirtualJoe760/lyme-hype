# Connections and credentials

How Lyme Hype connects to generation tools and data sources (ChatRealty, Seedance, ElevenLabs, and anything else the user adds), and — the part that actually matters — how it handles the secrets that requires without an agent ever touching them. Split out from [canvas-node-model.md](canvas-node-model.md) once this grew past "a section about MCP" into its own real design surface.

## The connector model is generic, not a predetermined list

A connection is four things: **name**, **endpoint** (a URL, or a local command for a stdio MCP server), **auth type** (none / API key / bearer token / OAuth), and **the credential itself**. Any MCP server fits that shape — nothing about it is specific to ChatRealty or Seedance.

Known services (ChatRealty, Seedance, ElevenLabs) are **templates**, not hardcoded integrations: a name, a doc link, and the expected auth shape, pre-filled so setup for the common cases is faster. The mechanism underneath has to handle a fully custom connector from day one — that's the actual requirement, not a fallback path for power users. A Connections panel that's just "three pre-built rows plus a generic Add button" doesn't satisfy this; the generic path *is* the product.

## ChatRealty connection — resolved shape (2026-08-08, from the jpsrealtor review)

Phase 3's first real connection is now fully spec'd from the actual jpsrealtor implementation
(`F:\web-clients\joseph-sardella\jpsrealtor\packages\mcp-server`), and Lyme Hype's ability to reach
it is **proven** — the app spawns the server, completes the MCP handshake, and lists all 34 tools
(`src/main/mcp-probe.ts`, exercised by `LYME_SELFTEST=1`).

- **Transport: stdio, not a URL.** ChatRealty ships as `@chatrealty/mcp-server` (a Node stdio MCP
  server). A client launches it and talks JSON-RPC over stdin/stdout. So this connector's
  "endpoint" is a **local command**, exercising the command-not-URL half of the generic connector
  model from day one.
- **Client config** (the shape Lyme Hype stores and hands to the Agent SDK's `mcpServers`):
  `command: "npx", args: ["-y", "@chatrealty/mcp-server"]` (or `command: "node", args: ["<local dist>/index.js"]`),
  `env: { CHATREALTY_API_TOKEN, CHATREALTY_API_BASE }`.
- **Auth: bearer token in env.** `CHATREALTY_API_TOKEN` must start with `crt_live_` and is sent as
  `Authorization: Bearer <token>` by the server. `CHATREALTY_API_BASE` is optional and defaults to
  the **hosted** `https://jpsrealtor.com`; override only for local/staging. The token is minted at
  `https://jpsrealtor.com/agent/settings → Integrations`.
- **The photos-as-image-nodes mechanism already exists server-side.** `get_listing_photos` fetches
  a listing's photos and returns them as MCP **image content blocks** (base64), not bare URLs —
  exactly what Lyme Hype needs to drop real listing photos onto the canvas. `search_listings`,
  `get_listing`, and `show_listing_board` also carry photo data. So Phase 3's "pull real photos"
  feature is: connect → agent calls `get_listing_photos` → map returned image blocks to Image nodes.
- **Credential handling is unchanged:** the `crt_live_` token goes into the token field via the
  native secure modal → `safeStorage` vault, keyed by the connector. The main process injects the
  decrypted value into `CHATREALTY_API_TOKEN` when it spawns the server; the token never enters
  agent-observable state. A dev-only `.env.local` fallback is allowed for local iteration.
- **Blocker (as of 2026-08-08):** the only ChatRealty token found on the machine (in jpsrealtor's
  own config) is **revoked** on hosted (`token_revoked`/403) and its local backend (`localhost:3000`)
  isn't running. The working credential is the claude.ai connector's, which is stored server-side
  and not extractable. Phase 3's live step needs a **fresh hosted `crt_live_` token** from Joseph.

## Generation connectors — researched landscape (2026-08-08)

Researched the generation tools Joseph named (Krea, Seedance, Dreamina, muapi, ElevenLabs, Yapper, Midjourney, Gemini) and drove his logged-in Chrome to each real API-keys page. The big realization: **most of these overlap.** Krea, fal, muapi, and Yapper are all *aggregators* reselling the same underlying models, and **Seedance, Dreamina, and Midjourney are models, not keys** — you reach them through an aggregator, not a dedicated connection.

| Tool | Key page | Connect shape | Covers | Status in Lyme Hype |
|---|---|---|---|---|
| **muapi** | `muapi.ai/access-keys` | stdio `npx -y muapi-cli mcp serve`, `MUAPI_API_KEY` | image+video+audio (Seedance, Kling, Veo, Flux, **Midjourney V7**, Suno) | **built-in template, works today** |
| **ElevenLabs** | `elevenlabs.io/app/settings/api-keys` | stdio `uvx elevenlabs-mcp`, `ELEVENLABS_API_KEY` | voice, music, SFX | **built-in template, works today** (needs `uv` runtime) |
| **Gemini** | `aistudio.google.com/apikey` | stdio wrapper over `@google/genai`, `GEMINI_API_KEY` | image (Nano Banana), video (Veo 3.1) | needs a small in-house stdio wrapper (no first-party media MCP). Image/video are **paid-only** (free tier is text). |
| **Krea** | `krea.ai/settings/api-tokens` | **http** MCP `api.krea.ai/mcp` (bearer or OAuth) | image+video+3D | needs http-MCP support |
| **fal (Seedance)** | `fal.ai/dashboard/keys` | **http** MCP `mcp.fal.ai/mcp`, `FAL_KEY` | Seedance + 1000 models | needs http-MCP support; redundant with muapi |
| **Yapper** | `yapper.so/account/developer` | http MCP `yapper.so/mcp/connector`, **OAuth** | video/image | needs MCP-OAuth support |
| Midjourney | — (no accessible official API in 2026) | via aggregator only | stylized image | use via muapi (V7/V8/Niji) |
| Seedance / Dreamina | — (models, not products) | via aggregator | video / image | use via muapi or fal |

**Recommendation:** **muapi** as the primary generation connector (one key = image+video+audio, already funded) + **ElevenLabs** for premium voice + **Gemini** (Joseph already has billing-enabled keys). Krea adds 3D; fal is redundant with muapi; Yapper is nice but OAuth-gated.

**Principle: prefer direct-to-source over aggregators when the friction is comparable.** muapi/Krea/fal/Yapper are resellers layered on top of the actual model providers — even when an aggregator markets itself as cheaper (muapi claims ~30% under calling providers directly), it's still a middleman with its own margin and its own uptime/pricing risk sitting between the app and the model. Go direct whenever a source provider ships a reasonable API of its own: ElevenLabs and Gemini already are direct. Reach for an aggregator only when there's no practical direct path — Midjourney has none at all; Seedance's only broadly-accessible direct path (BytePlus ModelArk) has meaningfully higher signup friction than muapi, so muapi is the pragmatic choice there specifically, not a default preference for aggregators in general.

**Three transport gaps this surfaced — the Phase 4 connector work:**
1. **http-MCP client** — the connector model + `McpStdioClient` only do stdio today; Krea and fal are remote http MCP servers. Needs an http/SSE MCP client path (the Agent SDK supports http `mcpServers`; the app's own probe/pull path is stdio-only).
2. **MCP OAuth** — Yapper (and Krea's no-key option) authenticate the MCP connection via OAuth, not a stored API key. This is closer to the publishing-account OAuth mechanism than the stdio+env-key path.
3. **Gemini stdio wrapper** — Google ships no trustworthy first-party media-generation MCP; the clean path is a thin bundled `@google/genai` stdio server rather than depending on an unvetted community package.

Until those land, `muapi` and `ElevenLabs` (both stdio + API key) are seeded as built-in templates in the Connections panel (`src/main/connector-templates.ts`); a credential is entered through the native secure modal and stored in `safeStorage`, exactly like ChatRealty.

## Settings (full-screen) — Connectors + Models

Connectors and model selection both live in a full-screen **Settings** surface, opened by the
gear at the bottom of the Sessions rail (it replaced the old "Connections" rail item). Two tabs:

- **Connectors** — the generic MCP connector manager described above (built-in templates: ChatRealty,
  muapi, ElevenLabs; plus add-any custom stdio/http; credential via the secure modal; live test).
- **Models** — which LLM backs the agent (`src/main/model-providers.ts`). The default is **Claude via
  this machine's own Claude Code login** (no config). Any Anthropic-API-compatible endpoint can be
  selected instead: **Kimi K3** ships as a built-in template (`https://api.moonshot.ai/anthropic`,
  model `kimi-k3`), and a fully custom provider (a local/OpenAI model behind an Anthropic-shaping
  proxy — LM Studio 0.4.1+, LiteLLM, claude-code-proxy) can be added with base URL + model + key.
  `agent.ts` injects `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + the model for non-default
  providers; the active provider is persisted in `model-providers.json`, its key in `safeStorage`.
  This is the seam for "different providers for different context" — swap the orchestration model
  without touching anything else.

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
- **Same reporting contract to the agent**: field name, length, last 4 characters. Never the value. This is the one piece that has to carry over exactly. **Refinement made during the build:** last-4 is suppressed (reported as empty, shown as `····`) for secrets shorter than 8 characters — otherwise the "last 4" of a short secret discloses most or all of it, which would defeat the contract's own "never the value" rule. The suppression happens at the single choke point in `credential-vault.ts`, so it covers the agent report, the renderer display, and the plaintext metadata beside the ciphertext at once.
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

**Reuse, don't reinvent.** jpsrealtor — a sibling project — already has a working, in-production account-linking flow for Instagram. Lyme Hype should port that flow rather than build a new one from scratch.

**Resolved from the jpsrealtor review (2026-08-08):**
- **Instagram publishing rides entirely on Meta (Facebook) OAuth** — there is no standalone Instagram login and, importantly, **no YouTube path exists to copy**. YouTube in jpsrealtor is only profile-link text and embeds; a real YouTube publish target would be net-new (Google OAuth + YouTube Data API). So "publish to YouTube" is not a port — descope it or budget it as new work.
- **The flow:** Meta OAuth (Graph API `v21.0`, `META_APP_ID`/`META_APP_SECRET`, redirect `${NEXTAUTH_URL}/api/auth/meta-ads/callback`), scopes include `instagram_basic` + `instagram_content_publish`; code → long-lived (~60-day) user token stored server-side with the page-scoped token. Publish is the three-step Graph carousel dance (`/media` per image → `/media` carousel → `/media_publish`). Key files: `src\app\api\auth\meta-ads\{connect,callback,disconnect}\route.ts`, `src\lib\instagram-publish.ts`, `src\lib\oauth-state.ts`, `src\models\User.ts` (token schema), `src\models\PendingPost.ts` + `src\app\api\cron\publish-pending\route.ts` (the app-side approval/scheduling queue).
- **The no-draft rule is confirmed in jpsrealtor's own code** (`post_instagram_carousel.ts`: "PUBLISHES IMMEDIATELY — no draft step"). Meta has no native scheduling, so any scheduling/approval must be built app-side — jpsrealtor does this via `PendingPost` (`generating → awaiting_review → approved → posted`). Lyme Hype's publish UI must keep the explicit confirm.

**The one rule that has to carry over.** jpsrealtor's own operating rules are blunt about this: publishing to Instagram is immediate at the API level — there's no draft step. That's a lesson already paid for once; it doesn't need repeating. Whatever the ported flow looks like, Lyme Hype's UI needs an explicit, deliberate confirm step before any publish action fires — never publish just because a connected account exists and a button was clickable.

**Still open (jpsrealtor review done):**
- Platform scope: Instagram (via Meta) is the only real port available. YouTube is net-new (see above). TikTok is a natural fit for short-form but hasn't been asked for. Note jpsrealtor publishes **image carousels**, not video — Lyme Hype's reels are video, so even the Instagram port needs the video-publish Graph path (`media_type=REELS`), not a 1:1 copy of the carousel dance.
- Does Publish live on Cut Room only (post-export), or should Play view also be able to publish a single clip directly without an export step in between?

## Open questions

- **Visible vs. background browser automation.** Given the goal is trust as much as convenience, the copilot's browser should probably run visibly (the user watches it navigate) rather than headless — leaning toward visible, not fully decided.
- **Mid-flow interruptions.** What happens when a signup requires 2FA or email verification partway through? Does the copilot pause and wait for the user to complete that step, or hand off entirely at that point? Unresolved.
- **Auth-type detection.** Settings needs to handle none/API-key/bearer/OAuth without the UI caring which one a given connector uses — probably means the connector form asks the user (or the agent infers from what it found while browsing), rather than Lyme Hype trying to auto-detect it from the endpoint alone.
- **Agent tool-selection with multiple similar connections.** Carried over from the node model doc: if two connected tools could both handle a request (e.g. two video-gen connections), does the agent just pick, Claude Desktop/Code-style? Probably yes by default; unconfirmed.
