import { bridge } from '../bridge'

export function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <div className="brand">
        <span className="dot" />
        lyme hype
        {!bridge.isElectron && <span className="preview-tag">browser preview</span>}
      </div>
      {bridge.isElectron && (
        <div className="winctl">
          <button onClick={() => bridge.window.minimize()} title="Minimize">
            ─
          </button>
          <button onClick={() => bridge.window.maximize()} title="Maximize">
            ▢
          </button>
          <button className="close" onClick={() => bridge.window.close()} title="Close">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
