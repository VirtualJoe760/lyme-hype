import { useEffect, useState } from 'react'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { BatchResultsGrid, type BatchItem } from './BatchResultsGrid'

/**
 * The Motion graphics tile's multi-stage wizard (docs/ui/create-panel.md),
 * confirmed against the JBook's Creative reference workflow:
 * references → agent-authored prompt variations → batch-generate grid review →
 * iterate → reference-reinforced final image → start/end-frame animated video →
 * optional loop + local ffmpeg alpha keying.
 *
 * Conversational stages (abstraction, iterate) ride the SAME multi-turn
 * plumbing the Scripting panel built (bridge.scripting.turn) — one module,
 * two consumers.
 */

type Stage = 'refs' | 'variations' | 'batch' | 'final' | 'animate' | 'alpha'

/** 2 variations × 2 images each for v1 (the spec's cost-conscious default,
 *  down from the tutorial's 4×4). */
const VARIATION_COUNT = 2
const IMAGES_PER_VARIATION = 2

/** Matches gemini-mcp.cjs's MAX_REFERENCE_IMAGES — Nano Banana 2 accepts up to
 *  10 object refs (old guidance was 3, gemini-2.5-era); OpenAI's wrapper takes
 *  even more (16, undocumented cap), so 10 is the binding limit either way. */
const MAX_REF_IMAGES = 10

const STORYBOARD_IMAGE_CONNECTORS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openai', label: 'OpenAI' }
]

/** Veo 3.1 variants the Gemini wrapper's gemini_generate_video tool accepts as
 *  `model` (resources/gemini-mcp.cjs's VIDEO_MODELS) — surfaced here so a
 *  reveal/loop iteration pass can use lite (~8x cheaper, 720p) and only the
 *  final render pays for the default quality tier. Passed as `modelHint`,
 *  which lands in the agent's prompt verbatim (generation.ts's buildPrompt) —
 *  using the literal model id keeps it an unambiguous match against the
 *  tool's own enum rather than a label the agent has to interpret.
 */
const VIDEO_TIERS: { id: string; label: string }[] = [
  { id: '', label: 'Quality: default (veo-3.1, best result)' },
  { id: 'veo-3.1-fast-generate-preview', label: 'Quality: fast (balanced cost/speed)' },
  { id: 'veo-3.1-lite-generate-preview', label: 'Quality: lite (720p, cheapest — good for iterating)' }
]

const DEFAULT_MOTION_PROMPT = [
  '0-2s: the canvas is a flat solid background; fragments of the design begin to condense from light.',
  '2-4s: the elements sweep into place with smooth, confident motion.',
  '4-6s: the finished design locks in exactly as the final frame, holds steady.'
].join('\n')

let batchCounter = 0

export function MotionGraphicsWizard(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const addNode = useStudio((s) => s.addNode)
  const generateMedia = useStudio((s) => s.generateMedia)
  const activeSessionId = useStudio((s) => s.activeSessionId)

  const [stage, setStage] = useState<Stage>('refs')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Stage 1 — references
  const [refIds, setRefIds] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')

  // Stage 2 — variations (+ the shared conversation)
  const [agentSessionId, setAgentSessionId] = useState<string | undefined>()
  const [variations, setVariations] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')

  // Stage 3 — batch
  const [connectorChoice, setConnectorChoice] = useState('')
  const [muapiEditMode, setMuapiEditMode] = useState(false)
  const [installedIds, setInstalledIds] = useState<string[]>([])
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [pickedId, setPickedId] = useState<string | null>(null)

  // Stage 4 — final
  const [finalSrc, setFinalSrc] = useState<string | null>(null)

  // Stage 5 — animate
  const [bgColor, setBgColor] = useState('#000000')
  const [loop, setLoop] = useState(false)
  const [motionPrompt, setMotionPrompt] = useState(DEFAULT_MOTION_PROMPT)
  const [videoTier, setVideoTier] = useState('')
  const [animateStarted, setAnimateStarted] = useState(false)

  // Stage 6 — alpha
  const [alphaNodeId, setAlphaNodeId] = useState('')
  const [alphaDone, setAlphaDone] = useState(false)

  useEffect(() => {
    void bridge.connectors.list().then((list) => setInstalledIds(list.map((c) => c.id)))
  }, [])
  const imageConnectors = STORYBOARD_IMAGE_CONNECTORS.filter((c) => installedIds.includes(c.id))
  const muapiAvailable = installedIds.includes('muapi')
  const useMuapiEdit = muapiEditMode && muapiAvailable

  const imageNodes = nodes.filter(
    (n) => n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src && !n.data.panel
  )
  const refSrcs = refIds
    .map((id) => imageNodes.find((n) => n.id === id)?.data.src)
    .filter((s): s is string => !!s)
  const gfxVideoNodes = nodes.filter(
    (n) => n.data.mediaType === 'video' && n.data.status === 'ready' && n.data.src && !n.data.panel
  )

  function conversationId(): string {
    return `mgfx-${activeSessionId ?? 'none'}`
  }

  function parseVariations(text: string): string[] {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      const parsed: unknown = JSON.parse(match[0])
      return (Array.isArray(parsed) ? parsed : []).map((v) => String(v)).filter((v) => v.trim())
    } catch {
      return []
    }
  }

  async function runAbstraction(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const result = await bridge.scripting.turn({
        conversationId: conversationId(),
        resumeSessionId: agentSessionId,
        prompt: [
          `Look at the attached reference images. ${instruction.trim()}`,
          `Combine their styles into ${VARIATION_COUNT} DISTINCT text prompts for an image generation model — different takes, not rewordings.`,
          'Each prompt must describe a design on a flat, fully opaque solid background (no partial transparency).',
          `Reply with ONLY a JSON array of ${VARIATION_COUNT} strings.`
        ].join('\n'),
        imagePaths: refSrcs,
        systemPrompt:
          'You are a motion-graphics art director authoring precise prompts for image generation models. You reply with only what is asked, no commentary.'
      })
      if (!result?.ok) {
        setError(result?.error ?? 'The agent did not respond.')
        return
      }
      setAgentSessionId(result.agentSessionId ?? agentSessionId)
      const parsed = parseVariations(result.text)
      if (parsed.length === 0) {
        setError('The agent did not return parsable prompt variations — try again.')
        return
      }
      setVariations(parsed.slice(0, VARIATION_COUNT))
      setStage('variations')
    } finally {
      setBusy(false)
    }
  }

  async function runRevision(): Promise<void> {
    if (!feedback.trim()) return
    setError(null)
    setBusy(true)
    try {
      const result = await bridge.scripting.turn({
        conversationId: conversationId(),
        resumeSessionId: agentSessionId,
        prompt: [
          `Revise the prompts with this feedback: ${feedback.trim()}`,
          `Reply with ONLY a JSON array of ${VARIATION_COUNT} strings.`
        ].join('\n'),
        history: variations.length
          ? [{ role: 'assistant', text: JSON.stringify(variations) }]
          : undefined
      })
      if (!result?.ok) {
        setError(result?.error ?? 'The agent did not respond.')
        return
      }
      setAgentSessionId(result.agentSessionId ?? agentSessionId)
      const parsed = parseVariations(result.text)
      if (parsed.length === 0) {
        setError('No parsable revision came back — try rewording the feedback.')
        return
      }
      setVariations(parsed.slice(0, VARIATION_COUNT))
      setFeedback('')
    } finally {
      setBusy(false)
    }
  }

  async function runBatch(): Promise<void> {
    setError(null)
    setPickedId(null)
    setBusy(true)
    const items: BatchItem[] = []
    for (let v = 0; v < variations.length; v++) {
      for (let i = 0; i < IMAGES_PER_VARIATION; i++) {
        batchCounter += 1
        items.push({ id: `b${batchCounter}`, status: 'running', caption: `v${v + 1}.${i + 1}` })
      }
    }
    setBatch(items)
    setStage('batch')
    const editingRef = useMuapiEdit && refSrcs.length > 0 ? refSrcs[0] : undefined
    await Promise.all(
      items.map(async (item, index) => {
        const variation = variations[Math.floor(index / IMAGES_PER_VARIATION)]
        const result = await bridge.generate
          .run({
            mediaType: 'image',
            prompt: variation,
            connectorId: editingRef ? 'muapi' : connectorChoice || undefined,
            referenceImagePaths: editingRef ? [editingRef] : undefined
          })
          .catch((err) => ({ ok: false as const, mediaType: 'image' as const, error: String(err), src: undefined }))
        setBatch((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? result?.ok && result.src
                ? { ...b, status: 'ok', src: result.src }
                : { ...b, status: 'error', error: (result && 'error' in result ? result.error : undefined) ?? 'failed' }
              : b
          )
        )
      })
    )
    setBusy(false)
  }

  async function runFinalPass(): Promise<void> {
    const picked = batch.find((b) => b.id === pickedId)
    if (!picked) return
    const variation = variations[Math.floor(batch.indexOf(picked) / IMAGES_PER_VARIATION)]
    setError(null)
    setBusy(true)
    setStage('final')
    setFinalSrc(null)
    try {
      // Reference-reinforced: the winning prompt regenerated WITH the original
      // reference images as input — the workflow's key quality step. muapi's
      // edit mode can only take one image (muapi_image_edit's single image_url
      // param), so it reuses the same first reference the batch pass edited
      // rather than all of refSrcs.
      const editingRef = useMuapiEdit && refSrcs.length > 0 ? refSrcs[0] : undefined
      const result = await bridge.generate.run({
        mediaType: 'image',
        prompt: variation,
        connectorId: editingRef ? 'muapi' : connectorChoice || undefined,
        referenceImagePaths: editingRef ? [editingRef] : refSrcs
      })
      if (result?.ok && result.src) {
        setFinalSrc(result.src)
      } else {
        setError(result?.error ?? 'Final pass failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function runAnimate(): Promise<void> {
    if (!finalSrc) return
    setError(null)
    setBusy(true)
    try {
      let startSrc = finalSrc
      if (!loop) {
        // Solid-color start frame matching the design's background, drawn
        // locally — no generation call for a flat rectangle.
        const canvas = document.createElement('canvas')
        canvas.width = 1080
        canvas.height = 1920
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const saved = await bridge.media.saveDataUrl(canvas.toDataURL('image/png'))
        if (!saved?.ok || !saved.src) {
          setError(saved?.error ?? 'Could not save the start frame.')
          return
        }
        startSrc = saved.src
      }
      void generateMedia({
        label: loop ? 'gfx_loop' : 'gfx_reveal',
        mediaType: 'video',
        motionGfx: true,
        prompt: motionPrompt,
        connectorId: installedIds.includes('gemini') ? 'gemini' : undefined,
        modelHint: videoTier || undefined,
        startFramePath: startSrc,
        endFramePath: finalSrc
      })
      setAnimateStarted(true)
      setStage('alpha')
    } finally {
      setBusy(false)
    }
  }

  async function runAlphaKey(): Promise<void> {
    const node = gfxVideoNodes.find((n) => n.id === alphaNodeId)
    if (!node?.data.src) return
    setError(null)
    setBusy(true)
    try {
      const result = await bridge.media.keyAlpha({ assetUrl: node.data.src, color: bgColor })
      if (result?.ok && result.src) {
        addNode({
          label: `${node.data.label}_alpha`,
          mediaType: 'video',
          source: 'upload',
          motionGfx: true,
          src: result.src,
          startRendering: false
        })
        setAlphaDone(true)
      } else {
        setError(result?.error ?? 'Alpha keying failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  const STAGES: { key: Stage; label: string }[] = [
    { key: 'refs', label: 'refs' },
    { key: 'variations', label: 'prompts' },
    { key: 'batch', label: 'batch' },
    { key: 'final', label: 'final' },
    { key: 'animate', label: 'animate' },
    { key: 'alpha', label: 'alpha' }
  ]
  const stageIndex = STAGES.findIndex((s) => s.key === stage)
  // A visited stage keeps its state, so walking back is plain navigation —
  // "iterate" is just clicking an earlier dot (create-panel v2).
  function canVisit(target: Stage): boolean {
    if (busy) return false
    switch (target) {
      case 'refs':
        return true
      case 'variations':
        return variations.length > 0
      case 'batch':
        return batch.length > 0
      case 'final':
        return finalSrc !== null || pickedId !== null
      case 'animate':
        return finalSrc !== null
      case 'alpha':
        return animateStarted || gfxVideoNodes.length > 0
    }
  }

  return (
    <div className="mgfx">
      <div className="mgfx-steps">
        {STAGES.map((s, i) => (
          <button
            key={s.key}
            className={`mgfx-step${i === stageIndex ? ' now' : i < stageIndex ? ' done' : ''}`}
            disabled={i === stageIndex || !canVisit(s.key)}
            title={s.label}
            onClick={() => setStage(s.key)}
          >
            <span className="mgfx-step-dot">{i < stageIndex ? '✓' : i + 1}</span>
            <span className="mgfx-step-label">{s.label}</span>
          </button>
        ))}
      </div>
      {error && <p className="mgfx-error">{error}</p>}

      {stage === 'refs' && (
        <>
          <p className="aside-help">
            Pick 1–{MAX_REF_IMAGES} reference images from the canvas (upload them first if needed),
            describe the design, and the agent abstracts their style into prompt variations.
          </p>
          <div className="mgfx-ref-grid">
            {imageNodes.length === 0 && (
              <p className="settings-hint">No ready image nodes on the canvas yet — Upload some references first.</p>
            )}
            {imageNodes.map((n) => (
              <button
                key={n.id}
                className={`mgfx-ref${refIds.includes(n.id) ? ' selected' : ''}`}
                title={n.data.label}
                onClick={() =>
                  setRefIds((ids) =>
                    ids.includes(n.id)
                      ? ids.filter((i) => i !== n.id)
                      : ids.length < MAX_REF_IMAGES
                        ? [...ids, n.id]
                        : ids
                  )
                }
              >
                <img src={n.data.src} alt={n.data.label} />
              </button>
            ))}
          </div>
          <textarea
            className="prompt-area"
            placeholder={'e.g. combine the style of these into a logo for the word "LYME"'}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          {imageConnectors.length > 1 && (
            <select
              className="cr-input mgfx-select"
              value={connectorChoice}
              disabled={useMuapiEdit}
              onChange={(e) => setConnectorChoice(e.target.value)}
            >
              <option value="">Image model: agent picks</option>
              {imageConnectors.map((c) => (
                <option key={c.id} value={c.id}>Image model: {c.label}</option>
              ))}
            </select>
          )}
          {muapiAvailable && (
            <label className="mgfx-checkbox">
              <input
                type="checkbox"
                checked={muapiEditMode}
                disabled={refIds.length === 0}
                onChange={(e) => setMuapiEditMode(e.target.checked)}
              />
              Batch via muapi image-edit — edits your first picked reference photo per variation,
              instead of generating from text alone
            </label>
          )}
          <button
            className="generate-btn"
            disabled={busy || refIds.length === 0 || !instruction.trim()}
            onClick={() => void runAbstraction()}
          >
            {busy ? 'Thinking…' : '→ Author prompt variations'}
          </button>
        </>
      )}

      {stage === 'variations' && (
        <>
          <p className="aside-help">Edit the variations directly, or give feedback and let the agent revise them.</p>
          {variations.map((v, i) => (
            <textarea
              key={i}
              className="prompt-area mgfx-variation"
              value={v}
              onChange={(e) =>
                setVariations((vs) => vs.map((x, xi) => (xi === i ? e.target.value : x)))
              }
            />
          ))}
          <div className="mgfx-row">
            <input
              className="cr-input"
              placeholder="Feedback — e.g. make it blue-purple, remove red"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <button className="conn-mini" disabled={busy || !feedback.trim()} onClick={() => void runRevision()}>
              {busy ? '…' : 'Revise'}
            </button>
          </div>
          <button className="generate-btn" disabled={busy} onClick={() => void runBatch()}>
            ⇒ Generate {variations.length}×{IMAGES_PER_VARIATION} batch
          </button>
        </>
      )}

      {stage === 'batch' && (
        <>
          <p className="aside-help">Pick a favorite to carry forward.</p>
          <BatchResultsGrid items={batch} selectedId={pickedId} onSelect={setPickedId} />
          <div className="mgfx-row">
            <button className="conn-mini" disabled={busy} onClick={() => setStage('variations')}>
              ← Iterate on prompts
            </button>
            <button
              className="conn-mini primary-mini"
              disabled={busy || !pickedId}
              onClick={() => void runFinalPass()}
            >
              → Reference-reinforced final pass
            </button>
          </div>
        </>
      )}

      {stage === 'final' && (
        <>
          {!finalSrc && <p className="aside-help">{busy ? 'Regenerating the winner with your reference images mixed in…' : 'Final pass.'}</p>}
          {finalSrc && (
            <>
              <img className="mgfx-final" src={finalSrc} alt="final" />
              <div className="mgfx-row">
                <button
                  className="conn-mini"
                  onClick={() =>
                    addNode({
                      label: 'gfx_final',
                      mediaType: 'image',
                      source: 'generate',
                      motionGfx: true,
                      src: finalSrc,
                      startRendering: false
                    })
                  }
                >
                  + Add to canvas
                </button>
                <button className="conn-mini primary-mini" onClick={() => setStage('animate')}>
                  → Animate
                </button>
              </div>
            </>
          )}
          {!busy && !finalSrc && (
            <button className="conn-mini" onClick={() => setStage('batch')}>← Back to batch</button>
          )}
        </>
      )}

      {stage === 'animate' && (
        <>
          <p className="aside-help">
            The finished image becomes the video's end frame. A solid frame in its background color
            starts the reveal — or loop with the image as both frames.
          </p>
          <div className="mgfx-row">
            <button className="conn-mini" disabled={busy} onClick={() => setStage('final')}>
              ← Back to final image
            </button>
          </div>
          <label className="mgfx-row">
            <span className="rail-util">Background</span>
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
            <label className="rail-util mgfx-loop">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              Seamless loop (same frame both ends)
            </label>
          </label>
          <textarea
            className="prompt-area mgfx-motion"
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value)}
          />
          {installedIds.includes('gemini') && (
            <select
              className="cr-input mgfx-select"
              value={videoTier}
              onChange={(e) => setVideoTier(e.target.value)}
            >
              {VIDEO_TIERS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          )}
          <button className="generate-btn" disabled={busy} onClick={() => void runAnimate()}>
            {busy ? 'Starting…' : '▶ Generate the animation'}
          </button>
        </>
      )}

      {stage === 'alpha' && (
        <>
          {animateStarted && (
            <p className="aside-help">
              The animation is rendering as a node on the Canvas. Once it's ready, key its
              background to real transparency here (local ffmpeg — no After Effects).
            </p>
          )}
          <select
            className="cr-input mgfx-select"
            value={alphaNodeId}
            onChange={(e) => setAlphaNodeId(e.target.value)}
          >
            <option value="">Pick the rendered video node…</option>
            {gfxVideoNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label}
              </option>
            ))}
          </select>
          <button
            className="generate-btn"
            disabled={busy || !alphaNodeId}
            onClick={() => void runAlphaKey()}
          >
            {busy ? 'Keying…' : '◇ Key background → alpha (webm)'}
          </button>
          {alphaDone && (
            <p className="cr-msg done">
              Alpha version added to the canvas — drag it onto Video 2 in the timeline to overlay it.
            </p>
          )}
          <button
            className="conn-mini"
            disabled={busy}
            title="Back to the animate stage (e.g. to retry a failed render)"
            onClick={() => setStage('animate')}
          >
            ← Back to animate
          </button>
        </>
      )}
    </div>
  )
}
