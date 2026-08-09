import { bridge } from '../bridge'

export function TitleBar(): React.JSX.Element {
  return (
    <div className="titlebar">
      <div className="brand">
        {/* A whole (uncut) lime — body, stem nub, leaf, sheen. The brand's
            hue-rotate animation cycles it and the wordmark together. */}
        <svg className="lime" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="13.4" rx="9.2" ry="8.4" fill="currentColor" />
          <ellipse cx="9" cy="10.6" rx="3.4" ry="2.4" fill="#ffffff" opacity="0.28" />
          <rect x="11.1" y="3.2" width="1.8" height="2.6" rx="0.9" fill="currentColor" opacity="0.75" />
          <path d="M13 4.6 C 16.4 2.4, 19.6 3.4, 20.4 4.4 C 18.4 6.4, 15.2 6.6, 13 4.6 Z" fill="currentColor" opacity="0.55" />
        </svg>
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
