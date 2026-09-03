/**
 * Pure helpers the store leans on — no `set`/`get`, no closure state, so they
 * are testable on their own and do not belong inside the create() body.
 */

import type {
  CanvasNodeState,
  CombineLocalKind,
  MediaType,
  Session,
  TimelineClip,
  TimelineState
} from '@shared/types'
import { nextId } from './types'
import type { MediaFlowNode } from './types'

export function toFlowNode(state: CanvasNodeState): MediaFlowNode {
  // Explicit width always: the wrapper needs a real width for the node's inner
  // 100%-width layout, and the resize handle writes back through it.
  return {
    id: state.id,
    type: 'media',
    position: state.position,
    data: state.data,
    width: state.width ?? 104
  }
}

export function toNodeState(node: MediaFlowNode): CanvasNodeState {
  return { id: node.id, position: node.position, data: node.data, width: node.width }
}

export function pickSwatch(): number {
  return 1 + Math.floor(Math.random() * 6)
}

/** Combine dialog's four ffmpeg-only pairs (video+video, image+video,
 *  audio+video, audio+audio) — deterministic filter graphs, no agent
 *  judgment needed, unlike image+image/audio+image which route through
 *  generateMedia instead. Returns null for the two generative pairs (handled
 *  earlier in confirmCombine) or if either node has no src yet. */
export function localCombineFor(
  source: MediaFlowNode,
  target: MediaFlowNode
): { kind: CombineLocalKind; aUrl: string; bUrl: string } | null {
  if (!source.data.src || !target.data.src) return null
  const pair = [source.data.mediaType, target.data.mediaType].sort().join('+')
  switch (pair) {
    case 'video+video':
      return { kind: 'stitch-video', aUrl: source.data.src, bUrl: target.data.src }
    case 'image+video': {
      const video = source.data.mediaType === 'video' ? source : target
      const image = source.data.mediaType === 'image' ? source : target
      return { kind: 'overlay-image', aUrl: video.data.src!, bUrl: image.data.src! }
    }
    case 'audio+video': {
      const video = source.data.mediaType === 'video' ? source : target
      const audio = source.data.mediaType === 'audio' ? source : target
      return { kind: 'score-video', aUrl: video.data.src!, bUrl: audio.data.src! }
    }
    case 'audio+audio':
      return { kind: 'mix-audio', aUrl: source.data.src, bUrl: target.data.src }
    default:
      return null
  }
}

/** Stub-generation latency so the Rendering… state is visible (real jobs land in Phase 4). */
export const STUB_RENDER_MS = 2500

/** Placed length for clips whose source duration isn't known yet (images, or
 *  legacy-migrated clips before their lazy metadata probe lands). */
export const DEFAULT_CLIP_SEC = 5

/** The default starting layout (docs/ui/timeline.md): a narrated reel with a
 *  music bed and an occasional overlay, without an empty timeline being
 *  intimidating. Tracks stay dynamic beyond this. */
export function defaultTimeline(): TimelineState {
  return {
    tracks: [
      { id: nextId('track'), type: 'video', name: 'Video 1', muted: false, soloed: false, locked: false, order: 0 },
      { id: nextId('track'), type: 'video', name: 'Video 2', muted: false, soloed: false, locked: false, order: 1 },
      { id: nextId('track'), type: 'audio', name: 'Audio 1', muted: false, soloed: false, locked: false, order: 0 },
      { id: nextId('track'), type: 'audio', name: 'Audio 2', muted: false, soloed: false, locked: false, order: 1 }
    ],
    clips: []
  }
}

/** Reads a media file's duration off a detached element — the timeline needs
 *  concrete trim bounds, and nodes don't store duration. Resolves 0 on failure
 *  (caller falls back to DEFAULT_CLIP_SEC). */
export function probeDuration(src: string, mediaType: MediaType): Promise<number> {
  if (mediaType === 'image') return Promise.resolve(0)
  return new Promise((resolve) => {
    const el = document.createElement(mediaType === 'video' ? 'video' : 'audio')
    const done = (value: number): void => {
      el.removeAttribute('src')
      resolve(value)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => done(0)
    el.src = src
  })
}

export function clipDuration(clip: TimelineClip): number {
  return Math.max(0.05, clip.trimOut - clip.trimIn)
}

/**
 * Ripple overlap resolution for one track (docs/ui/timeline.md: ripple, not
 * overwrite): clips sorted by start; any clip overlapping the one before it
 * shifts right to its end. Gaps are untouched — position stays free.
 */
export function rippleTrack(clips: TimelineClip[], trackId: string): TimelineClip[] {
  const onTrack = clips
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startTime - b.startTime)
  const shifted = new Map<string, number>()
  let prevEnd = -Infinity
  for (const clip of onTrack) {
    const start = Math.max(clip.startTime, prevEnd === -Infinity ? clip.startTime : prevEnd)
    if (start !== clip.startTime) shifted.set(clip.id, start)
    prevEnd = start + clipDuration(clip)
  }
  if (shifted.size === 0) return clips
  return clips.map((c) => (shifted.has(c.id) ? { ...c, startTime: shifted.get(c.id)! } : c))
}

/** End-of-content on one track — where an appended clip lands. */
export function trackEnd(clips: TimelineClip[], trackId: string): number {
  return clips
    .filter((c) => c.trackId === trackId)
    .reduce((max, c) => Math.max(max, c.startTime + clipDuration(c)), 0)
}

/** Migrates a legacy single-track cutRoom array into the multitrack shape:
 *  video clips laid back-to-back on Video 1, audio on Audio 1. Durations are
 *  provisional until the lazy metadata probe patches them. */
export function migrateSession(session: Session): Session {
  if (session.timeline && session.timeline.tracks.length > 0) return session
  const timeline = defaultTimeline()
  const videoTrack = timeline.tracks.find((t) => t.type === 'video')!
  const audioTrack = timeline.tracks.find((t) => t.type === 'audio')!
  for (const legacy of session.cutRoom ?? []) {
    const node = session.nodes.find((n) => n.id === legacy.nodeId)
    const trimIn = node?.data.trimIn ?? 0
    const trimOut = node?.data.trimOut ?? 0
    const track = legacy.mediaType === 'audio' ? audioTrack : videoTrack
    const duration = trimOut > trimIn ? trimOut - trimIn : DEFAULT_CLIP_SEC
    timeline.clips.push({
      id: legacy.id,
      nodeId: legacy.nodeId,
      trackId: track.id,
      startTime: trackEnd(timeline.clips, track.id),
      trimIn,
      trimOut: trimIn + duration,
      sourceDuration: 0,
      label: legacy.label,
      mediaType: legacy.mediaType,
      swatch: legacy.swatch
    })
  }
  const { cutRoom: _legacy, ...rest } = session
  return { ...rest, timeline }
}

/** Panel size defaults + clamps (docs/ui/layout-and-panels.md). Timeline max is
 *  a viewport fraction, so it's resolved at drag time, not stored here. */
export const PANEL_SIZES = {
  rail: { default: 224, min: 160, max: 400 },
  aside: { default: 304, min: 220, max: 480 },
  timeline: { default: 132, min: 80, maxViewportFraction: 0.45 }
} as const

export function newSession(index: number): Session {
  return {
    id: nextId('session'),
    name: `R-${String(index).padStart(3, '0')} · Untitled`,
    createdAt: new Date().toISOString(),
    nodes: [],
    timeline: defaultTimeline(),
    view: 'canvas'
  }
}
