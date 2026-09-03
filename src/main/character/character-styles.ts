import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CharacterSpec, CharacterStyleView } from '@shared/types'
import { comfyConfig } from '../comfyui-host'

/**
 * The cartoon style registry, ported from lyme-hype-lab/src/styles on
 * 2026-09-03 once `cast` had been live-verified there.
 *
 * Researched on Civitai 2026-09-02: the style-LoRA ecosystem for named
 * cartoons lives almost entirely on the SDXL family (Illustrious / Pony);
 * Flux, Z-Image and Krea2 have a handful each. So the character tier is
 * SDXL-based even though the app's $0 image tier runs flux/z-image/krea2 —
 * and, unlike that tier, it samples at CFG 5–7 where real negative prompts
 * work. Weights are checked on disk, never downloaded here: the lab's
 * `ensure` (Civitai key) is where downloads happen.
 */

export type BaseFamily = 'illustrious' | 'pony' | 'sdxl' | 'sd15'
export type ModelFolder = 'checkpoints' | 'loras' | 'diffusion_models' | 'text_encoders' | 'vae'

export interface WeightRef {
  file: string
  folder: ModelFolder
  sizeMB: number
  /** Civitai creator flag: may generated IMAGES be used commercially? Informational until channels exist. */
  commercialImages?: boolean
}

export interface LoraUse {
  weight: WeightRef
  strengthModel: number
  strengthClip: number
  /** Tags the LoRA was trained to answer to — always prepended to the prompt. */
  triggers: string[]
}

export interface SamplerSettings {
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  clipSkip?: number
}

export interface CartoonStyle {
  id: string
  label: string
  family: BaseFamily
  region: 'american' | 'anime' | '3d' | 'generic'
  referenceShows: string[]
  checkpoint: WeightRef
  loras: LoraUse[]
  promptPrefix: string[]
  promptSuffix: string[]
  negative: string[]
  sampler: SamplerSettings
  /** What this style asks Qwen-Edit for in plain English — it reads sentences, not booru tags. */
  sentence: string
  notes?: string
}

const ILLUSTRIOUS_XL: WeightRef = { file: 'illustriousXL20_v20.safetensors', folder: 'checkpoints', sizeMB: 6616, commercialImages: true }
const PONY_V6: WeightRef = { file: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors', folder: 'checkpoints', sizeMB: 6616 }
const DISNEY_PIXAR_SD15: WeightRef = { file: 'disneyPixarCartoon_v10.safetensors', folder: 'checkpoints', sizeMB: 4047 }

const IL_QUALITY = ['masterpiece', 'best quality', 'very aesthetic', 'absurdres']
const PONY_QUALITY = ['score_9', 'score_8_up', 'score_7_up', 'score_6_up']
const SDXL_NEGATIVE = [
  'lowres', 'worst quality', 'bad quality', 'bad anatomy', 'bad hands', 'extra fingers', 'missing fingers',
  'extra limbs', 'two heads', 'jpeg artifacts', 'signature', 'watermark', 'username', 'text', 'speech bubble',
  'blurry', 'cropped'
]
const IL_SAMPLER: SamplerSettings = { steps: 28, cfg: 6, sampler: 'euler_ancestral', scheduler: 'normal', clipSkip: 2 }
const PONY_SAMPLER: SamplerSettings = { steps: 28, cfg: 6.5, sampler: 'euler_ancestral', scheduler: 'normal', clipSkip: 2 }

function lora(file: string, sizeMB: number, triggers: string[], strength = 0.9, commercialImages = false): LoraUse {
  return { weight: { file, folder: 'loras', sizeMB, commercialImages }, strengthModel: strength, strengthClip: strength, triggers }
}

export const STYLES: CartoonStyle[] = [
  {
    id: 'family-guy', label: 'Family Guy / American Dad', family: 'illustrious', region: 'american',
    referenceShows: ['Family Guy', 'American Dad', 'The Cleveland Show'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('Family_Guy_Style_IllustV2.safetensors', 217, ['2d', 'cartoon', 'familyguystyle', 'modern animation', 'circle eyes', 'four fingers'], 0.85)],
    promptPrefix: IL_QUALITY, promptSuffix: ['flat color', 'thick outlines'],
    negative: [...SDXL_NEGATIVE, 'anime', 'manga', 'two mouths', 'stewie griffin', 'peter griffin'], sampler: IL_SAMPLER,
    sentence: 'the Family Guy cartoon style: flat colors, thick outlines, round eyes with dot pupils, four fingers',
    notes: 'The Griffin family is tagged in the LoRA, so an undescribed character drifts toward them — keep the lock list explicit.'
  },
  {
    id: 'south-park', label: 'South Park (paper cut-out)', family: 'illustrious', region: 'american',
    referenceShows: ['South Park'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('south_parkILL.safetensors', 217, ['south_park'], 0.9)],
    promptPrefix: IL_QUALITY, promptSuffix: ['paper cutout style', 'flat color', 'simple shapes'],
    negative: [...SDXL_NEGATIVE, 'anime', 'realistic', 'detailed shading'], sampler: IL_SAMPLER,
    sentence: 'the South Park paper cut-out cartoon style: flat shapes, simple geometry, flat colors'
  },
  {
    id: 'simpsons', label: 'The Simpsons (Groening)', family: 'pony', region: 'american',
    referenceShows: ['The Simpsons', 'Futurama'], checkpoint: PONY_V6,
    loras: [lora('The_Simpsons_style.safetensors', 217, ['theSimpsonsstyle'], 0.9, true)],
    promptPrefix: [...PONY_QUALITY, 'source_cartoon', '2d'], promptSuffix: ['flat color', 'yellow skin', 'overbite'],
    negative: [...SDXL_NEGATIVE, 'source_anime', 'realistic', '3d'], sampler: PONY_SAMPLER,
    sentence: 'the Simpsons cartoon style by Matt Groening: yellow skin, overbite, flat colors, thick outlines',
    notes: 'Drop "yellow skin" from the suffix for non-Springfield humans.'
  },
  {
    id: 'rick-and-morty', label: 'Rick and Morty (Roiland)', family: 'illustrious', region: 'american',
    referenceShows: ['Rick and Morty', 'Solar Opposites'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('Rick_and_Morty_-_Style.safetensors', 217, ['rnmstyle', 'toon \\(style\\)', 'flat color'], 1.0)],
    promptPrefix: IL_QUALITY, promptSuffix: ['wobbly outlines', 'anime screenshot'],
    negative: [...SDXL_NEGATIVE, 'realistic', '3d', 'detailed shading'], sampler: IL_SAMPLER,
    sentence: 'the Rick and Morty cartoon style: wobbly outlines, flat colors, wide eyes'
  },
  {
    id: 'dragon-ball', label: 'Dragon Ball (Toriyama, 1980s)', family: 'illustrious', region: 'anime',
    referenceShows: ['Dragon Ball', 'Dragon Ball Z', 'Dr. Slump'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('DragonBall_v7.safetensors', 109, ['drgnbll', '1980s \\(style\\)', 'anime screenshot', 'retro artstyle'], 0.9)],
    promptPrefix: IL_QUALITY, promptSuffix: ['cel shading', 'bold outlines'],
    negative: [...SDXL_NEGATIVE, 'western cartoon', '3d', 'realistic'], sampler: IL_SAMPLER,
    sentence: 'the 1980s Dragon Ball anime style by Akira Toriyama: cel shading, bold clean outlines, flat colors, retro anime screenshot look'
  },
  {
    id: 'naruto', label: 'Naruto (Kishimoto / Pierrot)', family: 'illustrious', region: 'anime',
    referenceShows: ['Naruto', 'Naruto Shippuden', 'Boruto'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('NARUTOSTYLE2.safetensors', 217, ['kishimoto masashi', 'naruto \\(series\\)'], 0.8)],
    promptPrefix: IL_QUALITY, promptSuffix: ['anime screenshot', 'cel shading'],
    negative: [...SDXL_NEGATIVE, 'western cartoon', '3d', 'realistic'], sampler: IL_SAMPLER,
    sentence: 'the Naruto anime style by Masashi Kishimoto: cel shading, sharp lineart, anime screenshot look',
    notes: 'The creator calls this LoRA unstable — expect to tune strength per character.'
  },
  {
    id: 'anime', label: 'Modern anime (no LoRA)', family: 'illustrious', region: 'anime',
    referenceShows: ['any seasonal anime look'], checkpoint: ILLUSTRIOUS_XL, loras: [],
    promptPrefix: IL_QUALITY, promptSuffix: ['anime style', 'cel shading', 'clean lineart'],
    negative: [...SDXL_NEGATIVE, 'western cartoon', '3d', 'realistic'], sampler: IL_SAMPLER,
    sentence: 'a modern anime style: cel shading, clean lineart'
  },
  {
    id: 'disney-2d', label: 'Disney Renaissance 2D', family: 'illustrious', region: 'american',
    referenceShows: ['The Little Mermaid', 'Aladdin', 'The Lion King', 'Hercules'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('Disney_Renaissance_IllustriousV1.safetensors', 217, ['DisneyRenstyle'], 0.9, true)],
    promptPrefix: IL_QUALITY, promptSuffix: ['traditional animation', 'cel shading', 'expressive'],
    negative: [...SDXL_NEGATIVE, 'anime', '3d', 'realistic'], sampler: IL_SAMPLER,
    sentence: 'the 1990s Disney Renaissance hand-drawn animation style'
  },
  {
    id: 'pixar-3d', label: 'Pixar / DreamWorks 3D', family: 'illustrious', region: '3d',
    referenceShows: ['Toy Story', 'Inside Out', 'Shrek', 'Encanto'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('Pixar cinematic style illustriousXL v1.safetensors', 435, ['Pixar cinematic style', '3D', 'cartoon'], 0.9)],
    promptPrefix: IL_QUALITY, promptSuffix: ['3d render', 'subsurface scattering', 'soft cinematic lighting'],
    negative: [...SDXL_NEGATIVE, '2d', 'flat color', 'anime', 'lineart'], sampler: IL_SAMPLER,
    sentence: 'a Pixar 3D animated film style: soft cinematic lighting, subsurface scattering, stylized proportions'
  },
  {
    id: 'western-flat', label: 'Flat western cartoon', family: 'illustrious', region: 'american',
    referenceShows: ['Bob’s Burgers', 'Gravity Falls'], checkpoint: ILLUSTRIOUS_XL,
    loras: [lora('Juukyuu_Style.safetensors', 217, ['flat colors', 'solid circle eyes', 'black eyes'], 0.85, true)],
    promptPrefix: IL_QUALITY, promptSuffix: ['thick outlines', 'simple shading'],
    negative: [...SDXL_NEGATIVE, 'anime', '3d', 'realistic'], sampler: IL_SAMPLER,
    sentence: 'a flat western TV cartoon style: solid circle eyes, flat colors, thick outlines',
    notes: 'Omit "<color> eyes" from the lock list to get the solid circle eyes.'
  },
  {
    id: 'pony-toon', label: 'Generic western toon (Pony, no LoRA)', family: 'pony', region: 'generic',
    referenceShows: ['a smoke test more than a show'], checkpoint: PONY_V6, loras: [],
    promptPrefix: [...PONY_QUALITY, 'source_cartoon', '2d', 'western cartoon'], promptSuffix: ['flat color', 'thick outlines'],
    negative: [...SDXL_NEGATIVE, 'source_anime', 'source_furry', 'source_pony', 'realistic', '3d'], sampler: PONY_SAMPLER,
    sentence: 'a generic flat western TV cartoon style'
  },
  {
    id: 'pixar-sd15', label: 'Disney/Pixar 3D (SD1.5, low-res)', family: 'sd15', region: '3d',
    referenceShows: ['Toy Story', 'Frozen'], checkpoint: DISNEY_PIXAR_SD15, loras: [],
    promptPrefix: ['masterpiece', 'best quality', '3d pixar style', 'disney style'], promptSuffix: ['soft lighting', 'highly detailed'],
    negative: [...SDXL_NEGATIVE, '2d', 'flat color', 'anime', 'deformed'],
    sampler: { steps: 28, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras' },
    sentence: 'a Pixar 3D animated film style'
  }
]

/** Qwen-Image-Edit-2511 — the reference-true engine for photo → character and for sheets. */
export const QWEN_EDIT_2511 = {
  diffusion: { file: 'qwen_image_edit_2511_fp8mixed.safetensors', folder: 'diffusion_models', sizeMB: 20500, commercialImages: true } as WeightRef,
  textEncoder: { file: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', folder: 'text_encoders', sizeMB: 9385 } as WeightRef,
  vae: { file: 'qwen_image_vae.safetensors', folder: 'vae', sizeMB: 254 } as WeightRef,
  lightning: { file: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', folder: 'loras', sizeMB: 850 } as WeightRef
}

export function getStyle(id: string): CartoonStyle {
  const s = STYLES.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown style "${id}"`)
  return s
}

export function styleWeights(style: CartoonStyle): WeightRef[] {
  return [style.checkpoint, ...style.loras.map((l) => l.weight)]
}

export function qwenWeights(): WeightRef[] {
  return [QWEN_EDIT_2511.diffusion, QWEN_EDIT_2511.textEncoder, QWEN_EDIT_2511.vae, QWEN_EDIT_2511.lightning]
}

export function weightPath(ref: WeightRef): string | null {
  const root = comfyConfig()?.path
  return root ? join(root, 'models', ref.folder, ref.file) : null
}

export function missingWeights(refs: WeightRef[]): WeightRef[] {
  return refs.filter((r) => {
    const p = weightPath(r)
    return !p || !existsSync(p)
  })
}

export function listStyleViews(): CharacterStyleView[] {
  return STYLES.map((s) => {
    const missing = missingWeights(styleWeights(s))
    return {
      id: s.id,
      label: s.label,
      family: s.family,
      region: s.region,
      referenceShows: s.referenceShows,
      ready: missing.length === 0,
      missing: missing.map((m) => m.file),
      missingMB: missing.reduce((n, m) => n + m.sizeMB, 0),
      notes: s.notes
    }
  })
}

// ---- dimensions (same ~1 MP table as resources/comfyui-mcp.cjs, so outputs line up) ----

const MP1: Record<string, [number, number]> = {
  '1:1': [1024, 1024], '9:16': [768, 1344], '16:9': [1344, 768], '4:5': [896, 1120], '5:4': [1120, 896],
  '3:4': [896, 1184], '4:3': [1184, 896], '2:3': [832, 1248], '3:2': [1248, 832], '21:9': [1536, 656]
}
/** SD1.5 was trained at 512; ~0.4 MP keeps it from doubling heads. */
const SD15: Record<string, [number, number]> = {
  '1:1': [640, 640], '9:16': [512, 912], '16:9': [912, 512], '4:5': [576, 720], '5:4': [720, 576],
  '3:4': [576, 768], '4:3': [768, 576], '2:3': [528, 792], '3:2': [792, 528], '21:9': [1024, 432]
}

export function dimsFor(aspect: string, family: BaseFamily | 'qwen' = 'illustrious'): { width: number; height: number } {
  const table = family === 'sd15' ? SD15 : MP1
  const [width, height] = table[aspect] ?? table['9:16']!
  return { width, height }
}

// ---- prompts ---------------------------------------------------------------

const SUBJECT_TAG: Record<CharacterSpec['kind'], string> = {
  man: '1boy, adult male, solo',
  woman: '1girl, adult female, solo',
  boy: '1boy, child, solo',
  girl: '1girl, child, solo',
  creature: 'creature, solo, no humans',
  animal: 'animal, solo, no humans',
  robot: 'robot, solo, no humans'
}

function withNoun(value: string, noun: string): string {
  return value.toLowerCase().endsWith(noun) ? value : `${value} ${noun}`
}

/** The lock list rendered as tags — every defined field becomes an explicit constraint. */
export function lockListTags(spec: CharacterSpec): string[] {
  const tags = [SUBJECT_TAG[spec.kind]]
  if (spec.species) tags.push(spec.species)
  if (spec.age) tags.push(spec.age)
  tags.push(withNoun(spec.hair, 'hair'))
  tags.push(withNoun(spec.eyes, 'eyes'))
  if (spec.skin) tags.push(withNoun(spec.skin, 'skin'))
  if (spec.build) tags.push(spec.build)
  tags.push(spec.outfit)
  if (spec.accessories) tags.push(spec.accessories)
  if (spec.distinguishing) tags.push(spec.distinguishing)
  if (spec.extra) tags.push(spec.extra)
  return tags
}

export interface ShotOptions {
  pose?: string
  background?: string
  expression?: string
}

/** Casting prompt for the SDXL family (tag dialect): quality → LoRA triggers → subject + lock list → shot → style hints. */
export function buildCastingPrompt(style: CartoonStyle, spec: CharacterSpec, opts: ShotOptions = {}): { positive: string; negative: string } {
  const triggers = style.loras.flatMap((l) => l.triggers)
  const shot = [
    opts.expression ?? (spec.personality ? `${spec.personality} expression` : 'neutral expression'),
    opts.pose ?? 'full body, standing, facing viewer, arms at sides',
    opts.background ?? 'simple background, white background'
  ]
  const positive = [...style.promptPrefix, ...triggers, ...lockListTags(spec), ...shot, ...style.promptSuffix]
    .map((t) => t.trim())
    .filter(Boolean)
    .join(', ')
  return { positive, negative: style.negative.join(', ') }
}

/** Natural-language description for instruction-editing models and for the reviewer. */
export function describeCharacter(spec: CharacterSpec): string {
  const parts = [`${spec.name} is a ${[spec.age, spec.species ?? spec.kind].filter(Boolean).join(' ')}`]
  parts.push(`with ${spec.hair} hair and ${spec.eyes} eyes`)
  if (spec.skin) parts.push(`${spec.skin} skin`)
  if (spec.build) parts.push(`a ${spec.build} build`)
  parts.push(`wearing ${spec.outfit}`)
  if (spec.accessories) parts.push(`plus ${spec.accessories}`)
  if (spec.distinguishing) parts.push(`distinguishing features: ${spec.distinguishing}`)
  return `${parts.join(', ')}.`
}
