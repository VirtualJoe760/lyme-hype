import { useEffect, useState } from 'react'
import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import type { MediaFlowNode } from '../store'
import { useStudio } from '../store'

/**
 * A named frame around canvas nodes (React Flow parent node). Its children
 * carry `parentId`, so dragging the frame moves them in unison and they stay
 * inside it. Double-click the name to rename; the toolbar ungroups.
 */
export function GroupNode({ id, data, selected }: NodeProps<MediaFlowNode>): React.JSX.Element {
  const renameGroup = useStudio((s) => s.renameGroup)
  const ungroup = useStudio((s) => s.ungroup)
  const removeNode = useStudio((s) => s.removeNode)
  const memberCount = useStudio((s) => s.nodes.filter((n) => n.parentId === id).length)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  useEffect(() => setDraft(data.label), [data.label])

  function commit(): void {
    setEditing(false)
    if (draft.trim() && draft.trim() !== data.label) renameGroup(id, draft)
    else setDraft(data.label)
  }

  return (
    <div className={`group-node${selected ? ' selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} lineClassName="group-resize-line" handleClassName="group-resize-handle" />
      <NodeToolbar isVisible={selected} position={Position.Top} className="node-actions">
        <button title="Rename" onClick={() => setEditing(true)}>
          rename
        </button>
        <button title="Ungroup — the nodes stay where they are" onClick={() => ungroup(id)}>
          ungroup
        </button>
        <button className="danger" title="Trash the group and everything in it" onClick={() => removeNode(id)}>
          ✕
        </button>
      </NodeToolbar>
      <div className="group-head" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input
            className="group-name-input nodrag"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(data.label)
                setEditing(false)
              }
            }}
          />
        ) : (
          <>
            <span className="group-name" title="double-click to rename">
              {data.label}
            </span>
            <span className="group-count">{memberCount}</span>
          </>
        )}
      </div>
    </div>
  )
}
