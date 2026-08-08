export type MediaType = 'image' | 'video' | 'audio'
export type SourceMethod = 'generate' | 'upload' | 'link'
export type NodeStatus = 'rendering' | 'ready'
export type StudioView = 'canvas' | 'storyboard'

export interface MediaNodeData {
  label: string
  mediaType: MediaType
  source: SourceMethod
  status: NodeStatus
  /** Placeholder-thumbnail swatch index (1-6) until real media lands in Phase 4. */
  swatch: number
  /** Motion-graphics flavored video nodes keep a tag so the aside's tab choice isn't lost. */
  motionGfx?: boolean
  sentToTimeline?: boolean
  /** Set for upload nodes; real media pipeline lands in Phase 4. */
  filePath?: string
  /** Set for link nodes; download/transcode lands in Phase 4. */
  sourceUrl?: string
  [key: string]: unknown
}

export interface CanvasNodeState {
  id: string
  position: { x: number; y: number }
  data: MediaNodeData
}

export interface CutClip {
  id: string
  nodeId: string
  label: string
  mediaType: MediaType
  swatch: number
}

export interface Session {
  id: string
  name: string
  createdAt: string
  nodes: CanvasNodeState[]
  cutRoom: CutClip[]
  view: StudioView
}

export interface PersistedState {
  sessions: Session[]
  activeSessionId: string | null
}

export interface AgentStreamEvent {
  kind: 'text' | 'status'
  text: string
}

export interface AgentPingResult {
  ok: boolean
  text: string
  costUsd: number | null
  durationMs: number
  error?: string
}

/** The only credential facts the agent or renderer ever sees — never the value. */
export interface SecretReport {
  connectorId: string
  fieldLabel: string
  length: number
  last4: string
  savedAt: string
}

export interface SecretRequest {
  connectorId: string
  connectorName: string
  fieldLabel: string
}
