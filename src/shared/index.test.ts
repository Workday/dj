import { mergeDeep } from '@shared';
import type { FrameworkColumn } from '@shared/framework/types';

describe('mergeDeep', () => {
  test('merge-time-intervals', () => {
    const input1: FrameworkColumn = {
      name: 'datetime',
      meta: {
        type: 'dim',
        dimension: {
          label: 'Datetime',
          time_intervals: ['DAY', 'HOUR', 'MONTH'],
        },
      },
      internal: {},
    };
    const input2: FrameworkColumn = {
      name: 'datetime',
      meta: {
        type: 'dim',
        dimension: { time_intervals: ['DAY', 'MONTH'] },
      },
      internal: {
        expr: "date_trunc('day', datetime)",
      },
    };
    const expected: FrameworkColumn = {
      name: 'datetime',
      meta: {
        type: 'dim',
        dimension: { label: 'Datetime', time_intervals: ['DAY', 'MONTH'] },
      },
      internal: {
        expr: "date_trunc('day', datetime)",
      },
    };
    const actual = mergeDeep(input1, input2);
    expect(actual).toEqual(expected);
  });
});
