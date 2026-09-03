import { existsSync } from 'node:fs'
import { assetPathForUrl } from '../asset-store'
import { hasChatRealtyToken, pullListingPhotos } from '../chatrealty'
import { TestRun, envVar } from './test-harness'

/**
 * The ChatRealty pull path — a live query against the hosted server with the
 * real token (search_listings → get_listing_photos → asset store). No
 * generation billing, but it does hit the live MLS-backed API.
 *
 * Env knobs:
 *   LYME_TEST_LISTING_QUERY — override the default search query
 */
export async function run(t: TestRun): Promise<void> {
  if (!hasChatRealtyToken()) {
    t.skip('listing photos', 'no ChatRealty token configured (vault or .env.local)')
    return
  }
  const query = envVar('LYME_TEST_LISTING_QUERY') ?? 'homes in Yucca Valley'
  t.log(`LIVE CALL — pulling listing photos for "${query}"`)
  const result = await pullListingPhotos(query)
  if (!result.ok) {
    t.fail('listing photos', result.error ?? 'pull failed')
    return
  }
  if (result.images.length === 0) {
    t.fail('listing photos', 'pull succeeded but returned zero images')
    return
  }
  const firstPath = assetPathForUrl(result.images[0].src)
  if (firstPath && existsSync(firstPath)) {
    t.pass('listing photos', `${result.images.length} photo(s) across ${result.listings.length} listing(s)`)
    for (const image of result.images) t.output(image.src)
  } else {
    t.fail('listing photos', `images reported but first asset not on disk: ${result.images[0].src}`)
  }
}
