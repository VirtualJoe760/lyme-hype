/** The canvas trash: deletes are reversible until the trash is emptied.
 *
 * Prompted by a deleted image that Ctrl+Z could not bring back (2026-09-02). A
 * generation is paid for or waited for; one keypress must not be the end of
 * it. The asset file is never touched — trash forgets the NODE; the media
 * stays in the asset store and Recent generations either way. */

import type { Session, TrashedNode } from '@shared/types'
import type { StoreCtx } from './context'
import { reparentOrphans, toFlowNode, toNodeState } from './helpers'
import type { StudioStore } from './types'

const TRASH_CAP = 50

export function createTrashActions(
  ctx: StoreCtx
): Pick<StudioStore, 'trashNodes' | 'restoreFromTrash' | 'restoreLastTrashed' | 'emptyTrash'> {
  const { set, get, persist, updateSession, activeSession } = ctx

  function writeTrash(session: Session, trash: TrashedNode[]): void {
    updateSession(session.id, { trash: trash.slice(0, TRASH_CAP) })
  }

  return {
    trashNodes(requested) {
      const session = activeSession()
      // A trashed group takes its members along — a child cannot outlive its frame.
      const ids = [...new Set([...requested, ...get().nodes.filter((n) => n.parentId && requested.includes(n.parentId)).map((n) => n.id)])]
      const doomed = get().nodes.filter((n) => ids.includes(n.id))
      if (doomed.length === 0) return
      const deletedAt = new Date().toISOString()
      set({ nodes: get().nodes.filter((n) => !ids.includes(n.id)) })
      if (session) {
        // Clips pointing at a trashed node leave the timeline with it; they come
        // back only if the user re-adds the restored node.
        updateSession(session.id, {
          timeline: {
            ...session.timeline,
            clips: session.timeline.clips.filter((clip) => !ids.includes(clip.nodeId))
          }
        })
        const fresh = activeSession() ?? session
        writeTrash(fresh, [
          ...doomed.map((n) => ({ node: toNodeState(n), deletedAt })),
          ...(fresh.trash ?? [])
        ])
      }
      persist()
    },

    restoreFromTrash(nodeId) {
      const session = activeSession()
      const entry = session?.trash?.find((t) => t.node.id === nodeId)
      if (!session || !entry) return
      const node = toFlowNode(entry.node)
      set({ nodes: reparentOrphans([...get().nodes, { ...node, selected: false }]), focusNodeId: node.id })
      writeTrash(session, (session.trash ?? []).filter((t) => t.node.id !== nodeId))
      persist()
    },

    restoreLastTrashed() {
      const latest = activeSession()?.trash?.[0]
      if (!latest) return false
      get().restoreFromTrash(latest.node.id)
      return true
    },

    emptyTrash() {
      const session = activeSession()
      if (!session) return
      writeTrash(session, [])
      persist()
    }
  }
}
