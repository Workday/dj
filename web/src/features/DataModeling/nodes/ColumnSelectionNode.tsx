import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { PlusIcon } from '@heroicons/react/20/solid';
import {
  Bars3Icon,
  Cog8ToothIcon,
  CogIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { DbtProject } from '@shared/dbt/types';
import LineageIcon from '@web/assets/icons/lineage.svg?react';
import { useApp } from '@web/context/useApp';
import { Button, Checkbox, DialogBox, Popover, Tooltip } from '@web/elements';
import { DataModelingGuideStep } from '@web/features/Tutorial/config/assistMe/assistSteps';
import { type SchemaSelect, useModelStore } from '@web/stores/useModelStore';
import {
  TutorialComponentState,
  useTutorialStore,
} from '@web/stores/useTutorialStore';
import { isGroupByAllowedType } from '@web/stores/utils';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AddColumnBasic } from '../components/AddColumnBasic';
import { ColumnDetails } from '../components/ColumnDetails';
import DataTypeBadge from '../components/DataTypeBadge';
import { ErrorMessage } from '../components/ErrorMessage';
import { ActionType } from '../types';

interface Column {
  name: string;
  dataType: string;
  type: 'dimension' | 'fact';
  description?: string;
  modelName: string;
}

export const ColumnSelectionNode: React.FC<NodeProps> = () => {
  const { api } = useApp();
  const {
    modelingState,
    basicFields,
    groupBy,
    setGroupByDimensions,
    setGroupByColumns,
    isActionActive,
    toggleAction,
    setShowColumnConfiguration,
    editingColumn,
    setEditingColumn,
    updateSelectState,
    setNavigationNodeType,
    showAddColumnModal,
    setShowAddColumnModal,
  } = useModelStore();

  // Tutorial store integration - NEW: Use enum-based state
  const {
    isPlayTutorialActive,
    currentComponentState,
    assistModeEnabled,
    currentAssistStepIndex,
    moveToAssistStep,
    setDataModelingGuideStep,
  } = useTutorialStore((state) => ({
    isPlayTutorialActive: state.isPlayTutorialActive,
    currentComponentState: state.currentComponentState,
    assistModeEnabled: state.assistModeEnabled,
    currentAssistStepIndex: state.currentAssistStepIndex,
    moveToAssistStep: state.moveToAssistStep,
    setDataModelingGuideStep: state.setDataModelingGuideStep,
  }));

  const [searchTerm, setSearchTerm] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentProject, setCurrentProject] = useState<DbtProject | null>(null);
  const [expandedColumnIndex, setExpandedColumnIndex] = useState<number | null>(
    null,
  );

  // CTE awareness: when a select item is `*_from_cte` we resolve columns
  // from the analysis API rather than the manifest, since CTE columns
  // aren't materialized into manifest.json until the model syncs.
  const cteAnalysisColumns = useModelStore(
    (state) => state.cteAnalysis.columns,
  );

  // NEW: Check enum state instead of boolean flag (for Play Tutorial)
  const isAddColumnModalOpen =
    currentComponentState === TutorialComponentState.ADD_COLUMN_MODAL_OPEN ||
    currentComponentState === TutorialComponentState.ADD_COLUMN_TYPE ||
    currentComponentState === TutorialComponentState.ADD_COLUMN_NAME ||
    currentComponentState === TutorialComponentState.ADD_COLUMN_DATATYPE ||
    currentComponentState === TutorialComponentState.ADD_COLUMN_DESCRIPTION ||
    currentComponentState === TutorialComponentState.ADD_COLUMN_EXPRESSION;

  // Use OR logic: Show if EITHER tutorial mode OR normal mode wants to show
  const shouldShowAddColumnBasic = isPlayTutorialActive
    ? isAddColumnModalOpen
    : showAddColumnModal;

  // For expanded column index, tutorial mode doesn't need it anymore with enum state
  const effectiveExpandedColumnIndex = expandedColumnIndex;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [columnToDelete, setColumnToDelete] = useState<Column | null>(null);

  const columnsContainerRef = useRef<HTMLDivElement>(null);
  const previousColumnsLengthRef = useRef<number>(0);

  // Close AddColumnBasic when editingColumn is set
  useEffect(() => {
    if (editingColumn) {
      setShowAddColumnModal(false);
    }
  }, [editingColumn, setShowAddColumnModal]);

  // Auto-trigger ADD_COLUMN_MODAL guide when modal opens in assist mode
  useEffect(() => {
    const isAssistActive = assistModeEnabled || currentAssistStepIndex > 0;
    if (shouldShowAddColumnBasic && isAssistActive && !isPlayTutorialActive) {
      // Small delay to allow modal to render
      const timer = setTimeout(() => {
        setDataModelingGuideStep(DataModelingGuideStep.ADD_COLUMN_MODAL);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [
    shouldShowAddColumnBasic,
    assistModeEnabled,
    currentAssistStepIndex,
    isPlayTutorialActive,
    setDataModelingGuideStep,
  ]);

  // Scroll to end when new derived column is added
  useEffect(() => {
    const derivedColumns = columns.filter(
      (col) => col.modelName === 'Derived Column',
    );
    const currentDerivedCount = derivedColumns.length;

    // Check if a new derived column was added
    if (
      currentDerivedCount > 0 &&
      columns.length > previousColumnsLengthRef.current
    ) {
      // Scroll to bottom
      if (columnsContainerRef.current) {
        columnsContainerRef.current.scrollTo({
          top: columnsContainerRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
    }

    // Update previous length
    previousColumnsLengthRef.current = columns.length;
  }, [columns]);

  // Check if groupBy is allowed for the current model type
  const isGroupByAllowed = useMemo(
    () => isGroupByAllowedType(basicFields.type),
    [basicFields.type],
  );

  // Check if Add Column Manually is allowed (not allowed for rollup)
  const isAddColumnAllowed = useMemo(
    () => basicFields.type !== 'int_rollup_model',
    [basicFields.type],
  );

  // Fetch project data similar to SelectNode pattern
  const fetchProjectData = useCallback(async () => {
    if (!basicFields.projectName) {
      setCurrentProject(null);
      return;
    }

    try {
      const projects = await api.post({
        type: 'dbt-fetch-projects',
        request: null,
      });

      const project = projects.find(
        (p: DbtProject) => p.name === basicFields.projectName,
      );
      setCurrentProject(project || null);
    } catch (error) {
      console.error('Error fetching project data:', error);
      setCurrentProject(null);
    }
  }, [api, basicFields.projectName]);

  // Fetch project data when projectName changes
  useEffect(() => {
    void fetchProjectData();
  }, [fetchProjectData]);

  // Fetch columns based on modelingState.select configuration
  const fetchColumnsFromSelect = useCallback(() => {
    if (
      !currentProject?.manifest?.nodes ||
      !modelingState.select ||
      modelingState.select.length === 0
    ) {
      setColumns([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const allColumns: Column[] = [];

      // Iterate through each select item
      for (const selectItem of modelingState.select) {
        // Skip string column names and expr-based columns - they're handled separately below
        if (typeof selectItem === 'string') {
          continue;
        }

        // Type guard: only process model/source/cte selection items (not expr-based columns)
        if (
          !(
            'model' in selectItem ||
            'source' in selectItem ||
            'cte' in selectItem
          )
        ) {
          continue;
        }

        const selectionType =
          'type' in selectItem ? selectItem.type : undefined;

        // CTE bulk-select branch (`all_from_cte` / `dims_from_cte` /
        // `fcts_from_cte`). Pull the upstream CTE's columns from the
        // analysis API and apply the same type filter + include/exclude
        // logic as the model branch below.
        if ('cte' in selectItem && typeof selectItem.cte === 'string') {
          const cteName = selectItem.cte;
          const include: string[] =
            'include' in selectItem && selectItem.include
              ? (selectItem.include as string[])
              : [];
          const exclude: string[] =
            'exclude' in selectItem && selectItem.exclude
              ? (selectItem.exclude as string[])
              : [];
          const cteCols = cteAnalysisColumns[cteName] ?? [];
          let cteColumns: Column[] = cteCols.map((c) => ({
            name: c.name,
            dataType: c.dataType ?? 'string',
            type: c.type === 'fct' ? 'fact' : 'dimension',
            description: c.description ?? '',
            modelName: cteName,
          }));
          // selectionType isn't narrowed to the CTE bulk variants in the
          // SchemaSelect union because `cte` items live in a separate
          // schema-level branch -- compare via string to bridge the gap.
          const selTypeStr = (selectionType as string | undefined) ?? '';
          if (selTypeStr === 'dims_from_cte') {
            cteColumns = cteColumns.filter((c) => c.type === 'dimension');
          } else if (selTypeStr === 'fcts_from_cte') {
            cteColumns = cteColumns.filter((c) => c.type === 'fact');
          }
          if (include.length > 0) {
            cteColumns = cteColumns.filter((c) => include.includes(c.name));
          } else if (exclude.length > 0) {
            cteColumns = cteColumns.filter((c) => !exclude.includes(c.name));
          }
          allColumns.push(...cteColumns);
          continue;
        }

        const modelName =
          ('model' in selectItem ? selectItem.model : undefined) ||
          ('source' in selectItem ? selectItem.source : undefined);
        const include: string[] =
          'include' in selectItem && selectItem.include
            ? (selectItem.include as string[])
            : [];
        const exclude: string[] =
          'exclude' in selectItem && selectItem.exclude
            ? (selectItem.exclude as string[])
            : [];

        if (!modelName) continue;

        const columns: Column[] = [];

        // Check if this is a source type selection
        const isSourceType = selectionType?.includes('_from_source');

        if (isSourceType) {
          // Handle source columns
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
              return fullSourceName === modelName;
            },
          );

          if (sourceKey) {
            const sourceNode = currentProject.manifest.sources[sourceKey];
            if (sourceNode?.columns) {
              // Extract all columns from the source
              Object.entries(sourceNode.columns).forEach(
                ([columnName, columnData]) => {
                  const columnInfo = columnData as {
                    data_type?: string;
                    description?: string;
                    meta?: { type?: string };
                  };

                  const columnType: 'dimension' | 'fact' =
                    columnInfo.meta?.type === 'fct' ? 'fact' : 'dimension';

                  columns.push({
                    name: columnName,
                    dataType: columnInfo.data_type || 'string',
                    type: columnType,
                    description: columnInfo.description || '',
                    modelName: modelName,
                  });
                },
              );
            }
          }
        } else {
          // Handle model columns (existing logic)
          const modelKey = Object.keys(currentProject.manifest.nodes).find(
            (key) => key.includes(modelName),
          );

          if (modelKey) {
            const modelNode = currentProject.manifest.nodes[modelKey];
            if (modelNode?.columns) {
              // Extract all columns from the model
              Object.entries(modelNode.columns).forEach(
                ([columnName, columnData]) => {
                  const columnInfo = columnData as {
                    data_type?: string;
                    description?: string;
                    meta?: { type?: string };
                  };

                  const columnType: 'dimension' | 'fact' =
                    columnInfo.meta?.type === 'fct' ? 'fact' : 'dimension';

                  columns.push({
                    name: columnName,
                    dataType: columnInfo.data_type || 'string',
                    type: columnType,
                    description: columnInfo.description || '',
                    modelName: modelName,
                  });
                },
              );
            }
          }
        }

        // Filter by selection type
        let filteredByType = columns;
        switch (selectionType) {
          case 'dims_from_model':
            filteredByType = columns.filter((col) => col.type === 'dimension');
            break;
          case 'fcts_from_model':
            filteredByType = columns.filter((col) => col.type === 'fact');
            break;
          case 'all_from_model':
          case 'all_from_source':
          default:
            filteredByType = columns;
            break;
        }

        // Apply include/exclude logic
        let finalColumns = filteredByType;
        if (include.length > 0) {
          // If include is present, only fetch those columns
          finalColumns = filteredByType.filter((col) =>
            include.includes(col.name),
          );
        } else if (exclude.length > 0) {
          // If exclude is present, fetch all columns except excluded ones
          finalColumns = filteredByType.filter(
            (col) => !exclude.includes(col.name),
          );
        }

        // If no include and no exclude, use all columns based on type
        allColumns.push(...finalColumns);
      }

      // Add manually added columns (expr-based columns, model-reference columns, and string column names)
      for (const selectItem of modelingState.select) {
        // Process string column names (SchemaColumnName)
        if (typeof selectItem === 'string') {
          const stringColumn: Column = {
            name: selectItem,
            dataType: '',
            type: 'dimension', // Default to dimension
            description: '',
            modelName: '', // Empty model name for string column names
          };
          allColumns.push(stringColumn);
        }
        // Process model-reference columns (SchemaModelSelectModelWithAgg, SchemaModelSelectModel)
        // These have both 'model' AND 'name' properties, unlike model selection types (all_from_model, etc.)
        else if (
          'name' in selectItem &&
          'model' in selectItem &&
          // Exclude model selection types (all_from_model, dims_from_model, fcts_from_model)
          ![
            'all_from_model',
            'dims_from_model',
            'fcts_from_model',
            'all_from_source',
          ].includes(
            ('type' in selectItem ? (selectItem.type as string) : '') || '',
          )
        ) {
          const modelRefColumn: Column = {
            name: selectItem.name,
            dataType:
              ('data_type' in selectItem
                ? (selectItem.data_type as string)
                : undefined) || 'Unknown',
            type:
              'type' in selectItem && selectItem.type === 'fct'
                ? 'fact'
                : 'dimension',
            description:
              ('description' in selectItem
                ? (selectItem.description as string)
                : undefined) || 'NA',
            modelName: 'Derived Column', // Indicate it's manually added (model-reference)
          };
          allColumns.push(modelRefColumn);
        }
        // Process all column selections with 'name' property but without 'model'
        // This includes: expr-based, interval-based columns, etc.
        // Exclude model/source selections (which have 'model' or 'source' instead of 'name')
        else if (
          'name' in selectItem &&
          !('model' in selectItem) &&
          !('source' in selectItem)
        ) {
          const manualColumn: Column = {
            name: selectItem.name,
            dataType:
              ('data_type' in selectItem
                ? (selectItem.data_type as string)
                : undefined) || 'Unknown',
            type:
              'type' in selectItem && selectItem.type === 'fct'
                ? 'fact'
                : 'dimension',
            description:
              ('description' in selectItem
                ? (selectItem.description as string)
                : undefined) || 'NA',
            modelName: 'Derived Column', // Indicate it's manually added
          };
          allColumns.push(manualColumn);
        }
      }

      // Remove duplicates with priority:
      // 1. Derived columns (with expr) take precedence over string columns
      // 2. Model-based columns take precedence over empty modelName
      const uniqueColumns = allColumns.filter((column, index, self) => {
        // Find all columns with the same name & same type
        const sameNameColumns = self.filter(
          (c) => c.name === column.name && c.type === column.type,
        );

        // If there's only one column with this name, keep it
        if (sameNameColumns.length === 1) {
          return true;
        }

        // If there are multiple columns with the same name:
        // - Keep derived columns (modelName === 'Derived Column') over string columns (modelName === '')
        // - Keep the first occurrence if they have the same modelName
        const hasDerivedColumn = sameNameColumns.some(
          (c) => c.modelName === 'Derived Column',
        );

        if (hasDerivedColumn) {
          // If this is a derived column, keep it
          if (column.modelName === 'Derived Column') {
            return (
              index ===
              self.findIndex(
                (c) =>
                  c.name === column.name && c.modelName === 'Derived Column',
              )
            );
          }
          // If this is not a derived column but a derived column exists with same name, skip it
          return false;
        }

        // Default deduplication: keep first occurrence based on modelName and name
        return (
          index ===
          self.findIndex(
            (c) => c.modelName === column.modelName && c.name === column.name,
          )
        );
      });

      setColumns(uniqueColumns);
    } catch (error) {
      console.error('Error fetching columns:', error);
      setColumns([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject, modelingState.select, cteAnalysisColumns]);

  // Fetch columns when modelingState.select changes
  useEffect(() => {
    fetchColumnsFromSelect();
  }, [fetchColumnsFromSelect]);

  // Filter columns based on search term
  const filteredColumns = useMemo(() => {
    if (!searchTerm) return columns;
    return columns.filter(
      (column) =>
        column.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        column.modelName.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [columns, searchTerm]);

  // Determine if there are any dimension columns in the current filtered set (or full set if needed)
  const hasDimensions = useMemo(
    () => columns.some((c) => c.type === 'dimension'),
    [columns],
  );

  // Check if any of the selected models are seeds with missing columns
  const seedWarning = useMemo(() => {
    if (!currentProject?.manifest?.nodes || columns.length > 0) {
      return null;
    }

    // Check if we have model selections that reference seeds
    for (const selectItem of modelingState.select || []) {
      if (typeof selectItem !== 'object' || !selectItem) continue;
      if (!('model' in selectItem) || !('type' in selectItem)) continue;

      const modelName = selectItem.model;
      if (!modelName) continue;

      // Check if this model is a seed
      const seedKey = `seed.${currentProject.name}.${modelName}`;
      const seedNode = currentProject.manifest.nodes[seedKey];

      if (seedNode && seedNode.resource_type === 'seed') {
        // Check if the seed has no columns defined
        if (!seedNode.columns || Object.keys(seedNode.columns).length === 0) {
          return `The seed "${modelName}" has no columns defined in the manifest. Please define columns in seeds.yml or _seeds.yml and run "dbt parse" to refresh the manifest.`;
        }
      }
    }

    return null;
  }, [currentProject, columns, modelingState.select]);

  // Handler for group by dimensions checkbox
  const handleGroupByDimensionsChange = useCallback(
    (checked: boolean) => {
      setGroupByDimensions(checked);
      if (checked && !isActionActive(ActionType.GROUPBY)) {
        toggleAction(ActionType.GROUPBY);
      }
    },
    [setGroupByDimensions, isActionActive, toggleAction],
  );

  // Handler for individual column group by checkbox
  const handleColumnGroupByChange = useCallback(
    (columnName: string, checked: boolean) => {
      let newColumns: string[];

      if (checked) {
        // Add column and sort by original table order
        newColumns = [...groupBy.columns, columnName];
      } else {
        // Remove column
        newColumns = groupBy.columns.filter((col) => col !== columnName);
      }

      // Sort columns to match the order they appear in the table
      const sortedColumns = newColumns.sort((a, b) => {
        const indexA = columns.findIndex((col) => col.name === a);
        const indexB = columns.findIndex((col) => col.name === b);
        return indexA - indexB;
      });

      setGroupByColumns(sortedColumns);

      // Toggle action bar if adding first column-level group by
      if (
        checked &&
        sortedColumns.length === 1 &&
        !groupBy.dimensions &&
        !isActionActive(ActionType.GROUPBY)
      ) {
        toggleAction(ActionType.GROUPBY);
      }
    },
    [
      groupBy.columns,
      groupBy.dimensions,
      setGroupByColumns,
      columns,
      isActionActive,
      toggleAction,
    ],
  );

  // Handler for configure button click
  const handleConfigureColumn = useCallback(
    (column: Column) => {
      // Find the column in modelingState.select
      const selectItem = modelingState.select.find(
        (item) =>
          typeof item !== 'string' &&
          'name' in item &&
          item.name === column.name,
      );

      if (selectItem) {
        // Set as editing column and show configuration
        setEditingColumn(selectItem, column.name);
        setShowColumnConfiguration(true);
        // Navigate to ColumnConfigurationNode
        setNavigationNodeType('columnConfigurationNode');

        // If assist mode is active OR assist tutorial is running, automatically move to the column-configuration-overview step
        const isAssistActive = assistModeEnabled || currentAssistStepIndex > 0;
        if (isAssistActive) {
          // Small delay to allow navigation
          setTimeout(() => {
            moveToAssistStep('column-configuration-overview');
          }, 1000);
        }
      }
    },

    [
      modelingState.select,
      setEditingColumn,
      setShowColumnConfiguration,
      setNavigationNodeType,
      assistModeEnabled,
      currentAssistStepIndex,
      moveToAssistStep,
    ],
  );

  // Handler for requesting column deletion
  const handleRequestColumnDeletion = useCallback((column: Column) => {
    setColumnToDelete(column);
    setShowDeleteConfirm(true);
  }, []);

  // Handler for opening Column Lineage with a specific column
  const handleColumnLineageClick = useCallback(
    (column: Column) => {
      if (!currentProject?.manifest) return;

      // For derived columns, use the current model being created
      // For columns from other models, find the source model in manifest
      let relativePath: string | undefined;
      let isSource = false;
      let tableName: string | undefined;

      if (column.modelName === 'Derived Column') {
        // For derived columns, we don't have a source model yet
        // Skip column lineage for derived columns
        console.warn('Column lineage is not available for derived columns');
        return;
      }

      // Find the model in manifest to get file path
      const modelKey = Object.keys(currentProject.manifest.nodes || {}).find(
        (key) => {
          const node = currentProject.manifest.nodes?.[key];
          return (
            (key.startsWith('model.') || key.startsWith('seed.')) &&
            node?.name === column.modelName
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

      // Also check sources
      if (!relativePath) {
        const sourceKey = Object.keys(
          currentProject.manifest.sources || {},
        ).find((key) => {
          const source = currentProject.manifest.sources[key];
          if (!source?.source_name || !source?.name) return false;
          const fullSourceName = `${source.source_name}.${source.name}`;
          return fullSourceName === column.modelName;
        });
        if (sourceKey) {
          const source = currentProject.manifest.sources[sourceKey];
          // original_file_path is a .yml file, convert to .source.json
          const originalPath = source?.original_file_path;
          if (originalPath) {
            relativePath = originalPath.replace(/\.yml$/, '.source.json');
          }
          isSource = true;
          tableName = source?.name; // Table name within the source
        }
      }

      if (!relativePath) {
        console.warn('Could not find file path for column lineage');
        return;
      }

      // Construct absolute path by joining project pathSystem with relative path
      const absolutePath = `${currentProject.pathSystem}/${relativePath}`;

      if (isSource && tableName) {
        // For sources, use switch-to-source-column action
        void api.post({
          type: 'framework-column-lineage',
          request: {
            action: 'switch-to-source-column',
            filePath: absolutePath,
            tableName,
            columnName: column.name,
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
            columnName: column.name,
            upstreamLevels: 2,
            downstreamLevels: 2,
            skipOpenFile: true, // Don't open file when triggered from UI
          },
        });
      }
    },
    [api, currentProject],
  );

  // Handler for confirming column deletion
  const handleConfirmColumnDeletion = useCallback(() => {
    if (columnToDelete) {
      // Remove the column from modelingState.select
      const updatedSelect = modelingState.select.filter((item) => {
        // Filter out the matching column
        if (typeof item === 'string') {
          return item !== columnToDelete.name;
        }
        if (typeof item === 'object' && item !== null && 'name' in item) {
          return item.name !== columnToDelete.name;
        }
        return true;
      });

      // Update the store
      updateSelectState(updatedSelect);

      // If the deleted column is currently being edited, close the configuration panel
      if (
        editingColumn &&
        'name' in editingColumn &&
        editingColumn.name === columnToDelete.name
      ) {
        setShowColumnConfiguration(false);
        setEditingColumn(null);
        setNavigationNodeType('columnSelectionNode');
      }
    }
    setShowDeleteConfirm(false);
    setColumnToDelete(null);
  }, [
    columnToDelete,
    modelingState.select,
    updateSelectState,
    editingColumn,
    setShowColumnConfiguration,
    setEditingColumn,
    setNavigationNodeType,
  ]);

  // Handler for canceling column deletion
  const handleCancelColumnDeletion = useCallback(() => {
    setShowDeleteConfirm(false);
    setColumnToDelete(null);
  }, []);

  // Handler for row click to toggle details
  const handleRowClick = useCallback((index: number) => {
    setExpandedColumnIndex((prev) => (prev === index ? null : index));
  }, []);

  // Handler for drag and drop reordering
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;

      const sourceIndex = result.source.index;
      const destinationIndex = result.destination.index;

      if (sourceIndex === destinationIndex) return;

      // Get current select array
      const currentSelect = [...modelingState.select];

      // Remove the dragged item
      const [removed] = currentSelect.splice(sourceIndex, 1);

      // Insert at new position
      currentSelect.splice(destinationIndex, 0, removed);

      // Update the store
      updateSelectState(currentSelect);
    },
    [modelingState.select, updateSelectState],
  );

  // Helper to determine if a select item is draggable
  const isDraggable = useCallback((selectItem: unknown): boolean => {
    // String column names are draggable
    if (typeof selectItem === 'string') {
      return true;
    }

    // Expr-based columns (derived columns) are draggable
    if (
      typeof selectItem === 'object' &&
      selectItem !== null &&
      'expr' in selectItem
    ) {
      return true;
    }

    // Group columns (model/source selections) are NOT draggable
    if (
      typeof selectItem === 'object' &&
      selectItem !== null &&
      ('model' in selectItem || 'source' in selectItem)
    ) {
      return false;
    }

    return false;
  }, []);

  return (
    <div
      className="bg-background border-2 border-neutral rounded-lg shadow-lg w-[900px] max-w-[1100px] cursor-default nopan"
      data-tutorial-id="column-selection-node"
    >
      <Handle type="target" position={Position.Top} id="input" />

      <Handle type="source" position={Position.Right} id="right-output" />

      <div className="flex flex-col gap-4 p-6">
        <h3 className="text-lg font-semibold text-foreground">
          Column Selection
        </h3>

        <div className="bg-message-info rounded-lg p-3">
          <div className="flex items-start gap-2">
            <InformationCircleIcon className="w-5 h-5 text-message-info-contrast flex-shrink-0 mt-0.5" />
            <p className="text-sm text-message-info-contrast leading-relaxed">
              This view shows the columns that will be in your final output
              based on the selection in previous steps of the data pipeline. You
              can add and configure columns manually and choose which columns to
              group by.
            </p>
          </div>
        </div>

        {/* group by and search input */}
        <div className="flex items-center gap-2 justify-between">
          <div
            className="flex items-center gap-2"
            data-tutorial-id="group-by-dimensions-checkbox"
          >
            <Checkbox
              checked={isGroupByAllowed && groupBy.dimensions}
              onChange={(checked) => {
                const isChecked =
                  typeof checked === 'boolean'
                    ? checked
                    : checked.target.checked;
                handleGroupByDimensionsChange(isChecked);

                // Show guide if assist mode is enabled OR assist tutorial is running
                const isAssistActive =
                  assistModeEnabled || currentAssistStepIndex > 0;
                if (isAssistActive && !isPlayTutorialActive) {
                  setDataModelingGuideStep(
                    DataModelingGuideStep.GROUP_BY_DIMENSIONS,
                  );
                }
              }}
              label=""
              id="group-by-dimensions"
              disabled={!isGroupByAllowed || !hasDimensions}
            />
            <div className="flex flex-col gap-1">
              <label
                className={`text-sm ${!isGroupByAllowed ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground cursor-pointer'}`}
                htmlFor="group-by-dimensions"
              >
                Group by dimensions
              </label>
              <p className="text-xs text-muted-foreground">
                {!isGroupByAllowed
                  ? 'Group by is not available for this model type'
                  : !hasDimensions
                    ? 'Group by requires at least one dimension column'
                    : 'This would disable the group by option in individual columns'}
              </p>
            </div>
          </div>
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search columns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-neutral rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        {/* Seed warning message */}
        {seedWarning && (
          <ErrorMessage
            type="model_name"
            message={seedWarning}
            variant="warning"
            className="p-3 mb-2"
          />
        )}

        {/* Table */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading columns...
          </div>
        ) : filteredColumns.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchTerm
              ? 'No columns found matching your search.'
              : 'No columns selected.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg relative">
            <div className="grid grid-cols-[2fr_1fr_1.5fr_auto] border-b border-neutral">
              <div className="px-4 py-3 text-sm font-medium text-foreground">
                Column
              </div>
              <div className="px-4 py-3 text-sm font-medium text-foreground">
                Data Type
              </div>
              <div className="px-4 py-3 text-sm font-medium text-foreground">
                Description
              </div>
              <div className="px-4 py-3 text-sm font-medium text-foreground text-right min-w-[180px]">
                Actions
              </div>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="columns-list">
                {(provided) => (
                  <div
                    ref={(el) => {
                      provided.innerRef(el);
                      if (columnsContainerRef.current !== el) {
                        (
                          columnsContainerRef as React.MutableRefObject<HTMLDivElement | null>
                        ).current = el;
                      }
                    }}
                    {...provided.droppableProps}
                    className="mt-2 max-h-[400px] overflow-y-auto flex flex-col gap-2 relative react-flow__node-scrollable"
                    style={{ overflow: 'auto' }}
                  >
                    {filteredColumns.map((column, displayIndex) => {
                      const isExpanded =
                        effectiveExpandedColumnIndex === displayIndex;
                      const selectItem = modelingState.select.find(
                        (item) =>
                          typeof item !== 'string' &&
                          'name' in item &&
                          item.name === column.name,
                      );

                      // Find the actual select item and its index in the select array
                      let actualSelectItem: SchemaSelect | undefined;
                      let selectIndex = -1;

                      for (let i = 0; i < modelingState.select.length; i++) {
                        const item = modelingState.select[i];
                        if (typeof item === 'string' && item === column.name) {
                          actualSelectItem = item;
                          selectIndex = i;
                          break;
                        }
                        if (
                          typeof item === 'object' &&
                          item !== null &&
                          'name' in item &&
                          item.name === column.name
                        ) {
                          actualSelectItem = item;
                          selectIndex = i;
                          break;
                        }
                      }

                      const canDrag = actualSelectItem
                        ? isDraggable(actualSelectItem)
                        : false;

                      // Generate stable ID based on column content
                      let stableId: string;
                      if (typeof actualSelectItem === 'string') {
                        stableId = `col-string-${actualSelectItem as string}`;
                      } else if (
                        actualSelectItem &&
                        typeof actualSelectItem === 'object' &&
                        'name' in actualSelectItem &&
                        typeof actualSelectItem.name === 'string'
                      ) {
                        stableId = `col-expr-${actualSelectItem.name}`;
                      } else {
                        stableId = `col-model-${column.modelName}-${column.name}`;
                      }

                      return (
                        <Draggable
                          key={stableId}
                          draggableId={stableId}
                          index={selectIndex >= 0 ? selectIndex : displayIndex}
                          isDragDisabled={!canDrag}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`rounded-lg relative select-none ${
                                snapshot.isDragging
                                  ? 'bg-transparent'
                                  : 'border border-neutral bg-background'
                              }`}
                              style={{
                                ...provided.draggableProps.style,
                              }}
                            >
                              {/* Simplified view when dragging */}
                              {snapshot.isDragging ? (
                                <div
                                  className={`flex items-center gap-2 py-2 overflow-hidden ${canDrag ? 'pl-2 pr-2' : 'px-2'} min-h-[50px]`}
                                >
                                  {/* Drag handle */}
                                  {canDrag && (
                                    <div
                                      {...provided.dragHandleProps}
                                      className="cursor-grabbing select-none flex-shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      <Bars3Icon className="w-4 h-4 text-muted-foreground pointer-events-none" />
                                    </div>
                                  )}
                                  {/* Column name only */}
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {column.name}
                                  </span>

                                  {/* Column name only */}
                                  <span className="text-sm font-medium text-foreground truncate">
                                    {column.description}
                                  </span>
                                </div>
                              ) : (
                                /* Full view when not dragging */
                                <div
                                  className="grid grid-cols-[2fr_1fr_1.5fr_auto] hover:bg-surface/50 gap-2 cursor-pointer transition-colors"
                                  onClick={() => handleRowClick(displayIndex)}
                                >
                                  {/* Drag handle - only show for draggable items and when not expanded */}
                                  {canDrag && !isExpanded && (
                                    <div
                                      {...provided.dragHandleProps}
                                      className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing select-none"
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                    >
                                      <Bars3Icon className="w-4 h-4 text-muted-foreground hover:text-foreground pointer-events-none" />
                                    </div>
                                  )}

                                  {/* column */}
                                  <div
                                    className={`px-2 py-2 flex gap-2 ${canDrag && !isExpanded ? 'pl-8' : ''}`}
                                  >
                                    {column.dataType && (
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                                            column.type === 'fact'
                                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                          }`}
                                        >
                                          {column.type === 'fact'
                                            ? 'fct'
                                            : 'dim'}
                                        </span>
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                                      <div
                                        className="text-sm font-medium text-foreground truncate"
                                        title={column.name}
                                      >
                                        {column.name}
                                      </div>
                                      <div
                                        className="text-xs text-muted-foreground truncate mt-1"
                                        title={column.modelName}
                                      >
                                        {column.modelName}
                                      </div>
                                    </div>
                                  </div>

                                  {/* data type */}
                                  <div className="px-2 py-2 flex flex-col items-start justify-center">
                                    <DataTypeBadge
                                      dataType={column.dataType || 'NA'}
                                      className="text-sm text-foreground"
                                    />
                                  </div>

                                  {/* description */}
                                  <div className="px-2 py-2 overflow-hidden flex flex-col items-start justify-center">
                                    <p
                                      className="text-sm text-foreground line-clamp-2 hover:line-clamp-none"
                                      title={
                                        column.description ||
                                        'No description available'
                                      }
                                    >
                                      {column.description ||
                                        'No description available'}
                                    </p>
                                  </div>

                                  {/* actions */}
                                  <div
                                    className="flex items-center justify-end px-2 py-2 gap-2 min-w-[180px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Tooltip
                                      content={
                                        column.type === 'fact'
                                          ? 'Only dimensions can be grouped'
                                          : !isGroupByAllowed
                                            ? 'Group by not available for this model type'
                                            : groupBy.dimensions
                                              ? 'Using "Group by dimensions" option'
                                              : 'Group by this column'
                                      }
                                    >
                                      <Checkbox
                                        checked={groupBy.columns.includes(
                                          column.name,
                                        )}
                                        onChange={(checked) => {
                                          const isChecked =
                                            typeof checked === 'boolean'
                                              ? checked
                                              : checked.target.checked;
                                          handleColumnGroupByChange(
                                            column.name,
                                            isChecked,
                                          );
                                        }}
                                        label="Group By"
                                        disabled={
                                          !isGroupByAllowed ||
                                          groupBy.dimensions ||
                                          column.type === 'fact'
                                        }
                                        id={`group-by-${column.name}`}
                                      />
                                    </Tooltip>

                                    {/* Popover for Derived Columns */}
                                    {column.modelName === 'Derived Column' ? (
                                      <Popover
                                        trigger={
                                          <Cog8ToothIcon className="h-4 w-4" />
                                        }
                                        anchor="bottom end"
                                        panelClassName="w-48"
                                      >
                                        {(close) => (
                                          <div className="py-1">
                                            <Button
                                              label="Configure Column"
                                              icon={
                                                <CogIcon className="h-4 w-4" />
                                              }
                                              variant="iconButton"
                                              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface flex items-center gap-2 justify-start"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleConfigureColumn(column);
                                                close();

                                                // Show guide if assist mode is enabled OR assist tutorial is running
                                                const isAssistActive =
                                                  assistModeEnabled ||
                                                  currentAssistStepIndex > 0;
                                                if (
                                                  isAssistActive &&
                                                  !isPlayTutorialActive
                                                ) {
                                                  setTimeout(() => {
                                                    setDataModelingGuideStep(
                                                      DataModelingGuideStep.COLUMN_CONFIGURATION,
                                                    );
                                                  }, 500);
                                                }
                                              }}
                                            />
                                            <Button
                                              label="Delete Column"
                                              icon={
                                                <TrashIcon className="h-4 w-4" />
                                              }
                                              variant="iconButton"
                                              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2 justify-start"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRequestColumnDeletion(
                                                  column,
                                                );
                                                close();
                                              }}
                                            />
                                          </div>
                                        )}
                                      </Popover>
                                    ) : (
                                      /* Configure button for non-Derived Columns */
                                      <Button
                                        label=""
                                        disabled={true}
                                        className="cursor-not-allowed"
                                        icon={
                                          <Cog8ToothIcon className="h-4 w-4" />
                                        }
                                        variant="iconButton"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                        }}
                                      />
                                    )}

                                    {/* Column Lineage button - disabled for Derived Columns */}
                                    <Tooltip
                                      content={
                                        column.modelName === 'Derived Column'
                                          ? 'Column lineage is not available for derived columns'
                                          : 'View column lineage'
                                      }
                                    >
                                      <Button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            column.modelName !==
                                            'Derived Column'
                                          ) {
                                            handleColumnLineageClick(column);
                                          }
                                        }}
                                        variant="iconButton"
                                        label=""
                                        disabled={
                                          column.modelName === 'Derived Column'
                                        }
                                        icon={
                                          <LineageIcon className="w-4 h-4 [&_g]:stroke-current" />
                                        }
                                        className={`p-1 ${
                                          column.modelName === 'Derived Column'
                                            ? 'text-muted-foreground/50 cursor-not-allowed'
                                            : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                      />
                                    </Tooltip>
                                  </div>
                                </div>
                              )}

                              {/* Expanded Column Details - only show when not dragging */}
                              {!snapshot.isDragging &&
                                isExpanded &&
                                selectItem && (
                                  <ColumnDetails
                                    selectItem={
                                      selectItem as Record<string, unknown>
                                    }
                                  />
                                )}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        )}
      </div>

      {shouldShowAddColumnBasic && !editingColumn && isAddColumnAllowed && (
        <AddColumnBasic
          onConfigure={() => {
            setShowColumnConfiguration(true);
            setNavigationNodeType('columnConfigurationNode');

            // For Assist Mode: Show column configuration guide
            const isAssistActive =
              assistModeEnabled || currentAssistStepIndex > 0;
            if (isAssistActive && !isPlayTutorialActive) {
              // Small delay to let the column configuration node render
              setTimeout(() => {
                setDataModelingGuideStep(
                  DataModelingGuideStep.COLUMN_CONFIGURATION,
                );
              }, 500);
            }
          }}
          onCancel={() => {
            if (!isPlayTutorialActive) {
              setShowAddColumnModal(false);
            }
          }}
          onConfirm={() => {
            if (!isPlayTutorialActive) {
              setShowAddColumnModal(false);
            }
          }}
        />
      )}

      {!shouldShowAddColumnBasic && !editingColumn && isAddColumnAllowed && (
        <div className="border-t border-neutral p-4 text-center flex justify-center bg-surface">
          <Button
            className="text-lg font-semibold text-foreground"
            icon={<PlusIcon className="h-4 w-4" />}
            variant="iconButton"
            label="Add Columns Manually"
            onClick={() => {
              if (!isPlayTutorialActive) {
                setShowAddColumnModal(true);

                // If assist mode is active OR assist tutorial is running, show the add-column-button guide first
                const isAssistActive =
                  assistModeEnabled || currentAssistStepIndex > 0;
                if (isAssistActive) {
                  setDataModelingGuideStep(
                    DataModelingGuideStep.ADD_COLUMN_BUTTON,
                  );
                }
              }
              // If tutorial is active, do nothing - tutorial controls this
            }}
            data-tutorial-id="add-column-button"
          />
        </div>
      )}

      {/* Confirmation Dialog for Column Deletion */}
      <DialogBox
        open={showDeleteConfirm}
        title="Delete Column"
        caption={`Are you sure you want to delete the column "${columnToDelete?.name}"?`}
        confirmCTALabel="Delete"
        discardCTALabel="Cancel"
        onConfirm={handleConfirmColumnDeletion}
        onDiscard={handleCancelColumnDeletion}
      />

      <Handle type="source" position={Position.Bottom} id="output" />
    </div>
  );
};
