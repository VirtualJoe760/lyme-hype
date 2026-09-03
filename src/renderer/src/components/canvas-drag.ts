import type { MediaFlowNode } from '../store'

/**
 * Turns a React Flow node drag into a "take this media somewhere" gesture.
 *
 * React Flow's drag only knows how to move a node around the canvas — drag
 * toward the edge and it auto-pans the canvas after you (2026-09-02: "it drags
 * the canvas down to where I'm dragging the node"). What Joseph wants is to
 * drop the node ON things: a timeline lane, the trash can, a Create tile.
 *
 * Every one of those already accepts an HTML5 drop carrying
 * `application/lyme-node` (that is what the node's ⣿ grip sends). So instead of
 * teaching each target a second protocol, the drag END synthesizes that exact
 * drop onto whatever zone is under the pointer, and the node snaps back to
 * where it started. One payload, every target, no duplicated logic.
 */

export const DROP_ZONE_SELECTOR = '.tl-lane, .trash-can, .create-tile'
/** A data attribute, deliberately not a class: React owns `className` on these
 *  elements and rewrites it on every re-render — and a node drag re-renders the
 *  canvas every frame, so a class added here vanished before anyone saw it
 *  (2026-09-02: "the trash should get bigger and red"). React leaves attributes
 *  it did not set alone. */
const ZONE_ATTR = 'data-drop-target'

export function zoneAt(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  return el?.closest(DROP_ZONE_SELECTOR) ?? null
}

let lit: HTMLElement | null = null

/** Highlights the zone under the pointer (and un-highlights the previous one). */
export function highlightZone(zone: HTMLElement | null): void {
  if (lit === zone) return
  lit?.removeAttribute(ZONE_ATTR)
  zone?.setAttribute(ZONE_ATTR, '')
  lit = zone
}

/** The trash can sits in the canvas corner with padding between it and the
 *  panels. Sliding off the can into that padding used to snap the ghost back
 *  to full size for a few pixels — so within this radius of the can's centre
 *  the ghost stays mini, lit or not (Joseph, 2026-09-03). */
const TRASH_HALO_PX = 80

export function nearTrash(clientX: number, clientY: number): boolean {
  const can = document.querySelector('.trash-can')
  if (!can) return false
  const r = can.getBoundingClientRect()
  const dx = clientX - (r.left + r.width / 2)
  const dy = clientY - (r.top + r.height / 2)
  return Math.hypot(dx, dy) <= TRASH_HALO_PX
}

export function clearZoneHighlight(): void {
  highlightZone(null)
}

/**
 * Delivers the node to a zone by dispatching the same dragover + drop the grip
 * would have produced. React listens to native drag events, so the zone's
 * existing onDragOver/onDrop handlers run unchanged.
 */
export function dropNodeOn(zone: HTMLElement, node: MediaFlowNode, clientX: number, clientY: number): boolean {
  const dt = new DataTransfer()
  dt.setData('application/lyme-node', node.id)
  dt.setData('application/lyme-node-type', node.data.mediaType)
  dt.setData('text/plain', node.data.label)
  const init: DragEventInit = { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dt }
  const over = new DragEvent('dragover', init)
  zone.dispatchEvent(over)
  // A zone that would not accept the grip's drop must not accept this one.
  if (!over.defaultPrevented) return false
  zone.dispatchEvent(new DragEvent('drop', init))
  return true
}

/** Where the dragged node's box sits on screen relative to the pointer, taken
 *  once at drag start so the ghost keeps the grab point. */
export interface GhostGeometry {
  /** The React Flow wrapper of the dragged node — hidden while the ghost stands in for it. */
  el: HTMLElement
  width: number
  height: number
  offsetX: number
  offsetY: number
}

/** React Flow keeps re-rendering the wrapper during a drag, so its visibility is
 *  an attribute React never sets (the same lesson as the drop-zone highlight). */
const GHOSTED_ATTR = 'data-ghosted'

export function ghostGeometryFor(nodeId: string, clientX: number, clientY: number): GhostGeometry | null {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { el, width: r.width, height: r.height, offsetX: clientX - r.left, offsetY: clientY - r.top }
}

/** The stand-in for a node whose pointer has left the canvas, where React Flow
 *  clips the real one: a thumbnail centred on the pointer, floating above the
 *  side panels, while the canvas copy is hidden. One rule — off the canvas, or
 *  over a drop zone (the trash can lives inside the canvas), means mini.
 *  Sizing by what is underneath made it jump between tiles: full size over the
 *  gaps, mini over a tile (Joseph, 2026-09-03). */
const MINI_MAX = 52

export function positionGhost(
  ghost: HTMLElement | null,
  geometry: GhostGeometry | null,
  canvas: DOMRect | undefined,
  clientX: number,
  clientY: number,
  overZone: boolean
): void {
  if (!ghost) return
  if (!geometry || !canvas) {
    ghost.hidden = true
    return
  }
  const offCanvas =
    clientX < canvas.left || clientX > canvas.right || clientY < canvas.top || clientY > canvas.bottom
  const standIn = offCanvas || overZone
  ghost.hidden = !standIn
  // Only ever ONE picture of the node: the canvas copy vanishes while the ghost shows.
  geometry.el.toggleAttribute(GHOSTED_ATTR, standIn)
  if (!standIn) return
  const scale = MINI_MAX / Math.max(geometry.width, geometry.height)
  const w = Math.round(geometry.width * scale)
  const h = Math.round(geometry.height * scale)
  ghost.style.width = `${w}px`
  ghost.style.height = `${h}px`
  ghost.style.transform = `translate(${Math.round(clientX - w / 2)}px, ${Math.round(clientY - h / 2)}px)`
}

export function hideGhost(ghost: HTMLElement | null, geometry: GhostGeometry | null): void {
  geometry?.el.removeAttribute(GHOSTED_ATTR)
  if (ghost) ghost.hidden = true
}
