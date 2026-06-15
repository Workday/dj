import type { SchemaModelLightdash } from '@shared/schema/types/model.lightdash.schema';
import { ActionType } from '@web/features/DataModeling/types';

import type { JoinWithUUID, ModelingStateAdapter } from './useModelStore';

// Helper function to check if a value is not empty
export const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
};

/** Model types that support inline CTE definitions */
export const CTE_CAPABLE_TYPES = [
  'int_select_model',
  'int_join_models',
  'int_union_models',
  'mart_select_model',
  'mart_join_models',
] as const;

export const isCteCapableType = (type: string): boolean =>
  (CTE_CAPABLE_TYPES as readonly string[]).includes(type);

// Build FROM object for model JSON
export const buildFromObject = (
  basicFields: { type: string },
  modelingState: ModelingStateAdapter,
): Record<string, unknown> => {
  const fromObject: Record<string, unknown> = {};

  // Treat stg_union_sources same as stg_select_source for base source handling
  if (
    basicFields.type === 'stg_select_source' ||
    basicFields.type === 'stg_union_sources'
  ) {
    if (
      hasValue(modelingState.from.source) ||
      hasValue(modelingState.from.model)
    ) {
      fromObject.source = modelingState.from.source || modelingState.from.model;
    }
  } else if (hasValue(modelingState.from.cte)) {
    // CTE-based models use from.cte instead of from.model
    fromObject.cte = modelingState.from.cte;
  } else if (hasValue(modelingState.from.model)) {
    fromObject.model = modelingState.from.model;
  }

  return fromObject;
};

// Format join conditions (extract column equality conditions)

const formattedJoinConditions = (
  joinItem: any,
  baseModelName: unknown,
  joinModelName: unknown,
) => {
  if (joinItem.on === 'dims') {
    return joinItem;
  }
  if (
    joinItem.type === 'cross' ||
    !joinItem.on?.and ||
    joinItem.on.and.length === 0
  ) {
    return joinItem;
  }

  // Type guard: ensure model names are strings
  const baseModelStr =
    typeof baseModelName === 'string' ? baseModelName : String(baseModelName);
  // Use override_alias for the join side when available so that qualified
  // expressions match the SQL alias used in the JOIN line.
  const joinAliasStr = joinItem.override_alias
    ? String(joinItem.override_alias)
    : typeof joinModelName === 'string'
      ? joinModelName
      : String(joinModelName);

  // Pattern for same column names: table.column = table.column OR column = column
  const sameColumnPattern = {
    qualified:
      /^([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)$/,
    unqualified: /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)$/,
  };

  // Check if all conditions are simple column equalities with same column names

  const allSimpleColumnEqualities = joinItem.on.and.every((condition: any) => {
    if (typeof condition === 'object' && condition.expr) {
      const expr = condition.expr.trim();

      // Try qualified pattern first (table.column = table.column)
      const qualifiedMatch = expr.match(sameColumnPattern.qualified);
      if (qualifiedMatch) {
        const leftColumn = qualifiedMatch[1].split('.')[1];
        const rightColumn = qualifiedMatch[2].split('.')[1];
        return leftColumn === rightColumn;
      }

      // Try unqualified pattern (column = column)
      const unqualifiedMatch = expr.match(sameColumnPattern.unqualified);
      if (unqualifiedMatch) {
        const leftSide = unqualifiedMatch[1];
        const rightSide = unqualifiedMatch[2];
        return leftSide === rightSide;
      }

      return false;
    }
    return false;
  });

  // If all conditions are simple column equalities with same column names, extract column names
  if (allSimpleColumnEqualities) {
    const columnNames = joinItem.on.and

      .map((condition: any) => {
        const expr = condition.expr.trim();

        // Try qualified pattern
        const qualifiedMatch = expr.match(sameColumnPattern.qualified);
        if (qualifiedMatch) {
          return qualifiedMatch[1].split('.')[1];
        }

        // Try unqualified pattern
        const unqualifiedMatch = expr.match(sameColumnPattern.unqualified);
        if (unqualifiedMatch) {
          return unqualifiedMatch[1];
        }

        return null;
      })
      .filter(Boolean);

    if (columnNames.length > 0) {
      return { ...joinItem, on: { and: columnNames } };
    }
  }

  // For different column conditions, prepend table names if they're missing
  const updatedConditions = joinItem.on.and.map((condition: any) => {
    if (typeof condition === 'object' && condition.expr) {
      const expr = condition.expr.trim();

      // Check if already qualified (has table.column format)
      const alreadyQualified =
        expr.includes('.') &&
        expr.split('=').every((part: string) => part.trim().includes('.'));

      if (!alreadyQualified && baseModelName && joinModelName) {
        // Extract column names from unqualified expressions
        const unqualifiedMatch = expr.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\s*([=<>!]+)\s*([a-zA-Z_][a-zA-Z0-9_]*)$/,
        );
        if (unqualifiedMatch) {
          const leftCol = unqualifiedMatch[1];
          const operator = unqualifiedMatch[2];
          const rightCol = unqualifiedMatch[3];
          return {
            expr: `${baseModelStr}.${leftCol} ${operator} ${joinAliasStr}.${rightCol}`,
          };
        }
      }
    }

    return condition;
  });

  return { ...joinItem, on: { and: updatedConditions } };
};

// Build JOIN configuration
export const buildJoinConfig = (
  basicFields: { type: string },
  modelingState: ModelingStateAdapter,
): any => {
  if (
    !(
      basicFields.type === 'int_join_column' ||
      basicFields.type === 'int_join_models' ||
      basicFields.type === 'mart_join_models'
    ) ||
    !modelingState.join
  ) {
    return null;
  }

  // Handle int_join_column case (single object)
  if (basicFields.type === 'int_join_column') {
    if (Array.isArray(modelingState.join)) {
      // This shouldn't happen for int_join_column, but handle gracefully
      return null;
    }

    // For int_join_column, return the join object directly (not as array)
    // Remove any internal fields that shouldn't be in the final JSON
    const joinWithoutUuid = modelingState.join;

    if ('_uuid' in joinWithoutUuid) {
      delete joinWithoutUuid._uuid;
    }

    return joinWithoutUuid;
  }

  // Handle int_join_models and mart_join_models cases (array)
  if (!Array.isArray(modelingState.join) || modelingState.join.length === 0) {
    return null;
  }

  const validJoins = modelingState.join
    .map((joinItem) => {
      // Remove _uuid field

      const { _uuid, ...joinWithoutUuid } = joinItem as JoinWithUUID;

      // Handle cross joins
      if (joinWithoutUuid.type === 'cross') {
        const { on: _on, ...crossJoinWithoutOn } =
          joinWithoutUuid as typeof joinWithoutUuid & { on?: unknown };
        return crossJoinWithoutOn;
      }

      const joinTarget =
        'model' in joinWithoutUuid
          ? joinWithoutUuid.model
          : 'cte' in joinWithoutUuid
            ? (joinWithoutUuid as { cte: string }).cte
            : '';
      return formattedJoinConditions(
        joinWithoutUuid,
        modelingState.from.model || modelingState.from.cte,
        joinTarget,
      );
    })
    .filter((joinItem) => {
      if (joinItem.type === 'cross') return true;
      if (joinItem.on === 'dims') return true;

      if ('on' in joinItem && joinItem.on) {
        if ('expr' in joinItem.on && Array.isArray(joinItem.on.expr)) {
          // TODO: Remove this once we have a way to validate the conditions and return false if the conditions are not valid
          return true;
          //return joinItem.on.expr.length > 0;
        }
        if ('and' in joinItem.on && Array.isArray(joinItem.on.and)) {
          // TODO: Remove this once we have a way to validate the conditions and return false if the conditions are not valid
          return true;
          //return joinItem.on.and.length > 0;
        }
      }
      // TODO: Remove this once we have a way to validate the conditions and return false if the conditions are not valid
      return true;
    });

  return validJoins.length > 0 ? validJoins : null;
};

// Build transformation configs (rollup, lookback, union)
export const buildTransformationConfigs = (
  basicFields: { type: string },
  modelingState: ModelingStateAdapter,
): Record<string, unknown> => {
  const configs: Record<string, unknown> = {};

  // Rollup
  if (
    basicFields.type === 'int_rollup_model' &&
    (modelingState.rollup.interval || modelingState.rollup.dateExpression)
  ) {
    configs.rollup = {
      interval: modelingState.rollup.interval,
      datetime_expr: modelingState.rollup.dateExpression,
    };
  }

  // Lookback
  if (
    basicFields.type === 'int_lookback_model' &&
    modelingState.lookback &&
    (modelingState.lookback.days > 0 ||
      modelingState.lookback.exclude_event_date)
  ) {
    configs.lookback = {
      days: modelingState.lookback.days,
      exclude_event_date: modelingState.lookback.exclude_event_date,
    };
  }

  // Union
  if (basicFields.type === 'stg_union_sources') {
    configs.union = {
      type: modelingState.union.type || 'all',
      sources: modelingState.union.sources || modelingState.union.models,
    };
  } else if (
    basicFields.type === 'int_union_models' &&
    modelingState.union.models &&
    modelingState.union.models.length > 0
  ) {
    configs.union = {
      type: modelingState.union.type || 'all',
      models: modelingState.union.models,
    };
  }

  return configs;
};

// Build SELECT configuration
export const buildSelectConfig = (
  basicFields: { type: string },
  modelingState: ModelingStateAdapter,
): Record<string, unknown>[] | null => {
  if (!modelingState.select || basicFields.type === 'int_rollup_model')
    return null;

  return modelingState.select
    .filter((selectItem) => selectItem) // Keep all valid select items
    .map((selectItem) => {
      // Handle string column names (SchemaColumnName) - return as-is
      if (typeof selectItem === 'string') {
        return selectItem;
      }

      // Handle expr-based columns (SchemaModelSelectExpr, SchemaModelSelectExprWithAgg, etc.)
      if ('expr' in selectItem && 'name' in selectItem) {
        // Return the entire expr-based column object (it's already in the correct schema format)
        return selectItem as Record<string, unknown>;
      }

      // Handle model-reference columns with name (SchemaModelSelectModelWithAgg, SchemaModelSelectModel)
      // These have 'model' AND 'name' - unlike model selection types (all_from_model, etc.) which only have 'model' and 'type'
      if ('model' in selectItem && 'name' in selectItem) {
        // Return the entire model-reference column object (it's already in the correct schema format)
        return selectItem as Record<string, unknown>;
      }

      // Handle model/source selection items (all_from_model, dims_from_model, fcts_from_model, all_from_source, etc.)
      if ('model' in selectItem || 'source' in selectItem) {
        const processed: Record<string, unknown> = {};

        // For union sources staging models output 'source' instead of 'model'
        if (
          basicFields.type === 'stg_select_source' ||
          basicFields.type === 'stg_union_sources'
        ) {
          if ('source' in selectItem) {
            processed.source = selectItem.source;
          } else if ('model' in selectItem) {
            processed.source = selectItem.model;
          }
        } else {
          if ('model' in selectItem) {
            processed.model = selectItem.model;
          } else if ('source' in selectItem) {
            processed.model = selectItem.source;
          }
        }

        if ('type' in selectItem) {
          processed.type = selectItem.type;
        }

        // Add include/exclude only if they have items
        if (
          'include' in selectItem &&
          selectItem.include &&
          Array.isArray(selectItem.include) &&
          selectItem.include.length > 0
        ) {
          processed.include = selectItem.include;
        }
        if (
          'exclude' in selectItem &&
          selectItem.exclude &&
          Array.isArray(selectItem.exclude) &&
          selectItem.exclude.length > 0
        ) {
          processed.exclude = selectItem.exclude;
        }

        return processed;
      }

      // Fallback: return as-is for other types (SchemaModelSelectInterval, etc.)
      return selectItem as unknown as Record<string, unknown>;
    });
};

// Build Lightdash table configuration
export const buildLightdashTableConfig = (
  table?: SchemaModelLightdash['table'],
): Record<string, unknown> | null => {
  if (!table) return null;

  const tableConfig: Record<string, unknown> = {};
  const tableProperties = [
    'group_label',
    'label',
    'ai_hint',
    'group_details',
    'required_attributes',
    'required_filters',
    'sql_filter',
    'sql_where',
  ];

  tableProperties.forEach((prop) => {
    if (hasValue(table[prop as keyof typeof table])) {
      tableConfig[prop] = table[prop as keyof typeof table];
    }
  });

  return Object.keys(tableConfig).length > 0 ? tableConfig : null;
};

// Build Lightdash configuration
export const buildLightdashConfig = (
  modelingState: ModelingStateAdapter,
): Record<string, unknown> | null => {
  if (!modelingState.lightdash) return null;

  const tableConfig = buildLightdashTableConfig(modelingState.lightdash.table);
  const hasLightdashData =
    (modelingState.lightdash.metrics?.length || 0) > 0 ||
    // Use Array.isArray rather than .length so that an explicit [] (which
    // means "block metric inheritance from upstream") counts as data.
    Array.isArray(modelingState.lightdash.metrics_include) ||
    Array.isArray(modelingState.lightdash.metrics_exclude) ||
    modelingState.lightdash.case_sensitive !== undefined ||
    tableConfig !== null;

  if (!hasLightdashData) return null;

  const lightdashConfig: Record<string, unknown> = {};

  if (modelingState.lightdash.case_sensitive !== undefined) {
    lightdashConfig.case_sensitive = modelingState.lightdash.case_sensitive;
  }

  if (tableConfig) {
    lightdashConfig.table = tableConfig;
  }

  if (modelingState.lightdash.metrics?.length) {
    lightdashConfig.metrics = modelingState.lightdash.metrics.map((metric) => {
      const { id: _id, ...metricWithoutId } = metric as typeof metric & {
        id?: string;
      };
      return metricWithoutId;
    });
  }

  if (Array.isArray(modelingState.lightdash.metrics_include)) {
    lightdashConfig.metrics_include = modelingState.lightdash.metrics_include;
  }

  if (Array.isArray(modelingState.lightdash.metrics_exclude)) {
    lightdashConfig.metrics_exclude = modelingState.lightdash.metrics_exclude;
  }

  return lightdashConfig;
};

/**
 * Model types that allow GROUP BY functionality
 */
export const ALLOWED_TYPES_FOR_GROUPBY = [
  'int_join_column',
  'int_join_models',
  'int_lookback_model',
  'int_select_model',
  'mart_select_model',
  'mart_join_models',
] as const;

/**
 * Model types that allow WHERE clause functionality
 */
export const ALLOWED_TYPES_FOR_WHERE = [
  'stg_select_source',
  'stg_select_model',
  'stg_union_sources',
  'int_join_column',
  'int_join_models',
  'int_select_model',
  'int_union_models',
  'mart_join_models',
] as const;

/**
 * Type guard to check if a type is allowed for GROUP BY
 */
export const isGroupByAllowedType = (
  type: string,
): type is (typeof ALLOWED_TYPES_FOR_GROUPBY)[number] => {
  return (ALLOWED_TYPES_FOR_GROUPBY as readonly string[]).includes(type);
};

/**
 * Type guard to check if a type is allowed for WHERE clause
 */
export const isWhereAllowedType = (
  type: string,
): type is (typeof ALLOWED_TYPES_FOR_WHERE)[number] => {
  return (ALLOWED_TYPES_FOR_WHERE as readonly string[]).includes(type);
};

/**
 * Calculate the allowed action types based on the source and type
 * @param source - The model source (data layer)
 * @param type - The model type (dbt model type)
 * @returns Array of allowed ActionTypes
 */
export const calculateAllowedActionTypes = (source?: string, type?: string) => {
  const allowedActionTypes = [];

  // Only add lightdash if source is not 'staging'
  if (source !== 'staging') {
    allowedActionTypes.push(ActionType.LIGHTDASH);
  }

  if (type && isGroupByAllowedType(type)) {
    allowedActionTypes.push(ActionType.GROUPBY);
  }

  if (type && isWhereAllowedType(type)) {
    allowedActionTypes.push(ActionType.WHERE);
  }

  if (type && isCteCapableType(type)) {
    allowedActionTypes.push(ActionType.CTE);
  }

  return allowedActionTypes;
};
