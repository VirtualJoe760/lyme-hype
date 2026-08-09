import { useState } from 'react'
import { useStudio } from '../store'

export function SessionsRail(): React.JSX.Element {
  const sessions = useStudio((s) => s.sessions)
  const activeSessionId = useStudio((s) => s.activeSessionId)
  const collapsed = useStudio((s) => s.railCollapsed)
  const toggle = useStudio((s) => s.toggleRail)
  const createSession = useStudio((s) => s.createSession)
  const selectSession = useStudio((s) => s.selectSession)
  const renameSession = useStudio((s) => s.renameSession)
  const deleteSession = useStudio((s) => s.deleteSession)
  const openSettings = useStudio((s) => s.openSettings)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startRename(id: string, current: string): void {
    setEditingId(id)
    setDraft(current)
  }

  function commitRename(): void {
    if (editingId) renameSession(editingId, draft)
    setEditingId(null)
  }

  const width = useStudio((s) => s.railWidth)

  return (
    <div
      className={`side-panel rail${collapsed ? ' collapsed' : ''}`}
      style={collapsed ? undefined : { width }}
    >
      <div className="panel-head">
        <span>Sessions</span>
        <div className="btns">
          {!collapsed && (
            <button className="panel-btn" title="New session" onClick={createSession}>
              +
            </button>
          )}
          <button
            className="panel-btn"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={toggle}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item${session.id === activeSessionId ? ' active' : ''}`}
            onClick={() => selectSession(session.id)}
            onDoubleClick={() => startRename(session.id, session.name)}
          >
            {editingId === session.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="name">{session.name}</span>
                <button
                  className="row-btn"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(session.id, session.name)
                  }}
                >
                  ✎
                </button>
                <button
                  className="row-btn delete"
                  title="Delete session"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Delete session "${session.name}"?`)) {
                      deleteSession(session.id)
                    }
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <button
        className="rail-settings"
        onClick={() => openSettings('connectors')}
        title="Settings — connectors & models"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {!collapsed && <span>Settings</span>}
      </button>
    </div>
  )
}
