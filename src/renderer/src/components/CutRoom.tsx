import { useState } from 'react'
import { useActiveSession, useStudio } from '../store'

type ExportState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; outPath: string }
  | { status: 'error'; message: string }

export function CutRoom(): React.JSX.Element {
  const session = useActiveSession()
  const removeClip = useStudio((s) => s.removeClip)
  const moveClip = useStudio((s) => s.moveClip)
  const exportTimeline = useStudio((s) => s.exportTimeline)
  const nodes = useStudio((s) => s.nodes)
  const clips = session?.cutRoom ?? []

  const [exp, setExp] = useState<ExportState>({ status: 'idle' })

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

  return (
    <div className="cutroom">
      <div className="head">
        <span className="cut-title">Cut room — timeline</span>
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
      <div className="clips">
        {clips.map((clip, i) => {
          const node = nodes.find((n) => n.id === clip.nodeId)
          const trimmed = node?.data.trimIn != null || node?.data.trimOut != null
          const muted = node?.data.audioMuted === true
          return (
            <div key={clip.id} className={`cut-clip sw${clip.swatch}`}>
              <div className="cut-reorder">
                <button
                  className="cut-move"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() => moveClip(clip.id, -1)}
                >
                  ◀
                </button>
                <button
                  className="cut-move"
                  title="Move later"
                  disabled={i === clips.length - 1}
                  onClick={() => moveClip(clip.id, 1)}
                >
                  ▶
                </button>
              </div>
              <span className="cut-label">
                {clip.mediaType === 'audio' ? '♪ ' : ''}
                {clip.label}
              </span>
              <span className="cut-flags">
                {trimmed && <span title="Trimmed">✂</span>}
                {muted && <span title="Audio muted">🔇</span>}
              </span>
              <button className="remove" title="Remove from timeline" onClick={() => removeClip(clip.id)}>
                ✕
              </button>
            </div>
          )
        })}
        <div className="cut-clip drop-hint">
          {clips.length === 0
            ? 'Send video or audio nodes here, then Export to concat them with ffmpeg'
            : '+ Send more clips'}
        </div>
      </div>
    </div>
  )
}
