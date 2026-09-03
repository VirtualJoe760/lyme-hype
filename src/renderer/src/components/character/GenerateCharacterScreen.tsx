import { useEffect, useState } from 'react'
import type { CastMode, CastProgress, Character, CharacterSpec, CharacterStyleView } from '@shared/types'
import { bridge } from '../../bridge'
import { useStudio } from '../../store'
import { BatchResultsGrid, type BatchItem } from '../BatchResultsGrid'
import { CharacterSpecForm, EMPTY_SPEC, specIsComplete } from './CharacterSpecForm'

/**
 * Generate Character (docs/ui/character-sheets-and-assets.md §2.2): the
 * casting screen — who (reference photos) + how (a cartoon style) + the lock
 * list → N candidates side by side → a vision review → approve. The approved
 * image lands on the canvas as a character node, which any Generate image run
 * can take as its character reference. Sheets and scenes come after.
 *
 * Three stages, walked back and forth like the Motion graphics wizard:
 * define → cast → approve.
 */

type Stage = 'define' | 'cast' | 'approve'
const MAX_REFS = 3

export function GenerateCharacterScreen(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const addNode = useStudio((s) => s.addNode)

  const [characters, setCharacters] = useState<Character[]>([])
  const [styles, setStyles] = useState<CharacterStyleView[]>([])
  const [stage, setStage] = useState<Stage>('define')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  // define
  const [characterId, setCharacterId] = useState<string | null>(null)
  const [spec, setSpec] = useState<CharacterSpec>(EMPTY_SPEC)
  const [styleId, setStyleId] = useState('')
  const [refs, setRefs] = useState<string[]>([])

  // cast
  const [mode, setMode] = useState<CastMode>('cast')
  const [count, setCount] = useState(4)
  const [aspect, setAspect] = useState('9:16')
  const [strength, setStrength] = useState(0.75)
  const [pending, setPending] = useState(0)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const character = characters.find((c) => c.id === characterId) ?? null

  async function reload(): Promise<Character[]> {
    const list = (await bridge.character.list()) ?? []
    setCharacters(list)
    return list
  }
  useEffect(() => {
    void reload()
    void bridge.character.styles().then((s) => setStyles(s ?? []))
  }, [])

  // Live lines from the engine while a cast or review runs.
  useEffect(
    () =>
      bridge.character.onProgress((p: CastProgress) => {
        if (p.characterId !== characterId) return
        setStatus(p.line)
        if (p.candidate) {
          setPending((n) => Math.max(0, n - 1))
          void reload()
        }
        if (p.error) setError(p.error)
      }),
    [characterId]
  )

  const imageNodes = nodes.filter((n) => n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src && !n.data.panel && !n.data.characterId)
  const style = styles.find((s) => s.id === styleId)

  function loadCharacter(c: Character | null): void {
    setCharacterId(c?.id ?? null)
    setSpec(c?.spec ?? EMPTY_SPEC)
    setStyleId(c?.styleId ?? '')
    setRefs(c?.referencePhotos ?? [])
    setPickedId(c?.approvedSrc ? (c.candidates.find((x) => x.src === c.approvedSrc)?.id ?? null) : null)
    setMode(c && c.referencePhotos.length > 0 ? 'convert' : 'cast')
    setError(null)
    setAdded(false)
  }

  async function save(): Promise<Character | null> {
    setError(null)
    try {
      const saved = await bridge.character.save({ id: characterId ?? undefined, spec, styleId, referencePhotos: refs })
      if (!saved) throw new Error('Could not save the character.')
      await reload()
      setCharacterId(saved.id)
      return saved
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  async function uploadPhoto(): Promise<void> {
    const imported = await bridge.media.import('image')
    if (!imported) return
    addNode({ label: imported.name, mediaType: 'image', source: 'upload', src: imported.src })
    setRefs((r) => (r.length < MAX_REFS && !r.includes(imported.src) ? [...r, imported.src] : r))
  }

  async function runCast(): Promise<void> {
    const saved = await save()
    if (!saved) return
    setBusy(true)
    setError(null)
    setPending(count)
    setStage('cast')
    try {
      const result = await bridge.character.cast({ characterId: saved.id, mode, count, aspect, seed: undefined, strength })
      if (result && !result.ok && result.error) setError(result.error)
    } finally {
      setPending(0)
      setBusy(false)
      await reload()
    }
  }

  async function runReview(): Promise<void> {
    if (!character) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.character.review(character.id)
      if (result && !result.ok && result.error) setError(result.error)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function approve(): Promise<void> {
    const candidate = character?.candidates.find((c) => c.id === pickedId)
    if (!character || !candidate) return
    setBusy(true)
    setError(null)
    try {
      const updated = await bridge.character.approve(character.id, candidate.src)
      if (!updated) throw new Error('Approve failed.')
      addNode({
        label: character.spec.name,
        mediaType: 'image',
        source: 'generate',
        src: candidate.src,
        characterId: character.id,
        startRendering: false
      })
      setAdded(true)
      setStage('approve')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const items: BatchItem[] = [
    ...(character?.candidates ?? []).map((c) => ({
      id: c.id,
      status: 'ok' as const,
      src: c.src,
      caption: `${c.mode} · seed ${c.seed}${c.score ? ` · ${c.score.total}` : ''}${character?.approvedSrc === c.src ? ' · ✓' : ''}`
    })),
    ...Array.from({ length: pending }, (_, i) => ({ id: `pending-${i}`, status: 'running' as const }))
  ]
  const picked = character?.candidates.find((c) => c.id === pickedId) ?? null
  const ranked = [...(character?.candidates ?? [])].filter((c) => c.score && !c.score.error).sort((a, b) => b.score!.total - a.score!.total)

  const STAGES: { key: Stage; label: string }[] = [
    { key: 'define', label: 'define' },
    { key: 'cast', label: 'cast' },
    { key: 'approve', label: 'approve' }
  ]
  const stageIndex = STAGES.findIndex((s) => s.key === stage)
  const canVisit = (t: Stage): boolean => !busy && (t === 'define' || (t === 'cast' && !!character) || (t === 'approve' && !!character?.approvedSrc))

  return (
    <div className="mgfx chr">
      <div className="mgfx-steps">
        {STAGES.map((s, i) => (
          <button
            key={s.key}
            className={`mgfx-step${i === stageIndex ? ' now' : i < stageIndex ? ' done' : ''}`}
            disabled={i === stageIndex || !canVisit(s.key)}
            onClick={() => setStage(s.key)}
          >
            <span className="mgfx-step-dot">{i < stageIndex ? '✓' : i + 1}</span>
            <span className="mgfx-step-label">{s.label}</span>
          </button>
        ))}
      </div>
      {error && <p className="mgfx-error">{error}</p>}

      {stage === 'define' && (
        <>
          <select
            className="cr-input"
            value={characterId ?? ''}
            disabled={busy}
            onChange={(e) => loadCharacter(characters.find((c) => c.id === e.target.value) ?? null)}
          >
            <option value="">+ New character</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.spec.name} · {c.styleId}
                {c.approvedSrc ? ' · approved' : c.candidates.length ? ` · ${c.candidates.length} candidates` : ''}
              </option>
            ))}
          </select>
          <CharacterSpecForm spec={spec} onChange={setSpec} styles={styles} styleId={styleId} onStyle={setStyleId} disabled={busy} />

          <p className="aside-help">
            Who: up to {MAX_REFS} photos of the real person (front, three-quarter, profile — neutral face, even light).
            Skip this for an invented character.
          </p>
          <div className="mgfx-ref-grid">
            {imageNodes.map((n) => (
              <button
                key={n.id}
                className={`mgfx-ref${refs.includes(n.data.src!) ? ' selected' : ''}`}
                title={n.data.label}
                disabled={busy}
                onClick={() =>
                  setRefs((r) =>
                    r.includes(n.data.src!) ? r.filter((s) => s !== n.data.src) : r.length < MAX_REFS ? [...r, n.data.src!] : r
                  )
                }
              >
                <img src={n.data.thumbSrc ?? n.data.src} alt={n.data.label} />
              </button>
            ))}
          </div>
          <div className="mgfx-row">
            <button className="conn-mini" disabled={busy} onClick={() => void uploadPhoto()}>
              ↑ Upload a photo
            </button>
            <span className="rail-util">{refs.length}/{MAX_REFS} selected</span>
          </div>

          <div className="chr-cast-controls">
            <select className="cr-input" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as CastMode)}>
              <option value="cast">Engine: style model (fast{refs.length ? ', img2img from photo 1' : ''})</option>
              <option value="convert" disabled={refs.length === 0}>
                Engine: photo → character (Qwen-Edit, best likeness, puts the outfit on)
              </option>
            </select>
            <div className="mgfx-row">
              <select className="cr-input chr-small" value={aspect} disabled={busy} onChange={(e) => setAspect(e.target.value)}>
                {['9:16', '1:1', '16:9', '3:4', '4:5'].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <label className="rail-util chr-count">
                ×
                <input type="number" min={1} max={8} value={count} disabled={busy} onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
              </label>
              <label className="rail-util chr-strength" title={mode === 'convert' ? 'LoRA polish denoise — 0 skips the polish pass' : 'img2img denoise — higher = more style, less photo'}>
                {mode === 'convert' ? 'polish' : 'strength'}
                <input type="range" min={0} max={1} step={0.05} value={strength} disabled={busy} onChange={(e) => setStrength(Number(e.target.value))} />
                <span>{strength.toFixed(2)}</span>
              </label>
            </div>
          </div>
          <button
            className="generate-btn"
            disabled={busy || !specIsComplete(spec) || !styleId || (style ? !style.ready : true) || (mode === 'convert' && refs.length === 0)}
            onClick={() => void runCast()}
          >
            {busy ? 'Working…' : `✦ Cast ${count} candidate${count > 1 ? 's' : ''} — local, $0`}
          </button>
        </>
      )}

      {stage === 'cast' && character && (
        <>
          <p className="aside-help">
            {busy ? status || 'Working…' : `${character.candidates.length} candidate(s). Pick one, or review them first.`}
          </p>
          <BatchResultsGrid items={items} selectedId={pickedId} onSelect={setPickedId} />
          {picked?.score && !picked.score.error && (
            <div className="chr-score">
              <b>{picked.score.total}</b> · likeness {picked.score.likeness} · lock list {picked.score.lockList} · anatomy {picked.score.anatomy} · style {picked.score.style}
              <p>{picked.score.notes}</p>
              {picked.score.issues.length > 0 && <p className="chr-issues">{picked.score.issues.join(' · ')}</p>}
            </div>
          )}
          {ranked.length > 0 && !picked?.score && (
            <p className="settings-hint">Top by review: seed {ranked[0]!.seed} ({ranked[0]!.score!.total}).</p>
          )}
          <div className="mgfx-row">
            <button className="conn-mini" disabled={busy} onClick={() => setStage('define')}>
              ← Adjust & cast more
            </button>
            <button
              className="conn-mini"
              disabled={busy || character.candidates.length === 0}
              title="The plan LLM scores every candidate against the photos and the lock list — LLM tokens only, nothing is generated"
              onClick={() => void runReview()}
            >
              ★ Review
            </button>
            <button className="conn-mini primary-mini" disabled={busy || !picked} onClick={() => void approve()}>
              ✓ Approve → canvas
            </button>
          </div>
          {character.lastReview && (
            <p className="settings-hint">
              Last review {new Date(character.lastReview.at).toLocaleTimeString()} · LLM tokens ${character.lastReview.llmTokenCostUsd.toFixed(3)} (plan) · generation cost $0
            </p>
          )}
        </>
      )}

      {stage === 'approve' && character && (
        <>
          {character.approvedSrc && <img className="mgfx-final" src={character.approvedSrc} alt={character.spec.name} />}
          <p className="cr-msg done">
            {added ? `"${character.spec.name}" is on the canvas as a character node.` : `"${character.spec.name}" is approved.`} Drag it onto
            Generate image to use it as the character reference, or onto Generate video as a start frame.
          </p>
          <div className="mgfx-row">
            <button className="conn-mini" disabled={busy} onClick={() => setStage('cast')}>
              ← Back to candidates
            </button>
            {!added && character.approvedSrc && (
              <button
                className="conn-mini"
                onClick={() => {
                  addNode({ label: character.spec.name, mediaType: 'image', source: 'generate', src: character.approvedSrc!, characterId: character.id, startRendering: false })
                  setAdded(true)
                }}
              >
                + Add to canvas
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
