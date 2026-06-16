import type { SchemaModelLightdash } from '@shared/schema/types/model.lightdash.schema';
import type { SchemaModelWhere } from '@shared/schema/types/model.where.schema';
import type { Edge, Node } from '@xyflow/react';

import { ActionType } from './types';

export interface GroupByStoreSpec {
  dimensions: boolean; // Group by all dimensions
  columns: string[]; // Individual column selections
  expressions: string[]; // Custom expressions
}

// Action types that participate in the declarative registry below. The CTE
// list lives upstream of the SELECT FROM picker (not as a column-selection
// downstream node) so it doesn't fit the registry's "build nodes off of
// column-selection" shape -- DataModeling.tsx places it inline instead.
export type RegisteredActionType = Exclude<ActionType, ActionType.CTE>;

// Mapped return types for each action's resetState
export interface ActionResetMap {
  [ActionType.GROUPBY]: GroupByStoreSpec;
  [ActionType.WHERE]: SchemaModelWhere | null;
  [ActionType.LIGHTDASH]: SchemaModelLightdash;
}

export interface ActionSpec<T extends RegisteredActionType> {
  type: T;
  resetState(): ActionResetMap[T];
  nodeId: string;
  buildNodes(): Node[];
  buildEdges(): Edge[];
}

type ActionSpecRecord = {
  [K in RegisteredActionType]: ActionSpec<K>;
};

/**
 * Shared edge styling reused for action edges
 */
const edgeStyle = {
  strokeWidth: 4,
  stroke: 'var(--color-surface-contrast)',
};

export const DEFAULT_GROUP_BY_STATE: GroupByStoreSpec = {
  dimensions: false,
  columns: [],
  expressions: [],
};

// metrics_include / metrics_exclude intentionally omitted so they default to
// undefined. An explicit [] has semantic meaning ("block metric inheritance"),
// and is only set when loaded from existing model data.
export const DEFAULT_LIGHTDASH_STATE: SchemaModelLightdash = {
  table: { group_label: '', label: '' },
  metrics: [],
};

/**
 * Declarative specification for an optional (toggleable) action/feature.
 * Each spec knows how to:
 *  - initialize / clear its slice of modelingState
 *  - determine if it is enabled
 *  - (optionally) project nodes / edges for the React Flow graph
 */
export const ACTION_SPECS: ActionSpecRecord = {
  [ActionType.GROUPBY]: {
    type: ActionType.GROUPBY,
    resetState: () => ({ ...DEFAULT_GROUP_BY_STATE }),
    nodeId: 'group-by',
    buildNodes: () => [
      {
        id: 'group-by',
        type: 'groupByNode',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    buildEdges: () => [
      {
        id: 'column-group-by',
        source: 'column-selection',
        target: 'group-by',
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
      },
    ],
  },
  [ActionType.WHERE]: {
    type: ActionType.WHERE,
    resetState: () => null,
    nodeId: 'where',
    buildNodes: () => [
      {
        id: 'where',
        type: 'whereNode',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    buildEdges: () => [
      {
        id: 'column-where',
        source: 'column-selection',
        target: 'where',
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
      },
    ],
  },
  [ActionType.LIGHTDASH]: {
    type: ActionType.LIGHTDASH,
    resetState: () => DEFAULT_LIGHTDASH_STATE,
    nodeId: 'lightdash',
    buildNodes: () => [
      {
        id: 'lightdash',
        type: 'lightdashNode',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    buildEdges: () => [
      {
        id: 'column-lightdash',
        source: 'column-selection',
        target: 'lightdash',
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
      },
    ],
  },
};

/**
 * Convenience helpers
 */

export const resetActionState = <T extends RegisteredActionType>(action: T) =>
  ACTION_SPECS[action].resetState();
