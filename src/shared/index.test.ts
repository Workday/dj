import { mergeDeep, yamlParse, yamlStringify } from '@shared';
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

describe('yamlStringify', () => {
  // Regression guard for: dbt loads YAML with PyYAML (YAML 1.1) which parses
  // the unquoted tokens OFF / NO / YES / ON (case-insensitive) as booleans.
  // Our own emit must quote them so the manifest round-trip preserves the
  // string value users actually wrote (e.g. lightdash time_intervals: "OFF").
  test.each([
    ['OFF', '"OFF"'],
    ['off', '"off"'],
    ['Off', '"Off"'],
    ['NO', '"NO"'],
    ['no', '"no"'],
    ['YES', '"YES"'],
    ['ON', '"ON"'],
    ['Y', '"Y"'],
    ['N', '"N"'],
  ])('quotes YAML 1.1 boolean token %p as %p', (input, expected) => {
    const out = yamlStringify({ time_intervals: input });
    expect(out).toContain(`time_intervals: ${expected}`);
    // And it round-trips back to the same string under default (1.2) parse.
    expect(yamlParse(out)).toEqual({ time_intervals: input });
  });

  test('still emits ordinary strings unquoted', () => {
    const out = yamlStringify({ label: 'Datetime', name: 'datetime' });
    expect(out).toBe('label: Datetime\nname: datetime\n');
  });

  test('quotes nested boolean-token strings inside lightdash-style dimensions', () => {
    const input = {
      columns: [
        {
          name: 'stop_date',
          meta: { dimension: { time_intervals: 'OFF' } },
        },
      ],
    };
    const out = yamlStringify(input);
    expect(out).toContain('time_intervals: "OFF"');
    // Round-trip must preserve the string under the default (1.2) parser.
    expect(yamlParse(out)).toEqual(input);
  });
});
