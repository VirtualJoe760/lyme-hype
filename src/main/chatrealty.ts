import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  ChatRealtyCarouselSlideInput,
  ChatRealtyCoverResult,
  ChatRealtyListing,
  ChatRealtyListingContextResult,
  ChatRealtyPullResult,
  ConnectorDef
} from '@shared/types'
import { importUrlAsset, saveImageAsset } from './asset-store'
import { readSecretValue } from './credential-vault'
import { McpStdioClient, type McpContentBlock } from './mcp-client'

export const CHATREALTY_CONNECTOR_ID = 'chatrealty'
const HOSTED_BASE = 'https://jpsrealtor.com'
const LOCAL_DIST =
  'F:\\web-clients\\joseph-sardella\\jpsrealtor\\packages\\mcp-server\\dist\\index.js'

/**
 * The built-in ChatRealty connector template — the single source of truth for
 * how the server is launched, shared by the pull path and the Connections panel.
 * Local dev uses the built copy in the sibling jpsrealtor project when present;
 * a shipping build falls back to `npx -y @chatrealty/mcp-server`.
 */
export function chatRealtyConnectorDef(): ConnectorDef {
  const launch = existsSync(LOCAL_DIST)
    ? { command: 'node', args: [LOCAL_DIST] }
    : { command: 'npx', args: ['-y', '@chatrealty/mcp-server'] }
  return {
    id: CHATREALTY_CONNECTOR_ID,
    name: 'ChatRealty',
    kind: 'stdio',
    command: launch.command,
    args: launch.args,
    env: { CHATREALTY_API_BASE: HOSTED_BASE },
    authType: 'bearer',
    secretKey: 'CHATREALTY_API_TOKEN',
    secretFieldLabel: 'ChatRealty API token (crt_live_…)',
    builtin: true,
    docUrl: 'https://jpsrealtor.com/agent/settings'
  }
}

function serverSpec(token: string): { command: string; args: string[]; env: Record<string, string> } {
  const def = chatRealtyConnectorDef()
  return {
    command: def.command!,
    args: def.args ?? [],
    env: { ...(def.env ?? {}), CHATREALTY_API_TOKEN: token }
  }
}

/**
 * Resolves the ChatRealty token: the safeStorage vault first (the real path,
 * entered via the native modal), then a dev-only .env.local fallback. Returns
 * the value only inside the main process — it is never sent to the renderer.
 */
export function resolveChatRealtyToken(): string | null {
  const fromVault = readSecretValue(CHATREALTY_CONNECTOR_ID)
  if (fromVault) return fromVault

  const envLocal = join(app.getAppPath(), '.env.local')
  if (existsSync(envLocal)) {
    const match = readFileSync(envLocal, 'utf-8').match(/^CHATREALTY_API_TOKEN=(.*)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

export function hasChatRealtyToken(): boolean {
  return resolveChatRealtyToken() !== null
}

function textOf(content: McpContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

function parseListings(content: McpContentBlock[]): ChatRealtyListing[] {
  const text = textOf(content)
  try {
    const parsed = JSON.parse(text) as { items?: unknown[] }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    return items.map((raw) => {
      const it = raw as Record<string, unknown>
      return {
        listingKey: String(it.listingKey ?? ''),
        address: typeof it.address === 'string' ? it.address : 'Listing',
        city: typeof it.city === 'string' ? it.city : '',
        listPrice: typeof it.listPrice === 'number' ? it.listPrice : null,
        beds: typeof it.beds === 'number' ? it.beds : null,
        baths: typeof it.baths === 'number' ? it.baths : null,
        detailUrl: typeof it.detailUrl === 'string' ? it.detailUrl : null
      }
    })
  } catch {
    return []
  }
}

function imagesToAssets(
  content: McpContentBlock[],
  labelBase: string,
  listingKey: string,
  detailUrl: string | null
): ChatRealtyPullResult['images'] {
  const out: ChatRealtyPullResult['images'] = []
  let n = 0
  for (const block of content) {
    if (block.type !== 'image' || typeof block.data !== 'string') continue
    n += 1
    const saved = saveImageAsset(block.data, block.mimeType ?? 'image/jpeg')
    out.push({
      src: saved.url,
      label: `${labelBase} · ${String(n).padStart(2, '0')}`,
      listingKey,
      detailUrl
    })
  }
  return out
}

/**
 * The Phase 3 headline feature: from a text query, pull a listing's real photos
 * and hand them back as saved image assets the renderer drops on the canvas as
 * Image nodes. Deterministic MCP tool calls (search → photos), not an agent turn.
 */
export async function pullListingPhotos(query: string): Promise<ChatRealtyPullResult> {
  const client = new McpStdioClient()
  try {
    const token = resolveChatRealtyToken()
    if (!token) {
      return { ok: false, images: [], listings: [], error: 'No ChatRealty token configured.' }
    }
    await client.start(serverSpec(token))

    // Interpret the free-text box loosely: a bare number is a max price, a plain
    // word is treated as a city. Anything richer is a Phase 4 (agent-assisted)
    // enhancement — this keeps the first cut deterministic.
    const q = query.trim()
    const args: Record<string, unknown> = { limit: 8, embedPhotos: 0 }
    if (/^\$?\d[\d,]*$/.test(q)) args.maxPrice = Number(q.replace(/[$,]/g, ''))
    else if (q) args.city = q

    const search = await client.callTool('search_listings', args)
    if (search.isError) {
      return { ok: false, images: [], listings: [], error: textOf(search.content).slice(0, 300) }
    }
    const listings = parseListings(search.content)
    if (listings.length === 0 || !listings[0].listingKey) {
      return { ok: true, images: [], listings, error: 'No listings matched that search.' }
    }

    const top = listings[0]
    const photos = await client.callTool('get_listing_photos', {
      listingKey: top.listingKey,
      embed: 6
    })
    if (photos.isError) {
      return { ok: false, images: [], listings, error: textOf(photos.content).slice(0, 300) }
    }

    const images = imagesToAssets(photos.content, top.address, top.listingKey, top.detailUrl)
    return { ok: true, images, listings }
  } catch (err) {
    return {
      ok: false,
      images: [],
      listings: [],
      error: err instanceof Error ? err.message : String(err)
    }
  } finally {
    client.stop()
  }
}

const CLOUDINARY_URL = /https:\/\/\S+/

/**
 * The first of ChatRealty's paid-for creative-render tools Lyme Hype actually
 * calls: `create_listing_cover` templates a branded 4:5 Instagram cover
 * (hook/price/address/specs/body/agent headshot) server-side and hands back a
 * Cloudinary URL, not base64 — a second ingestion path from the same
 * base64-only pull above, downloaded through `importUrlAsset` the same way
 * every other connector's URL-returning tool already lands on the canvas.
 * Deterministic single tool call, same shape as `pullListingPhotos` — no
 * agent turn, and still only fires when the user presses the button.
 */
export async function createListingCover(
  listingKey: string,
  opts: { hook: string; body: string; city?: string; accentColor?: string; photoIndex?: number }
): Promise<ChatRealtyCoverResult> {
  const client = new McpStdioClient()
  try {
    const token = resolveChatRealtyToken()
    if (!token) return { ok: false, error: 'No ChatRealty token configured.' }
    await client.start(serverSpec(token))

    const args: Record<string, unknown> = { listingKey, hook: opts.hook, body: opts.body }
    if (opts.city) args.city = opts.city
    if (opts.accentColor) args.accentColor = opts.accentColor
    if (typeof opts.photoIndex === 'number') args.photoIndex = opts.photoIndex

    const result = await client.callTool('create_listing_cover', args)
    if (result.isError) {
      return { ok: false, error: textOf(result.content).slice(0, 300) }
    }
    const match = textOf(result.content).match(CLOUDINARY_URL)
    if (!match) return { ok: false, error: 'No cover URL came back.' }

    const saved = await importUrlAsset(match[0], 'image')
    return { ok: true, src: saved.url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.stop()
  }
}

const LISTING_CONTEXT_MAX_CHARS = 6_000

/**
 * `plan_listing_carousel`'s material — listing facts, photo indices, and
 * pre-formatted subdivision CMA stats — handed to the Scripting panel as
 * real numbers instead of an agent inventing them. Same deterministic,
 * no-agent-turn shape as `pullListingPhotos`/`createListingCover`; the
 * caller decides when this is worth fetching (once per conversation, per a
 * listing-sourced node being in play — never on every turn).
 */
export async function planListingCarousel(listingKey: string): Promise<ChatRealtyListingContextResult> {
  const client = new McpStdioClient()
  try {
    const token = resolveChatRealtyToken()
    if (!token) return { ok: false, error: 'No ChatRealty token configured.' }
    await client.start(serverSpec(token))

    const result = await client.callTool('plan_listing_carousel', { listingKey })
    if (result.isError) {
      return { ok: false, error: textOf(result.content).slice(0, 300) }
    }
    const text = textOf(result.content).slice(0, LISTING_CONTEXT_MAX_CHARS)
    if (!text.trim()) return { ok: false, error: 'No carousel material came back.' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.stop()
  }
}

/**
 * Build order item 3: `create_carousel_slide` renders one non-cover 4:5 slide
 * — banner/cma/text/cta, each with its own required-field shape per the
 * reference doc. Unlike `create_listing_cover`/`stage_listing_with_agent`,
 * this tool takes no `listingKey` — every kind's content is literal fields
 * the caller already has (from `plan_listing_carousel`'s material, or the
 * user's own copy), not a server-side lookup. Same Cloudinary-URL-then-
 * `importUrlAsset` ingestion as the cover, same deterministic single call.
 */
export async function createCarouselSlide(
  input: ChatRealtyCarouselSlideInput
): Promise<ChatRealtyCoverResult> {
  const client = new McpStdioClient()
  try {
    const token = resolveChatRealtyToken()
    if (!token) return { ok: false, error: 'No ChatRealty token configured.' }
    await client.start(serverSpec(token))

    const args: Record<string, unknown> = { kind: input.kind }
    if (input.kind === 'banner') {
      args.label = input.label
      args.caption = input.caption
      args.imageUrl = input.imageUrl
    } else if (input.kind === 'cma') {
      args.stats = input.stats
      args.listingPrice = input.listingPrice
      args.scope = input.scope
      args.period = input.period
      args.pitch = input.pitch
    } else {
      args.paragraphs = input.paragraphs
      if (input.kind === 'text') args.italicLast = input.italicLast
    }

    const result = await client.callTool('create_carousel_slide', args)
    if (result.isError) {
      return { ok: false, error: textOf(result.content).slice(0, 300) }
    }
    const match = textOf(result.content).match(CLOUDINARY_URL)
    if (!match) return { ok: false, error: 'No slide URL came back.' }

    const saved = await importUrlAsset(match[0], 'image')
    return { ok: true, src: saved.url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.stop()
  }
}
