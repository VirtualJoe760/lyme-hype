import { useActiveSession, useStudio } from '../store'

export function CutRoom(): React.JSX.Element {
  const session = useActiveSession()
  const removeClip = useStudio((s) => s.removeClip)
  const clips = session?.cutRoom ?? []

  return (
    <div className="cutroom">
      <div className="head">Cut room — timeline</div>
      <div className="clips">
        {clips.map((clip) => (
          <div key={clip.id} className={`cut-clip sw${clip.swatch}`}>
            {clip.mediaType === 'audio' ? '♪ ' : ''}
            {clip.label}
            <button className="remove" title="Remove from timeline" onClick={() => removeClip(clip.id)}>
              ✕
            </button>
          </div>
        ))}
        <div className="cut-clip drop-hint">
          {clips.length === 0
            ? 'Send video or audio nodes here — real ffmpeg timeline lands in Phase 7'
            : '+ Drop clips'}
        </div>
      </div>
    </div>
  )
}
