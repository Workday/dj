import { describe, expect, test } from '@jest/globals';
import { frameworkModelHasAgg } from '@services/framework/utils/column-utils';
import { frameworkModelGroupBy } from '@services/framework/utils/sql-utils';
import { GROUP_BY_DIMS, normalizeGroupBy } from '@shared/framework/constants';

const dimColumns = [
  {
    name: 'region',
    meta: { type: 'dim' as const },
    internal: { prefix: '' },
  },
  {
    name: 'service',
    meta: { type: 'dim' as const },
    internal: { prefix: '' },
  },
];
const fctColumns = [
  {
    name: 'total_revenue',
    meta: { type: 'fct' as const },
    internal: { agg: 'sum' as const, prefix: '' },
  },
];
const allColumns = [...dimColumns, ...fctColumns] as any;

describe('normalizeGroupBy', () => {
  test('converts "dims" string to [{ type: "dims" }]', () => {
    expect(normalizeGroupBy(GROUP_BY_DIMS)).toEqual([{ type: 'dims' }]);
  });

  test('passes arrays, null, and undefined through unchanged', () => {
    const arr: [{ type: 'dims' }] = [{ type: 'dims' }];
    expect(normalizeGroupBy(arr)).toBe(arr);
    expect(normalizeGroupBy(null)).toBeNull();
    expect(normalizeGroupBy(undefined)).toBeUndefined();
  });
});

describe('frameworkModelGroupBy', () => {
  test('returns empty sql when no aggregation and no group_by', () => {
    const result = frameworkModelGroupBy({
      columns: dimColumns as any,
      modelJson: { from: { model: 'stg_events' } } as any,
    });
    expect(result.sql).toBe('');
  });

  test('groups non-fact columns when facts have agg', () => {
    const result = frameworkModelGroupBy({
      columns: allColumns,
      modelJson: { from: { model: 'stg_events' } } as any,
    });
    expect(result.sql).toContain('region');
    expect(result.sql).toContain('service');
    expect(result.sql).not.toContain('total_revenue');
  });

  test('explicit string columns in group_by', () => {
    const result = frameworkModelGroupBy({
      columns: dimColumns as any,
      modelJson: {
        from: { model: 'stg_events' },
        group_by: ['region'],
      } as any,
    });
    expect(result.sql).toContain('region');
    expect(result.sql).not.toContain('service');
  });

  test('explicit { expr } in group_by', () => {
    const result = frameworkModelGroupBy({
      columns: dimColumns as any,
      modelJson: {
        from: { model: 'stg_events' },
        group_by: [{ expr: 'UPPER(region)' }],
      } as any,
    });
    expect(result.sql).toContain('UPPER(region)');
  });

  test('"dims" shorthand produces same SQL as [{ type: "dims" }]', () => {
    const shorthand = frameworkModelGroupBy({
      columns: allColumns,
      modelJson: { from: { model: 'stg_events' }, group_by: 'dims' } as any,
    });
    const longform = frameworkModelGroupBy({
      columns: allColumns,
      modelJson: {
        from: { model: 'stg_events' },
        group_by: [{ type: 'dims' }],
      } as any,
    });
    expect(shorthand.sql).toBe(longform.sql);
  });

  test('exclude_from_group_by is respected by dims', () => {
    const columns = [
      ...dimColumns,
      {
        name: 'internal_id',
        meta: { type: 'dim' },
        internal: { prefix: '', exclude_from_group_by: true },
      },
      ...fctColumns,
    ] as any;
    const result = frameworkModelGroupBy({
      columns,
      modelJson: { from: { model: 'stg_events' }, group_by: 'dims' } as any,
    });
    expect(result.sql).toContain('region');
    expect(result.sql).not.toContain('internal_id');
  });

  test('deduplicates when agg-fact auto-group overlaps with explicit group_by', () => {
    const result = frameworkModelGroupBy({
      columns: allColumns,
      modelJson: {
        from: { model: 'stg_events' },
        group_by: ['region'],
      } as any,
    });
    const lines = result.sql.split('\n').slice(1);
    const regionCount = lines.filter((l: string) =>
      l.includes('region'),
    ).length;
    expect(regionCount).toBe(1);
  });
});

describe('frameworkModelHasAgg', () => {
  test('true with "dims" shorthand', () => {
    expect(
      frameworkModelHasAgg({
        modelJson: {
          from: { model: 'm' },
          group_by: 'dims',
          select: [],
        } as any,
      }),
    ).toBe(true);
  });

  test('true with array group_by', () => {
    expect(
      frameworkModelHasAgg({
        modelJson: {
          from: { model: 'm' },
          group_by: [{ type: 'dims' }],
          select: [],
        } as any,
      }),
    ).toBe(true);
  });

  test('false with no group_by and no agg', () => {
    expect(
      frameworkModelHasAgg({
        modelJson: {
          from: { model: 'm' },
          select: [{ name: 'col_a', type: 'dim' }],
        } as any,
      }),
    ).toBe(false);
  });
});
