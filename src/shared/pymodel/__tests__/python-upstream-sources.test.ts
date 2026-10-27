import { describe, expect, test } from '@jest/globals';
import {
  normalizeUpstreamSources,
  parseTrinoUpstreamValue,
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
        { type: 'trino', value: 'python_source.raw_events' },
        { type: 'external', value: 'backstage_api' },
      ]),
    ).toBe(
      '[{"type":"trino","value":"python_source.raw_events"},{"type":"external","value":"backstage_api"}]',
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
        'python_source.raw_events, analytics.user_sessions',
      ),
    ).toEqual([
      { type: 'trino', value: 'python_source.raw_events' },
      { type: 'trino', value: 'analytics.user_sessions' },
    ]);
  });

  test('returns empty for blank input', () => {
    expect(parseUpstreamSourcesProperty('')).toEqual([]);
    expect(parseUpstreamSourcesProperty(undefined)).toEqual([]);
  });

  test('accepts an already-parsed array (Trino CSV reader pre-parses JSON cells)', () => {
    // parseTrinoValue JSON.parses any cell starting with '[' or '{', so the
    // property can surface as a real array rather than a string.
    expect(
      parseUpstreamSourcesProperty([
        { type: 'trino', value: 'glue.python_sources.wpc_slavepool_details' },
        { type: 'external', value: 'jenkins::dcim_inventory_csv' },
      ]),
    ).toEqual([
      { type: 'trino', value: 'glue.python_sources.wpc_slavepool_details' },
      { type: 'external', value: 'jenkins::dcim_inventory_csv' },
    ]);
  });

  test('accepts an already-parsed single object', () => {
    expect(
      parseUpstreamSourcesProperty({
        type: 'trino',
        value: 'glue.python_sources.wpc_slavepool_details',
      }),
    ).toEqual([
      { type: 'trino', value: 'glue.python_sources.wpc_slavepool_details' },
    ]);
  });

  test('ignores non-string non-object scalars', () => {
    expect(parseUpstreamSourcesProperty(42)).toEqual([]);
    expect(parseUpstreamSourcesProperty(null)).toEqual([]);
  });
});

describe('parseTrinoUpstreamValue', () => {
  test('parses 3-part catalog.schema.table', () => {
    expect(
      parseTrinoUpstreamValue('glue.python_source.model_c', 'glue'),
    ).toEqual({
      catalog: 'glue',
      schema: 'python_source',
      table: 'model_c',
    });
  });

  test('parses 2-part schema.table with fallback catalog', () => {
    expect(parseTrinoUpstreamValue('python_source.model_c', 'glue')).toEqual({
      catalog: 'glue',
      schema: 'python_source',
      table: 'model_c',
    });
  });
});
