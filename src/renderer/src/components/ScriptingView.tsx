import { useEffect, useRef, useState } from 'react'
import { useActiveSession, useStudio } from '../store'

/**
 * The third middle-panel view (docs/ui/scripting-panel.md): a deliberate chat
 * interface for developing a script before any shot exists. The one place the
 * app IS a conversation — script development is iterative in a way the spatial
 * canvas isn't.
 */
export function ScriptingView(): React.JSX.Element {
  const session = useActiveSession()
  const busy = useStudio((s) => s.scriptingBusy)
  const streamText = useStudio((s) => s.scriptingStream)
  const sendMessage = useStudio((s) => s.sendScriptingMessage)
  const runBreakdown = useStudio((s) => s.runShotBreakdown)
  const setView = useStudio((s) => s.setView)

  const [draft, setDraft] = useState('')
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const messages = session?.scripting?.messages ?? []
  const totalCost = session?.scripting?.totalCostUsd ?? 0

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamText])

  function handleSend(): void {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setBreakdownError(null)
    void sendMessage(text)
  }

  async function handleBreakdown(): Promise<void> {
    setBreakdownError(null)
    const result = await runBreakdown()
    if (result.ok) {
      setView('storyboard')
    } else {
      setBreakdownError(result.error ?? 'Shot breakdown failed.')
    }
  }

  return (
    <div className="scripting">
      <div className="scripting-head">
        <span className="scripting-title">Scripting</span>
        <span className="scripting-cost" title="Agent cost across this session's scripting turns">
          {totalCost > 0 ? `$${totalCost.toFixed(3)} this session` : ''}
        </span>
        <span className="play-header-spacer" />
        {breakdownError && <span className="scripting-error">{breakdownError}</span>}
        <button
          className="conn-mini primary-mini"
          disabled={busy || messages.length === 0}
          title="Break the script into shots — one Storyboard panel per shot"
          onClick={() => void handleBreakdown()}
        >
          ⇢ Send to storyboard
        </button>
      </div>

      <div className="scripting-list" ref={listRef}>
        {messages.length === 0 && !streamText && (
          <p className="note">
            Develop the script here before any shot exists — brainstorm, draft, revise.
            When it feels solid, <strong>Send to storyboard</strong> breaks it into shots;
            you add a short <em>feeling</em> per shot and the agent authors each panel's
            generation prompt from both.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`scripting-msg ${m.role}`}>
            <div className="scripting-bubble">{m.text}</div>
          </div>
        ))}
        {streamText !== null && (
          <div className="scripting-msg assistant">
            <div className="scripting-bubble streaming">
              {streamText.length > 0 ? streamText : '…'}
            </div>
          </div>
        )}
      </div>

      <div className="scripting-input-row">
        <textarea
          className="prompt-area scripting-input"
          placeholder="What's the reel about? Work the script out loud here…"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <button className="generate-btn scripting-send" disabled={busy || !draft.trim()} onClick={handleSend}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
