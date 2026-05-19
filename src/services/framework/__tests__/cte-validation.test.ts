import { describe, expect, test } from '@jest/globals';
import { frameworkBuildCteColumnRegistry } from '@services/framework/utils';
import {
  validateCteColumnReferences,
  validateCteGroupBy,
  validateCteLightdashMetrics,
  validateCteRollupRequiresSelect,
  validateCtes,
  validateDeadOuterLayer,
  validateDjIcebergPartitionOverwrite,
  validateExcludeDatetimeRollupConflict,
  validateMainModelAggregation,
  validateMaterializationPartitionsExist,
  validateModelReferencesExist,
  validatePartitionStrategyWithoutPartitions,
  validateSelectModelReferences,
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

describe('validateExcludeDatetimeRollupConflict', () => {
  test('errors when from.rollup and exclude_datetime are both set', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_datetime: true,
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/exclude_datetime');
    expect(errors[0].message).toContain('exclude_datetime');
    expect(errors[0].message).toContain('from.rollup');
  });

  test('passes when only from.rollup is set', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });

  test('passes when only exclude_datetime is set (no rollup)', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events' },
      exclude_datetime: true,
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });

  // CTE-level exclude_datetime fires only when the SAME CTE also declares
  // from.rollup. A CTE that excludes datetime while a different scope (the
  // model, or another CTE) has rollup is structurally coherent -- the
  // exclude only strips this CTE's own datetime and does not affect the
  // upstream rollup. Cross-scope CTE rollup conflict is covered in
  // `cte-rollup.test.ts`.
  test('does not flag CTE-level exclude_datetime when only the model has rollup', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'other_model' },
          select: [{ name: 'region', type: 'dim' }],
          exclude_datetime: true,
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('exclude_datetime: false does not trigger the error', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_datetime: false,
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });

  test('handles models with no from gracefully', () => {
    expect(validateExcludeDatetimeRollupConflict({})).toEqual([]);
    expect(
      validateExcludeDatetimeRollupConflict({ exclude_datetime: true }),
    ).toEqual([]);
  });

  // The combined `exclude_framework_artifacts` enum implies `exclude_datetime`
  // for both `"all"` and `"columns"`, so either paired with `from.rollup`
  // triggers the same conflict. The diagnostic pointer follows the field
  // the user actually authored.
  test('errors when from.rollup + exclude_framework_artifacts="all"', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_framework_artifacts: 'all',
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/exclude_framework_artifacts');
    expect(errors[0].message).toContain('exclude_framework_artifacts');
    expect(errors[0].message).toContain('"all"');
    expect(errors[0].message).toContain('from.rollup');
  });

  test('errors when from.rollup + exclude_framework_artifacts="columns"', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_framework_artifacts: 'columns',
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/exclude_framework_artifacts');
    expect(errors[0].message).toContain('"columns"');
  });

  // Override: explicit `exclude_datetime: false` opts datetime back in and
  // silences the conflict, even when the combined flag would otherwise
  // imply exclusion.
  test('passes when from.rollup + combined "all" + exclude_datetime: false (override)', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_framework_artifacts: 'all',
      exclude_datetime: false,
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });

  // Both flags set to exclusion: pointer prefers the more specific
  // individual flag.
  test('errors with /exclude_datetime pointer when both individual + combined are set', () => {
    const errors = validateExcludeDatetimeRollupConflict({
      type: 'int_select_model',
      from: { model: 'stg_events', rollup: { interval: 'day' } },
      exclude_framework_artifacts: 'all',
      exclude_datetime: true,
      select: [{ name: 'region', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/exclude_datetime');
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

  // Constants have no column dependency, so they can never violate GROUP BY.
  // Covers the literal patterns we see in the wild: `0`, padded numerics,
  // null in any case, quoted strings, and `CAST(<literal> AS <type>)`.
  test.each([
    ['numeric zero', '0'],
    ['numeric with surrounding whitespace', ' 0 '],
    ['negative numeric', '-1'],
    ['decimal numeric', '3.14'],
    ['lowercase null', 'null'],
    ['uppercase NULL', 'NULL'],
    ['single-quoted string', "'foo'"],
    ['double-quoted string', '"bar"'],
    ['cast of null', 'CAST(NULL AS VARCHAR)'],
    ['cast of null with parameterised type', 'CAST(NULL AS VARCHAR(50))'],
    ['cast of numeric literal', 'CAST(0 AS DOUBLE)'],
    ['cast of string literal', "CAST('5' AS INTEGER)"],
  ])('no error for constant expr (%s)', (_desc, expr) => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'metric', type: 'fct', expr },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  // Jinja/dbt macros are opaque -- the expansion may wrap a real aggregate.
  // We treat any `{{ ... }}` / `{% ... %}` `expr` as aggregated to avoid
  // false-positive "un-aggregated" diagnostics.
  test.each([
    ['simple macro call', '{{ def_total_revenue() }}'],
    ['macro with args', '{{ my_macro(col_a, col_b) }}'],
    ['statement-style block', '{% if foo %}sum(x){% else %}0{% endif %}'],
  ])('no error for Jinja expr (%s)', (_desc, expr) => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'metric', type: 'fct', expr },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  // Window functions are still flagged (they ARE problematic with GROUP BY)
  // but with a tailored message that points to partition-column alignment
  // instead of suggesting `agg`/`aggs` (which doesn't apply to a row-wise
  // window function).
  test.each([
    [
      'max(...) over partition',
      'max(amount) over (partition by region, portal_partition_daily)',
    ],
    [
      'count distinct over partition',
      'count(distinct event_id) over (partition by region, portal_partition_hourly)',
    ],
    [
      'count over partition',
      'count(user_id) over (partition by region, portal_partition_daily)',
    ],
  ])('tailored window-function warning for %s', (_desc, expr) => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      select: [
        { name: 'region', type: 'dim' },
        { name: 'metric', type: 'fct', expr },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Window function');
    expect(errors[0].message).toContain('metric');
    expect(errors[0].message).not.toContain('agg"/"aggs');
    expect(errors[0].instancePath).toBe('/select/1');
  });

  test('window-function warning for CTE scalar ref includes CTE name', () => {
    const errors = validateMainModelAggregation({
      group_by: 'dims',
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        {
          cte: 'pre_agg',
          name: 'rolling_sum',
          type: 'fct',
          expr: 'sum(amount) over (partition by region)',
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Window function');
    expect(errors[0].message).toContain('rolling_sum');
    expect(errors[0].message).toContain('pre_agg');
    expect(errors[0].instancePath).toBe('/select/1');
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

// dj_iceberg_partition_overwrite is the DJ-shipped Iceberg-only variant of
// overwrite_existing_partitions. The validator must surface a Problems-tab
// error when the strategy is used without Iceberg format -- otherwise the
// shipped macro silently degrades to a full-table refresh on Delta/Hive.
describe('validateDjIcebergPartitionOverwrite', () => {
  test('emits an error when strategy is set without Iceberg format', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
    };

    const errors = validateDjIcebergPartitionOverwrite(modelJson, undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].instancePath).toBe('/materialization/strategy/type');
    expect(errors[0].message).toContain('requires Iceberg format');
  });

  test('emits an error when project storage_type is delta_lake', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
    };

    const errors = validateDjIcebergPartitionOverwrite(modelJson, 'delta_lake');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
  });

  test('passes when project storage_type is iceberg', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
    };

    const errors = validateDjIcebergPartitionOverwrite(modelJson, 'iceberg');
    expect(errors).toHaveLength(0);
  });

  test('passes when model-level format overrides to iceberg', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        format: 'iceberg',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
    };

    const errors = validateDjIcebergPartitionOverwrite(modelJson, undefined);
    expect(errors).toHaveLength(0);
  });

  test('returns no errors for unrelated strategies', () => {
    for (const strategyType of [
      'append',
      'delete+insert',
      'merge',
      'overwrite_existing_partitions',
    ]) {
      const modelJson = {
        type: 'int_select_model',
        materialization: {
          type: 'incremental',
          strategy: { type: strategyType },
        },
      };
      expect(
        validateDjIcebergPartitionOverwrite(modelJson, undefined),
      ).toHaveLength(0);
    }
  });

  test('returns no errors when materialization is absent or shorthand string', () => {
    expect(
      validateDjIcebergPartitionOverwrite(
        { type: 'int_select_model' },
        undefined,
      ),
    ).toHaveLength(0);

    expect(
      validateDjIcebergPartitionOverwrite(
        { type: 'int_select_model', materialization: 'incremental' },
        undefined,
      ),
    ).toHaveLength(0);
  });
});

// `validatePartitionStrategyWithoutPartitions` warns when an incremental
// model uses a partition-based strategy (`overwrite_existing_partitions` or
// `dj_iceberg_partition_overwrite`) but the resolved column shape carries
// no partition column. Both strategies need partitions to drive their work
// scope, so they no-op or fail at `dbt run` time without one.
describe('validatePartitionStrategyWithoutPartitions', () => {
  test('warns: from { cte } + non-partition select + partition-based default strategy', () => {
    const modelJson = {
      type: 'int_select_model',
      materialized: 'incremental',
      from: { cte: 'cte_a' },
      select: [
        { name: 'datetime', type: 'dim', expr: 'month' },
        { name: 'region', type: 'dim' },
      ],
    };
    const warnings = validatePartitionStrategyWithoutPartitions(
      modelJson,
      'overwrite_existing_partitions',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('overwrite_existing_partitions');
    expect(warnings[0].message).toContain('cte');
    // No explicit strategy was set, so the warning anchors on `materialized`.
    expect(warnings[0].instancePath).toBe('/materialized');
  });

  test('warns: `exclude_framework_artifacts: "all"` suppresses partition auto-injection on a from-model main model', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: { type: 'incremental' },
      from: { model: 'stg_events' },
      select: [{ name: 'datetime', type: 'dim', expr: 'month' }],
      exclude_framework_artifacts: 'all',
    };
    const warnings = validatePartitionStrategyWithoutPartitions(
      modelJson,
      'overwrite_existing_partitions',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].instancePath).toBe('/materialization');
  });

  test('warns: explicit `dj_iceberg_partition_overwrite` strategy via `materialization.strategy`', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
        format: 'iceberg',
      },
      from: { cte: 'cte_a' },
      select: [{ name: 'a', type: 'dim' }],
    };
    const warnings = validatePartitionStrategyWithoutPartitions(
      modelJson,
      undefined,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('dj_iceberg_partition_overwrite');
    expect(warnings[0].instancePath).toBe('/materialization/strategy/type');
  });

  test('suppresses: explicit `materialization.partitions` lists a column', () => {
    const modelJson = {
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        partitions: ['custom_partition'],
      },
      from: { cte: 'cte_a' },
      select: [{ name: 'a', type: 'dim' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('suppresses: scalar `select` includes a `portal_partition_*` column', () => {
    const modelJson = {
      type: 'int_select_model',
      materialized: 'incremental',
      from: { cte: 'cte_a' },
      select: [
        { name: 'portal_partition_daily', type: 'dim' },
        { name: 'a', type: 'dim' },
      ],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('suppresses: non-partition strategies (`delete+insert`, `merge`, `append`)', () => {
    for (const strategy of ['delete+insert', 'merge', 'append']) {
      const modelJson = {
        type: 'int_select_model',
        materialization: {
          type: 'incremental',
          strategy: { type: strategy },
        },
        from: { cte: 'cte_a' },
        select: [{ name: 'a', type: 'dim' }],
      };
      expect(
        validatePartitionStrategyWithoutPartitions(modelJson, strategy),
      ).toHaveLength(0);
    }
  });

  test('suppresses: `from: { model }` (upstream auto-injection covers partitions)', () => {
    const modelJson = {
      type: 'int_select_model',
      materialized: 'incremental',
      from: { model: 'stg_events' },
      select: [{ name: 'a', type: 'dim' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('suppresses: lookback model (forces `portal_partition_daily`)', () => {
    const modelJson = {
      type: 'int_lookback_model',
      materialized: 'incremental',
      from: { model: 'stg_events', lookback: { interval: 'day', count: 30 } },
      select: [{ name: 'a', type: 'dim' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('suppresses: bulk passthrough (`all_from_cte`) may carry partitions', () => {
    const modelJson = {
      type: 'int_select_model',
      materialized: 'incremental',
      from: { cte: 'cte_a' },
      select: [{ type: 'all_from_cte', cte: 'cte_a' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('suppresses: non-incremental model (defaults to ephemeral)', () => {
    const modelJson = {
      type: 'int_select_model',
      from: { cte: 'cte_a' },
      select: [{ name: 'a', type: 'dim' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  test('strategy resolution: explicit non-partition strategy on the model beats partition-based default', () => {
    const modelJson = {
      type: 'int_select_model',
      materialized: 'incremental',
      incremental_strategy: 'delete+insert',
      from: { cte: 'cte_a' },
      select: [{ name: 'a', type: 'dim' }],
    };
    expect(
      validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      ),
    ).toHaveLength(0);
  });

  // CTE chain auto-inject: `portal_partition_*` cascades through every
  // `from: { cte }` hop by inheriting from the upstream CTE registry, the
  // same way `from: { model }` consumers inherit from the manifest. The
  // heuristic must walk the chain so the warning does not fire on chains
  // that genuinely emit a partition column at sync time.
  describe('CTE chain auto-inject', () => {
    test('suppresses: chain with single CTE that sources from a model', () => {
      const modelJson = {
        type: 'int_select_model',
        materialized: 'incremental',
        ctes: [
          {
            name: 'rolled',
            from: { model: 'upstream' },
            select: [{ name: 'a', type: 'dim' }],
          },
        ],
        from: { cte: 'rolled' },
        select: [{ name: 'a', type: 'dim' }],
      };
      expect(
        validatePartitionStrategyWithoutPartitions(
          modelJson,
          'overwrite_existing_partitions',
        ),
      ).toHaveLength(0);
    });

    test('suppresses: multi-hop chain that terminates at a model head', () => {
      const modelJson = {
        type: 'int_select_model',
        materialized: 'incremental',
        ctes: [
          {
            name: 'first',
            from: { model: 'upstream' },
            select: [{ name: 'a', type: 'dim' }],
          },
          {
            name: 'second',
            from: { cte: 'first' },
            select: [{ name: 'a', type: 'dim' }],
          },
          {
            name: 'third',
            from: { cte: 'second' },
            select: [{ name: 'a', type: 'dim' }],
          },
        ],
        from: { cte: 'third' },
        select: [{ name: 'a', type: 'dim' }],
      };
      expect(
        validatePartitionStrategyWithoutPartitions(
          modelJson,
          'overwrite_existing_partitions',
        ),
      ).toHaveLength(0);
    });

    test('warns: any link in the chain opts out via `exclude_portal_partition_columns`', () => {
      const modelJson = {
        type: 'int_select_model',
        materialized: 'incremental',
        ctes: [
          {
            name: 'first',
            from: { model: 'upstream' },
            select: [{ name: 'a', type: 'dim' }],
          },
          {
            name: 'second',
            from: { cte: 'first' },
            select: [{ name: 'a', type: 'dim' }],
            exclude_portal_partition_columns: true,
          },
        ],
        from: { cte: 'second' },
        select: [{ name: 'a', type: 'dim' }],
      };
      const warnings = validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      );
      expect(warnings).toHaveLength(1);
    });

    test('warns: chain link with `exclude_framework_artifacts: "all"` breaks the chain', () => {
      const modelJson = {
        type: 'int_select_model',
        materialized: 'incremental',
        ctes: [
          {
            name: 'first',
            from: { model: 'upstream' },
            select: [{ name: 'a', type: 'dim' }],
            exclude_framework_artifacts: 'all',
          },
        ],
        from: { cte: 'first' },
        select: [{ name: 'a', type: 'dim' }],
      };
      const warnings = validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      );
      expect(warnings).toHaveLength(1);
    });

    test('warns: chain head is `from: { union }` (no auto-inject)', () => {
      const modelJson = {
        type: 'int_union_models',
        materialized: 'incremental',
        ctes: [
          {
            name: 'unioned',
            from: { union: { models: ['m1', 'm2'] } },
            select: [{ name: 'a', type: 'dim' }],
          },
        ],
        from: { cte: 'unioned' },
        select: [{ name: 'a', type: 'dim' }],
      };
      const warnings = validatePartitionStrategyWithoutPartitions(
        modelJson,
        'overwrite_existing_partitions',
      );
      expect(warnings).toHaveLength(1);
    });

    test('suppresses: a CTE in the chain explicitly selects a `portal_partition_*` column', () => {
      const modelJson = {
        type: 'int_select_model',
        materialized: 'incremental',
        ctes: [
          {
            name: 'with_partition',
            // The from-shape on its own would not auto-inject, but the
            // explicit partition select lands the column in the registry
            // and the chain inherits it from there.
            from: { union: { models: ['a', 'b'] } },
            select: [
              { name: 'a', type: 'dim' },
              { name: 'portal_partition_monthly', type: 'dim' },
            ],
          },
        ],
        from: { cte: 'with_partition' },
        select: [{ name: 'a', type: 'dim' }],
      };
      expect(
        validatePartitionStrategyWithoutPartitions(
          modelJson,
          'overwrite_existing_partitions',
        ),
      ).toHaveLength(0);
    });
  });
});

// validateCteRollupRequiresSelect: a CTE that declares from.rollup must
// declare an explicit `select`. Without it, the SQL generator falls
// through to `select *` and rollup's default `group_by: dims` expands to
// every upstream column, producing broken SQL and an empty rollup
// transform on the column registry.
describe('validateCteRollupRequiresSelect', () => {
  test('errors when CTE has from.model + rollup but no select', () => {
    const errors = validateCteRollupRequiresSelect({
      type: 'int_select_model',
      ctes: [
        {
          name: 'monthly',
          from: { model: 'stg_events', rollup: { interval: 'month' } },
        },
      ],
      from: { cte: 'monthly' },
      select: [{ name: 'datetime', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/ctes/0');
    expect(errors[0].message).toContain('"monthly"');
    expect(errors[0].message).toContain('from.rollup');
    expect(errors[0].message).toContain('explicit `select`');
  });

  test('errors when CTE has from.cte + rollup but no select', () => {
    const errors = validateCteRollupRequiresSelect({
      type: 'int_select_model',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'stg_events' },
          select: [
            { name: 'datetime', type: 'dim' },
            { name: 'amount_sum', type: 'fct' },
          ],
        },
        {
          name: 'monthly',
          from: { cte: 'pre_agg', rollup: { interval: 'month' } },
        },
      ],
      from: { cte: 'monthly' },
      select: [{ name: 'datetime', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/ctes/1');
    expect(errors[0].message).toContain('"monthly"');
  });

  test('errors when CTE has rollup but an empty select array', () => {
    const errors = validateCteRollupRequiresSelect({
      type: 'int_select_model',
      ctes: [
        {
          name: 'monthly',
          from: { model: 'stg_events', rollup: { interval: 'month' } },
          select: [],
        },
      ],
      from: { cte: 'monthly' },
      select: [{ name: 'datetime', type: 'dim' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/ctes/0');
  });

  test('passes when CTE has rollup with a non-empty select', () => {
    const errors = validateCteRollupRequiresSelect({
      type: 'int_select_model',
      ctes: [
        {
          name: 'monthly',
          from: { model: 'stg_events', rollup: { interval: 'month' } },
          select: [
            { name: 'datetime', type: 'dim' },
            { name: 'region', type: 'dim' },
            { name: 'amount_sum', type: 'fct' },
          ],
        },
      ],
      from: { cte: 'monthly' },
      select: [{ name: 'datetime', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });

  // Existing `select *` behavior for non-rollup CTEs is preserved -- only
  // CTEs that opt into rollup are forced to declare a select.
  test('passes when CTE has no rollup and no select (legacy `select *`)', () => {
    const errors = validateCteRollupRequiresSelect({
      type: 'int_select_model',
      ctes: [
        {
          name: 'passthrough',
          from: { model: 'stg_events' },
        },
      ],
      from: { cte: 'passthrough' },
      select: [{ name: 'datetime', type: 'dim' }],
    });
    expect(errors).toEqual([]);
  });
});

// validateMaterializationPartitionsExist: catches the typo case where a
// user lists a column in `materialization.partitions` that is not
// produced by the model's `select`. The SQL generator silently drops
// such names from the dbt config, leaving the table unpartitioned.
describe('validateMaterializationPartitionsExist', () => {
  test('warns when a partition name is not in the scalar select', () => {
    const errors = validateMaterializationPartitionsExist({
      type: 'int_select_model',
      materialization: { type: 'incremental', partitions: ['month'] },
      from: { cte: 'category_calculations' },
      select: [
        { name: 'datetime', type: 'dim', expr: 'month' },
        { name: 'region', type: 'dim' },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/materialization/partitions/0');
    expect(errors[0].message).toContain('"month"');
    expect(errors[0].message).toContain('materialization.partitions');
    expect(errors[0].message).toContain("not in the model's `select`");
  });

  // Bulk selects could expand to include any upstream column name, so
  // the validator skips conservatively rather than risk a false positive.
  test('skips when a bulk select is present (could plausibly include the name)', () => {
    const errors = validateMaterializationPartitionsExist({
      type: 'int_select_model',
      materialization: { type: 'incremental', partitions: ['month'] },
      from: { model: 'stg_events' },
      select: [
        { type: 'all_from_model', model: 'stg_events' },
        { name: 'derived', type: 'fct', expr: 'count(*)' },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('passes when every partition name appears as a scalar select', () => {
    const errors = validateMaterializationPartitionsExist({
      type: 'int_select_model',
      materialization: { type: 'incremental', partitions: ['datetime'] },
      from: { cte: 'category_calculations' },
      select: [
        { name: 'datetime', type: 'dim', expr: 'month' },
        { name: 'region', type: 'dim' },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe('validateSelectModelReferences', () => {
  test('no errors when select models match from.model and from.join', () => {
    const errors = validateSelectModelReferences({
      type: 'int_join_models',
      from: {
        model: 'base_model',
        join: [
          { model: 'joined_a', type: 'left', on: { and: ['id'] } },
          { model: 'joined_b', type: 'left', on: { and: ['id'] } },
        ],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
        { type: 'dims_from_model', model: 'joined_a' },
        { type: 'fcts_from_model', model: 'joined_b' },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('error when select references model not in from.model or from.join', () => {
    const errors = validateSelectModelReferences({
      type: 'int_join_models',
      from: {
        model: 'base_model',
        join: [
          { model: 'joined_a', type: 'left', on: { and: ['id'] } },
        ],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
        { type: 'all_from_model', model: 'ghost_model' },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/select/1');
    expect(errors[0].message).toContain('ghost_model');
    expect(errors[0].message).toContain('not joined');
    expect(errors[0].severity).toBe('error');
  });

  test('multiple invalid references produce multiple errors', () => {
    const errors = validateSelectModelReferences({
      type: 'mart_join_models',
      from: {
        model: 'base_model',
        join: [],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
        { type: 'all_from_model', model: 'missing_a' },
        { type: 'dims_from_model', model: 'missing_b' },
      ],
    });
    expect(errors).toHaveLength(2);
    expect(errors[0].instancePath).toBe('/select/1');
    expect(errors[1].instancePath).toBe('/select/2');
  });

  test('no errors for non-join model types', () => {
    const errors = validateSelectModelReferences({
      type: 'int_select_model',
      from: { model: 'base_model' },
      select: [
        { type: 'all_from_model', model: 'some_other_model' },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('CTE select referencing model not in CTE from.join produces error', () => {
    const errors = validateSelectModelReferences({
      type: 'int_join_models',
      from: {
        model: 'base_model',
        join: [{ model: 'joined_a', type: 'left', on: { and: ['id'] } }],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
      ],
      ctes: [
        {
          name: 'my_cte',
          from: {
            model: 'cte_base',
            join: [
              { model: 'cte_joined', type: 'left', on: { and: ['id'] } },
            ],
          },
          select: [
            { type: 'all_from_model', model: 'cte_base' },
            { type: 'all_from_model', model: 'not_in_cte_join' },
          ],
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/ctes/0/select/1');
    expect(errors[0].message).toContain('not_in_cte_join');
  });

  test('skips CTE join entries that are CTE references (not model)', () => {
    const errors = validateSelectModelReferences({
      type: 'int_join_models',
      from: {
        model: 'base_model',
        join: [
          { cte: 'some_cte', type: 'left', on: { and: ['id'] } },
        ],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
      ],
    });
    expect(errors).toEqual([]);
  });

  test('select items without model property are skipped', () => {
    const errors = validateSelectModelReferences({
      type: 'int_join_models',
      from: {
        model: 'base_model',
        join: [{ model: 'joined_a', type: 'left', on: { and: ['id'] } }],
      },
      select: [
        { type: 'all_from_model', model: 'base_model' },
        { name: 'computed_col', type: 'fct', expr: 'SUM(amount)' },
        'plain_column',
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe('validateModelReferencesExist', () => {
  const projectWithModels = createTestProject({
    nodes: {
      'model.project.model_a': {
        columns: {
          col_a: { name: 'col_a', data_type: 'varchar', meta: { type: 'dim' } },
        },
      },
      'model.project.model_b': {
        columns: {
          col_b: { name: 'col_b', data_type: 'bigint', meta: { type: 'fct' } },
        },
      },
      'seed.project.seed_x': {
        resource_type: 'seed',
        columns: {
          seed_col: { name: 'seed_col', data_type: 'varchar', meta: { type: 'dim' } },
        },
      },
    },
  });

  test('no errors when all referenced models exist in manifest', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_join_models',
        from: {
          model: 'model_a',
          join: [{ model: 'model_b', type: 'left', on: { and: ['id'] } }],
        },
        select: [
          { type: 'all_from_model', model: 'model_a' },
          { type: 'all_from_model', model: 'model_b' },
        ],
      },
      projectWithModels,
    );
    expect(errors).toEqual([]);
  });

  test('error when from.model references non-existent model', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_select_model',
        from: { model: 'deleted_model' },
        select: [{ type: 'all_from_model', model: 'deleted_model' }],
      },
      projectWithModels,
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const fromError = errors.find((e) => e.instancePath === '/from/model');
    expect(fromError).toBeDefined();
    expect(fromError!.message).toContain('deleted_model');
    expect(fromError!.message).toContain('not found in the dbt manifest');
    expect(fromError!.severity).toBe('error');
  });

  test('error when from.join[].model references non-existent model', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_join_models',
        from: {
          model: 'model_a',
          join: [
            { model: 'ghost_join', type: 'left', on: { and: ['id'] } },
          ],
        },
        select: [],
      },
      projectWithModels,
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const joinError = errors.find(
      (e) => e.instancePath === '/from/join/0/model',
    );
    expect(joinError).toBeDefined();
    expect(joinError!.message).toContain('ghost_join');
  });

  test('error when select[].model references non-existent model', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_select_model',
        from: { model: 'model_a' },
        select: [
          { type: 'all_from_model', model: 'nonexistent_select' },
        ],
      },
      projectWithModels,
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const selError = errors.find(
      (e) => e.instancePath === '/select/0/model',
    );
    expect(selError).toBeDefined();
    expect(selError!.message).toContain('nonexistent_select');
  });

  test('CTE from.model references non-existent model', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_select_model',
        from: { cte: 'my_cte' },
        select: [],
        ctes: [
          {
            name: 'my_cte',
            from: { model: 'cte_ghost_model' },
            select: [],
          },
        ],
      },
      projectWithModels,
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const cteError = errors.find(
      (e) => e.instancePath === '/ctes/0/from/model',
    );
    expect(cteError).toBeDefined();
    expect(cteError!.message).toContain('cte_ghost_model');
  });

  test('seed references are valid (no error)', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'stg_select_model',
        from: { model: 'seed_x' },
        select: [],
      },
      projectWithModels,
    );
    expect(errors).toEqual([]);
  });

  test('union model references are validated', () => {
    const errors = validateModelReferencesExist(
      {
        type: 'int_union_models',
        from: {
          union: {
            models: ['model_a', 'missing_union_model'],
          },
        },
        select: [],
      },
      projectWithModels,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/from/union/models/1');
    expect(errors[0].message).toContain('missing_union_model');
  });

  test('no errors for empty or null inputs', () => {
    expect(validateModelReferencesExist(null, projectWithModels)).toEqual([]);
    expect(validateModelReferencesExist({}, projectWithModels)).toEqual([]);
    expect(
      validateModelReferencesExist(
        { type: 'int_select_model' },
        projectWithModels,
      ),
    ).toEqual([]);
  });
});
