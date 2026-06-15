import { CircleStackIcon } from '@heroicons/react/24/outline';
import { Square3Stack3DIcon } from '@heroicons/react/24/solid';
import type { DbtProject } from '@shared/dbt/types';
import DataSearchIcon from '@web/assets/icons/data-search.svg?react';
import { useApp } from '@web/context';
import { Button, SelectSingle, Tooltip } from '@web/elements';
import { type SchemaSelect, useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import { isCteCapableType } from '@web/stores/utils';
import {
  filterAvailableModels,
  getUsedModelsForSelect,
} from '@web/utils/dataModeling';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ModelColumns } from '../components/ModelColumns';
import type {
  Column,
  SelectionSourceKind,
  SelectionType,
  SelectionTypeValues,
} from '../types';
import { ActionType, supportsColumnName, supportsExprOnly } from '../types';
import { extractColumnsFromNode } from '../utils/manifestColumns';
import { buildUpdatedSelections } from '../utils/selectionUtils';

export interface AvailableModel {
  label: string;
  value: string;
}

export type { Column };

export const SelectNode: React.FC<NodeProps> = ({ data: _data }) => {
  const { api } = useApp();

  const { modelingState, updateFromState, updateSelectState, basicFields } =
    useModelStore();
  // CTE awareness: surface CTE names in the FROM picker for CTE-capable
  // model types and resolve their columns from the analysis API rather than
  // the manifest (CTEs aren't in the manifest -- they live in the draft
  // model.json under `ctes`).
  const ctes = useModelStore((state) => state.ctes);
  const cteAnalysisColumns = useModelStore(
    (state) => state.cteAnalysis.columns,
  );
  // "Create CTE" shortcut: enable the CTE list action, seed a stub row,
  // and pop the editor open. Mirrors CteNode's empty-state Add CTE button
  // for users who haven't toggled the action via the side rail yet.
  const activeActions = useModelStore((state) => state.activeActions);
  const toggleAction = useModelStore((state) => state.toggleAction);
  const addCte = useModelStore((state) => state.addCte);
  const openCteEditor = useModelStore((state) => state.openCteEditor);

  // Tutorial integration
  const { isPlayTutorialActive } = useTutorialStore((state) => ({
    isPlayTutorialActive: state.isPlayTutorialActive,
  }));

  // Ref for programmatically opening dropdown in tutorial
  const selectWrapperRef = useRef<HTMLDivElement>(null);

  const isTypeSource =
    (basicFields.type as string) === 'stg_select_source' ||
    (basicFields.type as string) === 'stg_union_sources';

  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(
    null,
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [currentProject, setCurrentProject] = useState<DbtProject | null>(null);

  // Get list of already selected models to exclude from dropdown
  const usedModels = useMemo(
    () => getUsedModelsForSelect(modelingState),
    [modelingState],
  );

  const cteNames = useMemo(
    () => new Set(ctes.map((c) => c.name).filter(Boolean)),
    [ctes],
  );

  // Discriminates the upstream this SELECT is reading from. Sources are
  // hard-locked by model type; everything else picks between `model` and
  // `cte` based on whether the chosen identifier matches a draft CTE name.
  const sourceKind: SelectionSourceKind = useMemo(() => {
    if (isTypeSource) return 'source';
    if (selectedModel && cteNames.has(selectedModel.value)) return 'cte';
    return 'model';
  }, [isTypeSource, selectedModel, cteNames]);

  const modelOptions = useMemo(() => {
    const storedIdentifier = isTypeSource
      ? modelingState.from?.source
      : modelingState.from?.model || modelingState.from?.cte || undefined;

    const currentSelectedModel = selectedModel?.value || storedIdentifier;

    const currentSelections: string[] = currentSelectedModel
      ? [currentSelectedModel as string]
      : [];

    const baseOptions = filterAvailableModels(
      models,
      usedModels,
      currentSelections,
    );

    // CTEs only appear for non-source flows. Source-typed models can never
    // FROM a CTE (the schema rejects it; sources are upstream-only).
    if (isTypeSource) return baseOptions;

    // Prefix CTE labels so users can distinguish them at a glance from
    // manifest-resolved models. The value remains the bare CTE name so the
    // store sees a clean identifier.
    const cteOptions = ctes
      .filter((c) => Boolean(c.name))
      .map((c) => ({ label: `[CTE] ${c.name}`, value: c.name }));

    return [...cteOptions, ...baseOptions];
  }, [
    models,
    usedModels,
    selectedModel,
    isTypeSource,
    modelingState.from.model,
    modelingState.from.source,
    modelingState.from.cte,
    ctes,
  ]);

  // Memoize the default value - only depend on selectedModel, not modelingState.select
  // This prevents the defaultValue from changing when other components update the store
  const columnDefaultValue = useMemo(() => {
    if (selectedModel) {
      const modelType = basicFields.type;

      // For model types that support SchemaColumnName (plain strings),
      if (supportsColumnName(modelType)) {
        const modelColumnNames = columns.map((col) => col.name);
        const individualColumns = modelingState.select.filter(
          (s) => typeof s === 'string' && modelColumnNames.includes(s),
        ) as string[];

        if (individualColumns.length > 0) {
          return {
            filterType: '' as SelectionType, // Keep in individual mode
            include: individualColumns,
            exclude: undefined,
          };
        }
      }

      // For model types that support SchemaModelSelectExpr only,
      if (supportsExprOnly(modelType)) {
        const modelColumnNames = columns.map((col) => col.name);
        const exprColumns = modelingState.select.filter(
          (s) =>
            typeof s !== 'string' &&
            'name' in s &&
            'expr' in s &&
            modelColumnNames.includes(s.name) &&
            s.expr === s.name, // Only simple column references, not complex expressions
        ) as { name: string; expr: string }[];

        if (exprColumns.length > 0) {
          return {
            filterType: '' as SelectionType, // Keep in individual mode
            include: exprColumns.map((c) => c.name),
            exclude: undefined,
          };
        }
      }

      // Get the upstream-keyed selection (all_from_model, dims_from_cte, ...)
      // matching the chosen source. The lookup key depends on `sourceKind`
      // so CTE-shaped entries (`{ cte: 'pre_agg', type: 'dims_from_cte' }`)
      // are matched alongside model/source-shaped entries.
      const modelSelection = modelingState.select.find((s) => {
        if (typeof s === 'string') {
          return false;
        }

        let value: string | undefined;
        if (sourceKind === 'source') {
          value = 'source' in s ? s.source : undefined;
        } else if (sourceKind === 'cte') {
          value = 'cte' in s ? (s as { cte: string }).cte : undefined;
        } else {
          value = 'model' in s ? s.model : undefined;
        }
        return value === selectedModel.value;
      });

      if (modelSelection && typeof modelSelection !== 'string') {
        const result: {
          filterType: SelectionType;
          include?: string[];
          exclude?: string[];
        } = {
          filterType:
            (modelSelection.type as SelectionType) || ('' as SelectionType),
        };

        // Only add include if it has data
        if (
          'include' in modelSelection &&
          modelSelection.include &&
          modelSelection.include.length > 0
        ) {
          result.include = modelSelection.include;
        }

        // Only add exclude if it has data
        if (
          'exclude' in modelSelection &&
          modelSelection.exclude &&
          modelSelection.exclude.length > 0
        ) {
          result.exclude = modelSelection.exclude;
        }

        return result;
      }

      // Fallback: Check for individual column names (strings) that belong to THIS MODEL
      // This handles cases not covered by schema-aware checks above
      const modelColumnNames = columns.map((col) => col.name);
      const individualColumns = modelingState.select.filter(
        (s) => typeof s === 'string' && modelColumnNames.includes(s),
      ) as string[];

      if (individualColumns.length > 0) {
        return {
          filterType: '' as SelectionType,
          include: individualColumns,
          exclude: undefined,
        };
      }
    }
    return undefined;
  }, [
    selectedModel,
    isTypeSource,
    sourceKind,
    columns,
    modelingState.select,
    basicFields.type,
  ]);

  // Memoize the selection change handler to prevent unnecessary re-renders
  const handleSelectionChange = useCallback(
    (
      selectionType: SelectionType | '',
      selection: { include?: string[]; exclude?: string[] },
      shouldClear?: boolean,
    ) => {
      if (!selectedModel) {
        return;
      }

      const { basicFields, modelingState: ms } = useModelStore.getState();
      const hasJoins = Array.isArray(ms.join) ? ms.join.length > 0 : !!ms.join;
      const updated = buildUpdatedSelections(ms.select, {
        qualifier: hasJoins ? selectedModel.value : '',
        modelColumnNames: new Set(columns.map((c) => c.name)),
        modelType: basicFields.type,
        selectionType,
        selection,
        shouldClear: shouldClear ?? false,
        selectedModelValue: selectedModel.value,
        sourceKind,
        columns,
      });
      updateSelectState(updated);
    },
    [selectedModel, updateSelectState, sourceKind, columns],
  );

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setModelsLoading(true);
    try {
      let projects: DbtProject[] = [];

      const projectsResponse = await api.post({
        type: 'dbt-fetch-projects',
        request: null,
      });
      projects = projectsResponse || [];

      if (projects.length === 0) {
        setCurrentProject(null);
        setModels([]);
        return;
      }

      const project = projects[0];
      setCurrentProject(project);

      if (!project.manifest?.nodes) {
        setModels([]);
        return;
      }

      // Check if we should fetch sources or models based on model type
      if (isTypeSource) {
        // Fetch sources from manifest.nodes (filter by source.)
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

      setCurrentProject(null);
    } finally {
      setLoading(false);
      setModelsLoading(false);
    }
  }, [api, isTypeSource]);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  // Refresh CTE-sourced columns whenever the analysis API delivers a fresh
  // result for the currently-selected CTE. Manifest-sourced columns never
  // change without a project refresh, so we only re-derive in the CTE case.
  useEffect(() => {
    if (!selectedModel?.value || !cteNames.has(selectedModel.value)) return;
    const cteCols = cteAnalysisColumns[selectedModel.value] ?? [];
    setColumns(
      cteCols.map((c) => ({
        name: c.name,
        dataType: c.dataType ?? 'unknown',
        type: c.type === 'fct' ? 'fact' : 'dimension',
        description: c.description ?? '',
        modelName: selectedModel.value,
      })),
    );
  }, [cteAnalysisColumns, cteNames, selectedModel]);

  const handleModelChange = useCallback(
    (option: AvailableModel | null) => {
      // Store the previous model/source and its selection type to preserve it
      const previousModel = selectedModel?.value;
      let previousSelectionType: SelectionType | undefined;

      // Get the previous model's selection to preserve the filter type.
      // The previous upstream may have been keyed by `model`, `source`, or
      // `cte` -- the lookup needs to match all three so a CTE-to-model
      // switch still preserves the prior filterType.
      if (previousModel) {
        const currentSelections = useModelStore.getState().modelingState.select;
        const previousSelection = currentSelections.find(
          (existingSelection) => {
            if (typeof existingSelection !== 'string') {
              if (
                'model' in existingSelection &&
                existingSelection.model === previousModel
              )
                return true;
              if (
                'source' in existingSelection &&
                existingSelection.source === previousModel
              )
                return true;
              if (
                'cte' in existingSelection &&
                (existingSelection as { cte: string }).cte === previousModel
              )
                return true;
            }
            return false;
          },
        );

        if (previousSelection && typeof previousSelection !== 'string') {
          previousSelectionType = previousSelection.type as SelectionType;
        }

        // Remove the previous upstream's selection AND any bare string column
        // names (SchemaColumnName). Match on `model`/`source`/`cte` so a
        // CTE-shaped entry doesn't get orphaned when the user switches
        // upstream type.
        const filteredSelections = currentSelections.filter(
          (existingSelection) => {
            if (typeof existingSelection === 'string') {
              return false;
            }
            if (
              'model' in existingSelection ||
              'source' in existingSelection ||
              'cte' in existingSelection
            ) {
              const existingValue =
                'model' in existingSelection
                  ? existingSelection.model
                  : 'source' in existingSelection
                    ? existingSelection.source
                    : 'cte' in existingSelection
                      ? (existingSelection as { cte: string }).cte
                      : undefined;
              return existingValue !== previousModel;
            }
            return true;
          },
        );
        updateSelectState(filteredSelections);
      }

      setSelectedModel(option);

      if (!option?.value || !currentProject?.manifest) {
        setColumns([]);
        updateFromState({ model: '', source: '' });
        return;
      }

      // CTE branch: when the user picks a CTE, route through `from.cte`
      // and resolve columns from the analysis API. The manifest never
      // contains CTE columns since they live inside the draft model.json.
      if (cteNames.has(option.value)) {
        const cteCols = cteAnalysisColumns[option.value] ?? [];
        const projected: Column[] = cteCols.map((c) => ({
          name: c.name,
          dataType: c.dataType ?? 'unknown',
          type: c.type === 'fct' ? 'fact' : 'dimension',
          description: c.description ?? '',
          modelName: option.value,
        }));
        setColumns(projected);
        updateFromState({ model: '', source: '', cte: option.value });
        return;
      }

      const allColumns: Column[] = [];

      if (isTypeSource) {
        // Handle sources from manifest.sources
        if (!currentProject.manifest.sources) {
          setColumns([]);
          updateFromState({ model: '', source: option.value });
          return;
        }

        const sourceKey = Object.keys(currentProject.manifest.sources).find(
          (key) => {
            const source = currentProject.manifest.sources[key];
            if (
              !key.startsWith('source.') ||
              !source?.source_name ||
              !source?.name
            ) {
              return false;
            }
            const fullSourceName = `${source.source_name}.${source.name}`;
            return fullSourceName === option.value;
          },
        );

        if (sourceKey && currentProject.manifest.sources[sourceKey]) {
          allColumns.push(
            ...extractColumnsFromNode(
              currentProject.manifest.sources[sourceKey],
            ),
          );
        }

        setColumns(allColumns);
        // Update ModelStore with source
        updateFromState({ model: '', source: option.value });
      } else {
        // Handle models
        if (!currentProject.manifest.nodes) {
          setColumns([]);
          updateFromState({ model: '', source: '' });
          return;
        }

        const modelKey = Object.keys(currentProject.manifest.nodes).find(
          (key) => {
            const node = currentProject.manifest.nodes?.[key];
            return (
              (key.startsWith('model.') || key.startsWith('seed.')) &&
              node?.name === option.value
            );
          },
        );

        if (modelKey && currentProject.manifest.nodes[modelKey]) {
          allColumns.push(
            ...extractColumnsFromNode(currentProject.manifest.nodes[modelKey]),
          );
        }

        setColumns(allColumns);
        // Update ModelStore with model
        updateFromState({ model: option.value, source: '' });
      }

      // Apply the preserved filter type to the new upstream if it existed.
      // Pick the upstream key based on the new selection's kind so a switch
      // from model→CTE writes `{ cte, type }` rather than `{ model, type }`.
      if (option?.value && previousSelectionType) {
        const currentSelections = useModelStore.getState().modelingState.select;
        const newKind: SelectionSourceKind = isTypeSource
          ? 'source'
          : cteNames.has(option.value)
            ? 'cte'
            : 'model';

        const newSelection =
          newKind === 'source'
            ? {
                source: option.value,
                type: previousSelectionType as SelectionTypeValues,
              }
            : newKind === 'cte'
              ? {
                  cte: option.value,
                  type: previousSelectionType as SelectionTypeValues,
                }
              : {
                  model: option.value,
                  type: previousSelectionType as SelectionTypeValues,
                };

        updateSelectState([...currentSelections, newSelection as SchemaSelect]);
      }
      if (option?.value && !isTypeSource && dataExplorerOpenedRef.current) {
        api
          .post({
            type: 'data-explorer-open-with-model',
            request: {
              projectName: currentProject?.name || '',
              modelName: option.value,
            },
          })
          .catch(console.error);
      }
    },
    [
      api,
      currentProject,
      updateFromState,
      isTypeSource,
      selectedModel,
      updateSelectState,
    ],
  );

  // Use ref to track if we've already prepopulated to prevent infinite loops
  const hasPrefilledRef = useRef(false);

  // Track if Data Explorer has been opened for this component
  const dataExplorerOpenedRef = useRef(false);

  useEffect(() => {
    const identifierToUse = isTypeSource
      ? modelingState.from.source
      : modelingState.from.model || modelingState.from.cte;

    if (
      identifierToUse &&
      models.length > 0 &&
      !selectedModel &&
      !hasPrefilledRef.current
    ) {
      const prefilledOption = modelOptions.find(
        (option) => option.value === identifierToUse,
      );

      if (prefilledOption) {
        hasPrefilledRef.current = true;
        void handleModelChange(prefilledOption);
      }
    }
  }, [
    isTypeSource,
    modelingState.from.model,
    modelingState.from.source,
    modelingState.from.cte,
    models,
    modelOptions,
    selectedModel,
    handleModelChange,
  ]);

  // Symmetric reset: when the store's upstream identifier disappears (e.g.
  // the chosen CTE was removed and `removeCte` stripped `from.cte` via
  // visitCteRefs), drop the locally-cached `selectedModel` so the picker
  // re-renders empty instead of pointing at a vanished name. Clearing
  // `hasPrefilledRef` allows the prefill effect above to run again if the
  // user later re-points `from` to something else.
  useEffect(() => {
    const storedIdentifier = isTypeSource
      ? modelingState.from.source
      : modelingState.from.model || modelingState.from.cte;
    if (!storedIdentifier && selectedModel) {
      setSelectedModel(null);
      hasPrefilledRef.current = false;
    }
  }, [
    isTypeSource,
    modelingState.from.source,
    modelingState.from.model,
    modelingState.from.cte,
    selectedModel,
  ]);

  // Tutorial: Auto-open dropdown when tutorial highlights this node
  useEffect(() => {
    if (isPlayTutorialActive && selectWrapperRef.current && !selectedModel) {
      // Wait for Driver.js to highlight, then open dropdown
      const timer = setTimeout(() => {
        const selectControl = selectWrapperRef.current?.querySelector(
          '.react-select__control',
        );
        if (selectControl) {
          (selectControl as HTMLElement).click();
        }
      }, 800); // Wait for highlight animation

      return () => clearTimeout(timer);
    }
  }, [isPlayTutorialActive, selectedModel]);

  // Handler for opening Data Explorer with the selected model
  const handleOpenDataExplorer = useCallback(() => {
    if (!selectedModel || !currentProject) {
      return;
    }

    // Mark that Data Explorer has been opened
    dataExplorerOpenedRef.current = true;

    void api.post({
      type: 'data-explorer-open-with-model',
      request: {
        modelName: selectedModel.value,
        projectName: currentProject.name,
      },
    });
  }, [api, selectedModel, currentProject]);

  // Shortcut: enable the CTE list (idempotent if already enabled), seed a
  // stub `cte_N` row, and open the editor on it. The newly added CTE's
  // index is `ctes.length` (pre-add length). When the action is already
  // active, only the addCte + openCteEditor steps run -- the toggle would
  // disable it again.
  const cteCapable =
    typeof basicFields.type === 'string' && isCteCapableType(basicFields.type);
  const handleCreateCte = useCallback(() => {
    if (!activeActions.has(ActionType.CTE)) {
      toggleAction(ActionType.CTE);
    }
    const newIndex = ctes?.length || 0;
    addCte({
      name: `cte_${newIndex + 1}`,
      from: { model: '' },
    });
    openCteEditor(newIndex);
  }, [activeActions, toggleAction, addCte, openCteEditor, ctes]);

  // Handler for opening Column Lineage with a specific column
  const handleColumnLineageClick = useCallback(
    (columnName: string) => {
      if (!selectedModel || !currentProject?.manifest) {
        return;
      }

      // Find the model/source in manifest to get file path
      let relativePath: string | undefined;
      let tableName: string | undefined;

      if (isTypeSource) {
        // For sources, find in manifest.sources
        const sourceKey = Object.keys(
          currentProject.manifest.sources || {},
        ).find((key) => {
          const source = currentProject.manifest.sources[key];
          if (!source?.source_name || !source?.name) {
            return false;
          }
          const fullSourceName = `${source.source_name}.${source.name}`;
          return fullSourceName === selectedModel.value;
        });
        if (sourceKey) {
          const source = currentProject.manifest.sources[sourceKey];
          // original_file_path is a .yml file, convert to .source.json
          const originalPath = source?.original_file_path;
          if (originalPath) {
            relativePath = originalPath.replace(/\.yml$/, '.source.json');
          }
          tableName = source?.name; // Table name within the source
        }
      } else {
        // For models, find in manifest.nodes
        const modelKey = Object.keys(currentProject.manifest.nodes || {}).find(
          (key) => {
            const node = currentProject.manifest.nodes?.[key];
            return (
              (key.startsWith('model.') || key.startsWith('seed.')) &&
              node?.name === selectedModel.value
            );
          },
        );
        if (modelKey) {
          const node = currentProject.manifest.nodes[modelKey];
          // original_file_path is a .sql file, convert to .model.json
          const originalPath = node?.original_file_path;
          if (originalPath) {
            relativePath = originalPath.replace(/\.sql$/, '.model.json');
          }
        }
      }

      if (!relativePath) {
        console.warn('Could not find file path for column lineage');
        return;
      }

      // Construct absolute path by joining project pathSystem with relative path
      const absolutePath = `${currentProject.pathSystem}/${relativePath}`;

      if (isTypeSource && tableName) {
        // For sources, use switch-to-source-column action
        void api.post({
          type: 'framework-column-lineage',
          request: {
            action: 'switch-to-source-column',
            filePath: absolutePath,
            tableName,
            columnName,
            downstreamLevels: 2,
            skipOpenFile: true, // Don't open file when triggered from UI
          },
        });
      } else {
        // For models, use switch-to-model-column action
        void api.post({
          type: 'framework-column-lineage',
          request: {
            action: 'switch-to-model-column',
            filePath: absolutePath,
            columnName,
            upstreamLevels: 2,
            downstreamLevels: 2,
            skipOpenFile: true, // Don't open file when triggered from UI
          },
        });
      }
    },
    [api, selectedModel, currentProject, isTypeSource],
  );

  return (
    <div
      className={`flex flex-col gap-4 py-4 shadow-lg rounded-lg bg-background border-2 min-w-[400px] border-neutral`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-tutorial-id="select-node"
    >
      <div className="flex-1 px-4">
        <div className="flex items-center justify-between mb-2">
          <div className="webkit-font-smoothing-antialiased font-bold text-xs text-muted-foreground pl-1 flex items-center gap-1">
            {isTypeSource ? 'SELECT FROM SOURCE' : 'SELECT FROM'}
            <Tooltip
              content={
                isTypeSource
                  ? 'Choose a source table from your data warehouse to build your model from'
                  : 'Select an existing dbt model to build upon'
              }
              variant="outline"
            />
          </div>
          <div className="flex items-center gap-1">
            {cteCapable && !isTypeSource && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCreateCte();
                }}
                variant="outlineIconButton"
                label="CREATE CTE"
                icon={<Square3Stack3DIcon className="w-3 h-3" />}
                className="text-xs text-primary font-bold px-1 py-0.5"
              />
            )}
            {selectedModel && !isTypeSource && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenDataExplorer();
                }}
                disabled={!selectedModel}
                variant="iconButton"
                label="DATA EXPLORER"
                icon={<DataSearchIcon className="w-3 h-3" />}
                iconLabelClassName="text-xs"
                className="bg-primary text-white hover:text-white font-bold py-0.5 px-2"
              />
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-2 border border-neutral rounded pl-2"
          ref={selectWrapperRef}
        >
          <CircleStackIcon className="w-4 h-4 text-foreground flex-shrink-0" />
          {modelsLoading ? (
            <div className="text-sm text-muted-foreground py-1 pl-1 flex-1">
              Loading models...
            </div>
          ) : (
            <SelectSingle
              label=""
              options={modelOptions}
              value={selectedModel}
              onChange={(option) => {
                void handleModelChange(option);
              }}
              placeholder="Start typing the model name..."
              onBlur={() => {}}
              error={error || undefined}
              disabled={loading}
              className="w-full flex-1 bg-transparent h-8 py-1 pl-1 text-background-contrast text-sm ring-0 border-0 shadow-none focus:ring-0 focus:border-0 focus:outline-none"
            />
          )}
        </div>
      </div>

      {selectedModel && (
        <ModelColumns
          columns={columns}
          nodeId="1"
          sourceKind={sourceKind}
          onSelectionChange={handleSelectionChange}
          defaultValue={columnDefaultValue}
          onColumnLineageClick={handleColumnLineageClick}
        />
      )}

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
        className="bg-muted"
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
        className="bg-muted"
      />
    </div>
  );
};
