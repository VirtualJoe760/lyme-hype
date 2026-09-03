import type { LoraUse, SamplerSettings } from './character-styles'

/** API-format ComfyUI graph: node id → { class_type, inputs }. */
export type ComfyGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>

export interface SdxlParams {
  checkpointFile: string
  loras: LoraUse[]
  positive: string
  negative: string
  width: number
  height: number
  seed: number
  sampler: SamplerSettings
  filenamePrefix: string
  /** img2img: an already-uploaded ComfyUI input image name + denoise (1 = ignore it). */
  initImage?: { name: string; denoise: number }
}

/**
 * Core-nodes-only SDXL/SD1.5 graph: checkpoint → [LoRA chain] → clip-skip →
 * text encode ×2 → KSampler → VAE decode → save. Real negatives work here
 * because these models sample at CFG 5–7, unlike the CFG-1 turbo tier.
 * Ported from lyme-hype-lab (live-verified on Pony and Dragon Ball, 2026-09-02).
 */
export function buildSdxlGraph(p: SdxlParams): ComfyGraph {
  const g: ComfyGraph = {}
  g['1'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: p.checkpointFile } }
  let model: [string, number] = ['1', 0]
  let clip: [string, number] = ['1', 1]
  const vae: [string, number] = ['1', 2]

  p.loras.forEach((l, i) => {
    const id = String(10 + i)
    g[id] = {
      class_type: 'LoraLoader',
      inputs: { model, clip, lora_name: l.weight.file, strength_model: l.strengthModel, strength_clip: l.strengthClip }
    }
    model = [id, 0]
    clip = [id, 1]
  })

  if (p.sampler.clipSkip && p.sampler.clipSkip > 1) {
    g['20'] = { class_type: 'CLIPSetLastLayer', inputs: { clip, stop_at_clip_layer: -p.sampler.clipSkip } }
    clip = ['20', 0]
  }
  g['21'] = { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip } }
  g['22'] = { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip } }

  let latent: [string, number]
  if (p.initImage) {
    g['30'] = { class_type: 'LoadImage', inputs: { image: p.initImage.name } }
    g['31'] = {
      class_type: 'ImageScale',
      inputs: { image: ['30', 0], width: p.width, height: p.height, upscale_method: 'lanczos', crop: 'center' }
    }
    g['32'] = { class_type: 'VAEEncode', inputs: { pixels: ['31', 0], vae } }
    latent = ['32', 0]
  } else {
    g['33'] = { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } }
    latent = ['33', 0]
  }

  g['40'] = {
    class_type: 'KSampler',
    inputs: {
      model,
      seed: p.seed,
      steps: p.sampler.steps,
      cfg: p.sampler.cfg,
      sampler_name: p.sampler.sampler,
      scheduler: p.sampler.scheduler,
      denoise: p.initImage ? p.initImage.denoise : 1,
      positive: ['21', 0],
      negative: ['22', 0],
      latent_image: latent
    }
  }
  g['41'] = { class_type: 'VAEDecode', inputs: { samples: ['40', 0], vae } }
  g['42'] = { class_type: 'SaveImage', inputs: { filename_prefix: p.filenamePrefix, images: ['41', 0] } }
  return g
}

export interface QwenEditParams {
  /** Up to three already-uploaded ComfyUI input image names; image 1 is the subject. */
  images: string[]
  prompt: string
  seed: number
  output: { width: number; height: number }
  files: { diffusion: string; textEncoder: string; vae: string; lightning: string }
  filenamePrefix: string
}

/**
 * Qwen-Image-Edit-2511, wired as ComfyUI's own template subgraph
 * (image_qwen_image_edit_2511.json): UNETLoader → lightning LoRA →
 * ModelSamplingAuraFlow(3.1) → CFGNorm → KSampler(euler/simple, 4 steps, cfg 1);
 * TextEncodeQwenImageEditPlus(clip, vae, image1..3) →
 * FluxKontextMultiReferenceLatentMethod for the positive and the empty negative.
 */
export function buildQwenEditGraph(p: QwenEditParams): ComfyGraph {
  if (p.images.length === 0 || p.images.length > 3) throw new Error('Qwen-Edit takes 1 to 3 reference images')
  const g: ComfyGraph = {}
  g['1'] = { class_type: 'UNETLoader', inputs: { unet_name: p.files.diffusion, weight_dtype: 'default' } }
  g['2'] = { class_type: 'CLIPLoader', inputs: { clip_name: p.files.textEncoder, type: 'qwen_image', device: 'default' } }
  g['3'] = { class_type: 'VAELoader', inputs: { vae_name: p.files.vae } }
  g['10'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: p.files.lightning, strength_model: 1 } }
  g['20'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['10', 0], shift: 3.1 } }
  g['21'] = { class_type: 'CFGNorm', inputs: { model: ['20', 0], strength: 1 } }

  const imageRefs: Record<string, [string, number]> = {}
  p.images.forEach((name, i) => {
    const id = String(30 + i)
    g[id] = { class_type: 'LoadImage', inputs: { image: name } }
    imageRefs[`image${i + 1}`] = [id, 0]
  })
  g['40'] = { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: p.prompt, ...imageRefs } }
  g['41'] = { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['40', 0], reference_latents_method: 'index_timestep_zero' } }
  g['42'] = { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['2', 0], vae: ['3', 0], prompt: '', ...imageRefs } }
  g['43'] = { class_type: 'FluxKontextMultiReferenceLatentMethod', inputs: { conditioning: ['42', 0], reference_latents_method: 'index_timestep_zero' } }
  g['50'] = { class_type: 'EmptySD3LatentImage', inputs: { width: p.output.width, height: p.output.height, batch_size: 1 } }
  g['60'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['21', 0], seed: p.seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      positive: ['41', 0], negative: ['43', 0], latent_image: ['50', 0]
    }
  }
  g['61'] = { class_type: 'VAEDecode', inputs: { samples: ['60', 0], vae: ['3', 0] } }
  g['62'] = { class_type: 'SaveImage', inputs: { filename_prefix: p.filenamePrefix, images: ['61', 0] } }
  return g
}
