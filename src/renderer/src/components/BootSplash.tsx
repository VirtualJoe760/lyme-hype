import { useEffect, useState } from 'react'
import { useStudio } from '../store'

/**
 * The startup takeover: brand animation plus one line of what the app is
 * actually doing, so the studio is never handed over half-booted.
 *
 * The status line is the real step `init()` is on — ffmpeg discovery, workspace,
 * sessions restored, connectors ready — not a synthetic progress bar. On a fast
 * machine they all land at once, which is why the splash holds for a short
 * minimum beat: readable, without ever claiming work that hasn't happened.
 */
export function BootSplash(): React.JSX.Element {
  const steps = useStudio((s) => s.bootSteps)
  const booted = useStudio((s) => s.booted)
  // Stay mounted through the fade, then get out of the way entirely — the
  // takeover sits above everything, so leaving it mounted would swallow clicks.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (!booted) return
    const timer = window.setTimeout(() => setGone(true), 650)
    return () => window.clearTimeout(timer)
  }, [booted])
  if (gone) return <></>

  // One line, not a log: the studio only needs to know where boot is now.
  const current = steps[steps.length - 1]

  return (
    <div className={`boot${booted ? ' done' : ''}`} aria-hidden={booted}>
      <div className="boot-mark">
        <svg className="boot-lime" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="13.4" rx="9.2" ry="8.4" fill="currentColor" />
          <ellipse cx="9" cy="10.6" rx="3.4" ry="2.4" fill="#ffffff" opacity="0.28" />
          <rect x="11.1" y="3.2" width="1.8" height="2.6" rx="0.9" fill="currentColor" opacity="0.75" />
          <path
            d="M13 4.6 C 16.4 2.4, 19.6 3.4, 20.4 4.4 C 18.4 6.4, 15.2 6.6, 13 4.6 Z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
        <span className="boot-word">lyme hype</span>
        <span className="boot-rule" />
      </div>

      <div className="boot-status" key={current?.label ?? 'start'}>
        <span className="boot-ok">{booted ? '✓' : <span className="boot-caret">▌</span>}</span>
        <span className="boot-label">{current?.label ?? 'starting'}</span>
        <span className="boot-detail">{current?.detail ?? ''}</span>
      </div>
    </div>
  )
}
