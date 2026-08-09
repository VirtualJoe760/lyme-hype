import type { SettingsTab } from '../../store'
import { useStudio } from '../../store'
import { AppearanceTab } from './AppearanceTab'
import { ConnectorsTab } from './ConnectorsTab'
import { ModelsTab } from './ModelsTab'
import { TrainedStylesTab } from './TrainedStylesTab'

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'connectors', label: 'Connectors' },
  { key: 'models', label: 'Models' },
  { key: 'styles', label: 'Trained styles' },
  { key: 'appearance', label: 'Appearance' }
]

export function Settings(): React.JSX.Element {
  const tab = useStudio((s) => s.settingsTab)
  const setTab = useStudio((s) => s.setSettingsTab)
  const close = useStudio((s) => s.closeSettings)

  return (
    <div className="settings-screen">
      <div className="settings-header">
        <button className="settings-back" onClick={close} title="Back to studio">
          ← Back
        </button>
        <h1 className="settings-title">Settings</h1>
        <span className="settings-header-spacer" />
      </div>
      <div className="settings-body">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`settings-nav-item${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'connectors' && <ConnectorsTab />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'styles' && <TrainedStylesTab />}
          {tab === 'appearance' && <AppearanceTab />}
        </div>
      </div>
    </div>
  )
}
