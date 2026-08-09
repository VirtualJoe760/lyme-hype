import { useState } from 'react'
import type { MediaType } from '@shared/types'
import { useStudio } from '../store'
import { Button } from './ui/Button'

/** image+image and audio+image are real generation chains (reference-
 *  conditioning, lipsync/animate-with-audio); every other pair still spawns
 *  the placeholder "combined" node until the Cut Room's compositing grows a
 *  generation-free path for it (stitch/score/mix are ffmpeg jobs, not agent
 *  generations). */
function isGenerativeCombine(a: MediaType, b: MediaType): boolean {
  const pair = [a, b].sort().join('+')
  return pair === 'image+image' || pair === 'audio+image'
}

function describeCombine(a: MediaType, b: MediaType): { title: string; blurb: string; placeholder?: string } {
  const pair = [a, b].sort().join('+')
  switch (pair) {
    case 'image+image':
      return {
        title: 'Merge stills',
        blurb: 'Two stills mixed into one new image — describe how they should combine.',
        placeholder: 'Merge these two reference images into one new image, blending their content and style together.'
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
        blurb: 'The still is driven by the audio — lip-synced if it shows a face, otherwise animated and scored to it.',
        placeholder: 'Animate this still image driven by the accompanying audio.'
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
  const [note, setNote] = useState('')

  if (!combine) return null
  const source = nodes.find((n) => n.id === combine.sourceId)
  const target = nodes.find((n) => n.id === combine.targetId)
  if (!source || !target) return null

  const { title, blurb, placeholder } = describeCombine(source.data.mediaType, target.data.mediaType)
  const generative = isGenerativeCombine(source.data.mediaType, target.data.mediaType)
  const missingSrc = generative && (!source.data.src || !target.data.src)

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
        {generative ? (
          <>
            <textarea
              className="prompt-area"
              placeholder={placeholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {missingSrc && (
              <p className="sub">Both nodes need to finish rendering before they can be combined.</p>
            )}
          </>
        ) : (
          <p className="sub">Stub for now — the real combined generation lands in a future pass.</p>
        )}
        <div className="btn-row">
          <Button variant="dialog" onClick={closeCombine}>
            Cancel
          </Button>
          <Button
            variant="dialog-primary"
            disabled={missingSrc}
            onClick={() => confirmCombine(note)}
          >
            Combine
          </Button>
        </div>
      </div>
    </div>
  )
}
