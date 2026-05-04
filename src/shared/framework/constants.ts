import type { SchemaModelGroupBy } from '@shared/schema/types/model.group_by.schema';

import type { DefaultIncrementalStrategy } from './types';

/**
 * Single source of truth for the default incremental strategy applied when
 * a model uses `materialization: "incremental"` without an explicit
 * `strategy`, and the `dj.materialization.defaultIncrementalStrategy`
 * setting is unset.
 *
 * To change the global default, update this one value **and** the `default`
 * in `package.json`
 * (contributes.configuration.*.dj.materialization.defaultIncrementalStrategy
 * .default) in lockstep, since VS Code's JSON settings schema cannot
 * reference TS constants. All other fallback sites (config.ts, sql-utils.ts,
 * preferences-handler.ts, the web store, the web mock api) route through
 * this constant, so those two edits are the full surface area.
 *
 * Next release: switch to `'delete+insert'` as the safer cross-storage
 * default. Kept at `'overwrite_existing_partitions'` for now to avoid
 * behavior drift for existing workspaces that don't override the setting.
 */
export const DEFAULT_INCREMENTAL_STRATEGY: DefaultIncrementalStrategy =
  'overwrite_existing_partitions';

export const BULK_SELECT_TYPES = {
  ALL_FROM_MODEL: 'all_from_model',
  DIMS_FROM_MODEL: 'dims_from_model',
  FCTS_FROM_MODEL: 'fcts_from_model',
  ALL_FROM_SOURCE: 'all_from_source',
  ALL_FROM_CTE: 'all_from_cte',
  DIMS_FROM_CTE: 'dims_from_cte',
  FCTS_FROM_CTE: 'fcts_from_cte',
} as const;

export type BulkSelectType =
  (typeof BULK_SELECT_TYPES)[keyof typeof BULK_SELECT_TYPES];

export const BULK_CTE_TYPES = new Set<string>([
  BULK_SELECT_TYPES.ALL_FROM_CTE,
  BULK_SELECT_TYPES.DIMS_FROM_CTE,
  BULK_SELECT_TYPES.FCTS_FROM_CTE,
]);

export const BULK_MODEL_TYPES = new Set<string>([
  BULK_SELECT_TYPES.ALL_FROM_MODEL,
  BULK_SELECT_TYPES.DIMS_FROM_MODEL,
  BULK_SELECT_TYPES.FCTS_FROM_MODEL,
]);

/** Types that select only dimension columns (meta.type !== 'fct') */
export const DIMS_BULK_TYPES = new Set<string>([
  BULK_SELECT_TYPES.DIMS_FROM_CTE,
  BULK_SELECT_TYPES.DIMS_FROM_MODEL,
]);

/** Types that select only fact/measure columns (meta.type === 'fct') */
export const FCTS_BULK_TYPES = new Set<string>([
  BULK_SELECT_TYPES.FCTS_FROM_CTE,
  BULK_SELECT_TYPES.FCTS_FROM_MODEL,
]);

export const JOIN_ON_DIMS = 'dims' as const;

/** The array variant of SchemaModelGroupBy (excludes the "dims" string shorthand). */
export type SchemaModelGroupByArray = Exclude<SchemaModelGroupBy, string>;

export const GROUP_BY_DIMS = 'dims' as const;

/**
 * Normalizes the group_by value: converts the `"dims"` string shorthand
 * to its canonical array form `[{ type: "dims" }]`, passing arrays through
 * unchanged. Call this at entry points so downstream code only sees arrays.
 */
export function normalizeGroupBy(
  groupBy: SchemaModelGroupBy | null | undefined,
): SchemaModelGroupByArray | null | undefined {
  if (groupBy === GROUP_BY_DIMS) {
    return [{ type: 'dims' }];
  }
  return groupBy;
}
