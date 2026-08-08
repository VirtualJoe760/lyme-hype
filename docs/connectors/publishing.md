# Publishing accounts (Instagram, YouTube, etc.)

A different mechanism from everything in [model.md](model.md) and [catalog.md](catalog.md), even though it's "another external connection" in the loose sense.

## Not another MCP connector

- **MCP connections** (ChatRealty, muapi, ElevenLabs, Krea, fal, Gemini, Yapper, custom) are generation/data tools the *agent* calls mid-session — API key, bearer-token, or OAuth auth, the generic connector shape in `model.md`.
- **Publishing accounts** are OAuth social-media logins — Instagram via Meta's Graph API, YouTube via Google's Data API. The user authenticates directly with Meta or Google; Lyme Hype gets an OAuth token back and never sees a password. Same shape as "Connect your Instagram" in any social scheduling tool — nothing generic or pluggable about it, it's platform-specific by nature.

## Reuse, don't reinvent

jpsrealtor — a sibling project — already has a working, in-production account-linking flow for Instagram. Lyme Hype should port that flow rather than build a new one from scratch.

**Resolved from the jpsrealtor review (2026-08-08):**

- **Instagram publishing rides entirely on Meta (Facebook) OAuth** — there is no standalone Instagram login and, importantly, **no YouTube path exists to copy**. YouTube in jpsrealtor is only profile-link text and embeds; a real YouTube publish target would be net-new (Google OAuth + YouTube Data API). So "publish to YouTube" is not a port — descope it or budget it as new work.
- **The flow:** Meta OAuth (Graph API `v21.0`, `META_APP_ID`/`META_APP_SECRET`, redirect `${NEXTAUTH_URL}/api/auth/meta-ads/callback`), scopes include `instagram_basic` + `instagram_content_publish`; code → long-lived (~60-day) user token stored server-side with the page-scoped token. Publish is the three-step Graph carousel dance (`/media` per image → `/media` carousel → `/media_publish`). Key files in jpsrealtor: `src\app\api\auth\meta-ads\{connect,callback,disconnect}\route.ts`, `src\lib\instagram-publish.ts`, `src\lib\oauth-state.ts`, `src\models\User.ts` (token schema), `src\models\PendingPost.ts` + `src\app\api\cron\publish-pending\route.ts` (the app-side approval/scheduling queue).
- **The no-draft rule is confirmed in jpsrealtor's own code** (`post_instagram_carousel.ts`: "PUBLISHES IMMEDIATELY — no draft step"). Meta has no native scheduling, so any scheduling/approval must be built app-side — jpsrealtor does this via `PendingPost` (`generating → awaiting_review → approved → posted`). Lyme Hype's publish UI must keep the explicit confirm.

## The one rule that has to carry over

Publishing to Instagram is immediate at the API level — there's no draft step. That's a lesson already paid for once on jpsrealtor; it doesn't need repeating. Whatever the ported flow looks like, Lyme Hype's UI needs an explicit, deliberate confirm step before any publish action fires — never publish just because a connected account exists and a button was clickable. This is `AGENTS.md` §6, and it doesn't bend.

## Still open (jpsrealtor review done, port not started)

- **Platform scope:** Instagram (via Meta) is the only real port available. YouTube is net-new (see above). TikTok is a natural fit for short-form but hasn't been asked for. Note jpsrealtor publishes **image carousels**, not video — Lyme Hype's reels are video, so even the Instagram port needs the video-publish Graph path (`media_type=REELS`), not a 1:1 copy of the carousel dance.
- **Where publish lives:** Cut Room / the timeline only (post-export), or should Play view also be able to publish a single clip directly without an export step in between?
- **Status:** deliberately not built — this is an outward-facing, irreversible action requiring a registered Meta OAuth app and a fresh review against the real jpsrealtor project directory (not from memory). Tracked as a joint-session item, not autonomous work. See `build-plan.md`.
