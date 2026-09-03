/** Option lists and empty-form shapes for the ChatRealty panel — data, so the
 *  component keeps only behaviour. */

import type {
  ChatRealtyArticleDraftInput,
  ChatRealtyCarouselSlideInput,
  ChatRealtyLandingPageDraftInput
} from '@shared/types'

// Derived from the request shapes rather than restated, so a change upstream is
// a type error here instead of a silently stale option list.
export type ArticleCategory = ChatRealtyArticleDraftInput['category']
export type LandingHeroType = NonNullable<ChatRealtyLandingPageDraftInput['heroType']>
export type SlideKind = ChatRealtyCarouselSlideInput['kind']

export const ARTICLE_CATEGORIES: { id: ArticleCategory; label: string }[] = [
  { id: 'market-insights', label: 'Market insights' },
  { id: 'articles', label: 'Articles' },
  { id: 'real-estate-tips', label: 'Real estate tips' }
]

export const LANDING_HERO_TYPES: { id: LandingHeroType; label: string }[] = [
  { id: 'photo', label: 'Hero: photo' },
  { id: 'video', label: 'Hero: video' }
]

export interface TopListing {
  listingKey: string
  address: string
  city: string
  detailUrl: string | null
}

export const SLIDE_KINDS: { id: SlideKind; label: string }[] = [
  { id: 'cma', label: 'CMA stats' },
  { id: 'text', label: 'Text' },
  { id: 'cta', label: 'Call to action' },
  { id: 'banner', label: 'Banner (staged photo)' }
]

export function emptyCarouselForm(): {
  statLabels: string[]
  statValues: string[]
  listingPrice: string
  scope: string
  period: string
  pitch: string
  paragraph1: string
  paragraph2: string
  paragraph3: string
  italicLast: boolean
  bannerLabel: string
  bannerCaption: string
  bannerImageUrl: string
} {
  return {
    statLabels: ['', '', '', ''],
    statValues: ['', '', '', ''],
    listingPrice: '',
    scope: '',
    period: '',
    pitch: '',
    paragraph1: '',
    paragraph2: '',
    paragraph3: '',
    italicLast: false,
    bannerLabel: '',
    bannerCaption: '',
    bannerImageUrl: ''
  }
}

export interface PulledPhoto {
  src: string
  label: string
  photoIndex: number
}

