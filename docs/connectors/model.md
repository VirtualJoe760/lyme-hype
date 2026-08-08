# Connector model

The generic mechanism Lyme Hype uses to connect to any generation or data tool, and — the part that actually matters — how it handles the secrets that requires without an agent ever touching them. Which specific tools are connected and why is [catalog.md](catalog.md); publishing to a social platform is a different mechanism entirely, covered in [publishing.md](publishing.md).

## The connector model is generic, not a predetermined list

A connection is four things: **name**, **endpoint** (a URL, or a local command for a stdio MCP server), **auth type** (none / API key / bearer token / OAuth), and **the credential itself**. Any MCP server fits that shape — nothing about it is specific to any one tool.

Known services are **suggestions**, not hardcoded integrations: a name, a doc link, and the expected auth shape, pre-filled so setup for the common cases is faster (`src/main/connector-suggestions.ts`). The mechanism underneath has to handle a fully custom connector from day one — that's the actual requirement, not a fallback path for power users. A Connectors panel that's just "seven pre-built rows plus a generic Add button" doesn't satisfy this; the generic path *is* the product, and it's exercised: any user-typed stdio command or http URL installs and live-tests the same way a catalog entry does.

## Three transports, all landed

- **stdio** — a local command (`command` + `args` + non-secret `env`), spawned and spoken to over newline-delimited JSON-RPC (`src/main/mcp-client.ts`). The credential (if any) is injected into the child process's env at spawn, keyed by `secretKey`. Example: muapi, ElevenLabs, Gemini.
- **http** (Streamable-HTTP MCP) — a remote URL (`src/main/mcp-http.ts`): POST JSON-RPC, response body may be plain JSON or `text/event-stream`, session carried via `Mcp-Session-Id`. The credential becomes a request header, keyed by `secretKey` as the header *name* (not an env var name, for http). Example: Krea, fal.
- **OAuth** (`src/main/mcp-oauth.ts`) — for http servers that authenticate the connection itself, not a per-request key: RFC 9728 protected-resource discovery → RFC 8414 authorization-server metadata → RFC 7591 dynamic client registration → PKCE authorization code flow in the system browser → one-shot loopback listener on `127.0.0.1` catches the redirect → token exchange. Tokens persist in the vault under the connector's id exactly like a typed key, and refresh silently on use. Example: Yapper.

`testConnector` (`src/main/connectors-store.ts`) probes all three transports the same way — handshake, list tools, report server name/version/tool count — so "Test" in Settings › Connectors behaves identically regardless of which one a connector uses.

## The credential boundary (this is the part that doesn't bend)

The agent navigates and explains. A human types the actual secret, or — with OAuth — approves a real provider consent screen themselves. This isn't about distrusting the model — it's about blast radius: Lyme Hype will be driving to arbitrary third-party sites it has never seen before, some unfamiliar, some possibly spoofed. "The agent never sees or types the password/key" is what keeps one bad signup page from becoming a real credential leak, regardless of which site it turns out to be.

### Native secure-credential component

**Built (2026-08-08):** `src/main/secure-credential.ts` + `src/main/credential-vault.ts` + the `secure.html` modal page.

- **A real modal `BrowserWindow`**, not a localhost HTTP server plus a system browser tab. No listening port, ever — the form lives inside Lyme Hype's own process, and the value returns to the main process over a narrowly-scoped IPC channel the preload script exposes, never over a network socket. The modal window is identified by a per-request id passed via `webPreferences.additionalArguments`, and the submit handler only accepts the value from that specific window's webContents — a stray renderer can't impersonate the modal.
- **Reporting contract to the agent**: field name, length, last 4 characters. Never the value. Last-4 is suppressed (reported as empty, shown as `····`) for secrets shorter than 8 characters — otherwise the "last 4" of a short secret discloses most or all of it. The suppression happens at the single choke point in `credential-vault.ts`, so it covers the agent report, the renderer display, and the plaintext metadata beside the ciphertext at once.
- **Storage in OS-native secure storage** — Electron's `safeStorage` (DPAPI on Windows, Keychain on Mac), keyed per connector. Not a plaintext file, not an env var.
- **Trigger shape**: `requestSecret({ connector, fieldLabel })` — the same component whether the agent's browser-copilot flow just walked the user to an API-keys page, or the user is adding a fully custom connector by hand with no agent involved at all.

### Design rule

Connector setup UI has **no path that collects a secret outside this component.** No plain `<input>` for a key living anywhere in agent-observable state, ever — not as a shortcut, not for a "trusted" template connector. One component, one contract, no exceptions.

### OAuth is the strongest form of the same boundary

Where a service authenticates via OAuth, nobody types anything at all — the human clicks "Allow" on the provider's own real consent screen (`shell.openExternal`, not a webview Lyme Hype controls), and the agent only ever sees connected/not-connected, never a token. `mcp-oauth.ts` is a from-scratch client (no OAuth library dependency), because the flow is small and well-specified enough that a dependency would add more surface than it saves.

## The agent as setup copilot — not an OAuth bypass

First framing, and why it's wrong: having the agent autonomously click through a provider's OAuth consent screen on the user's behalf. Rejected — a consent screen exists specifically so a *human* approves "this app gets access to that data." An agent doing that instead likely violates the provider's ToS and defeats the one moment in the flow that's supposed to require a person.

What's actually wanted is different and reasonable: the agent drives the user *to* the right screen and helps them get set up — signup pages, an API-keys settings page, wherever the MCP endpoint or key actually lives — the same way Claude Code already drives a browser rather than describing where to click. Two things make this concretely buildable:

- **No dependency on Anthropic's "Claude in Chrome" extension.** That's Anthropic's own consumer product, tightly paired with claude.ai/Claude Code sessions — not published as something a third-party app connects to generally.
- **Electron already is Chromium.** Lyme Hype's own Agent SDK session can drive a real browser view directly — via Claude's Computer Use capability, or a library like Playwright — with no external extension needed.

For an unfamiliar service the agent hasn't seen before, this also means it can research how to get an API key or MCP endpoint for that specific platform and walk the user through whatever it finds, rather than only working for services someone pre-documented. **Status: not yet built** — the manual add-a-connector path (typed key, or OAuth "Connect account") works today and is sufficient; the agent-drives-the-browser convenience layer is still open.

## Settings (full-screen) — Connectors + Models

Connectors and model selection both live in a full-screen **Settings** surface, opened by the gear at the bottom of the Sessions rail. Two tabs:

- **Connectors** — the generic MCP connector manager described above (`src/renderer/src/components/settings/ConnectorsTab.tsx`): Installed cards (test / set-or-replace credential / reconnect-account for OAuth / remove), a Suggested tile gallery (open setup page / add), and a Custom connector form (stdio or http, any of the four auth types, oauth only offered for http).
- **Models** — which LLM backs the agent (`src/main/model-providers.ts`), entirely separate from generation connectors. Default is **Claude via this machine's own Claude Code login** (no config). Any Anthropic-API-compatible endpoint can be selected instead: **Kimi K3** ships as a built-in template, and a fully custom provider (a local/OpenAI model behind an Anthropic-shaping proxy — LM Studio, LiteLLM, claude-code-proxy) can be added with base URL + model + key. This is the seam for "different providers for different context" — swap the orchestration model without touching anything else.

## Scope note: OAuth-shaped custom connectors

Not every custom connector will be API-key/bearer-token shaped — a user might add one that's genuinely OAuth-based, and isn't in the suggestions catalog. For those, the custom-connector form offers `oauth` as an auth type (http kind only) and the flow ends in a real OAuth redirect with the human clicking "Allow" on the provider's own screen — the same `mcp-oauth.ts` machinery the catalog's OAuth entries use, not a separate implementation.

## Open questions

- **Visible vs. background browser automation**, once the agent-as-copilot flow is built. Given the goal is trust as much as convenience, the copilot's browser should probably run visibly (the user watches it navigate) rather than headless — leaning toward visible, not fully decided.
- **Mid-flow interruptions.** What happens when a signup requires 2FA or email verification partway through? Does the copilot pause and wait for the user to complete that step, or hand off entirely at that point? Unresolved — moot until the copilot flow itself is built.
- **Auth-type detection.** The custom-connector form asks the user which auth type a connector uses rather than Lyme Hype trying to auto-detect it from the endpoint alone. Works fine today; revisit only if it becomes friction.
