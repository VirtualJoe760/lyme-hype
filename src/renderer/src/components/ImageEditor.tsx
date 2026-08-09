import { useEffect, useRef, useState } from 'react'
import { findManifest } from '@shared/node-manifest'
import { useStudio } from '../store'
import { Button } from './ui/Button'

/**
 * The canvas takeover for direct manipulation of an image at working size
 * (docs/build-plan.md Phase 19). Same shape as Play view: while `editor` is set,
 * `App.tsx` swaps the middle pane for this and hides the Sessions rail.
 *
 * The mask belongs to the artifact, so it lives on the artifact's surface; the prompt,
 * model row and action stay in the panel. Expand and crop are modes of this one surface
 * rather than three surfaces (Phase 14).
 */
export function ImageEditor(): React.JSX.Element | null {
  const editor = useStudio((s) => s.editor)
  const closeEditor = useStudio((s) => s.closeEditor)
  const setEditorMask = useStudio((s) => s.setEditorMask)
  const nodeStage = useStudio((s) => s.nodeStage)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [brush, setBrush] = useState(36)
  const [erasing, setErasing] = useState(false)
  const [painted, setPainted] = useState(false)

  const stage = editor ? nodeStage(editor.manifestId) : null
  const take = stage?.takes[stage.activeIndex]
  const src = take?.src
  const manifest = editor ? findManifest(editor.manifestId) : undefined

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !src) return
    const image = new Image()
    image.onload = () => {
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      setPainted(false)
    }
    image.src = src
  }, [src])

  function paint(event: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas || !drawing.current) return
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Pointer coords are in CSS pixels; the canvas is at the image's natural size, so
    // scale in or the brush lands in the wrong place on any non-1:1 display size.
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height
    const radius = (brush / rect.width) * canvas.width

    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.fillStyle = 'rgba(198, 241, 53, 0.55)'
    ctx.beginPath()
    ctx.arc(x, y, radius / 2, 0, Math.PI * 2)
    ctx.fill()
    setPainted(true)
  }

  function clear(): void {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setPainted(false)
    setEditorMask(undefined)
  }

  function apply(): void {
    const canvas = canvasRef.current
    if (canvas && painted) setEditorMask(canvas.toDataURL('image/png'))
    closeEditor()
  }

  if (!editor || !manifest) return null

  const title =
    editor.mode === 'mask' ? 'Inpaint' : editor.mode === 'expand' ? 'Expand' : 'Reframe'

  return (
    <div className="imged">
      <div className="imged-bar">
        <button className="np-sq" onClick={closeEditor} title="Back">
          ←
        </button>
        <span className="np-title">{title}</span>
        {editor.mode === 'mask' && (
          <>
            <button
              className={`np-chip${!erasing ? ' on' : ''}`}
              onClick={() => setErasing(false)}
            >
              brush
            </button>
            <button
              className={`np-chip${erasing ? ' on' : ''}`}
              onClick={() => setErasing(true)}
            >
              erase
            </button>
            <button className="np-chip" onClick={clear}>
              clear
            </button>
            <input
              className="imged-size"
              type="range"
              min={8}
              max={140}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
              title="Brush size"
            />
            <span className="imged-hint">size {brush}</span>
          </>
        )}
        {editor.mode !== 'mask' && (
          <span className="imged-hint">
            {editor.mode === 'expand'
              ? 'drag the edges outward — not built yet'
              : 'crop handles — not built yet'}
          </span>
        )}
        <span className="imged-spacer" />
        <Button variant="mini-primary" onClick={apply} disabled={editor.mode === 'mask' && !painted}>
          {editor.mode === 'mask' ? 'Use this mask' : 'Done'}
        </Button>
      </div>

      <div className="imged-stage">
        {src ? (
          <div className="imged-frame">
            <img src={src} alt={take?.label ?? ''} />
            <canvas
              ref={canvasRef}
              onPointerDown={(e) => {
                drawing.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                paint(e)
              }}
              onPointerMove={paint}
              onPointerUp={() => {
                drawing.current = false
              }}
              onPointerLeave={() => {
                drawing.current = false
              }}
            />
          </div>
        ) : (
          <span className="np-empty">nothing staged to edit</span>
        )}
      </div>
    </div>
  )
}
