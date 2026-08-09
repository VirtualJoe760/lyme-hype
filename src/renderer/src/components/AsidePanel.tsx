import { useEffect, useState } from 'react'
import { findManifest } from '@shared/node-manifest'
import type { ConnectorView, TrainedStyle } from '@shared/types'
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
          <NodePanel manifest={findManifest('audio')!} connectors={connectors} styles={styles} />
        )}
        {screen === 'isolate' && <IsolateScreen />}
        {screen === 'lora' && (
          <NodePanel manifest={findManifest('lora')!} connectors={connectors} styles={styles} />
        )}
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
