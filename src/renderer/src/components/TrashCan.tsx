import { useEffect, useState } from 'react'
import { useActiveSession, useStudio } from '../store'

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * The canvas trash can. Three jobs: a drop target (drag a node's grip onto it),
 * a badge that says how many deletes are still reversible, and — on click — the
 * recently deleted list with Restore per item and Empty trash. Ctrl+Z on the
 * canvas restores the most recent delete.
 */
export function TrashCan(): React.JSX.Element {
  const session = useActiveSession()
  const trashNodes = useStudio((s) => s.trashNodes)
  const restoreFromTrash = useStudio((s) => s.restoreFromTrash)
  const restoreLastTrashed = useStudio((s) => s.restoreLastTrashed)
  const emptyTrash = useStudio((s) => s.emptyTrash)
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const items = session?.trash ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (restoreLastTrashed()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restoreLastTrashed])

  useEffect(() => {
    if (items.length === 0) setConfirmEmpty(false)
  }, [items.length])

  return (
    <div className="trash-wrap">
      {open && (
        <div className="trash-pop" onClick={(e) => e.stopPropagation()}>
          <div className="trash-head">
            <span>Recently deleted</span>
            <span className="muted">{items.length ? `${items.length}` : 'empty'}</span>
          </div>
          {items.length === 0 ? (
            <div className="trash-empty">Nothing here. Deleted nodes wait here until you empty the trash.</div>
          ) : (
            <div className="trash-list">
              {items.map((t) => (
                <div className="trash-row" key={t.node.id}>
                  {t.node.data.thumbSrc || (t.node.data.mediaType === 'image' && t.node.data.src) ? (
                    <img src={t.node.data.thumbSrc ?? t.node.data.src} alt="" />
                  ) : (
                    <span className="trash-glyph">{t.node.data.mediaType === 'video' ? '▶' : '♪'}</span>
                  )}
                  <span className="trash-label" title={t.node.data.label}>
                    {t.node.data.label}
                    <small>{ago(t.deletedAt)}</small>
                  </span>
                  <button className="conn-mini" onClick={() => restoreFromTrash(t.node.id)}>
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <div className="trash-foot">
              {confirmEmpty ? (
                <>
                  <span className="muted">Forget {items.length} node{items.length === 1 ? '' : 's'}? Files stay in the asset store.</span>
                  <button className="conn-mini danger" onClick={() => { emptyTrash(); setConfirmEmpty(false) }}>Empty</button>
                  <button className="conn-mini" onClick={() => setConfirmEmpty(false)}>Keep</button>
                </>
              ) : (
                <button className="conn-mini" onClick={() => setConfirmEmpty(true)}>Empty trash</button>
              )}
            </div>
          )}
        </div>
      )}
      <button
        className={`trash-can${over ? ' over' : ''}${open ? ' open' : ''}`}
        title={items.length ? `${items.length} recently deleted — click to review, drop a node here to delete it` : 'Trash — drop a node here to delete it'}
        onClick={() => setOpen((v) => !v)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/lyme-node')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/lyme-node')
          setOver(false)
          if (!id) return
          e.preventDefault()
          trashNodes([id])
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
        {items.length > 0 && <span className="trash-badge">{items.length}</span>}
      </button>
    </div>
  )
}
