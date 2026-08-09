import { useEffect, useState } from 'react'
import type { TrainedStyle } from '@shared/types'
import { bridge } from '../../bridge'

/**
 * Where trained LoRAs live (docs/ui/create-panel.md's firm decision): not
 * canvas nodes — a style is a reusable input to future generations, not
 * playable media. The Generate image tile picks these up as inputs.
 */
export function TrainedStylesTab(): React.JSX.Element {
  const [styles, setStyles] = useState<TrainedStyle[]>([])

  const refresh = (): void => {
    void bridge.lora.list().then(setStyles)
  }
  useEffect(refresh, [])

  return (
    <div className="settings-section">
      <p className="settings-intro">
        Styles trained through the Create panel's LoRA tile (Krea). A trained style shows up as an
        input choice on the Generate image screen.
      </p>
      <div className="settings-grid">
        {styles.length === 0 && (
          <p className="settings-hint">Nothing trained yet — Create › Create a LoRA.</p>
        )}
        {styles.map((style) => (
          <div key={style.id} className="settings-card">
            <div className="settings-card-head">
              <span className="name">{style.name}</span>
              <button
                className="del"
                title="Forget this style (does not delete it on Krea's side)"
                onClick={() => {
                  if (window.confirm(`Forget trained style "${style.name}"?`)) {
                    void bridge.lora.delete(style.id).then(refresh)
                  }
                }}
              >
                ✕ Forget
              </button>
            </div>
            <div className="meta">
              {style.trainer ?? style.connectorId} · {style.referenceImageCount} training image(s) ·{' '}
              {new Date(style.trainedAt).toLocaleDateString()}
              {style.loraUrl ? ' · weights saved' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
