import { useCallback, useEffect, useState } from 'react'
import type {
  ConnectorAuthType,
  ConnectorKind,
  ConnectorSuggestion,
  ConnectorView
} from '@shared/types'
import { bridge } from '../../bridge'

interface DraftConnector {
  name: string
  kind: ConnectorKind
  command: string
  args: string
  url: string
  env: string
  authType: ConnectorAuthType
  secretKey: string
  secretFieldLabel: string
}

const EMPTY_DRAFT: DraftConnector = {
  name: '',
  kind: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  authType: 'apiKey',
  secretKey: '',
  secretFieldLabel: 'API key'
}

function slugId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base ? `${base}-${Date.now().toString(36).slice(-4)}` : `connector-${Date.now().toString(36)}`
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Brand-ish gradient per suggested tool for its tile thumbnail. */
const TILE_GRADIENT: Record<string, string> = {
  chatrealty: 'linear-gradient(135deg, #2b3a67, #5b8dd6)',
  muapi: 'linear-gradient(135deg, #46237a, #a06cd5)',
  elevenlabs: 'linear-gradient(135deg, #1a1a1a, #4a4a4a)',
  krea: 'linear-gradient(135deg, #703c1f, #e2543a)',
  fal: 'linear-gradient(135deg, #6b2d5c, #d05f8a)',
  gemini: 'linear-gradient(135deg, #1f4d6b, #4a90d9)',
  yapper: 'linear-gradient(135deg, #1f4d3d, #4aa87d)'
}

function tileMark(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 2).toUpperCase()
}

export function ConnectorsTab(): React.JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorView[]>([])
  const [suggestions, setSuggestions] = useState<ConnectorSuggestion[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<DraftConnector>(EMPTY_DRAFT)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setConnectors(await bridge.connectors.list())
    setSuggestions(await bridge.connectors.suggestions())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function addSuggestion(s: ConnectorSuggestion): Promise<void> {
    const def = await bridge.connectors.addSuggestion(s.id)
    if (def && def.authType !== 'none') {
      await bridge.secrets.request({
        connectorId: def.id,
        connectorName: def.name,
        fieldLabel: def.secretFieldLabel
      })
    }
    await refresh()
  }

  async function setCredential(view: ConnectorView): Promise<void> {
    const report = await bridge.secrets.request({
      connectorId: view.id,
      connectorName: view.name,
      fieldLabel: view.secretFieldLabel
    })
    if (report) await refresh()
  }

  async function runTest(id: string): Promise<void> {
    setBusyId(id)
    setTestResult((r) => ({ ...r, [id]: 'Testing…' }))
    try {
      const result = await bridge.connectors.test(id)
      if (result?.ok) {
        const bits = [`${result.serverName ?? 'server'}@${result.serverVersion ?? '?'}`, `${result.toolCount ?? 0} tools`]
        setTestResult((r) => ({ ...r, [id]: `✓ ${bits.join(' · ')}${result.note ? ` — ${result.note}` : ''}` }))
      } else {
        setTestResult((r) => ({ ...r, [id]: `✕ ${result?.error ?? 'Failed'}` }))
      }
    } finally {
      setBusyId(null)
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft.name.trim()) return
    const id = slugId(draft.name)
    await bridge.connectors.save({
      id,
      name: draft.name.trim(),
      kind: draft.kind,
      command: draft.kind === 'stdio' ? draft.command.trim() : undefined,
      args: draft.kind === 'stdio' ? draft.args.split(/\s+/).filter(Boolean) : undefined,
      url: draft.kind === 'http' ? draft.url.trim() : undefined,
      env: parseEnv(draft.env),
      authType: draft.authType,
      secretKey: draft.authType !== 'none' ? draft.secretKey.trim() || undefined : undefined,
      secretFieldLabel: draft.secretFieldLabel.trim() || 'API key'
    })
    await refresh()
    if (draft.authType !== 'none') {
      await bridge.secrets.request({
        connectorId: id,
        connectorName: draft.name.trim(),
        fieldLabel: draft.secretFieldLabel.trim() || 'API key'
      })
      await refresh()
    }
    setDraft(EMPTY_DRAFT)
    setAdding(false)
  }

  return (
    <div className="settings-section">
      <p className="settings-intro">
        Generation and data tools attach as MCP connections — a generic model, not a fixed list.
        Credentials are typed only into the native secure modal and stored with OS encryption
        (DPAPI); this window and the agent only ever see field name, length, and last 4.
      </p>
      {!bridge.isElectron && (
        <p className="settings-intro">
          Connections run in the Electron app — this browser preview can only show the layout.
        </p>
      )}

      <div className="sheet-section-label">Installed</div>
      {connectors.length === 0 && (
        <p className="settings-intro" style={{ marginTop: 0 }}>
          Nothing added yet. Add one from Suggested below, or build a custom connector.
        </p>
      )}
      <div className="settings-grid">
        {connectors.map((c) => (
          <div key={c.id} className="settings-card">
            <div className="settings-card-head">
              <div className="info">
                <div className="name">
                  {c.name}
                  {c.builtin && <span className="conn-tag">template</span>}
                </div>
                <div className="meta">
                  {c.kind} · {c.authType} · {c.hasCredential ? 'credential set' : 'no credential'}
                </div>
              </div>
              {!c.builtin && (
                <button
                  className="del"
                  title="Remove connector"
                  onClick={() => {
                    if (window.confirm(`Remove connector "${c.name}"?`)) {
                      void bridge.connectors.delete(c.id).then(refresh)
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="conn-actions">
              {c.authType !== 'none' && (
                <button className="conn-mini" onClick={() => void setCredential(c)}>
                  {c.hasCredential ? 'Replace credential' : 'Set credential'}
                </button>
              )}
              {c.kind === 'stdio' && (
                <button className="conn-mini" disabled={busyId === c.id} onClick={() => void runTest(c.id)}>
                  Test
                </button>
              )}
            </div>
            {testResult[c.id] && <div className="conn-test">{testResult[c.id]}</div>}
          </div>
        ))}
      </div>

      <div className="sheet-section-label" style={{ marginTop: 20 }}>Suggested</div>
      <p className="settings-intro" style={{ marginTop: 0 }}>
        Tools we recommend. “Open setup page” takes you to each one’s login / API-keys page in your
        browser; “Add” installs it and prompts for the key.
      </p>
      <div className="suggestion-tiles">
        {suggestions.map((s) => (
          <div key={s.id} className={`suggestion-tile${s.available ? '' : ' pending'}`}>
            <div
              className="tile-thumb"
              style={{ background: TILE_GRADIENT[s.id] ?? 'linear-gradient(135deg, #3d4a1f, #97b73e)' }}
            >
              <span className="tile-mark">{tileMark(s.name)}</span>
              {s.installed && <span className="tile-badge">✓ installed</span>}
            </div>
            <div className="tile-body">
              <div className="tile-name">
                {s.name}
                <span className="conn-tag">{s.category}</span>
              </div>
              <div className="settings-blurb">{s.blurb}</div>
            </div>
            <div className="tile-actions">
              <button
                className="conn-mini"
                title={`Open ${s.name}'s setup page`}
                onClick={() => void bridge.connectors.openKeyPage(s.id)}
              >
                ↗ Setup page
              </button>
              {s.installed ? (
                <span className="tile-status">added</span>
              ) : s.available ? (
                <button className="conn-mini primary-mini" onClick={() => void addSuggestion(s)}>
                  + Add
                </button>
              ) : (
                <span className="tile-status" title={s.note}>coming</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sheet-section-label" style={{ marginTop: 20 }}>Custom</div>
      {!adding ? (
        <button className="action-btn settings-add" onClick={() => setAdding(true)}>
          + Add custom connector
        </button>
      ) : (
        <div className="add-connector">
          <div className="sheet-section-label">New connector</div>
          <input
            className="link-input cr-input"
            placeholder="Name (e.g. Seedance)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="tab-row">
            <button className={draft.kind === 'stdio' ? 'active' : ''} onClick={() => setDraft({ ...draft, kind: 'stdio' })}>
              stdio (command)
            </button>
            <button className={draft.kind === 'http' ? 'active' : ''} onClick={() => setDraft({ ...draft, kind: 'http' })}>
              http (url)
            </button>
          </div>
          {draft.kind === 'stdio' ? (
            <>
              <input
                className="link-input cr-input"
                placeholder="Command (e.g. npx)"
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
              <input
                className="link-input cr-input"
                placeholder="Args (space-separated, e.g. -y @some/mcp-server)"
                value={draft.args}
                onChange={(e) => setDraft({ ...draft, args: e.target.value })}
              />
            </>
          ) : (
            <input
              className="link-input cr-input"
              placeholder="Server URL (https://…)"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
          )}
          <textarea
            className="prompt-area"
            style={{ minHeight: 48 }}
            placeholder="Non-secret env, one PER=line (optional)"
            value={draft.env}
            onChange={(e) => setDraft({ ...draft, env: e.target.value })}
          />
          <div className="tab-row">
            {(['none', 'apiKey', 'bearer'] as ConnectorAuthType[]).map((a) => (
              <button key={a} className={draft.authType === a ? 'active' : ''} onClick={() => setDraft({ ...draft, authType: a })}>
                {a}
              </button>
            ))}
          </div>
          {draft.authType !== 'none' && (
            <>
              <input
                className="link-input cr-input"
                placeholder={draft.kind === 'stdio' ? 'Secret env var (e.g. API_TOKEN)' : 'Auth header (e.g. Authorization)'}
                value={draft.secretKey}
                onChange={(e) => setDraft({ ...draft, secretKey: e.target.value })}
              />
              <input
                className="link-input cr-input"
                placeholder="Credential label (shown in the secure modal)"
                value={draft.secretFieldLabel}
                onChange={(e) => setDraft({ ...draft, secretFieldLabel: e.target.value })}
              />
            </>
          )}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT) }}>
              Cancel
            </button>
            <button className="btn primary" disabled={!draft.name.trim()} onClick={() => void saveDraft()}>
              Save{draft.authType !== 'none' ? ' + set credential' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
