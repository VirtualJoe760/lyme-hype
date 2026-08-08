import { useCallback, useEffect, useState } from 'react'
import type { SecretReport } from '@shared/types'
import { bridge } from '../bridge'
import { useStudio } from '../store'

export function ConnectionsPanel(): React.JSX.Element {
  const setConnectionsOpen = useStudio((s) => s.setConnectionsOpen)
  const [reports, setReports] = useState<SecretReport[]>([])
  const [lastReport, setLastReport] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setReports(await bridge.secrets.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleTestSecret(): Promise<void> {
    setBusy(true)
    try {
      const report = await bridge.secrets.request({
        connectorId: 'fake-connector',
        connectorName: 'Fake Connector (boundary test)',
        fieldLabel: 'API key'
      })
      if (report) {
        setLastReport(
          `Stored: ${report.fieldLabel} · ${report.length} chars · …${report.last4} — value never left the main process.`
        )
      } else {
        setLastReport('Cancelled — nothing stored.')
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connections-sheet">
      <div className="sheet-head">
        <h2>Connections</h2>
        <button className="panel-btn" title="Close" onClick={() => setConnectionsOpen(false)}>
          ✕
        </button>
      </div>
      <div className="sheet-body">
        <p>
          Generation and data tools attach here as MCP connections — a generic connector model, not
          a fixed list. Real connections land in Phase 3, starting with ChatRealty.
        </p>
        <p>
          Credentials are collected only by the native secure modal and stored via OS encryption
          (DPAPI). The agent and this window only ever see field name, length, and last 4.
        </p>

        <div className="sheet-section-label">Stored credentials</div>
        {reports.length === 0 && <p>None yet.</p>}
        {reports.map((report) => (
          <div key={report.connectorId} className="cred-row">
            <div className="info">
              <div className="name">{report.connectorId}</div>
              <div className="meta">
                {report.fieldLabel} · {report.length} chars · …{report.last4}
              </div>
            </div>
            <button
              className="del"
              title="Delete credential"
              onClick={() => {
                if (window.confirm(`Delete the stored credential for "${report.connectorId}"?`)) {
                  void bridge.secrets.delete(report.connectorId).then(refresh)
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <div className="sheet-section-label">Security boundary test</div>
        {bridge.isElectron ? (
          <>
            <button className="action-btn" disabled={busy} onClick={() => void handleTestSecret()}>
              Test secure input (fake connector)
            </button>
            {lastReport && <div className="report-line">{lastReport}</div>}
          </>
        ) : (
          <p>The native secure-credential modal only exists in the Electron app — not in browser preview.</p>
        )}
      </div>
    </div>
  )
}
