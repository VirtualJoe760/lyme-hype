---
name: listing-photos
description: Pull real MLS listing photos into Lyme Hype's asset store via the ChatRealty connector (search_listings → get_listing_photos, live hosted API with the real token). Use this whenever the user asks to pull, fetch, or grab listing photos, property photos, real-estate images, or photos for a specific address, listing, or area query — e.g. "grab the photos for the Yucca Valley listing".
---

# Pull listing photos

Call the project's own MCP server: **`mcp__lyme-hype__pull_listing_photos`**.

- `query` — the user's search (an address, area, or listing description).

No generation billing, but it hits the live MLS-backed API with the configured token. The
result carries `listings` (facts) and `photos` (each with an on-disk `path`, label, and
photo index). Send the photos with SendUserFile (display: render) — all of them for a
handful, or the first few plus a count when there are many — and summarize the listing
facts neutrally and factually (no editorializing about pricing or days-on-market).

On `ok: false`, report `error` verbatim — "no ChatRealty token configured" means the token
needs entering in the app (vault or `.env.local`). If the lyme-hype tools aren't available,
the server needs `npm run build` and/or `.mcp.json` approval.
