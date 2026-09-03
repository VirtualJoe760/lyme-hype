/** The Scripting panel's conversation shapes, shared with the Motion graphics wizard. */

/** One message in a session's Scripting conversation (docs/ui/scripting-panel.md). */
export interface ScriptingMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
}

/** Persisted on Session — plain JSON through the same persist path as nodes. */
export interface ScriptingState {
  messages: ScriptingMessage[]
  /** SDK session id so each turn resumes the same conversation server-side.
   *  If resuming ever fails, the turn falls back to replaying `messages`. */
  agentSessionId?: string
  totalCostUsd: number
}

/** A multi-turn conversation turn (Scripting panel, Motion graphics wizard). */
export interface ConversationTurnRequest {
  /** Attribution id for stream events — the renderer's conversation key. */
  conversationId: string
  resumeSessionId?: string
  prompt: string
  /** Absolute paths of images attached as vision input. */
  imagePaths?: string[]
  /** Replay transcript used when there's no resumable SDK session. */
  history?: { role: 'user' | 'assistant'; text: string }[]
  systemPrompt?: string
  /** Main-side only: pin a specific model for utility turns (prompt refinement,
   *  vision QA) that do not need the provider's default flagship. Ignored by
   *  anthropic-compatible providers, which run whatever model they are configured for. */
  model?: string
}

export interface ConversationTurnResult {
  ok: boolean
  text: string
  agentSessionId?: string
  costUsd: number | null
  error?: string
}

export interface ConversationStreamEvent {
  conversationId: string
  text: string
}

export interface ShotBreakdownResult {
  ok: boolean
  shots: { label: string; description: string }[]
  agentSessionId?: string
  costUsd: number | null
  error?: string
}

export interface ImprovePromptResult {
  ok: boolean
  prompt: string
  costUsd: number | null
  error?: string
}
