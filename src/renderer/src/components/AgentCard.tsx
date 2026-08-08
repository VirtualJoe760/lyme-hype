import { useCallback, useEffect, useState } from 'react'
import type { ClaudeAuthOverrideKind } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'

const API_KEY_CREDENTIAL_ID = 'anthropic-claude-api-key'
const OAUTH_TOKEN_CREDENTIAL_ID = 'anthropic-claude-oauth-token'

const OVERRIDE_LABEL: Record<ClaudeAuthOverrideKind, string> = {
  none: 'using this machine’s Claude Code login',
  apiKey: 'API key override set',
  oauthToken: 'setup-token override set'
}

export function AgentCard(): React.JSX.Element {
  const agent = useStudio((s) => s.agent)
  const pingAgent = useStudio((s) => s.pingAgent)
  const [override, setOverride] = useState<ClaudeAuthOverrideKind | null>(null)

  const refreshClaude = useCallback(async () => {
    const status = await bridge.agent.claudeStatus()
    setOverride(status?.override ?? 'none')
  }, [])

  useEffect(() => {
    void refreshClaude()
  }, [refreshClaude])

  async function setOverrideKey(kind: 'apiKey' | 'oauthToken'): Promise<void> {
    const report = await bridge.secrets.request({
      connectorId: kind === 'apiKey' ? API_KEY_CREDENTIAL_ID : OAUTH_TOKEN_CREDENTIAL_ID,
      connectorName: 'Claude (Anthropic)',
      fieldLabel:
        kind === 'apiKey' ? 'Anthropic API key (sk-ant-…)' : 'Setup-token (from `claude setup-token`)'
    })
    if (report) await refreshClaude()
  }

  const meta: string[] = []
  if (agent.lastCostUsd !== null) meta.push(`$${agent.lastCostUsd.toFixed(4)}`)
  if (agent.lastDurationMs !== null) meta.push(`${(agent.lastDurationMs / 1000).toFixed(1)}s`)

  return (
    <div className="agent-card">
      <div className="head">
        <span className="title">Agent link</span>
        <span className={`status-dot ${agent.status}`} />
      </div>
      <div className="transcript">
        {agent.transcript ||
          (agent.status === 'running' ? 'Contacting agent…' : 'No check run yet.')}
      </div>
      {meta.length > 0 && <div className="meta">{meta.join(' · ')}</div>}
      <button
        className="ping-btn"
        disabled={agent.status === 'running'}
        onClick={() => void pingAgent()}
      >
        {agent.status === 'running' ? 'Checking…' : 'Check agent link'}
      </button>
      {bridge.isElectron && (
        <div className="claude-key-row">
          <span className="meta">Claude: {override === null ? '…' : OVERRIDE_LABEL[override]}</span>
          <div className="conn-actions">
            <button className="conn-mini" onClick={() => void setOverrideKey('oauthToken')}>
              Use setup-token
            </button>
            <button className="conn-mini" onClick={() => void setOverrideKey('apiKey')}>
              Use API key
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
