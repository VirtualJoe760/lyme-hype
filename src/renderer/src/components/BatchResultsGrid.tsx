export interface BatchItem {
  id: string
  status: 'running' | 'ok' | 'error'
  /** lyme-asset:// URL when status is ok. */
  src?: string
  caption?: string
  error?: string
}

/**
 * Generic batch-generate-and-compare grid (docs/ui/create-panel.md's firm
 * decision: reusable from the start, not Motion-graphics-specific). N candidate
 * results in, the user's pick out — any tile that generates several options
 * instead of one is a future consumer.
 */
export function BatchResultsGrid(props: {
  items: BatchItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="batch-grid">
      {props.items.map((item) => (
        <button
          key={item.id}
          className={`batch-cell${props.selectedId === item.id ? ' selected' : ''} ${item.status}`}
          disabled={item.status !== 'ok'}
          title={item.status === 'error' ? item.error : item.caption}
          onClick={() => props.onSelect(item.id)}
        >
          {item.status === 'running' && <span className="batch-running">Rendering…</span>}
          {item.status === 'error' && <span className="batch-error">⚠ failed</span>}
          {item.status === 'ok' && item.src && <img src={item.src} alt={item.caption ?? ''} />}
          {item.caption && <span className="batch-caption">{item.caption}</span>}
        </button>
      ))}
    </div>
  )
}
