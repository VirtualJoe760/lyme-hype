import { useEffect, useState } from 'react'
import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import type { MediaFlowNode } from '../store'
import { useStudio } from '../store'

export function Waveform(): React.JSX.Element {
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

/**
 * A node thumbnail that retries once if the load fails.
 *
 * `lyme-asset://` requests can be cancelled when a node re-renders while its
 * image is still in flight — on boot the canvas mounts, restores takes and
 * backfills thumbnails in quick succession. A cancelled <img> shows the broken
 * glyph forever, because the browser never retries on its own; that is what made
 * a restored canvas come back "partially missing" (2026-08-31). One retry with a
 * cache-busting suffix turns a transient cancel back into a picture. The query
 * is ignored by the protocol handler, which resolves on pathname alone.
 */
function AssetImg({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setAttempt(0), [src])
  return (
    <img
      src={attempt === 0 ? src : `${src}?retry=${attempt}`}
      alt={alt}
      className="thumb-img"
      draggable={false}
      onError={() => setAttempt((a) => (a < 2 ? a + 1 : a))}
    />
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
  const openNodeScreenWith = useStudio((s) => s.openNodeScreenWith)

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
      {/* Width-only in effect: the store drops the height half of resize
          changes so node height keeps following the media's aspect ratio. */}
      <NodeResizer isVisible={selected} minWidth={84} maxWidth={520} />
      {/* Selecting a node surfaces what you can DO with it — each action opens
          the matching node screen with this media already loaded. */}
      {ready && data.src && (
        <NodeToolbar isVisible={selected} position={Position.Top} className="node-actions">
          {data.mediaType === 'image' && (
            <>
              <button
                title="use as a reference for a new generation"
                onClick={() =>
                  openNodeScreenWith('image', {
                    src: data.src ?? '',
                    label: data.label,
                    mediaType: 'image',
                    role: 'refs'
                  })
                }
              >
                img2img
              </button>
              <button
                title="edit this image with a painted mask"
                onClick={() =>
                  openNodeScreenWith('image', {
                    src: data.src ?? '',
                    label: data.label,
                    mediaType: 'image',
                    role: 'take',
                    toolId: 'inpaint'
                  })
                }
              >
                inpaint
              </button>
              <button
                title="animate this image (start frame of a video)"
                onClick={() =>
                  openNodeScreenWith('video', {
                    src: data.src ?? '',
                    label: data.label,
                    mediaType: 'image',
                    role: 'startFrame'
                  })
                }
              >
                → video
              </button>
            </>
          )}
          {data.mediaType === 'video' && (
            <button
              title="extend this clip by ~7s"
              onClick={() =>
                openNodeScreenWith('video', {
                  src: data.src ?? '',
                  label: data.label,
                  mediaType: 'video',
                  role: 'take',
                  toolId: 'extend'
                })
              }
            >
              extend
            </button>
          )}
          {timelineEligible && (
            <button title="append to the Cut Room timeline" onClick={() => void sendToTimeline(id)}>
              → timeline
            </button>
          )}
        </NodeToolbar>
      )}
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
          // A poster frame when we have one (ffmpeg makes them at import time);
          // otherwise the media fragment `#t=0.5` makes the browser seek and
          // paint a frame instead of showing an empty black box.
          data.thumbSrc ? (
            <AssetImg src={data.thumbSrc} alt={data.label} />
          ) : (
            // preload="metadata" alone will not decode a frame, so the seek has
            // nothing to paint; "auto" makes the fallback actually show the clip
            // until the poster backfill lands.
            <video src={`${data.src}#t=0.5`} muted preload="auto" className="thumb-img" />
          )
        ) : data.src && data.mediaType === 'image' ? (
          <AssetImg src={data.thumbSrc ?? data.src} alt={data.label} />
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
            void sendToTimeline(id)
          }}
        >
          {data.sentToTimeline ? '✓' : '→'}
        </button>
      )}
      {ready && data.src && (
        // HTML5 drag source for placing this node at a specific time/track on
        // the timeline. `nodrag` keeps React Flow from starting a node drag;
        // images are timeline-droppable too (overlay stills), unlike the
        // append-only send button above.
        <span
          className="drag-grip nodrag"
          draggable
          title="Drag onto a timeline track"
          onDragStart={(e) => {
            e.dataTransfer.setData('application/lyme-node', id)
            e.dataTransfer.setData('application/lyme-node-type', data.mediaType)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          ⣿
        </span>
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
