import { useActiveSession, useStudio } from '../store'

export function Toolbar(): React.JSX.Element {
  const session = useActiveSession()
  const totalCost = useStudio((s) => s.agent.totalCostUsd)

  return (
    <div className="toolbar">
      <div className="breadcrumb">
        <span className="live" />
        {session?.name ?? 'Lyme Hype'}
      </div>
      <div className="stats">
        <span className="pill" title="Context tracking lands with persistent agent sessions">
          CTX —
        </span>
        <span className="pill" title="Agent spend this app run">
          ${totalCost.toFixed(2)}
        </span>
        <span className="pill mode">Studio Mode</span>
      </div>
    </div>
  )
}
