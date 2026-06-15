import { PlusCircleIcon } from '@heroicons/react/24/outline';
import { Button } from '@web/elements';
import type { EdgeProps } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import React from 'react';

interface JoinEdgeData {
  onAddJoin?: () => void;
  label?: string;
}

export const JoinEdge: React.FC<EdgeProps> = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
}) => {
  const edgeData = data as JoinEdgeData;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleAddJoin = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (edgeData?.onAddJoin) {
      edgeData.onAddJoin();
    }
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: 3,
          stroke: '#111',
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            fontSize: 12,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-2 py-1 shadow-md">
            <Button
              variant="iconButton"
              title="Add another join"
              aria-label="Add another join"
              className="px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
              icon={<PlusCircleIcon className="w-3 h-3" />}
              label="Add Join"
              onClick={handleAddJoin}
            />
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
