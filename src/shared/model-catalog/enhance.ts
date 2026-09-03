/** Upscale, background-removal and face-swap models. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'

export const ENHANCE: CatalogModel[] = [
  {
    id: 'krea:topaz-standard-enhance',
    label: 'topaz upscale',
    connectorId: 'krea',
    providerModelId: 'enhance/topaz/standard-enhance',
    media: 'image',
    capabilities: ['upscale'],
    note: 'up to 32× · face enhance',
    featured: true
  },
  {
    id: 'krea:krea-enhance',
    label: 'krea enhance',
    connectorId: 'krea',
    providerModelId: 'enhance/krea/enhance',
    media: 'image',
    capabilities: ['upscale'],
    note: 'creative · prompt-guided'
  },
  {
    id: 'krea:topaz-video-upscale',
    label: 'topaz video',
    connectorId: 'krea',
    providerModelId: 'enhance/topaz/video-upscale',
    media: 'video',
    capabilities: ['upscale'],
    note: 'up to 8K · frame interpolation'
  },
  {
    id: 'yapper:topaz-image-upscale',
    label: 'topaz upscale',
    connectorId: 'yapper',
    providerModelId: 'topaz-image-upscale',
    media: 'image',
    capabilities: ['upscale']
  },
  {
    id: 'yapper:topaz-video-upscale',
    label: 'topaz video',
    connectorId: 'yapper',
    providerModelId: 'topaz-video-upscale',
    media: 'video',
    capabilities: ['upscale']
  },
  {
    id: 'muapi:enhance-upscale',
    label: 'muapi upscale',
    connectorId: 'muapi',
    providerModelId: 'muapi_enhance_upscale',
    media: 'image',
    capabilities: ['upscale']
  },
  {
    id: 'muapi:enhance-bg-remove',
    label: 'remove background',
    connectorId: 'muapi',
    providerModelId: 'muapi_enhance_bg_remove',
    media: 'image',
    capabilities: ['bg-remove'],
    featured: true
  },
  {
    id: 'yapper:background-removal',
    label: 'remove background',
    connectorId: 'yapper',
    providerModelId: 'background-removal',
    media: 'image',
    capabilities: ['bg-remove'],
    note: 'catalog-only — not startable in API v1',
    unavailable: true
  }
]
