import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildColumns,
  frameworkBuildCteColumnRegistry,
  frameworkResolveExcludeFlag,
} from '@services/framework/utils/column-utils';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Verifies the combined `exclude_framework_artifacts` enum and its precedence
 * relationship to the four individual exclude flags it bundles. The resolver
 * `frameworkResolveExcludeFlag` is the single point of truth for every site
 * that decides whether to drop a framework-injected column or filter, so the
 * tests cover both the resolver in isolation (truth-table coverage) and the
 * resolver wired into the model-level strip (`frameworkBuildColumns`) and
 * inheritance behavior between models and CTEs.
 *
 * Override semantics: at any scope, the explicit individual flag wins over
 * the combined flag; CTE scope wins over model scope. The full chain is
 *   CTE individual > CTE combined > model individual > model combined > false
 */

type ResolverFlag =
  | 'datetime'
  | 'portal_partition_columns'
  | 'portal_source_count'
  | 'date_filter';
type ResolverRow = [
  label: string,
  cte: Record<string, unknown> | null,
  model: Record<string, unknown> | null,
  flag: ResolverFlag,
  expected: boolean,
];

describe('frameworkResolveExcludeFlag', () => {
  // Truth-table sweep across every combination of cte/model and individual/
  // combined values. Each row encodes the inputs to the resolver and the
  // expected effective value, with a short label for diagnostics.
  const rows: ResolverRow[] = [
    // Empty inputs default to false on every flag.
    ['nothing set', null, null, 'datetime', false],
    ['empty objects', {}, {}, 'datetime', false],

    // Model individual flag, no CTE: passes through untouched.
    [
      'model individual true',
      null,
      { exclude_datetime: true },
      'datetime',
      true,
    ],
    [
      'model individual false',
      null,
      { exclude_datetime: false },
      'datetime',
      false,
    ],

    // Model combined "all" implies all four flags.
    [
      'combined all => datetime',
      null,
      { exclude_framework_artifacts: 'all' },
      'datetime',
      true,
    ],
    [
      'combined all => partition columns',
      null,
      { exclude_framework_artifacts: 'all' },
      'portal_partition_columns',
      true,
    ],
    [
      'combined all => source count',
      null,
      { exclude_framework_artifacts: 'all' },
      'portal_source_count',
      true,
    ],
    [
      'combined all => date filter',
      null,
      { exclude_framework_artifacts: 'all' },
      'date_filter',
      true,
    ],

    // Model combined "columns" implies the three column flags only; date
    // filter still fires.
    [
      'combined columns => datetime',
      null,
      { exclude_framework_artifacts: 'columns' },
      'datetime',
      true,
    ],
    [
      'combined columns => partition columns',
      null,
      { exclude_framework_artifacts: 'columns' },
      'portal_partition_columns',
      true,
    ],
    [
      'combined columns => source count',
      null,
      { exclude_framework_artifacts: 'columns' },
      'portal_source_count',
      true,
    ],
    [
      'combined columns => date filter NOT excluded',
      null,
      { exclude_framework_artifacts: 'columns' },
      'date_filter',
      false,
    ],

    // Individual flag overrides the combined flag at the same scope.
    [
      'individual false beats combined all (same scope)',
      null,
      {
        exclude_framework_artifacts: 'all',
        exclude_portal_source_count: false,
      },
      'portal_source_count',
      false,
    ],
    [
      'individual true with combined columns is still true',
      null,
      {
        exclude_framework_artifacts: 'columns',
        exclude_date_filter: true,
      },
      'date_filter',
      true,
    ],

    // CTE individual beats model individual.
    [
      'CTE individual false beats model individual true',
      { exclude_datetime: false },
      { exclude_datetime: true },
      'datetime',
      false,
    ],

    // CTE individual beats model combined.
    [
      'CTE individual false beats model combined all',
      { exclude_datetime: false },
      { exclude_framework_artifacts: 'all' },
      'datetime',
      false,
    ],

    // CTE combined beats model individual.
    [
      'CTE combined columns beats model individual false',
      { exclude_framework_artifacts: 'columns' },
      { exclude_datetime: false },
      'datetime',
      true,
    ],

    // Model combined inherits when CTE has nothing.
    [
      'CTE empty inherits model combined all',
      {},
      { exclude_framework_artifacts: 'all' },
      'date_filter',
      true,
    ],

    // Both CTE individual and CTE combined: individual wins at CTE scope.
    [
      'CTE individual false beats CTE combined all (same scope)',
      {
        exclude_framework_artifacts: 'all',
        exclude_datetime: false,
      },
      { exclude_framework_artifacts: 'all' },
      'datetime',
      false,
    ],
  ];

  test.each(rows)('resolver: %s', (_label, cte, model, flag, expected) => {
    expect(frameworkResolveExcludeFlag(flag, cte as any, model as any)).toBe(
      expected,
    );
  });
});

function projectWithFrameworkColumns() {
  return createTestProject({
    nodes: {
      ['model.project.stg_events']: {
        columns: {
          region: {
            name: 'region',
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
            meta: { type: 'dim', interval: 'hour' },
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

describe('exclude_framework_artifacts on the main model', () => {
  test('"columns" strips datetime, portal_partition_*, and portal_source_count', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'lookup',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_framework_artifacts: 'columns',
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_hourly');
    expect(names).not.toContain('portal_source_count');
  });

  test('"all" produces the same column shape as "columns" (filters tested separately)', () => {
    // The auto WHERE date filters live in `frameworkBuildFilters`; the
    // column-level effect of `"all"` matches `"columns"` because both imply
    // the three column flags. Filter behavior is exercised in the existing
    // `cte-partition-filters.test.ts` which we keep behavior-preserving.
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'lookup',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_framework_artifacts: 'all',
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_source_count');
  });

  test('individual flag override: "all" + exclude_portal_source_count=false keeps the count column', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'lookup',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      exclude_framework_artifacts: 'all',
      exclude_portal_source_count: false,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).toContain('portal_source_count');
    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
  });

  test('individual flag override: "all" + exclude_datetime=false keeps datetime', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'lookup',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_framework_artifacts: 'all',
      exclude_datetime: false,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).toContain('datetime');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_source_count');
  });
});

/**
 * Origin-aware strip: the column-flag excludes (`exclude_datetime`,
 * `exclude_portal_partition_columns`, `exclude_portal_source_count`, and the
 * combined `exclude_framework_artifacts` values that imply them) only remove
 * framework auto-injected columns. Columns named explicitly in `select`
 * (scalar `name`, or bulk `include`) are preserved; columns kept by bulk
 * default (a column the bulk picked up because it wasn't in `exclude`) are
 * not preserved -- the model-level flag wins over implicit bulk passthrough.
 */
describe('origin-aware strip on the main model', () => {
  test('scalar `datetime` select survives `exclude_datetime: true`', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'datetime',
          type: 'dim',
          expr: "date_trunc('month', datetime)",
        },
        { name: 'region', type: 'dim' },
      ],
      exclude_datetime: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const datetimeCols = columns.filter((c) => c.name === 'datetime');
    expect(datetimeCols).toHaveLength(1);
    expect(datetimeCols[0].internal.expr).toBe("date_trunc('month', datetime)");
  });

  test('scalar `datetime` select survives `exclude_framework_artifacts: "all"` (and partitions/source_count are still stripped)', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        { name: 'datetime', type: 'dim', expr: 'month' },
        { name: 'region', type: 'dim' },
      ],
      exclude_framework_artifacts: 'all',
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);
    expect(names).toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_source_count');
  });

  test('scalar `portal_partition_daily` select survives `exclude_portal_partition_columns` (auto-injected siblings still stripped)', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        { name: 'portal_partition_daily', type: 'dim' },
        { name: 'region', type: 'dim' },
      ],
      exclude_portal_partition_columns: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);
    expect(names).toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_hourly');
  });

  test('scalar `portal_source_count` select survives `exclude_portal_source_count`', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        { name: 'portal_source_count', type: 'fct', agg: 'sum' },
        { name: 'region', type: 'dim' },
      ],
      exclude_portal_source_count: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const sourceCountCols = columns.filter(
      (c) => c.name === 'portal_source_count',
    );
    expect(sourceCountCols).toHaveLength(1);
  });

  // Negative control: when the user does not list a column in `select`, the
  // strip still removes the framework's auto-injected copy.
  test('auto-injected `datetime` is stripped when not listed in `select`', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_datetime: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);
    expect(names).not.toContain('datetime');
    expect(names).toContain('portal_partition_monthly');
  });

  // Bulk default-keep (a column the bulk picked up because it isn't in
  // `exclude`) is NOT explicit. Pairing a bulk passthrough with model-level
  // `exclude_*` flags must still strip the framework columns.
  test('bulk default-keep does not count as explicit: model-level excludes still strip framework columns', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        {
          type: 'all_from_model',
          model: 'stg_events',
          // `portal_partition_*` and `portal_source_count` are intentionally
          // *not* in the exclude list so the bulk picks them up by default.
          exclude: ['datetime', 'amount'],
        },
        { name: 'datetime', expr: 'max(datetime)' },
      ],
      exclude_portal_partition_columns: true,
      exclude_portal_source_count: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_hourly');
    expect(names).not.toContain('portal_source_count');
    expect(names).toContain('datetime');
  });

  // Bulk `include` is opt-in, so a partition column named there is just as
  // explicit as a scalar select and survives the model-level exclude.
  test('bulk `include` counts as explicit: column survives model-level exclude', () => {
    const project = projectWithFrameworkColumns();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'm',
      from: { model: 'stg_events' },
      select: [
        {
          type: 'dims_from_model',
          model: 'stg_events',
          include: ['portal_partition_daily', 'region'],
        },
      ],
      exclude_portal_partition_columns: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);
    expect(names).toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_hourly');
  });
});

describe('exclude_framework_artifacts inheritance to CTEs', () => {
  // CTE inherits the model-level combined flag when neither the CTE
  // individual nor the CTE combined flag is set.
  test('CTE inherits model.exclude_framework_artifacts="all" (drops datetime + partitions + source count)', () => {
    const project = projectWithFrameworkColumns();
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
    } as any;
    const modelJson = {
      type: 'int_select_model',
      exclude_framework_artifacts: 'all',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      modelJson,
      project,
    });
    const names = registry.get('pre_agg')!.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_hourly');
    expect(names).not.toContain('portal_source_count');
  });

  // CTE individual flag wins over the model-level combined flag, so a CTE
  // can opt back in even when the model excluded everything.
  test('CTE exclude_datetime=false beats model.exclude_framework_artifacts="all"', () => {
    const project = projectWithFrameworkColumns();
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_datetime: false,
    } as any;
    const modelJson = {
      type: 'int_select_model',
      exclude_framework_artifacts: 'all',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      modelJson,
      project,
    });
    const names = registry.get('pre_agg')!.map((c) => c.name);

    expect(names).toContain('datetime');
    // The remaining flags still inherit "all" -> partitions and source
    // count are dropped because the CTE didn't override those individually.
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_source_count');
  });

  // CTE combined "columns" beats model individual flags at lower scope.
  test('CTE exclude_framework_artifacts="columns" overrides model.exclude_datetime=false', () => {
    const project = projectWithFrameworkColumns();
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
      exclude_framework_artifacts: 'columns',
    } as any;
    const modelJson = {
      type: 'int_select_model',
      exclude_datetime: false,
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      modelJson,
      project,
    });
    const names = registry.get('pre_agg')!.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_source_count');
  });
});
