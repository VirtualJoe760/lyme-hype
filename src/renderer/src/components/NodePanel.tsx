import { useMemo, useState } from 'react'
import {
  handoffsFor,
  modelPickerOrder,
  reconcileModel,
  type CatalogModel
} from '@shared/model-catalog'
import type { NodeManifest, NodeToolDef, ToolIcon } from '@shared/node-manifest'
import type { ConnectorView, TrainedStyle } from '@shared/types'
import { useStudio } from '../store'
import { Button } from './ui/Button'

const ICONS: Record<ToolIcon, React.JSX.Element> = {
  generate: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 15l5-5 4 4 3-3 4 4" /></>,
  brush: <><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="M13.5 6.5 17.5 10.5" /></>,
  expand: <><rect x="8" y="8" width="8" height="8" rx="1" /><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  eraser: <><path d="M4 16 12 8l6 6-6 6H6Z" /><path d="M10 20h10" /></>,
  upscale: <><path d="M12 20V5" /><path d="M6 11l6-6 6 6" /><path d="M4 21h16" /></>,
  crop: <><path d="M7 3v14h14" /><path d="M3 7h14v14" /></>,
  play: <path d="M5 4l14 8-14 8Z" />,
  extend: <><path d="M4 12h13" /><path d="M13 7l5 5-5 5" /><path d="M21 4v16" /></>,
  wave: <path d="M4 12h3l3-7 4 14 3-7h3" />,
  music: <><circle cx="7" cy="18" r="3" /><circle cx="18" cy="15" r="3" /><path d="M10 18V5l11-2v13" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  images: <><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M21 8v11H9" /></>,
  caption: <><path d="M4 6h16M4 12h10M4 18h13" /></>,
  trash: <><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /></>,
  eye: <><circle cx="12" cy="12" r="3" /><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" /></>,
  face: <><circle cx="12" cy="12" r="9" /><path d="M9 10h.01M15 10h.01M8.5 15a5 5 0 0 0 7 0" /></>
}

function Icon(props: { name: ToolIcon }): React.JSX.Element {
  return (
    <svg className="np-icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  )
}

function readyConnectorIds(connectors: ConnectorView[]): string[] {
  return connectors.filter((c) => c.authType === 'none' || c.hasCredential).map((c) => c.id)
}

/**
 * One renderer for every creative node. What varies between nodes lives in the manifest
 * (docs/build-plan.md Phase 16), so adding a node is adding a record rather than a
 * component — which is what makes connector intake able to propose one at all.
 */
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
  const editorMask = useStudio((s) => s.editor?.mask)

  // Selecting s.nodes (a stable reference) and filtering in a memo — a selector that
  // returns a fresh array fails zustand's snapshot equality and loops forever.
  const nodes = useStudio((s) => s.nodes)
  const canvasImages = useMemo(
    () => nodes.filter((n) => n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src),
    [nodes]
  )

  const [prompt, setPrompt] = useState('')
  const [takes, setTakes] = useState(1)
  const [styleId, setStyleId] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [openSetting, setOpenSetting] = useState<string | null>(null)
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(manifest.parameters.map((p) => [p.id, p.options?.[0] ?? '']))
  )

  const style = props.styles?.find((s) => s.id === styleId)

  const ready = useMemo(() => readyConnectorIds(props.connectors), [props.connectors])
  const tool: NodeToolDef = useMemo(
    () => manifest.tools.find((t) => t.id === stage.toolId) ?? manifest.tools[0],
    [manifest, stage.toolId]
  )

  const activeTake = stage.takes[stage.activeIndex]
  const hasArtifact = !!activeTake && activeTake.status === 'ready'

  const picker = useMemo(
    () => (tool.capability ? modelPickerOrder(tool.capability, ready) : []),
    [tool.capability, ready]
  )

  // The model row is re-framed by the tool, so a selection that can't run the new tool is
  // replaced rather than silently rerouted — the panel names what it left.
  const reconciled = useMemo(
    () => reconcileModel(stage.modelId ?? null, tool.capability, ready),
    [stage.modelId, tool.capability, ready]
  )
  const model: CatalogModel | null = reconciled.model
  const canRun = tool.capability === null || !!model

  const handoffs = useMemo(
    () => (hasArtifact ? handoffsFor(manifest.media, ready) : []),
    [hasArtifact, manifest.media, ready]
  )

  function pickTool(next: NodeToolDef): void {
    setNodeTool(manifest.id, next.id)
    const r = reconcileModel(stage.modelId ?? null, next.capability, ready)
    setNodeModel(manifest.id, r.model?.id)
    if (next.surface === 'canvas' && next.editorMode) {
      openEditor(manifest.id, next.editorMode)
    }
  }

  function run(): void {
    if (!canRun || !prompt.trim()) return
    // A trained style overrides the picked model — it can only run on the backend that
    // trained it, and saying so beats silently rerouting (the bug this redesign exists for).
    const styleHint = style
      ? `${style.trainer === 'flux-krea' ? 'the fal-ai/flux-krea-lora model' : 'the Krea 2 LoRA model'} with my trained LoRA "${style.name}"${style.loraUrl ? ` (weights: ${style.loraUrl}, strength ~0.9)` : ''}`
      : undefined

    stageGenerate(manifest.id, {
      label: `${manifest.id}_${Date.now().toString().slice(-4)}`,
      mediaType: manifest.media,
      prompt: prompt.trim(),
      takes,
      modelId: model?.id,
      connectorId: style ? (style.connectorId ?? 'fal') : model?.connectorId,
      modelHint: styleHint ?? model?.providerModelId,
      referenceImagePaths: refs.length > 0 ? refs : undefined,
      aspectRatio: params['aspect'],
      resolution: params['resolution'],
      durationSec: params['duration'] ? parseInt(params['duration'], 10) : undefined
    })
  }

  function settingValue(kind: string): string {
    if (kind === 'takes') return String(takes)
    if (kind === 'style') return style ? style.name.slice(0, 9) : 'none'
    if (kind === 'refs') return refs.length ? String(refs.length) : 'none'
    return 'none'
  }

  return (
    <div className="np">
      <div
        className={`np-preview${hasArtifact ? ' filled' : ''}`}
        style={{ aspectRatio: manifest.previewAspect }}
      >
        {activeTake?.status === 'rendering' && <span className="np-spin" />}
        {activeTake?.status === 'error' && (
          <span className="np-empty np-err">{activeTake.error}</span>
        )}
        {!activeTake && (
          <span className="np-empty">
            {manifest.previewHolds === 'dataset' ? 'no images yet' : 'nothing yet'}
            <br />
            {manifest.previewHolds === 'dataset' ? 'add some below' : 'describe it below'}
          </span>
        )}
        {hasArtifact && activeTake.src && manifest.media === 'image' && (
          <img className="np-art" src={activeTake.src} alt={activeTake.label} />
        )}
        {hasArtifact && activeTake.src && manifest.media === 'video' && (
          <video className="np-art" src={activeTake.src} muted playsInline />
        )}
        {hasArtifact && activeTake.src && manifest.media === 'audio' && (
          <span className="np-empty">{activeTake.label}</span>
        )}
        {stage.takes.length > 1 && (
          <span className="np-nav">
            <button onClick={() => selectTake(manifest.id, stage.activeIndex - 1)}>‹</button>
            take {stage.activeIndex + 1} / {stage.takes.length}
            <button onClick={() => selectTake(manifest.id, stage.activeIndex + 1)}>›</button>
          </span>
        )}
      </div>

      <div className="np-tools">
        {manifest.tools.map((t) => {
          const disabled = t.needsArtifact && !hasArtifact
          return (
            <button
              key={t.id}
              className={`np-tool${t.id === tool.id ? ' on' : ''}${disabled ? ' off' : ''}`}
              disabled={disabled}
              title={t.label}
              onClick={() => pickTool(t)}
            >
              <Icon name={t.icon} />
            </button>
          )
        })}
      </div>

      <div className="np-settings">
        {manifest.settings.map((s) => {
          const value = settingValue(s.kind)
          return (
            <button
              key={s.id}
              className={`np-set${value !== 'none' ? ' on' : ''}`}
              onClick={() => {
                if (s.kind === 'takes') {
                  setTakes(takes >= 8 ? 1 : takes === 1 ? 2 : takes === 2 ? 4 : 8)
                  return
                }
                setOpenSetting(openSetting === s.id ? null : s.id)
              }}
            >
              <Icon name={s.icon} />
              <b>{s.label}</b>
              <em>{value}</em>
            </button>
          )
        })}
      </div>

      {openSetting === 'style' && (
        <div className="np-pop">
          {(props.styles ?? []).length === 0 && (
            <span className="np-pop-empty">no trained styles yet — Create a LoRA first</span>
          )}
          <button
            className={`np-pill${styleId === '' ? ' on' : ''}`}
            onClick={() => setStyleId('')}
          >
            none
          </button>
          {(props.styles ?? []).map((s) => (
            <button
              key={s.id}
              className={`np-pill${styleId === s.id ? ' on' : ''}`}
              onClick={() => setStyleId(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {openSetting === 'refs' && (
        <div className="np-pop">
          {canvasImages.length === 0 && (
            <span className="np-pop-empty">no images on the canvas to reference</span>
          )}
          {canvasImages.map((n) => (
            <button
              key={n.id}
              className={`np-ref${refs.includes(n.data.src ?? '') ? ' on' : ''}`}
              title={n.data.label}
              onClick={() => {
                const src = n.data.src ?? ''
                setRefs(refs.includes(src) ? refs.filter((r) => r !== src) : [...refs, src])
              }}
            >
              <img src={n.data.src} alt={n.data.label} />
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
            MODEL · {picker.filter((m) => m.ready).length} can {tool.label}
          </div>
          <div className="np-track">
            {picker.length === 0 && <span className="np-none">no model can do this</span>}
            {picker.map((m) => (
              <button
                key={m.id}
                className={`np-pill${m.id === model?.id ? ' on' : ''}${m.ready ? '' : ' dim'}`}
                title={`${m.label} · ${m.connectorId}${m.note ? ` · ${m.note}` : ''}`}
                onClick={() => (m.ready ? setNodeModel(manifest.id, m.id) : openSettings('connectors'))}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="np-fade" />
        </div>
      )}

      {editorMask && tool.editorMode === 'mask' && (
        <div className="np-local">
          mask ready — not yet handed to the generation call (build-plan Phase 19)
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

      {manifest.parameters.length > 0 && (
        <div className="np-params">
          {manifest.parameters
            .filter((p) => !p.perModel)
            .map((p) => (
              <div key={p.id} className="np-param">
                {p.options?.map((o) => (
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

      <Button
        variant="block-primary"
        disabled={!canRun || !prompt.trim()}
        onClick={run}
      >
        {canRun ? `${tool.verb}${takes > 1 ? ` ${takes}` : ''}` : 'Connect a tool to run'}
      </Button>

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
          <div className="np-track">
            {handoffs.map((h) => (
              <button
                key={`${h.to}-${h.role}`}
                className={`np-pill${h.ready ? '' : ' dim'}`}
                title={h.ready ? `${h.to} — ${h.label}` : `needs ${h.requires ?? 'nothing'}`}
                onClick={() => h.ready && commitStage(manifest.id)}
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
