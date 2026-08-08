import { useEffect, useState } from 'react'
import { bridge } from '../bridge'
import { useStudio } from '../store'

type PullState = 'idle' | 'pulling' | 'done' | 'error'

export function ChatRealtyPull(): React.JSX.Element | null {
  const pull = useStudio((s) => s.pullChatRealtyPhotos)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<PullState>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    bridge.chatRealty
      .status()
      .then((s) => {
        if (active) setConnected(s?.connected ?? false)
      })
      .catch(() => {
        if (active) setConnected(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Hidden until a ChatRealty token exists — this panel is the payoff of Phase 3,
  // not a dead button before setup.
  if (connected !== true) return null

  async function handlePull(): Promise<void> {
    setState('pulling')
    setMessage('')
    try {
      const result = await pull(query)
      if (result.ok && result.count > 0) {
        setState('done')
        setMessage(
          `Added ${result.count} listing photo${result.count === 1 ? '' : 's'} to the canvas.`
        )
      } else {
        setState('error')
        setMessage(result.error ?? 'Nothing came back.')
      }
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'The pull failed.')
    }
  }

  return (
    <div className="chatrealty-card">
      <div className="head">
        <span className="title">ChatRealty</span>
        <span className="status-dot ok" title="Connected" />
      </div>
      <p className="cr-help">Pull a listing&apos;s real photos onto the canvas. City or max price, or leave blank.</p>
      <input
        className="link-input cr-input"
        placeholder="e.g. Bakersfield  ·  or  450000"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && state !== 'pulling') void handlePull()
        }}
      />
      <button className="action-btn cr-btn" disabled={state === 'pulling'} onClick={() => void handlePull()}>
        {state === 'pulling' ? 'Pulling…' : '⌂ Pull listing photos'}
      </button>
      {message && <div className={`cr-msg ${state}`}>{message}</div>}
    </div>
  )
}
