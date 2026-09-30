export type DataCheckTemplateId =
  | 'stranded_capacity'
  | 'utilization_band'
  | 'recent_partition_window';

export type DataCheckParams = Record<string, string | number | boolean>;

export function buildDataCheckSql(
  template: DataCheckTemplateId,
  params: DataCheckParams,
): { sql: string; description: string } {
  switch (template) {
    case 'stranded_capacity': {
      const relation =
        typeof params.relation === 'string'
          ? params.relation
          : 'compiled_model_subquery';
      const limit = Number(params.limit ?? 100);
      return {
        description:
          'Row-level stranded capacity (allocated minus used) for sanity checks.',
        sql: `SELECT *,
  (allocated_gb - used_gb) AS stranded_gb
FROM ${relation}
WHERE allocated_gb IS NOT NULL
LIMIT ${limit}`,
      };
    }
    case 'utilization_band': {
      const relation =
        typeof params.relation === 'string' ? params.relation : 'compiled_model_subquery';
      const limit = Number(params.limit ?? 100);
      return {
        description: 'Utilization percentage band check (0–100%).',
        sql: `SELECT *,
  100.0 * used_gb / NULLIF(allocated_gb, 0) AS utilization_pct
FROM ${relation}
WHERE allocated_gb > 0
LIMIT ${limit}`,
      };
    }
    case 'recent_partition_window': {
      const relation =
        typeof params.relation === 'string' ? params.relation : 'compiled_model_subquery';
      const days = Number(params.days ?? 7);
      const limit = Number(params.limit ?? 500);
      return {
        description: `Recent portal_partition_daily window (last ${days} days).`,
        sql: `SELECT *
FROM ${relation}
WHERE portal_partition_daily >= date_add('day', -${days}, current_date)
ORDER BY portal_partition_daily DESC
LIMIT ${limit}`,
      };
    }
    default:
      throw new Error(`Unknown data-check template: ${template}`);
  }
}
