/** Video models — text-to-video and image-to-video across every connector. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'

export const VIDEO: CatalogModel[] = [
  {
    id: 'gemini:veo-3.1',
    label: 'veo 3.1',
    connectorId: 'gemini',
    providerModelId: 'veo-3.1-generate-preview',
    media: 'video',
    capabilities: [
      'video-gen-t2v',
      'video-gen-i2v',
      'video-frame-conditioning',
      'video-extension'
    ],
    cost: 3.2,
    maxRefs: 3,
    note: 'start+end frames · 4/6/8s · $0.40/s',
    constraint: 'an end frame locks the clip to exactly 8s',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '16:9'] },
      { id: 'duration', options: ['8s', '4s', '6s'] },
      { id: 'resolution', options: ['720p', '1080p', '4k'] },
      { id: 'person', options: ['allow_adult', 'allow_all'] }
    ]
  },
  {
    id: 'gemini:veo-3.1-fast',
    label: 'veo 3.1 fast',
    connectorId: 'gemini',
    providerModelId: 'veo-3.1-fast-generate-preview',
    media: 'video',
    capabilities: [
      'video-gen-t2v',
      'video-gen-i2v',
      'video-frame-conditioning',
      'video-extension'
    ],
    cost: 0.8,
    maxRefs: 3,
    note: '~$0.10/s',
    params: [
      { id: 'aspect', options: ['9:16', '16:9'] },
      { id: 'duration', options: ['8s', '4s', '6s'] },
      { id: 'resolution', options: ['720p', '1080p', '4k'] },
      { id: 'person', options: ['allow_adult', 'allow_all'] }
    ]
  },
  {
    id: 'gemini:veo-3.1-lite',
    label: 'veo 3.1 lite',
    connectorId: 'gemini',
    providerModelId: 'veo-3.1-lite-generate-preview',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning'],
    cost: 0.4,
    maxRefs: 3,
    note: 'no extension · no 4K · $0.05/s',
    params: [
      { id: 'aspect', options: ['9:16', '16:9'] },
      { id: 'duration', options: ['8s', '4s', '6s'] },
      { id: 'resolution', options: ['720p', '1080p'] },
      { id: 'person', options: ['allow_adult', 'allow_all'] }
    ]
  },
  // muapi video ids come from the PROBED enum (connector-tools/muapi.json,
  // 2026-08-30) — doc aliases drifted twice (kling-v3.0-pro, openai-sora-2,
  // seedance-2-mini/2.5 never existed in the MCP enum). Costs are per-clip base
  // prices from muapi.md's verified catalog. No frame conditioning on any muapi
  // entry on purpose: the MCP i2v tool takes exactly ONE image_url and no end
  // frame — start+end is REST-only (muapi.md gotchas), so offering it here would
  // be a control that cannot run.
  {
    id: 'muapi:seedance-pro-fast',
    cost: 0.06,
    label: 'seedance fast',
    connectorId: 'muapi',
    providerModelId: 'seedance-pro-fast',
    media: 'video',
    capabilities: ['video-gen-t2v'],
    note: 'cheapest video · t2v only via MCP (i2v mapping broken upstream)',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:seedance-lite',
    cost: 0.1,
    label: 'seedance',
    connectorId: 'muapi',
    providerModelId: 'seedance-lite',
    media: 'video',
    capabilities: ['video-gen-t2v'],
    note: 'vanilla seedance · t2v only via MCP',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:kling-std',
    cost: 0.28,
    label: 'kling std',
    connectorId: 'muapi',
    providerModelId: 'kling-std',
    media: 'video',
    capabilities: ['video-gen-i2v'],
    note: 'the verified i2v workhorse',
    featured: true,
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:seedance-2',
    cost: 0.75,
    label: 'seedance 2',
    connectorId: 'muapi',
    providerModelId: 'seedance-2',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-extension'],
    maxRefs: 9,
    note: 'native audio sync · needs a muapi plan upgrade',
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:kling-master',
    cost: 1.35,
    label: 'kling master',
    connectorId: 'muapi',
    providerModelId: 'kling-master',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'muapi video default',
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:kling-v3-pro',
    cost: 0.72,
    label: 'kling 3 pro',
    connectorId: 'muapi',
    providerModelId: 'kling-v3-pro',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:sora-2',
    cost: 0.8,
    label: 'sora 2',
    connectorId: 'muapi',
    providerModelId: 'sora-2',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'i2v rejects real portraits',
    params: [
      { id: 'aspect', options: ['9:16', '16:9', '1:1'] },
      { id: 'duration', options: ['5s', '8s', '10s'] }
    ]
  },
  {
    id: 'muapi:veo3.1',
    cost: 2.4,
    label: 'veo 3.1',
    connectorId: 'muapi',
    providerModelId: 'veo3.1',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'no frame conditioning here — use gemini'
  },
  {
    id: 'muapi:vidu-q3-flf',
    label: 'vidu q3',
    connectorId: 'muapi',
    providerModelId: 'vidu-q3-flf',
    media: 'video',
    capabilities: ['video-gen-t2v'],
    note: 'FLF model, but muapi MCP can’t pass an end frame — use fal'
  },
  {
    id: 'fal:veo3.1-flf',
    label: 'veo 3.1 flf',
    connectorId: 'fal',
    providerModelId: 'fal-ai/veo3.1/first-last-frame-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: 'dedicated first→last endpoint',
    featured: true
  },
  {
    id: 'fal:veo3.1-lite-flf',
    label: 'veo 3.1 lite flf',
    connectorId: 'fal',
    providerModelId: 'fal-ai/veo3.1/lite/first-last-frame-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: 'same family as Gemini’s Veo, a fraction of the rate'
  },
  {
    id: 'fal:seedance-2.5-i2v',
    label: 'seedance 2.5',
    connectorId: 'fal',
    providerModelId: 'bytedance/seedance-2.5/image-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: '4–30s · native audio · end_image_url',
    featured: true
  },
  {
    id: 'fal:kling-v3-pro-i2v',
    label: 'kling v3 pro',
    connectorId: 'fal',
    providerModelId: 'fal-ai/kling-video/v3/pro/image-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: 'start+end · 3–15s · multi-shot prompts'
  },
  {
    id: 'fal:wan-2.7-i2v',
    label: 'wan 2.7 flf',
    connectorId: 'fal',
    providerModelId: 'fal-ai/wan/v2.7/image-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning', 'video-extension'],
    note: 'end frame + continue-from-clip'
  },
  {
    id: 'fal:flux-3-keyframes',
    label: 'flux 3 keyframes',
    connectorId: 'fal',
    providerModelId: 'blackforestlabs/flux-3/keyframes-to-video',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: 'more than two frames — a keyframe sequence'
  },
  {
    id: 'fal:pixverse-transition',
    label: 'pixverse transition',
    connectorId: 'fal',
    providerModelId: 'fal-ai/pixverse/v6/transition',
    media: 'video',
    capabilities: ['video-gen-i2v', 'video-frame-conditioning'],
    note: 'cheapest first→last route'
  },
  {
    id: 'krea:veo-3.1',
    label: 'veo 3.1',
    connectorId: 'krea',
    providerModelId: 'veo-3.1',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning']
  },
  {
    id: 'krea:seedance-1.0-pro',
    label: 'seedance 1 pro',
    connectorId: 'krea',
    providerModelId: 'seedance-1.0-pro',
    media: 'video',
    capabilities: [
      'video-gen-t2v',
      'video-gen-i2v',
      'video-frame-conditioning',
      'video-extension'
    ],
    maxRefs: 4,
    note: 'start_video continuation'
  },
  {
    id: 'krea:runway-gen-45',
    label: 'runway gen-4.5',
    connectorId: 'krea',
    providerModelId: 'runway-gen-45',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v']
  },
  {
    id: 'fal:kling-o3',
    label: 'kling o3',
    connectorId: 'fal',
    providerModelId: 'fal-ai/kling-video/o3/pro',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v']
  },
  {
    id: 'fal:wan-v2.7',
    label: 'wan 2.7',
    connectorId: 'fal',
    providerModelId: 'fal-ai/wan/v2.7/text-to-video',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v']
  },
  {
    id: 'yapper:seedance-2.5',
    label: 'seedance 2.5',
    connectorId: 'yapper',
    providerModelId: 'seedance-2.5',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning'],
    note: '4–30s · native audio'
  },
  {
    id: 'yapper:kling-3.0-pro',
    label: 'kling 3 pro',
    connectorId: 'yapper',
    providerModelId: 'kling-3.0-pro',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning']
  },
  {
    id: 'yapper:sora-2-pro',
    label: 'sora 2 pro',
    connectorId: 'yapper',
    providerModelId: 'sora-2-pro',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'start frame only'
  },
  {
    id: 'yapper:wan-3.0',
    label: 'wan 3',
    connectorId: 'yapper',
    providerModelId: 'wan-3.0',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning'],
    note: '2–30s'
  }
]
