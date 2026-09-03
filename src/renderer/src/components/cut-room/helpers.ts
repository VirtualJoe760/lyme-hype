/** Cut Room geometry and formatting — pure, so the component keeps only render
 *  and interaction code. */

import { DEFAULT_TRANSFORM, type ClipTransform, type TimelineClip, type TimelineTrack } from '@shared/types'

export const TRACK_HEAD_W = 150
export const RULER_H = 22
export const HEAD_H = 38
export const SNAP_TOLERANCE_PX = 8
export const MIN_PPS = 4
export const MAX_PPS = 400
export const FRAME_SEC = 1 / 30

export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export function clipDur(clip: TimelineClip): number {
  return Math.max(0.05, clip.trimOut - clip.trimIn)
}

/** Ruler tick spacing that keeps labels ≥ ~55px apart at the current zoom. */
export function tickStep(pps: number): number {
  for (const step of [0.5, 1, 2, 5, 10, 30, 60, 120]) {
    if (step * pps >= 55) return step
  }
  return 300
}

/** Display order: video tracks top (higher order above, NLE-style), audio below. */
export function displayTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  const video = tracks.filter((t) => t.type === 'video').sort((a, b) => b.order - a.order)
  const audio = tracks.filter((t) => t.type === 'audio').sort((a, b) => a.order - b.order)
  return [...video, ...audio]
}

/** Preview audibility/visibility: mute always wins; when anything is soloed,
 *  only soloed tracks stay live. Preview-only — export never sees solo. */
export function trackLive(track: TimelineTrack, tracks: TimelineTrack[]): boolean {
  if (track.muted) return false
  const anySolo = tracks.some((t) => t.soloed)
  return !anySolo || track.soloed
}


/** The top-most video clip under the playhead — what a double-click on the
 *  monitor opens large. Images are not Play-eligible, so they are skipped. */
export function topVideoClip(monitorVideo: { clip: TimelineClip }[]): TimelineClip | null {
  for (let i = monitorVideo.length - 1; i >= 0; i--) {
    if (monitorVideo[i].clip.mediaType === 'video') return monitorVideo[i].clip
  }
  return null
}

/** A clip's transform with defaults filled, then the patch applied. */
export function mergedTransform(clip: TimelineClip | null, patch: Partial<ClipTransform> = {}): ClipTransform {
  return { ...DEFAULT_TRANSFORM, ...(clip?.transform ?? {}), ...patch }
}
