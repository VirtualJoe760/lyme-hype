import { useEffect } from 'react'
import { AsidePanel } from './components/AsidePanel'
import { CanvasArea } from './components/CanvasArea'
import { CombineDialog } from './components/CombineDialog'
import { CutRoom } from './components/CutRoom'
import { PanelResizeHandle } from './components/PanelResizeHandle'
import { PlayView } from './components/PlayView'
import { Settings } from './components/settings/Settings'
import { SessionsRail } from './components/SessionsRail'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { PANEL_SIZES, useStudio } from './store'

export default function App(): React.JSX.Element {
  const loaded = useStudio((s) => s.loaded)
  const init = useStudio((s) => s.init)
  const combine = useStudio((s) => s.combine)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  const playNodeId = useStudio((s) => s.playNodeId)
  const railCollapsed = useStudio((s) => s.railCollapsed)
  const asideCollapsed = useStudio((s) => s.asideCollapsed)
  const timelineCollapsed = useStudio((s) => s.timelineCollapsed)
  const railWidth = useStudio((s) => s.railWidth)
  const asideWidth = useStudio((s) => s.asideWidth)
  const timelineHeight = useStudio((s) => s.timelineHeight)
  const setPanelSize = useStudio((s) => s.setPanelSize)
  const toggleRail = useStudio((s) => s.toggleRail)
  const toggleAside = useStudio((s) => s.toggleAside)
  const toggleTimeline = useStudio((s) => s.toggleTimeline)

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
            {!playNodeId && <SessionsRail />}
            {!playNodeId && !railCollapsed && (
              <PanelResizeHandle
                grow="right"
                value={railWidth}
                min={PANEL_SIZES.rail.min}
                max={() => PANEL_SIZES.rail.max}
                onResize={(px) => setPanelSize('rail', px)}
                onCollapse={toggleRail}
              />
            )}
            <div className="main">
              {playNodeId ? (
                <PlayView />
              ) : (
                <div className="row">
                  <CanvasArea />
                  {!asideCollapsed && (
                    <PanelResizeHandle
                      grow="left"
                      value={asideWidth}
                      min={PANEL_SIZES.aside.min}
                      max={() => PANEL_SIZES.aside.max}
                      onResize={(px) => setPanelSize('aside', px)}
                      onCollapse={toggleAside}
                    />
                  )}
                  <AsidePanel />
                </div>
              )}
              {!timelineCollapsed && (
                <PanelResizeHandle
                  grow="up"
                  value={timelineHeight}
                  min={PANEL_SIZES.timeline.min}
                  max={() =>
                    Math.round(window.innerHeight * PANEL_SIZES.timeline.maxViewportFraction)
                  }
                  onResize={(px) => setPanelSize('timeline', px)}
                  onCollapse={toggleTimeline}
                />
              )}
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
