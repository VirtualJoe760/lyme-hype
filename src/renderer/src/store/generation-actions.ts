/** Node screens, staged takes, and every path that produces media.
 *
 * A slice of the studio store: the same actions as before, lifted out of the
 * create() body so no single file carries the whole surface. */

import type {
  StagedTake,
} from '@shared/types'
import { bridge } from '../bridge'
import type { StoreCtx } from './context'
import { nextId, type MediaFlowNode, type StudioStore } from './types'
import {
  pickSwatch,
  probeDuration,
} from './helpers'

export function createGenerationActions(ctx: StoreCtx): Pick<StudioStore, 'nodeStage' | 'setNodeTool' | 'setNodeModel' | 'selectTake' | 'clearStage' | 'stageGenerate' | 'clearPendingNodeScreen' | 'setNodeInput' | 'toggleDatasetImage' | 'clearDataset' | 'stageAudio' | 'trainLora' | 'applyHandoff' | 'openNodeScreenWith' | 'clearPendingRefs' | 'commitStage' | 'generateMedia' | 'focusNode' | 'clearFocusNode'> {
  const {
    set,
    get,
    persist,
    updateSession,
    patchNodeAnywhere,
    activeSession,
    readStage,
    writeStage,
    patchTake,
    placeTakeOnCanvas,
  } = ctx

  return {
  nodeStage(manifestId) {
    return readStage(manifestId)
  },

  setNodeTool(manifestId, toolId) {
    writeStage(manifestId, (stage) => ({ ...stage, toolId }))
  },

  setNodeModel(manifestId, modelId) {
    writeStage(manifestId, (stage) => ({ ...stage, modelId }))
  },

  selectTake(manifestId, index) {
    writeStage(manifestId, (stage) => ({
      ...stage,
      activeIndex: Math.max(0, Math.min(index, stage.takes.length - 1))
    }))
  },

  clearStage(manifestId) {
    writeStage(manifestId, () => ({ takes: [], activeIndex: 0, toolId: readStage(manifestId).toolId }))
  },

  stageGenerate(manifestId, input) {
    const count = Math.max(1, input.takes ?? 1)
    const fresh: StagedTake[] = Array.from({ length: count }, (_, i) => ({
      id: nextId('take'),
      mediaType: input.mediaType,
      status: 'rendering' as const,
      label: count > 1 ? `${input.label} ${i + 1}` : input.label,
      prompt: input.prompt,
      modelId: input.modelId,
      createdAt: Date.now()
    }))

    writeStage(manifestId, (stage) => ({
      ...stage,
      takes: [...stage.takes, ...fresh],
      activeIndex: stage.takes.length
    }))

    for (const take of fresh) {
      void (async () => {
        let result: Awaited<ReturnType<typeof bridge.generate.run>> = null
        try {
          result = await bridge.generate.run({
            mediaType: input.mediaType,
            prompt: input.prompt,
            skipRefine: input.skipRefine,
            aspectRatio: input.aspectRatio,
            durationSec: input.durationSec,
            resolution: input.resolution,
            connectorId: input.connectorId,
            connectorIds: input.connectorIds,
            modelHint: input.modelHint,
            model: input.model,
            imageSize: input.imageSize,
            thinkingLevel: input.thinkingLevel,
            personGeneration: input.personGeneration,
            steps: input.steps,
            refStrength: input.refStrength,
            referenceImagePaths: input.referenceImagePaths,
            characterReferencePaths: input.characterReferencePaths,
            styleReferencePaths: input.styleReferencePaths,
            startFramePath: input.startFramePath,
            endFramePath: input.endFramePath,
            referenceAudioPaths: input.referenceAudioPaths,
            sourceMediaPath: input.sourceMediaPath,
            maskDataUrl: input.maskDataUrl,
            extendVideoPath: input.extendVideoPath,
            extendVideoDurationSec: input.extendVideoDurationSec
          })
        } catch (error) {
          result = {
            ok: false,
            mediaType: input.mediaType,
            error: error instanceof Error ? error.message : String(error)
          }
        }

        if (result?.ok && result.src) {
          const nodeId = placeTakeOnCanvas({
            ...take,
            status: 'ready',
            src: result.src,
            thumbSrc: result.thumbSrc
          })
          patchTake(manifestId, take.id, {
            status: 'ready',
            src: result.src,
            thumbSrc: result.thumbSrc,
            // The prompt the model actually saw — refined, translated, or as typed.
            prompt: result.promptUsed ?? take.prompt,
            nodeId,
            error: undefined
          })
          // Attempts the verifier rejected stay in the carousel with the reason.
          // A safeguard you cannot see working is one you cannot trust.
          if (result.rejected?.length) {
            const discarded = result.rejected
            writeStage(manifestId, (stage) => ({
              ...stage,
              takes: [
                ...stage.takes,
                ...discarded.map((r, i) => ({
                  id: nextId('take'),
                  mediaType: take.mediaType,
                  status: 'error' as const,
                  label: `${take.label} · rejected ${i + 1}`,
                  prompt: take.prompt,
                  modelId: take.modelId,
                  createdAt: Date.now(),
                  src: r.src,
                  thumbSrc: r.thumbSrc,
                  error: `Rejected by verify: ${r.reason}`
                }))
              ]
            }))
          }
        } else {
          patchTake(manifestId, take.id, {
            status: 'error',
            error: result?.error ?? 'Generation failed.'
          })
        }
      })()
    }
  },

  clearPendingNodeScreen() {
    set({ pendingNodeScreen: null })
  },

  setNodeInput(manifestId, role, src) {
    const all = get().nodeInputs
    const forNode = { ...(all[manifestId] ?? {}) }
    if (src) forNode[role] = src
    else delete forNode[role]
    set({ nodeInputs: { ...all, [manifestId]: forNode } })
  },

  toggleDatasetImage(manifestId, src) {
    const all = get().nodeDataset
    const current = all[manifestId] ?? []
    const next = current.includes(src) ? current.filter((s) => s !== src) : [...current, src]
    set({ nodeDataset: { ...all, [manifestId]: next } })
  },

  clearDataset(manifestId) {
    set({ nodeDataset: { ...get().nodeDataset, [manifestId]: [] } })
  },

  stageAudio(manifestId, op, input) {
    const take: StagedTake = {
      id: nextId('take'),
      mediaType: 'audio',
      status: 'rendering',
      label: `${op}_${Date.now().toString().slice(-4)}`,
      prompt: input.text,
      createdAt: Date.now()
    }
    writeStage(manifestId, (stage) => ({
      ...stage,
      takes: [...stage.takes, take],
      activeIndex: stage.takes.length
    }))

    void (async () => {
      let result: Awaited<ReturnType<typeof bridge.audioTools.tts>> = null
      try {
        if (op === 'tts') {
          result = input.useYapper
            ? await bridge.audioTools.yapperTts({ text: input.text, voiceId: input.voiceId })
            : await bridge.audioTools.tts({ text: input.text, voiceName: input.voiceName })
        } else if (op === 'music') {
          result = await bridge.audioTools.music({ prompt: input.text })
        } else if (op === 'sfx') {
          result = await bridge.audioTools.sfx({ prompt: input.text })
        } else {
          result = await bridge.audioTools.clone({ name: input.text, filePaths: [] })
        }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (result?.ok && result.src) {
        const nodeId = placeTakeOnCanvas({ ...take, status: 'ready', src: result.src })
        patchTake(manifestId, take.id, { status: 'ready', src: result.src, nodeId, error: undefined })
      } else {
        patchTake(manifestId, take.id, {
          status: 'error',
          error: result?.error ?? 'Audio tool failed.'
        })
      }
    })()
  },

  async trainLora(input) {
    const result = await bridge.lora.train({
      name: input.name,
      imagePaths: input.imagePaths,
      steps: input.steps,
      kind: input.kind,
      trainer: input.trainer,
      triggerWord: input.name
    })
    if (!result?.ok) return { ok: false, error: result?.error ?? 'Training failed.' }
    return { ok: true }
  },

  applyHandoff(fromManifestId, to, role) {
    const stage = readStage(fromManifestId)
    const take = stage.takes[stage.activeIndex]
    if (!take || take.status !== 'ready' || !take.src) return
    const src = take.src
    // Commit first: the artifact has to exist as a node to be an input to anything.
    get().commitStage(fromManifestId)
    get().setNodeInput(to, role, src)
    set({ pendingNodeScreen: to })
  },

  openNodeScreenWith(manifestId, input) {
    // Arriving with new input means the old failure is history — an error take
    // is a status message about a call that already happened, not an artifact.
    // Without this, clicking "→ video" on a node showed the PREVIOUS run's
    // connector error as if the click had caused it (observed 2026-08-31).
    // Ready takes are real work and stay.
    writeStage(manifestId, (stage) => {
      const takes = stage.takes.filter((t) => t.status !== 'error')
      if (takes.length === stage.takes.length) return stage
      return {
        ...stage,
        takes,
        activeIndex: Math.max(0, Math.min(stage.activeIndex, takes.length - 1))
      }
    })

    if (input.role === 'refs') {
      set({ pendingRefs: { manifestId, src: input.src } })
    } else if (input.role === 'take') {
      writeStage(manifestId, (stage) => ({
        ...stage,
        toolId: input.toolId ?? stage.toolId,
        takes: [
          ...stage.takes,
          {
            id: nextId('take'),
            mediaType: input.mediaType,
            status: 'ready' as const,
            label: input.label,
            prompt: '',
            src: input.src,
            createdAt: Date.now()
          }
        ],
        activeIndex: stage.takes.length
      }))
    } else {
      get().setNodeInput(manifestId, input.role, input.src)
    }
    set({ pendingNodeScreen: manifestId })
  },

  clearPendingRefs() {
    set({ pendingRefs: null })
  },

  commitStage(manifestId) {
    const stage = readStage(manifestId)
    const take = stage.takes[stage.activeIndex]
    if (!take || take.status !== 'ready' || !take.src) return null
    // Takes now land on the canvas the moment they finish, so this is usually
    // a no-op that just clears staging — never a second copy of the same take.
    const id = take.nodeId ?? placeTakeOnCanvas(take)
    writeStage(manifestId, (s) => ({ ...s, takes: [], activeIndex: 0 }))
    persist()
    return id
  },

  generateMedia(input) {
    const id = input.nodeId ?? nextId('node')
    // A fresh Generate creates the rendering node; a promote reuses the panel
    // node (already flipped to rendering) — only create when it's new.
    if (!input.nodeId) {
      const node: MediaFlowNode = {
        id,
        type: 'media',
        position: input.position ?? {
          x: 80 + Math.random() * 300,
          y: 80 + Math.random() * 220
        },
        data: {
          label: input.label,
          mediaType: input.mediaType,
          source: 'generate',
          status: 'rendering',
          swatch: pickSwatch(),
          motionGfx: input.motionGfx
        }
      }
      set({ nodes: [...get().nodes, node] })
      persist()
    }

    // The id returns immediately; the generation itself runs on, patching
    // the node wherever it lives when the result lands.
    void (async () => {
      let result: Awaited<ReturnType<typeof bridge.generate.run>> = null
      try {
        result = await bridge.generate.run({
          mediaType: input.mediaType,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          durationSec: input.durationSec,
          resolution: input.resolution,
          connectorId: input.connectorId,
          connectorIds: input.connectorIds,
          modelHint: input.modelHint,
          referenceImagePaths: input.referenceImagePaths,
          startFramePath: input.startFramePath,
          endFramePath: input.endFramePath,
          referenceAudioPaths: input.referenceAudioPaths,
          sourceMediaPath: input.sourceMediaPath,
          extendVideoPath: input.extendVideoPath,
          extendVideoDurationSec: input.extendVideoDurationSec
        })
      } catch (error) {
        result = {
          ok: false,
          mediaType: input.mediaType,
          error: error instanceof Error ? error.message : String(error)
        }
      }

      if (result?.ok && result.src) {
        // Real measured length, not the requested one — Veo's 148s chained-
        // extension cap needs the actual total, and extension calls don't
        // report duration at all (only the fixed +7s/8s intent).
        const videoDurationSec =
          input.mediaType === 'video' ? await probeDuration(result.src, 'video') : undefined
        patchNodeAnywhere(id, {
          src: result.src,
          thumbSrc: result.thumbSrc,
          status: 'ready',
          error: undefined,
          genNote: result.note,
          ...(videoDurationSec ? { videoDurationSec } : {})
        })
      } else {
        patchNodeAnywhere(id, {
          status: 'error',
          error: result?.error ?? 'Generation failed.'
        })
      }
    })()
    return id
  },


  focusNode(nodeId) {
    const session = activeSession()
    if (session && session.view !== 'canvas') updateSession(session.id, { view: 'canvas' })
    set({ focusNodeId: nodeId })
  },

  clearFocusNode() {
    set({ focusNodeId: null })
  },

  }
}
