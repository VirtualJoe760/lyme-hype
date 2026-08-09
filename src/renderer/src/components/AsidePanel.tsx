import { useEffect, useRef, useState } from 'react'
import { findManifest } from '@shared/node-manifest'
import type { ConnectorView, TrainedStyle, VoiceEntry, YapperVoiceEntry } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { ChatRealtyPull } from './ChatRealtyPull'
import { MotionGraphicsWizard } from './MotionGraphicsWizard'
import { NodePanel } from './NodePanel'

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
  const [yapperVoiceProvider, setYapperVoiceProvider] = useState<'cartesia' | 'elevenlabs'>('cartesia')
  const [yapperVoiceQuery, setYapperVoiceQuery] = useState('')
  const [yapperVoices, setYapperVoices] = useState<YapperVoiceEntry[] | null>(null)
  const [yapperVoiceId, setYapperVoiceId] = useState('')
  const [yapperVoiceError, setYapperVoiceError] = useState('')
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

  async function browseYapperVoices(): Promise<void> {
    setBusy(true)
    setYapperVoiceError('')
    try {
      const result = await bridge.audioTools.yapperVoices({
        provider: yapperVoiceProvider,
        search: yapperVoiceQuery || undefined
      })
      if (result?.ok) {
        setYapperVoices(result.yapperVoices ?? [])
      } else {
        setYapperVoices(null)
        setYapperVoiceError(result?.error ?? 'Voice list failed.')
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
            ? await bridge.audioTools.yapperTts({ text, voiceId: yapperVoiceId || undefined })
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
            <>
              <p className="aside-help">
                ElevenLabs isn't connected — using Yapper's free daily-character TTS tier instead.
                Connect ElevenLabs in Settings for the full voice library.
              </p>
              <div className="tab-row">
                {(['cartesia', 'elevenlabs'] as const).map((p) => (
                  <button
                    key={p}
                    className={yapperVoiceProvider === p ? 'active' : ''}
                    onClick={() => {
                      setYapperVoiceProvider(p)
                      setYapperVoices(null)
                      setYapperVoiceId('')
                    }}
                  >
                    {p === 'cartesia' ? 'Cartesia' : 'ElevenLabs (via Yapper)'}
                  </button>
                ))}
              </div>
              <div className="mgfx-row">
                <input
                  className="cr-input"
                  placeholder="Search this provider's voices…"
                  value={yapperVoiceQuery}
                  onChange={(e) => setYapperVoiceQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void browseYapperVoices()
                  }}
                />
                <button className="conn-mini" disabled={busy} onClick={() => void browseYapperVoices()}>
                  Browse
                </button>
              </div>
              {yapperVoiceError && <p className="aside-help">⚠ {yapperVoiceError}</p>}
              {yapperVoices && yapperVoices.length > 0 && (
                <div className="voice-list">
                  {yapperVoices.map((v) => (
                    <div key={v.id} className={`voice-row${yapperVoiceId === v.id ? ' sel' : ''}`}>
                      <button className="voice-name" onClick={() => setYapperVoiceId(v.id)}>
                        {v.name}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {yapperVoices && yapperVoices.length === 0 && (
                <p className="aside-help">No voices matched — try clearing the search.</p>
              )}
              {yapperVoiceId && (
                <p className="aside-help">
                  Using{' '}
                  {yapperVoices?.find((v) => v.id === yapperVoiceId)?.name ?? yapperVoiceId}.{' '}
                  <button className="voice-name" onClick={() => setYapperVoiceId('')}>
                    Clear
                  </button>
                </p>
              )}
            </>
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
  const pendingNodeScreen = useStudio((s) => s.pendingNodeScreen)
  const clearPendingNodeScreen = useStudio((s) => s.clearPendingNodeScreen)

  useEffect(() => {
    void bridge.connectors.list().then(setConnectors)
    void bridge.lora.list().then(setStyles)
  }, [screen])

  // An artifact handoff names the node it goes to; this is what makes the pill's
  // promise true instead of a relabelled Finish.
  useEffect(() => {
    if (!pendingNodeScreen) return
    setScreen(pendingNodeScreen as Screen)
    clearPendingNodeScreen()
  }, [pendingNodeScreen, clearPendingNodeScreen])

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
        {screen === 'video' && (
          <NodePanel manifest={findManifest('video')!} connectors={connectors} styles={styles} />
        )}
        {screen === 'image' && (
          <NodePanel
            manifest={findManifest('image')!}
            connectors={connectors}
            styles={styles}
            onBack={home}
          />
        )}
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
          <NodePanel manifest={findManifest('deepfake')!} connectors={connectors} styles={styles} />
        )}
        {screen === 'upload' && <UploadScreen done={home} />}
        {screen === 'link' && <LinkScreen done={home} />}
        {screen === 'motion' && <MotionGraphicsWizard />}
        {screen === 'pull' && <ChatRealtyPull />}
      </div>
    </div>
  )
}
