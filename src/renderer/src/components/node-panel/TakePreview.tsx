/** The node panel's preview: the active take (or the dataset grid), its status,
 *  and the takes carousel underneath. */

import type { NodeManifest } from '@shared/node-manifest'
import type { NodeStage, StagedTake } from '@shared/types'

export interface PreviewProps {
  manifest: NodeManifest
  activeTake: StagedTake | undefined
  stage: NodeStage
  dataset: string[]
  toggleDatasetImage(manifestId: string, src: string): void
  selectTake(manifestId: string, index: number): void
  setLightbox(open: boolean): void
}

export function TakePreview({
  manifest,
  activeTake,
  stage,
  dataset,
  toggleDatasetImage,
  selectTake,
  setLightbox
}: PreviewProps): React.JSX.Element {
  // Derived here rather than passed in: as a local const TypeScript narrows
  // `activeTake` through it, which a boolean prop cannot do.
  const hasArtifact = !!activeTake && activeTake.status === 'ready'

  return (
  <div
    className={`np-preview${hasArtifact ? ' filled' : ''}`}
    style={{ aspectRatio: manifest.previewAspect }}
  >
    {activeTake?.status === 'rendering' && <span className="np-spin" />}
    {activeTake?.status === 'error' && (
      <span className="np-empty np-err">{activeTake.error}</span>
    )}
    {manifest.previewHolds === 'dataset' && (
      <span className="np-grid">
        {dataset.map((src) => (
          <button key={src} className="np-cell on" onClick={() => toggleDatasetImage(manifest.id, src)}>
            <img src={src} alt="" />
          </button>
        ))}
        {dataset.length === 0 && (
          <span className="np-empty">
            no images yet
            <br />
            use “add images”
          </span>
        )}
      </span>
    )}
    {manifest.previewHolds === 'artifact' && !activeTake && (
      <span className="np-empty">
        nothing yet
        <br />
        describe it below
      </span>
    )}
    {hasArtifact && activeTake.src && manifest.media === 'image' && (
      <img
        className="np-art"
        src={activeTake.src}
        alt={activeTake.label}
        title="click to enlarge"
        onClick={() => setLightbox(true)}
      />
    )}
    {hasArtifact && activeTake.src && manifest.media === 'video' && (
      <video className="np-art" src={activeTake.src} muted playsInline />
    )}
    {hasArtifact && activeTake.src && manifest.media === 'audio' && (
      <span className="np-empty">{activeTake.label}</span>
    )}
    {hasArtifact && (
      <>
        {/* Carousel paging: arrows always present, greyed with one take,
            wrap-around with more (the store clamps, so wrap is computed here). */}
        <button
          className="np-car prev"
          disabled={stage.takes.length <= 1}
          title="previous take"
          onClick={() =>
            selectTake(manifest.id, (stage.activeIndex - 1 + stage.takes.length) % stage.takes.length)
          }
        >
          ‹
        </button>
        <button
          className="np-car next"
          disabled={stage.takes.length <= 1}
          title="next take"
          onClick={() => selectTake(manifest.id, (stage.activeIndex + 1) % stage.takes.length)}
        >
          ›
        </button>
        <span className="np-nav">
          take {stage.activeIndex + 1} / {stage.takes.length}
          {activeTake?.nodeId ? ' · on canvas' : ''}
        </span>
      </>
    )}
  </div>
  )
}
