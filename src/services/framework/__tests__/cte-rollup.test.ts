import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
  frameworkGenerateModelOutput,
} from '@services/framework/utils';
import {
  validateCteRollupSource,
  validateExcludeDatetimeRollupConflict,
} from '@services/modelValidation';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Coverage for `from.rollup` declared on individual CTE entries (not the
 * main model). Tests the three pieces that change shape:
 *
 *   - registry inference: rolled-up `datetime`, dropped finer-grain
 *     `portal_partition_*`, suffix-agg fct columns flowing through.
 *   - SQL generation: `date_trunc(...) as datetime`, synthesized `GROUP BY`
 *     when not user-authored, fct columns wrapped with their suffix-agg.
 *   - validators: cross-scope `exclude_datetime`/`exclude_framework_artifacts`
 *     conflict detection at the CTE scope, plus the upstream-CTE-strips-
 *     datetime check from `validateCteRollupSource`.
 */

function projectWithRollupSourceModel(
  upstreamInterval: 'hour' | 'day' | 'month' = 'day',
) {
  return createTestProject({
    nodes: {
      ['model.project.stg_events']: {
        columns: {
          region: {
            name: 'region',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          category: {
            name: 'category',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          amount_sum: {
            name: 'amount_sum',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          datetime: {
            name: 'datetime',
            data_type: 'timestamp(6)',
            meta: {
              type: 'dim',
              dimension: { time_intervals: ['DAY'] },
            },
            internal: { interval: upstreamInterval },
          },
          portal_partition_monthly: {
            name: 'portal_partition_monthly',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          portal_partition_daily: {
            name: 'portal_partition_daily',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          portal_partition_hourly: {
            name: 'portal_partition_hourly',
            data_type: 'timestamp(0)',
            meta: { type: 'dim' },
          },
          portal_source_count: {
            name: 'portal_source_count',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
        },
      },
    },
  });
}

describe('CTE Rollup', () => {
  describe('Column Inference', () => {
    test('from.model + rollup yields datetime at rollup grain with date_trunc expr', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly_costs',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const cols = registry.get('monthly_costs')!;
      const datetime = cols.find((c) => c.name === 'datetime');

      expect(datetime).toBeDefined();
      expect(datetime!.internal?.interval).toBe('month');
      expect(datetime!.internal?.expr).toBe("date_trunc('month', datetime)");
    });

    test('from.model + rollup drops finer-grain portal_partition_* columns', () => {
      const project = projectWithRollupSourceModel('hour');
      const cte: FrameworkCTE = {
        name: 'monthly_costs',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [{ name: 'category', type: 'dim' }],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const names = registry.get('monthly_costs')!.map((c) => c.name);

      expect(names).toContain('portal_partition_monthly');
      expect(names).not.toContain('portal_partition_daily');
      expect(names).not.toContain('portal_partition_hourly');
    });

    test('rollup at hour grain keeps all three partition columns', () => {
      const project = projectWithRollupSourceModel('hour');
      const cte: FrameworkCTE = {
        name: 'hourly',
        from: { model: 'stg_events', rollup: { interval: 'hour' } },
        select: [{ name: 'category', type: 'dim' }],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const names = registry.get('hourly')!.map((c) => c.name);

      expect(names).toContain('portal_partition_monthly');
      expect(names).toContain('portal_partition_daily');
      expect(names).toContain('portal_partition_hourly');
    });

    test('from.cte + rollup transforms inherited datetime from upstream CTE', () => {
      const project = projectWithRollupSourceModel('day');
      const ctes: FrameworkCTE[] = [
        {
          name: 'daily',
          from: { model: 'stg_events' },
          select: [
            { name: 'category', type: 'dim' },
            { name: 'amount_sum', type: 'fct' },
          ],
        },
        {
          name: 'monthly',
          from: { cte: 'daily', rollup: { interval: 'month' } },
          select: [{ type: 'all_from_cte', cte: 'daily' }],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const monthly = registry.get('monthly')!;
      const datetime = monthly.find((c) => c.name === 'datetime');

      expect(datetime!.internal?.interval).toBe('month');
      expect(datetime!.internal?.expr).toBe("date_trunc('month', datetime)");
      expect(monthly.map((c) => c.name)).not.toContain(
        'portal_partition_daily',
      );
    });

    test('from.cte + rollup auto-injects datetime when select omits it', () => {
      const project = projectWithRollupSourceModel('day');
      const ctes: FrameworkCTE[] = [
        {
          name: 'daily',
          from: { model: 'stg_events' },
          select: [
            { name: 'category', type: 'dim' },
            { name: 'amount_sum', type: 'fct' },
          ],
        },
        {
          name: 'monthly',
          from: { cte: 'daily', rollup: { interval: 'month' } },
          select: [{ name: 'category', type: 'dim' }],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const monthly = registry.get('monthly')!;
      const datetime = monthly.find((c) => c.name === 'datetime');

      expect(datetime).toBeDefined();
      expect(datetime!.internal?.interval).toBe('month');
      expect(datetime!.internal?.expr).toBe("date_trunc('month', datetime)");
    });

    test('chained rollups: B (year) reads month-grain interval from rolled-up A', () => {
      const project = projectWithRollupSourceModel('day');
      const ctes: FrameworkCTE[] = [
        {
          name: 'monthly',
          from: { model: 'stg_events', rollup: { interval: 'month' } },
          select: [{ name: 'category', type: 'dim' }],
        },
        {
          name: 'yearly',
          from: { cte: 'monthly', rollup: { interval: 'year' } },
          select: [{ name: 'category', type: 'dim' }],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const yearly = registry.get('yearly')!;
      const datetime = yearly.find((c) => c.name === 'datetime');

      expect(datetime!.internal?.interval).toBe('year');
      // Source for the date_trunc is the upstream CTE's `datetime` (month),
      // so the truncation expression is built relative to that grain.
      expect(datetime!.internal?.expr).toBe("date_trunc('year', datetime)");
    });

    test('rolled-up datetime preserves user-set Lightdash dimension overrides', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'rolled',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          {
            name: 'datetime',
            type: 'dim',
            interval: 'month',
            lightdash: {
              dimension: { hidden: true, label: 'Reporting Month' },
            },
          } as any,
          { name: 'category', type: 'dim' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const datetime = registry
        .get('rolled')!
        .find((c) => c.name === 'datetime');

      expect(datetime!.meta.dimension?.hidden).toBe(true);
      expect(datetime!.meta.dimension?.label).toBe('Reporting Month');
    });
  });

  describe('SQL Generation', () => {
    test('emits date_trunc(...) as datetime in CTE SELECT', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        project,
      });

      expect(sql).toContain("date_trunc('month', datetime) as datetime");
    });

    test('synthesizes GROUP BY on dim columns when group_by is not authored', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        project,
      });

      expect(sql).toMatch(/group by/);
      expect(sql).toContain('category');
      // GROUP BY references the truncation expression (Trino resolves
      // identifiers against input columns, not SELECT aliases).
      expect(sql).toContain("date_trunc('month', datetime)");
    });

    test('honors explicit user group_by over the rollup default', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
        group_by: [{ expr: 'category' }],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        project,
      });

      expect(sql).toContain('group by category');
      // The synthesized "all dims" GROUP BY should NOT have run.
      expect(sql).not.toMatch(/group by date_trunc/);
    });

    test('wraps fct columns with suffix-agg via frameworkBuildAggSql', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        project,
      });

      expect(sql).toMatch(/sum\(amount_sum\) as amount_sum/);
    });

    test('does not double-wrap explicitly aggregated columns', () => {
      const project = projectWithRollupSourceModel('day');
      const cte: FrameworkCTE = {
        name: 'monthly',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct', agg: 'sum' } as any,
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        project,
      });

      // The explicit `agg: 'sum'` already produced its own wrap; the rollup
      // rewrite should leave it alone (no `sum(sum(...))`).
      expect(sql).not.toMatch(/sum\(sum\(/);
    });

    test('chained rollup: B emits date_trunc(year, datetime) when source is month-grain CTE', () => {
      const project = projectWithRollupSourceModel('day');
      const ctes: FrameworkCTE[] = [
        {
          name: 'monthly',
          from: { model: 'stg_events', rollup: { interval: 'month' } },
          select: [{ name: 'category', type: 'dim' }],
        },
        {
          name: 'yearly',
          from: { cte: 'monthly', rollup: { interval: 'year' } },
          select: [{ type: 'all_from_cte', cte: 'monthly' }],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });

      expect(sql).toContain("date_trunc('year', datetime) as datetime");
    });
  });

  describe('Validators', () => {
    test('CTE-level exclude_datetime + from.rollup → conflict error', () => {
      const errors = validateExcludeDatetimeRollupConflict({
        type: 'int_select_model',
        from: { model: 'stg_events' },
        ctes: [
          {
            name: 'rolled',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [{ name: 'category', type: 'dim' }],
            exclude_datetime: true,
          },
        ],
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].instancePath).toBe('/ctes/0/exclude_datetime');
      expect(errors[0].message).toContain('CTE "rolled"');
      expect(errors[0].message).toContain('from.rollup');
    });

    test('CTE-level exclude_framework_artifacts: "all" + from.rollup → conflict error', () => {
      const errors = validateExcludeDatetimeRollupConflict({
        type: 'int_select_model',
        from: { model: 'stg_events' },
        ctes: [
          {
            name: 'rolled',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [{ name: 'category', type: 'dim' }],
            exclude_framework_artifacts: 'all',
          },
        ],
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].instancePath).toBe(
        '/ctes/0/exclude_framework_artifacts',
      );
      expect(errors[0].message).toContain('"all"');
    });

    test('exclude_datetime: false on rolled-up CTE silences the error', () => {
      const errors = validateExcludeDatetimeRollupConflict({
        type: 'int_select_model',
        from: { model: 'stg_events' },
        ctes: [
          {
            name: 'rolled',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [{ name: 'category', type: 'dim' }],
            exclude_framework_artifacts: 'all',
            exclude_datetime: false,
          },
        ],
      });

      expect(errors).toEqual([]);
    });

    test('CTE rolling up from a CTE that excludes datetime → validateCteRollupSource error', () => {
      const errors = validateCteRollupSource({
        type: 'int_select_model',
        from: { model: 'stg_events' },
        ctes: [
          {
            name: 'lookup',
            from: { model: 'stg_events' },
            select: [{ name: 'category', type: 'dim' }],
            exclude_datetime: true,
          },
          {
            name: 'rolled',
            from: { cte: 'lookup', rollup: { interval: 'month' } },
            select: [{ name: 'category', type: 'dim' }],
          },
        ],
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].instancePath).toBe('/ctes/1/from/rollup');
      expect(errors[0].message).toContain('rolled');
      expect(errors[0].message).toContain('lookup');
    });

    test('chaining a rollup CTE off another rollup CTE → no error', () => {
      const errors = validateCteRollupSource({
        type: 'int_select_model',
        from: { model: 'stg_events' },
        ctes: [
          {
            name: 'monthly',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [{ name: 'category', type: 'dim' }],
          },
          {
            name: 'yearly',
            from: { cte: 'monthly', rollup: { interval: 'year' } },
            select: [{ name: 'category', type: 'dim' }],
          },
        ],
      });

      expect(errors).toEqual([]);
    });
  });

  describe('Custom Meta Propagation', () => {
    // Free-form meta keys live on the upstream manifest column. The CTE
    // rollup transform only touches `meta.type`, `meta.dimension`, and
    // `internal.{interval,expr}` -- it must NOT strip user keys like `pii`
    // or `owner` that ride through the standard column-meta merge pipeline.
    function projectWithMetaTaggedColumns() {
      return createTestProject({
        nodes: {
          ['model.project.stg_events']: {
            columns: {
              category: {
                name: 'category',
                data_type: 'varchar',
                meta: {
                  type: 'dim',
                  pii: false,
                  owner: 'finance',
                  compliance: ['gdpr'],
                },
              },
              amount_sum: {
                name: 'amount_sum',
                data_type: 'bigint',
                meta: { type: 'fct' },
              },
              datetime: {
                name: 'datetime',
                data_type: 'timestamp(6)',
                meta: {
                  type: 'dim',
                  dimension: { time_intervals: ['DAY'] },
                  reporting_grain: 'event_time',
                },
                internal: { interval: 'day' },
              },
              portal_partition_monthly: {
                name: 'portal_partition_monthly',
                data_type: 'date',
                meta: { type: 'dim' },
              },
              portal_partition_daily: {
                name: 'portal_partition_daily',
                data_type: 'date',
                meta: { type: 'dim' },
              },
            },
          },
        },
      });
    }

    test('upstream column free-form meta keys flow through CTE rollup unchanged', () => {
      const project = projectWithMetaTaggedColumns();
      const cte: FrameworkCTE = {
        name: 'rolled',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [
          { name: 'category', type: 'dim' },
          { name: 'amount_sum', type: 'fct' },
        ],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const category = registry
        .get('rolled')!
        .find((c) => c.name === 'category');

      expect(category?.meta).toMatchObject({
        pii: false,
        owner: 'finance',
        compliance: ['gdpr'],
      });
    });

    test('upstream datetime free-form meta survives the rollup rewrite', () => {
      const project = projectWithMetaTaggedColumns();
      const cte: FrameworkCTE = {
        name: 'rolled',
        from: { model: 'stg_events', rollup: { interval: 'month' } },
        select: [{ name: 'category', type: 'dim' }],
      };

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project,
      });
      const datetime = registry
        .get('rolled')!
        .find((c) => c.name === 'datetime');

      // The rollup transform must not strip the upstream's `reporting_grain`
      // free-form key while it rewrites the structured fields underneath.
      expect((datetime?.meta as any)?.reporting_grain).toBe('event_time');
      expect(datetime?.internal?.interval).toBe('month');
      expect(datetime?.internal?.expr).toBe("date_trunc('month', datetime)");
    });
  });

  describe('End-to-End Model Output Parity', () => {
    test('rollup-in-CTE produces a working compiled SQL with rollup grain visible', () => {
      const project = projectWithRollupSourceModel('day');
      const dj = createTestDJ();
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'analytics',
        topic: 'cost',
        name: 'monthly_costs',
        ctes: [
          {
            name: 'monthly',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [
              { name: 'category', type: 'dim' },
              { name: 'amount_sum', type: 'fct' },
            ],
          },
        ],
        from: { cte: 'monthly' },
        select: [{ type: 'all_from_cte', cte: 'monthly' }],
      } as any;

      const output = frameworkGenerateModelOutput({ dj, modelJson, project });
      // The post-emit SQL formatter uppercases keywords; assert the rollup
      // grain is visible regardless of casing.
      expect(output.sql.toLowerCase()).toContain('with\n\tmonthly as');
      expect(output.sql.toLowerCase()).toContain(
        "date_trunc('month', datetime) as datetime",
      );
      expect(output.sql.toLowerCase()).toMatch(
        /sum\(amount_sum\) as amount_sum/,
      );
    });

    // The rollup CTE writes `internal.expr = "date_trunc(...)"` on its
    // datetime registry entry so its own emitted SQL truncates correctly.
    // That metadata used to leak into downstream CTE registries and the
    // main-model column registry via mergeDeep, which made the main-model
    // SELECT and GROUP BY redundantly re-emit `date_trunc('month', datetime)`
    // even though the upstream CTE had already materialized that column.
    // The fix strips `internal.{agg,expr,prefix}` at the CTE -> main-model
    // boundary so passthrough references emit the bare column name.
    test('main model selecting `datetime` from a passthrough chain off a rollup CTE emits bare datetime (no redundant date_trunc)', () => {
      const project = projectWithRollupSourceModel('day');
      const dj = createTestDJ();
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'analytics',
        topic: 'cost',
        name: 'final_monthly',
        ctes: [
          {
            name: 'rolled',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [
              { name: 'datetime', type: 'dim' },
              { name: 'category', type: 'dim' },
              { name: 'amount_sum', type: 'fct' },
            ],
          },
          {
            name: 'passthrough',
            from: { cte: 'rolled' },
            select: [
              { name: 'datetime', type: 'dim' },
              { name: 'category', type: 'dim' },
              { name: 'amount_sum', expr: 'amount_sum', type: 'fct' },
            ],
          },
        ],
        from: { cte: 'passthrough' },
        select: [
          { name: 'datetime', type: 'dim' },
          { type: 'fct', name: 'total', expr: 'sum(amount_sum)' },
        ],
        group_by: [{ type: 'dims' }],
        exclude_date_filter: true,
        exclude_portal_source_count: true,
      } as any;

      const output = frameworkGenerateModelOutput({ dj, modelJson, project });
      const sql = output.sql.toLowerCase();

      // Rollup CTE still emits its own truncation -- that's its job. It
      // appears exactly twice (SELECT + GROUP BY) and ONLY in the `rolled`
      // CTE: not in `passthrough`, not in the wrapper SELECT or GROUP BY.
      const truncationCount = (
        sql.match(/date_trunc\('month', datetime\)/g) || []
      ).length;
      expect(truncationCount).toBe(2);

      // Wrapper SELECT references the bare datetime column produced by the
      // passthrough CTE. With the strip in place, downstream chains see
      // `datetime` not `date_trunc('month', datetime)`.
      expect(sql).toMatch(
        /int__analytics__cost__final_monthly as \([^)]*\bdatetime\b/,
      );
    });

    // Counter-test: when the main-model select asks for a coarser grain than
    // the upstream CTE column, the explicit `interval` override must still
    // emit `date_trunc(...)`. This is the documented same-grain skip in
    // `frameworkBuildDatetimeColumn`: only matching intervals collapse.
    test('main model with explicit different-grain interval still emits date_trunc', () => {
      const project = projectWithRollupSourceModel('day');
      const dj = createTestDJ();
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'analytics',
        topic: 'cost',
        name: 'yearly_view',
        ctes: [
          {
            name: 'rolled',
            from: { model: 'stg_events', rollup: { interval: 'month' } },
            select: [
              { name: 'datetime', type: 'dim' },
              { name: 'category', type: 'dim' },
              { name: 'amount_sum', type: 'fct' },
            ],
          },
        ],
        from: { cte: 'rolled' },
        select: [
          { name: 'datetime', type: 'dim', interval: 'year' },
          { type: 'fct', name: 'total', expr: 'sum(amount_sum)' },
        ],
        group_by: [{ type: 'dims' }],
        exclude_date_filter: true,
        exclude_portal_source_count: true,
      } as any;

      const output = frameworkGenerateModelOutput({ dj, modelJson, project });
      const sql = output.sql.toLowerCase();

      // The rollup CTE still emits its own month-grain truncation.
      expect(sql).toContain("date_trunc('month', datetime) as datetime");
      // The main-model wrapper retruncates to year because the requested
      // grain differs from the upstream CTE column's interval.
      expect(sql).toContain("date_trunc('year', datetime)");
    });
  });
});
