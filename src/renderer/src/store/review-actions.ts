/** Combine dialog, Play view review/trim, and Storyboard panels.
 *
 * A slice of the studio store: the same actions as before, lifted out of the
 * create() body so no single file carries the whole surface. */

import type {
  MediaType,
} from '@shared/types'
import { bridge } from '../bridge'
import type { StoreCtx } from './context'
import { nextId, type MediaFlowNode, type StudioStore } from './types'
import {
  localCombineFor,
  pickSwatch,
} from './helpers'

export function createReviewActions(ctx: StoreCtx): Pick<StudioStore, 'openCombine' | 'closeCombine' | 'confirmCombine' | 'openPlay' | 'closePlay' | 'openEditor' | 'closeEditor' | 'setEditorMask' | 'setTrim' | 'splitAtPlayhead' | 'detachAudio' | 'deleteAudio' | 'addPanel' | 'updatePanel' | 'movePanel' | 'promotePanel'> {
  const {
    set,
    get,
    persist,
    patchNodeData,
    patchNodeAnywhere,
    activeSession,
    scheduleStubReady,
  } = ctx

  return {
  openCombine(sourceId, targetId) {
    if (sourceId === targetId) return
    set({ combine: { sourceId, targetId } })
  },

  closeCombine() {
    set({ combine: null })
  },

  confirmCombine(note) {
    const { combine, nodes } = get()
    if (!combine) return
    const source = nodes.find((n) => n.id === combine.sourceId)
    const target = nodes.find((n) => n.id === combine.targetId)
    set({ combine: null })
    if (!source || !target) return

    const label = `combine_${source.data.label.slice(0, 8)}+${target.data.label.slice(0, 8)}`
    const position = {
      x: (source.position.x + target.position.x) / 2 + 40,
      y: (source.position.y + target.position.y) / 2 + 60
    }
    const pair = [source.data.mediaType, target.data.mediaType].sort().join('+')
    const trimmedNote = note?.trim()

    // image+image and audio+image are real generation chains — reference-
    // conditioning and lipsync/animate-with-audio respectively — reusing
    // the same GenerationParams fields Deepfake's Stage 2 and Motion
    // graphics' References stage already established, because "how should
    // these mix" needs the agent's judgment. Every other pair (video+video,
    // image+video, audio+video, audio+audio) is deterministic instead —
    // see localCombineFor — and composites via local ffmpeg, no agent turn.
    if (pair === 'image+image' && source.data.src && target.data.src) {
      get().generateMedia({
        label,
        mediaType: 'image',
        position,
        prompt:
          trimmedNote ||
          'Merge these two reference images into one new image, blending their content and style together.',
        referenceImagePaths: [source.data.src, target.data.src]
      })
      return
    }

    if (pair === 'audio+image') {
      const imageNode = source.data.mediaType === 'image' ? source : target
      const audioNode = source.data.mediaType === 'audio' ? source : target
      if (imageNode.data.src && audioNode.data.src) {
        get().generateMedia({
          label,
          mediaType: 'video',
          position,
          prompt: [
            trimmedNote ||
              'Animate this still image driven by the accompanying audio.',
            'If the image shows a face, lip-sync its mouth to the audio like a talking avatar. Otherwise animate the still to the mood and pacing of the audio and use the audio as its soundtrack.'
          ].join(' '),
          sourceMediaPath: imageNode.data.src,
          referenceAudioPaths: [audioNode.data.src]
        })
        return
      }
    }

    const local = localCombineFor(source, target)
    if (local) {
      const outMediaType: MediaType = local.kind === 'mix-audio' ? 'audio' : 'video'
      const id = nextId('node')
      const node: MediaFlowNode = {
        id,
        type: 'media',
        position,
        data: {
          label,
          mediaType: outMediaType,
          // Local ffmpeg composite, not an agent generation — same
          // provenance IsolateScreen already uses for its ffmpeg output.
          source: 'upload',
          status: 'rendering',
          swatch: pickSwatch()
        }
      }
      set({ nodes: [...get().nodes, node] })
      persist()
      void (async () => {
        const result = await bridge.media.combineLocal(local)
        if (result?.ok && result.src) {
          patchNodeAnywhere(id, { src: result.src, status: 'ready', error: undefined })
        } else {
          patchNodeAnywhere(id, { status: 'error', error: result?.error ?? 'Local combine failed.' })
        }
      })()
      return
    }

    // Unreachable for MediaType's current three values (every pairing is
    // either generative above or local here) — kept as a safety net rather
    // than assuming a future MediaType addition is covered automatically.
    const types = new Set<MediaType>([source.data.mediaType, target.data.mediaType])
    const mediaType: MediaType = types.has('video')
      ? 'video'
      : types.has('audio') && types.has('image')
        ? 'video'
        : source.data.mediaType

    get().addNode({
      label,
      mediaType,
      source: 'generate',
      position,
      startRendering: true
    })
  },

  openPlay(nodeId) {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || node.data.mediaType === 'image') return
    const session = activeSession()
    set({ playNodeId: nodeId, playFrom: session?.view ?? 'canvas' })
  },

  closePlay() {
    set({ playNodeId: null })
  },

  openEditor(manifestId, mode) {
    set({ editor: { manifestId, mode } })
  },

  closeEditor() {
    set({ editor: null })
  },

  setEditorMask(mask) {
    const editor = get().editor
    if (!editor) return
    set({ editor: { ...editor, mask } })
  },

  setTrim(nodeId, trimIn, trimOut) {
    patchNodeData(nodeId, { trimIn, trimOut })
  },

  splitAtPlayhead(nodeId, at) {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node) return
    const inPt = node.data.trimIn ?? 0
    const outPt = node.data.trimOut
    if (at <= inPt || (outPt !== undefined && at >= outPt)) return
    // Left half stays on the source node; right half spawns beside it. Both are
    // non-destructive views of the same file (in/out points only).
    patchNodeData(nodeId, { trimOut: at })
    get().addNode({
      label: `${node.data.label}_b`,
      mediaType: node.data.mediaType,
      source: node.data.source,
      src: node.data.src,
      position: { x: node.position.x + 130, y: node.position.y + 24 },
      startRendering: false
    })
    // Carry the right-half range onto the freshly added node (last in the list).
    const added = get().nodes[get().nodes.length - 1]
    if (added) patchNodeData(added.id, { trimIn: at, trimOut: outPt })
  },

  detachAudio(nodeId) {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || node.data.mediaType !== 'video' || !node.data.src) return
    // Detach spawns an independent audio node referencing the same file. Real
    // track extraction happens at export via ffmpeg (Phase 7); this is the
    // non-destructive canvas representation.
    get().addNode({
      label: `${node.data.label}_audio`,
      mediaType: 'audio',
      source: node.data.source,
      src: node.data.src,
      position: { x: node.position.x + 24, y: node.position.y + 150 },
      startRendering: false
    })
  },

  deleteAudio(nodeId) {
    patchNodeData(nodeId, { audioMuted: true })
  },

  addPanel(input) {
    const panels = get().nodes.filter((n) => n.data.panel)
    const nextOrder = panels.reduce((max, n) => Math.max(max, n.data.panelOrder ?? 0), 0) + 1
    const node: MediaFlowNode = {
      id: nextId('panel'),
      type: 'media',
      // Off-canvas until promoted; promotePanel assigns the real position.
      position: { x: 0, y: 0 },
      data: {
        label: input?.label ?? `panel ${String(nextOrder).padStart(2, '0')}`,
        mediaType: input?.mediaType ?? 'video',
        source: 'generate',
        status: 'ready',
        swatch: pickSwatch(),
        panel: true,
        panelOrder: nextOrder,
        promoted: false,
        shotDescription: input?.shotDescription
      }
    }
    set({ nodes: [...get().nodes, node] })
    persist()
  },

  updatePanel(nodeId, patch) {
    patchNodeData(nodeId, patch)
  },

  movePanel(nodeId, dir) {
    const ordered = get()
      .nodes.filter((n) => n.data.panel)
      .sort((a, b) => (a.data.panelOrder ?? 0) - (b.data.panelOrder ?? 0))
    const idx = ordered.findIndex((n) => n.id === nodeId)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return
    const a = ordered[idx]
    const b = ordered[swapWith]
    const aOrder = a.data.panelOrder ?? 0
    const bOrder = b.data.panelOrder ?? 0
    set({
      nodes: get().nodes.map((n) => {
        if (n.id === a.id) return { ...n, data: { ...n.data, panelOrder: bOrder } }
        if (n.id === b.id) return { ...n, data: { ...n.data, panelOrder: aOrder } }
        return n
      })
    })
    persist()
  },

  promotePanel(nodeId) {
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!node || !node.data.panel || node.data.promoted) return
    // Same node object graduates onto the Canvas — not a copy. It enters the
    // "Rendering…" lifecycle a real generation will occupy (stub timer today).
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              position: { x: 80 + Math.random() * 300, y: 80 + Math.random() * 220 },
              data: { ...n.data, promoted: true, status: 'rendering' }
            }
          : n
      )
    })
    persist()
    // A promoted panel with a note becomes a real generation; without one it
    // falls back to the stub lifecycle (nothing to prompt with yet).
    const note = (node.data.note ?? '').trim()
    if (note) {
      void get().generateMedia({
        nodeId,
        label: node.data.label,
        mediaType: node.data.mediaType,
        prompt: note,
        // Storyboard-tier routing: an image panel's model choice restricts
        // the generation to that connector (docs/connectors/catalog.md).
        connectorId: node.data.connectorId
      })
    } else {
      scheduleStubReady(nodeId)
    }
  },
  }
}
