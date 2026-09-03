import { readFileSync } from 'node:fs'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type {
  ChatRealtyArticleDraftInput,
  ChatRealtyCarouselSlideInput,
  ChatRealtyLandingPageDraftInput,
  CastRequest,
  CharacterSpec,
  CombineLocalKind,
  ConnectorDef,
  GenerationParams,
  ConversationTurnRequest,
  ModelProviderDef,
  PersistedState,
  SecretRequest,
  Session,
  TimelineExportSpec
} from '@shared/types'
import { BUILD_STAMP, sourceIsNewerThanBuild } from './build-info'
import { comfyState } from './comfyui-host'
import { setUncommittedCount } from './close-guard'
import { listGenerations } from './generation-log'
import { listProjects, readProject, saveProject } from './project-store'
import { workspaceRoot } from './workspace'
import {
  assetPathForUrl,
  ensureThumbForUrl,
  importFileAsset,
  importUrlAsset,
  mediaTypeForPath,
  saveImageAsset
} from './asset-store'
import { runAgentPrompt } from './agent'
import { runConversationTurn, runImproveShotPrompt, runShotBreakdown } from './conversations'
import { cloneVoice, composeMusic, previewVoice, searchVoices, soundEffects, textToSpeech } from './elevenlabs-tools'
import { listYapperVoices, synthesizeYapperSpeech } from './yapper-rest'
import { exportTimeline, resolveFfmpeg } from './ffmpeg'
import {
  deleteTrainedStyle,
  listTrainedStyles,
  setTrainedStylePersonaTone,
  setTrainedStyleVoice,
  trainStyle
} from './fal-training'
import { combineLocal, isolateAudio, keyAlpha } from './media-tools'
import { runGeneration } from './generation'
import { approveCharacter, castCharacter, reviewCharacter } from './character/character-engine'
import { deleteCharacter, listCharacters, saveCharacter } from './character/character-store'
import { listStyleViews } from './character/character-styles'
import { startOAuthConnect } from './mcp-oauth'
import { claudeAuthOverrideKind } from './claude-auth'
import {
  createArticleDraft,
  createCarouselSlide,
  createLandingPageDraft,
  createListingCover,
  hasChatRealtyToken,
  planListingCarousel,
  pullListingPhotos,
  stageListingWithAgent
} from './chatrealty'
import { deleteConnector, installedConnectorIds, listConnectors, saveConnector, testConnector } from './connectors-store'
import { addSuggestion, listSuggestions, openSuggestionKeyPage, reconcileInstalledConnectors } from './connector-suggestions'
import { deleteSecret, listSecretReports } from './credential-vault'
import {
  deleteModelProvider,
  listModelProviders,
  saveModelProvider,
  setActiveModelProvider
} from './model-providers'
import { registerSecureCredentialIpc, requestSecret } from './secure-credential'
import { loadState, saveState } from './sessions-store'

const FILE_FILTERS: Record<string, Electron.FileFilter[]> = {
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  video: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  audio: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
}

let handlersRegistered = false
// Rebindable so the macOS activate path (which creates a fresh window after the
// first one is closed) retargets every handler instead of leaving them closed
// over a destroyed window. Handlers still register exactly once — re-running
// ipcMain.handle for the same channel throws.
let mainWindow: BrowserWindow | null = null
/** session id → project folder already logged, so autosave stays quiet. */
const announcedProjects = new Map<string, string>()

function isMainSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  return (
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    event.sender.id === mainWindow.webContents.id
  )
}

export function registerIpc(window: BrowserWindow): void {
  mainWindow = window

  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.on(IPC.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(IPC.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(IPC.sessionsLoad, (e) => {
    // Logged permanently: persistence has failed twice now (a harness clobber,
    // then a load that came back empty), and "what did the main process actually
    // hand the renderer at boot" is the one fact that settles it either way.
    if (!isMainSender(e)) {
      console.error('[sessions] load REFUSED — sender is not the main window')
      return null
    }
    const state = loadState()
    console.log(
      `[sessions] load → ${state.sessions.length} session(s) from ${app.getPath('userData')}` +
        `${state.sessions.length ? `: ${state.sessions.map((s) => s.name).join(', ')}` : ' (empty/unreadable)'}`
    )
    return state
  })
  // Open sessions from a store/backup file on disk (a previous sessions.json, a
  // backup snapshot, later a Phase 23 project.json) — returns the sessions for
  // the renderer to import; nothing is written here.
  ipcMain.handle(IPC.sessionsOpenFile, async (e) => {
    if (!isMainSender(e)) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const picked = await dialog.showOpenDialog(win, {
      title: 'Open a session',
      // The workspace folder is where closed sessions live (Documents\Lyme Hype),
      // so the picker lands among the user's own projects rather than in the
      // app-data folder full of Electron internals.
      defaultPath: workspaceRoot(),
      filters: [{ name: 'Lyme Hype sessions', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    try {
      const parsed: unknown = JSON.parse(readFileSync(picked.filePaths[0], 'utf-8'))
      const asRecord = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
      const sessions = Array.isArray(parsed)
        ? parsed
        : // a project.json — one session, the Phase 23 shape
          asRecord?.['session']
          ? [asRecord['session']]
          : // a sessions.json / backup — many
            Array.isArray(asRecord?.['sessions'])
            ? (asRecord['sessions'] as unknown[])
            : null
      if (!sessions || sessions.length === 0) {
        return { sessions: null, error: 'No sessions found in that file.' }
      }
      return { sessions, error: null }
    } catch (error) {
      return { sessions: null, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Every finished generation, newest first — the recovery path for results
  // whose renderer died before they landed (and for MCP-driven generations,
  // which never had a canvas node to begin with).
  ipcMain.handle(IPC.generationsRecent, (e) => (isMainSender(e) ? listGenerations() : null))

  // Staged (uncommitted) take count, pushed by the renderer — read by the
  // close guard so quitting can't quietly strand paid renders.
  ipcMain.on(IPC.stagesCount, (e, count: number) => {
    if (isMainSender(e)) setUncommittedCount(count)
  })

  // Boot facts for the startup console: what the app can actually do on this
  // machine, checked rather than assumed.
  ipcMain.handle(IPC.systemStatus, (e) => {
    if (!isMainSender(e)) return null
    const ffmpeg = resolveFfmpeg()
    return {
      ffmpeg: ffmpeg ? `${ffmpeg.source}` : null,
      workspace: workspaceRoot(),
      connectors: listConnectors().length,
      projects: listProjects().length,
      build: BUILD_STAMP,
      stale: sourceIsNewerThanBuild()
    }
  })

  // The user's own projects, for the in-app picker — no filesystem hunting.
  ipcMain.handle(IPC.projectsList, (e) => (isMainSender(e) ? listProjects() : null))

  // Open one project folder → its session, tagged with the folder it came from
  // so a later close updates that same project.
  ipcMain.handle(IPC.projectOpen, (e, dir: string) => {
    if (!isMainSender(e)) return null
    const project = readProject(dir)
    if (!project) return { session: null, error: 'No readable project in that folder.' }
    return { session: { ...project.session, projectDir: dir }, error: null }
  })

  // Closing a session saves it to the workspace as a project folder
  // (Documents\Lyme Hype\<name>\project.json) so the file picker above can
  // bring it back later. Nothing is deleted; the rail just stops showing it.
  ipcMain.handle(IPC.sessionsCloseToProject, (e, session: Session) => {
    if (!isMainSender(e)) return null
    try {
      const dir = saveProject(session)
      // Sessions autosave to their project on every persist — announce a folder
      // once rather than narrating every keystroke.
      if (announcedProjects.get(session.id) !== dir) {
        announcedProjects.set(session.id, dir)
        console.log(`[projects] "${session.name}" → ${dir}`)
      }
      return { ok: true, dir, error: null }
    } catch (error) {
      return { ok: false, dir: null, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.sessionsSave, (e, state: PersistedState) => {
    if (!isMainSender(e)) return
    saveState(state)
  })
  // Synchronous companion for the beforeunload flush — the renderer is being
  // torn down, so it can't await an async save. sendSync blocks until saveState
  // (itself synchronous) returns.
  ipcMain.on(IPC.sessionsSaveSync, (e, state: PersistedState) => {
    if (isMainSender(e)) saveState(state)
    e.returnValue = true
  })

  ipcMain.handle(IPC.claudeStatus, (e) => (isMainSender(e) ? { override: claudeAuthOverrideKind() } : null))

  ipcMain.handle(IPC.agentPing, async (e, prompt: string) => {
    if (!isMainSender(e)) return null
    const target = mainWindow
    return runAgentPrompt(prompt, (event) => {
      if (target && !target.isDestroyed()) {
        target.webContents.send(IPC.agentStream, event)
      }
    })
  })

  ipcMain.handle(IPC.scriptingTurn, (e, request: ConversationTurnRequest) => {
    if (!isMainSender(e)) return null
    const target = mainWindow
    // Vision input arrives as lyme-asset:// URLs from the renderer (Motion
    // graphics references) — resolve to disk paths here.
    const resolved: ConversationTurnRequest = {
      ...request,
      imagePaths: request.imagePaths
        ?.map((p) => (p.startsWith('lyme-asset://') ? assetPathForUrl(p) : p))
        .filter((p): p is string => p !== null)
    }
    return runConversationTurn(resolved, (text) => {
      if (target && !target.isDestroyed()) {
        target.webContents.send(IPC.scriptingStream, { conversationId: request.conversationId, text })
      }
    })
  })

  ipcMain.handle(IPC.scriptingBreakdown, (e, request: Omit<ConversationTurnRequest, 'prompt'>) => {
    if (!isMainSender(e)) return null
    return runShotBreakdown(request)
  })

  ipcMain.handle(
    IPC.scriptingImprove,
    (e, input: { label: string; shotDescription: string; feeling: string }) => {
      if (!isMainSender(e)) return null
      return runImproveShotPrompt(input)
    }
  )

  ipcMain.handle(IPC.mediaPickFile, async (e, kind: string) => {
    if (!isMainSender(e) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    return { name, path: filePath }
  })

  ipcMain.handle(IPC.comfyStatus, (e) => (isMainSender(e) ? comfyState() : null))

  ipcMain.handle(IPC.mediaEnsureThumb, (e, assetUrl: string) => {
    if (!isMainSender(e)) return null
    return typeof assetUrl === 'string' ? ensureThumbForUrl(assetUrl) : null
  })

  ipcMain.handle(IPC.mediaImport, async (e, kind: string) => {
    if (!isMainSender(e) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop() ?? filePath
    const saved = importFileAsset(filePath)
    return { name, src: saved.url, mediaType: mediaTypeForPath(filePath) ?? kind }
  })

  ipcMain.handle(IPC.mediaImportUrl, async (e, url: string) => {
    if (!isMainSender(e)) return null
    try {
      const saved = await importUrlAsset(url)
      const tail = new URL(url).pathname.split('/').filter(Boolean).pop()
      return { name: tail || new URL(url).hostname, src: saved.url, error: null }
    } catch (err) {
      return { name: '', src: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Multi-file picker (voice-clone samples, LoRA training images). Returns
  // plain paths; nothing is imported until the flow actually uses them.
  ipcMain.handle(IPC.mediaPickFiles, async (e, kind: string) => {
    if (!isMainSender(e) || !mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: FILE_FILTERS[kind] ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle(IPC.mediaSaveDataUrl, (e, dataUrl: string) => {
    if (!isMainSender(e)) return null
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl)
    if (!match) return { ok: false, error: 'Not a base64 image data URL.' }
    const saved = saveImageAsset(match[2], match[1])
    return { ok: true, src: saved.url }
  })

  ipcMain.handle(
    IPC.mediaIsolateAudio,
    (e, source: { assetUrl?: string; filePath?: string; url?: string }) => {
      if (!isMainSender(e)) return null
      return isolateAudio(source)
    }
  )

  ipcMain.handle(
    IPC.mediaKeyAlpha,
    (e, input: { assetUrl: string; color?: string; similarity?: number; blend?: number }) => {
      if (!isMainSender(e)) return null
      return keyAlpha(input)
    }
  )

  ipcMain.handle(
    IPC.mediaCombineLocal,
    (e, input: { kind: CombineLocalKind; aUrl: string; bUrl: string }) => {
      if (!isMainSender(e)) return null
      return combineLocal(input)
    }
  )

  ipcMain.handle(IPC.audioVoices, (e, query: string) => {
    if (!isMainSender(e)) return null
    return searchVoices(typeof query === 'string' ? query : '')
  })
  ipcMain.handle(IPC.audioPreview, (e, voiceName: string) => {
    if (!isMainSender(e)) return null
    return previewVoice(typeof voiceName === 'string' ? voiceName : '')
  })
  ipcMain.handle(IPC.audioTts, (e, input: { text: string; voiceName?: string }) => {
    if (!isMainSender(e)) return null
    return textToSpeech(input)
  })
  ipcMain.handle(IPC.audioMusic, (e, input: { prompt: string; lengthMs?: number }) => {
    if (!isMainSender(e)) return null
    return composeMusic(input)
  })
  ipcMain.handle(IPC.audioSfx, (e, input: { prompt: string; durationSec?: number }) => {
    if (!isMainSender(e)) return null
    return soundEffects(input)
  })
  ipcMain.handle(IPC.audioClone, (e, input: { name: string; filePaths: string[] }) => {
    if (!isMainSender(e)) return null
    return cloneVoice(input)
  })
  ipcMain.handle(IPC.audioYapperTts, (e, input: { text: string; voiceId?: string }) => {
    if (!isMainSender(e)) return null
    return synthesizeYapperSpeech(input)
  })
  ipcMain.handle(IPC.audioYapperVoices, (e, input: { provider: 'cartesia' | 'elevenlabs'; search?: string }) => {
    if (!isMainSender(e)) return null
    return listYapperVoices(input)
  })

  ipcMain.handle(
    IPC.loraTrain,
    (
      e,
      input: {
        name: string
        imagePaths: string[]
        steps?: number
        triggerWord?: string
        trainer?: string
        kind?: 'style' | 'subject'
      }
    ) => {
      if (!isMainSender(e)) return null
      // Training images may be lyme-asset:// canvas node URLs (e.g. the
      // Deepfake screen's "train a LoRA from this photo" shortcut), not just
      // paths from the native file picker — resolve to disk paths here, same
      // as scriptingTurn's vision input above.
      return trainStyle({
        ...input,
        imagePaths: input.imagePaths
          .map((p) => (p.startsWith('lyme-asset://') ? assetPathForUrl(p) : p))
          .filter((p): p is string => p !== null)
      })
    }
  )
  ipcMain.handle(IPC.loraList, (e) => (isMainSender(e) ? listTrainedStyles() : []))
  ipcMain.handle(IPC.loraDelete, (e, id: string) => {
    if (!isMainSender(e)) return
    deleteTrainedStyle(id)
  })
  ipcMain.handle(IPC.loraSetVoice, (e, id: string, voiceName: string) => {
    if (!isMainSender(e)) return null
    return setTrainedStyleVoice(id, voiceName)
  })
  ipcMain.handle(IPC.loraSetTone, (e, id: string, personaTone: string) => {
    if (!isMainSender(e)) return null
    return setTrainedStylePersonaTone(id, personaTone)
  })

  ipcMain.handle(IPC.generateRun, (e, params: GenerationParams) => {
    if (!isMainSender(e)) return null
    return runGeneration(params)
  })

  // Generate Character: deterministic local ComfyUI graphs, no agent turn.
  // Progress lines stream to every window so the screen narrates the engine.
  const characterProgress = (p: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.characterStream, p)
  }
  ipcMain.handle(IPC.characterList, (e) => (isMainSender(e) ? listCharacters() : null))
  ipcMain.handle(IPC.characterStyles, (e) => (isMainSender(e) ? listStyleViews() : null))
  ipcMain.handle(
    IPC.characterSave,
    (e, input: { id?: string; spec: CharacterSpec; styleId: string; referencePhotos: string[] }) =>
      isMainSender(e) ? saveCharacter(input) : null
  )
  ipcMain.handle(IPC.characterDelete, (e, id: string) => {
    if (!isMainSender(e)) return null
    deleteCharacter(id)
    return true
  })
  ipcMain.handle(IPC.characterCast, (e, req: CastRequest) => (isMainSender(e) ? castCharacter(req, characterProgress) : null))
  ipcMain.handle(IPC.characterReview, (e, id: string, rescore?: boolean) =>
    isMainSender(e) ? reviewCharacter(id, characterProgress, !!rescore) : null
  )
  ipcMain.handle(IPC.characterApprove, (e, id: string, src: string) => (isMainSender(e) ? approveCharacter(id, src) : null))

  ipcMain.handle(IPC.cutRoomExport, async (e, spec: TimelineExportSpec) => {
    if (!isMainSender(e) || !mainWindow) return null
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Export timeline',
      defaultPath: 'lyme-cut.mp4',
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    return exportTimeline(spec, picked.filePath)
  })

  ipcMain.handle(IPC.chatRealtyStatus, (e) => (isMainSender(e) ? { connected: hasChatRealtyToken() } : null))
  ipcMain.handle(IPC.chatRealtyPull, (e, query: string) => {
    if (!isMainSender(e)) return null
    return pullListingPhotos(typeof query === 'string' ? query : '')
  })
  ipcMain.handle(
    IPC.chatRealtyCover,
    (
      e,
      listingKey: string,
      opts: { hook: string; body: string; city?: string; accentColor?: string; photoIndex?: number }
    ) => {
      if (!isMainSender(e)) return null
      return createListingCover(listingKey, opts)
    }
  )
  ipcMain.handle(IPC.chatRealtyListingContext, (e, listingKey: string) => {
    if (!isMainSender(e)) return null
    return planListingCarousel(typeof listingKey === 'string' ? listingKey : '')
  })
  ipcMain.handle(IPC.chatRealtyCarouselSlide, (e, input: ChatRealtyCarouselSlideInput) => {
    if (!isMainSender(e)) return null
    return createCarouselSlide(input)
  })
  ipcMain.handle(IPC.chatRealtyStage, (e, listingKey: string, photoIndexes: number[]) => {
    if (!isMainSender(e)) return null
    return stageListingWithAgent(
      typeof listingKey === 'string' ? listingKey : '',
      Array.isArray(photoIndexes) ? photoIndexes.filter((n) => Number.isInteger(n)) : []
    )
  })
  ipcMain.handle(IPC.chatRealtyArticleDraft, (e, input: ChatRealtyArticleDraftInput) => {
    if (!isMainSender(e)) return null
    return createArticleDraft(input)
  })
  ipcMain.handle(IPC.chatRealtyLandingPageDraft, (e, input: ChatRealtyLandingPageDraftInput) => {
    if (!isMainSender(e)) return null
    return createLandingPageDraft(input)
  })

  ipcMain.handle(IPC.connectorsList, (e) => {
    if (!isMainSender(e)) return []
    // Heal any credential-without-def split before answering (see the
    // reconcile function's comment for how that state arises).
    reconcileInstalledConnectors()
    return listConnectors()
  })
  ipcMain.handle(IPC.connectorsSave, (e, def: ConnectorDef) => {
    if (!isMainSender(e)) return
    saveConnector(def)
  })
  ipcMain.handle(IPC.connectorsDelete, (e, id: string) => {
    if (!isMainSender(e)) return
    deleteConnector(id)
  })
  ipcMain.handle(IPC.connectorsTest, (e, id: string) => {
    if (!isMainSender(e)) return null
    return testConnector(id)
  })
  ipcMain.handle(IPC.connectorsSuggestions, (e) =>
    isMainSender(e) ? listSuggestions(installedConnectorIds()) : []
  )
  ipcMain.handle(IPC.connectorsAddSuggestion, (e, id: string) => {
    if (!isMainSender(e)) return null
    return addSuggestion(id)
  })
  ipcMain.handle(IPC.connectorsOpenKeyPage, (e, id: string) => {
    if (!isMainSender(e)) return
    openSuggestionKeyPage(id)
  })
  ipcMain.handle(IPC.connectorsOauthConnect, async (e, id: string) => {
    if (!isMainSender(e)) return null
    const def = listConnectors().find((c) => c.id === id)
    if (!def || def.authType !== 'oauth' || !def.url) {
      return { ok: false, error: 'Not an OAuth http connector.' }
    }
    try {
      await startOAuthConnect(def.id, def.url)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.modelProvidersList, (e) => (isMainSender(e) ? listModelProviders() : []))
  ipcMain.handle(IPC.modelProvidersSave, (e, def: ModelProviderDef) => {
    if (!isMainSender(e)) return
    saveModelProvider(def)
  })
  ipcMain.handle(IPC.modelProvidersDelete, (e, id: string) => {
    if (!isMainSender(e)) return
    deleteModelProvider(id)
  })
  ipcMain.handle(IPC.modelProvidersSetActive, (e, id: string) => {
    if (!isMainSender(e)) return
    setActiveModelProvider(id)
  })

  ipcMain.handle(IPC.secretRequest, (e, request: SecretRequest) => {
    if (!isMainSender(e) || !mainWindow) return null
    return requestSecret(mainWindow, request)
  })
  ipcMain.handle(IPC.secretList, (e) => (isMainSender(e) ? listSecretReports() : []))
  ipcMain.handle(IPC.secretDelete, (e, connectorId: string) => {
    if (!isMainSender(e)) return
    deleteSecret(connectorId)
  })

  registerSecureCredentialIpc()
}
