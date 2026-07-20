import type {
  ColumnLineageNode as ColumnLineageNodeData,
  ColumnTransformationType,
  ModelLayerType,
} from '@shared/lineage';
// Import SVG icons
import { makeClassName } from '@web';
import ColumnTripleIcon from '@web/assets/icons/column-triple.svg?react';
import DerivedIcon from '@web/assets/icons/derived.svg?react';
import ModelIcon from '@web/assets/icons/model.svg?react';
import PassthroughIcon from '@web/assets/icons/passthrough.svg?react';
import RenamedIcon from '@web/assets/icons/renamed.svg?react';
import SourceIcon from '@web/assets/icons/source.svg?react';
import { Tooltip } from '@web/elements/Tooltip';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import React, { memo } from 'react';

/** Badge configuration type */
interface BadgeConfig {
  label: string;
  bg: string;
  text: string;
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

/** Layer badge configuration - colors from CSS variables */
const LAYER_CONFIG: Record<ModelLayerType, BadgeConfig> = {
  source: {
    label: 'Source',
    bg: 'var(--color-layer-source)',
    text: 'var(--color-layer-source-contrast)',
    Icon: SourceIcon,
  },
  staging: {
    label: 'STG',
    bg: 'var(--color-layer-staging)',
    text: 'var(--color-layer-staging-contrast)',
    Icon: ModelIcon,
  },
  intermediate: {
    label: 'INT',
    bg: 'var(--color-layer-intermediate)',
    text: 'var(--color-layer-intermediate-contrast)',
    Icon: ModelIcon,
  },
  mart: {
    label: 'MART',
    bg: 'var(--color-layer-mart)',
    text: 'var(--color-layer-mart-contrast)',
    Icon: ModelIcon,
  },
  python: {
    label: 'Python',
    bg: 'var(--color-layer-source)',
    text: 'var(--color-layer-source-contrast)',
    Icon: SourceIcon,
  },
};

/** Transformation badge configuration - colors from CSS variables */
const TRANSFORM_CONFIG: Record<ColumnTransformationType, BadgeConfig> = {
  raw: {
    label: 'Raw',
    bg: 'var(--color-transform-raw)',
    text: 'var(--color-transform-raw-contrast)',
    Icon: ColumnTripleIcon,
  },
  passthrough: {
    label: 'Passthrough',
    bg: 'var(--color-transform-passthrough)',
    text: 'var(--color-transform-passthrough-contrast)',
    Icon: PassthroughIcon,
  },
  renamed: {
    label: 'Renamed',
    bg: 'var(--color-transform-renamed)',
    text: 'var(--color-transform-renamed-contrast)',
    Icon: RenamedIcon,
  },
  derived: {
    label: 'Derived',
    bg: 'var(--color-transform-derived)',
    text: 'var(--color-transform-derived-contrast)',
    Icon: DerivedIcon,
  },
};

export interface ColumnLineageNodeProps {
  data: ColumnLineageNodeData;
  /** Whether this is the target column being traced */
  isTarget?: boolean;
}

/**
 * Format expression tooltip with styled label and monospace expression
 */
function formatExpressionTooltip(expression: string): React.ReactNode {
  return (
    <div>
      <p className="font-medium mb-1">Expression</p>
      <p className="font-mono text-xs">{expression}</p>
    </div>
  );
}

/**
 * Custom React Flow node for displaying column lineage information.
 */
export const ColumnLineageNode: React.FC<NodeProps> = memo(({ data }) => {
  const nodeData = data.data as ColumnLineageNodeData;
  const isTarget = data.isTarget as boolean | undefined;
  const layerConfig = LAYER_CONFIG[nodeData.modelLayer];
  const transformConfig = TRANSFORM_CONFIG[nodeData.transformation];

  const LayerIcon = layerConfig.Icon;
  const TransformIcon = transformConfig.Icon;

  return (
    <div
      className={makeClassName(
        'bg-card rounded-lg shadow-lg w-96 h-32', // Fixed 384px × 128px
        isTarget ? 'border-2 border-primary' : 'border border-neutral',
        'cursor-pointer hover:border-primary transition-colors',
      )}
    >
      {/* Target handle (left side - receives edges) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-surface-contrast !border-neutral"
      />

      <div className="flex items-center gap-4 p-4 h-full">
        {/* COL icon box */}
        <div className="flex-shrink-0 w-12 h-12 bg-surface rounded flex flex-col items-center justify-center">
          <ColumnTripleIcon className="w-5 h-5 text-foreground" />
          <span className="text-[10px] text-surface-contrast mt-0.5">COL</span>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-2 flex-1 min-w-0 h-full">
          {/* Column name row */}
          <div
            className="flex items-center justify-between gap-2"
            title={`Click to open ${nodeData.dataType === 'source' ? 'source' : 'model'} and view lineage`}
          >
            <span className="text-sm font-medium text-foreground truncate">
              {nodeData.columnName}
            </span>
            {nodeData.dataType && (
              <span className="text-[11px] font-medium text-surface-contrast uppercase flex-shrink-0">
                {nodeData.dataType}
              </span>
            )}
          </div>

          {/* Model name - truncated to 2 lines with tooltip */}
          <div
            className="text-xs text-surface-contrast break-all"
            title={nodeData.modelName}
          >
            {nodeData.modelName}
          </div>

          {/* Badges row */}
          <div className="flex items-center gap-2 mt-auto">
            {/* Layer badge */}
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: layerConfig.bg,
                color: layerConfig.text,
              }}
            >
              <LayerIcon className="w-3 h-3" />
              {layerConfig.label}
            </span>

            {/* Transformation badge */}
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: transformConfig.bg,
                color: transformConfig.text,
              }}
            >
              <TransformIcon className="w-3 h-3" />
              {transformConfig.label}
            </span>

            {/* Expression tooltip for derived columns */}
            {nodeData.transformation === 'derived' && nodeData.expression && (
              <Tooltip
                content={formatExpressionTooltip(nodeData.expression)}
                align="center"
              />
            )}
          </div>
        </div>
      </div>

      {/* Source handle (right side - sends edges) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-surface-contrast !border-neutral"
      />
    </div>
  );
});

ColumnLineageNode.displayName = 'ColumnLineageNode';
