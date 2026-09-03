import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'

export function SessionsRail(): React.JSX.Element {
  const sessions = useStudio((s) => s.sessions)
  const activeSessionId = useStudio((s) => s.activeSessionId)
  const collapsed = useStudio((s) => s.railCollapsed)
  const toggle = useStudio((s) => s.toggleRail)
  const createSession = useStudio((s) => s.createSession)
  const importSessions = useStudio((s) => s.importSessions)
  const closeSession = useStudio((s) => s.closeSession)
  const openProject = useStudio((s) => s.openProject)
  const [browsing, setBrowsing] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)

  useEffect(() => {
    if (!browsing) return
    setProjects(null)
    void bridge.sessions.listProjects().then((p) => setProjects(p ?? []))
  }, [browsing])
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
          {!collapsed && (
            <button
              className="panel-btn"
              title="Open a previous session"
              onClick={() => setBrowsing(true)}
            >
              ↺
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
                  className="row-btn"
                  title="Close session — saves it to your workspace folder so you can reopen it with ↺"
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeSession(session.id).then((err) => {
                      if (err) window.alert(`Could not close the session: ${err}`)
                    })
                  }}
                >
                  ⤓
                </button>
                <button
                  className="row-btn delete"
                  title="Delete session (permanent)"
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
      {browsing && (
        <div className="np-modal-overlay" onClick={() => setBrowsing(false)}>
          <div className="np-modal" onClick={(e) => e.stopPropagation()}>
            <div className="np-modal-head">
              <span>Open a project</span>
              <button className="np-modal-close" onClick={() => setBrowsing(false)}>
                ✕
              </button>
            </div>
            {projects === null && <div className="np-modal-hint">Reading your workspace…</div>}
            {projects?.length === 0 && (
              <div className="np-modal-hint">
                No saved projects yet. Closing a session with ⤓ saves it here.
              </div>
            )}
            {projects?.map((p) => (
              <button
                key={p.dir}
                className="recover-item"
                title={p.dir}
                onClick={() => {
                  setBrowsing(false)
                  void openProject(p.dir).then((err) => {
                    if (err) window.alert(err)
                  })
                }}
              >
                <span className="recover-meta">
                  <b>{p.name}</b>
                  <em>
                    {new Date(p.savedAt).toLocaleString()} · {p.nodeCount} node
                    {p.nodeCount === 1 ? '' : 's'}
                    {p.assetCount > 0
                      ? ` · ${p.assetCount} asset${p.assetCount === 1 ? '' : 's'} (${Math.round(p.assetBytes / 1048576)} MB)`
                      : ''}
                  </em>
                </span>
              </button>
            ))}
            <button
              className="np-chip"
              onClick={() => {
                setBrowsing(false)
                void bridge.sessions.openFile().then((r) => {
                  if (!r) return // cancelled
                  if (r.error || !r.sessions) {
                    window.alert(r.error ?? 'Could not read that file.')
                    return
                  }
                  if (importSessions(r.sessions) === 0) {
                    window.alert('No usable sessions in that file.')
                  }
                })
              }}
            >
              Open from a file instead…
            </button>
          </div>
        </div>
      )}

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
