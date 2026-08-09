import { useEffect, useState } from 'react'
import type { TrainedStyle } from '@shared/types'
import { bridge } from '../../bridge'
import { Button, StatusChip } from '../ui/Button'

/**
 * Where trained LoRAs live (docs/ui/create-panel.md's firm decision): not
 * canvas nodes — a style is a reusable input to future generations, not
 * playable media. The Generate image tile picks these up as inputs.
 *
 * Pairing an ElevenLabs voice with a trained identity turns it into a
 * "Reference person" (docs/ui/node-enrichment-strategy.md) — one record the
 * Deepfake tile can pick likeness and voice from together.
 */
function VoiceField(props: { style: TrainedStyle; onSaved: (style: TrainedStyle) => void }): React.JSX.Element {
  const [voiceName, setVoiceName] = useState(props.style.voiceName ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = voiceName.trim() !== (props.style.voiceName ?? '')

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const updated = await bridge.lora.setVoice(props.style.id, voiceName)
      if (updated) props.onSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-card-voice">
      <input
        className="cr-input"
        placeholder="ElevenLabs voice name (Reference person)"
        value={voiceName}
        onChange={(e) => setVoiceName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />
      <Button variant="mini" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? '…' : 'Save'}
      </Button>
    </div>
  )
}

/**
 * A Reference person's tone/persona tag ("calm authoritative newsreader") —
 * matched against a Storyboard shot's "feeling" annotation to auto-suggest
 * this person on the Deepfake screen (docs/ui/node-enrichment-strategy.md,
 * row 8), same shape as VoiceField above.
 */
function ToneField(props: { style: TrainedStyle; onSaved: (style: TrainedStyle) => void }): React.JSX.Element {
  const [personaTone, setPersonaTone] = useState(props.style.personaTone ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = personaTone.trim() !== (props.style.personaTone ?? '')

  async function save(): Promise<void> {
    setSaving(true)
    try {
      const updated = await bridge.lora.setTone(props.style.id, personaTone)
      if (updated) props.onSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-card-voice">
      <input
        className="cr-input"
        placeholder="Tone/persona (e.g. calm authoritative newsreader)"
        value={personaTone}
        onChange={(e) => setPersonaTone(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
      />
      <Button variant="mini" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? '…' : 'Save'}
      </Button>
    </div>
  )
}

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
        input choice on the Generate image screen. Pair a style with an ElevenLabs voice name to
        turn it into a Reference person the Deepfake tile can pick likeness + voice from together.
        Tag a Reference person's tone and a Storyboard shot's "feeling" can suggest them
        automatically on the Deepfake screen.
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
              {style.voiceName && <StatusChip kind="ok">voice: {style.voiceName}</StatusChip>}
              {style.personaTone && <StatusChip kind="ok">tone: {style.personaTone}</StatusChip>}
            </div>
            <VoiceField
              style={style}
              onSaved={(updated) =>
                setStyles((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
              }
            />
            <ToneField
              style={style}
              onSaved={(updated) =>
                setStyles((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}
