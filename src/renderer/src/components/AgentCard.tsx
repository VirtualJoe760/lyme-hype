import { useCallback, useEffect, useState } from 'react'
import { CLAUDE_CREDENTIAL_ID } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'

export function AgentCard(): React.JSX.Element {
  const agent = useStudio((s) => s.agent)
  const pingAgent = useStudio((s) => s.pingAgent)
  const [claudeKey, setClaudeKey] = useState<boolean | null>(null)

  const refreshClaude = useCallback(async () => {
    const status = await bridge.agent.claudeStatus()
    setClaudeKey(status?.hasKey ?? false)
  }, [])

  useEffect(() => {
    void refreshClaude()
  }, [refreshClaude])

  async function setClaudeApiKey(): Promise<void> {
    const report = await bridge.secrets.request({
      connectorId: CLAUDE_CREDENTIAL_ID,
      connectorName: 'Claude (Anthropic)',
      fieldLabel: 'Anthropic API key (sk-ant-…)'
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
          <span className="meta">
            Claude: {claudeKey === null ? '…' : claudeKey ? 'your API key set' : 'using dev login'}
          </span>
          <button className="conn-mini" onClick={() => void setClaudeApiKey()}>
            {claudeKey ? 'Replace key' : 'Set Claude API key'}
          </button>
        </div>
      )}
    </div>
  )
}
