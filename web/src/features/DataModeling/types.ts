export interface Column {
  name: string;
  dataType: string;
  type: 'dimension' | 'fact';
  description?: string;
}

export enum SelectionType {
  ALL_FROM_MODEL = 'all_from_model',
  DIMS_FROM_MODEL = 'dims_from_model',
  FCTS_FROM_MODEL = 'fcts_from_model',
  ALL_FROM_SOURCE = 'all_from_source',
  DIMS_FROM_SOURCE = 'dims_from_source',
  FCTS_FROM_SOURCE = 'fcts_from_source',
  ALL_FROM_CTE = 'all_from_cte',
  DIMS_FROM_CTE = 'dims_from_cte',
  FCTS_FROM_CTE = 'fcts_from_cte',
}

/**
 * Discriminates the upstream a SELECT/JOIN is reading from. Used in place of
 * the old `isSourceModel?: boolean` plumbing so the UI can also surface the
 * `_from_cte` bulk-directive variants when the parent has `from.cte`.
 */
export type SelectionSourceKind = 'model' | 'source' | 'cte';

/**
 * Returns the bulk-selection enum value matching the given source kind and
 * directive role. Keeps `ModelColumns`, `selectionUtils`, and `SelectNode`
 * in lockstep when emitting / matching `{all,dims,fcts}_from_{model,source,cte}`.
 */
export function selectionTypeFor(
  kind: SelectionSourceKind,
  role: 'all' | 'dims' | 'fcts',
): SelectionType {
  if (kind === 'cte') {
    if (role === 'all') return SelectionType.ALL_FROM_CTE;
    if (role === 'dims') return SelectionType.DIMS_FROM_CTE;
    return SelectionType.FCTS_FROM_CTE;
  }
  if (kind === 'source') {
    if (role === 'all') return SelectionType.ALL_FROM_SOURCE;
    if (role === 'dims') return SelectionType.DIMS_FROM_SOURCE;
    return SelectionType.FCTS_FROM_SOURCE;
  }
  if (role === 'all') return SelectionType.ALL_FROM_MODEL;
  if (role === 'dims') return SelectionType.DIMS_FROM_MODEL;
  return SelectionType.FCTS_FROM_MODEL;
}

export enum ActionType {
  LIGHTDASH = 'lightdash',
  GROUPBY = 'groupby',
  WHERE = 'where',
  CTE = 'cte',
}

// Column Type (schema values: 'dim' | 'fct')
export type ColumnTypeValue = 'dim' | 'fct';

export const COLUMN_TYPE_OPTIONS = [
  { value: 'dim' as ColumnTypeValue, label: 'Dimension' },
  { value: 'fct' as ColumnTypeValue, label: 'Metric' },
];

// Data Types (from schema)
export const DATA_TYPE_OPTIONS = [
  { value: 'bigint', label: 'Bigint' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Datetime' },
  { value: 'double', label: 'Double' },
  { value: 'integer', label: 'Integer' },
  { value: 'number', label: 'Number' },
  { value: 'row(date)', label: 'Row(Date)' },
  { value: 'row(varchar)', label: 'Row(Varchar)' },
  { value: 'string', label: 'String' },
  { value: 'timestamp', label: 'Timestamp' },
  { value: 'timestamp(0)', label: 'Timestamp(0)' },
  { value: 'timestamp(3)', label: 'Timestamp(3)' },
  { value: 'timestamp(6)', label: 'Timestamp(6)' },
  { value: 'varchar', label: 'Varchar' },
];

// Aggregation Types (from schema)
export type AggregationType =
  | 'count'
  | 'hll'
  | 'max'
  | 'min'
  | 'sum'
  | 'tdigest';

export const AGGREGATION_OPTIONS = [
  { value: 'count' as AggregationType, label: 'Count' },
  { value: 'hll' as AggregationType, label: 'HLL (HyperLogLog)' },
  { value: 'max' as AggregationType, label: 'Max' },
  { value: 'min' as AggregationType, label: 'Min' },
  { value: 'sum' as AggregationType, label: 'Sum' },
  { value: 'tdigest' as AggregationType, label: 'TDigest (Percentiles)' },
];

// Type alias for SelectionType values
export type SelectionTypeValues = `${SelectionType}`;

export enum LIGHTDASH_COL_CONFIGS {
  Dimension = 'Dimension',
  Metric = 'Metric',
  MetricsMerge = 'Metrics Merge',
}

export interface ModelSelectState {
  model: string;
  type: SelectionTypeValues;
  include?: string[];
  exclude?: string[];
}

export const COLUMN_TYPES = {
  DIMENSION: 'dimension',
  FACTS: 'fact',
};

// Node type constants for NavigationBar and DataModeling components
export const MODEL_TYPES = {
  SELECT: 'select',
  ROLLUP: 'rollup',
  UNION: 'union',
  JOIN: 'join',
  FROM: 'from',
  LOOKBACK: 'lookback',
  CTE: 'cte',
} as const;

// Schema-aware column selection support
// Model types that support SchemaColumnName (plain string) in their select array
export const MODELS_SUPPORTING_COLUMN_NAME = [
  'stg_select_source',
  'stg_select_model',
  'stg_union_sources',
  'int_select_model',
  'int_join_column',
  'int_lookback_model',
  'mart_select_model',
] as const;

// Model types that support SchemaModelSelectExpr (name + expr) but NOT SchemaColumnName
export const MODELS_SUPPORTING_EXPR_ONLY = [
  'int_join_models',
  'int_union_models',
  'mart_join_models',
] as const;

// Helper function to check if model type supports plain column names
export const supportsColumnName = (modelType: string): boolean =>
  MODELS_SUPPORTING_COLUMN_NAME.includes(
    modelType as (typeof MODELS_SUPPORTING_COLUMN_NAME)[number],
  );

// Helper function to check if model type only supports expr-based columns
export const supportsExprOnly = (modelType: string): boolean =>
  MODELS_SUPPORTING_EXPR_ONLY.includes(
    modelType as (typeof MODELS_SUPPORTING_EXPR_ONLY)[number],
  );

export const NODE_TYPES = {
  SELECT: 'selectNode',
  ADD_JOIN_BUTTON: 'addJoinButtonNode',
  ROLLUP: 'rollupNode',
  UNION: 'unionNode',
  JOIN: 'joinNode',
  FROM: 'fromNode',
  LOOKBACK: 'lookbackNode',
  COLUMN_SELECTION: 'columnSelectionNode',
  COLUMN_CONFIGURATION: 'columnConfigurationNode',
  LIGHTDASH: 'lightdashNode',
  GROUPBY: 'groupByNode',
  WHERE: 'whereNode',
  CTE: 'cteNode',
} as const;

// NavigationItem interface for shared use
export interface NavigationItem {
  label: string;
  key: string;
  nodeType?: string;
}

// Type alias for node type values
export type NodeType = (typeof MODEL_TYPES)[keyof typeof MODEL_TYPES];

// Navigation configuration functions
export const getTransformationNode = (key: string) => {
  switch (key) {
    case 'from':
      return { type: MODEL_TYPES.FROM, label: 'From' };
    case 'join':
      return { type: MODEL_TYPES.JOIN, label: 'Join' };
    case 'rollup':
      return { type: MODEL_TYPES.ROLLUP, label: 'Rollup' };
    case 'lookback':
      return { type: MODEL_TYPES.LOOKBACK, label: 'Lookback' };
    case 'union':
      return { type: MODEL_TYPES.UNION, label: 'Union' };
    case 'select':
      return { type: MODEL_TYPES.SELECT, label: 'Select' };
    default:
      return null;
  }
};

// Default navigation items configuration
export const DEFAULT_NAVIGATION_ITEMS: NavigationItem[] = [
  { label: 'From', key: 'from', nodeType: MODEL_TYPES.FROM },
  { label: 'Join', key: 'join', nodeType: MODEL_TYPES.JOIN },
  { label: 'Rollup', key: 'rollup', nodeType: MODEL_TYPES.ROLLUP },
  { label: 'Lookback', key: 'lookback', nodeType: MODEL_TYPES.LOOKBACK },
  { label: 'Union', key: 'union', nodeType: MODEL_TYPES.UNION },
  { label: 'Select', key: 'select', nodeType: MODEL_TYPES.SELECT },
];
// Node types that connect from ColumnSelectionNode (final processing stage)
export const FINAL_PROCESSING_NODE_TYPES = [
  'lightdashNode',
  'groupByNode',
  'whereNode',
] as const;

// Lightdash Standard Metrics (from schema: avg, count, etc.)
export const LIGHTDASH_STANDARD_METRICS = [
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'distinctcount', label: 'Distinct Count' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'p50', label: 'P50' },
  { value: 'p90', label: 'P90' },
  { value: 'p95', label: 'P95' },
  { value: 'p98', label: 'P98' },
  { value: 'sum', label: 'Sum' },
] as const;

export type LightdashStandardMetricValue =
  | 'avg'
  | 'count'
  | 'distinctcount'
  | 'max'
  | 'min'
  | 'p50'
  | 'p90'
  | 'p95'
  | 'p98'
  | 'sum';

// Lightdash Dimension Types (from schema)
export const LIGHTDASH_DIMENSION_TYPES = [
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'string', label: 'String' },
  { value: 'timestamp', label: 'Timestamp' },
] as const;

// Lightdash Format Options (from schema)
export const LIGHTDASH_FORMAT_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'eur', label: 'EUR (€)' },
  { value: 'gbp', label: 'GBP (£)' },
  { value: 'id', label: 'ID' },
  { value: 'km', label: 'KM' },
  { value: 'mi', label: 'MI' },
  { value: 'percent', label: 'Percent (%)' },
  { value: 'usd', label: 'USD ($)' },
] as const;

// Lightdash Compact Options (from schema)
export const LIGHTDASH_COMPACT_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'thousands', label: 'Thousands' },
  { value: 'millions', label: 'Millions' },
  { value: 'billions', label: 'Billions' },
  { value: 'trillions', label: 'Trillions' },
] as const;

// Lightdash Time Intervals (from schema)
export const LIGHTDASH_TIME_INTERVALS = [
  { value: 'DAY', label: 'Day' },
  { value: 'DAY_OF_WEEK_INDEX', label: 'Day of Week Index' },
  { value: 'DAY_OF_WEEK_NAME', label: 'Day of Week Name' },
  { value: 'DAY_OF_MONTH_NUM', label: 'Day of Month Number' },
  { value: 'DAY_OF_YEAR_NUM', label: 'Day of Year Number' },
  { value: 'HOUR', label: 'Hour' },
  { value: 'MONTH', label: 'Month' },
  { value: 'MONTH_NAME', label: 'Month Name' },
  { value: 'MONTH_NUM', label: 'Month Number' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'QUARTER_NAME', label: 'Quarter Name' },
  { value: 'QUARTER_NUM', label: 'Quarter Number' },
  { value: 'RAW', label: 'Raw' },
  { value: 'WEEK', label: 'Week' },
  { value: 'WEEK_NUM', label: 'Week Number' },
  { value: 'YEAR', label: 'Year' },
  { value: 'YEAR_NUM', label: 'Year Number' },
] as const;

// Interval options for SchemaModelSelectInterval (from schema)
export const INTERVAL_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'hour', label: 'Hour' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

// Data Test types
export const DATA_TEST_TYPES = [
  { value: 'not_null', label: 'Not Null' },
  { value: 'unique', label: 'Unique' },
  { value: 'accepted_values', label: 'Accepted Values' },
  { value: 'relationships', label: 'Relationships' },
] as const;

// Join condition row interface for JoinNode
export interface JoinConditionRow {
  id: string;
  type: 'column' | 'expression' | 'subquery';
  baseColumn?: string;
  condition?: string;
  joinColumn?: string;
  expression?: string;
  subqueryOperator?: string;
  subqueryColumn?: string;
  subquerySelect?: string;
  subqueryFromType?: 'model' | 'source' | 'cte';
  subqueryFromValue?: string;
  subqueryWhere?: string;
}

// =============================================================================
// Data Type Display Utilities
// =============================================================================

/** Complex type patterns that should be truncated with tooltips */
const COMPLEX_TYPE_PATTERNS = ['ROW', 'ARRAY', 'STRUCT', 'MAP'];

/**
 * Check if a data type is complex (contains nested structure).
 * Complex types like row(...), array(...), struct(...), map(...) should be truncated.
 */
export function isComplexDataType(dataType?: string): boolean {
  if (!dataType) return false;
  const type = dataType.toUpperCase();
  return COMPLEX_TYPE_PATTERNS.some(
    (pattern) => type.includes(pattern) && type.includes('('),
  );
}

/**
 * Get the display name for a data type.
 * For complex types, returns just the base type (e.g., "row" instead of "row(...)").
 */
export function getDisplayDataType(dataType?: string): string {
  if (!dataType) return '';

  const type = dataType.toUpperCase();
  for (const pattern of COMPLEX_TYPE_PATTERNS) {
    if (type.startsWith(pattern + '(')) {
      return pattern.toLowerCase();
    }
  }

  return dataType;
}
