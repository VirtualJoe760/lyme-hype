import { useEffect } from 'react'
import { AsidePanel } from './components/AsidePanel'
import { CanvasArea } from './components/CanvasArea'
import { CombineDialog } from './components/CombineDialog'
import { CutRoom } from './components/CutRoom'
import { Settings } from './components/settings/Settings'
import { SessionsRail } from './components/SessionsRail'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { useStudio } from './store'

export default function App(): React.JSX.Element {
  const loaded = useStudio((s) => s.loaded)
  const init = useStudio((s) => s.init)
  const combine = useStudio((s) => s.combine)
  const settingsOpen = useStudio((s) => s.settingsOpen)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app">
      <TitleBar />
      <Toolbar />
      <div className="body">
        {loaded && (
          <>
            <SessionsRail />
            <div className="main">
              <div className="row">
                <CanvasArea />
                <AsidePanel />
              </div>
              <CutRoom />
            </div>
          </>
        )}
      </div>
      {combine && <CombineDialog />}
      {settingsOpen && <Settings />}
    </div>
  )
}
