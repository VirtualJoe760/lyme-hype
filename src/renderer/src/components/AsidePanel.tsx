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
  { key: 'deepfake', glyph: '☺', label: 'Deepfake', blurb: 'Lip-sync / talking avatars via Yapper' },
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

/** Which connectors make a tile ready (ANY of them). null = always ready
 *  (local ffmpeg / disk / download — never a connector). */
const TILE_NEEDS: Partial<Record<Screen, string[]>> = {
  video: ['muapi', 'fal', 'gemini', 'krea'],
  image: ['gemini', 'openai', 'muapi', 'fal', 'krea'],
  audio: ['elevenlabs'],
  motion: ['gemini', 'openai'],
  lora: ['fal'],
  deepfake: ['yapper'],
  pull: ['chatrealty']
}

function connectorReady(connectors: ConnectorView[], id: string): boolean {
  const def = connectors.find((c) => c.id === id)
  return !!def && (def.authType === 'none' || def.hasCredential)
}

function tileReady(connectors: ConnectorView[], screen: Screen): { ready: boolean; needs?: string } {
  const needs = TILE_NEEDS[screen]
  if (!needs) return { ready: true }
  if (needs.some((id) => connectorReady(connectors, id))) return { ready: true }
  return { ready: false, needs: needs[0] }
}

const ASPECTS = ['9:16', '1:1', '16:9']
const DURATIONS = ['6s', '12s', '15s']
const RESOLUTIONS = ['720p', '1080p']

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
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  const [duration, setDuration] = useState('12s')
  const [resultId, setResultId] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [resolution, setResolution] = useState('1080p')
  // Routing intent (catalog.md): muapi is the video primary when installed.
  const muapiReady = connectorReady(props.connectors, 'muapi')
  const [connector, setConnector] = useState(muapiReady ? 'muapi' : '')
  const { ready } = tileReady(props.connectors, 'video')

  return (
    <>
      <RunLine
        ok={ready}
        label={
          ready
            ? `runs on ${connector || 'agent pick'}${connector === 'muapi' ? ' · seedance' : ''}`
            : 'no video connector connected'
        }
        cost="$$ paid"
      />
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
              connectorId: connector || undefined
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

  const runLabel = style
    ? `fal · ${style.trainer === 'flux-krea' ? 'flux-krea-lora' : 'krea 2 lora'} · "${style.name}"`
    : tier === 'production'
      ? muapiReady
        ? 'midjourney via muapi'
        : 'production needs muapi'
      : storyboardConnector
        ? `${storyboardConnector} · storyboard tier`
        : 'no storyboard connector'
  const runOk = style ? connectorReady(props.connectors, 'fal') : tier === 'production' ? muapiReady : !!storyboardConnector

  function handleGenerate(): void {
    // The tier choice drives GenerationParams.connectorId — the routing gap
    // closed in Phase 13. A trained LoRA routes through fal with the weights
    // URL in the hint so the agent passes it to the model's lora parameter.
    const connectorId =
      style !== undefined ? 'fal' : tier === 'production' ? (muapiReady ? 'muapi' : undefined) : storyboardConnector || undefined
    const styleHint = style
      ? `${style.trainer === 'flux-krea' ? 'the fal-ai/flux-krea-lora model' : 'the Krea 2 LoRA model'} with my trained LoRA "${style.name}"${style.loraUrl ? ` (weights: ${style.loraUrl}, strength ~0.9)` : ''}`
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

function AudioScreen(props: { connectors: ConnectorView[] }): React.JSX.Element {
  const addNode = useStudio((s) => s.addNode)
  const focusNode = useStudio((s) => s.focusNode)
  const [job, setJob] = useState<AudioJob>('voice')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const ready = connectorReady(props.connectors, 'elevenlabs')

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

  async function run(kind: AudioJob): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const result =
        kind === 'voice'
          ? await bridge.audioTools.tts({ text, voiceName: voiceName || undefined })
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
        setStatus({ kind: 'ok', text: 'Audio node added to the canvas.' })
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
        ok={ready}
        label={ready ? 'elevenlabs · direct tool calls' : 'ElevenLabs not connected'}
        cost="$ per generation"
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
          <textarea
            className="prompt-area"
            placeholder="The line to speak…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="generate-btn" disabled={busy || !text.trim()} onClick={() => void run('voice')}>
            {busy ? 'Generating…' : '♪ Generate voiceover'}
          </button>
        </>
      )}

      {job === 'music' && (
        <>
          <textarea
            className="prompt-area"
            placeholder="lo-fi citrus groove, 90 bpm, warm tape hiss"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ChipRow options={['30s', '60s', '120s']} value={musicLength} onChange={setMusicLength} />
          <button className="generate-btn" disabled={busy || !text.trim()} onClick={() => void run('music')}>
            {busy ? 'Composing…' : '♪ Compose music'}
          </button>
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
  { id: 'flux-krea', label: 'FLUX.1 Krea [dev] (~$2/run)', steps: ['500', '1000', '2000'], defaultSteps: '1000' }
]

function LoraScreen(props: { connectors: ConnectorView[] }): React.JSX.Element {
  const [name, setName] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [trainer, setTrainer] = useState(TRAINERS[0].id)
  const [steps, setSteps] = useState(TRAINERS[0].defaultSteps)
  const [kind, setKind] = useState<'style' | 'subject'>('style')
  const [triggerWord, setTriggerWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const ready = connectorReady(props.connectors, 'fal')

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
        label={ready ? `fal · ${trainerDef.id} trainer` : 'fal not connected'}
        cost={trainerDef.id === 'krea-2' ? '$0.003/step' : '~$2/run'}
      />
      <p className="aside-help">Use 4+ example images; more is better.</p>
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
        onClick={() => void bridge.media.pickFiles('image').then((f) => f && setFiles(f))}
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

function DeepfakeScreen(props: { connectors: ConnectorView[] }): React.JSX.Element {
  const generateMedia = useStudio((s) => s.generateMedia)
  const [prompt, setPrompt] = useState('')
  const [resultId, setResultId] = useState<string | null>(null)
  const ready = connectorReady(props.connectors, 'yapper')

  // Yapper's real API surface (verified): lip-sync/talking-avatar only — no
  // face-swap process type exists, so no face-swap mode is offered.
  return (
    <>
      <RunLine ok={ready} label={ready ? 'yapper · max lip-sync' : 'Yapper not connected'} cost="credits" />
      <p className="aside-help">
        Talking-avatar / lip-sync via Yapper's Max model. Describe who talks (an asset in your
        Yapper library, or one the agent imports by URL) and the script — the agent chains speech
        generation and lip-sync.
      </p>
      <textarea
        className="prompt-area"
        placeholder="Who talks, and the script they deliver…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button
        className="generate-btn"
        disabled={!prompt.trim()}
        onClick={() =>
          setResultId(
            generateMedia({
              label: labelFromPrompt(prompt, 'df'),
              mediaType: 'video',
              prompt: `Talking-avatar lip-sync job (generate the speech audio first if needed, then lip-sync): ${prompt.trim()}`,
              connectorId: 'yapper'
            })
          )
        }
      >
        Generate via Yapper
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

  useEffect(() => {
    void bridge.connectors.list().then(setConnectors)
    void bridge.lora.list().then(setStyles)
  }, [screen])

  const home = (): void => setScreen('home')

  return (
    <div
      className={`side-panel aside${collapsed ? ' collapsed' : ''}`}
      style={collapsed ? undefined : { width }}
    >
      <div className="panel-head">
        <div className="btns">
          <button className="panel-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={toggle}>
            {collapsed ? '‹' : '›'}
          </button>
        </div>
        <span>{SCREEN_TITLES[screen]}</span>
      </div>
      <div className="panel-body">
        {screen !== 'home' && (
          <button className="play-back create-back-row" onClick={home}>
            ← Back to Create
          </button>
        )}
        {screen === 'home' && (
          <div className="create-tiles">
            {TILES.map((tile, index) => {
              const state = tileReady(connectors, tile.key)
              return (
                <button
                  key={tile.key}
                  className={`create-tile${state.ready ? '' : ' dim'}`}
                  title={state.ready ? tile.blurb : `${tile.blurb} — connect ${state.needs} first`}
                  onClick={() => setScreen(tile.key)}
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
        {screen === 'audio' && <AudioScreen connectors={connectors} />}
        {screen === 'isolate' && <IsolateScreen />}
        {screen === 'lora' && <LoraScreen connectors={connectors} />}
        {screen === 'deepfake' && <DeepfakeScreen connectors={connectors} />}
        {screen === 'upload' && <UploadScreen done={home} />}
        {screen === 'link' && <LinkScreen done={home} />}
        {screen === 'motion' && <MotionGraphicsWizard />}
        {screen === 'pull' && <ChatRealtyPull />}
      </div>
    </div>
  )
}
