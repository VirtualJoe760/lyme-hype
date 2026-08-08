import { useCallback, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type NodeTypes
} from '@xyflow/react'
import type { MediaFlowNode } from '../store'
import { useActiveSession, useStudio } from '../store'
import { MediaNode } from './MediaNode'
import { StoryboardView } from './StoryboardView'

const nodeTypes: NodeTypes = { media: MediaNode }

type Tool = 'select' | 'box'

function CanvasInner(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const onNodesChange = useStudio((s) => s.onNodesChange)
  const openCombine = useStudio((s) => s.openCombine)
  const openPlay = useStudio((s) => s.openPlay)
  const [tool, setTool] = useState<Tool>('select')
  const { getIntersectingNodes } = useReactFlow()

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)

  const handleDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: MediaFlowNode) => {
      const hits = getIntersectingNodes(node) as MediaFlowNode[]
      if (hits.length > 0) {
        openCombine(node.id, hits[0].id)
      }
    },
    [getIntersectingNodes, openCombine]
  )

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: MediaFlowNode) => {
      // Video/audio → Play view; images aren't Play-eligible (openPlay guards it).
      openPlay(node.id)
    },
    [openPlay]
  )

  return (
    <>
      <div className="canvas-toolbar">
        <button
          className={`tool-btn${tool === 'select' ? ' active' : ''}`}
          title="Select / pan"
          onClick={() => setTool('select')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3l6 18 2.5-7L21 11.5 5 3z" />
          </svg>
        </button>
        <button
          className={`tool-btn${tool === 'box' ? ' active' : ''}`}
          title="Box select"
          onClick={() => setTool('box')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2" strokeLinecap="round">
            <rect x="4" y="5" width="16" height="14" rx="1" />
          </svg>
        </button>
        <button
          className="tool-btn"
          title={
            selectedIds.length === 2
              ? 'Combine selected nodes'
              : 'Select exactly two nodes to combine'
          }
          disabled={selectedIds.length !== 2}
          onClick={() => openCombine(selectedIds[0], selectedIds[1])}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="9" height="9" rx="1" />
            <rect x="12" y="11" width="9" height="9" rx="1" />
          </svg>
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleDragStop}
        onNodeDoubleClick={handleNodeDoubleClick}
        panOnDrag={tool === 'select'}
        selectionOnDrag={tool === 'box'}
        selectionMode={SelectionMode.Partial}
        deleteKeyCode={['Delete', 'Backspace']}
        minZoom={0.25}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#2a2e34" />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <div className="inner">
            <strong>Empty canvas.</strong>
            <br />
            Generate, upload, or link media from the panel on the right —<br />
            then drag one node onto another to combine them.
          </div>
        </div>
      )}
    </>
  )
}

export function CanvasArea(): React.JSX.Element {
  const session = useActiveSession()
  const setView = useStudio((s) => s.setView)
  const view = session?.view ?? 'canvas'

  return (
    <div className="canvas-wrap">
      <div className="view-toggle">
        <button className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>
          Canvas
        </button>
        <button
          className={view === 'storyboard' ? 'active' : ''}
          onClick={() => setView('storyboard')}
        >
          Storyboard
        </button>
      </div>
      {view === 'canvas' ? (
        <ReactFlowProvider>
          <CanvasInner />
        </ReactFlowProvider>
      ) : (
        <StoryboardView />
      )}
    </div>
  )
}
