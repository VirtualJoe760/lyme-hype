import { useEffect, useRef, useState } from 'react'
import type { ConnectorView, TrainedStyle, VoiceEntry } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { ChatRealtyPull } from './ChatRealtyPull'
import { MotionGraphicsWizard } from './MotionGraphicsWizard'

/**
 * The Create panel v2 (docs/ui/create-panel.md + docs/concepts/
 * create-panel-v2.html): status-aware tile grid → task screens that answer
 * "will this work, what runs it, what does it cost" before anything is typed —
 * run-line up top, one hero input, smart-default chips, a result row that
 * tracks the node instead of silently bouncing home.
 */

type Screen =
  | 'home'
  | 'video'
  | 'audio'
  | 'image'
  | 'isolate'
  | 'lora'
  | 'deepfake'
  | 'upload'
  | 'link'
  | 'motion'
  | 'pull'

const TILES: { key: Screen; glyph: string; label: string; blurb: string }[] = [
  { key: 'video', glyph: '▶', label: 'Generate video', blurb: 'Prompt → video via the connected tools' },
  { key: 'image', glyph: '▦', label: 'Generate image', blurb: 'Storyboard-cheap or production-tier' },
  { key: 'audio', glyph: '♪', label: 'Generate audio', blurb: 'Voice, music, SFX, voice cloning' },
  { key: 'motion', glyph: '✦', label: 'Motion graphics', blurb: 'References → reveal animation → alpha' },
  { key: 'isolate', glyph: '⏏', label: 'Isolate audio', blurb: 'Extract a track locally — free, no tokens' },
  { key: 'lora', glyph: '◈', label: 'Create a LoRA', blurb: "Train a reusable style on fal's Krea trainers" },
  { key: 'deepfake', glyph: '☺', label: 'Deepfake', blurb: 'Reference person → speech → lip-sync/face' },
  { key: 'upload', glyph: '↑', label: 'Upload', blurb: 'A file from this machine' },
  { key: 'link', glyph: '⛓', label: 'Link', blurb: 'Download a direct media URL' },
  { key: 'pull', glyph: '⌂', label: 'Listing photos', blurb: 'Pull real MLS photos (ChatRealty)' }
]

const SCREEN_TITLES: Record<Screen, string> = {
  home: 'Create',
  video: 'Generate video',
  audio: 'Generate audio',
  image: 'Generate image',
  isolate: 'Isolate audio',
  lora: 'Create a LoRA',
  deepfake: 'Deepfake',
  upload: 'Upload',
  link: 'Link',
  motion: 'Motion graphics',
  pull: 'Listing photos'
}

/** Which connectors make a tile ready (ANY of them satisfies) and how to name
 *  the need — capability phrasing, since one node can be served by several
 *  connectors. Derived from docs/architecture/capability-map.md §3; change
 *  the map first, then this. Absent = always ready (local ffmpeg / disk). */
const TILE_NEEDS: Partial<Record<Screen, { anyOf: string[]; label: string }>> = {
  video: { anyOf: ['muapi', 'fal', 'gemini', 'krea', 'yapper'], label: 'a video tool' },
  image: { anyOf: ['gemini', 'openai', 'muapi', 'fal', 'krea', 'yapper'], label: 'an image tool' },
  audio: { anyOf: ['elevenlabs'], label: 'elevenlabs' },
  motion: { anyOf: ['gemini', 'openai'], label: 'gemini/openai' },
  lora: { anyOf: ['fal'], label: 'fal' },
  deepfake: { anyOf: ['yapper', 'muapi'], label: 'yapper/muapi' },
  pull: { anyOf: ['chatrealty'], label: 'chatrealty' }
}

function connectorReady(connectors: ConnectorView[], id: string): boolean {
  const def = connectors.find((c) => c.id === id)
  return !!def && (def.authType === 'none' || def.hasCredential)
}

function tileReady(
  connectors: ConnectorView[],
  screen: Screen
): { ready: boolean; needs?: string; options?: string } {
  const need = TILE_NEEDS[screen]
  if (!need) return { ready: true }
  if (need.anyOf.some((id) => connectorReady(connectors, id))) return { ready: true }
  return { ready: false, needs: need.label, options: need.anyOf.join(' / ') }
}

const ASPECTS = ['9:16', '1:1', '16:9']
const DURATIONS = ['6s', '12s', '15s']
const RESOLUTIONS = ['720p', '1080p']

/** Yapper's video-generation catalog (docs/connectors/reference/yapper.md) —
 *  the hosted MCP connector is a full aggregator, not lipsync-only, but
 *  nothing let a user reach a specific model by id before this. Passed as
 *  `modelHint`; `generation.ts`'s buildPrompt turns it into a preference line
 *  the agent matches against yapper_start_process's own `model` enum. */
const YAPPER_VIDEO_MODELS: { id: string; label: string }[] = [
  { id: '', label: 'Yapper model: agent picks' },
  { id: 'seedance-2.5', label: 'seedance-2.5 (4-30s · 720p)' },
  { id: 'seedance-2.0', label: 'seedance-2.0 (4-15s · 2160p)' },
  { id: 'seedance-2.0-fast', label: 'seedance-2.0-fast (4-15s · 2160p)' },
  { id: 'seedance-2.0-mini', label: 'seedance-2.0-mini (4-15s · 720p, cheap)' },
  { id: 'seedance-2.0-open', label: 'seedance-2.0-open (4-15s · 2160p)' },
  { id: 'kling-3.0', label: 'kling-3.0 (4-15s · 1080p)' },
  { id: 'kling-3.0-pro', label: 'kling-3.0-pro (4-15s · 1080p)' },
  { id: 'veo3-quality', label: 'veo3-quality (8s · 1080p)' },
  { id: 'veo3-fast', label: 'veo3-fast (8s · 1080p, cheap)' },
  { id: 'sora-2', label: 'sora-2 (4-20s · 1080p)' },
  { id: 'sora-2-pro', label: 'sora-2-pro (4-20s · 1080p)' },
  { id: 'wan-3.0', label: 'wan-3.0 (2-30s · 1080p)' },
  { id: 'wan-2.7', label: 'wan-2.7 (2-10s · 1080p)' },
  { id: 'flux-3', label: 'flux-3 (5-20s · 1080p)' },
  { id: 'minimax-h3', label: 'minimax-h3 (5-15s · 1440p)' },
  { id: 'pixverse-v6', label: 'pixverse-v6 (1-15s · 1080p)' },
  { id: 'grok-imagine', label: 'grok-imagine (4-15s · 720p)' },
  { id: 'grok-imagine-v1.5', label: 'grok-imagine-v1.5 (1-15s · 720p)' },
  { id: 'gemini-omni-flash', label: 'gemini-omni-flash (3-10s · 1080p, no frame ctrl)' },
  { id: 'happy-horse', label: 'happy-horse (3-15s · 720p)' }
]

let generateCounter = 0
function labelFromPrompt(prompt: string, prefix: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('-').toLowerCase()
  const base = words.replace(/[^a-z0-9-]/g, '').slice(0, 16)
  generateCounter += 1
  return base ? `${prefix}_${base}` : `${prefix}_${String(generateCounter).padStart(2, '0')}`
}

function ChipRow(props: {
  options: string[]
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="chip-row">
      {props.options.map((o) => (
        <button
          key={o}
          className={`chip${props.value === o ? ' on' : ''}`}
          onClick={() => props.onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/** The run-line: will this work, what runs it, what does it cost. */
function RunLine(props: { ok: boolean; label: string; cost?: string }): React.JSX.Element {
  const openSettings = useStudio((s) => s.openSettings)
  return (
    <div className="runline">
      <span className={`runline-dot${props.ok ? '' : ' warn'}`} />
      <span className="runline-label">{props.label}</span>
      {props.ok ? (
        props.cost && <span className="runline-cost">{props.cost}</span>
      ) : (
        <button className="runline-connect" onClick={() => openSettings('connectors')}>
          Connect →
        </button>
      )}
    </div>
  )
}

/** Tracks a generated node's rendering → ready/error lifecycle in place. */
function ResultRow(props: { nodeId: string | null }): React.JSX.Element | null {
  const node = useStudio((s) => s.nodes.find((n) => n.id === props.nodeId) ?? null)
  const focusNode = useStudio((s) => s.focusNode)
  if (!props.nodeId || !node) return null
  const status = node.data.status
  return (
    <div className={`result-row ${status}`}>
      {status === 'rendering' && <span className="result-spin" />}
      {status === 'ready' && <span className="result-ok">✓</span>}
      {status === 'error' && <span className="result-err">⚠</span>}
      <span className="result-label" title={status === 'error' ? node.data.error : node.data.label}>
        {status === 'rendering'
          ? `${node.data.label} rendering on canvas`
          : status === 'ready'
            ? `${node.data.label} ready`
            : `${node.data.label} failed — ${node.data.error ?? 'unknown'}`}
      </span>
      <button className="result-view" onClick={() => focusNode(node.id)}>
        view →
      </button>
    </div>
  )
}

function VideoScreen(props: { connectors: ConnectorView[] }): React.JSX.Element {
  const generateMedia = useStudio((s) => s.generateMedia)
  const nodes = useStudio((s) => s.nodes)
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  const [duration, setDuration] = useState('12s')
  const [resultId, setResultId] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [resolution, setResolution] = useState('1080p')
  // Routing intent (catalog.md): muapi is the video primary when installed.
  const muapiReady = connectorReady(props.connectors, 'muapi')
  const geminiReady = connectorReady(props.connectors, 'gemini')
  const yapperReady = connectorReady(props.connectors, 'yapper')
  const [connector, setConnector] = useState(muapiReady ? 'muapi' : '')
  const [startFrameNodeId, setStartFrameNodeId] = useState('')
  const [yapperModel, setYapperModel] = useState('')
  const { ready } = tileReady(props.connectors, 'video')

  // i2v: only Gemini's Veo wrapper accepts a start_frame_path today (capability
  // map §2 — muapi/fal need asset-upload first, still open plumbing), so
  // picking a starting frame overrides whatever connector is otherwise chosen.
  const imageNodes = nodes.filter(
    (n) => n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src && !n.data.panel
  )
  const startFrameSrc = imageNodes.find((n) => n.id === startFrameNodeId)?.data.src
  const effectiveConnectorId = startFrameSrc ? 'gemini' : yapperModel ? 'yapper' : connector || undefined
  const runOk = startFrameSrc ? geminiReady : yapperModel ? yapperReady : ready
  const runLabel = startFrameSrc
    ? geminiReady
      ? 'runs on gemini · i2v start frame (Veo)'
      : 'i2v needs gemini connected'
    : yapperModel
      ? yapperReady
        ? `runs on yapper · ${yapperModel}`
        : 'needs yapper connected'
      : ready
        ? `runs on ${connector || 'agent pick'}${connector === 'muapi' ? ' · seedance' : ''}`
        : 'no video connector connected'

  return (
    <>
      <RunLine ok={runOk} label={runLabel} cost="$$ paid" />
      <textarea
        className="prompt-area"
        placeholder="lantern spirit rising from a river of flames, chorus swell, wide shot"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <ChipRow options={ASPECTS} value={aspect} onChange={setAspect} />
      <ChipRow options={DURATIONS} value={duration} onChange={setDuration} />
      <button className="more-toggle" onClick={() => setShowMore(!showMore)}>
        {showMore ? '▾' : '▸'} More options
      </button>
      {showMore && (
        <div className="more-body">
          <ChipRow options={RESOLUTIONS} value={resolution} onChange={setResolution} />
          <select
            className="cr-input create-select"
            value={connector}
            onChange={(e) => setConnector(e.target.value)}
          >
            <option value="">Connector: agent picks</option>
            {props.connectors.map((c) => (
              <option key={c.id} value={c.id}>
                Connector: {c.id}
              </option>
            ))}
          </select>
          {imageNodes.length > 0 && (
            <select
              className="cr-input create-select"
              value={startFrameNodeId}
              onChange={(e) => setStartFrameNodeId(e.target.value)}
            >
              <option value="">Starting frame: none (text → video)</option>
              {imageNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  Starting frame: {n.data.label}
                </option>
              ))}
            </select>
          )}
          {yapperReady && (
            <select
              className="cr-input create-select"
              value={yapperModel}
              onChange={(e) => setYapperModel(e.target.value)}
            >
              {YAPPER_VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <button
        className="generate-btn"
        disabled={!prompt.trim()}
        onClick={() =>
          setResultId(
            generateMedia({
              label: labelFromPrompt(prompt, 'clip'),
              mediaType: 'video',
              prompt: prompt.trim(),
              aspectRatio: aspect,
              durationSec: parseInt(duration, 10) || undefined,
              resolution,
              connectorId: effectiveConnectorId,
              startFramePath: startFrameSrc,
              modelHint: startFrameSrc ? undefined : yapperModel || undefined
            })
          )
        }
      >
        Generate
      </button>
      <ResultRow nodeId={resultId} />
    </>
  )
}

function ImageScreen(props: {
  connectors: ConnectorView[]
  styles: TrainedStyle[]
}): React.JSX.Element {
  const generateMedia = useStudio((s) => s.generateMedia)
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  const [tier, setTier] = useState<'storyboard' | 'production'>('storyboard')
  const [resultId, setResultId] = useState<string | null>(null)
  const storyboardChoices = ['gemini', 'openai'].filter((id) => connectorReady(props.connectors, id))
  const [storyboardConnector, setStoryboardConnector] = useState(storyboardChoices[0] ?? '')
  const [styleId, setStyleId] = useState('')
  const style = props.styles.find((s) => s.id === styleId)
  const muapiReady = connectorReady(props.connectors, 'muapi')

  const kreaTier = tier === 'production' ? 'krea/krea-2/large (highest quality)' : 'krea/krea-2/medium'
  const runLabel = style
    ? style.connectorId === 'krea'
      ? `krea · styles:[{id}] · "${style.name}" · ${tier === 'production' ? 'K2 large' : 'K2 medium'}`
      : `fal · ${style.trainer === 'flux-krea' ? 'flux-krea-lora' : 'krea 2 lora'} · "${style.name}"`
    : tier === 'production'
      ? muapiReady
        ? 'midjourney via muapi'
        : 'production needs muapi'
      : storyboardConnector
        ? `${storyboardConnector} · storyboard tier`
        : 'no storyboard connector'
  const runOk = style
    ? connectorReady(props.connectors, style.connectorId)
    : tier === 'production'
      ? muapiReady
      : !!storyboardConnector

  function handleGenerate(): void {
    // The tier choice drives GenerationParams.connectorId — the routing gap
    // closed in Phase 13. A trained LoRA routes through the backend it was
    // trained on: fal (weights URL, tier-agnostic) or Krea (styles:[{id}],
    // where tier now genuinely picks K2 medium vs. K2 large — the production-
    // tier LoRA route fal has no equivalent for; docs/ui/node-enrichment-
    // strategy.md row 4).
    const connectorId =
      style !== undefined
        ? style.connectorId
        : tier === 'production'
          ? muapiReady
            ? 'muapi'
            : undefined
          : storyboardConnector || undefined
    const styleHint = style
      ? style.connectorId === 'krea'
        ? `the Krea 2 ${kreaTier} with my trained style (call krea's generate tool with styles: [{id: "${style.id}", strength: 1}])`
        : `${style.trainer === 'flux-krea' ? 'the fal-ai/flux-krea-lora model' : 'the Krea 2 LoRA model'} with my trained LoRA "${style.name}"${style.loraUrl ? ` (weights: ${style.loraUrl}, strength ~0.9)` : ''}`
      : undefined
    setResultId(
      generateMedia({
        label: labelFromPrompt(prompt, 'img'),
        mediaType: 'image',
        prompt: prompt.trim(),
        aspectRatio: aspect,
        connectorId,
        modelHint: styleHint ?? (tier === 'production' ? 'Midjourney' : undefined)
      })
    )
  }

  return (
    <>
      <RunLine ok={runOk} label={runLabel} cost={tier === 'production' ? '$$$ committed' : '$ cheap'} />
      <textarea
        className="prompt-area"
        placeholder="citrus-slice vinyl record spinning in fog, studio light"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <ChipRow options={ASPECTS} value={aspect} onChange={setAspect} />
      <div className="tab-row">
        <button className={tier === 'storyboard' ? 'active' : ''} onClick={() => setTier('storyboard')}>
          Storyboard · cheap
        </button>
        <button className={tier === 'production' ? 'active' : ''} onClick={() => setTier('production')}>
          Production · Midjourney
        </button>
      </div>
      {tier === 'storyboard' && storyboardChoices.length > 1 && (
        <select
          className="cr-input create-select"
          value={storyboardConnector}
          onChange={(e) => setStoryboardConnector(e.target.value)}
        >
          {storyboardChoices.map((id) => (
            <option key={id} value={id}>
              Model: {id}
            </option>
          ))}
        </select>
      )}
      {props.styles.length > 0 && (
        <select className="cr-input create-select" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
          <option value="">Trained style: none</option>
          {props.styles.map((s) => (
            <option key={s.id} value={s.id}>
              Trained style: {s.name}
            </option>
          ))}
        </select>
      )}
      <button className="generate-btn" disabled={!prompt.trim()} onClick={handleGenerate}>
        Generate
      </button>
      <ResultRow nodeId={resultId} />
    </>
  )
}

type AudioJob = 'voice' | 'music' | 'sfx' | 'clone'

function AudioScreen(props: {
  connectors: ConnectorView[]
  styles: TrainedStyle[]
  onStyleUpdated: (style: TrainedStyle) => void
}): React.JSX.Element {
  const addNode = useStudio((s) => s.addNode)
  const focusNode = useStudio((s) => s.focusNode)
  const generateMedia = useStudio((s) => s.generateMedia)
  const [job, setJob] = useState<AudioJob>('voice')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const ready = connectorReady(props.connectors, 'elevenlabs')
  // Yapper's REST TTS key is a synthetic vault id, not a ConnectorDef
  // (docs/connectors/reference/yapper.md "Two credentials, easy to
  // conflate"), so it can't be read off props.connectors like `ready` above —
  // same duplicated id/string as ConnectorsTab.tsx's YAPPER_REST_ID, since
  // that file lives in a different process and can't share the main-side
  // constant in yapper-rest.ts.
  const [yapperTtsReady, setYapperTtsReady] = useState(false)
  useEffect(() => {
    let alive = true
    void bridge.secrets.list().then((secrets) => {
      if (alive) setYapperTtsReady(secrets.some((s) => s.connectorId === 'yapper-rest'))
    })
    return () => {
      alive = false
    }
  }, [])
  // Voice-only fallback: Yapper's `/audio/speech` has a free daily-character
  // tier and needs no ElevenLabs connection, but it's a single default voice
  // with no browsing/preview yet — a smaller feature than the ElevenLabs path.
  const useYapperVoiceFallback = !ready && yapperTtsReady
  // Music-only fallback: ElevenLabs's compose_music has no substitute inside
  // ElevenLabs itself, but muapi's Suno wrapper (`muapi_audio_create` — full
  // songs, not `muapi_audio_from_text`'s MMAudio SFX) covers the same job
  // through the agent path, same as Deepfake's muapi/yapper chain.
  const muapiReady = connectorReady(props.connectors, 'muapi')
  const useMuapiMusicFallback = !ready && muapiReady
  const [instrumental, setInstrumental] = useState(false)
  const [musicResultId, setMusicResultId] = useState<string | null>(null)

  const [voiceQuery, setVoiceQuery] = useState('')
  const [voices, setVoices] = useState<VoiceEntry[] | null>(null)
  const [voicesRaw, setVoicesRaw] = useState('')
  const [voiceName, setVoiceName] = useState('')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [musicLength, setMusicLength] = useState('60s')
  const [sfxDuration, setSfxDuration] = useState('2s')
  const [cloneName, setCloneName] = useState('')
  const [cloneFiles, setCloneFiles] = useState<string[]>([])
  const [cloneAttachId, setCloneAttachId] = useState('')
  const previewAudio = useRef<HTMLAudioElement | null>(null)

  async function browse(): Promise<void> {
    setBusy(true)
    try {
      const result = await bridge.audioTools.voices(voiceQuery)
      if (result?.ok) {
        setVoices(result.voices ?? null)
        setVoicesRaw(result.voices ? '' : (result.text ?? ''))
      } else {
        setVoices(null)
        setVoicesRaw(`⚠ ${result?.error ?? 'failed'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function preview(name: string): Promise<void> {
    // A tiny cached TTS call per voice — hearing it beats picking blind.
    setPreviewing(name)
    try {
      const result = await bridge.audioTools.preview(name)
      if (result?.ok && result.src) {
        previewAudio.current?.pause()
        const el = new Audio(result.src)
        previewAudio.current = el
        void el.play().catch(() => {})
      } else if (result?.error) {
        setStatus({ kind: 'error', text: result.error })
      }
    } finally {
      setPreviewing(null)
    }
  }

  function composeMusicViaMuapi(): void {
    // Agent-driven, not a direct REST call like the other jobs — muapi's Suno
    // wrapper runs through the same generateMedia/ResultRow lifecycle Video
    // and Deepfake already use, so the node renders on the canvas itself
    // instead of this screen's synchronous ok/src status line.
    setStatus(null)
    setMusicResultId(
      generateMedia({
        label: labelFromPrompt(text, 'music'),
        mediaType: 'audio',
        prompt: [text.trim(), instrumental ? 'Instrumental only, no vocals.' : undefined]
          .filter(Boolean)
          .join(' '),
        connectorId: 'muapi',
        modelHint: 'suno'
      })
    )
  }

  async function run(kind: AudioJob): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const result =
        kind === 'voice'
          ? useYapperVoiceFallback
            ? await bridge.audioTools.yapperTts({ text })
            : await bridge.audioTools.tts({ text, voiceName: voiceName || undefined })
          : kind === 'music'
            ? await bridge.audioTools.music({ prompt: text, lengthMs: (parseInt(musicLength, 10) || 60) * 1000 })
            : kind === 'sfx'
              ? await bridge.audioTools.sfx({ prompt: text, durationSec: parseFloat(sfxDuration) || 2 })
              : await bridge.audioTools.clone({ name: cloneName, filePaths: cloneFiles })
      if (result?.ok && result.src) {
        addNode({
          label: labelFromPrompt(text, 'aud'),
          mediaType: 'audio',
          source: 'generate',
          src: result.src,
          startRendering: false
        })
        setStatus({
          kind: 'ok',
          text:
            kind === 'voice' && useYapperVoiceFallback
              ? `Audio node added to the canvas — Yapper free tier${
                  typeof result.freeCharactersRemainingToday === 'number'
                    ? ` (${result.freeCharactersRemainingToday} free characters left today)`
                    : ''
                }.`
              : 'Audio node added to the canvas.'
        })
      } else if (result?.ok && kind === 'clone' && cloneAttachId) {
        // voice_clone has no file output — cloneName IS the new voice's name,
        // so attaching to a Reference person needs no parsing of the reply.
        const attachedStyle = props.styles.find((s) => s.id === cloneAttachId)
        const updated = await bridge.lora.setVoice(cloneAttachId, cloneName)
        if (updated) {
          props.onStyleUpdated(updated)
          setStatus({
            kind: 'ok',
            text: `Voice "${cloneName}" cloned and attached to Reference person "${attachedStyle?.name ?? updated.name}".`
          })
        } else {
          setStatus({ kind: 'error', text: 'Voice cloned, but attaching it to the Reference person failed.' })
        }
      } else if (result?.ok) {
        setStatus({ kind: 'ok', text: result.text ?? 'Done.' })
      } else {
        setStatus({ kind: 'error', text: result?.error ?? 'The call failed.' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <RunLine
        ok={ready || yapperTtsReady || muapiReady}
        label={
          ready
            ? 'elevenlabs · direct tool calls'
            : yapperTtsReady && muapiReady
              ? 'yapper free tier (voice) + muapi Suno (music), no ElevenLabs connected'
              : yapperTtsReady
                ? 'yapper free tier · voice only, no ElevenLabs connected'
                : muapiReady
                  ? 'muapi Suno · music only, no ElevenLabs connected'
                  : 'ElevenLabs not connected'
        }
        cost={
          ready
            ? '$ per generation'
            : yapperTtsReady || muapiReady
              ? 'free daily tier (voice) / credits (music) · $ once connected'
              : '$ per generation'
        }
      />
      <div className="tab-row">
        {(['voice', 'music', 'sfx', 'clone'] as AudioJob[]).map((j) => (
          <button key={j} className={job === j ? 'active' : ''} onClick={() => setJob(j)}>
            {{ voice: 'Voice', music: 'Music', sfx: 'SFX', clone: 'Clone' }[j]}
          </button>
        ))}
      </div>

      {job === 'voice' && (
        <>
          {useYapperVoiceFallback && (
            <p className="aside-help">
              ElevenLabs isn't connected — using Yapper's free daily-character TTS tier instead. One
              default voice, no browsing yet; connect ElevenLabs in Settings for the full voice library.
            </p>
          )}
          {!useYapperVoiceFallback && (
            <>
              <div className="mgfx-row">
                <input
                  className="cr-input"
                  placeholder="Search your voice library…"
                  value={voiceQuery}
                  onChange={(e) => setVoiceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void browse()
                  }}
                />
                <button className="conn-mini" disabled={busy} onClick={() => void browse()}>
                  Browse
                </button>
              </div>
              {voices && voices.length > 0 && (
                <div className="voice-list">
                  {voices.map((v) => (
                    <div key={v.name} className={`voice-row${voiceName === v.name ? ' sel' : ''}`}>
                      <button
                        className="voice-play"
                        title="Preview (tiny TTS call, cached)"
                        disabled={previewing !== null}
                        onClick={() => void preview(v.name)}
                      >
                        {previewing === v.name ? '…' : '▶'}
                      </button>
                      <button className="voice-name" onClick={() => setVoiceName(v.name)}>
                        {v.name}
                      </button>
                      <span className="voice-tags">{v.tags}</span>
                    </div>
                  ))}
                </div>
              )}
              {voicesRaw && <pre className="create-voice-list">{voicesRaw}</pre>}
              <input
                className="cr-input create-select"
                placeholder="Voice name (pick above; empty = default)"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
              />
            </>
          )}
          <textarea
            className="prompt-area"
            placeholder="The line to speak…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="generate-btn"
            disabled={busy || !text.trim() || (!ready && !yapperTtsReady)}
            onClick={() => void run('voice')}
          >
            {busy ? 'Generating…' : useYapperVoiceFallback ? '♪ Generate voiceover (Yapper free tier)' : '♪ Generate voiceover'}
          </button>
        </>
      )}

      {job === 'music' && (
        <>
          {useMuapiMusicFallback && (
            <p className="aside-help">
              ElevenLabs isn't connected — composing with muapi's Suno wrapper instead. Full songs,
              agent-routed (credits, not a fixed per-track price); connect ElevenLabs in Settings
              for the direct compose_music path.
            </p>
          )}
          <textarea
            className="prompt-area"
            placeholder="lo-fi citrus groove, 90 bpm, warm tape hiss"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {useMuapiMusicFallback ? (
            <>
              <label className="mgfx-row">
                <input
                  type="checkbox"
                  checked={instrumental}
                  onChange={(e) => setInstrumental(e.target.checked)}
                />
                Instrumental only (no vocals)
              </label>
              <button className="generate-btn" disabled={!text.trim()} onClick={composeMusicViaMuapi}>
                ♪ Compose music (muapi · Suno)
              </button>
              <ResultRow nodeId={musicResultId} />
            </>
          ) : (
            <>
              <ChipRow options={['30s', '60s', '120s']} value={musicLength} onChange={setMusicLength} />
              <button
                className="generate-btn"
                disabled={busy || !ready || !text.trim()}
                onClick={() => void run('music')}
              >
                {busy ? 'Composing…' : '♪ Compose music'}
              </button>
            </>
          )}
        </>
      )}

      {job === 'sfx' && (
        <>
          <textarea
            className="prompt-area"
            placeholder="vinyl scratch into a heavy bass drop"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ChipRow options={['1s', '2s', '5s']} value={sfxDuration} onChange={setSfxDuration} />
          <button className="generate-btn" disabled={busy || !text.trim()} onClick={() => void run('sfx')}>
            {busy ? 'Generating…' : '♪ Generate SFX'}
          </button>
        </>
      )}

      {job === 'clone' && (
        <>
          <p className="aside-help">
            Your own audio LoRA: sample recordings in, a reusable named voice out — it shows up in
            the Voice tab's library afterward.
          </p>
          <input
            className="cr-input create-select"
            placeholder="Name the voice"
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
          />
          <button
            className="action-btn"
            onClick={() => void bridge.media.pickFiles('audio').then((f) => f && setCloneFiles(f))}
          >
            {cloneFiles.length > 0 ? `${cloneFiles.length} sample(s) picked` : '↑ Pick sample audio files'}
          </button>
          <select
            className="cr-input create-select"
            value={cloneAttachId}
            onChange={(e) => setCloneAttachId(e.target.value)}
          >
            <option value="">Don't attach to a Reference person</option>
            {props.styles.map((s) => (
              <option key={s.id} value={s.id}>
                Attach to "{s.name}"{s.voiceName ? ` (replaces voice: ${s.voiceName})` : ''}
              </option>
            ))}
          </select>
          <button
            className="generate-btn"
            disabled={busy || !cloneName.trim() || cloneFiles.length === 0}
            onClick={() => void run('clone')}
          >
            {busy ? 'Cloning…' : '◈ Clone voice'}
          </button>
        </>
      )}

      {status && (
        <p className={`cr-msg ${status.kind === 'ok' ? 'done' : 'error'}`}>
          {status.text}
          {status.kind === 'ok' && status.text.includes('canvas') && (
            <button
              className="result-view"
              onClick={() => {
                const nodes = useStudio.getState().nodes
                const last = nodes[nodes.length - 1]
                if (last) focusNode(last.id)
              }}
            >
              view →
            </button>
          )}
        </p>
      )}
    </>
  )
}

function IsolateScreen(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const addNode = useStudio((s) => s.addNode)
  const [nodeId, setNodeId] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const videoNodes = nodes.filter(
    (n) => n.data.mediaType === 'video' && n.data.status === 'ready' && n.data.src && !n.data.panel
  )

  async function run(source: { assetUrl?: string; filePath?: string; url?: string }, label: string): Promise<void> {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const result = await bridge.media.isolateAudio(source)
      if (result?.ok && result.src) {
        // Upload-equivalent, not generate-equivalent — no generation call spent.
        addNode({
          label: `${label}_audio`,
          mediaType: 'audio',
          source: 'upload',
          src: result.src,
          startRendering: false
        })
        setDone(true)
      } else {
        setError(result?.error ?? 'Extraction failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <RunLine ok label="local ffmpeg — no connector" cost="free" />
      <select className="cr-input create-select" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
        <option value="">From a canvas video node…</option>
        {videoNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.data.label}
          </option>
        ))}
      </select>
      <button
        className="action-btn"
        disabled={busy || !nodeId}
        onClick={() => {
          const node = videoNodes.find((n) => n.id === nodeId)
          if (node?.data.src) void run({ assetUrl: node.data.src }, node.data.label)
        }}
      >
        ⏏ Extract from that node
      </button>
      <button
        className="action-btn"
        disabled={busy}
        onClick={() =>
          void bridge.media.pickFile('video').then((f) => {
            if (f) void run({ filePath: f.path }, f.name.replace(/\.[^.]+$/, ''))
          })
        }
      >
        ↑ Extract from a file…
      </button>
      <input
        className="link-input"
        placeholder="⛓ …or paste a DIRECT video file URL, press Enter"
        value={url}
        disabled={busy}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && url.trim()) {
            void run({ url: url.trim() }, 'ripped')
          }
        }}
      />
      <p className="aside-note">
        Hosting-site links (YouTube etc.) aren't direct media files and are out of scope for now.
      </p>
      {busy && <p className="cr-msg">Extracting…</p>}
      {done && <p className="cr-msg done">Audio node added to the canvas.</p>}
      {error && <p className="cr-msg error">{error}</p>}
    </>
  )
}

const TRAINERS = [
  { id: 'krea-2', label: 'Krea 2 — best Krea look ($0.003/step)', steps: ['100', '300', '1000'], defaultSteps: '300' },
  { id: 'flux-krea', label: 'FLUX.1 Krea [dev] (~$2/run)', steps: ['500', '1000', '2000'], defaultSteps: '1000' },
  {
    id: 'krea-k2',
    label: 'Krea 2 direct — production styles route (Krea API balance)',
    steps: ['500', '1000', '1500'],
    defaultSteps: '1000'
  }
]

function LoraScreen(props: {
  connectors: ConnectorView[]
  prefill?: { imageSrc: string; name: string } | null
}): React.JSX.Element {
  const [name, setName] = useState(props.prefill?.name ?? '')
  const [files, setFiles] = useState<string[]>(props.prefill ? [props.prefill.imageSrc] : [])
  const [trainer, setTrainer] = useState(TRAINERS[0].id)
  const [steps, setSteps] = useState(TRAINERS[0].defaultSteps)
  const [kind, setKind] = useState<'style' | 'subject'>(props.prefill ? 'subject' : 'style')
  const [triggerWord, setTriggerWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const trainerConnectorId = trainer === 'krea-k2' ? 'krea' : 'fal'
  const ready = connectorReady(props.connectors, trainerConnectorId)

  const trainerDef = TRAINERS.find((t) => t.id === trainer) ?? TRAINERS[0]

  async function train(): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const result = await bridge.lora.train({
        name,
        imagePaths: files,
        steps: parseInt(steps, 10),
        triggerWord: triggerWord.trim() || undefined,
        trainer,
        kind
      })
      if (result?.ok && result.style) {
        setStatus({
          kind: 'ok',
          text: `Trained "${result.style.name}" — pick it in Generate image, manage it in Settings › Trained styles.`
        })
        setName('')
        setFiles([])
      } else {
        setStatus({ kind: 'error', text: result?.error ?? 'Training failed.' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <RunLine
        ok={ready}
        label={ready ? `${trainerConnectorId} · ${trainerDef.id} trainer` : `${trainerConnectorId} not connected`}
        cost={
          trainerDef.id === 'krea-2'
            ? '$0.003/step'
            : trainerDef.id === 'krea-k2'
              ? '$$ Krea API balance (unpublished per-job rate)'
              : '~$2/run'
        }
      />
      <p className="aside-help">
        {props.prefill
          ? 'Started from a Deepfake reference photo — pick more of the same person for a stronger identity LoRA (4+ is better).'
          : 'Use 4+ example images; more is better.'}
      </p>
      <select
        className="cr-input create-select"
        value={trainer}
        onChange={(e) => {
          setTrainer(e.target.value)
          const def = TRAINERS.find((t) => t.id === e.target.value)
          if (def) setSteps(def.defaultSteps)
        }}
      >
        {TRAINERS.map((t) => (
          <option key={t.id} value={t.id}>
            Trainer: {t.label}
          </option>
        ))}
      </select>
      <div className="tab-row">
        <button className={kind === 'style' ? 'active' : ''} onClick={() => setKind('style')}>
          Style
        </button>
        <button className={kind === 'subject' ? 'active' : ''} onClick={() => setKind('subject')}>
          Subject / character
        </button>
      </div>
      <input
        className="cr-input create-select"
        placeholder="Style name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="cr-input create-select"
        placeholder="Trigger word (optional — e.g. LYMESTYLE)"
        value={triggerWord}
        onChange={(e) => setTriggerWord(e.target.value)}
      />
      <button
        className="action-btn"
        onClick={() =>
          void bridge.media
            .pickFiles('image')
            .then((f) => f && setFiles((prev) => [...new Set([...prev, ...f])]))
        }
      >
        {files.length > 0 ? `${files.length} training image(s) picked` : '↑ Pick training images'}
      </button>
      <ChipRow options={trainerDef.steps} value={steps} onChange={setSteps} />
      <button
        className="generate-btn"
        disabled={busy || !name.trim() || files.length === 0}
        onClick={() => void train()}
      >
        {busy ? 'Training… (can take minutes)' : '◈ Train LoRA'}
      </button>
      {status && <p className={`cr-msg ${status.kind === 'ok' ? 'done' : 'error'}`}>{status.text}</p>}
    </>
  )
}

/**
 * Scores each Reference person's `personaTone` tag against a shot's "feeling"
 * hint by word overlap and returns the best match, or undefined if nobody has
 * a tone tag or nothing overlaps — an honest "no suggestion" beats guessing
 * (docs/ui/node-enrichment-strategy.md, row 8). Only considers styles that are
 * actually Reference people (have a voice paired) — a bare trained style with
 * no voice can't drive Stage 1's speech anyway.
 */
function suggestReferencePerson(styles: TrainedStyle[], toneHint: string): TrainedStyle | undefined {
  const hintWords = new Set(toneHint.toLowerCase().match(/[a-z]+/g) ?? [])
  if (hintWords.size === 0) return undefined
  let best: TrainedStyle | undefined
  let bestScore = 0
  for (const style of styles) {
    if (!style.voiceName || !style.personaTone) continue
    const toneWords = style.personaTone.toLowerCase().match(/[a-z]+/g) ?? []
    const score = toneWords.filter((w) => hintWords.has(w)).length
    if (score > bestScore) {
      best = style
      bestScore = score
    }
  }
  return best
}

/**
 * Staged, per docs/ui/node-enrichment-strategy.md's flagship build order: a
 * Reference person (trained identity + ElevenLabs voice, paired in Settings ›
 * Trained styles) speaks a script — Stage 1 renders the speech directly via
 * ElevenLabs (each stage its own visible node, same pattern as the Motion
 * graphics wizard), Stage 2 drives a source video/photo with it through
 * whichever of Yapper/muapi are connected, restricted with `connectorIds` so
 * the agent can chain an upload tool into a lip-sync/face-swap tool without
 * opening every installed connector.
 */
function DeepfakeScreen(props: {
  connectors: ConnectorView[]
  styles: TrainedStyle[]
  onTrainFromFace: (imageSrc: string, name: string) => void
}): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const addNode = useStudio((s) => s.addNode)
  const generateMedia = useStudio((s) => s.generateMedia)
  const deepfakeHandoff = useStudio((s) => s.deepfakeHandoff)
  const clearDeepfakeHandoff = useStudio((s) => s.clearDeepfakeHandoff)

  const [personId, setPersonId] = useState('')
  const [voiceName, setVoiceName] = useState('')
  const [script, setScript] = useState('')
  const [faceNodeId, setFaceNodeId] = useState('')
  const [speechBusy, setSpeechBusy] = useState(false)
  const [speechStatus, setSpeechStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [speechSrc, setSpeechSrc] = useState<string | null>(null)
  const [resultId, setResultId] = useState<string | null>(null)
  const [handoffNote, setHandoffNote] = useState<string | null>(null)

  useEffect(() => {
    if (!deepfakeHandoff) return
    setScript(deepfakeHandoff.script)
    const suggested = suggestReferencePerson(props.styles, deepfakeHandoff.toneHint)
    if (suggested) {
      setPersonId(suggested.id)
      setHandoffNote(
        `Script sent from Storyboard. Feeling "${deepfakeHandoff.toneHint}" matched "${suggested.name}" — pick a different Reference person if that's wrong.`
      )
    } else {
      setHandoffNote(
        deepfakeHandoff.toneHint
          ? `Script sent from Storyboard. No Reference person's tone matched "${deepfakeHandoff.toneHint}" — pick one below, or tag a person's tone in Settings › Trained styles.`
          : 'Script sent from Storyboard.'
      )
    }
    clearDeepfakeHandoff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepfakeHandoff])

  const person = props.styles.find((s) => s.id === personId)
  const elevenlabsReady = connectorReady(props.connectors, 'elevenlabs')
  const faceConnectorIds = ['yapper', 'muapi'].filter((id) => connectorReady(props.connectors, id))
  const ready = faceConnectorIds.length > 0
  const effectiveVoice = voiceName.trim() || person?.voiceName || ''

  const faceNodes = nodes.filter(
    (n) =>
      (n.data.mediaType === 'video' || n.data.mediaType === 'image') &&
      n.data.status === 'ready' &&
      n.data.src &&
      !n.data.panel
  )
  const faceNode = faceNodes.find((n) => n.id === faceNodeId)
  const faceImageSrc = faceNode?.data.mediaType === 'image' ? faceNode.data.src : undefined

  async function generateSpeech(): Promise<void> {
    setSpeechBusy(true)
    setSpeechStatus(null)
    try {
      const result = await bridge.audioTools.tts({ text: script, voiceName: effectiveVoice || undefined })
      if (result?.ok && result.src) {
        addNode({
          label: labelFromPrompt(script, 'df-speech'),
          mediaType: 'audio',
          source: 'generate',
          src: result.src,
          startRendering: false
        })
        setSpeechSrc(result.src)
        setSpeechStatus({ kind: 'ok', text: 'Speech generated — audio node added to the canvas.' })
      } else {
        setSpeechStatus({ kind: 'error', text: result?.error ?? 'Speech generation failed.' })
      }
    } finally {
      setSpeechBusy(false)
    }
  }

  function generateFace(): void {
    const faceSrc = faceNode?.data.src
    if (!speechSrc || !faceSrc) return
    const chainNote =
      faceConnectorIds.includes('muapi') && faceConnectorIds.includes('yapper')
        ? 'Preferred route: muapi — call its own upload tool on the source media and the speech audio to get hosted URLs (if not already URLs), then muapi_edit_lipsync with those URLs. If the source is only a still photo (no source performance video), use muapi_enhance_face_swap in image mode instead — that swaps identity but will not move the mouth to match speech. Yapper is the fallback: import the same hosted URLs as Yapper assets (yapper_import_asset), then start a video-lipsync process with model "max".'
        : faceConnectorIds.includes('muapi')
          ? 'Use muapi: call its own upload tool on the source media and the speech audio to get hosted URLs, then muapi_edit_lipsync with those URLs (or muapi_enhance_face_swap in image mode if the source is only a still photo, no source video).'
          : 'Use Yapper: if the source media and speech audio are not already Yapper assets, import each by URL with yapper_import_asset (they need to already be hosted somewhere reachable — this connector has no local-file-upload tool), then start a video-lipsync process with model "max".'

    setResultId(
      generateMedia({
        label: labelFromPrompt(script, 'df'),
        mediaType: 'video',
        prompt: [
          'Talking-avatar lip-sync: drive the source face/performance media with the already-generated speech audio — do not regenerate the speech.',
          person ? `Reference person: "${person.name}".` : undefined,
          `Script that was spoken: "${script.trim()}"`,
          chainNote
        ]
          .filter(Boolean)
          .join(' '),
        connectorIds: faceConnectorIds,
        sourceMediaPath: faceSrc,
        referenceAudioPaths: [speechSrc]
      })
    )
  }

  return (
    <>
      <RunLine
        ok={ready}
        label={ready ? `${faceConnectorIds.join(' + ')} · lip-sync/face` : 'Yapper or muapi not connected'}
        cost="credits"
      />
      <p className="aside-help">
        Staged talking-avatar: pick a Reference person (identity + voice, paired in Settings ›
        Trained styles), write the script, generate the speech, then drive a source video or photo
        with it.
      </p>
      {handoffNote && <p className="cr-msg">{handoffNote}</p>}

      {props.styles.length > 0 && (
        <select
          className="cr-input create-select"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">Reference person: none (type a voice name below)</option>
          {props.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.voiceName ? ` · voice: ${s.voiceName}` : ' · no voice yet'}
            </option>
          ))}
        </select>
      )}
      <input
        className="cr-input create-select"
        placeholder="ElevenLabs voice name (from the person above, or type one)"
        value={voiceName}
        onChange={(e) => setVoiceName(e.target.value)}
      />
      <textarea
        className="prompt-area"
        placeholder="The script they deliver…"
        value={script}
        onChange={(e) => setScript(e.target.value)}
      />
      <button
        className="action-btn"
        disabled={!elevenlabsReady || speechBusy || !script.trim()}
        title={elevenlabsReady ? undefined : 'ElevenLabs not connected'}
        onClick={() => void generateSpeech()}
      >
        {speechBusy ? 'Generating speech…' : '1 · Generate speech (ElevenLabs)'}
      </button>
      {speechStatus && (
        <p className={`cr-msg ${speechStatus.kind === 'ok' ? 'done' : 'error'}`}>{speechStatus.text}</p>
      )}

      {faceNodes.length > 0 ? (
        <select
          className="cr-input create-select"
          value={faceNodeId}
          onChange={(e) => setFaceNodeId(e.target.value)}
        >
          <option value="">Face/performance media: pick a canvas node…</option>
          {faceNodes.map((n) => (
            <option key={n.id} value={n.id}>
              ({n.data.mediaType}) {n.data.label}
            </option>
          ))}
        </select>
      ) : (
        <p className="aside-note">
          No ready video/image node on the canvas yet — upload or generate one first.
        </p>
      )}
      {faceImageSrc && (
        <button
          className="action-btn"
          onClick={() =>
            props.onTrainFromFace(faceImageSrc, person ? `${person.name} — LoRA` : faceNode!.data.label)
          }
        >
          ◈ Train a LoRA from this photo
        </button>
      )}
      <button className="generate-btn" disabled={!ready || !speechSrc || !faceNode} onClick={generateFace}>
        2 · Lip-sync / face
      </button>
      <ResultRow nodeId={resultId} />
    </>
  )
}

function UploadScreen(props: { done: () => void }): React.JSX.Element {
  const addNode = useStudio((s) => s.addNode)
  async function upload(kind: 'video' | 'image' | 'audio'): Promise<void> {
    const imported = await bridge.media.import(kind)
    if (!imported) return
    addNode({
      label: imported.name,
      mediaType: imported.mediaType,
      source: 'upload',
      src: imported.src
    })
    props.done()
  }
  return (
    <>
      <button className="action-btn" onClick={() => void upload('video')}>▶ Upload video</button>
      <button className="action-btn" onClick={() => void upload('image')}>▦ Upload image</button>
      <button className="action-btn" onClick={() => void upload('audio')}>♪ Upload audio</button>
    </>
  )
}

function LinkScreen(props: { done: () => void }): React.JSX.Element {
  const addNode = useStudio((s) => s.addNode)
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleLink(): Promise<void> {
    const url = link.trim()
    if (!url) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.media.importUrl(url)
      if (result?.src) {
        let label: string
        try {
          const tail = new URL(url).pathname.split('/').filter(Boolean).pop()
          label = tail || new URL(url).hostname
        } catch {
          label = result.name || url.slice(0, 20)
        }
        addNode({ label, mediaType: 'video', source: 'link', sourceUrl: url, src: result.src })
        props.done()
      } else {
        setError(result?.error ?? 'Download failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        className="link-input"
        placeholder="⛓ Paste a video link, press Enter…"
        value={link}
        disabled={busy}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleLink()
        }}
      />
      {busy && <p className="cr-msg">Downloading…</p>}
      {error && <p className="cr-msg error">{error}</p>}
    </>
  )
}

export function AsidePanel(): React.JSX.Element {
  const collapsed = useStudio((s) => s.asideCollapsed)
  const toggle = useStudio((s) => s.toggleAside)
  const width = useStudio((s) => s.asideWidth)

  const [screen, setScreen] = useState<Screen>('home')
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [styles, setStyles] = useState<TrainedStyle[]>([])
  const [loraPrefill, setLoraPrefill] = useState<{ imageSrc: string; name: string } | null>(null)
  const deepfakeHandoff = useStudio((s) => s.deepfakeHandoff)

  useEffect(() => {
    void bridge.connectors.list().then(setConnectors)
    void bridge.lora.list().then(setStyles)
  }, [screen])

  useEffect(() => {
    if (deepfakeHandoff) setScreen('deepfake')
  }, [deepfakeHandoff])

  const home = (): void => setScreen('home')

  return (
    <div
      className={`side-panel aside${collapsed ? ' collapsed' : ''}`}
      style={collapsed ? undefined : { width }}
    >
      {/* Back top-left (where collapse used to sit), title centered, collapse
          right-aligned — per the user's markup of the v2 build. */}
      <div className="panel-head create-head">
        <div className="btns">
          {screen !== 'home' && !collapsed ? (
            <button className="panel-btn" title="Back to Create" onClick={home}>
              ←
            </button>
          ) : (
            <span className="panel-btn-spacer" />
          )}
        </div>
        <span className="create-head-title">{SCREEN_TITLES[screen]}</span>
        <div className="btns">
          <button className="panel-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={toggle}>
            {collapsed ? '‹' : '›'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {screen === 'home' && (
          <div className="create-tiles">
            {TILES.map((tile, index) => {
              const state = tileReady(connectors, tile.key)
              return (
                <button
                  key={tile.key}
                  className={`create-tile${state.ready ? '' : ' dim'}`}
                  title={
                    state.ready
                      ? tile.blurb
                      : `${tile.blurb} — connect any of: ${state.options}`
                  }
                  onClick={() => {
                    setLoraPrefill(null)
                    setScreen(tile.key)
                  }}
                >
                  <span className={`create-tile-thumb sw${(index % 6) + 1}`}>
                    {tile.glyph}
                    {!state.ready && <span className="tile-needs">needs {state.needs}</span>}
                  </span>
                  <span className="create-tile-label">
                    {tile.label}
                    <span className={`tile-status${state.ready ? ' ok' : ''}`} />
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {screen === 'video' && <VideoScreen connectors={connectors} />}
        {screen === 'image' && <ImageScreen connectors={connectors} styles={styles} />}
        {screen === 'audio' && (
          <AudioScreen
            connectors={connectors}
            styles={styles}
            onStyleUpdated={(updated) =>
              setStyles((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            }
          />
        )}
        {screen === 'isolate' && <IsolateScreen />}
        {screen === 'lora' && <LoraScreen connectors={connectors} prefill={loraPrefill} />}
        {screen === 'deepfake' && (
          <DeepfakeScreen
            connectors={connectors}
            styles={styles}
            onTrainFromFace={(imageSrc, name) => {
              setLoraPrefill({ imageSrc, name })
              setScreen('lora')
            }}
          />
        )}
        {screen === 'upload' && <UploadScreen done={home} />}
        {screen === 'link' && <LinkScreen done={home} />}
        {screen === 'motion' && <MotionGraphicsWizard />}
        {screen === 'pull' && <ChatRealtyPull />}
      </div>
    </div>
  )
}
