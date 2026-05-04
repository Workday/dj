import type { DbtProject } from '@shared/dbt/types';
import {
  DEFAULT_INCREMENTAL_STRATEGY,
  GROUP_BY_DIMS,
  normalizeGroupBy,
} from '@shared/framework/constants';
import type {
  FrameworkInterval,
  FrameworkModel,
} from '@shared/framework/types';
import type { SchemaLightdashMetric } from '@shared/schema/types/lightdash.metric.schema';
import type { SchemaModelGroupBy } from '@shared/schema/types/model.group_by.schema';
import type { SchemaModelLightdash } from '@shared/schema/types/model.lightdash.schema';
import type { SchemaModelMaterialized } from '@shared/schema/types/model.materialized.schema';
import type {
  IncrementalStrategy,
  ModelSqlHooksSchemaJson,
  SchemaModelPartitionedBy,
} from '@shared/schema/types/model.schema';
// Import proper schema types for select
import type {
  SchemaModelSelectCol,
  SchemaModelSelectExpr,
  SchemaModelSelectExprWithAgg,
  SchemaModelSelectInterval,
  SchemaModelSelectModel,
  SchemaModelSelectModelWithAgg,
  SchemaModelSelectSource,
} from '@shared/schema/types/model.schema';
import type { SchemaModelFromJoinColumn } from '@shared/schema/types/model.type.int_join_column.schema';
import type { SchemaModelFromJoinModels } from '@shared/schema/types/model.type.int_join_models.schema';
import type { SchemaModelWhere } from '@shared/schema/types/model.where.schema';
import type { GroupByStoreSpec } from '@web/features/DataModeling/actionRegistry';
import {
  DEFAULT_GROUP_BY_STATE,
  resetActionState,
} from '@web/features/DataModeling/actionRegistry';
import { ActionType } from '@web/features/DataModeling/types';
import type { Edge, Node } from '@xyflow/react';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { stateSync } from '../utils/stateSync';
import {
  buildFromObject,
  buildJoinConfig,
  buildLightdashConfig,
  buildSelectConfig,
  buildTransformationConfigs,
  isCteCapableType,
  isGroupByAllowedType,
} from './utils';

// Union type for all possible select configurations
export type SchemaSelect =
  | SchemaModelSelectCol
  | SchemaModelSelectExpr
  | SchemaModelSelectExprWithAgg
  | SchemaModelSelectModel
  | SchemaModelSelectModelWithAgg
  | SchemaModelSelectSource
  | SchemaModelSelectInterval;

// Extend SchemaLightdashMetric to include the optional UI-specific id property
export type LightdashMetricWithId = SchemaLightdashMetric & {
  id: string;
};

// Extend SchemaModelFromJoinModels to include UI-specific _uuid property
export type JoinWithUUID = SchemaModelFromJoinModels[0] & {
  _uuid?: string;
};

// Union type for different join structures
export type JoinState =
  | SchemaModelFromJoinModels
  | SchemaModelFromJoinColumn
  | null;

/** UI state for a single CTE definition within the model editor */
export type CteState = {
  name: string;
  from: { model: string } | { cte: string } | Record<string, unknown>;
  select?: unknown[];
  where?: unknown;
  group_by?: unknown;
  having?: unknown;
};

// ModelStore state structure
export interface ModelingStateAdapter {
  from: Record<string, unknown>;
  join: JoinState;
  rollup: {
    interval: FrameworkInterval | '';
    dateExpression: string;
  };
  lookback: {
    days: number;
    exclude_event_date?: boolean;
  };
  union: {
    type?: 'all';
    models: string[];
    sources?: string[];
  };
  select: SchemaSelect[];
  lightdash?: SchemaModelLightdash;
}

export interface AdditionalFieldsSchema {
  description?: string;
  tags?: string[];
  incremental_strategy?: IncrementalStrategy;
  sql_hooks?: ModelSqlHooksSchemaJson;
  partitioned_by?: SchemaModelPartitionedBy;
  exclude_daily_filter?: boolean;
  exclude_date_filter?: boolean;
  exclude_portal_partition_columns?: boolean;
  exclude_portal_source_count?: boolean;
}

// Comprehensive type that includes basic fields, modeling state, and action properties
export type ModelingStateType = {
  name: string;
  group: string;
  topic: string;
  type: FrameworkModel['type'] | '';
  materialized?: SchemaModelMaterialized;
  projectName: string;
  source?: string;
} & ModelingStateAdapter & {
    where?: SchemaModelWhere;
    group_by?: SchemaModelGroupBy;
    [key: string]: unknown; // Allow dynamic property access
  };

// Store Interface
export interface ModelStore {
  isPreviewEnabled: boolean;
  togglePreview: (show: boolean) => void;
  isMinimapVisible: boolean;
  toggleMinimap: (show: boolean) => void;

  basicFields: {
    name: string;
    group: string;
    topic: string;
    type: FrameworkModel['type'] | '';
    materialized?: SchemaModelMaterialized;
    //description?: string;
    projectName: string;
    source?: string;
  };

  // Edit mode specific field - stored separately from basicFields
  // This is used for API calls but not included in the model JSON
  originalModelPath?: string;

  // Original file contents for diff view in edit mode
  originalFiles: {
    json: string;
    sql: string;
    yaml: string;
  } | null;

  // Form type and mode for auto-save functionality
  formType: string;
  mode: 'create' | 'edit';
  autoSaveEnabled: boolean;

  // Initialization flag to track if data has been loaded
  isInitialized: boolean;

  // Internal state for managing saves
  _saveQueue: Map<string, unknown>;
  _saveTimeout: NodeJS.Timeout | null;

  modelingState: ModelingStateAdapter;

  // Optional action state management
  activeActions: Set<ActionType>;
  pendingRemovalAction: ActionType | null;
  setPendingRemovalAction: (action: ActionType | null) => void;

  // Optional action data - NOT part of the ModelingStateAdapter to avoid layout rerendering
  // Having custom state for groupBy to avoid circular rerendering between GroupByNode and ColumnSelectionNode
  groupBy: GroupByStoreSpec;
  where: SchemaModelWhere | null;
  // lightdash?: SchemaModelLightdash;

  additionalFields: AdditionalFieldsSchema;

  /** Default incremental strategy from extension settings, fetched via preferences API */
  defaultIncrementalStrategy: string | undefined;

  // Data modeling specific state
  dataModeling: {
    currentProject: DbtProject | null;
    nodeId: number;
    nodes: Node[];
    edges: Edge[];
  };

  // Actions
  setBasicField: (
    field: keyof ModelStore['basicFields'],
    value: string,
  ) => void;
  setOriginalModelPath: (path: string) => void;
  setOriginalFiles: (
    files: {
      json: string;
      sql: string;
      yaml: string;
    } | null,
  ) => void;
  setModelingState: (updates: Partial<ModelingStateAdapter>) => void;
  setNodeId: (nodeId: number) => void;

  // Form type and mode management
  setFormType: (formType: string) => void;
  setMode: (mode: 'create' | 'edit') => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  initializeFormContext: (mode: 'create' | 'edit', formType?: string) => void;

  // Initialization management
  setIsInitialized: (isInitialized: boolean) => void;
  loadInitialData: (data: Partial<ModelingStateType>) => void;

  // Centralized save field function
  saveField: (field: string, value: unknown) => Promise<void>;

  // Internal save management
  _flushSaveQueue: () => Promise<void>;
  _cleanup: () => void;

  // Node-specific actions
  updateFromState: (fromData: {
    model: string;
    source: string;
    cte?: string;
  }) => void;
  updateJoinState: (joinData: JoinState) => void;
  updateRollupState: (rollupData: {
    interval: FrameworkInterval | '';
    dateExpression: string;
  }) => void;
  updateLookbackState: (lookbackData: {
    days: number;
    exclude_event_date?: boolean;
  }) => void;
  updateUnionState: (unionData: {
    type?: 'all';
    models?: string[];
    sources?: string[];
  }) => void;
  updateSelectState: (selectData: ModelingStateAdapter['select']) => void;

  setWhereState: (whereData: SchemaModelWhere | null) => void;

  setGroupByState: (groupByData: SchemaModelGroupBy | null) => void;
  setGroupByDimensions: (dimensions: boolean) => void;
  setGroupByColumns: (columns: string[]) => void;
  setGroupByExpressions: (expressions: string[]) => void;
  clearGroupByState: () => void;

  updateLightdashState: (lightdashData: SchemaModelLightdash) => void;

  // Optional actions management
  isActionActive: (action: ActionType) => boolean;
  toggleAction: (action: ActionType) => void;

  setAdditionalField: (
    field: keyof AdditionalFieldsSchema,
    value: AdditionalFieldsSchema[keyof AdditionalFieldsSchema],
  ) => void;

  // Data modeling visual actions (for React Flow)
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;

  // Navigation management for validation errors
  navigationNodeType: string | null;
  setNavigationNodeType: (nodeType: string | null) => void;

  // Column Configuration Node visibility
  showColumnConfiguration: boolean;
  setShowColumnConfiguration: (show: boolean) => void;

  // Add Column Modal visibility
  showAddColumnModal: boolean;
  setShowAddColumnModal: (show: boolean) => void;

  // Currently editing column (for Configure flow)
  editingColumn: Partial<SchemaSelect> | null;
  editingColumnOriginalName: string | null;
  setEditingColumn: (
    column: Partial<SchemaSelect> | null,
    originalName?: string | null,
  ) => void;

  setDefaultIncrementalStrategy: (strategy: string) => void;

  // CTE state and actions
  ctes: CteState[];
  addCte: (cte: CteState) => void;
  updateCte: (index: number, cte: CteState) => void;
  removeCte: (index: number) => void;
  moveCte: (fromIndex: number, toIndex: number) => void;

  // Utility actions
  reset: () => void;
  buildModelJson: () => Partial<FrameworkModel>;
}

// Initial State
const initialBasicFields = {
  name: '',
  group: '',
  topic: '',
  type: '' as FrameworkModel['type'] | '',
  materialized: undefined,
  //description: '',
  projectName: '',
  source: '',
};

export const initialJoin: JoinWithUUID[] = [
  {
    model: '',
    type: 'left' as const,
    on: {
      and: [],
    },
    _uuid: uuidv4(),
  },
];

export const initialModelingState: ModelingStateAdapter = {
  from: { model: '', source: '' },
  join: initialJoin as SchemaModelFromJoinModels,
  rollup: { interval: '', dateExpression: '' },
  lookback: { days: 0, exclude_event_date: false },
  union: { type: 'all', models: [], sources: [] },
  select: [],
  // metrics_include and metrics_exclude intentionally omitted (undefined).
  // An explicit [] means "block inheritance" and is only set when loaded
  // from model data, so we can distinguish it from "never set."
  lightdash: {
    table: {
      group_label: '',
      label: '',
    },
    metrics: [],
  },
};

const initialDataModeling = {
  currentProject: null,
  nodeId: 2,
  nodes: [],
  edges: [],
};

const initialAdditionalFields: AdditionalFieldsSchema = {
  description: '',
  tags: [],
  incremental_strategy: undefined,
  sql_hooks: undefined,
  partitioned_by: undefined,
  exclude_daily_filter: undefined,
  exclude_date_filter: undefined,
  exclude_portal_partition_columns: undefined,
  exclude_portal_source_count: undefined,
};

// Store Implementation
export const useModelStore = create<ModelStore>()(
  subscribeWithSelector((set, get) => ({
    // State
    isPreviewEnabled: true,
    isMinimapVisible: false,
    basicFields: initialBasicFields,
    originalModelPath: undefined,
    originalFiles: null,
    formType: 'model-create',
    mode: 'create' as const,
    autoSaveEnabled: true,
    isInitialized: false,
    _saveQueue: new Map<string, unknown>(),
    _saveTimeout: null,
    modelingState: initialModelingState,
    activeActions: new Set<ActionType>(),
    pendingRemovalAction: null,
    groupBy: DEFAULT_GROUP_BY_STATE,
    where: null,
    dataModeling: initialDataModeling,
    additionalFields: initialAdditionalFields,
    defaultIncrementalStrategy: undefined,
    navigationNodeType: null,
    showColumnConfiguration: false,
    showAddColumnModal: false,
    editingColumn: null,
    editingColumnOriginalName: null,
    ctes: [],

    // Actions
    togglePreview: (show: boolean) => {
      set(() => ({
        isPreviewEnabled: show,
      }));
    },

    toggleMinimap: (show: boolean) => {
      set(() => ({
        isMinimapVisible: show,
      }));
    },

    setBasicField: (field, value) =>
      set((state) => {
        const newBasicFields = { ...state.basicFields, [field]: value };
        let newModelingState = state.modelingState;
        let newGroupBy = state.groupBy;
        let newActiveActions = state.activeActions;
        let newAdditionalFields = state.additionalFields;
        let newCtes = state.ctes;

        // Auto-initialize join state when model type is set to a join type
        if (
          field === 'type' &&
          typeof value === 'string' &&
          value.includes('join')
        ) {
          // Only initialize if join is currently null/empty
          const currentJoin = state.modelingState.join;
          const shouldInitialize =
            !currentJoin ||
            (Array.isArray(currentJoin) && currentJoin.length === 0);

          if (shouldInitialize) {
            if (value === 'int_join_column') {
              // Initialize with cross_join_unnest structure
              newModelingState = {
                ...state.modelingState,
                join: {
                  type: 'cross_join_unnest' as const,
                  column: '',
                  fields: [''] as [string, ...string[]],
                } as SchemaModelFromJoinColumn,
              };
            } else {
              // Initialize with regular join structure
              const defaultJoin = {
                model: '',
                type: 'left' as const,
                on: {
                  and: [],
                },
                _uuid: uuidv4(),
              };

              newModelingState = {
                ...state.modelingState,
                join: [defaultJoin] as SchemaModelFromJoinModels,
              };
            }
          }
        }

        // Clear CTEs when switching to a non-CTE-capable model type
        if (
          field === 'type' &&
          typeof value === 'string' &&
          !isCteCapableType(value) &&
          state.ctes.length > 0
        ) {
          newCtes = [];
          setTimeout(() => {
            void get().saveField('ctes', null);
          }, 0);
        }

        // Clear group by state when model type changes to one that doesn't support it
        if (field === 'type' && typeof value === 'string') {
          if (!isGroupByAllowedType(value)) {
            newGroupBy = DEFAULT_GROUP_BY_STATE;
            // Remove GROUPBY action from activeActions
            newActiveActions = new Set(state.activeActions);
            newActiveActions.delete(ActionType.GROUPBY);
            // Schedule save of cleared group by
            setTimeout(() => {
              void get().saveField('group_by', null);
            }, 0);
          }
          const isMartModelType = [
            'mart_select_model',
            'mart_join_models',
          ].includes(value);

          const isExcludeDailyFilterAvailable = !(
            ['stg_select_source', 'stg_union_sources'].includes(value) ||
            isMartModelType
          );

          // Clear exclude_daily_filter for types that don't support it
          if (!isExcludeDailyFilterAvailable) {
            if (state.additionalFields.exclude_daily_filter !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                exclude_daily_filter: undefined,
              };
              // Also schedule save for persistence
              setTimeout(() => {
                void get().saveField('exclude_daily_filter', null);
              }, 0);
            }
          }

          if (isMartModelType) {
            // Clear exclude_date_filter for mart models
            if (state.additionalFields.exclude_date_filter !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                exclude_date_filter: undefined,
              };
              // Also schedule save for persistence
              setTimeout(() => {
                void get().saveField('exclude_date_filter', null);
              }, 0);
            }

            // Clear incremental_strategy for mart models
            if (state.additionalFields.incremental_strategy !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                incremental_strategy: undefined,
              };
              setTimeout(() => {
                void get().saveField('incremental_strategy', null);
              }, 0);
            }

            // Clear sql_hooks for mart models
            if (state.additionalFields.sql_hooks !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                sql_hooks: undefined,
              };
              setTimeout(() => {
                void get().saveField('sql_hooks', null);
              }, 0);
            }

            // Clear partitioned_by for mart models
            if (state.additionalFields.partitioned_by !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                partitioned_by: undefined,
              };
              setTimeout(() => {
                void get().saveField('partitioned_by', null);
              }, 0);
            }

            // Clear materialized for mart models (they don't support it)
            if (newBasicFields.materialized !== undefined) {
              newBasicFields.materialized = undefined;
              setTimeout(() => {
                void get().saveField('materialized', null);
              }, 0);
            }

            // Set default tags for mart models in create mode only
            // In edit mode, keep existing tags as is
            if (state.mode === 'create') {
              const currentTags = state.additionalFields.tags;
              // Only set defaults if tags are empty/undefined (first time setting type)
              if (!currentTags || currentTags.length === 0) {
                const defaultTags = ['lightdash', 'lightdash-explore'];
                newAdditionalFields = {
                  ...newAdditionalFields,
                  tags: defaultTags,
                };
                setTimeout(() => {
                  void get().saveField('tags', defaultTags);
                }, 0);
              }
            }
          }
        }

        // Handle materialized changes: manage default pre-hooks and clear incremental fields
        if (field === 'materialized') {
          const defaultPreHook =
            "set session iterative_optimizer_timeout='60m'; set session query_max_planning_time='60m'";

          if (value === 'incremental') {
            // Add default pre-hook if not already present
            const currentSqlHooks = state.additionalFields.sql_hooks;
            const currentPreHook = currentSqlHooks?.pre;

            let newPreHookValue: string | [string, ...string[]] | undefined;

            if (currentPreHook) {
              // Check if default hook already exists
              const currentHooksArray = Array.isArray(currentPreHook)
                ? currentPreHook
                : [currentPreHook];

              const hasDefaultHook = currentHooksArray.includes(defaultPreHook);

              if (!hasDefaultHook) {
                // Add default hook to existing hooks
                const updatedHooks = [...currentHooksArray, defaultPreHook];
                newPreHookValue =
                  updatedHooks.length === 1
                    ? updatedHooks[0]
                    : (updatedHooks as [string, ...string[]]);
              } else {
                // Default hook already exists, keep current value
                newPreHookValue = currentPreHook;
              }
            } else {
              // No existing hooks, set as string (not array)
              newPreHookValue = defaultPreHook;
            }

            newAdditionalFields = {
              ...newAdditionalFields,
              sql_hooks: {
                ...currentSqlHooks,
                pre: newPreHookValue,
              },
            };
            setTimeout(() => {
              void get().saveField('sql_hooks', newAdditionalFields.sql_hooks);
            }, 0);

            // Preselect default incremental strategy from store state (fetched via preferences API)
            if (!state.additionalFields.incremental_strategy?.type) {
              const defaultStrategy =
                state.defaultIncrementalStrategy ??
                DEFAULT_INCREMENTAL_STRATEGY;
              const defaultIncrementalStrategy = {
                type: defaultStrategy,
              } as IncrementalStrategy;
              newAdditionalFields = {
                ...newAdditionalFields,
                incremental_strategy: defaultIncrementalStrategy,
              };
              setTimeout(() => {
                void get().saveField(
                  'incremental_strategy',
                  defaultIncrementalStrategy,
                );
              }, 0);
            }
          } else {
            // Remove default pre-hook when changing away from incremental
            const currentSqlHooks = state.additionalFields.sql_hooks;
            if (currentSqlHooks?.pre) {
              const currentPreHook = currentSqlHooks.pre;

              // Filter out default pre-hook from current hooks
              let filteredHooks: string | [string, ...string[]] | undefined;
              if (Array.isArray(currentPreHook)) {
                const filteredHooksArray = currentPreHook.filter(
                  (hook) => hook !== defaultPreHook,
                );
                if (filteredHooksArray.length === 0) {
                  filteredHooks = undefined;
                } else {
                  filteredHooks = filteredHooksArray as [string, ...string[]];
                }
              } else if (currentPreHook === defaultPreHook) {
                filteredHooks = undefined;
              } else {
                filteredHooks = [currentPreHook] as [string, ...string[]];
              }

              newAdditionalFields = {
                ...newAdditionalFields,
                sql_hooks: {
                  ...currentSqlHooks,
                  pre: filteredHooks,
                },
              };
              setTimeout(() => {
                void get().saveField(
                  'sql_hooks',
                  newAdditionalFields.sql_hooks,
                );
              }, 0);
            }
          }

          // Clear incremental_strategy and partitioned_by when not 'incremental'
          if (value !== 'incremental') {
            if (state.additionalFields.incremental_strategy !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                incremental_strategy: undefined,
              };
              setTimeout(() => {
                void get().saveField('incremental_strategy', null);
              }, 0);
            }
            if (state.additionalFields.partitioned_by !== undefined) {
              newAdditionalFields = {
                ...newAdditionalFields,
                partitioned_by: undefined,
              };
              setTimeout(() => {
                void get().saveField('partitioned_by', null);
              }, 0);
            }
          }
        }

        return {
          basicFields: newBasicFields,
          modelingState: newModelingState,
          groupBy: newGroupBy,
          activeActions: newActiveActions,
          additionalFields: newAdditionalFields,
          ctes: newCtes,
        };
      }),

    setOriginalModelPath: (path) =>
      set(() => ({
        originalModelPath: path,
      })),

    setOriginalFiles: (files) =>
      set(() => ({
        originalFiles: files,
      })),

    setModelingState: (updates) =>
      set((state) => ({
        modelingState: { ...state.modelingState, ...updates },
      })),

    setNodeId: (nodeId) =>
      set((state) => ({
        dataModeling: { ...state.dataModeling, nodeId },
      })),

    // Form type and mode management
    setFormType: (formType) =>
      set(() => ({
        formType,
      })),

    setMode: (mode) =>
      set(() => ({
        mode,
      })),

    setAutoSaveEnabled: (enabled) =>
      set(() => ({
        autoSaveEnabled: enabled,
      })),

    initializeFormContext: (mode, formType) =>
      set(() => ({
        mode,
        formType:
          formType ||
          (mode === 'create' ? 'model-create' : 'framework-model-update'),
      })),

    // Initialization management
    setIsInitialized: (isInitialized) =>
      set(() => ({
        isInitialized,
      })),

    loadInitialData: (data: Partial<ModelingStateType>) => {
      const state = get();

      // Load basic fields
      if (data.name !== undefined) state.setBasicField('name', data.name);
      if (data.group !== undefined) state.setBasicField('group', data.group);
      if (data.topic !== undefined) state.setBasicField('topic', data.topic);
      if (data.type !== undefined) state.setBasicField('type', data.type);
      if (data.materialized !== undefined)
        state.setBasicField('materialized', data.materialized as string);
      if (data.projectName !== undefined)
        state.setBasicField('projectName', data.projectName);
      if (data.source !== undefined) state.setBasicField('source', data.source);

      // Load original model path for edit mode
      if (data.originalModelPath) {
        state.setOriginalModelPath(data.originalModelPath as string);
      }

      // Handle modeling state with proper transformations
      // Check if we have 'from' data with nested structures that need extraction
      const fromData = data.from || {};
      const hasFrom = fromData.model || fromData.source || fromData.cte;

      if (hasFrom) {
        state.updateFromState({
          model: (fromData.model as string) || '',
          source: (fromData.source as string) || '',
          cte: (fromData.cte as string) || '',
        });

        // Handle join data - could be nested in from.join or at data.join
        const joinData = (fromData.join || data.join) as JoinState;
        if (joinData) {
          state.updateJoinState(joinData);
        }

        // Handle rollup data - extract from from.rollup
        if (fromData.rollup && typeof fromData.rollup === 'object') {
          const rollupObj = fromData.rollup as {
            interval?: FrameworkInterval | '';
            datetime_expr?: string;
          };
          state.updateRollupState({
            interval: rollupObj.interval || '',
            dateExpression: rollupObj.datetime_expr || '',
          });
        } else if (data.rollup) {
          // Fallback to data.rollup if exists
          state.updateRollupState({
            interval: data.rollup.interval || '',
            dateExpression: data.rollup.dateExpression || '',
          });
        }

        // Handle lookback data - extract from from.lookback
        if (fromData.lookback && typeof fromData.lookback === 'object') {
          const lookbackObj = fromData.lookback as {
            days?: number;
            exclude_event_date?: boolean;
          };
          state.updateLookbackState({
            days: lookbackObj.days || 0,
            exclude_event_date: lookbackObj.exclude_event_date,
          });
        } else if (data.lookback) {
          // Fallback to data.lookback if exists
          state.updateLookbackState({
            days: data.lookback.days || 0,
            exclude_event_date: data.lookback.exclude_event_date,
          });
        }

        // Handle union data - extract from from.union
        if (fromData.union && typeof fromData.union === 'object') {
          const unionObj = fromData.union as {
            type?: 'all';
            models?: string[];
            sources?: string[];
          };
          state.updateUnionState({
            type: unionObj.type,
            models: unionObj.models || [],
            sources: unionObj.sources || [],
          });
        } else if (data.union) {
          // Fallback to data.union if exists
          state.updateUnionState({
            type: data.union.type,
            models: data.union.models || [],
            sources: data.union.sources || [],
          });
        }
      }

      // Load CTEs if present
      if (data.ctes && Array.isArray(data.ctes)) {
        set({ ctes: data.ctes as CteState[] });
      }

      // Handle select data - with special case for int_join_column
      if (data.select) {
        // For int_rollup_model, select might be undefined
        if (data.type !== 'int_rollup_model') {
          state.updateSelectState(data.select);
        }
      }

      // Load action states with proper activation
      if (data.where) {
        state.setWhereState(data.where);
        // Only toggle if not already active
        if (!state.activeActions.has(ActionType.WHERE)) {
          state.toggleAction(ActionType.WHERE);
        }
      }

      if (data.group_by && data.type && isGroupByAllowedType(data.type)) {
        state.setGroupByState(data.group_by);
        // Only toggle if not already active
        if (!state.activeActions.has(ActionType.GROUPBY)) {
          state.toggleAction(ActionType.GROUPBY);
        }
      }

      if (data.lightdash) {
        state.updateLightdashState(data.lightdash);
        // Only toggle if not already active
        if (!state.activeActions.has(ActionType.LIGHTDASH)) {
          state.toggleAction(ActionType.LIGHTDASH);
        }
      }

      // Load additional fields with validation
      const additionalFieldKeys: (keyof AdditionalFieldsSchema)[] = [
        'description',
        'tags',
        'incremental_strategy',
        'sql_hooks',
        'partitioned_by',
        'exclude_daily_filter',
        'exclude_date_filter',
        'exclude_portal_partition_columns',
        'exclude_portal_source_count',
      ];

      additionalFieldKeys.forEach((key) => {
        if (data[key] !== undefined && data[key] !== null) {
          let value = data[key] as AdditionalFieldsSchema[typeof key];

          // Validate and sanitize array fields
          if (key === 'tags' || key === 'partitioned_by') {
            // Models may use either `materialized: "incremental"` (string form) or
            // `materialization: { type: "incremental", ... }` (object form).
            // Both must be checked to avoid discarding partitioned_by.
            const isIncremental =
              data.materialized === 'incremental' ||
              (data as any).materialization === 'incremental' ||
              (typeof (data as any).materialization === 'object' &&
                (data as any).materialization?.type === 'incremental');
            if (!isIncremental && key === 'partitioned_by') {
              value = undefined;
            } else if (Array.isArray(value)) {
              value = value.filter(
                (item) => typeof item === 'string' && item.trim() !== '',
              ) as AdditionalFieldsSchema[typeof key];
            } else {
              console.warn(`${key} is not an array, skipping`);
              return;
            }
          }

          // Validate boolean fields
          if (
            key === 'exclude_portal_partition_columns' ||
            key === 'exclude_portal_source_count'
          ) {
            if (typeof value !== 'boolean') {
              value = false; // Default to false if invalid
            }
          }

          if (key === 'exclude_daily_filter' || key === 'exclude_date_filter') {
            if (
              data.type &&
              [
                'stg_select_source',
                'stg_union_sources',
                'mart_select_model',
                'mart_join_models',
              ].includes(data.type)
            ) {
              value = undefined;
            } else if (typeof value !== 'boolean') {
              value = false; // Default to false if invalid
            }
          }

          state.setAdditionalField(key, value);
        }
      });

      // Mark as initialized
      state.setIsInitialized(true);
    },

    // Internal function to flush the save queue
    _flushSaveQueue: async () => {
      const state = get();
      if (!state.autoSaveEnabled || state._saveQueue.size === 0) return;

      try {
        // Get all queued changes
        const queuedChanges = Object.fromEntries(state._saveQueue);

        // Clear the queue and timeout
        set(() => ({
          _saveQueue: new Map<string, unknown>(),
          _saveTimeout: null,
        }));

        // Load current saved state and merge with queued changes
        const savedState = await stateSync.loadState(state.formType);
        const updatedState = {
          ...savedState,
          ...queuedChanges,
        };

        // Save the merged state
        await stateSync.saveState(state.formType, updatedState);
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    },

    // Centralized save field function with debouncing
    saveField: (field, value) => {
      const state = get();
      if (!state.autoSaveEnabled) return Promise.resolve();

      // Add to save queue
      set((currentState) => {
        const newQueue = new Map(currentState._saveQueue);
        newQueue.set(field, value);

        // Clear existing timeout
        if (currentState._saveTimeout) {
          clearTimeout(currentState._saveTimeout);
        }

        // Set new timeout to flush queue after 500ms
        const newTimeout = setTimeout(() => {
          void get()._flushSaveQueue();
        }, 500);

        return {
          _saveQueue: newQueue,
          _saveTimeout: newTimeout,
        };
      });

      return Promise.resolve();
    },

    // Cleanup function to clear timeouts and prevent memory leaks
    _cleanup: () => {
      const state = get();
      if (state._saveTimeout) {
        clearTimeout(state._saveTimeout);
      }
      set(() => ({
        _saveQueue: new Map<string, unknown>(),
        _saveTimeout: null,
      }));
    },

    // Node-specific actions
    updateFromState: (fromData) => {
      set((state) => ({
        modelingState: { ...state.modelingState, from: fromData },
      }));
      // Auto-save the from data
      void get().saveField('from', fromData);
    },

    updateJoinState: (joinData) => {
      set((state) => ({
        modelingState: { ...state.modelingState, join: joinData },
      }));
      // Auto-save the join data
      void get().saveField('join', joinData);
    },

    updateRollupState: (rollupData) => {
      set((state) => ({
        modelingState: { ...state.modelingState, rollup: rollupData },
      }));
      // Auto-save the rollup data
      void get().saveField('rollup', rollupData);
    },

    updateLookbackState: (lookbackData) => {
      set((state) => ({
        modelingState: { ...state.modelingState, lookback: lookbackData },
      }));
      // Auto-save the lookback data
      void get().saveField('lookback', lookbackData);
    },

    updateUnionState: (unionData) => {
      const newUnionState = (state: ModelStore) => {
        const updatedUnion = {
          ...state.modelingState.union,
          ...unionData,
          models: unionData.models || state.modelingState.union.models || [],
          sources: unionData.sources || state.modelingState.union.sources || [],
        };
        return {
          modelingState: {
            ...state.modelingState,
            union: updatedUnion,
          },
        };
      };

      set(newUnionState);
      // Auto-save the union data
      const updatedUnion = get().modelingState.union;
      void get().saveField('union', updatedUnion);
    },

    updateSelectState: (selectData) => {
      set((state) => ({
        modelingState: {
          ...state.modelingState,
          select: selectData,
        },
      }));
      // Auto-save the select data
      void get().saveField('select', selectData);
    },

    setWhereState: (whereData: SchemaModelWhere | null) => {
      set(() => ({
        where: whereData,
      }));
      // Auto-save the where data
      void get().saveField('where', whereData);
    },

    setGroupByState: (groupByData: SchemaModelGroupBy | null) => {
      const formattedGroupByData =
        convertSchemaModelGroupByToModelStoreGroupBy(groupByData);
      set(() => ({
        groupBy: formattedGroupByData,
      }));
      // Auto-save the group by data
      void get().saveField('group_by', groupByData);
    },

    setGroupByDimensions: (dimensions: boolean) => {
      set((state) => {
        const newGroupBy = {
          ...state.groupBy,
          dimensions,
          // Clear columns when dimensions is enabled
          columns: dimensions ? [] : state.groupBy.columns,
        };
        return {
          groupBy: newGroupBy,
        };
      });
      // Auto-save the group by dimensions
      const currentGroupBy = get().groupBy;
      const groupByData = convertGroupByToSchemaModelGroupBy(currentGroupBy);
      void get().saveField('group_by', groupByData);
    },

    setGroupByColumns: (columns: string[]) => {
      set((state) => ({
        groupBy: { ...state.groupBy, columns },
      }));
      // Auto-save the group by columns
      const currentGroupBy = get().groupBy;
      const groupByData = convertGroupByToSchemaModelGroupBy(currentGroupBy);
      void get().saveField('group_by', groupByData);
    },

    setGroupByExpressions: (expressions: string[]) => {
      set((state) => ({
        groupBy: { ...state.groupBy, expressions },
      }));
      // Auto-save the group by expressions
      const currentGroupBy = get().groupBy;
      const groupByData = convertGroupByToSchemaModelGroupBy(currentGroupBy);
      void get().saveField('group_by', groupByData);
    },

    clearGroupByState: () => {
      set((state) => {
        const newActiveActions = new Set(state.activeActions);
        newActiveActions.delete(ActionType.GROUPBY);

        return {
          groupBy: DEFAULT_GROUP_BY_STATE,
          activeActions: newActiveActions,
        };
      });
      // Auto-save the cleared group by state
      void get().saveField('group_by', null);
    },

    isActionActive: (action) => {
      return get().activeActions.has(action);
    },

    setPendingRemovalAction: (action) => {
      set({ pendingRemovalAction: action });
    },

    toggleAction: (action: ActionType) => {
      set((state) => {
        const currentActiveActions = new Set(state.activeActions);
        const isCurrentlyActive = currentActiveActions.has(action);

        if (!isCurrentlyActive) {
          // Enable: add to set WITHOUT resetting state (preserves existing data)
          currentActiveActions.add(action);
          return {
            activeActions: currentActiveActions,
            pendingRemovalAction: null,
          };
        }

        // Remove and reset action state
        currentActiveActions.delete(action);

        const newState: Partial<ModelStore> = {
          activeActions: currentActiveActions,
          pendingRemovalAction: null,
        };

        switch (action) {
          case ActionType.GROUPBY: {
            const patch = resetActionState(ActionType.GROUPBY);
            newState.groupBy = patch;
            break;
          }
          case ActionType.WHERE: {
            const patch = resetActionState(ActionType.WHERE);
            newState.where = patch;
            break;
          }
          case ActionType.LIGHTDASH: {
            const patch = resetActionState(ActionType.LIGHTDASH);
            newState.modelingState = {
              ...state.modelingState,
              lightdash: patch,
            };
            break;
          }
        }

        return newState;
      });
    },

    setAdditionalField: (field, value) => {
      set((state) => ({
        additionalFields: { ...state.additionalFields, [field]: value },
      }));
      // Auto-save the additional field
      void get().saveField(field, value);
    },

    updateLightdashState: (lightdashData) => {
      set((state) => ({
        modelingState: {
          ...state.modelingState,
          lightdash: {
            ...state.modelingState.lightdash,
            ...lightdashData,
          },
        },
      }));
      // Auto-save the lightdash data
      const updatedLightdash = get().modelingState.lightdash;
      void get().saveField('lightdash', updatedLightdash);
    },

    // Data modeling visual actions
    setNodes: (nodes) =>
      set((state) => ({
        dataModeling: { ...state.dataModeling, nodes },
      })),

    setEdges: (edges) =>
      set((state) => ({
        dataModeling: { ...state.dataModeling, edges },
      })),

    // Navigation management for validation errors
    setNavigationNodeType: (nodeType: string | null) => {
      set(() => ({
        navigationNodeType: nodeType,
      }));
    },

    // Column Configuration Node visibility
    setShowColumnConfiguration: (show: boolean) => {
      set(() => ({
        showColumnConfiguration: show,
      }));
    },

    // Add Column Modal visibility
    setShowAddColumnModal: (show: boolean) => {
      set(() => ({
        showAddColumnModal: show,
      }));
    },

    // Set editing column
    setEditingColumn: (
      column: Partial<SchemaSelect> | null,
      originalName?: string | null,
    ) => {
      const currentOriginalName = get().editingColumnOriginalName;
      set(() => ({
        editingColumn: column,
        editingColumnOriginalName:
          originalName !== undefined
            ? originalName
            : column
              ? currentOriginalName
              : null,
      }));
    },

    setDefaultIncrementalStrategy: (strategy: string) => {
      set({ defaultIncrementalStrategy: strategy });
    },

    // Utility Actions
    reset: () => {
      const state = get();
      // Clear any pending save timeout
      if (state._saveTimeout) {
        clearTimeout(state._saveTimeout);
      }

      set({
        basicFields: initialBasicFields,
        originalModelPath: undefined,
        originalFiles: null,
        formType: 'model-create',
        mode: 'create' as const,
        autoSaveEnabled: true,
        isInitialized: false,
        _saveQueue: new Map<string, unknown>(),
        _saveTimeout: null,
        modelingState: initialModelingState,
        activeActions: new Set<ActionType>(),
        pendingRemovalAction: null,
        groupBy: DEFAULT_GROUP_BY_STATE,
        where: null,
        dataModeling: initialDataModeling,
        additionalFields: initialAdditionalFields,
        navigationNodeType: null,
        showColumnConfiguration: false,
        editingColumn: null,
        editingColumnOriginalName: null,
        ctes: [],
      });
    },

    // CTE Actions
    addCte: (cte: CteState) => {
      set((state) => ({ ctes: [...state.ctes, cte] }));
    },
    updateCte: (index: number, cte: CteState) => {
      set((state) => {
        const newCtes = [...state.ctes];
        newCtes[index] = cte;
        return { ctes: newCtes };
      });
    },
    removeCte: (index: number) => {
      set((state) => ({
        ctes: state.ctes.filter((_, i) => i !== index),
      }));
    },
    moveCte: (fromIndex: number, toIndex: number) => {
      set((state) => {
        const newCtes = [...state.ctes];
        const [moved] = newCtes.splice(fromIndex, 1);
        newCtes.splice(toIndex, 0, moved);
        return { ctes: newCtes };
      });
    },

    buildModelJson: () => {
      const state = get();
      const { basicFields, modelingState, groupBy, where } = state;

      // Build FROM object with all related configurations
      const fromObject = buildFromObject(basicFields, modelingState);

      // Add join configuration if applicable
      const joinConfig = buildJoinConfig(basicFields, modelingState);
      if (joinConfig) {
        fromObject.join = joinConfig;
      } else if (basicFields.type === 'int_join_column') {
        fromObject.join = modelingState.from.join;
      }
      // Add transformation configurations (rollup, lookback, union)
      const transformationConfigs = buildTransformationConfigs(
        basicFields,
        modelingState,
      );
      Object.assign(fromObject, transformationConfigs);

      const additionalFields = buildAdditionalFields(state.additionalFields);

      // Build the base model JSON
      const modelJson: Record<string, unknown> = {
        name: basicFields.name,
        group: basicFields.group,
        topic: basicFields.topic,
        type: basicFields.type,
        ...(basicFields.materialized && {
          materialized: basicFields.materialized,
        }),
        from: fromObject,
        select: buildSelectConfig(basicFields, modelingState),
        group_by: convertGroupByToSchemaModelGroupBy(groupBy),
        where: where || null,
        lightdash: null,
        ...additionalFields,
      };

      // Add CTEs if defined
      if (state.ctes.length > 0) {
        modelJson.ctes = state.ctes;
      }

      // Add Lightdash configuration if it has meaningful data
      const lightdashConfig = buildLightdashConfig(modelingState);
      if (lightdashConfig) {
        modelJson.lightdash = lightdashConfig;
      }

      // Only coerce to null when the UI explicitly has the field but it's
      // empty/falsy. When absent (undefined), leave it out so the backend
      // merge preserves the original value from the file.
      if (modelJson.partitioned_by !== undefined) {
        if (
          !modelJson.partitioned_by ||
          (Array.isArray(modelJson.partitioned_by) &&
            modelJson.partitioned_by.length === 0)
        ) {
          modelJson.partitioned_by = null;
        }
      }

      return modelJson as unknown as Partial<FrameworkModel>;
    },
  })),
);

/**
 * Convert the groupBy state to the SchemaModelGroupBy format
 * @param groupBy ModelStore['groupBy']
 * @returns
 */
function convertGroupByToSchemaModelGroupBy(
  groupBy: ModelStore['groupBy'],
): SchemaModelGroupBy | null {
  if (
    groupBy.dimensions &&
    groupBy.columns.length === 0 &&
    groupBy.expressions.length === 0
  ) {
    return GROUP_BY_DIMS;
  }

  const groupByItems: Array<string | { expr: string } | { type: 'dims' }> = [];

  if (groupBy.dimensions) {
    groupByItems.push({ type: 'dims' });
  }

  groupByItems.push(...groupBy.columns);

  groupByItems.push(...groupBy.expressions.map((expr) => ({ expr })));

  if (groupByItems.length > 0) {
    return groupByItems as SchemaModelGroupBy;
  }

  return null;
}

/**
 * Convert the SchemaModelGroupBy to the ModelStore['groupBy'] format.
 * Handles both the `"dims"` shorthand and the array form.
 */
export function convertSchemaModelGroupByToModelStoreGroupBy(
  groupBy: SchemaModelGroupBy | null,
) {
  const groupByItems: ModelStore['groupBy'] = {
    ...DEFAULT_GROUP_BY_STATE,
  };

  if (!groupBy) {
    return groupByItems;
  }

  const normalized = normalizeGroupBy(groupBy);
  if (!normalized) {
    return groupByItems;
  }

  groupByItems.dimensions = normalized.some(
    (item) =>
      typeof item === 'object' && 'type' in item && item.type === 'dims',
  );

  groupByItems.columns = normalized.filter(
    (item): item is string => typeof item === 'string',
  );

  groupByItems.expressions = normalized
    .filter(
      (item): item is { expr: string } =>
        typeof item === 'object' && 'expr' in item,
    )
    .map((item) => item.expr);

  return groupByItems;
}

// Exclude `undefined` entries so the backend merge preserves original values
// for fields the UI never loaded. Only explicit values (including `null` via
// empty-string/false conversion) are sent; `null` tells the backend to delete.
function buildAdditionalFields(additionalFields: AdditionalFieldsSchema) {
  return Object.fromEntries(
    Object.entries(additionalFields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (value === '' || value === false) {
          return [key, null];
        }
        return [key, value];
      }),
  );
}
