/** The Cut Room's program monitor: every clip live under the playhead, stacked
 *  in track order, with the media elements the transport drives. Each layer is
 *  drawn with the clip's own fit so the preview is what export produces. */

import type { TimelineClip } from '@shared/types'
import type { MediaFlowNode } from '../../store'

/** Output frame size, matching main/ffmpeg.ts OUT_W × OUT_H. */
export const FRAME_W = 1080
export const FRAME_H = 1920

/** Monitor magnification, Premiere-style: a fraction of the real output pixel
 *  size, or fit-to-panel. */
export type MonitorZoom = 'fit' | number

export interface MonitorProps {
  monitorAspect: '9:16' | '16:9'
  monitorZoom: MonitorZoom
  monitorVideo: { clip: TimelineClip }[]
  monitorAudio: { clip: TimelineClip }[]
  nodeFor(clip: TimelineClip): MediaFlowNode | undefined
  mediaRefs: React.MutableRefObject<Map<string, HTMLVideoElement | HTMLAudioElement>>
  /** Double-click: open the top clip large (Play view). */
  onOpenLarge(): void
}

function layerStyle(clip: TimelineClip): React.CSSProperties {
  const t = clip.transform
  if (!t || t.fit === 'contain') return { objectFit: 'contain' }
  if (t.fit === 'cover') return { objectFit: 'cover' }
  // Percent translate of the layer = percent of the frame, since the layer
  // spans the whole monitor; scale is relative to the contain size, as in export.
  return {
    objectFit: 'contain',
    transform: `translate(${t.offsetX}%, ${t.offsetY}%) scale(${t.scale})`,
    transformOrigin: 'center'
  }
}

export function TimelineMonitor({
  monitorAspect,
  monitorZoom,
  monitorVideo,
  monitorAudio,
  nodeFor,
  mediaRefs,
  onOpenLarge
}: MonitorProps): React.JSX.Element {
  const portrait = monitorAspect === '9:16'
  const sized: React.CSSProperties =
    monitorZoom === 'fit'
      ? portrait
        ? { aspectRatio: '9 / 16', maxWidth: 220 }
        : { aspectRatio: '16 / 9', maxWidth: 420 }
      : {
          width: Math.round((portrait ? FRAME_W : FRAME_H) * monitorZoom),
          height: Math.round((portrait ? FRAME_H : FRAME_W) * monitorZoom),
          maxWidth: 'none',
          flex: 'none'
        }
  return (
    <div className={`tl-monitor-wrap${monitorZoom === 'fit' ? '' : ' zoomed'}`}>
      <div
        className="tl-monitor"
        style={sized}
        onDoubleClick={onOpenLarge}
        title="Double-click to open the top clip large"
      >
        {monitorVideo.length === 0 && <span className="tl-monitor-idle">▶</span>}
        {monitorVideo.map(({ clip }) => {
          const node = nodeFor(clip)
          if (!node?.data.src) return null
          return clip.mediaType === 'image' ? (
            <img key={clip.id} className="tl-monitor-layer" style={layerStyle(clip)} src={node.data.src} alt="" />
          ) : (
            <video
              key={clip.id}
              className="tl-monitor-layer"
              style={layerStyle(clip)}
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
    </div>
  )
}
