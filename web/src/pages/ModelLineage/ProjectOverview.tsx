import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CubeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useEnvironment } from '@web/context';
import { Spinner } from '@web/elements';
import { useEffect, useMemo, useState } from 'react';

import type {
  ProjectOverviewGroup,
  ProjectOverviewItem,
} from '../../stores/dataExplorerStore';
import { useDataExplorerStore } from '../../stores/dataExplorerStore';

const LAYER_ICONS: Record<string, typeof CubeIcon> = {
  staging: CubeIcon,
  intermediate: CubeIcon,
  mart: CubeIcon,
};

const LAYER_COLORS: Record<string, string> = {
  staging: 'text-blue-500',
  intermediate: 'text-orange-500',
  mart: 'text-emerald-500',
};

const MATERIALIZATION_STYLES: Record<string, string> = {
  ephemeral: 'bg-purple-600/20 text-purple-500 border-purple-600/40',
  incremental: 'bg-orange-600/20 text-orange-500 border-orange-600/40',
};

interface ProjectOverviewProps {
  onSelectModel: (modelName: string, projectName: string) => void;
  onDetectActiveModel: () => void;
}

function OverviewItemRow({
  item,
  projectName,
  onSelect,
}: {
  item: ProjectOverviewItem;
  projectName: string;
  onSelect: (name: string, project: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item.name, projectName)}
      className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-surface rounded-md transition-colors group"
    >
      <CubeIcon className="w-3.5 h-3.5 text-surface-contrast opacity-60 flex-shrink-0" />
      <span className="font-mono text-xs text-foreground truncate flex-1 group-hover:text-primary transition-colors">
        {item.name}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {item.materialized && (
          <span
            className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-medium ${MATERIALIZATION_STYLES[item.materialized] || ''}`}
          >
            {item.materialized}
          </span>
        )}
        {item.testCount !== undefined && item.testCount > 0 && (
          <span className="font-mono flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-surface text-surface-contrast border border-neutral">
            {item.testCount}
            <ShieldCheckIcon className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
    </button>
  );
}

function OverviewGroup({
  group,
  projectName,
  onSelect,
  defaultExpanded,
}: {
  group: ProjectOverviewGroup;
  projectName: string;
  onSelect: (name: string, project: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const LayerIcon = LAYER_ICONS[group.layer] || CubeIcon;
  const layerColor = LAYER_COLORS[group.layer] || 'text-surface-contrast';

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDownIcon className="w-3.5 h-3.5 text-surface-contrast" />
        ) : (
          <ChevronRightIcon className="w-3.5 h-3.5 text-surface-contrast" />
        )}
        <LayerIcon className={`w-4 h-4 ${layerColor}`} />
        <span className="text-sm font-semibold text-foreground flex-1 text-left">
          {group.label}
        </span>
        <span className="text-xs text-surface-contrast opacity-70 tabular-nums">
          {group.items.length}
        </span>
      </button>
      {expanded && (
        <div className="ml-5 border-l border-neutral pl-1">
          {group.items.map((item) => (
            <OverviewItemRow
              key={item.id}
              item={item}
              projectName={projectName}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectOverview({
  onSelectModel,
  onDetectActiveModel,
}: ProjectOverviewProps) {
  const {
    projectOverview,
    isLoadingOverview,
    fetchProjectOverview,
    _apiHandler,
  } = useDataExplorerStore();
  const { vscode } = useEnvironment();

  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (_apiHandler && !projectOverview && !isLoadingOverview) {
      void fetchProjectOverview();
    }
  }, [_apiHandler, projectOverview, isLoadingOverview, fetchProjectOverview]);

  const filteredGroups = useMemo(() => {
    if (!projectOverview) return [];
    if (!searchTerm.trim()) return projectOverview.groups;

    const term = searchTerm.toLowerCase();
    return projectOverview.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.name.toLowerCase().includes(term),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [projectOverview, searchTerm]);

  const totalModels = useMemo(() => {
    if (!projectOverview) return 0;
    return projectOverview.groups.reduce((sum, g) => sum + g.items.length, 0);
  }, [projectOverview]);

  const handleSelect = (modelName: string, projectName: string) => {
    onSelectModel(modelName, projectName);
  };

  if (isLoadingOverview && !projectOverview) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Spinner size={32} label="Loading project overview..." />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-neutral bg-card">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">
              {projectOverview?.projectName ?? 'Project'}
            </h2>
            <span className="text-xs text-surface-contrast opacity-70">
              {totalModels} models
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void fetchProjectOverview()}
              className="p-1.5 rounded hover:bg-surface transition-colors"
              title="Refresh"
            >
              <ArrowPathIcon className="w-3.5 h-3.5 text-surface-contrast" />
            </button>
            <button
              onClick={() =>
                vscode?.postMessage({
                  type: 'execute-command',
                  command: 'dj.command.queryDraftCreate',
                })
              }
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-surface transition-colors text-xs text-surface-contrast"
              title="Create a new query draft file"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              New Query
            </button>
            <button
              onClick={onDetectActiveModel}
              className="px-2.5 py-1 bg-primary text-primary-contrast rounded text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Detect Model
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 text-surface-contrast absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search models..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-neutral rounded-md text-foreground placeholder:text-surface-contrast focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-auto px-2 py-2">
        {filteredGroups.length === 0 && searchTerm && (
          <div className="text-center py-8">
            <p className="text-sm text-surface-contrast">
              No results for &ldquo;{searchTerm}&rdquo;
            </p>
          </div>
        )}
        {filteredGroups.length === 0 && !searchTerm && (
          <div className="text-center py-8">
            <p className="text-sm text-surface-contrast">
              No models available yet.
            </p>
          </div>
        )}
        {filteredGroups.map((group) => (
          <OverviewGroup
            key={group.layer}
            group={group}
            projectName={projectOverview?.projectName ?? ''}
            onSelect={handleSelect}
            defaultExpanded={true}
          />
        ))}
      </div>
    </div>
  );
}
