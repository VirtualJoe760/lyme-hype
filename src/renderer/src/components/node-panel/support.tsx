/** Node-panel support: the tool glyphs, the horizontal-wheel shim, and the
 *  connector-readiness read. Split out so the panel file is render code. */

import type { ConnectorView, MediaType } from '@shared/types'
import type { ToolIcon } from '@shared/node-manifest'
import { useStudio } from '../../store'


export const ICONS: Record<ToolIcon, React.JSX.Element> = {
  generate: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 15l5-5 4 4 3-3 4 4" /></>,
  brush: <><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="M13.5 6.5 17.5 10.5" /></>,
  expand: <><rect x="8" y="8" width="8" height="8" rx="1" /><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  eraser: <><path d="M4 16 12 8l6 6-6 6H6Z" /><path d="M10 20h10" /></>,
  upscale: <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /><path d="M4 21h16" /></>,
  crop: <><path d="M7 3v14h14" /><path d="M3 7h14v14" /></>,
  play: <path d="M5 4l14 8-14 8Z" />,
  extend: <><path d="M4 12h13" /><path d="M13 7l5 5-5 5" /><path d="M21 4v16" /></>,
  wave: <path d="M4 12h3l3-7 4 14 3-7h3" />,
  music: <><circle cx="7" cy="18" r="3" /><circle cx="18" cy="15" r="3" /><path d="M10 18V5l11-2v13" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  images: <><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M21 8v11H9" /></>,
  caption: <><path d="M4 6h16M4 12h10M4 18h13" /></>,
  trash: <><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></>,
  eye: <><circle cx="12" cy="12" r="3" /><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /></>,
  face: <><circle cx="12" cy="12" r="9" /><path d="M9 10h.01M15 10h.01M8.5 15a5 5 0 0 0 7 0" /></>,
  upload: <><path d="M12 15V4" /><path d="M7 8l5-5 5 5" /><path d="M4 16v4h16v-4" /></>
}

export function Icon(props: { name: ToolIcon }): React.JSX.Element {
  return (
    <svg className="np-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  )
}

/** Stable empty array so the not-open case never hands zustand a fresh reference. */
export const EMPTY_NODES: ReturnType<typeof useStudio.getState>["nodes"] = []

/** Wheel-over-row → horizontal scroll of THAT row; everywhere else the wheel
 *  scrolls the panel vertically. A native non-passive listener because React's
 *  delegated wheel handlers are passive — preventDefault (needed to stop the
 *  panel double-scrolling) is ignored there. When the row fits, the event
 *  bubbles so the panel scrolls normally. */
type HWheelElement = HTMLDivElement & { __lymeHWheel?: (e: WheelEvent) => void }
export function hWheelRef(node: HTMLDivElement | null): void {
  if (!node) return
  const el = node as HWheelElement
  // Replace, never stack: the handler hangs off the element itself so a rebind
  // (React re-render, dev HMR re-evaluating this module) swaps it instead of
  // accumulating listeners — stacked handlers multiplied the scroll speed.
  if (el.__lymeHWheel) el.removeEventListener('wheel', el.__lymeHWheel)
  const handler = (e: WheelEvent): void => {
    if (el.scrollWidth <= el.clientWidth) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    // Raw wheel notches are ~120px — a whole pill per tick. Dampened so a
    // notch nudges rather than lurches; trackpad deltas (small, continuous)
    // pass through the same factor smoothly.
    el.scrollLeft += delta * 0.35
    e.preventDefault()
  }
  el.__lymeHWheel = handler
  el.addEventListener('wheel', handler, { passive: false })
}

export function readyConnectorIds(connectors: ConnectorView[]): string[] {
  return connectors.filter((c) => c.authType === 'none' || c.hasCredential).map((c) => c.id)
}

/**
 * One renderer for every creative node. What varies between nodes lives in the manifest
 * (docs/build-plan.md Phase 16), so adding a node is adding a record rather than a
 * component — which is what makes connector intake able to propose one at all.
 */

/**
 * Which media a settings row actually holds. Module-level because it is a fixed
 * mapping, not per-render state — and because a drop has to be refused before it
 * lands rather than silently putting a video where a start frame belongs.
 */
export const MEDIA_ROLES: Record<string, { role: string; media: MediaType }> = {
  startFrame: { role: 'startFrame', media: 'image' },
  endFrame: { role: 'endFrame', media: 'image' },
  sourceMedia: { role: 'sourceVideo', media: 'video' },
  person: { role: 'faceSource', media: 'image' }
}

/** Media a settings row will accept, so a drop is refused before it lands. */
export function acceptedMedia(kind: string): MediaType | null {
  if (kind === 'refs' || kind === 'startFrame' || kind === 'endFrame' || kind === 'person') return 'image'
  if (kind === 'sourceMedia') return 'video'
  return null
}

/**
 * The images an Enhance pass should look at: whatever the user attached, in one
 * de-duplicated list, capped at four so a prompt rewrite stays cheap.
 */
export function enhanceImagesFor(
  refs: string[],
  roles: Record<string, string> | undefined
): string[] {
  const attached = roles ?? {}
  const candidates = [
    ...refs,
    attached['startFrame'],
    attached['endFrame'],
    attached['sourceImage'],
    attached['faceSource']
  ].filter((value): value is string => !!value)
  return [...new Set(candidates)].slice(0, 4)
}

/** The ×N takes stepper — lifted out of the panel to keep it readable. */
export function TakesStepper({ takes, setTakes }: { takes: number; setTakes: (n: number) => void }): React.JSX.Element {
  return (
    <div className="np-takes" title="how many takes to generate at once">
      <button onClick={() => setTakes(Math.max(1, takes - 1))} disabled={takes <= 1}>−</button>
      <span>×{takes}</span>
      <button onClick={() => setTakes(Math.min(8, takes + 1))} disabled={takes >= 8}>+</button>
    </div>
  )
}

/** The short value a settings square shows under its label — lifted out of the
 *  panel so the render file stays under the 700-line ceiling. */
export function settingValueFor(
  kind: string,
  ctx: {
    takes: number
    style?: { name: string } | null
    refs: string[]
    voice: string
    loraKind: string
    model?: { label: string } | null
    steps: number
    roles?: Record<string, string>
  }
): string {
  const { takes, style, refs, voice, loraKind, model, steps, roles } = ctx
    if (kind === 'takes') return String(takes)
    if (kind === 'style') return style ? style.name.slice(0, 9) : 'none'
    if (kind === 'refs') return refs.length ? String(refs.length) : 'none'
    if (kind === 'voice') return voice ? voice.slice(0, 9) : 'default'
    if (kind === 'loraKind') return loraKind
    if (kind === 'trainer') return model ? model.label.slice(0, 9) : 'none'
    if (kind === 'steps') return String(steps)
    if (kind === 'caption') return 'auto'
    if (kind === 'language') return 'en'
    const mediaRole = MEDIA_ROLES[kind]
    if (mediaRole) return (roles ?? {})[mediaRole.role] ? 'set' : 'none'
    return 'none'
}

/** What the preview shows before a take exists: every image linked into the
 *  node, tagged by the role it plays (Joseph, 2026-09-03: a dropped reference
 *  must be visibly "in", not a blank square). */
export function previewInputsFor(
  refs: string[],
  refTypes: Record<string, 'object' | 'character' | 'style'>,
  roles: Record<string, string> | undefined
): { src: string; tag: string }[] {
  const list = refs.map((src) => ({
    src,
    tag: refTypes[src] === 'character' ? 'Character reference' : refTypes[src] === 'style' ? 'Style reference' : 'Reference image'
  }))
  const linked = roles ?? {}
  for (const [role, tag] of [['startFrame', 'Start frame'], ['endFrame', 'End frame'], ['faceSource', 'Face'], ['sourceImage', 'Source image']] as const) {
    if (linked[role]) list.push({ src: linked[role]!, tag })
  }
  return list
}

/** The character a canvas image belongs to (by its src), or null for an ordinary image. */
export function characterNameFor(nodes: { data: { src?: string; characterId?: string; label: string } }[], src: string): string | null {
  const node = nodes.find((n) => n.data.src === src && n.data.characterId)
  return node ? node.data.label : null
}
