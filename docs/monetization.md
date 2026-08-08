# Monetization

How Lyme Hype gets paid, and how the three "bring your own" layers fit together.
Decisions here were made 2026-08-08; implementation is in progress.

## The model: BYO flat-fee first, managed tier later

Two coherent tiers, sequenced so we ship revenue fast without becoming a
compute reseller by accident:

1. **Bring-your-own (ship first).** A flat monthly subscription for the *software*
   (target ~$99/mo agency tier; a lower entry tier is open). The user brings
   their own keys — their Anthropic (Claude) key and their generation-connector
   keys (muapi, ElevenLabs, etc.). Near-zero cost of goods for us; we sell the
   workflow, not the tokens. This is the path of least resistance because the
   app is already architected for BYO (the connector model + `safeStorage`
   vault).
2. **Done-for-you (managed, later).** A flat, *capped* plan for non-technical
   users (realtors) who won't create keys: we supply Claude + generation via our
   own keys and bake the cost into the price, sold as "X reels/month included"
   (not metered credits — realtors hate surprise metering). This needs metering,
   hard caps, prepaid float, and Stripe usage/entitlement work — build it once
   BYO validates demand and we have real usage numbers. **Never post-pay; prepaid
   + hard caps only** (a single Veo clip is ~$0.40/sec).

Rejected: putting marked-up credits in the *free* tier — that floats real
compute for non-payers. Free = BYO-only (or a tiny one-time grant).

## Three BYO layers (all consistent)

| Layer | What the user brings | Where it's stored |
|---|---|---|
| **License** | a thinkbigjoe account with an active Lyme Hype subscription | token in `safeStorage`; entitlement checked against thinkbigjoe |
| **Claude** | their own `ANTHROPIC_API_KEY` (see below) | `safeStorage` (`anthropic-claude`), injected into the SDK `env` |
| **Connectors** | their own muapi / ElevenLabs / … keys | `safeStorage`, per connector (already built) |

## Claude auth — API key, not subscription login (ToS)

Anthropic **forbids third-party apps from offering claude.ai subscription login**
via the Agent SDK without prior approval. So Layer 2 is BYO `ANTHROPIC_API_KEY`
(from console.anthropic.com), entered via the native secure modal → vault →
injected as `ANTHROPIC_API_KEY` in `query()` `env`. Built: `src/main/claude-auth.ts`
+ the "Set Claude API key" control in the agent card. The managed tier may
instead supply Claude via our own key (allowed — we're powering our own product).
Subscription login would require Anthropic approval (sales@anthropic.com). Full
note in [platform-decisions.md](platform-decisions.md#open-questions).

## License gate — thinkbigjoe (the identity source)

thinkbigjoe (`F:\web-clients\joseph-sardella\thinkbigjoe`) is Next.js 16 +
**better-auth** + Drizzle/Neon Postgres + Stripe on Vercel — the right identity
home (it already owns client login: email/Google/Facebook). Reviewed 2026-08-08.
Two halves are needed and **both are currently unbuilt** (the pieces exist):

1. **A non-browser credential for the desktop app.** Auth today is browser-cookie
   only. The `bearer`, `jwt`, and `device-authorization` better-auth plugins are
   already installed (`node_modules`) — enabling one in `src/lib/auth.ts` is a
   small additive change. **`device-authorization`** (OAuth device-code) is the
   cleanest desktop UX: app shows a code, user approves in a browser, app gets a
   long-lived token, stores it in `safeStorage`. `bearer` (capture a session
   token from an in-app login window) is the simplest fallback.
2. **A subscription-status read.** Stripe is integrated but subscription state is
   persisted nowhere (the webhook at `src/app/api/stripe/webhook/route.ts` is an
   all-TODO no-op; no price IDs; no checkout). Add `GET /api/lyme/entitlement`
   that authenticates via cookie-or-token and returns
   `{ active, plan, currentPeriodEnd }`. Source of truth, cheapest first:
   (a) **email allowlist** (`LYME_EMAILS`) — clone the existing
   `src/lib/broke-access.ts` pattern, ships today, zero Stripe work;
   (b) **live Stripe check** — `customers.list({email})` → `subscriptions.list`
   filtered to a new `STRIPE_LYME_PRICE_ID`, accurate, no DB;
   (c) **persisted table** fed by the (currently no-op) webhook — the "proper"
   version, defer until scale. The `broke-access.ts` precedent is exactly this
   shape ("allowlist now, memberships table once billing is wired").

**Stripe:** create a Lyme Hype product + price (~$99/mo) + checkout on
thinkbigjoe's account (`STRIPE_LYME_PRICE_ID`). No product/price/checkout exists
yet — only the billing portal.

## Lyme Hype side (this repo)

- **Sign in with thinkbigjoe** — device-code (or bearer) flow → token in the
  vault → call `/api/lyme/entitlement` on launch.
- **Gate** — an Activate screen when not entitled; unlock the studio when entitled
  *and* a Claude key is present.
- Claude key entry + connector keys already use the secure modal → vault.

## Build order

BYO Claude key (done) → thinkbigjoe: enable `device-authorization` + add
`/api/lyme/entitlement` (allowlist launch) → Stripe product/price/checkout (drive
Joseph's browser) → Lyme Hype sign-in + gate → later: webhook-persisted
subscription table, then the managed tier.

> thinkbigjoe is a **production** platform. Its changes (auth plugin, endpoint,
> Stripe product) are made deliberately and confirmed before shipping, not as a
> side effect of Lyme Hype work.
