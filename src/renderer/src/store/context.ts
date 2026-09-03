import type { StoreApi } from 'zustand'
import type {
  MediaNodeData,
  NodeStage,
  PersistedState,
  Session,
  StagedTake
} from '@shared/types'
import type { StudioStore } from './types'

/**
 * What every action slice needs from the store's closure.
 *
 * The slices used to live inside `create()` purely because they close over
 * `set`/`get` and a handful of internal helpers. Naming that dependency here
 * lets each group of actions live in its own file without changing behaviour:
 * the store builds one context and hands it to each factory.
 */
export interface StoreCtx {
  set: StoreApi<StudioStore>['setState']
  get: StoreApi<StudioStore>['getState']
  persist(): void
  updateSession(id: string, patch: Partial<Session>): void
  patchNodeData(nodeId: string, patch: Partial<MediaNodeData>): void
  patchNodeAnywhere(nodeId: string, patch: Partial<MediaNodeData>): void
  activeSession(): Session | null
  syncedSessions(): Session[]
  readStage(manifestId: string): NodeStage
  writeStage(manifestId: string, update: (stage: NodeStage) => NodeStage): void
  patchTake(manifestId: string, takeId: string, patch: Partial<StagedTake>): void
  placeTakeOnCanvas(take: StagedTake): string
  scheduleStubReady(nodeId: string): void
  rescueStrandedTakes(): void
  backfillThumbnails(): Promise<void>
  saveSessionAsProject(session: Session): void
  persistedSnapshot(): PersistedState
  uncommittedTakeCount(sessions: Session[]): number
}
