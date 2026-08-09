import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudio } from '../store'

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PlayView(): React.JSX.Element | null {
  const playNodeId = useStudio((s) => s.playNodeId)
  const playFrom = useStudio((s) => s.playFrom)
  const node = useStudio((s) => s.nodes.find((n) => n.id === s.playNodeId) ?? null)
  const closePlay = useStudio((s) => s.closePlay)
  const setTrim = useStudio((s) => s.setTrim)
  const splitAtPlayhead = useStudio((s) => s.splitAtPlayhead)
  const detachAudio = useStudio((s) => s.detachAudio)
  const deleteAudio = useStudio((s) => s.deleteAudio)
  const sendToTimeline = useStudio((s) => s.sendToTimeline)

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null)

  const trimIn = node?.data.trimIn ?? 0
  const trimOut = node?.data.trimOut ?? duration

  const onLoaded = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    setDuration(el.duration)
    if (el.currentTime < trimIn) el.currentTime = trimIn
  }, [trimIn])

  // Clamp playback to the in/out window: loop back to in when out is reached.
  const onTimeUpdate = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    const out = node?.data.trimOut ?? el.duration
    if (el.currentTime >= out) {
      el.currentTime = node?.data.trimIn ?? 0
      if (!el.paused) void el.play()
    }
    setCurrent(el.currentTime)
  }, [node?.data.trimIn, node?.data.trimOut])

  useEffect(() => {
    // Reset transport when the reviewed node changes.
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
  }, [playNodeId])

  if (!node || !playNodeId) return null

  const isVideo = node.data.mediaType === 'video'
  const src = node.data.src
  const pct = (t: number): number => (duration > 0 ? (t / duration) * 100 : 0)

  function togglePlay(): void {
    const el = mediaRef.current
    if (!el) return
    if (el.paused) {
      if (el.currentTime < trimIn || el.currentTime >= trimOut) el.currentTime = trimIn
      void el.play()
      setPlaying(true)
    } else {
      el.pause()
      setPlaying(false)
    }
  }

  function seekFromClientX(clientX: number, track: HTMLElement): number {
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function onTrackClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (dragging) return
    const t = seekFromClientX(e.clientX, e.currentTarget)
    if (mediaRef.current) mediaRef.current.currentTime = t
    setCurrent(t)
  }

  function startHandleDrag(which: 'in' | 'out', track: HTMLElement): void {
    setDragging(which)
    const move = (ev: PointerEvent): void => {
      const t = seekFromClientX(ev.clientX, track)
      if (which === 'in') setTrim(node!.id, Math.min(t, trimOut - 0.1), trimOut)
      else setTrim(node!.id, trimIn, Math.max(t, trimIn + 0.1))
    }
    const up = (): void => {
      setDragging(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="play-view">
      <div className="play-header">
        <button className="play-back" onClick={closePlay}>
          ← Back to {playFrom === 'storyboard' ? 'Storyboard' : 'Canvas'}
        </button>
        <span className="play-title">{node.data.label}</span>
        <span className="play-header-spacer" />
        <button
          className="conn-mini primary-mini"
          onClick={() => {
            void sendToTimeline(node.id)
          }}
        >
          → Send to timeline
        </button>
      </div>

      <div className="play-stage">
        {src ? (
          isVideo ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              className="play-media"
              src={src}
              muted={node.data.audioMuted}
              onLoadedMetadata={onLoaded}
              onTimeUpdate={onTimeUpdate}
              onClick={togglePlay}
            />
          ) : (
            <div className="play-audio-stage">
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={src}
                onLoadedMetadata={onLoaded}
                onTimeUpdate={onTimeUpdate}
              />
              <div className="play-audio-glyph">♪ {node.data.label}</div>
            </div>
          )
        ) : (
          <div className="play-nomedia">
            No playable media on this node yet. Upload a file or generate one, then open it here.
          </div>
        )}

        {/* Overlaid control bar */}
        <div className="play-controls">
          <button className="play-btn" onClick={togglePlay}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="play-time">
            {fmt(current)} / {fmt(duration)}
          </span>
          <div className="play-track" onClick={onTrackClick}>
            <div className="play-track-trim" style={{ left: `${pct(trimIn)}%`, right: `${100 - pct(trimOut)}%` }} />
            <div className="play-track-playhead" style={{ left: `${pct(current)}%` }} />
            <div
              className="play-handle in"
              style={{ left: `${pct(trimIn)}%` }}
              onPointerDown={(e) => startHandleDrag('in', e.currentTarget.parentElement as HTMLElement)}
              title="Trim in"
            />
            <div
              className="play-handle out"
              style={{ left: `${pct(trimOut)}%` }}
              onPointerDown={(e) => startHandleDrag('out', e.currentTarget.parentElement as HTMLElement)}
              title="Trim out"
            />
          </div>
        </div>
      </div>

      <div className="play-actions">
        <span className="play-trim-readout">
          Trim {fmt(trimIn)} → {fmt(trimOut)} (non-destructive)
        </span>
        <span className="play-header-spacer" />
        <button
          className="conn-mini"
          onClick={() => splitAtPlayhead(node.id, current)}
          title="Split into two clips at the playhead"
        >
          ✂ Split at playhead
        </button>
        {isVideo && src && (
          <>
            <button className="conn-mini" onClick={() => detachAudio(node.id)} title="Detach audio as its own node">
              ⏏ Detach audio
            </button>
            <button
              className="conn-mini"
              onClick={() => {
                if (window.confirm('Delete this clip’s audio track? (mutes it — undo by re-importing)')) {
                  deleteAudio(node.id)
                }
              }}
              title="Delete (mute) the clip's audio"
            >
              ✕ Delete audio
            </button>
          </>
        )}
      </div>
    </div>
  )
}
