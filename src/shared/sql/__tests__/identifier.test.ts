import { describe, expect, it } from '@jest/globals';
import {
  assertSqlIdentifier,
  isSafeSqlIdentifier,
  quoteTrinoIdentifier,
} from '@shared/sql/identifier';

describe('isSafeSqlIdentifier', () => {
  it('accepts bare identifiers', () => {
    for (const value of [
      'source_etl',
      'analytics',
      'dbt_sources',
      'Table1',
      '_private',
      '__x__',
      '0',
      'a1b2c3',
    ]) {
      expect(isSafeSqlIdentifier(value)).toBe(true);
    }
  });

  it('rejects a payload that escapes single-quoted SQL', () => {
    // Closes a single-quoted SQL string and chains a shell command.
    expect(isSafeSqlIdentifier("x'; id > /tmp/dj_poc.txt; echo '")).toBe(false);
  });

  it('rejects values containing shell or SQL metacharacters', () => {
    for (const value of [
      "x'; id",
      'a b',
      'a.b',
      'a-b',
      'a;b',
      'a`b`',
      'a$(id)',
      'a|b',
      'a&b',
      'a"b"',
      'a\nb',
      'a\tb',
      "a''b",
      'schema.dbt_sources',
      '*',
      '',
      '   ',
    ]) {
      expect(isSafeSqlIdentifier(value)).toBe(false);
    }
  });

  it('rejects non-string inputs', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isSafeSqlIdentifier(value)).toBe(false);
    }
  });
});

describe('assertSqlIdentifier', () => {
  it('does not throw for valid identifiers', () => {
    expect(() => assertSqlIdentifier('source_etl', 'etl_schema')).not.toThrow();
  });

  it('throws for an injection payload and names the field', () => {
    expect(() =>
      assertSqlIdentifier("x'; id > /tmp/dj_poc.txt; echo '", 'etl_schema'),
    ).toThrow(/etl_schema/);
  });

  it('throws for non-string input', () => {
    expect(() => assertSqlIdentifier(undefined, 'project name')).toThrow(
      /project name/,
    );
  });
});

describe('quoteTrinoIdentifier', () => {
  it('wraps a bare identifier in double quotes', () => {
    expect(quoteTrinoIdentifier('analytics')).toBe('"analytics"');
  });

  it('preserves names that fall outside the bare identifier grammar', () => {
    expect(quoteTrinoIdentifier('my-catalog')).toBe('"my-catalog"');
    expect(quoteTrinoIdentifier('with.dot')).toBe('"with.dot"');
    expect(quoteTrinoIdentifier('MixedCase')).toBe('"MixedCase"');
    expect(quoteTrinoIdentifier('with space')).toBe('"with space"');
  });

  it('escapes an embedded double quote by doubling it', () => {
    expect(quoteTrinoIdentifier('a"b')).toBe('"a""b"');
  });

  it('neutralizes a name that tries to break out of the quotes', () => {
    // A quote crafted to close the delimited identifier and append SQL is
    // doubled, so it stays a literal quote inside the identifier rather than
    // terminating it.
    expect(quoteTrinoIdentifier('x" union select secret --')).toBe(
      '"x"" union select secret --"',
    );
  });

  it('throws a clear error when the identifier is missing', () => {
    // A missing catalog/schema/table (e.g. an undefined table name reaching
    // the query builder) must fail with a descriptive message rather than the
    // opaque "Cannot read properties of undefined (reading 'replace')".
    expect(() => quoteTrinoIdentifier(undefined as unknown as string)).toThrow(
      /expected an identifier/,
    );
  });
});
