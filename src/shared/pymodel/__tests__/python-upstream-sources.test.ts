import { describe, expect, test } from '@jest/globals';

import {
  normalizeUpstreamSources,
  parseUpstreamSourcesProperty,
  serializeUpstreamSourcesForProperty,
} from '@shared/pymodel/python-upstream-sources';

describe('normalizeUpstreamSources', () => {
  test('returns empty array for null/undefined', () => {
    expect(normalizeUpstreamSources(null)).toEqual([]);
    expect(normalizeUpstreamSources(undefined)).toEqual([]);
  });

  test('wraps a single entry in an array', () => {
    expect(
      normalizeUpstreamSources({ type: 'trino', value: 'schema.table' }),
    ).toEqual([{ type: 'trino', value: 'schema.table' }]);
  });

  test('passes through a valid array', () => {
    const entries = [
      { type: 'trino' as const, value: 'a.b' },
      { type: 'external' as const, value: 'api' },
    ];
    expect(normalizeUpstreamSources(entries)).toEqual(entries);
  });

  test('filters invalid array items', () => {
    expect(
      normalizeUpstreamSources([
        { type: 'trino', value: 'ok' },
        { type: 'bad', value: 'x' },
        { value: 'no-type' },
      ]),
    ).toEqual([{ type: 'trino', value: 'ok' }]);
  });
});

describe('serializeUpstreamSourcesForProperty', () => {
  test('serializes as compact JSON array', () => {
    expect(
      serializeUpstreamSourcesForProperty([
        { type: 'trino', value: 'opus_python_source.raw_events' },
        { type: 'external', value: 'backstage_api' },
      ]),
    ).toBe(
      '[{"type":"trino","value":"opus_python_source.raw_events"},{"type":"external","value":"backstage_api"}]',
    );
  });
});

describe('parseUpstreamSourcesProperty', () => {
  test('parses JSON array format', () => {
    expect(
      parseUpstreamSourcesProperty(
        '[{"type":"trino","value":"schema.table"},{"type":"external","value":"api"}]',
      ),
    ).toEqual([
      { type: 'trino', value: 'schema.table' },
      { type: 'external', value: 'api' },
    ]);
  });

  test('falls back to legacy comma-separated trino entries', () => {
    expect(
      parseUpstreamSourcesProperty(
        'opus_python_source.raw_events, analytics.user_sessions',
      ),
    ).toEqual([
      { type: 'trino', value: 'opus_python_source.raw_events' },
      { type: 'trino', value: 'analytics.user_sessions' },
    ]);
  });

  test('returns empty for blank input', () => {
    expect(parseUpstreamSourcesProperty('')).toEqual([]);
    expect(parseUpstreamSourcesProperty(undefined)).toEqual([]);
  });
});
