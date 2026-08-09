import { useCallback, useEffect, useState } from 'react'
import type { ModelProviderView } from '@shared/types'
import { bridge } from '../../bridge'
import { AgentCard } from '../AgentCard'
import { Button } from '../ui/Button'

const CLAUDE_API_KEY_CREDENTIAL_ID = 'anthropic-claude-api-key'
const CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID = 'anthropic-claude-oauth-token'

interface DraftProvider {
  name: string
  baseUrl: string
  model: string
  secretFieldLabel: string
}

const EMPTY_DRAFT: DraftProvider = {
  name: '',
  baseUrl: '',
  model: '',
  secretFieldLabel: 'API key'
}

function slugId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base ? `${base}-${Date.now().toString(36).slice(-4)}` : `provider-${Date.now().toString(36)}`
}

export function ModelsTab(): React.JSX.Element {
  const [providers, setProviders] = useState<ModelProviderView[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<DraftProvider>(EMPTY_DRAFT)

  const refresh = useCallback(async () => {
    setProviders(await bridge.modelProviders.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function setActive(id: string): Promise<void> {
    await bridge.modelProviders.setActive(id)
    await refresh()
  }

  async function setProviderKey(p: ModelProviderView): Promise<void> {
    const report = await bridge.secrets.request({
      connectorId: p.id,
      connectorName: p.name,
      fieldLabel: p.secretFieldLabel
    })
    if (report) await refresh()
  }

  async function setClaudeOverride(kind: 'apiKey' | 'oauthToken'): Promise<void> {
    await bridge.secrets.request({
      connectorId: kind === 'apiKey' ? CLAUDE_API_KEY_CREDENTIAL_ID : CLAUDE_OAUTH_TOKEN_CREDENTIAL_ID,
      connectorName: 'Claude (Anthropic)',
      fieldLabel:
        kind === 'apiKey' ? 'Anthropic API key (sk-ant-…)' : 'Setup-token (from `claude setup-token`)'
    })
    await refresh()
  }

  async function saveDraft(): Promise<void> {
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) return
    const id = slugId(draft.name)
    await bridge.modelProviders.save({
      id,
      name: draft.name.trim(),
      kind: 'anthropic-compatible',
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      secretFieldLabel: draft.secretFieldLabel.trim() || 'API key'
    })
    await refresh()
    await bridge.secrets.request({
      connectorId: id,
      connectorName: draft.name.trim(),
      fieldLabel: draft.secretFieldLabel.trim() || 'API key'
    })
    await refresh()
    setDraft(EMPTY_DRAFT)
    setAdding(false)
  }

  return (
    <div className="settings-section">
      <p className="settings-intro">
        Which model backs the agent. The default is Claude via this machine’s own Claude Code login.
        Any Anthropic-API-compatible endpoint also works — Kimi’s hosted one, or a local/OpenAI model
        behind a translation proxy — set as base URL + model + key. The active provider handles the
        agent’s orchestration (deciding which connector/tool to call).
      </p>
      {!bridge.isElectron && (
        <p className="settings-intro">Models run in the Electron app — browser preview shows layout only.</p>
      )}

      <div className="settings-grid">
        {providers.map((p) => (
          <div key={p.id} className={`settings-card${p.active ? ' active' : ''}`}>
            <div className="settings-card-head">
              <label className="provider-pick">
                <input
                  type="radio"
                  name="active-provider"
                  checked={p.active}
                  onChange={() => void setActive(p.id)}
                />
                <span className="name">
                  {p.name}
                  {p.builtin && <span className="conn-tag">template</span>}
                  {p.active && <span className="conn-tag active-tag">active</span>}
                </span>
              </label>
              {!p.builtin && (
                <button
                  className="del"
                  title="Remove provider"
                  onClick={() => {
                    if (window.confirm(`Remove model provider "${p.name}"?`)) {
                      void bridge.modelProviders.delete(p.id).then(refresh)
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="meta">
              {p.kind === 'claude-default'
                ? "Claude Code login on this machine"
                : `${p.model ?? '?'} · ${p.baseUrl ?? '?'} · ${p.hasCredential ? 'key set' : 'no key'}`}
            </div>
            <div className="conn-actions">
              {p.kind === 'claude-default' ? (
                <>
                  <Button onClick={() => void setClaudeOverride('oauthToken')}>
                    Set setup-token
                  </Button>
                  <Button onClick={() => void setClaudeOverride('apiKey')}>
                    Set API key
                  </Button>
                </>
              ) : (
                <Button onClick={() => void setProviderKey(p)}>
                  {p.hasCredential ? 'Replace key' : 'Set key'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!adding ? (
        <Button variant="block" className="settings-add" onClick={() => setAdding(true)}>
          + Add model provider
        </Button>
      ) : (
        <div className="add-connector">
          <div className="sheet-section-label">New Anthropic-compatible provider</div>
          <input
            className="link-input cr-input"
            placeholder="Name (e.g. Local Qwen via LM Studio)"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="link-input cr-input"
            placeholder="Base URL (e.g. http://localhost:1234)"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
          <input
            className="link-input cr-input"
            placeholder="Model id (e.g. qwen2.5-coder-14b)"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
          <input
            className="link-input cr-input"
            placeholder="Credential label (shown in the secure modal)"
            value={draft.secretFieldLabel}
            onChange={(e) => setDraft({ ...draft, secretFieldLabel: e.target.value })}
          />
          <p className="settings-hint">
            Endpoint must speak the Anthropic API shape. Local/OpenAI models need a translation proxy
            (LM Studio 0.4.1+, LiteLLM, or claude-code-proxy) in front.
          </p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <Button variant="dialog" onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT) }}>
              Cancel
            </Button>
            <Button
              variant="dialog-primary"
              disabled={!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()}
              onClick={() => void saveDraft()}
            >
              Save + set key
            </Button>
          </div>
        </div>
      )}
      {/* The agent-link diagnostic lives with the model settings now — the
          Create panel's home is tasks only (create-panel v2). */}
      <div className="settings-agent-card">
        <AgentCard />
      </div>
    </div>
  )
}
