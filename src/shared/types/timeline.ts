/** The multitrack Cut Room and its ffmpeg export spec. */

import type { MediaType } from './media'

/** Legacy single-track Cut Room clip (pre-multitrack). Only survives in old
 *  persisted sessions; migrated to TimelineClip on load. */
export interface CutClip {
  id: string
  nodeId: string
  label: string
  mediaType: MediaType
  swatch: number
}

export type TrackType = 'video' | 'audio'

export interface TimelineTrack {
  id: string
  type: TrackType
  name: string
  /** Real, persistent state: silences (audio) / hides from compositing (video)
   *  in BOTH live preview and export. */
  muted: boolean
  /** Monitoring convenience only — affects the live preview, NEVER export.
   *  The export payload type (TimelineExportSpec) deliberately has no solo
   *  field, so leaking it into an export is a compile error, not a bug. */
  soloed: boolean
  /** Prevents accidental edits to this track's clips. */
  locked: boolean
  /** Among same-type tracks. Lowest video order = compositing base. */
  order: number
}

/** A clip is a rectangle positioned in time, not a list entry. */
/** How a clip is fitted to the output frame (Premiere's Motion → Scale).
 *  contain = letterbox to fit (bars where the aspect differs) — the historical
 *  behaviour; cover = scale up until the frame is filled, cropping the overflow;
 *  custom = an explicit scale relative to the contain size, plus an offset. */
export type ClipFit = 'contain' | 'cover' | 'custom'

export interface ClipTransform {
  fit: ClipFit
  /** custom only: 1 = the contain size; 1.1 = 10% larger. */
  scale: number
  /** custom only: offset as a percentage of the frame's width / height. */
  offsetX: number
  offsetY: number
}

export const DEFAULT_TRANSFORM: ClipTransform = { fit: 'contain', scale: 1, offsetX: 0, offsetY: 0 }

export interface TimelineClip {
  id: string
  nodeId: string
  trackId: string
  /** Seconds from timeline zero. */
  startTime: number
  /** The timeline clip's OWN trim — seeded from the node's Play-view trim when
   *  added, independently editable after (the same asset can appear twice with
   *  two different cuts). */
  trimIn: number
  trimOut: number
  /** Source media duration for retrim clamping; 0 = not probed yet. */
  sourceDuration: number
  label: string
  mediaType: MediaType
  swatch: number
  /** Absent = contain (letterbox), which is what every clip did before this existed. */
  transform?: ClipTransform
}

export interface TimelineState {
  tracks: TimelineTrack[]
  clips: TimelineClip[]
}

/** A track as the export sees it. NOTE: no `soloed` here, on purpose — solo is
 *  a preview-only monitoring state and must never affect export (timeline.md).
 *  Keeping it out of the payload type makes that rule structural. */
export interface ExportTrack {
  type: TrackType
  muted: boolean
  order: number
}

/** One resolved clip handed to the ffmpeg export. */
export interface ExportClip {
  /** lyme-asset:// URL of the source media. */
  src: string
  mediaType: MediaType
  /** Index into TimelineExportSpec.tracks. */
  trackIndex: number
  startTime: number
  trimIn: number
  trimOut: number
  /** Video clip's own embedded audio silenced (Play view's audio delete). */
  audioMuted?: boolean
  /** Same fit the monitor shows — preview and export must agree. */
  transform?: ClipTransform
}

export interface TimelineExportSpec {
  tracks: ExportTrack[]
  clips: ExportClip[]
}

export interface CutExportResult {
  ok: boolean
  outPath?: string
  /** Set when the user cancels the save dialog — not an error. */
  canceled?: boolean
  /** ffmpeg not found on this machine (not bundled/configured yet). */
  ffmpegMissing?: boolean
  error?: string
}
