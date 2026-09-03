import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type NodeTypes
} from '@xyflow/react'
import type { MediaFlowNode } from '../store'
import { useActiveSession, useStudio } from '../store'
import { GroupNode } from './GroupNode'
import { MediaNode } from './MediaNode'
import { ScriptingView } from './ScriptingView'
import { StoryboardView } from './StoryboardView'
import { TrashCan } from './TrashCan'
import { type GhostGeometry, clearZoneHighlight, dropNodeOn, ghostGeometryFor, hideGhost, highlightZone, nearTrash, positionGhost, zoneAt } from './canvas-drag'

const nodeTypes: NodeTypes = { media: MediaNode, group: GroupNode }

type Tool = 'select' | 'box'

function CanvasInner(): React.JSX.Element {
  const nodes = useStudio((s) => s.nodes)
  const onNodesChange = useStudio((s) => s.onNodesChange)
  const openCombine = useStudio((s) => s.openCombine)
  const tidyCanvas = useStudio((s) => s.tidyCanvas)
  const groupSelected = useStudio((s) => s.groupSelected)
  const ungroup = useStudio((s) => s.ungroup)
  const trashNodes = useStudio((s) => s.trashNodes)
  const openPlay = useStudio((s) => s.openPlay)
  const [tool, setTool] = useState<Tool>('select')
  const { getIntersectingNodes, setCenter } = useReactFlow()
  const focusNodeId = useStudio((s) => s.focusNodeId)
  const clearFocusNode = useStudio((s) => s.clearFocusNode)

  // "View →" from a Create screen's result row pans the canvas to the node.
  // Instant jump, not animated — an animation can be cancelled by any other
  // viewport-touching render mid-flight and silently end up nowhere.
  useEffect(() => {
    if (!focusNodeId) return
    const node = nodes.find((n) => n.id === focusNodeId)
    if (node) {
      void setCenter(node.position.x + 52, node.position.y + 50, { zoom: 1.2 })
    }
    clearFocusNode()
  }, [focusNodeId, nodes, setCenter, clearFocusNode])

  // Un-promoted Storyboard panels are node objects too, but they only belong to
  // the Storyboard sequence — the Canvas shows real nodes and promoted panels.
  const canvasNodes = useMemo(() => nodes.filter((n) => !n.data.panel || n.data.promoted), [nodes])

  const selectedIds = canvasNodes.filter((n) => n.selected).map((n) => n.id)
  const groupable = canvasNodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId).length
  const selectedGroups = canvasNodes.filter((n) => n.selected && n.type === 'group')
  const selectedNodes = canvasNodes.filter((n) => n.selected)
  const mergeable =
    selectedNodes.length === 2 &&
    selectedNodes.every((n) => n.type !== 'group' && n.data.mediaType === 'image' && n.data.status === 'ready' && n.data.src)

  // Where each dragged node started, so a drop on a zone can put it back
  // instead of leaving it stranded wherever the pointer left the canvas.
  const dragStart = useRef(new Map<string, { x: number; y: number }>())
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const flowRef = useRef<HTMLDivElement | null>(null)
  const [ghostNode, setGhostNode] = useState<MediaFlowNode | null>(null)
  const ghostGeom = useRef<GhostGeometry | null>(null)

  const pointOf = (event: MouseEvent | TouchEvent): { x: number; y: number } => {
    const t = 'touches' in event ? event.touches[0] ?? event.changedTouches[0] : event
    return { x: t.clientX, y: t.clientY }
  }

  const handleDragStart = useCallback((event: MouseEvent | TouchEvent, node: MediaFlowNode) => {
    dragStart.current.set(node.id, { ...node.position })
    const { x, y } = pointOf(event)
    ghostGeom.current = ghostGeometryFor(node.id, x, y)
    setGhostNode(node)
  }, [])

  const handleDrag = useCallback((event: MouseEvent | TouchEvent, _node: MediaFlowNode) => {
    const { x, y } = pointOf(event)
    const zone = zoneAt(x, y)
    highlightZone(zone)
    positionGhost(ghostRef.current, ghostGeom.current, flowRef.current?.getBoundingClientRect(), x, y, zone !== null || nearTrash(x, y))
  }, [])

  const handleDragStop = useCallback(
    (event: MouseEvent | TouchEvent, node: MediaFlowNode) => {
      const { x, y } = pointOf(event)
      clearZoneHighlight()
      hideGhost(ghostRef.current, ghostGeom.current)
      ghostGeom.current = null
      setGhostNode(null)
      const start = dragStart.current.get(node.id)
      dragStart.current.delete(node.id)

      const zone = zoneAt(x, y)
      if (zone && dropNodeOn(zone, node, x, y)) {
        // Delivered. The node itself stays on the canvas, where it was.
        if (start) onNodesChange([{ type: 'position', id: node.id, position: start, dragging: false }])
        return
      }
      // Dropping one still on another opens Merge. A group frame is never a
      // merge partner — dragging a frame across a node opened the dialog
      // (2026-09-03) — and neither is a node's own frame or its siblings inside it.
      if (node.type === 'group') return
      const hits = (getIntersectingNodes(node) as MediaFlowNode[]).filter(
        (h) => h.type !== 'group' && h.id !== node.parentId && h.parentId === node.parentId
      )
      if (hits.length > 0) {
        openCombine(node.id, hits[0].id)
      }
    },
    [getIntersectingNodes, openCombine, onNodesChange]
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
          data-tool="combine"
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
        <span className="tool-sep" />
        <button
          className="tool-btn"
          data-tool="tidy"
          title="Tidy — photos in one line, videos in the next, audio below"
          disabled={canvasNodes.length === 0}
          onClick={tidyCanvas}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="5" width="5" height="6" rx="1" />
            <rect x="10" y="5" width="5" height="6" rx="1" />
            <rect x="17" y="5" width="4" height="6" rx="1" />
            <path d="M3 16h18M3 20h12" />
          </svg>
        </button>
        <button
          className="tool-btn"
          data-tool="group"
          title={groupable >= 2 ? 'Group the selected nodes (they move together)' : 'Select two or more nodes to group them'}
          disabled={groupable < 2}
          onClick={() => groupSelected()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <rect x="7" y="9" width="4" height="6" rx="1" strokeDasharray="0" />
            <rect x="13" y="9" width="4" height="6" rx="1" strokeDasharray="0" />
          </svg>
        </button>
        {selectedGroups.length === 1 && (
          <button className="tool-btn" data-tool="ungroup" title="Ungroup — the nodes stay where they are" onClick={() => ungroup(selectedGroups[0]!.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="7" width="7" height="10" rx="1" />
              <rect x="14" y="7" width="7" height="10" rx="1" />
              <path d="M10 12h4" strokeDasharray="2 2" />
            </svg>
          </button>
        )}
      </div>
      <ReactFlow
        ref={flowRef}
        nodes={canvasNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={handleDragStart}
        onNodeDrag={handleDrag}
        onNodeDragStop={handleDragStop}
        // Dragging toward the edge must not pull the canvas along — the point
        // of leaving the canvas is to reach the timeline, the trash, a tile.
        autoPanOnNodeDrag={false}
        // Shift-click adds to the selection (React Flow's default is Control on
        // Windows, which nobody guessed — 2026-09-03). Ctrl/Cmd still work.
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
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
        {/* What you can do with SEVERAL selected nodes, floating above them:
            merge two stills, group any two or more. Per-node actions step
            aside while more than one node is selected. */}
        <NodeToolbar nodeId={selectedIds} isVisible={selectedIds.length >= 2} position={Position.Top} className="node-actions selection-actions">
          {mergeable && (
            <button title="Merge these two stills into one new image" onClick={() => openCombine(selectedIds[0]!, selectedIds[1]!)}>
              merge
            </button>
          )}
          {groupable >= 2 && (
            <button title="Group the selected nodes — they move together" onClick={() => groupSelected()}>
              group
            </button>
          )}
          <button className="danger" title="Trash the selected nodes" onClick={() => trashNodes(selectedIds)}>
            ✕
          </button>
        </NodeToolbar>
      </ReactFlow>
      <TrashCan />
      <div ref={ghostRef} className="drag-ghost" hidden aria-hidden="true">
        {ghostNode?.data.thumbSrc || (ghostNode?.data.mediaType === 'image' && ghostNode.data.src) ? (
          <img src={(ghostNode?.data.mediaType === 'image' ? ghostNode.data.src : undefined) ?? ghostNode?.data.thumbSrc ?? ghostNode?.data.src} alt="" />
        ) : (
          <span className="drag-ghost-glyph">{ghostNode?.data.mediaType === 'video' ? '▶' : ghostNode?.data.mediaType === 'audio' ? '♪' : '▦'}</span>
        )}
        <span className="drag-ghost-label">{ghostNode?.data.label}</span>
      </div>
      {canvasNodes.length === 0 && (
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
        <button
          className={view === 'scripting' ? 'active' : ''}
          onClick={() => setView('scripting')}
        >
          Scripting
        </button>
      </div>
      {view === 'canvas' ? (
        <ReactFlowProvider>
          <CanvasInner />
        </ReactFlowProvider>
      ) : view === 'storyboard' ? (
        <StoryboardView />
      ) : (
        <ScriptingView />
      )}
    </div>
  )
}
