/** Canvas layout: tidy the nodes into lines, and group nodes so they move as one.
 *
 * A slice of the studio store, same shape as the others. */

import type { MediaType } from '@shared/types'
import type { StoreCtx } from './context'
import { nextId, type MediaFlowNode, type StudioStore } from './types'
import { groupsFirst, isGroup, pickSwatch } from './helpers'

const TIDY_ORIGIN = { x: 80, y: 80 }
const TIDY_GAP = 36
const TIDY_ROW_GAP = 72
const GROUP_PAD = 20
const GROUP_HEADER = 30
const DEFAULT_WIDTH = 104

/** A node's on-screen box. Height follows the media's aspect ratio and is only
 *  known once React Flow has measured it; before that, assume portrait 9:16. */
function sizeOf(node: MediaFlowNode): { width: number; height: number } {
  const width = node.width ?? node.measured?.width ?? DEFAULT_WIDTH
  const height = node.height ?? node.measured?.height ?? Math.round(width * (16 / 9))
  return { width, height }
}

const ROW_ORDER: MediaType[] = ['image', 'video', 'audio']

export function createLayoutActions(ctx: StoreCtx): Pick<StudioStore, 'tidyCanvas' | 'groupSelected' | 'renameGroup' | 'ungroup'> {
  const { set, get, persist } = ctx

  return {
    /** Photos in one line, videos in the next, audio in the third — left to
     *  right in their current left-to-right order, so nothing swaps places.
     *  Groups are laid out as blocks in the row of their first child's media;
     *  nodes inside a group keep their arrangement inside it. */
    tidyCanvas() {
      const all = get().nodes
      const top = all.filter((n) => !n.parentId && (!n.data.panel || n.data.promoted))
      const rows = new Map<MediaType, MediaFlowNode[]>()
      for (const n of top) {
        const media = isGroup(n)
          ? (all.find((c) => c.parentId === n.id)?.data.mediaType ?? 'image')
          : n.data.mediaType
        rows.set(media, [...(rows.get(media) ?? []), n])
      }
      const placed = new Map<string, { x: number; y: number }>()
      let y = TIDY_ORIGIN.y
      for (const media of ROW_ORDER) {
        const row = (rows.get(media) ?? []).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
        if (row.length === 0) continue
        let x = TIDY_ORIGIN.x
        let tallest = 0
        for (const n of row) {
          const { width, height } = sizeOf(n)
          placed.set(n.id, { x, y })
          x += width + TIDY_GAP
          tallest = Math.max(tallest, height)
        }
        y += tallest + TIDY_ROW_GAP
      }
      set({ nodes: all.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id)! } : n)) })
      persist()
    },

    /** The selected top-level media nodes become the children of one new group
     *  node sized around them. Moving the group moves them; they cannot be
     *  dragged out of it (React Flow's parent extent). Returns the group id. */
    groupSelected(name) {
      const all = get().nodes
      const members = all.filter((n) => n.selected && !isGroup(n) && !n.parentId)
      if (members.length < 2) return null
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const n of members) {
        const { width, height } = sizeOf(n)
        left = Math.min(left, n.position.x)
        top = Math.min(top, n.position.y)
        right = Math.max(right, n.position.x + width)
        bottom = Math.max(bottom, n.position.y + height)
      }
      const id = nextId('group')
      const origin = { x: left - GROUP_PAD, y: top - GROUP_PAD - GROUP_HEADER }
      const group: MediaFlowNode = {
        id,
        type: 'group',
        position: origin,
        width: right - left + GROUP_PAD * 2,
        height: bottom - top + GROUP_PAD * 2 + GROUP_HEADER,
        selected: true,
        data: {
          label: name?.trim() || `Group ${all.filter(isGroup).length + 1}`,
          group: true,
          mediaType: members[0]!.data.mediaType,
          source: 'upload',
          status: 'ready',
          swatch: pickSwatch()
        }
      }
      const memberIds = new Set(members.map((n) => n.id))
      const rest = all.map((n) =>
        memberIds.has(n.id)
          ? {
              ...n,
              selected: false,
              parentId: id,
              extent: 'parent' as const,
              position: { x: n.position.x - origin.x, y: n.position.y - origin.y }
            }
          : { ...n, selected: false }
      )
      set({ nodes: groupsFirst([group, ...rest]) })
      persist()
      return id
    },

    renameGroup(id, name) {
      const label = name.trim()
      if (!label) return
      set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)) })
      persist()
    },

    /** Children go back to being top-level nodes at the same on-screen spot; the frame goes away. */
    ungroup(id) {
      const all = get().nodes
      const group = all.find((n) => n.id === id && isGroup(n))
      if (!group) return
      set({
        nodes: all
          .filter((n) => n.id !== id)
          .map((n) =>
            n.parentId === id
              ? {
                  ...n,
                  parentId: undefined,
                  extent: undefined,
                  selected: true,
                  position: { x: n.position.x + group.position.x, y: n.position.y + group.position.y }
                }
              : n
          )
      })
      persist()
    }
  }
}
