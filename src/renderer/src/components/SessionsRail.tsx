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
  const setConnectionsOpen = useStudio((s) => s.setConnectionsOpen)

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

  return (
    <div className={`side-panel rail${collapsed ? ' collapsed' : ''}`}>
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
        <div className="rail-divider" />
        <div
          className="session-item rail-util"
          onClick={() => setConnectionsOpen(true)}
          title="Connections and credentials"
        >
          <span className="name">Connections</span>
        </div>
      </div>
    </div>
  )
}
