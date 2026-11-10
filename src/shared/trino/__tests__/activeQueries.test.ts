import { describe, expect, it } from '@jest/globals';
import { shapeQuerySummary } from '@services/trino/restClient';
import {
  parseTrinoTimestampMs,
  sortQueriesByRecency,
} from '@shared/trino/activeQueries';
import type { TrinoQuerySummary } from '@shared/trino/types';

const row = (
  queryId: string,
  overrides: Partial<TrinoQuerySummary> = {},
): TrinoQuerySummary => ({
  queryId,
  state: 'FINISHED',
  ...overrides,
});

describe('parseTrinoTimestampMs', () => {
  it('parses ISO-8601 with Z and millisecond or microsecond precision', () => {
    const base = Date.UTC(2026, 10, 3, 6, 17, 15, 988);
    expect(parseTrinoTimestampMs('2026-11-03T06:17:15.988Z')).toBe(base);
    expect(parseTrinoTimestampMs('2026-11-03T06:17:15.988123Z')).toBe(base);
    expect(parseTrinoTimestampMs('2026-11-03T06:17:15Z')).toBe(
      Date.UTC(2026, 10, 3, 6, 17, 15),
    );
  });

  it('parses the CLI space-separated form with a zone name', () => {
    expect(parseTrinoTimestampMs('2026-11-03 06:17:15.988 Asia/Kolkata')).toBe(
      Date.UTC(2026, 10, 3, 6, 17, 15, 988),
    );
  });

  it('applies numeric offsets', () => {
    expect(parseTrinoTimestampMs('2026-11-03T06:17:15.000+05:30')).toBe(
      Date.UTC(2026, 10, 3, 0, 47, 15, 0),
    );
  });

  it('returns undefined for missing or non-timestamp input', () => {
    expect(parseTrinoTimestampMs(undefined)).toBeUndefined();
    expect(parseTrinoTimestampMs('')).toBeUndefined();
    expect(parseTrinoTimestampMs('yesterday')).toBeUndefined();
  });
});

describe('sortQueriesByRecency', () => {
  it('orders an unordered REST-shaped listing newest first', () => {
    const rest = [
      shapeQuerySummary({
        queryId: '20261103_061715_00988_vsmvd',
        state: 'FINISHED',
        queryStats: { createTime: '2026-11-03T06:17:15.988Z' },
      }),
      shapeQuerySummary({
        queryId: '20261103_064157_01036_vsmvd',
        state: 'FINISHED',
        queryStats: { createTime: '2026-11-03T06:41:57.036Z' },
      }),
      shapeQuerySummary({
        queryId: '20261103_060657_00967_vsmvd',
        state: 'FINISHED',
        queryStats: { createTime: '2026-11-03T06:06:57.967Z' },
      }),
    ];

    expect(sortQueriesByRecency(rest).map((q) => q.queryId)).toEqual([
      '20261103_064157_01036_vsmvd',
      '20261103_061715_00988_vsmvd',
      '20261103_060657_00967_vsmvd',
    ]);
  });

  it('orders CLI-format and ISO timestamps together', () => {
    // Named zones are read as UTC wall-clock, so 07:00 (CLI) is newer than 06:00Z (ISO).
    const rows = [
      row('iso', { created: '2026-11-03T06:00:00.000Z' }),
      row('cli', { created: '2026-11-03 07:00:00.000 Asia/Kolkata' }),
    ];
    expect(sortQueriesByRecency(rows).map((q) => q.queryId)).toEqual([
      'cli',
      'iso',
    ]);
  });

  it('falls back to started when created is missing', () => {
    const rows = [
      row('old', { created: '2026-11-03T05:00:00.000Z' }),
      row('fallback', { started: '2026-11-03T09:00:00.000Z' }),
    ];
    expect(sortQueriesByRecency(rows).map((q) => q.queryId)).toEqual([
      'fallback',
      'old',
    ]);
  });

  it('sorts rows with no usable time last', () => {
    const rows = [
      row('untimed'),
      row('timed', { created: '2026-11-03T05:00:00.000Z' }),
    ];
    expect(sortQueriesByRecency(rows).map((q) => q.queryId)).toEqual([
      'timed',
      'untimed',
    ]);
  });

  it('breaks equal timestamps by queryId descending', () => {
    const ts = '2026-11-03T06:00:00.000Z';
    const rows = [
      row('20261103_060000_00001_aaaaa', { created: ts }),
      row('20261103_060000_00002_aaaaa', { created: ts }),
    ];
    expect(sortQueriesByRecency(rows).map((q) => q.queryId)).toEqual([
      '20261103_060000_00002_aaaaa',
      '20261103_060000_00001_aaaaa',
    ]);
  });

  it('returns a new array and leaves the input untouched', () => {
    const input = [
      row('first', { created: '2026-11-03T05:00:00.000Z' }),
      row('second', { created: '2026-11-03T06:00:00.000Z' }),
    ];
    const snapshot = input.map((q) => q.queryId);
    const sorted = sortQueriesByRecency(input);
    expect(sorted).not.toBe(input);
    expect(input.map((q) => q.queryId)).toEqual(snapshot);
  });
});
