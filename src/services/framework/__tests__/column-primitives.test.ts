import { describe, expect, test } from '@jest/globals';
import {
  frameworkApplyCteSelectMeta,
  frameworkBuildDatetimeColumn,
  frameworkResolveAgg,
} from '@services/framework/utils';
import type { FrameworkColumn } from '@shared/framework/types';

describe('frameworkResolveAgg', () => {
  test('fresh aggregation suffixes the column name and emits no inputSuffixAgg', () => {
    expect(frameworkResolveAgg({ agg: 'sum', name: 'revenue' })).toEqual({
      inputSuffixAgg: null,
      outputName: 'revenue_sum',
    });
  });

  test('collision keeps the bare name and forwards the upstream agg', () => {
    expect(
      frameworkResolveAgg({ agg: 'count', name: 'portal_source_count' }),
    ).toEqual({
      inputSuffixAgg: 'count',
      outputName: 'portal_source_count',
    });
  });

  test('collision with overrideSuffixAgg re-suffixes and re-aggregates fresh', () => {
    expect(
      frameworkResolveAgg({
        agg: 'count',
        name: 'portal_source_count',
        overrideSuffixAgg: true,
      }),
    ).toEqual({
      inputSuffixAgg: null,
      outputName: 'portal_source_count_count',
    });
  });

  test.each([
    ['sum', 'amount_sum'],
    ['count', 'events_count'],
    ['hll', 'user_id_hll'],
    ['tdigest', 'latency_ms_tdigest'],
  ])('collision detected across all four agg kinds (%s)', (agg, name) => {
    const result = frameworkResolveAgg({
      agg: agg as 'sum' | 'count' | 'hll' | 'tdigest',
      name,
    });
    expect(result.outputName).toBe(name);
    expect(result.inputSuffixAgg).toBe(agg);
  });

  test('non-colliding suffix still gets re-suffixed (sum agg on count-suffixed)', () => {
    expect(frameworkResolveAgg({ agg: 'sum', name: 'events_count' })).toEqual({
      inputSuffixAgg: null,
      outputName: 'events_count_sum',
    });
  });
});

describe('frameworkBuildDatetimeColumn', () => {
  test('no upstream interval -> truncates', () => {
    const result = frameworkBuildDatetimeColumn({
      interval: 'hour',
      sourceInterval: null,
    });
    expect(result.expr).toBe("date_trunc('hour', datetime)");
    expect(result.interval).toBe('hour');
  });

  test('matching upstream interval -> skips truncation', () => {
    const result = frameworkBuildDatetimeColumn({
      interval: 'hour',
      sourceInterval: 'hour',
    });
    expect(result.expr).toBeNull();
  });

  test('finer upstream -> truncates to coarser', () => {
    const result = frameworkBuildDatetimeColumn({
      interval: 'day',
      sourceInterval: 'hour',
    });
    expect(result.expr).toBe("date_trunc('day', datetime)");
  });

  test('coarser upstream -> still emits the (incompatible) truncation', () => {
    // The upstream is coarser than the requested grain, which is a user
    // error -- but the helper still emits the truncation rather than silently
    // dropping it. Callers rely on this for parity with the main-model path.
    const result = frameworkBuildDatetimeColumn({
      interval: 'hour',
      sourceInterval: 'day',
    });
    expect(result.expr).toBe("date_trunc('hour', datetime)");
  });

  test('prefix is threaded into the truncation expression', () => {
    const result = frameworkBuildDatetimeColumn({
      interval: 'hour',
      prefix: 't',
      sourceInterval: null,
    });
    expect(result.expr).toBe("date_trunc('hour', t.datetime)");
  });

  test.each([
    ['hour', ['DAY', 'DAY_OF_WEEK_NAME', 'HOUR', 'MONTH', 'WEEK', 'YEAR']],
    ['day', ['DAY', 'DAY_OF_WEEK_NAME', 'MONTH', 'WEEK', 'YEAR']],
    ['month', ['MONTH', 'YEAR']],
    ['year', ['YEAR']],
  ])(
    'interval %s synthesizes the expected time_intervals',
    (interval, expected) => {
      const result = frameworkBuildDatetimeColumn({
        interval: interval as 'hour' | 'day' | 'month' | 'year',
        sourceInterval: null,
      });
      expect(result.dimension.label).toBe('Datetime');
      expect(result.dimension.time_intervals).toEqual(expected);
    },
  );

  test('userDimension overrides the default label and merges with time_intervals', () => {
    const result = frameworkBuildDatetimeColumn({
      interval: 'hour',
      sourceInterval: null,
      userDimension: { label: 'Custom', hidden: true } as any,
    });
    expect(result.dimension.label).toBe('Custom');
    expect((result.dimension as any).hidden).toBe(true);
    // time_intervals is preserved when userDimension doesn't override it
    expect(result.dimension.time_intervals).toEqual([
      'DAY',
      'DAY_OF_WEEK_NAME',
      'HOUR',
      'MONTH',
      'WEEK',
      'YEAR',
    ]);
  });
});

describe('frameworkApplyCteSelectMeta', () => {
  function makeCol(): FrameworkColumn {
    return { name: 'col', meta: { type: 'dim' } };
  }

  test('copies description, data_type, data_tests', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta(
      {
        data_tests: ['not_null'],
        data_type: 'varchar',
        description: 'hello',
      },
      col,
      { hasAgg: false },
    );
    expect(col.description).toBe('hello');
    expect(col.data_type).toBe('varchar');
    expect(col.data_tests).toEqual(['not_null']);
  });

  test('copies lightdash.dimension and lightdash.case_sensitive', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta(
      {
        lightdash: {
          case_sensitive: true,
          dimension: { label: 'Custom' },
        },
      },
      col,
      { hasAgg: false },
    );
    expect(col.meta.dimension).toEqual({ label: 'Custom' });
    expect(col.meta.case_sensitive).toBe(true);
  });

  test('copies override_suffix_agg', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta({ override_suffix_agg: true }, col, {
      hasAgg: false,
    });
    expect(col.meta.override_suffix_agg).toBe(true);
  });

  test('forwards expr and exclude_from_group_by when hasAgg is false', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta(
      { exclude_from_group_by: true, expr: 'lower(name)' },
      col,
      { hasAgg: false },
    );
    expect(col.meta.expr).toBe('lower(name)');
    expect(col.meta.exclude_from_group_by).toBe(true);
  });

  test('drops expr and exclude_from_group_by when hasAgg is true', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta(
      { exclude_from_group_by: true, expr: 'lower(name)' },
      col,
      { hasAgg: true },
    );
    expect(col.meta.expr).toBeUndefined();
    expect(col.meta.exclude_from_group_by).toBeUndefined();
  });

  test('empty sel leaves col untouched', () => {
    const col = makeCol();
    const before = JSON.stringify(col);
    frameworkApplyCteSelectMeta({}, col, { hasAgg: false });
    expect(JSON.stringify(col)).toBe(before);
  });

  test('falsy lightdash.case_sensitive (explicit false) is still copied', () => {
    const col = makeCol();
    frameworkApplyCteSelectMeta({ lightdash: { case_sensitive: false } }, col, {
      hasAgg: false,
    });
    expect(col.meta.case_sensitive).toBe(false);
  });
});
