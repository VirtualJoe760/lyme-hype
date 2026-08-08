import { useStudio } from '../store'

export function AgentCard(): React.JSX.Element {
  const agent = useStudio((s) => s.agent)
  const pingAgent = useStudio((s) => s.pingAgent)

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
    </div>
  )
}
