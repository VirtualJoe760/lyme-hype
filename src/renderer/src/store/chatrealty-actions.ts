/** ChatRealty pulls and the listing-content drafts built on them.
 *
 * A slice of the studio store: the same actions as before, lifted out of the
 * create() body so no single file carries the whole surface. */

import { bridge } from '../bridge'
import type { StoreCtx } from './context'
import { type StudioStore } from './types'

export function createChatRealtyActions(ctx: StoreCtx): Pick<StudioStore, 'pullChatRealtyPhotos' | 'createChatRealtyCover' | 'createChatRealtyCarouselSlide' | 'stageChatRealtyListing' | 'createChatRealtyArticleDraft' | 'createChatRealtyLandingPageDraft'> {
  const {
    get,
  } = ctx

  return {
  async pullChatRealtyPhotos(query) {
    const result = await bridge.chatRealty.pull(query)
    if (!result || !result.ok) {
      return { ok: false, count: 0, error: result?.error ?? 'ChatRealty is unavailable.', photos: [] }
    }
    const cols = 3
    const gap = 128
    const originX = 60
    const originY = 70
    result.images.forEach((img, i) => {
      get().addNode({
        label: img.label,
        mediaType: 'image',
        source: 'generate',
        src: img.src,
        detailUrl: img.detailUrl ?? undefined,
        listingKey: img.listingKey,
        position: { x: originX + (i % cols) * gap, y: originY + Math.floor(i / cols) * gap },
        startRendering: false
      })
    })
    const top = result.listings[0]
    return {
      ok: true,
      count: result.images.length,
      error: result.images.length === 0 ? (result.error ?? 'No photos found.') : undefined,
      topListing: top
        ? { listingKey: top.listingKey, address: top.address, city: top.city, detailUrl: top.detailUrl }
        : undefined,
      photos: result.images.map((img) => ({
        src: img.src,
        label: img.label,
        photoIndex: img.photoIndex
      }))
    }
  },

  async createChatRealtyCover(listingKey, opts) {
    const result = await bridge.chatRealty.createCover(listingKey, {
      hook: opts.hook,
      body: opts.body,
      city: opts.city
    })
    if (!result || !result.ok || !result.src) {
      return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
    }
    get().addNode({
      label: opts.label,
      mediaType: 'image',
      source: 'generate',
      src: result.src,
      detailUrl: opts.detailUrl,
      listingKey,
      startRendering: false
    })
    return { ok: true }
  },

  async createChatRealtyCarouselSlide(input, opts) {
    const result = await bridge.chatRealty.createCarouselSlide(input)
    if (!result || !result.ok || !result.src) {
      return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
    }
    get().addNode({
      label: opts.label,
      mediaType: 'image',
      source: 'generate',
      src: result.src,
      detailUrl: opts.detailUrl,
      listingKey: opts.listingKey,
      startRendering: false
    })
    return { ok: true }
  },

  async stageChatRealtyListing(listingKey, photoIndexes, opts) {
    const result = await bridge.chatRealty.stageListing(listingKey, photoIndexes)
    if (!result || !result.ok || !result.images || result.images.length === 0) {
      return { ok: false, count: 0, error: result?.error ?? 'ChatRealty is unavailable.' }
    }
    const cols = 3
    const gap = 128
    const originX = 60
    const originY = 260
    result.images.forEach((img, i) => {
      get().addNode({
        label: `${opts.labelBase} · Staged ${String(i + 1).padStart(2, '0')}`,
        mediaType: 'image',
        source: 'generate',
        src: img.src,
        detailUrl: opts.detailUrl,
        listingKey,
        position: { x: originX + (i % cols) * gap, y: originY + Math.floor(i / cols) * gap },
        startRendering: false
      })
    })
    return { ok: true, count: result.images.length }
  },

  async createChatRealtyArticleDraft(input) {
    const result = await bridge.chatRealty.createArticleDraft(input)
    if (!result || !result.ok) {
      return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
    }
    return { ok: true, slug: result.slug }
  },

  async createChatRealtyLandingPageDraft(input) {
    const result = await bridge.chatRealty.createLandingPageDraft(input)
    if (!result || !result.ok) {
      return { ok: false, error: result?.error ?? 'ChatRealty is unavailable.' }
    }
    return { ok: true, editUrl: result.editUrl, previewUrl: result.previewUrl }
  },
  }
}
