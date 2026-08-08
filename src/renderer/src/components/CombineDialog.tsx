import type { MediaType } from '@shared/types'
import { useStudio } from '../store'

function describeCombine(a: MediaType, b: MediaType): { title: string; blurb: string } {
  const pair = [a, b].sort().join('+')
  switch (pair) {
    case 'image+image':
      return {
        title: 'Merge stills',
        blurb: 'Two stills collide into one new frame — prompt how they should mix.'
      }
    case 'image+video':
      return {
        title: 'Composite overlay',
        blurb: 'The still is laid over the clip, design-onto-template style.'
      }
    case 'video+video':
      return {
        title: 'Stitch clips',
        blurb: 'Cut between the two takes — transitions get real on the Cut Room timeline (Phase 7).'
      }
    case 'audio+video':
      return {
        title: 'Score the clip',
        blurb: 'Lay the audio track under the video.'
      }
    case 'audio+image':
      return {
        title: 'Animate the still',
        blurb: 'Pair the still with this audio into a rendered clip.'
      }
    case 'audio+audio':
      return {
        title: 'Mix tracks',
        blurb: 'Blend the two audio tracks into one.'
      }
    default:
      return { title: 'Combine', blurb: 'Combine these two nodes.' }
  }
}

export function CombineDialog(): React.JSX.Element | null {
  const combine = useStudio((s) => s.combine)
  const nodes = useStudio((s) => s.nodes)
  const closeCombine = useStudio((s) => s.closeCombine)
  const confirmCombine = useStudio((s) => s.confirmCombine)

  if (!combine) return null
  const source = nodes.find((n) => n.id === combine.sourceId)
  const target = nodes.find((n) => n.id === combine.targetId)
  if (!source || !target) return null

  const { title, blurb } = describeCombine(source.data.mediaType, target.data.mediaType)

  return (
    <div className="dialog-backdrop" onClick={closeCombine}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="sub">{blurb}</p>
        <div className="pair">
          <div className={`mini sw${source.data.swatch}`}>{source.data.label}</div>
          <span className="arrow">→</span>
          <div className={`mini sw${target.data.swatch}`}>{target.data.label}</div>
        </div>
        <p className="sub">Stub for now — the real combined generation lands in Phase 4.</p>
        <div className="btn-row">
          <button className="btn" onClick={closeCombine}>
            Cancel
          </button>
          <button className="btn primary" onClick={confirmCombine}>
            Combine
          </button>
        </div>
      </div>
    </div>
  )
}
