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
import { visitCteRefs } from './cteRefs';
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

/**
 * UI state for a single CTE definition within the model editor.
 *
 * Mirrors `SchemaModelCTE` (the source of truth for serialized CTEs) but
 * intentionally widens `from` and `select` because the wizard often holds
 * partial / in-flight values while the user fills the form (e.g. an empty
 * string for `from.model` while the picker is open). `buildModelJson()`
 * normalizes empties / strips UI-only keys before serializing.
 *
 * The runtime invariant that the eventually-serialized shape conforms to
 * `SchemaModelCTE` is enforced by Ajv on the backend; the wizard's job is
 * only to produce a draft that round-trips through the CTE schema once the
 * user has filled the required fields.
 */
export type CteState = {
  name: string;
  from: Record<string, unknown>;
  select?: unknown[];
  where?: SchemaModelWhere;
  group_by?: SchemaModelGroupBy | null;
  having?: unknown;
  exclude_date_filter?: boolean;
  exclude_daily_filter?: boolean;
  exclude_portal_partition_columns?: boolean;
  exclude_datetime?: boolean;
  exclude_framework_artifacts?: 'all' | 'columns';
  exclude_portal_source_count?: boolean;
  include_full_month?: boolean;
};

/**
 * Per-CTE column entry returned by `framework-model-cte-analysis`. Mirrors
 * `ApiResponse<'framework-model-cte-analysis'>['columns'][string][number]`.
 */
export type CteAnalysisColumn = {
  name: string;
  type?: 'dim' | 'fct';
  dataType?: string;
  description?: string;
};

/**
 * Diagnostic returned by `framework-model-cte-analysis`. The flat list is
 * grouped by `cteIndex` for display; `path` (JSON-pointer-ish) is used by the
 * Validation tab to jump to the offending field.
 */
export type CteAnalysisDiagnostic = {
  severity: 'error' | 'warning';
  cteIndex?: number;
  path?: string;
  message: string;
};

/** Live results + meta from `framework-model-cte-analysis`. */
export type CteAnalysisState = {
  columns: Record<string, CteAnalysisColumn[]>;
  diagnostics: CteAnalysisDiagnostic[];
  /** Manifest mtime in epoch ms; null when no manifest. */
  manifestTimestamp: number | null;
  /**
   * True while a request is in flight. The hook keeps the previous response
   * visible during this window so the panel does not flash on every keystroke.
   */
  loading: boolean;
  error: string | null;
};

/**
 * Wizard-only keys that must never appear in the serialized model JSON. The
 * schema rejects unknown properties (`additionalProperties: false`), so any
 * field added here must be stripped by `buildModelJson()`. Each new UI-only
 * field added in future PRs goes here and is covered by a regression test.
 */
const CTE_UI_ONLY_KEYS = new Set<string>(['_uuid']);

/**
 * Defensive normalization for CTEs loaded from disk. Drops empty `from`
 * branches (`{ model: '' }`), normalizes empty `select` to undefined, and
 * removes unknown top-level keys for forward-compatibility against future
 * schema changes. Runs once on `loadInitialData`; the backend's Ajv
 * validators catch the same issues at sync time, but the UI breaks before
 * reaching that point if we don't normalize.
 */
export function normalizeCte(input: unknown): CteState {
  const cte = (input ?? {}) as Record<string, unknown>;
  const allowed = new Set([
    'name',
    'from',
    'select',
    'where',
    'group_by',
    'having',
    'exclude_date_filter',
    'exclude_daily_filter',
    'exclude_portal_partition_columns',
    'exclude_datetime',
    'exclude_framework_artifacts',
    'exclude_portal_source_count',
    'include_full_month',
  ]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cte)) {
    if (!allowed.has(key)) continue;
    out[key] = cte[key];
  }

  // Normalize `from`: drop empty-string branches so the picker doesn't render
  // as if a value were selected.
  const fromIn = (cte.from ?? {}) as Record<string, unknown>;
  const fromOut: Record<string, unknown> = {};
  for (const key of Object.keys(fromIn)) {
    const v = fromIn[key];
    if (typeof v === 'string' && v === '') continue;
    fromOut[key] = v;
  }
  out.from = fromOut;

  // Normalize `select: []` to undefined; `minItems: 1` makes empty arrays a
  // schema violation. Real selects are kept verbatim (the panel handles per-
  // item validation).
  if (Array.isArray(out.select) && (out.select as unknown[]).length === 0) {
    delete out.select;
  }

  // Trim name in case JSON has incidental whitespace.
  if (typeof out.name === 'string') {
    out.name = out.name.trim();
  } else {
    out.name = '';
  }

  return out as CteState;
}

/**
 * Strip UI-only keys + drop empty arrays before serializing for
 * `buildModelJson()`. Mirrors `normalizeCte()` but on the way out.
 *
 * Schema invariants enforced here:
 *   - `additionalProperties: false`: drop any UI-only keys.
 *   - `select: minItems: 1`: omit field when empty.
 *   - `from.union.{ctes,models}: minItems: 1`: drop the `union` wrapper when
 *     the list is empty.
 */
/**
 * `exclude_*` flag keys whose CTE-level override is dropped from the
 * serialized JSON when the value matches the inherited main-model value.
 * Keeps the preview JSON clean -- writing `exclude_datetime: false` on a
 * CTE when the main model is also `false` adds noise without changing
 * the rendered SQL. The user can still flip the value to override.
 */
const CTE_INHERITED_FLAG_KEYS = [
  'exclude_framework_artifacts',
  'exclude_date_filter',
  'exclude_daily_filter',
  'exclude_datetime',
  'exclude_portal_partition_columns',
  'exclude_portal_source_count',
] as const;

function stripCteForSerialize(
  cte: CteState,
  inherited?: Partial<
    Record<(typeof CTE_INHERITED_FLAG_KEYS)[number], unknown>
  >,
): CteState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cte)) {
    if (CTE_UI_ONLY_KEYS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  if (Array.isArray(out.select) && (out.select as unknown[]).length === 0) {
    delete out.select;
  }
  if (out.from && typeof out.from === 'object') {
    const fromCopy: Record<string, unknown> = {
      ...(out.from as Record<string, unknown>),
    };
    const union = fromCopy.union as Record<string, unknown> | undefined;
    if (union) {
      // Empty strings are valid in-flight UI state (a "pick a model"
      // placeholder row) but never belong in the saved JSON. Strip
      // them before validation/save; if nothing remains in the tail,
      // drop the whole `union` key so the model degrades to a plain
      // `from.model` / `from.cte` instead of an empty union.
      const unionCopy: Record<string, unknown> = { ...union };
      const ctesArr = Array.isArray(unionCopy.ctes)
        ? (unionCopy.ctes as unknown[]).filter(
            (e): e is string => typeof e === 'string' && e.length > 0,
          )
        : null;
      const modelsArr = Array.isArray(unionCopy.models)
        ? (unionCopy.models as unknown[]).filter(
            (e): e is string => typeof e === 'string' && e.length > 0,
          )
        : null;
      if (ctesArr !== null) unionCopy.ctes = ctesArr;
      if (modelsArr !== null) unionCopy.models = modelsArr;
      if (
        (ctesArr && ctesArr.length === 0) ||
        (modelsArr && modelsArr.length === 0)
      ) {
        delete fromCopy.union;
      } else {
        fromCopy.union = unionCopy;
      }
    }
    out.from = fromCopy;
  }
  // Drop CTE-level exclude flags that match the inherited (main-model) value.
  // The schema treats CTE-level values as overrides; redundantly setting them
  // to the same value is functionally identical but visually noisy in the
  // JSON preview. Users can still toggle to a different value to override.
  if (inherited) {
    for (const key of CTE_INHERITED_FLAG_KEYS) {
      if (!(key in out)) continue;
      if (!(key in inherited)) continue;
      if (out[key] === inherited[key]) {
        delete out[key];
      }
    }
  }
  return out as CteState;
}

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
  exclude_datetime?: boolean;
  exclude_framework_artifacts?: 'all' | 'columns';
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
  duplicateCte: (index: number) => void;
  /**
   * Shallow-merge `patch` into the CTE at `index`. Used by the panel for
   * field-by-field edits. Persists via `saveField('ctes', ...)`.
   */
  patchCte: (index: number, patch: Partial<CteState>) => void;
  /**
   * Rewrite every reference to `oldName` across the model (CTE selects,
   * unions, joins, subqueries, main-model from/select/join/where/having)
   * to `newName`. Wraps `visitCteRefs`.
   */
  applyCteRename: (oldName: string, newName: string) => void;
  // CTE editor (side-panel) state. The panel itself mounts in Phase 4; this
  // index is set by clicking a CTE row in CteNode and consumed by CteEditorPanel.
  editingCteIndex: number | null;
  openCteEditor: (index: number) => void;
  closeCteEditor: () => void;
  // Live results from `framework-model-cte-analysis`. The hook keeps the
  // previous response visible while a new request is in flight; the panel
  // uses `loading` only for a subtle "updating" indicator on the count pill.
  cteAnalysis: CteAnalysisState;
  setCteAnalysis: (next: Partial<CteAnalysisState>) => void;
  /**
   * Live-measured DOM height of the CTE node (via ResizeObserver in
   * `CteNode.tsx`). Threaded into `useLayoutManager` so the
   * `preSource -> source` vertical gap respects the actual rendered
   * height instead of the layout's fixed `nodeHeight: 200` assumption.
   * `null` while uninitialized.
   */
  cteNodeMeasuredHeight: number | null;
  setCteNodeMeasuredHeight: (height: number | null) => void;
  /**
   * User-supplied node positions persisted in-session. Keyed by React
   * Flow node id. After auto-layout runs, these overlay the computed
   * positions so a user's manual nudge survives the next layout pass.
   * Entries are pruned when the underlying node disappears. Positions
   * do NOT persist across page reloads (sticky-until-structure-changes).
   */
  manualPositions: Record<string, { x: number; y: number }>;
  setManualPosition: (id: string, pos: { x: number; y: number }) => void;
  pruneManualPositions: (presentIds: string[]) => void;
  clearManualPositions: () => void;

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
  exclude_datetime: undefined,
  exclude_framework_artifacts: undefined,
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
    editingCteIndex: null,
    cteAnalysis: {
      columns: {},
      diagnostics: [],
      manifestTimestamp: null,
      loading: false,
      error: null,
    },
    cteNodeMeasuredHeight: null,
    manualPositions: {},

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

        // Clear CTEs when switching to a non-CTE-capable model type. Also
        // close the side-panel editor (`editingCteIndex`) and remove the
        // CTE action from activeActions so the canvas drops the list node
        // alongside the data.
        if (
          field === 'type' &&
          typeof value === 'string' &&
          !isCteCapableType(value)
        ) {
          if (state.ctes.length > 0) {
            newCtes = [];
            setTimeout(() => {
              void get().saveField('ctes', null);
              get().closeCteEditor();
            }, 0);
          }
          if (state.activeActions.has(ActionType.CTE)) {
            // newActiveActions may already be the original Set reference
            // (we want a fresh copy before mutating).
            if (newActiveActions === state.activeActions) {
              newActiveActions = new Set(state.activeActions);
            }
            newActiveActions.delete(ActionType.CTE);
          }
        }

        // Clear group by state when model type changes to one that doesn't support it
        if (field === 'type' && typeof value === 'string') {
          if (!isGroupByAllowedType(value)) {
            newGroupBy = DEFAULT_GROUP_BY_STATE;
            // Remove GROUPBY action from activeActions. Use a shared
            // mutable copy so prior cleanups in this update (e.g. CTE
            // deletion above) aren't lost when more than one branch
            // mutates activeActions.
            if (newActiveActions === state.activeActions) {
              newActiveActions = new Set(state.activeActions);
            }
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

      // Load CTEs if present. Defensive normalization drops empty `from`
      // branches and unknown keys so the panel doesn't render half-broken
      // states from older / malformed JSON. Activate the CTE action so
      // the canvas renders the list node when reopening a CTE-bearing
      // model -- mirrors the where/group_by/lightdash auto-toggle below.
      if (data.ctes && Array.isArray(data.ctes) && data.ctes.length > 0) {
        set({ ctes: (data.ctes as unknown[]).map(normalizeCte) });
        if (!state.activeActions.has(ActionType.CTE)) {
          state.toggleAction(ActionType.CTE);
        }
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
        'exclude_datetime',
        'exclude_framework_artifacts',
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
            key === 'exclude_portal_source_count' ||
            key === 'exclude_datetime'
          ) {
            if (typeof value !== 'boolean') {
              value = false; // Default to false if invalid
            }
          }

          // Validate the combined enum: only "all" or "columns" are valid;
          // anything else (legacy stale store values, malformed manifests) is
          // dropped so the dropdown re-renders in its blank/default state.
          if (key === 'exclude_framework_artifacts') {
            if (value !== 'all' && value !== 'columns') {
              value = undefined;
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
          case ActionType.CTE: {
            // Disabling the CTE list discards every CTE on the model;
            // mirrors the data-loss cleanup the other actions do. The
            // confirm dialog in ActionsBar gates this behind a user
            // acknowledgement when ctes is non-empty.
            newState.ctes = [];
            newState.editingCteIndex = null;
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
        editingCteIndex: null,
        cteNodeMeasuredHeight: null,
        manualPositions: {},
      });
    },

    // CTE Actions
    addCte: (cte: CteState) => {
      const incoming = normalizeCte(cte);
      set((state) => {
        // Auto-set `modelingState.from.cte` when the user adds their first
        // CTE on a truly empty `from`. "Truly empty" means no model, no
        // source, no cte, no union. Any partially-set `from` is treated as
        // intentional and left alone.
        const f = state.modelingState.from || {};
        const isTrulyEmpty =
          !('model' in f && f.model) &&
          !('source' in f && f.source) &&
          !('cte' in f && f.cte) &&
          !('union' in f && f.union);

        const nextModelingState =
          isTrulyEmpty && incoming.name
            ? {
                ...state.modelingState,
                from: { ...f, cte: incoming.name } as Record<string, unknown>,
              }
            : state.modelingState;

        return {
          ctes: [...state.ctes, incoming],
          modelingState: nextModelingState,
        };
      });
      void get().saveField('ctes', get().ctes);
      // Persist `from` if we auto-set it.
      void get().saveField('from', get().modelingState.from);
    },
    updateCte: (index: number, cte: CteState) => {
      set((state) => {
        const newCtes = [...state.ctes];
        newCtes[index] = cte;
        return { ctes: newCtes };
      });
      void get().saveField('ctes', get().ctes);
    },
    patchCte: (index: number, patch: Partial<CteState>) => {
      const oldCte = get().ctes[index];
      if (!oldCte) return;
      // Patch semantics: `undefined` deletes the key from the CTE,
      // anything else replaces it. A spread (`{ ...oldCte, ...patch }`)
      // would leave the key present with an `undefined` value, so the
      // runtime field disappears but the `in`-check still passes --
      // `stripCteForSerialize` relies on the key being absent to
      // distinguish "use main-model default" from "override with this
      // explicit value".
      const merged: CteState = { ...oldCte };
      for (const k of Object.keys(patch) as Array<keyof CteState>) {
        const v = patch[k];
        if (v === undefined) {
          delete (merged as Record<string, unknown>)[k as string];
        } else {
          (merged as Record<string, unknown>)[k as string] = v;
        }
      }
      // If the name changed via patchCte, route through applyCteRename so all
      // references get rewritten atomically. Otherwise it's just a field
      // update.
      if (patch.name !== undefined && patch.name !== oldCte.name) {
        set((state) => {
          const newCtes = [...state.ctes];
          newCtes[index] = merged;
          return { ctes: newCtes };
        });
        get().applyCteRename(oldCte.name, merged.name);
      } else {
        set((state) => {
          const newCtes = [...state.ctes];
          newCtes[index] = merged;
          return { ctes: newCtes };
        });
        void get().saveField('ctes', get().ctes);
      }
    },
    removeCte: (index: number) => {
      const removed = get().ctes[index];
      set((state) => {
        const newCtes = state.ctes.filter((_, i) => i !== index);
        // Walk every reference site and strip references to the removed CTE.
        // Downstream sites are left in a deliberately invalid state so the
        // user sees a clear validation error and can fix it intentionally;
        // we never "auto-fix" semantically meaningful gaps.
        if (!removed?.name) {
          return { ctes: newCtes };
        }
        const draft = visitCteRefs(
          {
            ctes: newCtes,
            modelingState: state.modelingState as unknown as Record<
              string,
              unknown
            >,
          },
          (_kind, name) => (name === removed.name ? '' : undefined),
        );
        return {
          ctes: draft.ctes ?? newCtes,
          modelingState: (draft.modelingState ??
            (state.modelingState as unknown as Record<
              string,
              unknown
            >)) as unknown as ModelingStateAdapter,
          editingCteIndex:
            state.editingCteIndex === index ? null : state.editingCteIndex,
        };
      });
      void get().saveField('ctes', get().ctes);
      void get().saveField('from', get().modelingState.from);
      void get().saveField(
        'select',
        buildSelectConfig(get().basicFields, get().modelingState),
      );
    },
    moveCte: (fromIndex: number, toIndex: number) => {
      set((state) => {
        const newCtes = [...state.ctes];
        const [moved] = newCtes.splice(fromIndex, 1);
        newCtes.splice(toIndex, 0, moved);
        return { ctes: newCtes };
      });
      void get().saveField('ctes', get().ctes);
    },
    duplicateCte: (index: number) => {
      set((state) => {
        const source = state.ctes[index];
        if (!source) return {};
        // Deep clone to avoid sharing nested references with the source CTE.
        const cloned: CteState = JSON.parse(JSON.stringify(source));
        // Suffix the copied CTE name to keep names unique within the model.
        const baseName = (source.name || `cte_${index + 1}`).replace(
          /_copy(\d*)$/,
          '',
        );
        const existingNames = new Set(state.ctes.map((c) => c.name));
        let suffix = 1;
        let nextName = `${baseName}_copy`;
        while (existingNames.has(nextName)) {
          suffix += 1;
          nextName = `${baseName}_copy${suffix}`;
        }
        cloned.name = nextName;
        const newCtes = [...state.ctes];
        newCtes.splice(index + 1, 0, cloned);
        return { ctes: newCtes };
      });
      void get().saveField('ctes', get().ctes);
    },
    applyCteRename: (oldName: string, newName: string) => {
      if (!oldName || !newName || oldName === newName) return;
      set((state) => {
        const draft = visitCteRefs(
          {
            ctes: state.ctes,
            modelingState: state.modelingState as unknown as Record<
              string,
              unknown
            >,
          },
          (_kind, name) => (name === oldName ? newName : undefined),
        );
        return {
          ctes: draft.ctes ?? state.ctes,
          modelingState: (draft.modelingState ??
            (state.modelingState as unknown as Record<
              string,
              unknown
            >)) as unknown as ModelingStateAdapter,
        };
      });
      void get().saveField('ctes', get().ctes);
      void get().saveField('from', get().modelingState.from);
      void get().saveField(
        'select',
        buildSelectConfig(get().basicFields, get().modelingState),
      );
    },
    openCteEditor: (index: number) => {
      set({ editingCteIndex: index });
    },
    closeCteEditor: () => {
      set({ editingCteIndex: null });
    },
    setCteAnalysis: (next: Partial<CteAnalysisState>) => {
      set((state) => ({
        cteAnalysis: { ...state.cteAnalysis, ...next },
      }));
    },
    setCteNodeMeasuredHeight: (height: number | null) => {
      // Skip no-op writes -- ResizeObserver fires for every subpixel change
      // and triggers a layout recompute. Round to nearest pixel and only
      // commit when the rounded value actually moves.
      const prev = get().cteNodeMeasuredHeight;
      const next = height === null ? null : Math.round(height);
      if (prev === next) return;
      set({ cteNodeMeasuredHeight: next });
    },
    setManualPosition: (id: string, pos: { x: number; y: number }) => {
      set((state) => ({
        manualPositions: { ...state.manualPositions, [id]: pos },
      }));
    },
    pruneManualPositions: (presentIds: string[]) => {
      const presentSet = new Set(presentIds);
      const current = get().manualPositions;
      const filteredEntries = Object.entries(current).filter(([id]) =>
        presentSet.has(id),
      );
      // Avoid a no-op set so we don't re-trigger consumers on every layout pass.
      if (filteredEntries.length === Object.keys(current).length) return;
      set({ manualPositions: Object.fromEntries(filteredEntries) });
    },
    clearManualPositions: () => {
      if (Object.keys(get().manualPositions).length === 0) return;
      set({ manualPositions: {} });
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

      // Add CTEs if defined. Strip UI-only keys + drop empty `select` /
      // empty `from.union.{ctes,models}` so the serialized output passes
      // Ajv against `model.cte.schema.json` (Cross-cutting Invariants 2 + 3).
      if (state.ctes.length > 0) {
        // Pass `additionalFields` so CTE-level exclude flags that match the
        // main model's values are dropped from the preview JSON. The CTE
        // schema treats absent flags as "inherit from the main model", so
        // omitting matching values keeps the rendered SQL identical while
        // making the preview easier to scan.
        const inheritedFlags = {
          exclude_framework_artifacts:
            state.additionalFields.exclude_framework_artifacts,
          exclude_date_filter: state.additionalFields.exclude_date_filter,
          exclude_daily_filter: state.additionalFields.exclude_daily_filter,
          exclude_datetime: state.additionalFields.exclude_datetime,
          exclude_portal_partition_columns:
            state.additionalFields.exclude_portal_partition_columns,
          exclude_portal_source_count:
            state.additionalFields.exclude_portal_source_count,
        };
        modelJson.ctes = state.ctes.map((cte) =>
          stripCteForSerialize(cte, inheritedFlags),
        );
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
// Field keys whose `[]` state means "field absent" rather than "explicitly
// cleared", and so should be omitted from the serialized output. Fields with
// dedicated null-coercion (e.g. `partitioned_by`, handled by buildModelJson)
// must NOT be listed here: they rely on `[]` reaching that path to be
// converted to `null` for backend deletion semantics.
const DROP_EMPTY_ARRAY_FIELDS = new Set<string>(['tags']);

function buildAdditionalFields(additionalFields: AdditionalFieldsSchema) {
  return Object.fromEntries(
    Object.entries(additionalFields)
      .filter(([key, value]) => {
        if (value === undefined) return false;
        if (
          DROP_EMPTY_ARRAY_FIELDS.has(key) &&
          Array.isArray(value) &&
          value.length === 0
        ) {
          return false;
        }
        return true;
      })
      .map(([key, value]) => {
        if (value === '' || value === false) {
          return [key, null];
        }
        return [key, value];
      }),
  );
}
