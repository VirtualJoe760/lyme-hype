import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineClip, TimelineTrack } from '@shared/types'
import type { MediaFlowNode } from '../store'
import { probeDuration, useActiveSession, useStudio } from '../store'
import { Waveform } from './MediaNode'

type ExportState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; outPath: string }
  | { status: 'error'; message: string }

const TRACK_HEAD_W = 118
const TRACK_ROW_H = 46
const RULER_H = 22
const SNAP_TOLERANCE_PX = 8
const MIN_PPS = 4
const MAX_PPS = 400

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

function clipDur(clip: TimelineClip): number {
  return Math.max(0.05, clip.trimOut - clip.trimIn)
}

/** Ruler tick spacing that keeps labels ≥ ~55px apart at the current zoom. */
function tickStep(pps: number): number {
  for (const step of [0.5, 1, 2, 5, 10, 30, 60, 120]) {
    if (step * pps >= 55) return step
  }
  return 300
}

/** Display order: video tracks top (higher order above, NLE-style), audio below. */
function displayTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  const video = tracks.filter((t) => t.type === 'video').sort((a, b) => b.order - a.order)
  const audio = tracks.filter((t) => t.type === 'audio').sort((a, b) => a.order - b.order)
  return [...video, ...audio]
}

/** Preview audibility/visibility: mute always wins; when anything is soloed,
 *  only soloed tracks stay live. Preview-only — export never sees solo. */
function trackLive(track: TimelineTrack, tracks: TimelineTrack[]): boolean {
  if (track.muted) return false
  const anySolo = tracks.some((t) => t.soloed)
  return !anySolo || track.soloed
}

export function CutRoom(): React.JSX.Element {
  const session = useActiveSession()
  const nodes = useStudio((s) => s.nodes)
  const collapsed = useStudio((s) => s.timelineCollapsed)
  const height = useStudio((s) => s.timelineHeight)
  const toggleTimeline = useStudio((s) => s.toggleTimeline)
  const selectedTrackId = useStudio((s) => s.selectedTrackId)
  const selectTrack = useStudio((s) => s.selectTrack)
  const addTrack = useStudio((s) => s.addTrack)
  const removeTrack = useStudio((s) => s.removeTrack)
  const toggleTrackFlag = useStudio((s) => s.toggleTrackFlag)
  const addClipToTimelineAt = useStudio((s) => s.addClipToTimelineAt)
  const moveTimelineClip = useStudio((s) => s.moveTimelineClip)
  const commitClipPosition = useStudio((s) => s.commitClipPosition)
  const commitClipTrim = useStudio((s) => s.commitClipTrim)
  const patchTimelineClip = useStudio((s) => s.patchTimelineClip)
  const splitTimelineClip = useStudio((s) => s.splitTimelineClip)
  const removeTimelineClip = useStudio((s) => s.removeTimelineClip)
  const exportTimeline = useStudio((s) => s.exportTimeline)

  const timeline = session?.timeline
  const tracks = useMemo(() => displayTracks(timeline?.tracks ?? []), [timeline?.tracks])
  const clips = timeline?.clips ?? []

  const [exp, setExp] = useState<ExportState>({ status: 'idle' })
  const [pps, setPps] = useState(40)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [magnet, setMagnet] = useState(true)
  const [razor, setRazor] = useState(false)
  const [dragClipId, setDragClipId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const mediaRefs = useRef(new Map<string, HTMLVideoElement | HTMLAudioElement>())
  const probing = useRef(new Set<string>())

  const totalEnd = clips.reduce((max, c) => Math.max(max, c.startTime + clipDur(c)), 0)
  const contentSeconds = Math.max(totalEnd + 8, 30)
  const contentW = TRACK_HEAD_W + contentSeconds * pps

  const nodeFor = (clip: TimelineClip): MediaFlowNode | undefined =>
    nodes.find((n) => n.id === clip.nodeId)

  // Lazily probe migrated/unknown source durations, then clamp provisional trims.
  useEffect(() => {
    for (const clip of clips) {
      if (clip.sourceDuration > 0 || clip.mediaType === 'image') continue
      if (probing.current.has(clip.id)) continue
      const node = nodeFor(clip)
      if (!node?.data.src) continue
      probing.current.add(clip.id)
      void probeDuration(node.data.src, clip.mediaType).then((d) => {
        if (d > 0) {
          patchTimelineClip(clip.id, {
            sourceDuration: d,
            trimOut: Math.min(clip.trimOut, d)
          })
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips])

  // Transport: advance the playhead on wall-clock while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      setPlayhead((t) => {
        const next = t + dt
        if (next >= totalEnd) {
          setPlaying(false)
          return totalEnd
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, totalEnd])

  // Active clip per track at the playhead, for the composited monitor.
  const activeByTrack = useMemo(() => {
    const map = new Map<string, TimelineClip>()
    for (const clip of clips) {
      if (playhead >= clip.startTime && playhead < clip.startTime + clipDur(clip)) {
        map.set(clip.trackId, clip)
      }
    }
    return map
  }, [clips, playhead])

  // Monitor stack: video tracks ascending order (base first = bottom layer).
  const monitorVideo = (timeline?.tracks ?? [])
    .filter((t) => t.type === 'video' && trackLive(t, timeline?.tracks ?? []))
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ track: t, clip: activeByTrack.get(t.id) }))
    .filter((x): x is { track: TimelineTrack; clip: TimelineClip } => !!x.clip)
  const monitorAudio = (timeline?.tracks ?? [])
    .filter((t) => t.type === 'audio' && trackLive(t, timeline?.tracks ?? []))
    .map((t) => ({ track: t, clip: activeByTrack.get(t.id) }))
    .filter((x): x is { track: TimelineTrack; clip: TimelineClip } => !!x.clip)

  // Keep mounted media elements in sync with the playhead.
  useEffect(() => {
    const syncTargets = [...monitorVideo, ...monitorAudio]
    for (const { clip } of syncTargets) {
      const el = mediaRefs.current.get(clip.id)
      if (!el) continue
      const target = clip.trimIn + (playhead - clip.startTime)
      if (playing) {
        if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target
        if (el.paused) void el.play().catch(() => {})
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target
      }
    }
  })

  if (!session || !timeline) return <div className="cutroom collapsed" />

  function timeAtClientX(clientX: number): number {
    const scroll = scrollRef.current
    if (!scroll) return 0
    const rect = scroll.getBoundingClientRect()
    const x = clientX - rect.left + scroll.scrollLeft - TRACK_HEAD_W
    return Math.max(0, x / pps)
  }

  function snapTime(t: number, excludeClipId?: string): number {
    if (!magnet) return Math.max(0, t)
    const tolerance = SNAP_TOLERANCE_PX / pps
    const candidates: number[] = [0, playhead, Math.round(t)]
    for (const c of clips) {
      if (c.id === excludeClipId) continue
      candidates.push(c.startTime, c.startTime + clipDur(c))
    }
    let best = t
    let bestDist = tolerance
    for (const c of candidates) {
      const d = Math.abs(c - t)
      if (d < bestDist) {
        best = c
        bestDist = d
      }
    }
    return Math.max(0, best)
  }

  function startRulerScrub(e: React.PointerEvent): void {
    e.preventDefault()
    const scrub = (clientX: number): void => setPlayhead(timeAtClientX(clientX))
    scrub(e.clientX)
    const move = (ev: PointerEvent): void => scrub(ev.clientX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onRulerWheel(e: React.WheelEvent): void {
    const anchor = timeAtClientX(e.clientX)
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
    const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * factor))
    setPps(next)
    // Keep the time under the cursor stationary while zooming.
    requestAnimationFrame(() => {
      const scroll = scrollRef.current
      if (!scroll) return
      const rect = scroll.getBoundingClientRect()
      scroll.scrollLeft = anchor * next - (e.clientX - rect.left - TRACK_HEAD_W)
    })
  }

  function fitToWindow(): void {
    const scroll = scrollRef.current
    if (!scroll || totalEnd <= 0) return
    const usable = scroll.clientWidth - TRACK_HEAD_W - 30
    setPps(Math.min(MAX_PPS, Math.max(MIN_PPS, usable / totalEnd)))
    scroll.scrollLeft = 0
  }

  function laneTrackAtClientY(clientY: number, type: TimelineTrack['type']): string | null {
    const rows = scrollRef.current?.querySelectorAll<HTMLElement>('[data-track-id]')
    if (!rows) return null
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom && row.dataset.trackType === type) {
        return row.dataset.trackId ?? null
      }
    }
    return null
  }

  function startClipDrag(e: React.PointerEvent, clip: TimelineClip, track: TimelineTrack): void {
    if (track.locked) return
    if (razor) {
      splitTimelineClip(clip.id, snapTime(timeAtClientX(e.clientX)))
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const grabOffset = timeAtClientX(e.clientX) - clip.startTime
    setDragClipId(clip.id)
    let currentTrackId = clip.trackId
    const move = (ev: PointerEvent): void => {
      const raw = timeAtClientX(ev.clientX) - grabOffset
      const snapped = snapTime(raw, clip.id)
      const overTrack = laneTrackAtClientY(ev.clientY, track.type)
      if (overTrack) currentTrackId = overTrack
      moveTimelineClip(clip.id, currentTrackId, snapped)
    }
    const up = (): void => {
      setDragClipId(null)
      commitClipPosition(clip.id)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startEdgeDrag(
    e: React.PointerEvent,
    clip: TimelineClip,
    track: TimelineTrack,
    edge: 'in' | 'out'
  ): void {
    if (track.locked) return
    e.preventDefault()
    e.stopPropagation()
    const orig = { ...clip }
    setDragClipId(clip.id)
    const move = (ev: PointerEvent): void => {
      const t = timeAtClientX(ev.clientX)
      if (edge === 'in') {
        // Left-edge trim keeps content anchored: start moves with the trim.
        const snappedStart = snapTime(t, clip.id)
        const delta = snappedStart - orig.startTime
        const maxDelta = clipDur(orig) - 0.1
        const clamped = Math.min(maxDelta, Math.max(-orig.trimIn, delta))
        patchTimelineClip(clip.id, {
          startTime: Math.max(0, orig.startTime + clamped),
          trimIn: orig.trimIn + clamped
        })
      } else {
        const snappedEnd = snapTime(t, clip.id)
        const newDur = Math.max(0.1, snappedEnd - orig.startTime)
        const maxOut = orig.sourceDuration > 0 ? orig.sourceDuration : Number.POSITIVE_INFINITY
        patchTimelineClip(clip.id, { trimOut: Math.min(maxOut, orig.trimIn + newDur) })
      }
    }
    const up = (): void => {
      setDragClipId(null)
      commitClipTrim(clip.id)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function splitAtPlayhead(): void {
    // The common-case shortcut of the razor: cut whatever sits under the
    // playhead on the active (selected) track.
    const trackId = selectedTrackId ?? tracks[0]?.id
    if (!trackId) return
    const clip = clips.find(
      (c) =>
        c.trackId === trackId &&
        playhead > c.startTime + 0.05 &&
        playhead < c.startTime + clipDur(c) - 0.05
    )
    if (clip) splitTimelineClip(clip.id, playhead)
  }

  async function handleExport(): Promise<void> {
    setExp({ status: 'running' })
    const result = await exportTimeline()
    if (!result) {
      setExp({ status: 'error', message: 'Export unavailable.' })
      return
    }
    if (result.canceled) {
      setExp({ status: 'idle' })
      return
    }
    if (result.ok && result.outPath) {
      setExp({ status: 'ok', outPath: result.outPath })
    } else {
      setExp({ status: 'error', message: result.error ?? 'Export failed.' })
    }
  }

  const step = tickStep(pps)
  const tickCount = Math.ceil(contentSeconds / step) + 1
  const playheadX = TRACK_HEAD_W + playhead * pps

  return (
    <div
      className={`cutroom${collapsed ? ' collapsed' : ''}`}
      style={collapsed ? undefined : { height }}
    >
      <div className="head">
        <button
          className="panel-btn"
          title={collapsed ? 'Expand timeline' : 'Collapse timeline'}
          onClick={toggleTimeline}
        >
          {collapsed ? '⌃' : '⌄'}
        </button>
        <span className="cut-title">Cut room — timeline</span>
        {!collapsed && (
          <>
            <button
              className="conn-mini"
              title={playing ? 'Pause' : 'Play from playhead'}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="tl-time">{fmtTime(playhead)}</span>
            <button
              className={`conn-mini${magnet ? ' tl-on' : ''}`}
              title={`Snapping ${magnet ? 'on' : 'off'} (playhead, clip edges, whole seconds)`}
              onClick={() => setMagnet(!magnet)}
            >
              🧲
            </button>
            <button
              className={`conn-mini${razor ? ' tl-on' : ''}`}
              title="Razor — click a clip to cut it at that point"
              onClick={() => setRazor(!razor)}
            >
              🪒
            </button>
            <button className="conn-mini" title="Split clip at playhead on the selected track" onClick={splitAtPlayhead}>
              ✂
            </button>
            <button className="conn-mini" title="Add video track" onClick={() => addTrack('video')}>
              +V
            </button>
            <button className="conn-mini" title="Add audio track" onClick={() => addTrack('audio')}>
              +A
            </button>
            <button className="conn-mini" title="Fit timeline to window" onClick={fitToWindow}>
              ⤢
            </button>
          </>
        )}
        <span className="cut-spacer" />
        {exp.status === 'ok' && <span className="cut-status ok" title={exp.outPath}>Exported ✓</span>}
        {exp.status === 'error' && (
          <span className="cut-status error" title={exp.message}>
            Export failed
          </span>
        )}
        <button
          className="conn-mini primary-mini"
          disabled={clips.length === 0 || exp.status === 'running'}
          onClick={() => void handleExport()}
        >
          {exp.status === 'running' ? 'Exporting…' : '⬇ Export mp4'}
        </button>
      </div>

      {!collapsed && (
        <div className="tl-body">
          <div className="tl-monitor">
            {monitorVideo.length === 0 && <span className="tl-monitor-idle">▶</span>}
            {monitorVideo.map(({ clip }) => {
              const node = nodeFor(clip)
              if (!node?.data.src) return null
              return clip.mediaType === 'image' ? (
                <img key={clip.id} className="tl-monitor-layer" src={node.data.src} alt="" />
              ) : (
                <video
                  key={clip.id}
                  className="tl-monitor-layer"
                  src={node.data.src}
                  muted={node.data.audioMuted === true}
                  preload="auto"
                  ref={(el) => {
                    if (el) mediaRefs.current.set(clip.id, el)
                    else mediaRefs.current.delete(clip.id)
                  }}
                />
              )
            })}
            {monitorAudio.map(({ clip }) => {
              const node = nodeFor(clip)
              if (!node?.data.src) return null
              return (
                <audio
                  key={clip.id}
                  src={node.data.src}
                  preload="auto"
                  ref={(el) => {
                    if (el) mediaRefs.current.set(clip.id, el)
                    else mediaRefs.current.delete(clip.id)
                  }}
                />
              )
            })}
          </div>

          <div className="tl-scroll" ref={scrollRef}>
            <div className="tl-content" style={{ width: contentW }}>
              <div className="tl-ruler-row" style={{ height: RULER_H }}>
                <div className="tl-corner" style={{ width: TRACK_HEAD_W }} />
                <div
                  className="tl-ruler"
                  onPointerDown={startRulerScrub}
                  onWheel={onRulerWheel}
                >
                  {Array.from({ length: tickCount }, (_, i) => {
                    const t = i * step
                    return (
                      <span key={i} className="tl-tick" style={{ left: t * pps }}>
                        {fmtTime(t)}
                      </span>
                    )
                  })}
                </div>
              </div>

              {tracks.map((track) => {
                const live = trackLive(track, timeline.tracks)
                return (
                  <div
                    key={track.id}
                    className={`tl-track-row${selectedTrackId === track.id ? ' selected' : ''}`}
                    style={{ height: TRACK_ROW_H }}
                    data-track-id={track.id}
                    data-track-type={track.type}
                  >
                    <div
                      className={`tl-track-head${track.muted ? ' muted' : ''}`}
                      style={{ width: TRACK_HEAD_W }}
                      onClick={() => selectTrack(track.id)}
                    >
                      <span className="tl-track-name" title={track.name}>
                        {track.type === 'video' ? '▶' : '♪'} {track.name}
                      </span>
                      <span className="tl-track-btns">
                        <button
                          className={`tl-flag${track.muted ? ' on' : ''}`}
                          title="Mute — silences/hides this track in preview AND export"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleTrackFlag(track.id, 'muted')
                          }}
                        >
                          M
                        </button>
                        <button
                          className={`tl-flag${track.soloed ? ' on solo' : ''}`}
                          title="Solo — preview-only monitoring; never affects export"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleTrackFlag(track.id, 'soloed')
                          }}
                        >
                          S
                        </button>
                        <button
                          className={`tl-flag${track.locked ? ' on' : ''}`}
                          title="Lock — prevents edits to this track's clips"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleTrackFlag(track.id, 'locked')
                          }}
                        >
                          L
                        </button>
                        <button
                          className="tl-flag tl-del"
                          title="Remove track (clips come off the timeline; source nodes are untouched)"
                          onClick={(e) => {
                            e.stopPropagation()
                            const clipCount = clips.filter((c) => c.trackId === track.id).length
                            if (
                              clipCount === 0 ||
                              window.confirm(`Remove ${track.name} and its ${clipCount} clip(s) from the timeline?`)
                            ) {
                              removeTrack(track.id)
                            }
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                    <div
                      className={`tl-lane${live ? '' : ' dimmed'}${razor ? ' razor' : ''}`}
                      onPointerDown={(e) => {
                        if (e.target === e.currentTarget) {
                          selectTrack(track.id)
                          setPlayhead(timeAtClientX(e.clientX))
                        }
                      }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('application/lyme-node')) {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'copy'
                        }
                      }}
                      onDrop={(e) => {
                        const nodeId = e.dataTransfer.getData('application/lyme-node')
                        if (!nodeId) return
                        e.preventDefault()
                        void addClipToTimelineAt(nodeId, track.id, snapTime(timeAtClientX(e.clientX)))
                      }}
                    >
                      {clips
                        .filter((c) => c.trackId === track.id)
                        .map((clip) => {
                          const node = nodeFor(clip)
                          const width = clipDur(clip) * pps
                          return (
                            <div
                              key={clip.id}
                              className={`tl-clip sw${clip.swatch}${dragClipId === clip.id ? ' dragging' : ''}${track.locked ? ' locked' : ''}`}
                              style={{ left: clip.startTime * pps, width }}
                              onPointerDown={(e) => startClipDrag(e, clip, track)}
                            >
                              {clip.mediaType === 'audio' ? (
                                <span className="tl-clip-wave">
                                  <Waveform />
                                </span>
                              ) : node?.data.src ? (
                                clip.mediaType === 'image' ? (
                                  <img className="tl-clip-poster" src={node.data.src} alt="" draggable={false} />
                                ) : (
                                  <video className="tl-clip-poster" src={node.data.src} preload="metadata" muted />
                                )
                              ) : null}
                              <span className="tl-clip-label">{clip.label}</span>
                              <button
                                className="tl-clip-remove"
                                title="Remove from timeline"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeTimelineClip(clip.id)
                                }}
                              >
                                ✕
                              </button>
                              {!track.locked && !razor && (
                                <>
                                  <span
                                    className="tl-clip-edge in"
                                    onPointerDown={(e) => startEdgeDrag(e, clip, track, 'in')}
                                  />
                                  <span
                                    className="tl-clip-edge out"
                                    onPointerDown={(e) => startEdgeDrag(e, clip, track, 'out')}
                                  />
                                </>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )
              })}

              {clips.length === 0 && (
                <div className="tl-empty" style={{ left: TRACK_HEAD_W + 14 }}>
                  Drag a node's ⣿ grip onto a track (or use its → button) to place clips in time.
                </div>
              )}

              <div className="tl-playhead" style={{ left: playheadX, top: 0 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
