import { describe, expect, test } from '@jest/globals';
import { frameworkBuildCteColumnRegistry } from '@services/framework/utils';
import {
  validateCteColumnReferences,
  validateCteGroupBy,
  validateCteLightdashMetrics,
  validateCtes,
  validateDeadOuterLayer,
  validateMainModelAggregation,
} from '@services/modelValidation';

import { createTestProject } from './helpers';

const project = createTestProject();

describe('CTE Validation', () => {
  test('validateCtes catches duplicate CTE names', () => {
    const errors = validateCtes({
      ctes: [
        { name: 'cte_a', from: { model: 'm' } },
        { name: 'cte_a', from: { model: 'm' } },
      ],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('duplicate CTE name');
  });

  test('validateCtes catches forward references', () => {
    const errors = validateCtes({
      ctes: [
        { name: 'cte_a', from: { cte: 'cte_b' } },
        { name: 'cte_b', from: { model: 'm' } },
      ],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('not defined earlier');
  });

  test('validateCtes passes for valid CTE chain', () => {
    const errors = validateCtes({
      ctes: [
        { name: 'cte_a', from: { model: 'm' } },
        { name: 'cte_b', from: { cte: 'cte_a' } },
      ],
      from: { cte: 'cte_b' },
    });
    expect(errors.length).toBe(0);
  });

  test('validateCtes rejects where on union CTE', () => {
    const errors = validateCtes({
      ctes: [
        { name: 'a', from: { model: 'm1' }, select: ['col1'] },
        { name: 'b', from: { model: 'm2' }, select: ['col1'] },
        {
          name: 'combined',
          from: { cte: 'a', union: { type: 'all', ctes: ['b'] } },
          where: { and: [{ expr: 'col1 IS NOT NULL' }] },
        },
      ],
      from: { cte: 'combined' },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('not supported on union CTEs');
  });

  test('validateCtes catches invalid main model from.cte reference', () => {
    const errors = validateCtes({
      ctes: [{ name: 'cte_a', from: { model: 'm' } }],
      from: { cte: 'nonexistent' },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('not defined in the ctes array');
  });

  test('validateCtes catches forward CTE reference in join', () => {
    const errors = validateCtes({
      ctes: [
        {
          name: 'cte_a',
          from: {
            model: 'm1',
            join: [{ cte: 'cte_b', on: { and: ['col'] }, type: 'left' }],
          },
        },
        { name: 'cte_b', from: { model: 'm2' } },
      ],
      from: { cte: 'cte_a' },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('join references CTE "cte_b"');
    expect(errors[0]).toContain('not defined earlier');
  });

  test('validateCtes passes valid CTE join reference', () => {
    const errors = validateCtes({
      ctes: [
        { name: 'cte_a', from: { model: 'm1' } },
        {
          name: 'cte_b',
          from: {
            cte: 'cte_a',
            join: [{ cte: 'cte_a', on: { and: ['col'] }, type: 'left' }],
          },
        },
      ],
      from: { cte: 'cte_b' },
    });
    expect(errors.length).toBe(0);
  });

  test('validateCtes catches invalid CTE reference in main model from.join', () => {
    const errors = validateCtes({
      ctes: [{ name: 'cte_a', from: { model: 'm1' } }],
      from: {
        cte: 'cte_a',
        join: [{ cte: 'nonexistent', on: { and: ['col'] }, type: 'left' }],
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('from.join: references CTE "nonexistent"');
  });
});

describe('validateCteColumnReferences', () => {
  const baseCtes: any[] = [
    {
      name: 'source_cte',
      from: { model: 'model_a' },
      select: [
        { name: 'dim_a', type: 'dim' },
        { name: 'dim_b', type: 'dim' },
        { name: 'dim_c', type: 'dim' },
        { name: 'fct_x', type: 'fct' },
        { name: 'fct_y', type: 'fct' },
      ],
    },
  ];

  function buildRegistryForBaseCtes() {
    return frameworkBuildCteColumnRegistry({
      ctes: baseCtes,
      project,
    });
  }

  test('reports error for non-existent column in exclude', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              exclude: ['nonexistent_col'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('nonexistent_col');
    expect(errors[0]).toContain('does not exist');
  });

  test('reports error for non-existent column in include', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              include: ['ghost_col'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('ghost_col');
    expect(errors[0]).toContain('does not exist');
  });

  test('reports error when exclude removes all columns', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              exclude: ['dim_a', 'dim_b', 'dim_c', 'fct_x', 'fct_y'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.some((e: string) => e.includes('zero columns'))).toBe(true);
  });

  test('validates main model select exclude/include references', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: baseCtes,
      from: { cte: 'source_cte' },
      select: [
        {
          type: 'all_from_cte',
          cte: 'source_cte',
          exclude: ['nonexistent'],
        },
      ],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('nonexistent');
  });

  test('no errors for valid exclude/include', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              exclude: ['dim_b'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors).toEqual([]);
  });

  test('fcts_from_cte exclude referencing dim column reports error (type narrowing)', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'fcts_from_cte',
              cte: 'source_cte',
              exclude: ['dim_a'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('dim_a');
    expect(errors[0]).toContain('does not exist');
  });

  test('dims_from_cte include referencing fct column reports error (type narrowing)', () => {
    const registry = buildRegistryForBaseCtes();
    const modelJson: any = {
      ctes: [
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'dims_from_cte',
              cte: 'source_cte',
              include: ['fct_x'],
            },
          ],
        },
      ],
      from: { cte: 'derived' },
      select: [{ type: 'all_from_cte', cte: 'derived' }],
    };
    const errors = validateCteColumnReferences(modelJson, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('fct_x');
    expect(errors[0]).toContain('does not exist');
  });
});

describe('validateCteGroupBy', () => {
  test('rejects string alias for computed column', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: ['month'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('string alias "month"');
    expect(errors[0]).toContain('computed expression');
    expect(errors[0]).toContain('DATE_TRUNC');
  });

  test('allows string alias for non-computed column', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        { name: 'service', type: 'dim' },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: ['service'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('allows { type: "dims" } with computed columns', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: [{ type: 'dims' }],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('allows { expr: "..." } for computed expressions', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: [{ expr: "DATE_TRUNC('MONTH', portal_partition_daily)" }],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('mixed group_by: errors only for computed string aliases', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
        { name: 'service', type: 'dim' },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: ['month', 'service'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"month"');
    expect(errors[0]).not.toContain('"service"');
  });

  test('no error when CTE has no select (passthrough)', () => {
    const cte = {
      name: 'passthrough',
      from: { model: 'stg_events' },
      group_by: ['some_col'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('no error when CTE has no group_by', () => {
    const cte = {
      name: 'no_group',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
      ],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('no error when select has no computed columns', () => {
    const cte = {
      name: 'simple',
      from: { model: 'stg_events' },
      select: [
        { name: 'service', type: 'dim' },
        { name: 'region', type: 'dim' },
      ],
      group_by: ['service', 'region'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('reports errors for multiple computed aliases', () => {
    const cte = {
      name: 'multi_computed',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', event_date)",
          type: 'dim',
        },
        { name: 'year', expr: "DATE_TRUNC('YEAR', event_date)", type: 'dim' },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: ['month', 'year'],
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('"month"');
    expect(errors[1]).toContain('"year"');
  });
});

describe('validateCteGroupBy with "dims" string shorthand', () => {
  test('allows "dims" shorthand with computed columns', () => {
    const cte = {
      name: 'agg_data',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'month',
          expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
          type: 'dim',
        },
        { name: 'total', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });

  test('allows "dims" shorthand without computed columns', () => {
    const cte = {
      name: 'simple',
      from: { model: 'stg_events' },
      select: [
        { name: 'service', type: 'dim' },
        { name: 'region', type: 'dim' },
      ],
      group_by: 'dims',
    };
    const errors = validateCteGroupBy(cte, 0);
    expect(errors).toHaveLength(0);
  });
});

describe('validateCtes with group_by checks', () => {
  test('validateCtes reports computed alias in CTE group_by', () => {
    const errors = validateCtes({
      ctes: [
        {
          name: 'agg_data',
          from: { model: 'stg_events' },
          select: [
            {
              name: 'month',
              expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
              type: 'dim',
            },
            { name: 'service', type: 'dim' },
            { name: 'total', type: 'fct', agg: 'sum' },
          ],
          group_by: ['month', 'service'],
        },
      ],
      from: { cte: 'agg_data' },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('string alias "month"');
    expect(errors[0]).toContain('computed expression');
  });

  test('validateCtes passes when CTE uses { type: "dims" }', () => {
    const errors = validateCtes({
      ctes: [
        {
          name: 'agg_data',
          from: { model: 'stg_events' },
          select: [
            {
              name: 'month',
              expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
              type: 'dim',
            },
            { name: 'total', type: 'fct', agg: 'sum' },
          ],
          group_by: [{ type: 'dims' }],
        },
      ],
      from: { cte: 'agg_data' },
    });
    expect(errors).toHaveLength(0);
  });

  test('validateCtes only flags the CTE with the issue in multi-CTE model', () => {
    const errors = validateCtes({
      ctes: [
        {
          name: 'clean_cte',
          from: { model: 'stg_events' },
          select: [{ name: 'region', type: 'dim' }],
          group_by: ['region'],
        },
        {
          name: 'bad_cte',
          from: { cte: 'clean_cte' },
          select: [
            {
              name: 'quarter',
              expr: "DATE_TRUNC('QUARTER', event_date)",
              type: 'dim',
            },
            { name: 'count_val', type: 'fct', agg: 'count' },
          ],
          group_by: ['quarter'],
        },
      ],
      from: { cte: 'bad_cte' },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ctes[1]');
    expect(errors[0]).toContain('"bad_cte"');
    expect(errors[0]).toContain('"quarter"');
  });

  test('validateCtes passes when CTE uses "dims" string shorthand', () => {
    const errors = validateCtes({
      ctes: [
        {
          name: 'agg_data',
          from: { model: 'stg_events' },
          select: [
            {
              name: 'month',
              expr: "DATE_TRUNC('MONTH', portal_partition_daily)",
              type: 'dim',
            },
            { name: 'total', type: 'fct', agg: 'sum' },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'agg_data' },
    });
    expect(errors).toHaveLength(0);
  });
});

/**
 * Gap 1: `lightdash.metrics` / `lightdash.metrics_merge` are silently dropped
 * when placed inside a CTE select -- only the main-model select feeds
 * `lightdashBuildMetrics`. The validator turns that silent foot-gun into a
 * loud authoring error.
 */
describe('validateCteLightdashMetrics (Gap 1)', () => {
  // `metrics` and `metrics_merge` share the same validation path -- cover both
  // keys in one matrix. The named variants exercise the column-name branch of
  // the diagnostic message; the bare (unnamed) variant exercises the
  // `select[N]` fallback used when no `name` is declared.
  test.each<{
    label: string;
    key: 'metrics' | 'metrics_merge';
    selectItem: any;
    expectedIdFragment: string;
    instancePath: string;
  }>([
    {
      label: 'named select with lightdash.metrics',
      key: 'metrics',
      selectItem: {
        name: 'revenue_sum',
        type: 'fct',
        expr: 'sum(amount)',
        lightdash: {
          metrics: [{ name: 'metric_revenue', type: 'sum', label: 'Revenue' }],
        },
      },
      expectedIdFragment: 'revenue_sum',
      instancePath: '/ctes/0/select/0/lightdash',
    },
    {
      label: 'named select with lightdash.metrics_merge',
      key: 'metrics_merge',
      selectItem: {
        name: 'amount_hll',
        type: 'fct',
        agg: 'hll',
        lightdash: { metrics_merge: { group_label: 'Distinct Counts' } },
      },
      expectedIdFragment: 'amount_hll',
      instancePath: '/ctes/0/select/0/lightdash',
    },
    {
      label: 'bare (unnamed) select falls back to select[N] label',
      key: 'metrics',
      selectItem: { lightdash: { metrics: [{ name: 'x' }] } },
      expectedIdFragment: 'select[0]',
      instancePath: '/ctes/0/select/0/lightdash',
    },
  ])(
    'rejects lightdash.$key: $label',
    ({ key, selectItem, expectedIdFragment, instancePath }) => {
      const errors = validateCteLightdashMetrics({
        ctes: [
          {
            name: 'pre_agg',
            from: { model: 'stg_events' },
            select: [selectItem],
          },
        ],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain(`lightdash.${key}`);
      expect(errors[0].message).toContain(expectedIdFragment);
      expect(errors[0].instancePath).toBe(instancePath);
    },
  );

  test('allows lightdash.dimension on a CTE select (dimension propagates by design)', () => {
    const errors = validateCteLightdashMetrics({
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'stg_events' },
          select: [
            {
              name: 'region',
              type: 'dim',
              lightdash: { dimension: { label: 'Region' } },
            },
          ],
        },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  test('ignores models with no ctes array', () => {
    expect(validateCteLightdashMetrics({})).toEqual([]);
    expect(validateCteLightdashMetrics({ ctes: null })).toEqual([]);
  });
});

/**
 * Gap 2: Main-model `fct` columns must be aggregated when the main model has
 * a `group_by`. Covers both named scalar selects and bulk CTE selects
 * (`all_from_cte` / `fcts_from_cte`) that carry fcts through without
 * re-aggregation.
 */
describe('validateMainModelAggregation (Gap 2)', () => {
  test('errors for bare fct scalar with main-model group_by', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'revenue', type: 'fct' },
      ],
    });
    // One diagnostic per offending select item, pinned to that item.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('revenue');
    expect(errors[0].message).toContain('Un-aggregated fct column');
    expect(errors[0].instancePath).toBe('/select/1');
  });

  test('emits one diagnostic per offending select item', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'revenue', type: 'fct' },
        { name: 'cost', type: 'fct' },
        { name: 'profit', type: 'fct' },
      ],
    });
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.instancePath)).toEqual([
      '/select/1',
      '/select/2',
      '/select/3',
    ]);
    expect(errors[0].message).toContain('revenue');
    expect(errors[1].message).toContain('cost');
    expect(errors[2].message).toContain('profit');
  });

  test('no error when scalar fct sets agg', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'revenue', type: 'fct', agg: 'sum' },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  // The aggregate-expr path is covered exhaustively by the `test.each` below
  // (including `sum(...)`), so we don't need a separate hand-rolled test for
  // that case.

  test.each([
    // Most common user pattern -- also the FRAMEWORK_AGGS representative.
    ['sum', 'sum(amount)'],
    // Framework-emitted sketch kernels: `merge(cast(... as hyperloglog))` is
    // what we emit for `agg: "hll"` re-aggregation; `approx_set` / `tdigest_agg`
    // are the raw kernels users sometimes copy by hand.
    [
      'merge(cast(... as hyperloglog))',
      'cast(merge(cast(col_hll as hyperloglog)) as varbinary)',
    ],
    ['approx_set raw kernel', 'cast(approx_set(user_id) as varbinary)'],
    // Scalar aggregates outside FRAMEWORK_AGGS that show up in expr most often.
    // `arbitrary` has spacing variants because the user's `.model.json` used
    // ` arbitrary(col)` / `arbitrary (col)` and we need to confirm whitespace
    // handling on both sides of the paren.
    ['avg', 'avg(latency_ms)'],
    ['any_value', 'any_value(region)'],
    ['arbitrary (leading space)', ' arbitrary(x_originator_int_system)'],
    ['arbitrary (space before paren)', 'arbitrary (integration_system)'],
    ['max_by', 'max_by(region, event_time)'],
    ['count_if', 'count_if(amount > 0)'],
    ['approx_distinct', 'approx_distinct(user_id)'],
    ['stddev', 'stddev(latency_ms)'],
    ['listagg', "listagg(value, ',')"],
    // `_agg` suffix convention: one positive case is enough to exercise the
    // regex -- `array_agg` stands in for `map_agg`, `set_agg`, `reduce_agg`,
    // `bitwise_*_agg`, and user UDAFs following the same naming.
    ['array_agg (_agg suffix)', 'array_agg(event_id)'],
  ])('no error when expr uses %s', (_desc, expr) => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'metric', type: 'fct', expr },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  test('no error when fct is explicitly opted out', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'revenue',
          type: 'fct',
          expr: 'any_value(amount)',
          exclude_from_group_by: true,
        },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  test('no error when no group_by is set', () => {
    const errors = validateMainModelAggregation({
      select: [{ name: 'revenue', type: 'fct' }],
    });
    expect(errors).toHaveLength(0);
  });

  test('errors for all_from_cte that drags unagged fcts through group_by', () => {
    const project = createTestProject();
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'model_a' },
          select: [
            { name: 'col_a', type: 'dim' },
            { name: 'col_b', type: 'fct', agg: 'sum' },
          ],
          group_by: 'dims',
        },
      ] as any,
      project,
    });

    const errors = validateMainModelAggregation(
      {
        group_by: 'dims',
        from: { cte: 'pre_agg' },
        select: [{ cte: 'pre_agg', type: 'all_from_cte' }],
      },
      registry,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('all_from_cte');
    expect(errors[0].message).toContain('col_b_sum');
    expect(errors[0].instancePath).toBe('/select/0');
  });

  test('no error when all_from_cte wraps only dims (no fcts leaked)', () => {
    const project = createTestProject();
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [
        {
          name: 'dim_only',
          from: { model: 'model_a' },
          select: [{ name: 'col_a', type: 'dim' }],
        },
      ] as any,
      project,
    });

    const errors = validateMainModelAggregation(
      {
        group_by: 'dims',
        from: { cte: 'dim_only' },
        select: [{ cte: 'dim_only', type: 'all_from_cte' }],
      },
      registry,
    );
    expect(errors).toHaveLength(0);
  });

  test('no error when bulk carrier excludes every fct column', () => {
    const project = createTestProject();
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'model_a' },
          select: [
            { name: 'col_a', type: 'dim' },
            { name: 'col_b', type: 'fct', agg: 'sum' },
          ],
          group_by: 'dims',
        },
      ] as any,
      project,
    });

    const errors = validateMainModelAggregation(
      {
        group_by: 'dims',
        from: { cte: 'pre_agg' },
        select: [
          { cte: 'pre_agg', type: 'all_from_cte', exclude: ['col_b_sum'] },
        ],
      },
      registry,
    );
    expect(errors).toHaveLength(0);
  });

  test('errors for bare CTE fct scalar ref with main-model group_by', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { cte: 'pre_agg', name: 'revenue_sum', type: 'fct' },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('revenue_sum');
    expect(errors[0].message).toContain('pre_agg');
    expect(errors[0].instancePath).toBe('/select/1');
  });
});

/**
 * Gap 5: dead outer layers. The validator warns when the main model is a
 * single `all_from_cte` / `dims_from_cte` passthrough of one CTE, with
 * identical group_by and no extra projection / filter / order / limit.
 */
describe('validateDeadOuterLayer (Gap 5)', () => {
  // Minimal base model that triggers the warning: one CTE, main model is a
  // single all_from_cte passthrough with identical group_by and nothing else.
  // Each escape-hatch case below starts from this shape and mutates exactly
  // one field.
  const baseDeadOuterLayerModel = () => ({
    ctes: [
      {
        name: 'pre_agg',
        from: { model: 'model_a' },
        select: [
          { name: 'region', type: 'dim' },
          { name: 'revenue', type: 'fct', agg: 'sum' },
        ],
        group_by: 'dims' as const,
      },
    ],
    from: { cte: 'pre_agg' },
    group_by: 'dims' as const,
    select: [{ cte: 'pre_agg', type: 'all_from_cte' as const }],
  });

  test('warns when main select is a single all_from_cte passthrough with identical group_by', () => {
    const warnings = validateDeadOuterLayer(baseDeadOuterLayerModel());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('no-op');
    expect(warnings[0].message).toContain('pre_agg');
    expect(warnings[0].instancePath).toBe('/select/0');
  });

  // Each escape hatch disables the warning by making the outer layer do real
  // work (extra filter / limit / projection / diverging grain / bulk filter)
  // or by removing the CTE-passthrough precondition entirely.
  test.each<{ label: string; mutate: (m: any) => void }>([
    {
      label: 'outer layer adds a where clause',
      mutate: (m) => {
        m.where = { and: [{ expr: "region = 'us'" }] };
      },
    },
    {
      label: 'outer layer adds a limit',
      mutate: (m) => {
        m.limit = 100;
      },
    },
    {
      label: 'outer group_by diverges from CTE group_by',
      mutate: (m) => {
        m.ctes[0].group_by = ['region'];
      },
    },
    {
      label: 'outer adds extra projection (multiple select items)',
      mutate: (m) => {
        m.select.push({ name: 'suffix', expr: "'us'", type: 'dim' });
      },
    },
    {
      label: 'from does not reference a CTE',
      mutate: (m) => {
        m.ctes = [];
        m.from = { model: 'model_a' };
        m.select = [{ model: 'model_a', type: 'dims_from_model' }];
      },
    },
    {
      label: 'bulk select applies exclude / include filter',
      mutate: (m) => {
        m.select[0].exclude = ['noisy_col'];
      },
    },
  ])('no warning: $label', ({ mutate }) => {
    const m = baseDeadOuterLayerModel();
    mutate(m);
    expect(validateDeadOuterLayer(m)).toHaveLength(0);
  });
});
