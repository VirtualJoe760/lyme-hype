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

/** The floating chip that stands in for the node once the pointer leaves the
 *  canvas — React Flow clips the real node at the canvas edge. */
export function positionGhost(ghost: HTMLElement | null, visible: boolean, clientX: number, clientY: number): void {
  if (!ghost) return
  ghost.hidden = !visible
  if (visible) ghost.style.transform = `translate(${clientX + 14}px, ${clientY + 12}px)`
}
