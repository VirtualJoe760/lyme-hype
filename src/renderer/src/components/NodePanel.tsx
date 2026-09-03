import { useEffect, useMemo, useState } from 'react'
import {
  effectiveParameters,
  handoffsFor,
  modelPickerOrder,
  reconcileModel,
  type CatalogModel
} from '@shared/model-catalog'
import { THIN_PROMPT_CHARS, promptIsThin } from '@shared/generation-policy'
import {
  EMPTY_NODES,
  Icon,
  MEDIA_ROLES,
  TakesStepper,
  acceptedMedia,
  enhanceImagesFor,
  hWheelRef,
  readyConnectorIds
} from './node-panel/support'
import { SettingSheets } from './node-panel/SettingSheets'
import { TakePreview } from './node-panel/TakePreview'
import type { NodeManifest, NodeToolDef } from '@shared/node-manifest'
import type { ConnectorView, TrainedStyle, VoiceEntry } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { Button } from './ui/Button'
export function NodePanel(props: {
  manifest: NodeManifest
  connectors: ConnectorView[]
  styles?: TrainedStyle[]
  onBack?: () => void
}): React.JSX.Element {
  const { manifest } = props
  const stage = useStudio((s) => s.nodeStage(manifest.id))
  const setNodeTool = useStudio((s) => s.setNodeTool)
  const setNodeModel = useStudio((s) => s.setNodeModel)
  const selectTake = useStudio((s) => s.selectTake)
  const stageGenerate = useStudio((s) => s.stageGenerate)
  const commitStage = useStudio((s) => s.commitStage)
  const focusNode = useStudio((s) => s.focusNode)
  const openSettings = useStudio((s) => s.openSettings)
  const openEditor = useStudio((s) => s.openEditor)
  const applyHandoff = useStudio((s) => s.applyHandoff)
  const setNodeInput = useStudio((s) => s.setNodeInput)
  const stageAudio = useStudio((s) => s.stageAudio)
  const trainLora = useStudio((s) => s.trainLora)
  const toggleDatasetImage = useStudio((s) => s.toggleDatasetImage)
  const clearDataset = useStudio((s) => s.clearDataset)
  const nodeInputs = useStudio((s) => s.nodeInputs)
  const editorMask = useStudio((s) => s.editor?.mask)

  const [prompt, setPrompt] = useState('')
  const [takes, setTakes] = useState(1)
  const [styleId, setStyleId] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  // Per-reference role (gemini's typed refs: object/character/style) and the
  // img2img inspiration dial (local models) — both only rendered when the
  // picked model can actually consume them.
  const [refTypes, setRefTypes] = useState<Record<string, 'object' | 'character' | 'style'>>({})
  const [refStrength, setRefStrength] = useState(0.6)
  const [lightbox, setLightbox] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [voice, setVoice] = useState('')
  const [voiceList, setVoiceList] = useState<VoiceEntry[]>([])
  const [loraKind, setLoraKind] = useState<'subject' | 'style'>('subject')
  const [steps, setSteps] = useState(1000)
  const [training, setTraining] = useState(false)
  const [trainError, setTrainError] = useState<string | null>(null)
  const [openSetting, setOpenSetting] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(manifest.parameters.map((p) => [p.id, p.options?.[0] ?? '']))
  )

  // Subscribing to the whole `nodes` array re-rendered this entire panel on every
  // pointer move of a canvas drag — onNodesChange fires per frame while dragging. The
  // pickers are the only thing here that reads nodes and they are shut almost always,
  // so the subscription is scoped to when one is actually open.
  //
  // The selector still returns the store's own array reference rather than a filtered
  // copy: a selector that builds a new array fails zustand's snapshot equality and
  // loops forever (the bug that blanked this panel the first time it rendered).
  const pickerOpen = openSetting !== null
  const nodes = useStudio((s) => (pickerOpen ? s.nodes : EMPTY_NODES))
  const canvasImages = useMemo(
    () => nodes.filter((n) => n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src),
    [nodes]
  )

  const style = props.styles?.find((s) => s.id === styleId)
  const dataset = useStudio((s) => s.nodeDataset)[manifest.id] ?? []

  // Voices come from the live connector, not a hardcoded list — opening the square is
  // what pays for the lookup, so nodes without a voice setting never make the call.
  useEffect(() => {
    if (openSetting !== 'voice' || voiceList.length > 0) return
    void bridge.audioTools.voices('').then((r) => {
      if (r?.voices) setVoiceList(r.voices)
    })
  }, [openSetting, voiceList.length])

  const ready = useMemo(() => readyConnectorIds(props.connectors), [props.connectors])
  // Dataset tools mutate the preview and return; they are never the *active* tool, so
  // they can't be the fallback either — LoRA would otherwise open with "add images"
  // selected and put its verb on the primary button.
  const tool: NodeToolDef = useMemo(() => {
    const runnable = manifest.tools.filter(
      (t) => t.exec !== 'dataset-add' && t.exec !== 'dataset-remove'
    )
    return runnable.find((t) => t.id === stage.toolId) ?? runnable[0] ?? manifest.tools[0]
  }, [manifest, stage.toolId])

  const activeTake = stage.takes[stage.activeIndex]
  const hasArtifact = !!activeTake && activeTake.status === 'ready'

  // The same model is often resold by several connectors (eleven v3 on both ElevenLabs
  // and Yapper). Two identically-labelled pills that route differently is exactly the
  // ambiguity the pill row exists to remove, so collisions carry their connector.
  // Attached media re-frames the model row to models that can actually take it:
  // an end frame narrows to frame-conditioning; a start image alone narrows to
  // i2v. Without this, a t2v-only model (seedance fast) accepted a start image
  // in the UI and died at the connector — the "control that cannot run" bug,
  // observed live 2026-08-30. muapi's FLF models are deliberately absent from
  // `video-frame-conditioning` — its MCP video tool has a single image_url and
  // no end-frame parameter, so they could never run it.
  const endFrameSet = !!(nodeInputs[manifest.id] ?? {})['endFrame']
  const startFrameSet = !!(
    (nodeInputs[manifest.id] ?? {})['startFrame'] ?? (nodeInputs[manifest.id] ?? {})['sourceImage']
  )
  const rowCapability =
    manifest.media === 'video' && endFrameSet
      ? 'video-frame-conditioning'
      : manifest.media === 'video' && startFrameSet && tool.capability === 'video-gen-t2v'
        ? 'video-gen-i2v'
        : tool.capability

  const picker = useMemo(() => {
    const rows = rowCapability ? modelPickerOrder(rowCapability, ready) : []
    const seen = new Map<string, number>()
    for (const r of rows) seen.set(r.label, (seen.get(r.label) ?? 0) + 1)
    return rows.map((r) => ({
      ...r,
      pillLabel: (seen.get(r.label) ?? 0) > 1 ? `${r.label} · ${r.connectorId}` : r.label
    }))
  }, [rowCapability, ready])

  // The model row is re-framed by the tool, so a selection that can't run the new tool is
  // replaced rather than silently rerouted — the panel names what it left.
  const reconciled = useMemo(
    () => reconcileModel(stage.modelId ?? null, rowCapability, ready),
    [stage.modelId, rowCapability, ready]
  )
  const model: CatalogModel | null = reconciled.model
  const canRun = rowCapability === null || !!model
  const thin = promptIsThin(prompt)

  // The picked model's own parameter surface replaces the manifest's generic rows —
  // "the UI displays options based on the model". A value still valid on the new
  // surface survives the model switch; anything else resets to that row's default.
  const paramDefs = useMemo(
    () => effectiveParameters(manifest.parameters, model ?? undefined),
    [manifest, model]
  )
  useEffect(() => {
    setParams((prev) =>
      Object.fromEntries(
        paramDefs.map((p) => [p.id, p.options.includes(prev[p.id]) ? prev[p.id] : p.options[0]])
      )
    )
  }, [paramDefs])

  // References follow the picked model's actual contract: gated off when the
  // model can't consume them, capped at its maxRefs (a single-ref model
  // replaces on pick), typed only where typing exists (gemini).
  const refsCapable = !model || model.capabilities.includes('image-ref-conditioning')
  const maxRefs = model?.maxRefs
  const addRef = (src: string): void => {
    setRefs((r) => {
      if (r.includes(src)) return r
      if (maxRefs === 1) return [src]
      if (maxRefs && r.length >= maxRefs) return r
      return [...r, src]
    })
  }
  const cycleRefType = (src: string): void => {
    const order = ['object', 'character', 'style'] as const
    setRefTypes((t) => ({ ...t, [src]: order[(order.indexOf(t[src] ?? 'object') + 1) % 3] }))
  }

  /** Images the enhancer can actually LOOK at: everything visual attached to this
   *  node (references, frames, the person/source stills). Video inputs are skipped
   *  — the vision path only carries images. Capped so a big reference set doesn't
   *  balloon one rewrite call. */
  const enhanceImages = useMemo(
    () => enhanceImagesFor(refs, nodeInputs[manifest.id]),
    [refs, nodeInputs, manifest.id]
  )

  /** Read the brief (and any attached reference images) and rewrite it into a
   *  fuller generation prompt. Runs on the same multi-turn conversation plumbing
   *  the Storyboard's ✨ and the Motion graphics wizard use — vision included. */
  async function enhancePrompt(): Promise<void> {
    const text = prompt.trim()
    if (!text || enhancing) return
    setEnhancing(true)
    setEnhanceError(null)
    try {
      const isVideo = manifest.media === 'video'
      const result = await bridge.scripting.turn({
        conversationId: `enhance-${manifest.id}-${Date.now()}`,
        prompt: [
          enhanceImages.length > 0
            ? `The attached ${enhanceImages.length === 1 ? 'image is a reference' : 'images are references'} for this generation — read ${enhanceImages.length === 1 ? 'it' : 'them'} and keep the subject, wardrobe, palette and style consistent with what you see.`
            : '',
          `The user's brief: ${text}`,
          '',
          isVideo
            ? 'Rewrite it as ONE compact paragraph prompt for an AI video model covering: subject and action, what moves and how, camera move and framing, lighting and mood, and style. Keep it a single continuous shot — no scene lists, no shot numbers.'
            : 'Rewrite it as ONE compact paragraph prompt for an AI image model covering: subject, composition and framing, lighting, lens/render style, colour and mood.',
          model ? `Target model: ${model.label}.` : '',
          "Stay faithful to the user's intent — enrich it, never replace it. Reply with ONLY the prompt text: no preamble, no quotes, no markdown."
        ]
          .filter(Boolean)
          .join('\n'),
        imagePaths: enhanceImages.length > 0 ? enhanceImages : undefined,
        systemPrompt:
          'You author precise, evocative prompts for AI image and video generation models. You reply with only the prompt text.'
      })
      if (result?.ok && result.text.trim()) setPrompt(result.text.trim())
      else setEnhanceError(result?.error ?? 'Enhance failed.')
    } catch (error) {
      setEnhanceError(error instanceof Error ? error.message : String(error))
    } finally {
      setEnhancing(false)
    }
  }

  // A canvas node's "img2img" action seeds its image as a reference here.
  const pendingRefs = useStudio((s) => s.pendingRefs)
  const clearPendingRefs = useStudio((s) => s.clearPendingRefs)
  useEffect(() => {
    if (pendingRefs && pendingRefs.manifestId === manifest.id) {
      addRef(pendingRefs.src)
      clearPendingRefs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRefs, manifest.id])

  // A handoff moves the artifact to a DIFFERENT node, so self-targets are dropped —
  // "deepfake · as the source performance" offered inside Deepfake is noise. Nodes whose
  // commit target isn't the canvas (a LoRA saves a person) have no artifact to hand off.
  const handoffs = useMemo(
    () =>
      hasArtifact && manifest.commit === 'canvas'
        ? handoffsFor(manifest.media, ready).filter((h) => h.to !== manifest.id)
        : [],
    [hasArtifact, manifest.media, manifest.commit, manifest.id, ready]
  )

  function pickTool(next: NodeToolDef): void {
    // Dataset tools act immediately instead of arming the primary button — "clear" that
    // needs a second click on Generate would read as broken.
    if (next.exec === 'dataset-remove') {
      clearDataset(manifest.id)
      return
    }
    if (next.exec === 'dataset-add') {
      setOpenSetting(openSetting === 'dataset' ? null : 'dataset')
      return
    }
    setNodeTool(manifest.id, next.id)
    const r = reconcileModel(stage.modelId ?? null, next.capability, ready)
    setNodeModel(manifest.id, r.model?.id)
    if (next.surface === 'canvas' && next.editorMode) {
      openEditor(manifest.id, next.editorMode)
    }
  }

  function run(asTyped = false): void {
    if (blockedReason || !prompt.trim()) return

    const exec = tool.exec ?? 'agent'

    if (exec === 'audio-tts' || exec === 'audio-music' || exec === 'audio-sfx' || exec === 'voice-clone') {
      const op = exec === 'audio-tts' ? 'tts' : exec === 'audio-music' ? 'music' : exec === 'audio-sfx' ? 'sfx' : 'clone'
      stageAudio(manifest.id, op, {
        text: prompt.trim(),
        voiceName: voice || undefined,
        useYapper: model?.connectorId === 'yapper'
      })
      return
    }

    if (exec === 'lora-train') {
      setTraining(true)
      setTrainError(null)
      void trainLora({
        name: prompt.trim(),
        imagePaths: dataset,
        steps,
        kind: loraKind,
        trainer: model?.providerModelId
      }).then((r) => {
        setTraining(false)
        if (!r.ok) setTrainError(r.error ?? 'Training failed.')
        else clearDataset(manifest.id)
      })
      return
    }

    // A trained style overrides the picked model — it can only run on the backend that
    // trained it, and saying so beats silently rerouting (the bug this redesign exists for).
    const styleHint = style
      ? `${style.trainer === 'flux-krea' ? 'the fal-ai/flux-krea-lora model' : 'the Krea 2 LoRA model'} with my trained LoRA "${style.name}"${style.loraUrl ? ` (weights: ${style.loraUrl}, strength ~0.9)` : ''}`
      : undefined

    const inputs = nodeInputs[manifest.id] ?? {}
    const sourceSrc = activeTake?.src

    stageGenerate(manifest.id, {
      skipRefine: asTyped,
      label: `${manifest.id}_${Date.now().toString().slice(-4)}`,
      mediaType: manifest.media,
      prompt: prompt.trim(),
      takes: tool.editorMode === 'mask' ? 1 : takes,
      modelId: model?.id,
      connectorId: style ? (style.connectorId ?? 'fal') : model?.connectorId,
      modelHint: styleHint ?? model?.providerModelId,
      // Typed refs only exist on gemini; everywhere else the flat list rides as-is.
      referenceImagePaths: (() => {
        const objectRefs =
          model?.connectorId === 'gemini'
            ? refs.filter((r) => (refTypes[r] ?? 'object') === 'object')
            : refs
        return objectRefs.length > 0 ? objectRefs : undefined
      })(),
      characterReferencePaths:
        model?.connectorId === 'gemini' && refs.some((r) => refTypes[r] === 'character')
          ? refs.filter((r) => refTypes[r] === 'character')
          : undefined,
      styleReferencePaths:
        model?.connectorId === 'gemini' && refs.some((r) => refTypes[r] === 'style')
          ? refs.filter((r) => refTypes[r] === 'style')
          : undefined,
      refStrength: refs.length > 0 && model?.connectorId === 'comfyui' ? refStrength : undefined,
      maskDataUrl: tool.editorMode === 'mask' ? editorMask : undefined,
      // A masked edit needs the image it is editing, not just the mask.
      sourceMediaPath: tool.editorMode === 'mask' ? sourceSrc : inputs['sourceVideo'],
      startFramePath: inputs['startFrame'] ?? inputs['sourceImage'],
      endFramePath: inputs['endFrame'],
      referenceAudioPaths: inputs['audioTrack'] ? [inputs['audioTrack']] : undefined,
      extendVideoPath: tool.id === 'extend' ? sourceSrc : undefined,
      aspectRatio: params['aspect'],
      resolution: params['resolution'],
      durationSec: params['duration'] ? parseInt(params['duration'], 10) : undefined,
      // Exact-model pinning where the tool takes a literal model name: gemini and
      // comfyui wrappers, and muapi (whose enum ids the catalog now carries verbatim
      // from the live probe). Other connectors keep the advisory modelHint.
      model:
        !style &&
        (model?.connectorId === 'gemini' ||
          model?.connectorId === 'comfyui' ||
          model?.connectorId === 'muapi')
          ? model.providerModelId
          : undefined,
      imageSize: params['size'],
      thinkingLevel: params['thinking'],
      personGeneration: params['person'],
      steps: params['steps'] ? parseInt(params['steps'], 10) : undefined
    })
  }

  // A tool that edits through the canvas surface cannot run until that surface has
  // produced its input — an Inpaint button with no mask would generate an unmasked
  // image and silently replace the take.
  const needsMask = tool.editorMode === 'mask'
  const shortDataset =
    tool.exec === 'lora-train' && dataset.length < (manifest.datasetMin ?? 0)
  const blockedReason = !canRun
    ? 'Connect a tool to run'
    : needsMask && !editorMask
      ? 'Brush a mask first'
      : tool.editorMode && tool.editorMode !== 'mask'
        ? `${tool.label} isn’t built yet`
        : shortDataset
          ? `Add ${(manifest.datasetMin ?? 0) - dataset.length} more image${(manifest.datasetMin ?? 0) - dataset.length === 1 ? '' : 's'}`
          : training
            ? 'Training…'
            : null

  /** Settings whose value is a piece of media picked off the canvas. Each maps to the
   *  same handoff role name, so a pill-delivered artifact and a hand-picked one land
   *  in the same slot. */
  function acceptsDrop(kind: string, types: readonly string[]): boolean {
    if (!types.includes('application/lyme-node')) return false
    return acceptedMedia(kind) !== null
  }

  function linkCanvasNode(kind: string, src: string): void {
    if (kind === 'refs') {
      addRef(src)
      return
    }
    const mediaRole = MEDIA_ROLES[kind]
    if (mediaRole) setNodeInput(manifest.id, mediaRole.role, src)
  }

  function settingValue(kind: string): string {
    if (kind === 'takes') return String(takes)
    if (kind === 'style') return style ? style.name.slice(0, 9) : 'none'
    if (kind === 'refs') return refs.length ? String(refs.length) : 'none'
    if (kind === 'voice') return voice ? voice.slice(0, 9) : 'default'
    if (kind === 'loraKind') return loraKind
    if (kind === 'trainer') return model ? model.label.slice(0, 9) : 'none'
    if (kind === 'steps') return String(steps)
    if (kind === 'caption') return 'auto'
    if (kind === 'language') return 'en'
    const mediaRole = MEDIA_ROLES[kind]
    if (mediaRole) return (nodeInputs[manifest.id] ?? {})[mediaRole.role] ? 'set' : 'none'
    return 'none'
  }

  return (
    <div className="np">
      <TakePreview
        manifest={manifest}
        activeTake={activeTake}
        stage={stage}
        dataset={dataset}
        toggleDatasetImage={toggleDatasetImage}
        selectTake={selectTake}
        setLightbox={setLightbox}
      />

      <div className="np-tools">
        {manifest.tools.map((t) => {
          const isDataset = t.exec === 'dataset-add' || t.exec === 'dataset-remove'
          const disabled =
            (t.needsArtifact && !hasArtifact) ||
            (t.exec === 'dataset-remove' && dataset.length === 0)
          const active = isDataset
            ? t.exec === 'dataset-add' && openSetting === 'dataset'
            : t.id === tool.id
          return (
            <button
              key={t.id}
              className={`np-tool${active ? ' on' : ''}${disabled ? ' off' : ''}`}
              disabled={disabled}
              title={t.label}
              onClick={() => pickTool(t)}
            >
              <Icon name={t.icon} />
            </button>
          )
        })}
        {/* Settings live in the same strip as the tools now — compact icon+value
            buttons instead of the old giant squares (Joseph, 2026-08-30). All the
            square's behavior (popovers, drag-drop targets, cycle clicks) carries over. */}
        {manifest.settings.some((s) => s.kind !== 'takes') && <span className="np-tools-sep" />}
        {/* Takes is deliberately absent here — it renders as a ± stepper beside the
            Generate button, where the quantity it controls actually applies. */}
        {manifest.settings.filter((s) => s.kind !== 'takes').map((s) => {
          const value = settingValue(s.kind)
          const refsOff = s.kind === 'refs' && !refsCapable
          return (
            <button
              key={s.id}
              title={
                refsOff
                  ? `${model?.label ?? 'this model'} can’t take reference images`
                  : `${s.label.toLowerCase()}: ${value}`
              }
              className={`np-tool np-tool-set${value !== 'none' ? ' set' : ''}${openSetting === s.id ? ' on' : ''}${dropTarget === s.id ? ' drop' : ''}${refsOff ? ' off' : ''}`}
              onDragOver={(e) => {
                if (!acceptsDrop(s.kind, e.dataTransfer.types)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropTarget(s.id)
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                setDropTarget(null)
                const nodeId = e.dataTransfer.getData('application/lyme-node')
                const node = nodes.find((n) => n.id === nodeId)
                if (!node?.data.src) return
                e.preventDefault()
                linkCanvasNode(s.kind, node.data.src)
              }}
              onClick={() => {
                if (s.kind === 'loraKind') {
                  setLoraKind(loraKind === 'subject' ? 'style' : 'subject')
                  return
                }
                if (s.kind === 'steps') {
                  setSteps(steps >= 2000 ? 500 : steps + 500)
                  return
                }
                setOpenSetting(openSetting === s.id ? null : s.id)
              }}
            >
              <Icon name={s.icon} />
              <em>{value}</em>
            </button>
          )
        })}
      </div>

      <SettingSheets
        manifest={manifest}
        openSetting={openSetting}
        setOpenSetting={setOpenSetting}
        model={model}
        nodes={nodes}
        canvasImages={canvasImages}
        dataset={dataset}
        toggleDatasetImage={toggleDatasetImage}
        nodeInputs={nodeInputs}
        setNodeInput={setNodeInput}
        refs={refs}
        setRefs={setRefs}
        refTypes={refTypes}
        addRef={addRef}
        cycleRefType={cycleRefType}
        maxRefs={maxRefs}
        styleId={styleId}
        setStyleId={setStyleId}
        voice={voice}
        setVoice={setVoice}
        voiceList={voiceList}
        trainError={trainError}
        styles={props.styles}
      />

      {lightbox && activeTake?.src && (
        <div className="np-lightbox" onClick={() => setLightbox(false)}>
          <img src={activeTake.src} alt={activeTake.label} />
        </div>
      )}

      {refs.length > 0 && model?.connectorId === 'comfyui' && (
        <div className="np-strength">
          <span className="np-lbl">REF STRENGTH</span>
          {(
            [
              [0.35, 'close'],
              [0.6, 'balanced'],
              [0.85, 'loose']
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={`np-chip${refStrength === v ? ' on' : ''}`}
              title={`img2img denoise ${v}`}
              onClick={() => setRefStrength(v)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {style && (
        <div className="np-switched">
          style “{style.name}” is driving this — runs on {style.connectorId ?? 'fal'}
        </div>
      )}

      {tool.capability === null ? (
        <div className="np-local">runs locally on ffmpeg — no model, no spend</div>
      ) : (
        <div className="np-models">
          <div className="np-lbl">
            MODEL · {picker.filter((m) => m.ready).length} can{' '}
            {endFrameSet ? 'first→last' : startFrameSet && manifest.media === 'video' ? 'animate the image' : tool.label}
          </div>
          <div className="np-track" ref={hWheelRef}>
            {picker.length === 0 && <span className="np-none">no model can do this</span>}
            {picker.map((m) => (
              <button
                key={m.id}
                className={`np-pill${m.id === model?.id ? ' on' : ''}${m.ready ? '' : ' dim'}`}
                title={`${m.label} · ${m.connectorId}${m.cost !== undefined ? ` · ${m.cost === 0 ? '$0' : `~$${m.cost}`}` : ''}${m.note ? ` · ${m.note}` : ''}`}
                onClick={() => (m.ready ? setNodeModel(manifest.id, m.id) : openSettings('connectors'))}
              >
                {m.pillLabel}
              </button>
            ))}
          </div>
          <span className="np-fade" />
        </div>
      )}

      {model?.constraint && (
        <div className="np-local">{model.label} — {model.constraint}</div>
      )}

      {needsMask && (
        <div className="np-local">
          {editorMask
            ? 'mask ready — painted areas get regenerated'
            : 'no mask yet — the canvas opened, brush one there'}
        </div>
      )}

      {!reconciled.kept && reconciled.from && model && (
        <div className="np-switched">
          {reconciled.from.label} can’t {tool.label} — switched to {model.label}
        </div>
      )}

      <textarea
        className="np-prompt"
        placeholder={manifest.promptPlaceholder}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="np-enhance-row">
        <button
          className="np-chip np-enhance"
          disabled={!prompt.trim() || enhancing}
          title={
            enhanceImages.length > 0
              ? `Rewrite this into a richer prompt — the model will look at your ${enhanceImages.length === 1 ? 'reference image' : `${enhanceImages.length} reference images`} too`
              : 'Rewrite this into a richer, more specific generation prompt'
          }
          onClick={() => void enhancePrompt()}
        >
          {enhancing ? 'enhancing…' : `✨ enhance${enhanceImages.length > 0 ? ' + refs' : ''}`}
        </button>
        {enhanceError && <span className="np-enhance-err">{enhanceError}</span>}
      </div>

      {paramDefs.length > 0 && (
        <div className="np-params">
          {paramDefs.map((p) => (
            <div key={p.id} className="np-param" ref={hWheelRef}>
              {p.options.map((o) => (
                <button
                  key={o}
                  className={`np-chip${params[p.id] === o ? ' on' : ''}`}
                  onClick={() => setParams({ ...params, [p.id]: o })}
                >
                  {o}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="np-run-row">
        {manifest.settings.some((s) => s.kind === 'takes') && !needsMask && (
          <TakesStepper takes={takes} setTakes={setTakes} />
        )}
        <Button
          variant="block-primary"
          disabled={!!blockedReason || !prompt.trim()}
          onClick={() => run()}
        >
          {blockedReason ?? (thin ? '✦ Enhance & generate' : `${tool.verb}${takes > 1 && !needsMask ? ` ${takes}` : ''}`)}
        </Button>
        {thin && !blockedReason && <button className="np-astyped" onClick={() => run(true)} title={`Under ${THIN_PROMPT_CHARS} characters — short prompts leave subject count and anatomy to chance. This skips the automatic rewrite.`}>as typed</button>}
      </div>

      <Button
        variant="block"
        disabled={!hasArtifact}
        onClick={() => {
          const id = commitStage(manifest.id)
          if (id) focusNode(id)
        }}
      >
        {manifest.commitLabel}
      </Button>

      {handoffs.length > 0 && (
        <div className="np-cont">
          <div className="np-lbl">CONTINUE IN</div>
          <div className="np-track" ref={hWheelRef}>
            {handoffs.map((h) => (
              <button
                key={`${h.to}-${h.role}`}
                className={`np-pill${h.ready ? '' : ' dim'}`}
                title={h.ready ? `${h.to} — ${h.label}` : `needs ${h.requires ?? 'nothing'}`}
                onClick={() => h.ready && applyHandoff(manifest.id, h.to, h.role)}
              >
                {h.to} · {h.label}
              </button>
            ))}
          </div>
          <span className="np-fade" />
        </div>
      )}
    </div>
  )
}
