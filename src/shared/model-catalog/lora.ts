/** LoRA / trained-style models. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'

export const LORA: CatalogModel[] = [
  {
    id: 'fal:krea-2-trainer',
    label: 'krea 2 trainer',
    connectorId: 'fal',
    providerModelId: 'fal-ai/krea-2-trainer',
    media: 'lora',
    capabilities: ['lora-train'],
    note: 'per-step billing',
    featured: true
  },
  {
    id: 'fal:flux-krea-trainer',
    label: 'flux krea trainer',
    connectorId: 'fal',
    providerModelId: 'fal-ai/flux-krea-trainer',
    media: 'lora',
    capabilities: ['lora-train'],
    note: 'delisted from search · endpoint live'
  },
  {
    id: 'fal:flux-2-trainer-v2',
    label: 'flux 2 trainer',
    connectorId: 'fal',
    providerModelId: 'fal-ai/flux-2-trainer-v2',
    media: 'lora',
    capabilities: ['lora-train']
  },
  {
    id: 'muapi:flux-lora-trainer',
    label: 'flux lora trainer',
    connectorId: 'muapi',
    providerModelId: 'flux-lora-trainer',
    media: 'lora',
    capabilities: ['lora-train']
  }
]
