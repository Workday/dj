import { normalizeTimeIntervals } from '@services/framework/utils/sql-utils';

describe('normalizeTimeIntervals', () => {
  const ctx = { modelName: 'm', columnName: 'datetime' };

  test('passes through "OFF" string', () => {
    expect(normalizeTimeIntervals('OFF', ctx)).toBe('OFF');
  });

  // Regression: dbt's PyYAML (YAML 1.1) parses unquoted `OFF` as boolean
  // false; that value reaches us via the manifest. Treat it as the user's
  // original "OFF" intent rather than crashing on a non-iterable value.
  test('coerces boolean false (YAML 1.1 OFF) back to "OFF"', () => {
    expect(normalizeTimeIntervals(false, ctx)).toBe('OFF');
  });

  test('treats boolean true (YAML 1.1 ON) as the empty default', () => {
    expect(normalizeTimeIntervals(true, ctx)).toEqual([]);
  });

  test('returns sorted, de-duplicated copy of an array', () => {
    const input = ['MONTH', 'DAY', 'YEAR', 'DAY'];
    const out = normalizeTimeIntervals(input, ctx);
    expect(out).toEqual(['DAY', 'MONTH', 'YEAR']);
    // Should be a new array, never mutate input order
    expect(input).toEqual(['MONTH', 'DAY', 'YEAR', 'DAY']);
  });

  test('treats null and undefined as empty array', () => {
    expect(normalizeTimeIntervals(undefined, ctx)).toEqual([]);
    expect(normalizeTimeIntervals(null, ctx)).toEqual([]);
  });

  test('falls back to empty array and warns for unsupported types, naming the column', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = normalizeTimeIntervals(
        { malformed: true },
        { modelName: 'parent_model', columnName: 'datetime' },
      );
      expect(out).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('parent_model.datetime');
      expect(message).toContain('object');
    } finally {
      warn.mockRestore();
    }
  });

  test('falls back to empty array for primitive numbers and strings other than OFF', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(normalizeTimeIntervals(42, ctx)).toEqual([]);
      expect(normalizeTimeIntervals('NOT_OFF', ctx)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
