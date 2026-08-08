import { useState } from 'react'
import type { MediaType } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'
import { AgentCard } from './AgentCard'
import { ChatRealtyPull } from './ChatRealtyPull'

type MediaTab = 'video' | 'motion' | 'image' | 'audio'
type ModeTab = 'reference' | 'keyframe' | 'text'

const MEDIA_TABS: { key: MediaTab; label: string }[] = [
  { key: 'video', label: 'Video' },
  { key: 'motion', label: 'Motion GFX' },
  { key: 'image', label: 'Image' },
  { key: 'audio', label: 'Audio' }
]

const MODE_TABS: { key: ModeTab; label: string }[] = [
  { key: 'reference', label: 'Reference' },
  { key: 'keyframe', label: 'Keyframe' },
  { key: 'text', label: 'Text' }
]

const ASPECTS = ['9:16', '1:1', '16:9']
const DURATIONS = ['6s', '12s', '15s']
const RESOLUTIONS = ['720p', '1080p']

function tabToMediaType(tab: MediaTab): MediaType {
  if (tab === 'image') return 'image'
  if (tab === 'audio') return 'audio'
  return 'video'
}

let generateCounter = 0

function labelFromPrompt(prompt: string, tab: MediaTab): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('-').toLowerCase()
  const base = words.replace(/[^a-z0-9-]/g, '').slice(0, 16)
  generateCounter += 1
  const prefix = tab === 'motion' ? 'gfx' : tab === 'audio' ? 'aud' : tab === 'image' ? 'img' : 'clip'
  return base ? `${prefix}_${base}` : `${prefix}_${String(generateCounter).padStart(2, '0')}`
}

export function AsidePanel(): React.JSX.Element {
  const collapsed = useStudio((s) => s.asideCollapsed)
  const toggle = useStudio((s) => s.toggleAside)
  const addNode = useStudio((s) => s.addNode)
  const setConnectionsOpen = useStudio((s) => s.setConnectionsOpen)

  const [mediaTab, setMediaTab] = useState<MediaTab>('video')
  const [modeTab, setModeTab] = useState<ModeTab>('keyframe')
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('9:16')
  const [duration, setDuration] = useState('12s')
  const [resolution, setResolution] = useState('1080p')
  const [link, setLink] = useState('')

  const linkEligible = mediaTab === 'video' || mediaTab === 'motion'

  function handleGenerate(): void {
    addNode({
      label: labelFromPrompt(prompt, mediaTab),
      mediaType: tabToMediaType(mediaTab),
      source: 'generate',
      motionGfx: mediaTab === 'motion' || undefined
    })
  }

  async function handleUpload(): Promise<void> {
    const kind = tabToMediaType(mediaTab)
    const file = await bridge.media.pickFile(kind)
    if (!file) return
    addNode({
      label: file.name,
      mediaType: kind,
      source: 'upload',
      motionGfx: mediaTab === 'motion' || undefined,
      filePath: file.path
    })
  }

  function handleLink(): void {
    const url = link.trim()
    if (!url || !linkEligible) return
    let label: string
    try {
      const tail = new URL(url).pathname.split('/').filter(Boolean).pop()
      label = tail || new URL(url).hostname
    } catch {
      label = url.slice(0, 20)
    }
    addNode({
      label,
      mediaType: 'video',
      source: 'link',
      motionGfx: mediaTab === 'motion' || undefined,
      sourceUrl: url,
      // Linked media gets downloaded/transcoded before it's usable (Phase 4) —
      // the rendering state mirrors that from day one.
      startRendering: true
    })
    setLink('')
  }

  return (
    <div className={`side-panel aside${collapsed ? ' collapsed' : ''}`}>
      <div className="panel-head">
        <div className="btns">
          <button className="panel-btn" title={collapsed ? 'Expand' : 'Collapse'} onClick={toggle}>
            {collapsed ? '‹' : '›'}
          </button>
        </div>
        <span>Add to canvas</span>
      </div>
      <div className="panel-body">
        <div className="conn-strip">
          <span className="conn-chip" title="Quick-start template — wired for real in Phase 3">
            ChatRealty
          </span>
          <span className="conn-chip" title="Quick-start template — wired for real in Phase 4">
            Seedance
          </span>
          <span className="conn-chip" title="Quick-start template — wired for real in Phase 4">
            ElevenLabs
          </span>
          <span
            className="conn-chip add"
            title="Connections"
            onClick={() => setConnectionsOpen(true)}
          >
            +
          </span>
        </div>

        <div className="tab-row">
          {MEDIA_TABS.map((tab) => (
            <button
              key={tab.key}
              className={mediaTab === tab.key ? 'active' : ''}
              onClick={() => setMediaTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="tab-row">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.key}
              className={modeTab === tab.key ? 'active' : ''}
              onClick={() => setModeTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="aside-help">
          Describe a shot, upload a reference, or drop in audio. It lands on the canvas — drag it
          onto another node to combine.
        </p>

        <textarea
          className="prompt-area"
          placeholder="lantern spirit rising from a river of flames, chorus swell, wide shot"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="chip-row">
          {ASPECTS.map((a) => (
            <button key={a} className={`chip${aspect === a ? ' on' : ''}`} onClick={() => setAspect(a)}>
              {a}
            </button>
          ))}
          {DURATIONS.map((d) => (
            <button
              key={d}
              className={`chip${duration === d ? ' on' : ''}`}
              onClick={() => setDuration(d)}
            >
              {d}
            </button>
          ))}
          {RESOLUTIONS.map((r) => (
            <button
              key={r}
              className={`chip${resolution === r ? ' on' : ''}`}
              onClick={() => setResolution(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <button className="generate-btn" onClick={handleGenerate}>
          Generate
        </button>
        <button className="action-btn" onClick={() => void handleUpload()}>
          ↑ Upload file
        </button>
        <input
          className="link-input"
          placeholder={linkEligible ? '⛓ Paste a video link, press Enter…' : '⛓ Links: video only for now'}
          disabled={!linkEligible}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleLink()
          }}
        />
        <p className="aside-note">
          Generation is stubbed — nodes land with placeholder thumbnails until real generation
          connections arrive in Phase 4.
        </p>

        <ChatRealtyPull />
        <AgentCard />
      </div>
    </div>
  )
}
