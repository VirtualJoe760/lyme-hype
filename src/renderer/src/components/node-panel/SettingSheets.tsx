/** The node panel's setting sheets — style, media-role inputs, voice, dataset
 *  and reference images. Center-screen modals, one at a time.
 *
 * Lifted out of NodePanel whole: the sheets are ~180 lines of markup that only
 * ever render one at a time, and they were the bulk of what made that file
 * unreadable. */

import type { TrainedStyle, VoiceEntry } from '@shared/types'
import type { NodeManifest } from '@shared/node-manifest'
import type { CatalogModel } from '@shared/model-catalog'
import type { MediaFlowNode } from '../../store'
import { bridge } from '../../bridge'
import { Icon, MEDIA_ROLES } from './support'

export type RefType = 'object' | 'character' | 'style'

export interface SheetProps {
  manifest: NodeManifest
  openSetting: string | null
  setOpenSetting(value: string | null): void
  model: CatalogModel | null
  nodes: MediaFlowNode[]
  canvasImages: MediaFlowNode[]
  dataset: string[]
  toggleDatasetImage(manifestId: string, src: string): void
  nodeInputs: Record<string, Record<string, string> | undefined>
  setNodeInput(manifestId: string, role: string, src: string | undefined): void
  refs: string[]
  setRefs(value: string[] | ((prev: string[]) => string[])): void
  refTypes: Record<string, RefType>
  addRef(src: string): void
  cycleRefType(src: string): void
  maxRefs?: number
  styleId: string
  setStyleId(value: string): void
  voice: string
  setVoice(value: string): void
  voiceList: VoiceEntry[]
  trainError: string | null
  styles?: TrainedStyle[]
}

export function SettingSheets({
  manifest,
  openSetting,
  setOpenSetting,
  model,
  nodes,
  canvasImages,
  dataset,
  toggleDatasetImage,
  nodeInputs,
  setNodeInput,
  refs,
  setRefs,
  refTypes,
  addRef,
  cycleRefType,
  maxRefs,
  styleId,
  setStyleId,
  voice,
  setVoice,
  voiceList,
  trainError,
  styles
}: SheetProps): React.JSX.Element {
  return (
    <>
  {openSetting === 'style' && (
    <div className="np-pop">
      {(styles ?? []).length === 0 && (
        <span className="np-pop-empty">no trained styles yet — Create a LoRA first</span>
      )}
      <button
        className={`np-pill${styleId === '' ? ' on' : ''}`}
        onClick={() => setStyleId('')}
      >
        none
      </button>
      {(styles ?? []).map((s) => (
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

  {openSetting && MEDIA_ROLES[manifest.settings.find((s) => s.id === openSetting)?.kind ?? ''] && (
    <div className="np-pop">
      {(() => {
        const kind = manifest.settings.find((s) => s.id === openSetting)!.kind
        const { role, media } = MEDIA_ROLES[kind]
        const options = nodes.filter(
          (n) => n.data.mediaType === media && n.data.status === 'ready' && n.data.src
        )
        const current = (nodeInputs[manifest.id] ?? {})[role]
        if (options.length === 0) {
          return <span className="np-pop-empty">no {media} on the canvas to use</span>
        }
        return options.map((n) => (
          <button
            key={n.id}
            className={`np-ref${current === n.data.src ? ' on' : ''}`}
            title={n.data.label}
            onClick={() =>
              setNodeInput(manifest.id, role, current === n.data.src ? undefined : n.data.src)
            }
          >
            {media === 'image' ? (
              // The 256px companion, never the 2K–4K original: this sheet mounts
              // one tile per canvas node, so full-size decodes multiply fast.
              <img src={n.data.thumbSrc ?? n.data.src} alt={n.data.label} />
            ) : (
              // Chromium's default preload is "auto" — that buffers every clip on
              // the canvas the moment the sheet opens. A poster is enough here.
              <video src={n.data.src} poster={n.data.thumbSrc} muted preload="none" />
            )}
          </button>
        ))
      })()}
    </div>
  )}

  {openSetting === 'voice' && (
    <div className="np-pop">
      <button className={`np-pill${voice === '' ? ' on' : ''}`} onClick={() => setVoice('')}>
        default
      </button>
      {voiceList.map((v) => (
        <button
          key={v.name}
          className={`np-pill${voice === v.name ? ' on' : ''}`}
          title={v.tags}
          onClick={() => setVoice(v.name)}
        >
          {v.name}
        </button>
      ))}
      {voiceList.length === 0 && (
        <span className="np-pop-empty">no voices — connect ElevenLabs to browse them</span>
      )}
    </div>
  )}

  {openSetting === 'dataset' && (
    <div className="np-pop">
      {canvasImages.length === 0 && (
        <span className="np-pop-empty">no images on the canvas to train on</span>
      )}
      {canvasImages.map((n) => (
        <button
          key={n.id}
          className={`np-ref${dataset.includes(n.data.src ?? '') ? ' on' : ''}`}
          title={n.data.label}
          onClick={() => toggleDatasetImage(manifest.id, n.data.src ?? '')}
        >
          <img src={n.data.src} alt={n.data.label} />
        </button>
      ))}
    </div>
  )}

  {trainError && <div className="np-local np-err">{trainError}</div>}

  {openSetting === 'refs' && (
    <div className="np-modal-overlay" onClick={() => setOpenSetting(null)}>
      {/* A real centered modal, not an inline reveal (Joseph, 2026-08-30).
          References come from disk OR the canvas — an uploaded image doesn't
          have to become a canvas node to inspire a generation. Uploads land
          in the asset store like any other media, so the same lyme-asset://
          src flows through referenceImagePaths to every provider's own
          reference shape (gemini typed refs, muapi single-image edit, fal
          pre-upload, comfyui img2img). */}
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-modal-head">
          <span>Reference images</span>
          <button className="np-modal-close" onClick={() => setOpenSetting(null)}>✕</button>
        </div>
        <div className="np-modal-hint">
          A reference inspires the next generation — its subject, style, or palette.
          {maxRefs === 1 && ' This model takes ONE reference; a new pick replaces it.'}
        </div>
        <button
          className="np-modal-upload"
          onClick={() => {
            void bridge.media.import('image').then((imported) => {
              if (imported?.src && imported.mediaType === 'image') {
                addRef(imported.src)
              }
            })
          }}
        >
          <Icon name="upload" /> Upload an image
        </button>
        {canvasImages.length > 0 && <div className="np-modal-lbl">or pick from the canvas</div>}
        <div className="np-modal-grid">
          {canvasImages.map((n) => {
        const src = n.data.src ?? ''
        const picked = refs.includes(src)
        return (
          <button
            key={n.id}
            className={`np-ref${picked ? ' on' : ''}`}
            title={n.data.label}
            onClick={() => (picked ? setRefs(refs.filter((r) => r !== src)) : addRef(src))}
          >
            <img src={n.data.src} alt={n.data.label} />
            {picked && model?.connectorId === 'gemini' && (
              <span
                className="np-ref-type"
                title="reference role — click to cycle object / character / style"
                onClick={(e) => {
                  e.stopPropagation()
                  cycleRefType(src)
                }}
              >
                {(refTypes[src] ?? 'object').slice(0, 3)}
              </span>
            )}
          </button>
        )
      })}
          {refs
            .filter((src) => !canvasImages.some((n) => n.data.src === src))
            .map((src) => (
          <button
            key={src}
            className="np-ref on"
            title="uploaded reference — click to remove"
            onClick={() => setRefs(refs.filter((r) => r !== src))}
          >
            <img src={src} alt="uploaded reference" />
            {model?.connectorId === 'gemini' && (
              <span
                className="np-ref-type"
                title="reference role — click to cycle object / character / style"
                onClick={(e) => {
                  e.stopPropagation()
                  cycleRefType(src)
                }}
              >
                {(refTypes[src] ?? 'object').slice(0, 3)}
              </span>
            )}
          </button>
        ))}
        </div>
      </div>
    </div>
  )}
    </>
  )
}
