/**
 * Keys preserved when round-tripping model JSON through `frameworkMakeModelTemplate`
 * (wizard/create API shape). The template whitelists wizard fields; passthrough keeps
 * author-authored schema fields agents send on create/preview.
 */
export const MODEL_JSON_PASSTHROUGH_KEYS = [
  'materialization',
  'materialized',
  'having',
  'data_tests',
  'meta',
  'depends_on',
  'unique_key',
  'incremental_strategy',
  'partitioned_by',
  'sql_hooks',
  'tags',
  'description',
  'ctes',
  'select',
  'from',
  'group_by',
  'where',
  'lightdash',
  'exclude_daily_filter',
  'exclude_date_filter',
  'exclude_datetime',
  'exclude_framework_artifacts',
  'exclude_portal_partition_columns',
  'exclude_portal_source_count',
] as const;

export function mergeModelJsonPassthrough<T extends Record<string, unknown>>(
  templated: T,
  source: Record<string, unknown>,
): T {
  const merged: Record<string, unknown> = { ...templated };
  for (const key of MODEL_JSON_PASSTHROUGH_KEYS) {
    if (key in source && source[key] !== undefined) {
      merged[key] = source[key];
    }
  }
  return merged as T;
}
