/** Lipsync engines. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'

export const LIPSYNC: CatalogModel[] = [
  {
    id: 'yapper:max',
    label: 'max',
    connectorId: 'yapper',
    providerModelId: 'max',
    media: 'video',
    capabilities: ['lipsync'],
    note: 'trains per video · reuse trainingId',
    featured: true
  },
  {
    id: 'yapper:pro',
    label: 'pro',
    connectorId: 'yapper',
    providerModelId: 'pro',
    media: 'video',
    capabilities: ['lipsync'],
    note: 'single shot'
  },
  {
    id: 'yapper:sync-lipsync-v3',
    label: 'sync v3',
    connectorId: 'yapper',
    providerModelId: 'sync-lipsync-v3',
    media: 'video',
    capabilities: ['lipsync'],
    note: 'stronger alignment'
  },
  {
    id: 'muapi:lipsync-sync',
    label: 'sync',
    connectorId: 'muapi',
    providerModelId: 'sync',
    media: 'video',
    capabilities: ['lipsync'],
    note: 'muapi_edit_lipsync default'
  },
  {
    id: 'muapi:lipsync-kling-v2',
    label: 'kling v2 lipsync',
    connectorId: 'muapi',
    providerModelId: 'kling-v2',
    media: 'video',
    capabilities: ['lipsync']
  },
  {
    id: 'muapi:face-swap',
    label: 'face swap',
    connectorId: 'muapi',
    providerModelId: 'muapi_enhance_face_swap',
    media: 'video',
    capabilities: ['face-swap'],
    note: 'image or video mode',
    featured: true
  }
]
