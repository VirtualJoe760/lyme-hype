/** Multitrack Cut Room: clips, tracks, and the ffmpeg export handoff.
 *
 * A slice of the studio store: the same actions as before, lifted out of the
 * create() body so no single file carries the whole surface. */

import type {
  ExportClip,
  TimelineClip,
  TrackType
} from '@shared/types'
import { bridge } from '../bridge'
import type { StoreCtx } from './context'
import { nextId, type StudioStore } from './types'
import {
  DEFAULT_CLIP_SEC,
  clipDuration,
  probeDuration,
  rippleTrack,
  trackEnd
} from './helpers'

export function createTimelineActions(ctx: StoreCtx): Pick<StudioStore, 'sendToTimeline' | 'addClipToTimelineAt' | 'moveTimelineClip' | 'commitClipPosition' | 'retrimTimelineClip' | 'commitClipTrim' | 'splitTimelineClip' | 'removeTimelineClip' | 'patchTimelineClip' | 'addTrack' | 'removeTrack' | 'toggleTrackFlag' | 'selectTrack' | 'exportTimeline'> {
  const {
    set,
    get,
    updateSession,
    patchNodeData,
    activeSession,
  } = ctx

  return {
  async sendToTimeline(nodeId) {
    // Append at end-of-content on the first (lowest-order) matching-type
    // track — today's familiar behavior; placing at a specific time is the
    // drag-onto-a-track path (addClipToTimelineAt).
    const session = activeSession()
    const node = get().nodes.find((n) => n.id === nodeId)
    if (!session || !node) return
    if (node.data.mediaType === 'image') return
    if (node.data.status !== 'ready') return
    const trackType: TrackType = node.data.mediaType === 'audio' ? 'audio' : 'video'
    const track = session.timeline.tracks
      .filter((t) => t.type === trackType && !t.locked)
      .sort((a, b) => a.order - b.order)[0]
    if (!track) return
    await get().addClipToTimelineAt(nodeId, track.id, trackEnd(session.timeline.clips, track.id))
  },

  async addClipToTimelineAt(nodeId, trackId, startTime) {
    const node = get().nodes.find((n) => n.id === nodeId)
    const session = activeSession()
    if (!node || !session) return
    if (node.data.status !== 'ready') return
    const track = session.timeline.tracks.find((t) => t.id === trackId)
    if (!track || track.locked) return
    // No silent type conversion: audio ↔ audio tracks, video/image ↔ video.
    const clipTrackType: TrackType = node.data.mediaType === 'audio' ? 'audio' : 'video'
    if (track.type !== clipTrackType) return

    const sourceDuration =
      node.data.src && node.data.mediaType !== 'image'
        ? await probeDuration(node.data.src, node.data.mediaType)
        : 0
    // Seed the clip's trim from the node's Play-view trim (what you saw in
    // Play is what lands) — independently editable after that.
    const trimIn = node.data.trimIn ?? 0
    const trimOut =
      node.data.trimOut ?? (sourceDuration > 0 ? sourceDuration : trimIn + DEFAULT_CLIP_SEC)

    // The active session may have changed while probing metadata — re-check.
    const current = activeSession()
    if (!current || current.id !== session.id) return
    const clip: TimelineClip = {
      id: nextId('clip'),
      nodeId,
      trackId,
      startTime: Math.max(0, startTime),
      trimIn,
      trimOut,
      sourceDuration,
      label: node.data.label,
      mediaType: node.data.mediaType,
      swatch: node.data.swatch
    }
    updateSession(current.id, {
      timeline: {
        ...current.timeline,
        clips: rippleTrack([...current.timeline.clips, clip], trackId)
      }
    })
    patchNodeData(nodeId, { sentToTimeline: true })
  },

  moveTimelineClip(clipId, trackId, startTime) {
    // Live position update during a drag — raw, no ripple; the drop commits
    // via commitClipPosition so mid-drag states don't cascade shifts.
    const session = activeSession()
    if (!session) return
    const clip = session.timeline.clips.find((c) => c.id === clipId)
    const track = session.timeline.tracks.find((t) => t.id === trackId)
    const fromTrack = session.timeline.tracks.find((t) => t.id === clip?.trackId)
    if (!clip || !track || fromTrack?.locked || track.locked) return
    if (track.type !== fromTrack?.type) return
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        clips: session.timeline.clips.map((c) =>
          c.id === clipId ? { ...c, trackId, startTime: Math.max(0, startTime) } : c
        )
      }
    })
  },

  commitClipPosition(clipId) {
    const session = activeSession()
    if (!session) return
    const clip = session.timeline.clips.find((c) => c.id === clipId)
    if (!clip) return
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        clips: rippleTrack(session.timeline.clips, clip.trackId)
      }
    })
  },

  retrimTimelineClip(clipId, trimIn, trimOut) {
    const session = activeSession()
    if (!session) return
    const clip = session.timeline.clips.find((c) => c.id === clipId)
    const track = session.timeline.tracks.find((t) => t.id === clip?.trackId)
    if (!clip || track?.locked) return
    const maxOut = clip.sourceDuration > 0 ? clip.sourceDuration : Number.POSITIVE_INFINITY
    const nextIn = Math.max(0, Math.min(trimIn, trimOut - 0.1))
    const nextOut = Math.min(maxOut, Math.max(trimOut, nextIn + 0.1))
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        clips: session.timeline.clips.map((c) =>
          c.id === clipId ? { ...c, trimIn: nextIn, trimOut: nextOut } : c
        )
      }
    })
  },

  commitClipTrim(clipId) {
    // Extending a clip's right edge into its neighbor ripples the later
    // clips right — same rule as repositioning.
    get().commitClipPosition(clipId)
  },

  splitTimelineClip(clipId, atTime) {
    const session = activeSession()
    if (!session) return
    const clip = session.timeline.clips.find((c) => c.id === clipId)
    const track = session.timeline.tracks.find((t) => t.id === clip?.trackId)
    if (!clip || track?.locked) return
    const offset = atTime - clip.startTime
    if (offset <= 0.05 || offset >= clipDuration(clip) - 0.05) return
    const cutPoint = clip.trimIn + offset
    const right: TimelineClip = {
      ...clip,
      id: nextId('clip'),
      startTime: atTime,
      trimIn: cutPoint,
      label: `${clip.label}_b`
    }
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        clips: session.timeline.clips
          .map((c) => (c.id === clipId ? { ...c, trimOut: cutPoint } : c))
          .concat(right)
      }
    })
  },

  removeTimelineClip(clipId) {
    const session = activeSession()
    if (!session) return
    const clip = session.timeline.clips.find((c) => c.id === clipId)
    if (!clip) return
    const remaining = session.timeline.clips.filter((c) => c.id !== clipId)
    updateSession(session.id, {
      timeline: { ...session.timeline, clips: remaining }
    })
    // Only clear the node badge when its last timeline instance is gone.
    if (
      !remaining.some((c) => c.nodeId === clip.nodeId) &&
      get().nodes.some((n) => n.id === clip.nodeId)
    ) {
      patchNodeData(clip.nodeId, { sentToTimeline: false })
    }
  },

  patchTimelineClip(clipId, patch) {
    const session = activeSession()
    if (!session) return
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        clips: session.timeline.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))
      }
    })
  },

  addTrack(type) {
    const session = activeSession()
    if (!session) return null
    const sameType = session.timeline.tracks.filter((t) => t.type === type)
    const order = sameType.reduce((max, t) => Math.max(max, t.order), -1) + 1
    const name = `${type === 'video' ? 'Video' : 'Audio'} ${sameType.length + 1}`
    const id = nextId('track')
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        tracks: [
          ...session.timeline.tracks,
          { id, type, name, muted: false, soloed: false, locked: false, order }
        ]
      }
    })
    return id
  },

  removeTrack(trackId) {
    // Removes the track's clips from the timeline, never their source nodes.
    const session = activeSession()
    if (!session) return
    const orphaned = session.timeline.clips.filter((c) => c.trackId === trackId)
    const remaining = session.timeline.clips.filter((c) => c.trackId !== trackId)
    updateSession(session.id, {
      timeline: {
        tracks: session.timeline.tracks.filter((t) => t.id !== trackId),
        clips: remaining
      }
    })
    for (const clip of orphaned) {
      if (
        !remaining.some((c) => c.nodeId === clip.nodeId) &&
        get().nodes.some((n) => n.id === clip.nodeId)
      ) {
        patchNodeData(clip.nodeId, { sentToTimeline: false })
      }
    }
    if (get().selectedTrackId === trackId) set({ selectedTrackId: null })
  },

  toggleTrackFlag(trackId, flag) {
    const session = activeSession()
    if (!session) return
    updateSession(session.id, {
      timeline: {
        ...session.timeline,
        tracks: session.timeline.tracks.map((t) =>
          t.id === trackId ? { ...t, [flag]: !t[flag] } : t
        )
      }
    })
  },

  selectTrack(trackId) {
    set({ selectedTrackId: trackId })
  },

  async exportTimeline() {
    const session = activeSession()
    if (!session) return null
    const orderedTracks = session.timeline.tracks.slice().sort((a, b) => a.order - b.order)
    // Solo is intentionally dropped here — TimelineExportSpec carries no solo
    // field, so export honors mute alone (docs/ui/timeline.md's rule).
    const tracks = orderedTracks.map((t) => ({ type: t.type, muted: t.muted, order: t.order }))
    const trackIndex = new Map(orderedTracks.map((t, i) => [t.id, i] as const))
    // Resolve each clip to its live node for the real media source and the
    // node-level audio mute set in Play view.
    const clips: ExportClip[] = []
    for (const clip of session.timeline.clips) {
      const node = get().nodes.find((n) => n.id === clip.nodeId)
      if (!node?.data.src) continue
      const index = trackIndex.get(clip.trackId)
      if (index === undefined) continue
      clips.push({
        src: node.data.src,
        mediaType: clip.mediaType,
        trackIndex: index,
        startTime: clip.startTime,
        trimIn: clip.trimIn,
        trimOut: clip.trimOut,
        audioMuted: node.data.audioMuted,
        transform: clip.transform
      })
    }
    if (clips.length === 0) {
      return {
        ok: false,
        error: 'No exportable clips — the timeline needs clips whose nodes have real media.'
      }
    }
    return bridge.cutRoom.export({ tracks, clips })
  },
  }
}
