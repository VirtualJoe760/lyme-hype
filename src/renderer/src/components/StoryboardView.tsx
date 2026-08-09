import { useEffect, useMemo, useState } from 'react'
import type { MediaType } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'

const MEDIA_TYPES: MediaType[] = ['video', 'image', 'audio']
const MEDIA_GLYPH: Record<MediaType, string> = { video: '▶', image: '▦', audio: '♪' }

/** The interchangeable storyboard-tier image connectors (docs/connectors/catalog.md). */
const STORYBOARD_IMAGE_CONNECTORS: { id: string; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openai', label: 'OpenAI' }
]

export function StoryboardView(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const addPanel = useStudio((s) => s.addPanel)
  const updatePanel = useStudio((s) => s.updatePanel)
  const movePanel = useStudio((s) => s.movePanel)
  const promotePanel = useStudio((s) => s.promotePanel)
  const removeNode = useStudio((s) => s.removeNode)
  const setView = useStudio((s) => s.setView)
  const improvePanelPrompt = useStudio((s) => s.improvePanelPrompt)
  const improvingPanelId = useStudio((s) => s.improvingPanelId)

  const [installedIds, setInstalledIds] = useState<string[]>([])
  useEffect(() => {
    void bridge.connectors.list().then((list) => setInstalledIds(list.map((c) => c.id)))
  }, [])
  const imageChoices = STORYBOARD_IMAGE_CONNECTORS.filter((c) => installedIds.includes(c.id))

  const panels = useMemo(
    () =>
      nodes
        .filter((n) => n.data.panel)
        .sort((a, b) => (a.data.panelOrder ?? 0) - (b.data.panelOrder ?? 0)),
    [nodes]
  )

  return (
    <div className="storyboard">
      {panels.length === 0 && (
        <p className="note">
          Storyboard is for blocking out shots cheaply before spending a real generation. Add
          panels, sketch the intent, reorder them, then <strong>promote</strong> one — the same
          panel becomes a real generating node on the Canvas.
        </p>
      )}

      <div className="grid">
        {panels.map((panel, i) => {
          const mediaType = panel.data.mediaType
          const promoted = panel.data.promoted === true
          return (
            <div key={panel.id} className={`panel${promoted ? ' promoted' : ''}`}>
              <div className="panel-head">
                <span className="panel-order">{String(i + 1).padStart(2, '0')}</span>
                <div className="panel-types">
                  {MEDIA_TYPES.map((mt) => (
                    <button
                      key={mt}
                      className={`panel-type${mediaType === mt ? ' active' : ''}`}
                      title={mt}
                      disabled={promoted}
                      onClick={() => updatePanel(panel.id, { mediaType: mt })}
                    >
                      {MEDIA_GLYPH[mt]}
                    </button>
                  ))}
                </div>
                <button
                  className="panel-del"
                  title="Delete panel"
                  onClick={() => removeNode(panel.id)}
                >
                  ✕
                </button>
              </div>

              <div className={`panel-sketch sw${panel.data.swatch}`}>
                <span className="panel-glyph">{MEDIA_GLYPH[mediaType]}</span>
              </div>

              <input
                className="cr-input panel-label"
                value={panel.data.label}
                placeholder="Shot label"
                onChange={(e) => updatePanel(panel.id, { label: e.target.value })}
              />
              {panel.data.shotDescription && (
                <p className="panel-shot-desc" title={panel.data.shotDescription}>
                  {panel.data.shotDescription}
                </p>
              )}
              {panel.data.shotDescription && !promoted && (
                <div className="panel-feeling-row">
                  <input
                    className="cr-input panel-feeling"
                    value={panel.data.feeling ?? ''}
                    placeholder="Feeling — mood/tone, a few words"
                    onChange={(e) => updatePanel(panel.id, { feeling: e.target.value })}
                  />
                  <button
                    className="conn-mini"
                    disabled={improvingPanelId !== null}
                    title="Have the agent author this panel's generation prompt from the shot + feeling"
                    onClick={() => void improvePanelPrompt(panel.id)}
                  >
                    {improvingPanelId === panel.id ? '…' : '✨'}
                  </button>
                </div>
              )}
              <textarea
                className="prompt-area panel-note"
                value={panel.data.note ?? ''}
                placeholder="What happens in this shot? (becomes the generation prompt)"
                rows={2}
                onChange={(e) => updatePanel(panel.id, { note: e.target.value })}
              />
              {mediaType === 'image' && !promoted && imageChoices.length > 0 && (
                <select
                  className="cr-input panel-model"
                  value={panel.data.connectorId ?? ''}
                  title="Storyboard-tier image model for this panel"
                  onChange={(e) =>
                    updatePanel(panel.id, { connectorId: e.target.value || undefined })
                  }
                >
                  <option value="">Model: agent picks</option>
                  {imageChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      Model: {c.label}
                    </option>
                  ))}
                </select>
              )}

              <div className="panel-actions">
                <button
                  className="conn-mini"
                  title="Move earlier"
                  disabled={i === 0}
                  onClick={() => movePanel(panel.id, -1)}
                >
                  ◀
                </button>
                <button
                  className="conn-mini"
                  title="Move later"
                  disabled={i === panels.length - 1}
                  onClick={() => movePanel(panel.id, 1)}
                >
                  ▶
                </button>
                <span className="play-header-spacer" />
                {promoted ? (
                  <button className="conn-mini" onClick={() => setView('canvas')}>
                    On canvas →
                  </button>
                ) : (
                  <button
                    className="conn-mini primary-mini"
                    title="Turn this panel into a real generating node on the Canvas"
                    onClick={() => {
                      // Storyboard-tier default: an image panel with no explicit
                      // model choice uses the single installed storyboard
                      // connector when there's exactly one (catalog.md).
                      if (
                        mediaType === 'image' &&
                        !panel.data.connectorId &&
                        imageChoices.length === 1
                      ) {
                        updatePanel(panel.id, { connectorId: imageChoices[0].id })
                      }
                      promotePanel(panel.id)
                      setView('canvas')
                    }}
                  >
                    ↑ Promote
                  </button>
                )}
              </div>
            </div>
          )
        })}

        <button className="panel-add" onClick={() => addPanel()}>
          <span className="panel-add-plus">+</span>
          Add panel
        </button>
      </div>
    </div>
  )
}
