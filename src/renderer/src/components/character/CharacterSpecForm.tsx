import type { CharacterKind, CharacterSpec, CharacterStyleView } from '@shared/types'

export const EMPTY_SPEC: CharacterSpec = {
  name: '',
  kind: 'man',
  hair: '',
  eyes: '',
  outfit: ''
}

const KINDS: { id: CharacterKind; label: string }[] = [
  { id: 'man', label: 'man' },
  { id: 'woman', label: 'woman' },
  { id: 'boy', label: 'boy' },
  { id: 'girl', label: 'girl' },
  { id: 'creature', label: 'creature' },
  { id: 'animal', label: 'animal' },
  { id: 'robot', label: 'robot' }
]

/** The lock list, one field per thing that must never drift. Required fields
 *  are the four the SDXL prompt cannot do without; everything else is a
 *  "whatever you leave undefined, the model invents" reminder. */
const FIELDS: { key: keyof CharacterSpec; label: string; hint: string; required?: boolean }[] = [
  { key: 'hair', label: 'Hair', hint: 'short spiky dark brown, swept up', required: true },
  { key: 'eyes', label: 'Eyes', hint: 'dark brown', required: true },
  { key: 'outfit', label: 'Outfit', hint: 'orange martial arts gi, dark blue sash, blue boots', required: true },
  { key: 'age', label: 'Age', hint: 'early 30s' },
  { key: 'skin', label: 'Skin', hint: 'light · olive · dark' },
  { key: 'build', label: 'Build', hint: 'athletic, broad shoulders' },
  { key: 'accessories', label: 'Accessories', hint: 'round glasses, gold watch' },
  { key: 'distinguishing', label: 'Distinguishing', hint: 'clean-shaven, strong jaw, big friendly grin' },
  { key: 'personality', label: 'Personality', hint: 'cheerful, confident (sets the expression)' },
  { key: 'species', label: 'Species', hint: 'only for creatures / animals / robots' }
]

export function specIsComplete(spec: CharacterSpec): boolean {
  return !!(spec.name.trim() && spec.hair.trim() && spec.eyes.trim() && spec.outfit.trim())
}

export function CharacterSpecForm(props: {
  spec: CharacterSpec
  onChange: (spec: CharacterSpec) => void
  styles: CharacterStyleView[]
  styleId: string
  onStyle: (id: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const { spec, onChange, disabled } = props
  const set = (key: keyof CharacterSpec, value: string): void => onChange({ ...spec, [key]: value })
  const style = props.styles.find((s) => s.id === props.styleId)
  return (
    <div className="chr-form">
      <div className="chr-row">
        <input
          className="cr-input chr-name"
          placeholder="Character name"
          value={spec.name}
          disabled={disabled}
          onChange={(e) => set('name', e.target.value)}
        />
        <select className="cr-input chr-kind" value={spec.kind} disabled={disabled} onChange={(e) => set('kind', e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <select className="cr-input" value={props.styleId} disabled={disabled} onChange={(e) => props.onStyle(e.target.value)}>
        <option value="">Style…</option>
        {props.styles.map((s) => (
          <option key={s.id} value={s.id}>
            {s.ready ? '' : '⬇ '}
            {s.label}
            {s.ready ? '' : ` — needs ${(s.missingMB / 1000).toFixed(1)} GB`}
          </option>
        ))}
      </select>
      {style && !style.ready && (
        <p className="settings-hint">
          Not on disk: {style.missing.join(', ')}. Download with the lab’s <code>ensure {style.id}</code>.
        </p>
      )}
      {style?.notes && <p className="settings-hint">{style.notes}</p>}
      <p className="aside-help chr-lock-help">
        The lock list. Whatever you leave undefined, the model invents — every scene reuses exactly this.
      </p>
      <div className="chr-fields">
        {FIELDS.map((f) => (
          <label key={f.key} className="chr-field">
            <span className={`rail-util${f.required ? ' chr-required' : ''}`}>{f.label}</span>
            <input
              className="cr-input"
              placeholder={f.hint}
              value={(spec[f.key] as string | undefined) ?? ''}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
