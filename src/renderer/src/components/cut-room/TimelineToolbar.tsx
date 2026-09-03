/** The Cut Room's header row: transport, snapping, razor, track adds, export. */

import { DEFAULT_TRANSFORM, type ClipFit, type ClipTransform } from '@shared/types'
import { fmtTime } from './helpers'
import type { MonitorZoom } from './TimelineMonitor'

/** Premiere's program-monitor zoom menu, as fractions of real output pixels. */
export const ZOOM_PRESETS: { label: string; value: MonitorZoom }[] = [
  { label: 'Fit', value: 'fit' },
  { label: '⅛', value: 0.125 },
  { label: '¼', value: 0.25 },
  { label: '⅓', value: 1 / 3 },
  { label: '½', value: 0.5 },
  { label: '100%', value: 1 }
]

export interface ToolbarProps {
  collapsed: boolean
  playing: boolean
  playhead: number
  magnet: boolean
  razor: boolean
  monitorAspect: '9:16' | '16:9'
  monitorZoom: MonitorZoom
  setMonitorZoom(value: MonitorZoom): void
  /** The selected clip's fit, or null when nothing is selected. */
  clipTransform: ClipTransform | null
  setClipTransform(patch: Partial<ClipTransform>): void
  trackRowH: number
  clipCount: number
  exportStatus: 'idle' | 'running' | 'ok' | 'error'
  exportPath?: string
  exportMessage?: string
  toggleTimeline(): void
  setPlaying(value: boolean): void
  setMagnet(value: boolean): void
  setRazor(value: boolean): void
  setMonitorAspect(value: '9:16' | '16:9'): void
  setTrackRowH(px: number): void
  splitAtPlayhead(): void
  addTrack(type: 'video' | 'audio'): void
  fitToWindow(): void
  handleExport(): void
}

export function TimelineToolbar({
  collapsed,
  playing,
  playhead,
  magnet,
  razor,
  monitorAspect,
  monitorZoom,
  setMonitorZoom,
  clipTransform,
  setClipTransform,
  trackRowH,
  clipCount,
  exportStatus,
  exportPath,
  exportMessage,
  toggleTimeline,
  setPlaying,
  setMagnet,
  setRazor,
  setMonitorAspect,
  setTrackRowH,
  splitAtPlayhead,
  addTrack,
  fitToWindow,
  handleExport
}: ToolbarProps): React.JSX.Element {
  return (
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
        <button className="conn-mini" title="Fit timeline to window (\)" onClick={fitToWindow}>
          ⤢
        </button>
        <button
          className="conn-mini"
          title="Monitor aspect — toggle 9:16 / 16:9"
          onClick={() => setMonitorAspect(monitorAspect === '9:16' ? '16:9' : '9:16')}
        >
          {monitorAspect}
        </button>
        <select
          className="tl-zoom"
          title="Monitor zoom — fraction of the real output size"
          value={ZOOM_PRESETS.some((z) => z.value === monitorZoom) ? String(monitorZoom) : 'custom'}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fit') setMonitorZoom('fit')
            else if (v === 'custom') {
              const pct = window.prompt(
                'Monitor zoom (% of output size)',
                String(Math.round((monitorZoom === 'fit' ? 0.25 : monitorZoom) * 100))
              )
              const n = pct ? Number(pct) / 100 : NaN
              if (Number.isFinite(n) && n > 0.02 && n <= 4) setMonitorZoom(n)
            } else setMonitorZoom(Number(v))
          }}
        >
          {ZOOM_PRESETS.map((z) => (
            <option key={z.label} value={String(z.value)}>
              {z.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {clipTransform && (
          <span className="tl-fit" title="How the selected clip sits in the frame">
            {(['contain', 'cover', 'custom'] as ClipFit[]).map((fit) => (
              <button
                key={fit}
                className={`conn-mini${clipTransform.fit === fit ? ' tl-on' : ''}`}
                onClick={() => setClipTransform({ fit })}
              >
                {fit === 'contain' ? 'Letterbox' : fit === 'cover' ? 'Fill frame' : 'Custom'}
              </button>
            ))}
            {clipTransform.fit === 'custom' && (
              <>
                <label>
                  scale
                  <input type="number" step="0.05" min="0.1" max="4" value={clipTransform.scale} onChange={(e) => setClipTransform({ scale: Number(e.target.value) || 1 })} />
                </label>
                <label>
                  x%
                  <input type="number" step="1" min="-100" max="100" value={clipTransform.offsetX} onChange={(e) => setClipTransform({ offsetX: Number(e.target.value) || 0 })} />
                </label>
                <label>
                  y%
                  <input type="number" step="1" min="-100" max="100" value={clipTransform.offsetY} onChange={(e) => setClipTransform({ offsetY: Number(e.target.value) || 0 })} />
                </label>
                <button className="conn-mini" title="Back to the contain size, centered" onClick={() => setClipTransform({ ...DEFAULT_TRANSFORM, fit: 'custom' })}>
                  reset
                </button>
              </>
            )}
          </span>
        )}
        <input
          className="tl-height-slider"
          type="range"
          min={28}
          max={96}
          value={trackRowH}
          title="Track height"
          onChange={(e) => setTrackRowH(parseInt(e.target.value, 10))}
        />
      </>
    )}
    <span className="cut-spacer" />
    {exportStatus === 'ok' && <span className="cut-status ok" title={exportPath}>Exported ✓</span>}
    {exportStatus === 'error' && (
      <span className="cut-status error" title={exportMessage}>
        Export failed
      </span>
    )}
    <button
      className="conn-mini primary-mini"
      disabled={clipCount === 0 || exportStatus === 'running'}
      onClick={handleExport}
    >
      {exportStatus === 'running' ? 'Exporting…' : '⬇ Export mp4'}
    </button>
  </div>
  )
}
