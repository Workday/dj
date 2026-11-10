import {
  CircleStackIcon,
  PlusIcon,
  Square3Stack3DIcon,
} from '@heroicons/react/24/solid';
import type { DbtProject } from '@shared/dbt/types';
import { useApp } from '@web/context';
import { Button, SelectSingle } from '@web/elements';
import { useModelStore } from '@web/stores/useModelStore';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  filterAvailableModels,
  getAllUsedModelsAndSources,
} from '../../../utils/dataModeling';
import ErrorMessage from '../components/ErrorMessage';
import { pickModelProject } from '../utils/projectSelection';

export interface AvailableModel {
  label: string;
  value: string;
}

export interface UnionModel {
  id: string;
  selectedModel: AvailableModel | null;
}

export const UnionNode: React.FC<NodeProps> = () => {
  const { api } = useApp();

  // Direct ModelStore integration - everything comes from ModelStore
  const { modelingState, updateUnionState, basicFields } = useModelStore();

  // Defensive fallback in case modelingState.union becomes undefined during async resets
  const unionState = useMemo(() => {
    const u = modelingState.union || {};
    return {
      type: u.type || 'all',
      models: Array.isArray(u.models) ? u.models : [],
      sources: Array.isArray(u.sources) ? u.sources : [],
    };
  }, [modelingState.union]);

  const isUnionSource = (basicFields.type as string) === 'stg_union_sources';

  const [selectedType, setSelectedType] = useState<AvailableModel | null>(
    () => {
      const storeType = unionState.type || 'all';
      return { label: storeType, value: storeType };
    },
  );

  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unionModels, setUnionModels] = useState<UnionModel[]>(() => {
    // Initialize from ModelStore only
    const storeItems = isUnionSource ? unionState.sources : unionState.models;
    if (storeItems && storeItems.length > 0) {
      return storeItems.map((itemName, index) => ({
        id: (index + 1).toString(),
        selectedModel: { label: itemName, value: itemName },
      }));
    }
    return [{ id: '1', selectedModel: null }];
  });

  // Build selected items from local unionModels (helper to avoid duplication)
  const buildSelectedItems = useCallback(
    (modelsList: UnionModel[]) =>
      modelsList.map((um) => um.selectedModel?.value || '').filter(Boolean),
    [],
  );

  const prevUnionModelsRef = useRef<string[]>([]);

  const typeOptions = useMemo(() => [{ label: 'all', value: 'all' }], []);

  // Track used models/sources across different parts of modelingState
  const usedModelsAndSources = useMemo(
    () => getAllUsedModelsAndSources(modelingState),
    [modelingState],
  );

  // Generate model options for each row, excluding models selected in other rows
  const rowModelOptions = useMemo(() => {
    const options: Record<string, Array<{ label: string; value: string }>> = {};

    unionModels.forEach((unionModel) => {
      const currentRowId = unionModel.id;

      // Get models selected in OTHER rows (not the current row)
      const selectedInOtherRows = unionModels
        .filter((um) => um.id !== currentRowId)
        .map((um) => um.selectedModel?.value)
        .filter(Boolean) as string[];

      // Get the model selected in the current row (to preserve it)
      const currentRowModel = unionModel.selectedModel?.value;
      const currentRowSelections = currentRowModel ? [currentRowModel] : [];

      // Create combined exclusion set: used elsewhere + selected in other union rows
      const combinedUsedModels = new Set([
        ...usedModelsAndSources,
        ...selectedInOtherRows,
      ]);

      // Use utility function to filter available models for this row
      options[currentRowId] = filterAvailableModels(
        models,
        combinedUsedModels,
        currentRowSelections,
      );
    });

    return options;
  }, [models, usedModelsAndSources, unionModels]);

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let projects: DbtProject[] = [];

      const projectsResponse = await api.post({
        type: 'dbt-fetch-projects',
        request: null,
      });
      projects = projectsResponse || [];

      if (projects.length === 0) {
        setModels([]);
        return;
      }

      const project = pickModelProject(
        projects,
        useModelStore.getState().basicFields.projectName,
      );
      if (!project) {
        setModels([]);
        return;
      }

      if (!project.manifest?.nodes) {
        setModels([]);
        return;
      }

      if (isUnionSource) {
        // Fetch sources from manifest.sources (filter by source.)
        const sourceNames = Object.keys(project.manifest.sources)
          .filter((key) => key.startsWith('source.'))
          .map((key) => {
            const source = project.manifest.sources[key];
            return source?.source_name && source?.name
              ? `${source.source_name}.${source.name}`
              : null;
          })
          .filter((name): name is string => Boolean(name));

        setModels(sourceNames);
      } else {
        // Fetch models and seeds from manifest.nodes
        const modelNames = Object.keys(project.manifest.nodes)
          .filter((key) => key.startsWith('model.') || key.startsWith('seed.'))
          .map((key) => project.manifest.nodes[key]?.name)
          .filter((name): name is string => Boolean(name));

        setModels(modelNames);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch data';
      setError(errorMessage);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, [api, isUnionSource]);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  // Sync local state when modelingState changes (but only when coming from external sources)
  useEffect(() => {
    const storeItems = isUnionSource ? unionState.sources : unionState.models;

    if (storeItems && Array.isArray(storeItems) && storeItems.length > 0) {
      // Use ref to get current unionModels without dependency
      const currentItems = prevUnionModelsRef.current;
      const storeItemsSet = new Set(storeItems);
      const currentItemsSet = new Set(currentItems);

      // Only update if store has different items than current state
      // This prevents infinite loops by only syncing when there's an actual external change
      const storeChanged =
        storeItems.length !== currentItems.length ||
        !storeItems.every((item) => currentItemsSet.has(item)) ||
        !currentItems.every((item) => storeItemsSet.has(item));

      if (storeChanged) {
        const initializedItems = storeItems.map(
          (itemName: string, index: number) => ({
            id: (index + 1).toString(),
            selectedModel: { label: itemName, value: itemName },
          }),
        );
        setUnionModels(initializedItems);
      }
    } else if (
      storeItems &&
      Array.isArray(storeItems) &&
      storeItems.length === 0 &&
      prevUnionModelsRef.current.length > 1
    ) {
      // If store is empty but we have multiple items locally, reset to single empty item
      setUnionModels([{ id: '1', selectedModel: null }]);
    }
  }, [unionState.models, unionState.sources, basicFields.type, isUnionSource]);

  // Update ref whenever unionModels changes
  useEffect(() => {
    const currentItems = unionModels
      .map((um) => um.selectedModel?.value || '')
      .filter(Boolean);
    prevUnionModelsRef.current = currentItems;
  }, [unionModels]);

  // Update ModelStore when unionModels change
  useEffect(() => {
    if (!loading && unionModels.some((m) => m.selectedModel)) {
      const selectedItems = buildSelectedItems(unionModels);
      if (selectedItems.length > 0) {
        updateUnionState({
          type: (selectedType?.value as 'all') || 'all',
          ...(isUnionSource
            ? { sources: selectedItems, models: [] }
            : { models: selectedItems, sources: [] }),
        });
      }
    }
  }, [
    loading,
    unionModels,
    selectedType,
    updateUnionState,
    isUnionSource,
    buildSelectedItems,
  ]);

  const handleTypeChange = useCallback(
    (option: AvailableModel | null) => {
      setSelectedType(option);

      // Update ModelStore directly
      const selectedItems = buildSelectedItems(unionModels);
      updateUnionState({
        type: (option?.value as 'all') || 'all',
        ...(isUnionSource
          ? { sources: selectedItems, models: [] }
          : { models: selectedItems, sources: [] }),
      });
    },
    [unionModels, updateUnionState, isUnionSource, buildSelectedItems],
  );

  const handleModelChange = useCallback(
    (modelId: string, option: AvailableModel | null) => {
      setUnionModels((prev) => {
        const updatedModels = prev.map((um) =>
          um.id === modelId ? { ...um, selectedModel: option } : um,
        );

        // Update ModelStore directly with the updated models
        const selectedItems = buildSelectedItems(updatedModels);

        updateUnionState({
          type: (selectedType?.value as 'all') || 'all',
          ...(isUnionSource
            ? { sources: selectedItems, models: [] }
            : { models: selectedItems, sources: [] }),
        });

        return updatedModels;
      });
    },
    [selectedType, updateUnionState, isUnionSource, buildSelectedItems],
  );

  const handleAddModel = useCallback(() => {
    const newId = (unionModels.length + 1).toString();
    setUnionModels((prev) => [...prev, { id: newId, selectedModel: null }]);
  }, [unionModels.length]);

  const handleRemoveModel = useCallback(
    (modelId: string) => {
      if (unionModels.length > 1) {
        setUnionModels((prev) => {
          const filteredModels = prev.filter((um) => um.id !== modelId);

          // Update ModelStore immediately with the filtered models
          const selectedItems = buildSelectedItems(filteredModels);

          updateUnionState({
            type: (selectedType?.value as 'all') || 'all',
            ...(isUnionSource
              ? { sources: selectedItems, models: [] }
              : { models: selectedItems, sources: [] }),
          });

          return filteredModels;
        });
      }
    },
    [
      unionModels.length,
      selectedType,
      updateUnionState,
      isUnionSource,
      buildSelectedItems,
    ],
  );

  return (
    <div
      className="px-4 py-6 rounded-lg border-2 min-w-[400px] border-neutral bg-background shadow-lg"
      data-tutorial-id="union-node"
    >
      <div className="flex items-center mb-4">
        <Square3Stack3DIcon className="w-6 h-6 text-foreground mr-2" />
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">UNION</div>
        </div>
      </div>

      <div
        className="flex items-center justify-between mb-4"
        data-tutorial-id="union-type-select"
      >
        <div className="text-sm font-medium text-muted-foreground">Type</div>
        <div className="w-20">
          <SelectSingle
            label=""
            options={typeOptions}
            value={selectedType}
            onChange={handleTypeChange}
            placeholder="all"
            onBlur={() => {}}
            error={error || undefined}
            disabled={loading}
            className="w-full rounded-md border-0 bg-background h-8 py-1 pl-1 pr-8 text-background-contrast text-sm focus:ring-2 focus:ring-inset focus:ring-primary ring-[#D9D9D9] dark:ring-[#4A4A4A]"
          />
        </div>
      </div>

      <div className="border-t border-neutral mb-4"></div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {isUnionSource ? 'Select Source' : 'Select Model'}
        </div>

        {unionModels.map((unionModel) => (
          <div
            key={unionModel.id}
            className="flex items-center hover:bg-muted/50 rounded-md mx-2"
            data-tutorial-id="union-source-select"
          >
            <CircleStackIcon className="w-6 h-6 text-foreground mr-1" />
            <div className="flex-1">
              <SelectSingle
                label=""
                options={rowModelOptions[unionModel.id] || []}
                value={unionModel.selectedModel}
                onChange={(option) => handleModelChange(unionModel.id, option)}
                placeholder="Start typing the model name..."
                onBlur={() => {}}
                error={error || undefined}
                disabled={loading}
                className="w-full rounded-md border-0 bg-transparent h-8 py-1 pl-1 pr-16 text-background-contrast text-sm focus:ring-2 focus:ring-inset focus:ring-primary ring-[#D9D9D9] dark:ring-[#4A4A4A]"
              />
            </div>
            {unionModels.length > 1 && (
              <Button
                onClick={() => handleRemoveModel(unionModel.id)}
                className="ml-2 text-muted-foreground hover:text-foreground"
                label="x"
                variant="link"
              ></Button>
            )}
          </div>
        ))}
      </div>

      {/* Show error only if the active field (sources or models) is empty */}
      {(() => {
        const activeField = isUnionSource
          ? unionState.sources
          : unionState.models;
        // Show error if active field is missing or empty
        return !activeField || activeField.length === 0;
      })() && (
        <div className="mb-4">
          <ErrorMessage type="union_models" />
        </div>
      )}

      <div className="border-t border-neutral my-4"></div>

      <div className="flex justify-center">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            handleAddModel();
          }}
          variant="link"
          icon={<PlusIcon className="w-4 h-4 mr-1" />}
          label={isUnionSource ? 'Add Source' : 'Add Model'}
          className="flex items-center text-primary hover:text-primary/80 text-sm font-medium hover:bg-muted/50 rounded-md px-3 py-2"
          data-tutorial-id="add-union-source-button"
        ></Button>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
      />

      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
      />
    </div>
  );
};
