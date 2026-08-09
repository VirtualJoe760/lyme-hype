import { useEffect, useState } from 'react'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { Button } from './ui/Button'
import type { ChatRealtyCarouselSlideInput } from '@shared/types'

type PullState = 'idle' | 'pulling' | 'done' | 'error'
type CoverState = 'idle' | 'working' | 'done' | 'error'
type SlideKind = ChatRealtyCarouselSlideInput['kind']
type SlideState = 'idle' | 'working' | 'done' | 'error'
type StageState = 'idle' | 'working' | 'done' | 'error'

interface TopListing {
  listingKey: string
  address: string
  city: string
  detailUrl: string | null
}

const SLIDE_KINDS: { id: SlideKind; label: string }[] = [
  { id: 'cma', label: 'CMA stats' },
  { id: 'text', label: 'Text' },
  { id: 'cta', label: 'Call to action' },
  { id: 'banner', label: 'Banner (staged photo)' }
]

function emptyCarouselForm(): {
  statLabels: string[]
  statValues: string[]
  listingPrice: string
  scope: string
  period: string
  pitch: string
  paragraph1: string
  paragraph2: string
  paragraph3: string
  italicLast: boolean
  bannerLabel: string
  bannerCaption: string
  bannerImageUrl: string
} {
  return {
    statLabels: ['', '', '', ''],
    statValues: ['', '', '', ''],
    listingPrice: '',
    scope: '',
    period: '',
    pitch: '',
    paragraph1: '',
    paragraph2: '',
    paragraph3: '',
    italicLast: false,
    bannerLabel: '',
    bannerCaption: '',
    bannerImageUrl: ''
  }
}

interface PulledPhoto {
  src: string
  label: string
  photoIndex: number
}

export function ChatRealtyPull(): React.JSX.Element | null {
  const pull = useStudio((s) => s.pullChatRealtyPhotos)
  const createCover = useStudio((s) => s.createChatRealtyCover)
  const createSlide = useStudio((s) => s.createChatRealtyCarouselSlide)
  const stageListing = useStudio((s) => s.stageChatRealtyListing)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [state, setState] = useState<PullState>('idle')
  const [message, setMessage] = useState('')
  const [topListing, setTopListing] = useState<TopListing | null>(null)
  const [hook, setHook] = useState('')
  const [body, setBody] = useState('')
  const [coverState, setCoverState] = useState<CoverState>('idle')
  const [coverMessage, setCoverMessage] = useState('')
  const [slideKind, setSlideKind] = useState<SlideKind>('cma')
  const [slideForm, setSlideForm] = useState(emptyCarouselForm())
  const [slideState, setSlideState] = useState<SlideState>('idle')
  const [slideMessage, setSlideMessage] = useState('')
  const [photos, setPhotos] = useState<PulledPhoto[]>([])
  const [interiorPicks, setInteriorPicks] = useState<Set<number>>(new Set())
  const [stageState, setStageState] = useState<StageState>('idle')
  const [stageMessage, setStageMessage] = useState('')

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
    setSlideState('idle')
    setSlideMessage('')
    setSlideForm(emptyCarouselForm())
    setPhotos([])
    setInteriorPicks(new Set())
    setStageState('idle')
    setStageMessage('')
    try {
      const result = await pull(query)
      if (result.ok && result.count > 0) {
        setState('done')
        setMessage(
          `Added ${result.count} listing photo${result.count === 1 ? '' : 's'} to the canvas.`
        )
        setTopListing(result.topListing ?? null)
        setPhotos(result.photos)
      } else {
        setState('error')
        setMessage(result.error ?? 'Nothing came back.')
      }
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'The pull failed.')
    }
  }

  function toggleInteriorPick(photoIndex: number): void {
    setInteriorPicks((prev) => {
      const next = new Set(prev)
      if (next.has(photoIndex)) next.delete(photoIndex)
      else if (next.size < 10) next.add(photoIndex)
      return next
    })
  }

  async function handleStageListing(): Promise<void> {
    if (!topListing || interiorPicks.size === 0) return
    setStageState('working')
    setStageMessage('')
    try {
      const result = await stageListing(topListing.listingKey, [...interiorPicks], {
        labelBase: topListing.address || 'Listing',
        detailUrl: topListing.detailUrl ?? undefined
      })
      if (result.ok) {
        setStageState('done')
        setStageMessage(
          `Added ${result.count} agent-staged photo${result.count === 1 ? '' : 's'} to the canvas.`
        )
      } else {
        setStageState('error')
        setStageMessage(result.error ?? 'Staging failed.')
      }
    } catch (err) {
      setStageState('error')
      setStageMessage(err instanceof Error ? err.message : 'Staging failed.')
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

  function buildSlideInput(): ChatRealtyCarouselSlideInput | null {
    const f = slideForm
    if (slideKind === 'cma') {
      const stats = f.statLabels.map((label, i) => ({ label: label.trim(), value: f.statValues[i].trim() }))
      if (stats.some((s) => !s.label || !s.value)) return null
      if (!f.listingPrice.trim() || !f.scope.trim() || !f.period.trim() || !f.pitch.trim()) return null
      return {
        kind: 'cma',
        stats,
        listingPrice: f.listingPrice.trim(),
        scope: f.scope.trim(),
        period: f.period.trim(),
        pitch: f.pitch.trim()
      }
    }
    if (slideKind === 'text') {
      if (!f.paragraph1.trim()) return null
      const paragraphs = [f.paragraph1, f.paragraph2, f.paragraph3].map((p) => p.trim()).filter(Boolean)
      return { kind: 'text', paragraphs, italicLast: f.italicLast }
    }
    if (slideKind === 'cta') {
      if (!f.paragraph1.trim() || !f.paragraph2.trim()) return null
      return { kind: 'cta', paragraphs: [f.paragraph1.trim(), f.paragraph2.trim()] }
    }
    if (!f.bannerLabel.trim() || !f.bannerCaption.trim() || !f.bannerImageUrl.trim()) return null
    return { kind: 'banner', label: f.bannerLabel.trim(), caption: f.bannerCaption.trim(), imageUrl: f.bannerImageUrl.trim() }
  }

  const slideInput = buildSlideInput()

  async function handleCreateSlide(): Promise<void> {
    if (!slideInput || !topListing) return
    setSlideState('working')
    setSlideMessage('')
    try {
      const result = await createSlide(slideInput, {
        label: `${topListing.address} · ${SLIDE_KINDS.find((k) => k.id === slideKind)?.label ?? 'Slide'}`,
        listingKey: topListing.listingKey,
        detailUrl: topListing.detailUrl ?? undefined
      })
      if (result.ok) {
        setSlideState('done')
        setSlideMessage('Added the slide to the canvas.')
      } else {
        setSlideState('error')
        setSlideMessage(result.error ?? 'The slide render failed.')
      }
    } catch (err) {
      setSlideState('error')
      setSlideMessage(err instanceof Error ? err.message : 'The slide render failed.')
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
      {topListing && (
        <div className="cr-cover">
          <p className="cr-help">Build a carousel slide for {topListing.address || 'this listing'}.</p>
          <div className="cr-slide-kinds">
            {SLIDE_KINDS.map((k) => (
              <Button
                key={k.id}
                type="button"
                variant={slideKind === k.id ? 'mini-primary' : 'mini'}
                onClick={() => {
                  setSlideKind(k.id)
                  setSlideState('idle')
                  setSlideMessage('')
                }}
              >
                {k.label}
              </Button>
            ))}
          </div>
          {slideKind === 'cma' && (
            <div className="cr-slide-form">
              {[0, 1, 2, 3].map((i) => (
                <div className="cr-stat-row" key={i}>
                  <input
                    className="link-input cr-input"
                    placeholder={`Stat ${i + 1} label (e.g. Homes sold)`}
                    value={slideForm.statLabels[i]}
                    onChange={(e) =>
                      setSlideForm((f) => {
                        const statLabels = [...f.statLabels]
                        statLabels[i] = e.target.value
                        return { ...f, statLabels }
                      })
                    }
                  />
                  <input
                    className="link-input cr-input"
                    placeholder="Value (e.g. 6)"
                    value={slideForm.statValues[i]}
                    onChange={(e) =>
                      setSlideForm((f) => {
                        const statValues = [...f.statValues]
                        statValues[i] = e.target.value
                        return { ...f, statValues }
                      })
                    }
                  />
                </div>
              ))}
              <input
                className="link-input cr-input"
                placeholder="Listing price (e.g. $2,360,000)"
                value={slideForm.listingPrice}
                onChange={(e) => setSlideForm((f) => ({ ...f, listingPrice: e.target.value }))}
              />
              <input
                className="link-input cr-input"
                placeholder="Scope (e.g. PGA West)"
                value={slideForm.scope}
                onChange={(e) => setSlideForm((f) => ({ ...f, scope: e.target.value }))}
              />
              <input
                className="link-input cr-input"
                placeholder="Period (e.g. Last 12 months)"
                value={slideForm.period}
                onChange={(e) => setSlideForm((f) => ({ ...f, period: e.target.value }))}
              />
              <input
                className="link-input cr-input"
                placeholder="Pitch (one line)"
                value={slideForm.pitch}
                onChange={(e) => setSlideForm((f) => ({ ...f, pitch: e.target.value }))}
              />
            </div>
          )}
          {slideKind === 'text' && (
            <div className="cr-slide-form">
              <textarea
                className="link-input cr-input cr-textarea"
                placeholder="Paragraph 1 (required, up to 220 characters)"
                value={slideForm.paragraph1}
                maxLength={220}
                rows={2}
                onChange={(e) => setSlideForm((f) => ({ ...f, paragraph1: e.target.value }))}
              />
              <textarea
                className="link-input cr-input cr-textarea"
                placeholder="Paragraph 2 (optional)"
                value={slideForm.paragraph2}
                maxLength={220}
                rows={2}
                onChange={(e) => setSlideForm((f) => ({ ...f, paragraph2: e.target.value }))}
              />
              <textarea
                className="link-input cr-input cr-textarea"
                placeholder="Paragraph 3 (optional)"
                value={slideForm.paragraph3}
                maxLength={220}
                rows={2}
                onChange={(e) => setSlideForm((f) => ({ ...f, paragraph3: e.target.value }))}
              />
              <label className="cr-checkbox">
                <input
                  type="checkbox"
                  checked={slideForm.italicLast}
                  onChange={(e) => setSlideForm((f) => ({ ...f, italicLast: e.target.checked }))}
                />
                Italicize the last paragraph
              </label>
            </div>
          )}
          {slideKind === 'cta' && (
            <div className="cr-slide-form">
              <textarea
                className="link-input cr-input cr-textarea"
                placeholder="Paragraph 1 (required, up to 220 characters)"
                value={slideForm.paragraph1}
                maxLength={220}
                rows={2}
                onChange={(e) => setSlideForm((f) => ({ ...f, paragraph1: e.target.value }))}
              />
              <textarea
                className="link-input cr-input cr-textarea"
                placeholder="Paragraph 2 (required)"
                value={slideForm.paragraph2}
                maxLength={220}
                rows={2}
                onChange={(e) => setSlideForm((f) => ({ ...f, paragraph2: e.target.value }))}
              />
              <p className="cr-help">
                Agent name, DRE, headshot, and logo are injected server-side — nothing else to fill in.
              </p>
            </div>
          )}
          {slideKind === 'banner' && (
            <div className="cr-slide-form">
              <p className="cr-help">
                Needs a staged-photo URL from Agent-in-photo staging (not yet built) — paste one manually,
                or use a cover/carousel Cloudinary URL you already have.
              </p>
              <input
                className="link-input cr-input"
                placeholder="Room label (e.g. Primary Suite)"
                value={slideForm.bannerLabel}
                onChange={(e) => setSlideForm((f) => ({ ...f, bannerLabel: e.target.value }))}
              />
              <input
                className="link-input cr-input"
                placeholder="Caption band text"
                value={slideForm.bannerCaption}
                onChange={(e) => setSlideForm((f) => ({ ...f, bannerCaption: e.target.value }))}
              />
              <input
                className="link-input cr-input"
                placeholder="Image URL (https://…)"
                value={slideForm.bannerImageUrl}
                onChange={(e) => setSlideForm((f) => ({ ...f, bannerImageUrl: e.target.value }))}
              />
            </div>
          )}
          <Button
            variant="block"
            className="cr-btn"
            disabled={slideState === 'working' || !slideInput}
            onClick={() => void handleCreateSlide()}
          >
            {slideState === 'working' ? 'Rendering…' : '▤ Create carousel slide'}
          </Button>
          {slideMessage && <div className={`cr-msg ${slideState}`}>{slideMessage}</div>}
        </div>
      )}
      {topListing && photos.length > 0 && (
        <div className="cr-cover">
          <p className="cr-help">
            Stage the agent into interior photos (Nano Banana composite, real generation spend —
            ~$0.04 each). Pick interior rooms only; aerial/exterior shots composite badly.
          </p>
          <div className="cr-photo-grid">
            {photos.map((p) => (
              <label key={p.photoIndex} className="cr-photo-pick">
                <input
                  type="checkbox"
                  checked={interiorPicks.has(p.photoIndex)}
                  onChange={() => toggleInteriorPick(p.photoIndex)}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          <button
            className="action-btn cr-btn"
            disabled={stageState === 'working' || interiorPicks.size === 0}
            onClick={() => void handleStageListing()}
          >
            {stageState === 'working'
              ? 'Staging…'
              : interiorPicks.size === 0
                ? '☺ Stage agent into photos'
                : `☺ Stage agent into ${interiorPicks.size} photo${interiorPicks.size === 1 ? '' : 's'}`}
          </button>
          {stageMessage && <div className={`cr-msg ${stageState}`}>{stageMessage}</div>}
        </div>
      )}
    </div>
  )
}
