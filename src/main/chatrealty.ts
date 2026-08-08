import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ChatRealtyListing, ChatRealtyPullResult } from '@shared/types'
import { saveImageAsset } from './asset-store'
import { readSecretValue } from './credential-vault'
import { McpStdioClient, type McpContentBlock } from './mcp-client'

export const CHATREALTY_CONNECTOR_ID = 'chatrealty'
const HOSTED_BASE = 'https://jpsrealtor.com'

/**
 * Local dev fallback for the ChatRealty MCP server binary. In a shipping build
 * this becomes `npx -y @chatrealty/mcp-server`; on this dev machine the built
 * copy in the sibling jpsrealtor project is used when present.
 */
function serverSpec(token: string): { command: string; args: string[]; env: Record<string, string> } {
  const localDist =
    'F:\\web-clients\\joseph-sardella\\jpsrealtor\\packages\\mcp-server\\dist\\index.js'
  const env = { CHATREALTY_API_TOKEN: token, CHATREALTY_API_BASE: HOSTED_BASE }
  if (existsSync(localDist)) return { command: 'node', args: [localDist], env }
  return { command: 'npx', args: ['-y', '@chatrealty/mcp-server'], env }
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
  const token = resolveChatRealtyToken()
  if (!token) {
    return { ok: false, images: [], listings: [], error: 'No ChatRealty token configured.' }
  }

  const client = new McpStdioClient()
  try {
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
