import type { NodeProps } from '@xyflow/react'
import type { MediaFlowNode } from '../store'
import { useStudio } from '../store'

function Waveform(): React.JSX.Element {
  const bars = [10, 20, 14, 26, 16, 24, 12, 18]
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="xMidYMid meet">
      {bars.map((height, i) => (
        <rect
          key={i}
          x={4 + i * 10}
          y={(36 - height) / 2}
          width={6}
          height={height}
          rx={1}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

const SOURCE_BADGE: Record<string, string> = {
  generate: 'gen',
  upload: 'file',
  link: 'link'
}

export function MediaNode({ id, data, selected }: NodeProps<MediaFlowNode>): React.JSX.Element {
  const sendToTimeline = useStudio((s) => s.sendToTimeline)
  const removeNode = useStudio((s) => s.removeNode)
  const openPlay = useStudio((s) => s.openPlay)

  const rendering = data.status === 'rendering'
  const errored = data.status === 'error'
  const ready = data.status === 'ready'
  const timelineEligible = data.mediaType !== 'image' && ready
  const playable = timelineEligible

  const capPrefix =
    data.mediaType === 'video' ? '▶ ' : data.mediaType === 'audio' ? '♪ ' : ''

  return (
    <div
      className={`media-node${selected ? ' selected' : ''}${rendering ? ' rendering' : ''}${
        errored ? ' errored' : ''
      }`}
    >
      <span className={`src-badge ${data.listingKey ? 'link' : data.source}`}>
        {data.listingKey ? 'mls' : data.motionGfx ? 'gfx' : SOURCE_BADGE[data.source]}
      </span>
      <div
        className={`thumb${
          !rendering && !errored && !data.src && data.mediaType !== 'audio' ? ` sw${data.swatch}` : ''
        }`}
      >
        {rendering ? (
          'Rendering…'
        ) : errored ? (
          <span className="thumb-error" title={data.error}>
            ⚠ failed
          </span>
        ) : data.src && data.mediaType === 'video' ? (
          <video src={data.src} muted preload="metadata" className="thumb-img" />
        ) : data.src && data.mediaType === 'image' ? (
          <img src={data.src} alt={data.label} className="thumb-img" draggable={false} />
        ) : data.mediaType === 'audio' ? (
          <Waveform />
        ) : null}
        {playable && (
          <button
            className="play-open-btn"
            title="Open in Play view"
            onClick={(e) => {
              e.stopPropagation()
              openPlay(id)
            }}
          >
            ▶
          </button>
        )}
      </div>
      <span className="cap" title={data.label}>
        {capPrefix}
        {data.label}
      </span>
      {timelineEligible && (
        <button
          className={`send-btn${data.sentToTimeline ? ' sent' : ''}`}
          title={data.sentToTimeline ? 'In Cut Room' : 'Send to timeline'}
          onClick={(e) => {
            e.stopPropagation()
            sendToTimeline(id)
          }}
        >
          {data.sentToTimeline ? '✓' : '→'}
        </button>
      )}
      <button
        className="del-btn"
        title="Delete node"
        onClick={(e) => {
          e.stopPropagation()
          removeNode(id)
        }}
      >
        ✕
      </button>
    </div>
  )
}
