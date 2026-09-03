/** Voice, music and sound-effect models. Data only — helpers live in model-catalog.ts. */

import type { CatalogModel } from './catalog-types'

export const AUDIO: CatalogModel[] = [
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
