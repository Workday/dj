import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
} from '@services/framework/utils';
import type { FrameworkCTE } from '@shared/framework/types';

import { createTestProject } from './helpers';

/**
 * Verifies that `datetime` and `portal_partition_*` columns auto-inject into
 * CTEs whose FROM is a plain `{ model }` ref, mirroring the main-model
 * behavior in `frameworkModelColumns` (L727-744 of column-utils.ts).
 *
 * Before this fix a `dims_from_model` bulk select with a small `include` list,
 * or a pre-aggregation CTE that only enumerated non-partition dims, would
 * silently drop `portal_partition_*` -- causing downstream materialization to
 * fail because `partitioned_by` could not find the columns.
 *
 * The registry (`frameworkInferCteColumns`) and the SQL emitter
 * (`frameworkGenerateCteSql`) both go through
 * `frameworkShouldAutoInjectCteFrameworkDims`, so this file asserts both sides
 * stay in lock-step.
 */

function projectWithDatetimeAndPartitions(
  datetimeInterval: 'hour' | 'day' | 'month' | 'year' = 'hour',
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
          tenant_name: {
            name: 'tenant_name',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          amount: {
            name: 'amount',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          datetime: {
            name: 'datetime',
            data_type: 'timestamp(6)',
            meta: { type: 'dim', interval: datetimeInterval },
          },
          portal_partition_monthly: {
            name: 'portal_partition_monthly',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          portal_partition_daily: {
            name: 'portal_partition_daily',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          portal_partition_hourly: {
            name: 'portal_partition_hourly',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          portal_source_count: {
            name: 'portal_source_count',
            data_type: 'bigint',
            meta: {
              type: 'fct',
              dimension: { label: 'Portal Source Count', hidden: true },
            },
          },
        },
      },
    },
  });
}

describe('CTE datetime + portal_partition_* auto-injection', () => {
  test('registry injects datetime + all partitions when CTE does not declare them', () => {
    const project = projectWithDatetimeAndPartitions('hour');
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const names = registry.get('pre_agg')!.map((c) => c.name);

    expect(names).toContain('datetime');
    expect(names).toContain('portal_partition_monthly');
    expect(names).toContain('portal_partition_daily');
    expect(names).toContain('portal_partition_hourly');
  });

  // Covers both explicit CTE interval and upstream-inherited interval. One
  // row per distinct exclusion shape is enough -- the exclusion logic is
  // shared between `main-model auto-inject` and `CTE auto-inject` in
  // `frameworkGetRollupInputs`.
  test.each<{
    label: string;
    upstream: 'hour' | 'day' | 'month' | 'year';
    cteDatetime?: { interval: 'day' | 'month' | 'year' };
    expected: Record<'monthly' | 'daily' | 'hourly', boolean>;
  }>([
    {
      label: 'explicit CTE interval "day" drops hourly',
      upstream: 'hour',
      cteDatetime: { interval: 'day' },
      expected: { monthly: true, daily: true, hourly: false },
    },
    {
      label: 'explicit CTE interval "month" drops daily + hourly',
      upstream: 'hour',
      cteDatetime: { interval: 'month' },
      expected: { monthly: true, daily: false, hourly: false },
    },
    {
      label: 'upstream interval "day" inherited when CTE is silent',
      upstream: 'day',
      cteDatetime: undefined,
      expected: { monthly: true, daily: true, hourly: false },
    },
  ])('registry: $label', ({ upstream, cteDatetime, expected }) => {
    const project = projectWithDatetimeAndPartitions(upstream);
    const select: any[] = [{ name: 'region', type: 'dim' }];
    if (cteDatetime) {
      select.push({ name: 'datetime', interval: cteDatetime.interval });
    }
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select,
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const names = registry.get('pre_agg')!.map((c) => c.name);

    expect(names.includes('portal_partition_monthly')).toBe(expected.monthly);
    expect(names.includes('portal_partition_daily')).toBe(expected.daily);
    expect(names.includes('portal_partition_hourly')).toBe(expected.hourly);
  });

  test('registry does NOT duplicate when user already declared a partition', () => {
    const project = projectWithDatetimeAndPartitions('hour');
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }, 'portal_partition_monthly'],
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const cols = registry.get('pre_agg')!;
    expect(
      cols.filter((c) => c.name === 'portal_partition_monthly'),
    ).toHaveLength(1);
  });

  // Regression: auto-injected framework dims (`datetime`, `portal_partition_*`)
  // must NOT stamp `meta.origin.id = modelId`. Doing so cascades a spurious
  // origin through every downstream YAML. Main-model auto-inject doesn't stamp
  // either (see `frameworkModelColumns` in column-utils.ts), so CTE auto-inject
  // must match.
  test('registry preserves upstream origin on auto-injected framework dims', () => {
    const project = projectWithDatetimeAndPartitions('hour');
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
      modelId: 'model.project.my_intermediate',
    });
    const cols = registry.get('pre_agg')!;
    const partition = cols.find((c) => c.name === 'portal_partition_monthly');
    const datetime = cols.find((c) => c.name === 'datetime');
    expect(partition).toBeDefined();
    expect(datetime).toBeDefined();
    expect(partition!.meta.origin?.id).toBeUndefined();
    expect(datetime!.meta.origin?.id).toBeUndefined();
  });

  // Auto-inject only fires for `from: { model }`. Chained CTEs (`from: cte`)
  // and union CTEs (`from.union`) must not trigger it -- they rely on the
  // upstream CTE / union branches to carry the partitions through explicitly.
  test.each<{ label: string; cte: FrameworkCTE; extraCtes?: FrameworkCTE[] }>([
    {
      label: 'from: { cte } does not trigger auto-inject',
      cte: {
        name: 'chained',
        from: { cte: 'base' },
        select: [{ name: 'region', type: 'dim' }],
      } as any,
      extraCtes: [
        {
          name: 'base',
          from: { model: 'stg_events' },
          select: [{ name: 'region', type: 'dim' }],
        } as any,
      ],
    },
    {
      label: 'from.union does not trigger auto-inject',
      cte: {
        name: 'combined',
        from: {
          model: 'stg_events',
          union: { type: 'all', models: ['stg_events'] },
        },
      } as any,
    },
  ])('registry guard: $label', ({ cte, extraCtes }) => {
    const project = projectWithDatetimeAndPartitions('hour');
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [...(extraCtes || []), cte],
      project,
    });
    const cols = registry.get(cte.name)!;
    // No duplicate / over-injected partitions. (Whatever flows through comes
    // only from the upstream shape's own expansion.)
    expect(
      cols.filter((c) => c.name === 'portal_partition_monthly').length,
    ).toBeLessThanOrEqual(1);
  });

  // Registry drives SQL emission, so a single end-to-end SQL assertion is
  // enough -- if the registry has the right columns, the emitter writes
  // them, and the `no-duplication` / `interval-exclusion` tests above cover
  // the interesting registry states.
  test('SQL emitter appends datetime + partitions under the partition comment', () => {
    const project = projectWithDatetimeAndPartitions('hour');
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
      partitionColumnNames: [
        'portal_partition_monthly',
        'portal_partition_daily',
        'portal_partition_hourly',
      ],
    });

    // `datetime` as a bare passthrough (no date_trunc) since the user did
    // not ask for a different interval.
    expect(sql).toMatch(/\bdatetime\b/);
    expect(sql).not.toMatch(/date_trunc\(/);
    expect(sql).toContain('-- partition columns');
    expect(sql).toContain('portal_partition_monthly');
    expect(sql).toContain('portal_partition_daily');
    expect(sql).toContain('portal_partition_hourly');
  });
});
