/**
 * The pill rows in every creative node read from this file. It is the machine-readable
 * half of `docs/architecture/capability-map.md` — that doc says which *connectors* can do
 * what, this says which *models* can, because a user picks "midjourney", not "muapi".
 *
 * Sourced from `docs/connectors/reference/*.md` on the date below. Curated, not exhaustive:
 * muapi alone lists 591 models and fal ~1,000. What belongs here is anything worth showing
 * in a picker; everything else stays reachable through a connector's own agent routing.
 */

import type { MediaType } from './types'
import { IMAGE } from './model-catalog/image'
import { VIDEO } from './model-catalog/video'
import { AUDIO } from './model-catalog/audio'
import { LIPSYNC } from './model-catalog/lipsync'
import { LORA } from './model-catalog/lora'
import { ENHANCE } from './model-catalog/enhance'
import type { CatalogModel, ModelCapability, ModelMedia } from './model-catalog/catalog-types'

// The vocabulary and the entries are re-exported here so every consumer keeps
// importing '@shared/model-catalog' and nothing else has to change.
export * from './model-catalog/catalog-types'
export { IMAGE, VIDEO, AUDIO, LIPSYNC, LORA, ENHANCE }

/** Chinese-origin model families, for models the catalog doesn't list (muapi's enums
 *  run to ~80 ids). Matched case-insensitively against any model id/alias. */
const ZH_FAMILY_RE =
  /seedance|seedream|seededit|kling|wan[-_.0-9]|qwen|hunyuan|vidu|pixverse|minimax|hailuo|z[-_]image|cogvideo/i

/** Native prompting language for a model id — catalog entry first, family-pattern
 *  fallback for ids the catalog doesn't carry. */
export function promptLanguageFor(modelId: string | undefined): 'zh' | undefined {
  if (!modelId) return undefined
  const catalogued = MODEL_CATALOG.find(
    (m) => m.providerModelId === modelId || m.id === modelId
  )
  if (catalogued?.promptLanguage) return catalogued.promptLanguage
  return ZH_FAMILY_RE.test(modelId) ? 'zh' : undefined
}

/** The parameter rows the panel should render for the picked model — the model's own
 *  surface when it declares one, else the manifest's generic non-perModel rows. */
export function effectiveParameters(
  manifestParameters: { id: string; options?: string[]; perModel?: boolean }[],
  model: CatalogModel | undefined
): { id: string; options: string[] }[] {
  if (model?.params?.length) return model.params.map((p) => ({ id: p.id, options: p.options }))
  return manifestParameters
    .filter((p) => !p.perModel && (p.options?.length ?? 0) > 0)
    .map((p) => ({ id: p.id, options: p.options ?? [] }))
}

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
      // Cheapest → most expensive, local ($0) leading; unpriced models trail the
      // priced ones rather than pretending to a position (Joseph, 2026-08-30).
      const aCost = a.cost ?? Number.POSITIVE_INFINITY
      const bCost = b.cost ?? Number.POSITIVE_INFINITY
      if (aCost !== bCost) return aCost - bCost
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
