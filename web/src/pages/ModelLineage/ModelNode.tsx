import {
  CircleStackIcon,
  CogIcon,
  CubeIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  TableCellsIcon,
  ViewColumnsIcon,
} from '@heroicons/react/24/outline';
import { PlusCircleIcon } from '@heroicons/react/24/solid';
import { Handle, Position } from '@xyflow/react';

import type { MaterializationType, ModelNodeData } from './types';

const TYPE_ICONS = {
  model: CubeIcon,
  source: CircleStackIcon,
  seed: TableCellsIcon,
};

const TYPE_LABELS = {
  model: 'MDL',
  source: 'SRC',
  seed: 'SEED',
};

const MATERIALIZATION_LABELS: Record<MaterializationType, string> = {
  ephemeral: 'ephemeral',
  incremental: 'incremental',
  view: 'view',
  table: 'table',
};

const MATERIALIZATION_STYLES: Record<MaterializationType, string> = {
  ephemeral: 'bg-purple-600/20 text-purple-600 border-purple-600/40',
  incremental: 'bg-orange-600/20 text-orange-600 border-orange-600/40',
  view: 'bg-cyan-600/20 text-cyan-600 border-cyan-600/40',
  table: 'bg-emerald-600/20 text-emerald-600 border-emerald-600/40',
};

export default function ModelNode({ data }: { data: ModelNodeData }) {
  const {
    name,
    type,
    description,
    pathSystem,
    isCurrent,
    isSelected,
    projectName,
    isOutdated,
    hasCompiledFile,
    materialized,
    testCount,
    hasUpstream,
    hasDownstream,
    isUpstreamExpanded,
    isDownstreamExpanded,
    onRun,
    onCompile,
    onCompileAndRun,
    onNodeClick,
    onExpandUpstream,
    onExpandDownstream,
    onViewColumns,
  } = data;

  // Determine if we need to compile before running
  // Compile if: model is outdated (source changed) OR no compiled file exists
  const needsCompilation = isOutdated === true || hasCompiledFile === false;

  const TypeIcon = TYPE_ICONS[type];
  const typeLabel = TYPE_LABELS[type];

  // Build title with name and description
  const nodeTitle = description ? `${name}\n\n${description}` : name;

  // Determine border style based on current/selected state
  const getBorderStyle = () => {
    if (isCurrent) {
      return 'border-primary shadow-lg ring-1 ring-primary/20';
    }
    if (isSelected) {
      return 'border-orange-500 shadow-md ring-1 ring-orange-500/20';
    }
    return 'border-neutral shadow-sm hover:shadow-md hover:border-neutral-hover';
  };

  const handleCompileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[ModelNode] handleCompileClick:', {
      name,
      projectName,
    });
    onCompile(name, projectName);
  };

  const handleRunClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[ModelNode] handleRunClick:', {
      name,
      projectName,
      isOutdated,
      hasCompiledFile,
      needsCompilation,
    });
    if (needsCompilation) {
      // Model source has changed OR no compiled file exists → Compile first, then run
      onCompileAndRun(name, projectName);
    } else {
      // Model is up-to-date → Run directly
      onRun(name, projectName);
    }
  };

  const handleNodeClickInternal = () => {
    console.log('[ModelNode] handleNodeClickInternal:', {
      name,
      projectName,
      nodeType: type,
    });
    onNodeClick(name, projectName, type);
  };

  const handleViewColumns = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onViewColumns && pathSystem) {
      onViewColumns(pathSystem, name, type);
    }
  };

  const handleExpandUpstream = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpandUpstream) {
      onExpandUpstream(name, projectName);
    }
  };

  const handleExpandDownstream = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onExpandDownstream) {
      onExpandDownstream(name, projectName);
    }
  };

  const showUpstreamExpand =
    hasUpstream && !isUpstreamExpanded && onExpandUpstream;
  const showDownstreamExpand =
    hasDownstream && !isDownstreamExpanded && onExpandDownstream;

  return (
    <div
      className={`bg-card border rounded-lg min-w-[240px] max-w-[380px] cursor-pointer transition-all ${getBorderStyle()}`}
      onClick={handleNodeClickInternal}
    >
      {/* Input handle - LEFT for horizontal flow */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-2.5 h-2.5 !bg-neutral !border-2 !border-card"
      />

      {/* Header */}
      <div className="px-2 py-1.5 flex items-center gap-2">
        {/* Type icon and label */}
        <div className="flex flex-col items-center flex-shrink-0 px-1.5 py-1 rounded bg-surface border border-neutral">
          <TypeIcon className="w-3 h-3 text-surface-contrast" />
          <span className="font-mono text-[7px] font-semibold text-surface-contrast opacity-70">
            {typeLabel}
          </span>
        </div>
        {/* Name */}
        <div className="flex-1 min-w-0">
          <div
            className="font-mono font-semibold text-[10px] text-foreground break-words leading-tight"
            title={nodeTitle}
          >
            {name}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-full h-[0.5px] bg-black/30" />

      {/* Footer */}
      <div className="px-2 py-1.5 flex items-center justify-between gap-1">
        {/* Left: Expand upstream */}
        <div className="flex items-center">
          {showUpstreamExpand && (
            <button
              onClick={handleExpandUpstream}
              className="p-1 rounded hover:bg-surface transition-colors"
              title="Show upstream models"
            >
              <PlusCircleIcon className="w-4 h-4 text-primary" />
            </button>
          )}
        </div>

        {/* Center: Materialization and test count */}
        <div className="flex items-center gap-1.5 flex-1 justify-start">
          {materialized && (
            <span
              className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-medium ${MATERIALIZATION_STYLES[materialized]}`}
            >
              {MATERIALIZATION_LABELS[materialized]}
            </span>
          )}
          {testCount !== undefined && testCount > 0 && (
            <span
              title={`${testCount} ${testCount === 1 ? 'test' : 'tests'}`}
              className="font-mono flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded bg-surface text-surface-contrast border border-neutral"
            >
              {testCount}
              <ShieldCheckIcon className="w-2.5 h-2.5" />
            </span>
          )}
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center">
          <button
            onClick={handleViewColumns}
            className="p-1 rounded hover:bg-surface transition-colors"
            title="View columns"
          >
            <ViewColumnsIcon className="w-4 h-4 text-surface-contrast" />
          </button>
          {type === 'model' && (
            <>
              <button
                onClick={handleCompileClick}
                className={`p-1 rounded hover:bg-surface transition-colors relative ${
                  needsCompilation ? 'text-orange-600' : ''
                }`}
                title={
                  needsCompilation
                    ? 'Compile model (source has changed)'
                    : 'Compile model'
                }
              >
                <CogIcon
                  className={`w-4 h-4 ${needsCompilation ? 'text-orange-600' : 'text-surface-contrast'}`}
                />
                {needsCompilation && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-500 rounded-full" />
                )}
              </button>
              <button
                onClick={handleRunClick}
                className="p-1 rounded hover:bg-surface transition-colors"
                title={
                  needsCompilation
                    ? 'Compile & Run query (model has changes)'
                    : 'Run query'
                }
              >
                <PlayCircleIcon className="w-4 h-4 text-green-800" />
              </button>
            </>
          )}

          {showDownstreamExpand && (
            <button
              onClick={handleExpandDownstream}
              className="p-1 rounded hover:bg-surface transition-colors"
              title="Show downstream models"
            >
              <PlusCircleIcon className="w-4 h-4 text-primary" />
            </button>
          )}
        </div>
      </div>

      {/* Output handle - RIGHT for horizontal flow */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-2.5 h-2.5 !bg-neutral !border-2 !border-card"
      />
    </div>
  );
}
