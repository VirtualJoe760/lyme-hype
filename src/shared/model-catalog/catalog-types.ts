/**
 * The catalog's vocabulary: what a model is, what it can do, and the parameter
 * rows it exposes. Kept apart from the entries so the per-media lists stay pure
 * data.
 */

import type { MediaType } from '../types'

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

/** One chip-row parameter a model exposes. The FIRST option is the default. Known ids map
 *  to GenerationParams fields in NodePanel: aspect→aspectRatio, size→imageSize,
 *  duration→durationSec, resolution→resolution, thinking→thinkingLevel,
 *  person→personGeneration, seed→(per-model, Phase 14). */
export interface ModelParamDef {
  id: 'aspect' | 'size' | 'duration' | 'resolution' | 'thinking' | 'person' | 'seed' | 'steps'
  options: string[]
}

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
  /** Representative $ per generation, from docs/connectors/reference/* — drives the
   *  picker's cheapest→most-expensive ordering (0 = local/free, undefined = unpriced in
   *  our references and sorts after priced models). Comparable within one media row only. */
  cost?: number
  /** The model's native prompting language. Chinese-origin families (ByteDance,
   *  Kuaishou, Alibaba/Tongyi, Tencent…) follow Chinese prompts measurably better —
   *  the generation agent translates the user's prompt into Simplified Chinese for
   *  these models and always reports back in English. */
  promptLanguage?: 'zh'
  /** This model's OWN parameter surface. When present it REPLACES the manifest's generic
   *  parameter rows — the panel shows exactly what this model can actually do (Phase 14's
   *  "seed belongs in the manifest's parameter list where it can appear conditionally",
   *  generalized). Absent = the manifest's generic rows render as before. */
  params?: ModelParamDef[]
}

export const IMAGE_ASPECTS = ['9:16', '1:1', '16:9', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '21:9']
