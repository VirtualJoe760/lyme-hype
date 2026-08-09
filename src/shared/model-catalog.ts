import type { MediaType } from './types'

/**
 * The pill rows in every creative node read from this file. It is the machine-readable
 * half of `docs/architecture/capability-map.md` — that doc says which *connectors* can do
 * what, this says which *models* can, because a user picks "midjourney", not "muapi".
 *
 * Sourced from `docs/connectors/reference/*.md` on the date below. Curated, not exhaustive:
 * muapi alone lists 591 models and fal ~1,000. What belongs here is anything worth showing
 * in a picker; everything else stays reachable through a connector's own agent routing.
 */
export const MODEL_CATALOG_VERIFIED_ON = '2026-08-09'

export type ModelMedia = MediaType | 'lora'

export type ModelCapability =
  | 'image-gen'
  | 'image-production'
  | 'image-ref-conditioning'
  | 'image-edit'
  | 'image-inpaint'
  | 'video-gen-t2v'
  | 'video-gen-i2v'
  | 'video-frame-conditioning'
  | 'video-extension'
  | 'audio-tts'
  | 'audio-music'
  | 'audio-sfx'
  | 'voice-clone'
  | 'lipsync'
  | 'face-swap'
  | 'lora-train'
  | 'lora-use'
  | 'upscale'
  | 'bg-remove'

export interface CatalogModel {
  id: string
  label: string
  connectorId: string
  providerModelId: string
  media: ModelMedia
  capabilities: ModelCapability[]
  /** Max reference/conditioning images the model accepts, where the provider states one. */
  maxRefs?: number
  /** Shown in a picker's secondary line. Keep to a few words. */
  note?: string
  /** Ordering hint — featured models lead their capability's pill row. */
  featured?: boolean
  /** Announced shutdown date, ISO. Present means the model is on the way out. */
  retiresOn?: string
  /** Present in the provider's catalog but not startable through its API. */
  unavailable?: boolean
  /** A hard rule the model imposes once a capability is used — shown in the panel so it
   *  isn't discovered as a 4xx (Veo locks to 8s the moment an end frame is supplied). */
  constraint?: string
}

const IMAGE: CatalogModel[] = [
  {
    id: 'gemini:gemini-3.1-flash-image',
    label: 'nano banana 2',
    connectorId: 'gemini',
    providerModelId: 'gemini-3.1-flash-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit'],
    maxRefs: 10,
    note: 'wrapper default · strong text rendering',
    featured: true
  },
  {
    id: 'gemini:gemini-3-pro-image',
    label: 'nano banana pro',
    connectorId: 'gemini',
    providerModelId: 'gemini-3-pro-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning', 'image-edit'],
    maxRefs: 6,
    note: 'complex composition · 4K'
  },
  {
    id: 'gemini:gemini-3.1-flash-lite-image',
    label: 'nano banana lite',
    connectorId: 'gemini',
    providerModelId: 'gemini-3.1-flash-lite-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    maxRefs: 14,
    note: 'cheapest · 1K only · no character refs'
  },
  {
    id: 'gemini:gemini-2.5-flash-image',
    label: 'nano banana 1',
    connectorId: 'gemini',
    providerModelId: 'gemini-2.5-flash-image',
    media: 'image',
    capabilities: ['image-gen', 'image-ref-conditioning'],
    note: 'wrapper fallback',
    retiresOn: '2026-10-02'
  },
  {
    id: 'openai:gpt-image-2',
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
    label: 'flux 3',
    connectorId: 'muapi',
    providerModelId: 'flux-3',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'muapi:flux-kontext-max',
    label: 'flux kontext',
    connectorId: 'muapi',
    providerModelId: 'flux-kontext-max',
    media: 'image',
    capabilities: ['image-gen', 'image-edit'],
    note: 'instruction editing'
  },
  {
    id: 'muapi:google-imagen4',
    label: 'imagen 4',
    connectorId: 'muapi',
    providerModelId: 'google-imagen4',
    media: 'image',
    capabilities: ['image-gen']
  },
  {
    id: 'muapi:seedream-5.0-pro',
    label: 'seedream 5 pro',
    connectorId: 'muapi',
    providerModelId: 'seedream-5.0-pro',
    media: 'image',
    capabilities: ['image-gen', 'image-edit']
  },
  {
    id: 'muapi:kling-o3-image',
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
    label: 'nano banana pro',
    connectorId: 'yapper',
    providerModelId: 'nano-banana-pro',
    media: 'image',
    capabilities: ['image-gen', 'image-edit'],
    note: '4K'
  },
  {
    id: 'yapper:gpt-image-2',
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

const VIDEO: CatalogModel[] = [
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
    maxRefs: 3,
    note: 'start+end frames · 4/6/8s',
    constraint: 'an end frame locks the clip to exactly 8s',
    featured: true
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
    maxRefs: 3
  },
  {
    id: 'gemini:veo-3.1-lite',
    label: 'veo 3.1 lite',
    connectorId: 'gemini',
    providerModelId: 'veo-3.1-lite-generate-preview',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-frame-conditioning'],
    maxRefs: 3,
    note: 'no extension · no 4K'
  },
  {
    id: 'muapi:seedance-2',
    label: 'seedance 2',
    connectorId: 'muapi',
    providerModelId: 'seedance-2',
    media: 'video',
    // No frame conditioning here on purpose: muapi's MCP `muapi_video_from_image` takes
    // exactly ONE image_url and has no end-frame parameter, even though the model enum
    // lists FLF models. Start+end on muapi is REST-only, so offering it through this
    // connector would be a control that cannot run (muapi.md gotchas).
    capabilities: ['video-gen-t2v', 'video-gen-i2v', 'video-extension'],
    maxRefs: 9,
    note: 'native audio sync · omni reference',
    featured: true
  },
  {
    id: 'muapi:seedance-2-mini',
    label: 'seedance 2 mini',
    connectorId: 'muapi',
    providerModelId: 'seedance-2-mini',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: '720p · cheapest seedance 2'
  },
  {
    id: 'muapi:seedance-2.5',
    label: 'seedance 2.5',
    connectorId: 'muapi',
    providerModelId: 'seedance-2.5',
    media: 'video',
    capabilities: ['video-gen-i2v'],
    note: 'up to 30s · start frame only via MCP'
  },
  {
    id: 'muapi:kling-master',
    label: 'kling master',
    connectorId: 'muapi',
    providerModelId: 'kling-master',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'muapi video default'
  },
  {
    id: 'muapi:kling-v3.0-pro',
    label: 'kling 3 pro',
    connectorId: 'muapi',
    providerModelId: 'kling-v3.0-pro',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v']
  },
  {
    id: 'muapi:openai-sora-2',
    label: 'sora 2',
    connectorId: 'muapi',
    providerModelId: 'openai-sora-2',
    media: 'video',
    capabilities: ['video-gen-t2v', 'video-gen-i2v'],
    note: 'i2v rejects real portraits'
  },
  {
    id: 'muapi:veo3.1',
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

const AUDIO: CatalogModel[] = [
  {
    id: 'elevenlabs:eleven_multilingual_v2',
    label: 'multilingual v2',
    connectorId: 'elevenlabs',
    providerModelId: 'eleven_multilingual_v2',
    media: 'audio',
    capabilities: ['audio-tts'],
    note: 'MCP default · 29 languages',
    featured: true
  },
  {
    id: 'elevenlabs:eleven_v3',
    label: 'eleven v3',
    connectorId: 'elevenlabs',
    providerModelId: 'eleven_v3',
    media: 'audio',
    capabilities: ['audio-tts'],
    note: 'most expressive · 70+ languages'
  },
  {
    id: 'elevenlabs:eleven_flash_v2_5',
    label: 'flash v2.5',
    connectorId: 'elevenlabs',
    providerModelId: 'eleven_flash_v2_5',
    media: 'audio',
    capabilities: ['audio-tts'],
    note: 'low latency · half credit rate'
  },
  {
    id: 'elevenlabs:music_v2',
    label: 'eleven music v2',
    connectorId: 'elevenlabs',
    providerModelId: 'music_v2',
    media: 'audio',
    capabilities: ['audio-music'],
    note: 'MCP default · composition plans',
    featured: true
  },
  {
    id: 'elevenlabs:eleven_text_to_sound_v2',
    label: 'eleven sfx',
    connectorId: 'elevenlabs',
    providerModelId: 'eleven_text_to_sound_v2',
    media: 'audio',
    capabilities: ['audio-sfx'],
    featured: true
  },
  {
    id: 'elevenlabs:voice-clone',
    label: 'instant clone',
    connectorId: 'elevenlabs',
    providerModelId: 'voice_clone',
    media: 'audio',
    capabilities: ['voice-clone'],
    featured: true
  },
  {
    id: 'muapi:suno',
    label: 'suno',
    connectorId: 'muapi',
    providerModelId: 'suno-create-music',
    media: 'audio',
    capabilities: ['audio-music'],
    note: 'full songs with vocals'
  },
  {
    id: 'muapi:suno-voice-clone',
    label: 'suno singing clone',
    connectorId: 'muapi',
    providerModelId: 'suno-voice-clone',
    media: 'audio',
    capabilities: ['voice-clone'],
    note: 'requires liveness check'
  },
  {
    id: 'muapi:mmaudio-v2',
    label: 'mmaudio',
    connectorId: 'muapi',
    providerModelId: 'mmaudio-v2-text-to-audio',
    media: 'audio',
    capabilities: ['audio-sfx'],
    note: 'also audio-from-video'
  },
  {
    id: 'yapper:sonic-3.5',
    label: 'sonic 3.5',
    connectorId: 'yapper',
    providerModelId: 'sonic-3.5',
    media: 'audio',
    capabilities: ['audio-tts', 'voice-clone'],
    note: 'cartesia · free daily tier'
  },
  {
    id: 'yapper:eleven_v3',
    label: 'eleven v3',
    connectorId: 'yapper',
    providerModelId: 'eleven_v3',
    media: 'audio',
    capabilities: ['audio-tts'],
    note: 'preset voices only · free daily tier'
  }
]

const LIPSYNC: CatalogModel[] = [
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

const LORA: CatalogModel[] = [
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

const ENHANCE: CatalogModel[] = [
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

export const MODEL_CATALOG: CatalogModel[] = [
  ...IMAGE,
  ...VIDEO,
  ...AUDIO,
  ...LIPSYNC,
  ...LORA,
  ...ENHANCE
]

export function findModel(id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.id === id)
}

export function modelsWith(capability: ModelCapability): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => !m.unavailable && m.capabilities.includes(capability))
}

export function modelsForMedia(media: ModelMedia): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => !m.unavailable && m.media === media)
}

/**
 * Pill-row ordering: connected first, then featured, then alphabetical. Disconnected
 * models stay in the list on purpose — the row shows what could be reached, and the
 * caller renders the unreachable ones dimmed with a connect affordance.
 */
export function modelPickerOrder(
  capability: ModelCapability,
  readyConnectorIds: readonly string[]
): Array<CatalogModel & { ready: boolean }> {
  const ready = new Set(readyConnectorIds)
  return modelsWith(capability)
    .map((m) => ({ ...m, ready: ready.has(m.connectorId) }))
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1
      if (!!a.retiresOn !== !!b.retiresOn) return a.retiresOn ? 1 : -1
      return a.label.localeCompare(b.label)
    })
}

export function defaultModelFor(
  capability: ModelCapability,
  readyConnectorIds: readonly string[]
): CatalogModel | undefined {
  return modelPickerOrder(capability, readyConnectorIds).find((m) => m.ready && !m.retiresOn)
}

export type ImageTool = 'generate' | 'inpaint' | 'expand' | 'erase' | 'upscale' | 'reframe'

/**
 * Which capability each toolbar tool needs, and therefore which models its pill row may
 * offer. `null` means the tool runs locally through ffmpeg and needs no model at all —
 * reframe is a crop, not a generation.
 *
 * `expand` shares `image-inpaint` deliberately: no connector in the catalog exposes a
 * dedicated outpaint endpoint, so expanding is a masked edit against a larger canvas and
 * is limited to the same models inpainting is.
 */
export const IMAGE_TOOL_CAPABILITY: Record<ImageTool, ModelCapability | null> = {
  generate: 'image-gen',
  inpaint: 'image-inpaint',
  expand: 'image-inpaint',
  erase: 'bg-remove',
  upscale: 'upscale',
  reframe: null
}

export type NodeId = 'image' | 'video' | 'audio' | 'lora' | 'deepfake' | 'motion' | 'timeline'

export interface ArtifactHandoff {
  /** Media sitting in the source node's preview. */
  from: MediaType
  to: NodeId
  /** Reads as a sentence in the UI: "continue in video — as its start frame". */
  label: string
  /** Which input of the target node this artifact fills. */
  role: string
  /** `null` means the target needs no model for this — local ffmpeg or pure state. */
  requires: ModelCapability | null
}

/**
 * What a finished artifact can become next. An image is rarely the end of the thought —
 * it's the start frame of a clip, a face to swap, a training image. Keyed on capability
 * so a handoff is offered only when something can actually run it, same rule as the
 * model pills: never show a route that will fail after the click.
 *
 * Tool switches within one node (image → inpaint) are NOT handoffs — the toolbar covers
 * those. These are the moves that change which node you are in.
 */
export const ARTIFACT_HANDOFFS: ArtifactHandoff[] = [
  { from: 'image', to: 'video', label: 'as its start frame', role: 'startFrame', requires: 'video-frame-conditioning' },
  { from: 'image', to: 'video', label: 'animate it', role: 'sourceImage', requires: 'video-gen-i2v' },
  { from: 'image', to: 'lora', label: 'as a training image', role: 'trainingImage', requires: 'lora-train' },
  { from: 'image', to: 'deepfake', label: 'as the face', role: 'faceSource', requires: 'face-swap' },
  { from: 'image', to: 'motion', label: 'as a reference', role: 'referenceImage', requires: 'image-ref-conditioning' },
  { from: 'image', to: 'image', label: 'as a reference', role: 'referenceImage', requires: 'image-ref-conditioning' },

  { from: 'video', to: 'video', label: 'extend it', role: 'sourceVideo', requires: 'video-extension' },
  { from: 'video', to: 'deepfake', label: 'as the source performance', role: 'sourceVideo', requires: 'lipsync' },
  { from: 'video', to: 'audio', label: 'isolate its audio', role: 'sourceMedia', requires: null },
  { from: 'video', to: 'timeline', label: 'add to the timeline', role: 'clip', requires: null },

  { from: 'audio', to: 'deepfake', label: 'as the voice track', role: 'audioTrack', requires: 'lipsync' },
  { from: 'audio', to: 'timeline', label: 'add to the timeline', role: 'clip', requires: null }
]

/**
 * Handoffs available for what's currently in the preview. Unreachable ones are returned
 * too, flagged — the panel dims them rather than hiding them, so the next step is
 * discoverable before the connector that enables it exists.
 */
export function handoffsFor(
  media: MediaType,
  readyConnectorIds: readonly string[]
): Array<ArtifactHandoff & { ready: boolean }> {
  return ARTIFACT_HANDOFFS.filter((h) => h.from === media).map((h) => ({
    ...h,
    ready: h.requires === null || modelsWith(h.requires).some((m) => readyConnectorIds.includes(m.connectorId))
  }))
}

export type ModelSwitchReason = 'unsupported' | 'disconnected' | 'none-available'

export interface ModelReconcile {
  model: CatalogModel | null
  /** False when the caller must re-render the picker and tell the user why it moved. */
  kept: boolean
  reason?: ModelSwitchReason
  from?: CatalogModel
}

/**
 * Switching tools re-frames the model row: the model that generated an image often cannot
 * edit it (Midjourney can't inpaint at all). Callers pass the current selection and the
 * tool's capability; anything that can't run gets replaced with the best available model
 * and a reason, so the panel can say what moved instead of silently rerouting.
 */
export function reconcileModel(
  currentModelId: string | null,
  capability: ModelCapability | null,
  readyConnectorIds: readonly string[]
): ModelReconcile {
  if (capability === null) return { model: null, kept: true }

  const current = currentModelId ? findModel(currentModelId) : undefined
  const ready = new Set(readyConnectorIds)

  if (current && current.capabilities.includes(capability) && ready.has(current.connectorId)) {
    return { model: current, kept: true }
  }

  const replacement = defaultModelFor(capability, readyConnectorIds) ?? null
  if (!current) {
    return { model: replacement, kept: !!replacement, reason: replacement ? undefined : 'none-available' }
  }

  const reason: ModelSwitchReason = !current.capabilities.includes(capability)
    ? 'unsupported'
    : 'disconnected'

  return {
    model: replacement,
    kept: false,
    reason: replacement ? reason : 'none-available',
    from: current
  }
}
