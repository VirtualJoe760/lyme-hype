/** Image models — cheapest first; local ComfyUI entries lead the picker. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'
import { IMAGE_ASPECTS } from './catalog-types'

export const IMAGE: CatalogModel[] = [
  {
    id: 'comfyui:z-image-turbo',
    cost: 0,
    label: 'z-image turbo (local)',
    connectorId: 'comfyui',
    providerModelId: 'z-image-turbo',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    maxRefs: 1,
    note: '$0 · your GPU · fastest · Apache 2.0',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '21:9'] },
      { id: 'steps', options: ['9', '6', '12'] }
    ]
  },
  {
    id: 'comfyui:krea2-turbo',
    cost: 0,
    label: 'krea 2 turbo (local)',
    connectorId: 'comfyui',
    providerModelId: 'krea2-turbo',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    maxRefs: 1,
    note: '$0 · your GPU · cinematic tier',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '21:9'] },
      { id: 'steps', options: ['8', '12'] }
    ]
  },
  {
    id: 'comfyui:flux1-schnell',
    cost: 0,
    label: 'flux schnell (local)',
    connectorId: 'comfyui',
    providerModelId: 'flux1-schnell',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    maxRefs: 1,
    note: '$0 · your GPU · Apache 2.0',
    params: [
      { id: 'aspect', options: ['9:16', '1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '21:9'] },
      { id: 'steps', options: ['4', '8'] }
    ]
  },
  {
    id: 'gemini:gemini-3.1-flash-image',
    cost: 0.067,
    label: 'nano banana 2',
    connectorId: 'gemini',
    providerModelId: 'gemini-3.1-flash-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit'],
    maxRefs: 10,
    note: 'wrapper default · strong text rendering',
    featured: true,
    params: [
      { id: 'aspect', options: IMAGE_ASPECTS },
      { id: 'size', options: ['1K', '0.5K', '2K', '4K'] },
      { id: 'thinking', options: ['minimal', 'high'] }
    ]
  },
  {
    id: 'gemini:gemini-3-pro-image',
    cost: 0.134,
    label: 'nano banana pro',
    connectorId: 'gemini',
    providerModelId: 'gemini-3-pro-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit'],
    maxRefs: 6,
    note: 'complex composition · 4K',
    params: [
      { id: 'aspect', options: IMAGE_ASPECTS },
      { id: 'size', options: ['1K', '2K', '4K'] }
    ]
  },
  {
    id: 'gemini:gemini-3.1-flash-lite-image',
    cost: 0.034,
    label: 'nano banana lite',
    connectorId: 'gemini',
    providerModelId: 'gemini-3.1-flash-lite-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    maxRefs: 14,
    note: 'cheapest · 1K only · no character refs',
    params: [
      { id: 'aspect', options: IMAGE_ASPECTS },
      { id: 'size', options: ['1K'] }
    ]
  },
  {
    id: 'gemini:gemini-2.5-flash-image',
    cost: 0.039,
    label: 'nano banana 1',
    connectorId: 'gemini',
    providerModelId: 'gemini-2.5-flash-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    note: 'wrapper fallback',
    retiresOn: '2026-10-02',
    params: [
      { id: 'aspect', options: IMAGE_ASPECTS },
      { id: 'size', options: ['1K', '2K', '4K'] }
    ]
  },
  {
    id: 'openai:gpt-image-2',
    cost: 0.09,
    label: 'gpt-image-2',
    connectorId: 'openai',
    providerModelId: 'gpt-image-2',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit', 'image-inpaint'],
    maxRefs: 16,
    note: 'no transparent background',
    featured: true
  },
  {
    id: 'openai:gpt-image-1.5',
    cost: 0.054,
    label: 'gpt-image-1.5',
    connectorId: 'openai',
    providerModelId: 'gpt-image-1.5',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit'],
    maxRefs: 16,
    retiresOn: '2026-12-01'
  },
  {
    id: 'openai:gpt-image-1-mini',
    label: 'gpt-image-1 mini',
    connectorId: 'openai',
    providerModelId: 'gpt-image-1-mini',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    retiresOn: '2026-12-01'
  },
  {
    id: 'muapi:midjourney-v8',
    label: 'midjourney v8',
    connectorId: 'muapi',
    providerModelId: 'midjourney-v8',
    media: 'image',
    capabilities: ['image-gen', 'image-production', 'image-ref-conditioning'],
    note: '4 images per run · batch only',
    featured: true
  },
  {
    id: 'muapi:midjourney-v7',
    label: 'midjourney v7',
    connectorId: 'muapi',
    providerModelId: 'midjourney-v7',
    media: 'image',
    capabilities: ['image-gen', 'image-production', 'image-ref-conditioning'],
    note: '4 images per run'
  },
  {
    id: 'muapi:midjourney-niji',
    label: 'midjourney niji',
    connectorId: 'muapi',
    providerModelId: 'midjourney-niji',
    media: 'image',
    capabilities: ['image-gen', 'image-production'],
    note: 'anime/illustration'
  },
  {
    id: 'muapi:flux-3',
    cost: 0.05,
    label: 'flux 3',
    connectorId: 'muapi',
    providerModelId: 'flux-3',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'muapi:flux-kontext-max',
    cost: 0.06,
    label: 'flux kontext',
    connectorId: 'muapi',
    providerModelId: 'flux-kontext-max',
    media: 'image',
    capabilities: ['image-gen', 'image-edit'],
    note: 'instruction editing'
  },
  {
    id: 'muapi:google-imagen4',
    cost: 0.03,
    label: 'imagen 4',
    connectorId: 'muapi',
    providerModelId: 'google-imagen4',
    media: 'image',
    capabilities: ['image-gen']
  },
  {
    id: 'muapi:seedream-5.0-pro',
    cost: 0.05,
    label: 'seedream 5 pro',
    connectorId: 'muapi',
    providerModelId: 'seedream-5.0-pro',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'muapi:kling-o3-image',
    cost: 0.027,
    label: 'kling o3 image',
    connectorId: 'muapi',
    providerModelId: 'kling-o3-image',
    media: 'image',
    capabilities: ['image-gen', 'image-edit', 'image-ref-conditioning'],
    maxRefs: 10,
    note: 'up to 9 outputs · 4K'
  },
  {
    id: 'krea:krea-2-large',
    cost: 0.06,
    label: 'krea 2 large',
    connectorId: 'krea',
    providerModelId: 'krea/krea-2/large',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'lora-use'],
    maxRefs: 10,
    note: 'takes trained styles',
    featured: true
  },
  {
    id: 'krea:krea-2-medium',
    label: 'krea 2',
    connectorId: 'krea',
    providerModelId: 'krea/krea-2/medium',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'lora-use'],
    maxRefs: 10,
    note: 'takes trained styles'
  },
  {
    id: 'krea:krea-2-medium-turbo',
    label: 'krea 2 turbo',
    connectorId: 'krea',
    providerModelId: 'krea/krea-2/medium-turbo',
    media: 'image',
    capabilities: ['image-gen', 'lora-use'],
    note: 'fastest K2'
  },
  {
    id: 'krea:ideogram-3.0',
    label: 'ideogram 3',
    connectorId: 'krea',
    providerModelId: 'ideogram/3.0',
    media: 'image',
    capabilities: ['image-gen'],
    note: 'text rendering'
  },
  {
    id: 'fal:flux-krea-lora',
    label: 'flux krea lora',
    connectorId: 'fal',
    providerModelId: 'fal-ai/flux-krea-lora',
    media: 'image',
    capabilities: ['image-gen', 'lora-use', 'image-inpaint', 'image-edit'],
    note: 'pairs with flux-krea trainer',
    featured: true
  },
  {
    id: 'fal:flux-2',
    label: 'flux 2',
    connectorId: 'fal',
    providerModelId: 'fal-ai/flux-2',
    media: 'image',
    capabilities: ['image-gen', 'image-edit', 'lora-use']
  },
  {
    id: 'fal:seedream-v5-pro',
    label: 'seedream 5 pro',
    connectorId: 'fal',
    providerModelId: 'bytedance/seedream/v5/pro/text-to-image',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'yapper:nano-banana-pro',
    cost: 0.14,
    label: 'nano banana pro',
    connectorId: 'yapper',
    providerModelId: 'nano-banana-pro',
    media: 'image',
    capabilities: ['image-gen', 'image-edit'],
    note: '4K'
  },
  {
    id: 'yapper:gpt-image-2',
    cost: 0.11,
    label: 'gpt-image-2',
    connectorId: 'yapper',
    providerModelId: 'gpt-image-2',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'yapper:seedream-v5.0-pro',
    label: 'seedream 5 pro',
    connectorId: 'yapper',
    providerModelId: 'seedream-v5.0-pro',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  }
]
