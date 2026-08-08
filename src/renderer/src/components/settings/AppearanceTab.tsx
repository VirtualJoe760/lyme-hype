import type { ThemeId } from '@shared/types'
import { useStudio } from '../../store'

interface ThemePreview {
  id: ThemeId
  name: string
  mood: string
  bg: string
  panel: string
  border: string
  text: string
  accent: string
}

// Swatch values mirror theme.css so the preview reads true without mounting each theme.
const THEMES: ThemePreview[] = [
  {
    id: 'lime-cut',
    name: 'Lime Cut',
    mood: 'Charcoal production suite, rationed lime.',
    bg: '#15171a',
    panel: '#242830',
    border: '#30343a',
    text: '#edeff1',
    accent: '#c6f135'
  },
  {
    id: 'night-terminal',
    name: 'Night Terminal',
    mood: 'Amber phosphor on near-black.',
    bg: '#0b0a08',
    panel: '#1b1810',
    border: '#2a2317',
    text: '#f5d9a6',
    accent: '#ffb000'
  },
  {
    id: 'zest',
    name: 'Zest',
    mood: 'Retro, light, citrus green.',
    bg: '#f1fae3',
    panel: '#ffffff',
    border: '#d3e8b8',
    text: '#1e2b12',
    accent: '#7bc311'
  }
]

export function AppearanceTab(): React.JSX.Element {
  const theme = useStudio((s) => s.theme)
  const setTheme = useStudio((s) => s.setTheme)

  return (
    <div className="settings-section">
      <p className="settings-intro">
        Pick a theme. The three directions from the concept designs — applied live, remembered
        between sessions.
      </p>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            className={`theme-card${theme === t.id ? ' active' : ''}`}
            onClick={() => setTheme(t.id)}
          >
            <div className="theme-swatch" style={{ background: t.bg, borderColor: t.border }}>
              <span className="theme-swatch-panel" style={{ background: t.panel, borderColor: t.border }}>
                <span className="theme-swatch-line" style={{ background: t.text }} />
                <span className="theme-swatch-line short" style={{ background: t.text }} />
              </span>
              <span className="theme-swatch-accent" style={{ background: t.accent }} />
            </div>
            <div className="theme-card-name">
              {t.name}
              {theme === t.id && <span className="conn-tag active-tag">active</span>}
            </div>
            <div className="settings-blurb">{t.mood}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
