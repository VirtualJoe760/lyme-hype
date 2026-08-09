import { useRef, useState } from 'react'

/**
 * Drag handle on a panel's shared edge (docs/ui/layout-and-panels.md). Same
 * pointer pattern as PlayView's trim handles: pointerdown starts tracking,
 * window-level pointermove updates the size live, pointerup tears down.
 *
 * `grow` is the pointer direction that makes the panel bigger: 'right' for the
 * rail (handle on its right edge), 'left' for the aside, 'up' for the timeline.
 * Overdragging past half the minimum collapses the panel via `onCollapse` —
 * the same action the existing toggle buttons fire, not a second mechanism.
 */
export function PanelResizeHandle(props: {
  grow: 'left' | 'right' | 'up'
  value: number
  min: number
  max: () => number
  onResize: (px: number) => void
  onCollapse: () => void
}): React.JSX.Element {
  const { grow, min } = props
  const [dragging, setDragging] = useState(false)
  // Read through refs inside the window listeners so a drag sees fresh values
  // without re-binding listeners mid-drag.
  const latest = useRef(props)
  latest.current = props

  function startDrag(e: React.PointerEvent): void {
    e.preventDefault()
    const startPos = grow === 'up' ? e.clientY : e.clientX
    const startValue = latest.current.value
    setDragging(true)

    const move = (ev: PointerEvent): void => {
      const pos = grow === 'up' ? ev.clientY : ev.clientX
      const delta = grow === 'left' || grow === 'up' ? startPos - pos : pos - startPos
      const raw = startValue + delta
      if (raw < min / 2) {
        // Collapse-on-overdrag; the toggle button is how it re-opens.
        teardown()
        latest.current.onCollapse()
        return
      }
      latest.current.onResize(Math.min(latest.current.max(), Math.max(min, raw)))
    }
    const teardown = (): void => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', teardown)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', teardown)
  }

  return (
    <div
      className={`resize-handle ${grow === 'up' ? 'horizontal' : 'vertical'}${dragging ? ' dragging' : ''}`}
      onPointerDown={startDrag}
    />
  )
}
