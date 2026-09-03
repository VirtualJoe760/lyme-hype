/** ChatRealty (real-estate MLS) request/result shapes. */

export interface ChatRealtyListing {
  listingKey: string
  address: string
  city: string
  listPrice: number | null
  beds: number | null
  baths: number | null
  detailUrl: string | null
}

export interface ChatRealtyPulledImage {
  src: string
  label: string
  listingKey: string
  detailUrl: string | null
  /** 0-based position in the `get_listing_photos` response — the exact index
   *  `stage_listing_with_agent`'s `photoIndexes` param expects, so the staging
   *  picker can reuse these pulled photos instead of guessing indices. */
  photoIndex: number
}

export interface ChatRealtyPullResult {
  ok: boolean
  images: ChatRealtyPulledImage[]
  listings: ChatRealtyListing[]
  error?: string
}

export interface ChatRealtyCoverResult {
  ok: boolean
  /** lyme-asset:// URL of the downloaded cover image, when ok. */
  src?: string
  error?: string
}

/** `plan_listing_carousel`'s material — real facts/CMA stats for a listing,
 *  handed to the Scripting panel as context instead of an agent guessing
 *  numbers. Raw JSON text, not parsed: the agent reads it directly. */
export interface ChatRealtyListingContextResult {
  ok: boolean
  text?: string
  error?: string
}

export interface ChatRealtyCarouselStat {
  label: string
  value: string
}

/** `create_carousel_slide`'s per-kind field shapes. Not tied to a listingKey —
 *  unlike cover/staging, the tool takes literal content the caller already has
 *  (from `plan_listing_carousel`'s material or the user's own copy), not a
 *  server-side lookup. */
export type ChatRealtyCarouselSlideInput =
  | { kind: 'banner'; label: string; caption: string; imageUrl: string }
  | {
      kind: 'cma'
      stats: ChatRealtyCarouselStat[]
      listingPrice: string
      scope: string
      period: string
      pitch: string
    }
  | { kind: 'text'; paragraphs: string[]; italicLast: boolean }
  | { kind: 'cta'; paragraphs: [string, string] }

/** `stage_listing_with_agent`'s result — the one real generation call in the
 *  ChatRealty creative-rendering chain (~$0.04/photo). The picker that builds
 *  the request never fires it on its own; a human presses Generate. */
export interface ChatRealtyStageResult {
  ok: boolean
  images?: { src: string }[]
  error?: string
}

/** `create_article`'s input — a CMS DRAFT, never a publish. `update_article`'s
 *  `status: 'published'` transition is the real publish step and is explicitly
 *  out of Lyme Hype's scope (AGENTS.md rule 6); this tile only ever drafts. */
export interface ChatRealtyArticleDraftInput {
  title: string
  content: string
  category: 'articles' | 'market-insights' | 'real-estate-tips'
  excerpt?: string
  tags?: string[]
}

/** `create_article`'s result — a DRAFT slug on the agent's own CMS, not a
 *  Cloudinary asset, so nothing lands on the canvas as a media node. */
export interface ChatRealtyArticleDraftResult {
  ok: boolean
  slug?: string
  error?: string
}

/** `create_landing_page`'s input — a CMS DRAFT, same publish boundary as
 *  articles (AGENTS.md rule 6). The reference doc documents `title`/`content`
 *  as the only required fields and describes a `landingPage` block covering
 *  hero media, a YouTube embed, a theme override, and lead-form
 *  fields/recipients — only the three simplest of those (`heroType`,
 *  `youtubeUrl`, `themeOverride`) are wired here; the lead-form field/
 *  recipient sub-shape isn't documented at the field level anywhere in the
 *  reference doc, so it's deliberately left out rather than guessed. */
export interface ChatRealtyLandingPageDraftInput {
  title: string
  content: string
  heroType?: 'photo' | 'video'
  youtubeUrl?: string
  themeOverride?: string
}

/** `create_landing_page`'s result — the reference doc says it returns
 *  `editUrl` + `previewUrl` rather than the bare slug `create_article`
 *  returns; nothing lands on the canvas as a media node either way. */
export interface ChatRealtyLandingPageDraftResult {
  ok: boolean
  editUrl?: string
  previewUrl?: string
  error?: string
}
