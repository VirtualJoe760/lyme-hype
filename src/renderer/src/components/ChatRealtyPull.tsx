import { useEffect, useState } from 'react'
import { bridge } from '../bridge'
import { useStudio } from '../store'

type PullState = 'idle' | 'pulling' | 'done' | 'error'
type CoverState = 'idle' | 'working' | 'done' | 'error'

interface TopListing {
  listingKey: string
  address: string
  city: string
  detailUrl: string | null
}

export function ChatRealtyPull(): React.JSX.Element | null {
  const pull = useStudio((s) => s.pullChatRealtyPhotos)
  const createCover = useStudio((s) => s.createChatRealtyCover)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<PullState>('idle')
  const [message, setMessage] = useState('')
  const [topListing, setTopListing] = useState<TopListing | null>(null)
  const [hook, setHook] = useState('')
  const [body, setBody] = useState('')
  const [coverState, setCoverState] = useState<CoverState>('idle')
  const [coverMessage, setCoverMessage] = useState('')

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
    setTopListing(null)
    setCoverState('idle')
    setCoverMessage('')
    try {
      const result = await pull(query)
      if (result.ok && result.count > 0) {
        setState('done')
        setMessage(
          `Added ${result.count} listing photo${result.count === 1 ? '' : 's'} to the canvas.`
        )
        setTopListing(result.topListing ?? null)
      } else {
        setState('error')
        setMessage(result.error ?? 'Nothing came back.')
      }
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'The pull failed.')
    }
  }

  async function handleCreateCover(): Promise<void> {
    if (!topListing || !hook.trim() || !body.trim()) return
    setCoverState('working')
    setCoverMessage('')
    try {
      const result = await createCover(topListing.listingKey, {
        hook: hook.trim(),
        body: body.trim(),
        city: topListing.city || undefined,
        label: `${topListing.address} · Cover`,
        detailUrl: topListing.detailUrl ?? undefined
      })
      if (result.ok) {
        setCoverState('done')
        setCoverMessage('Added the cover to the canvas.')
      } else {
        setCoverState('error')
        setCoverMessage(result.error ?? 'The cover render failed.')
      }
    } catch (err) {
      setCoverState('error')
      setCoverMessage(err instanceof Error ? err.message : 'The cover render failed.')
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
      {topListing && (
        <div className="cr-cover">
          <p className="cr-help">
            Create a branded Instagram cover for {topListing.address || 'this listing'}.
          </p>
          <input
            className="link-input cr-input"
            placeholder="Hook (2-3 words, e.g. Just Listed)"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            maxLength={40}
          />
          <textarea
            className="link-input cr-input cr-textarea"
            placeholder="Body copy (specs, price, what makes it special — up to 260 characters)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={260}
            rows={3}
          />
          <button
            className="action-btn cr-btn"
            disabled={coverState === 'working' || !hook.trim() || !body.trim()}
            onClick={() => void handleCreateCover()}
          >
            {coverState === 'working' ? 'Rendering…' : '▣ Create Instagram cover'}
          </button>
          {coverMessage && <div className={`cr-msg ${coverState}`}>{coverMessage}</div>}
        </div>
      )}
    </div>
  )
}
