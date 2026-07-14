/**
 * Helpers for safely interpolating SQL identifiers (catalog / schema / table /
 * project names) into Trino query text. Two strategies are offered:
 *
 * - `assertSqlIdentifier` constrains a value to a bare identifier grammar. Use
 *   it for untrusted input that must be a simple name -- notably the project
 *   name and `vars.etl_schema` read from a workspace's `dbt_project.yml`. dbt
 *   already restricts these to `[A-Za-z0-9_]`, so the allowlist rejects anything
 *   unexpected before it reaches the query.
 * - `quoteTrinoIdentifier` wraps a value as a delimited (double-quoted) Trino
 *   identifier, escaping embedded quotes. Use it for names whose exact spelling
 *   must be preserved (e.g. catalog / schema / table names the user browses),
 *   which may legitimately contain characters outside the bare grammar.
 *
 * Both keep an interpolated value from altering the query structure; because the
 * Trino CLI is spawned with `shell: false`, neither can alter the command line.
 */

/** Bare SQL identifier: ASCII letters, digits, and underscores only. */
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Narrow `value` to a safe bare SQL identifier.
 */
export function isSafeSqlIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SQL_IDENTIFIER_PATTERN.test(value);
}

/**
 * Assert that `value` is a bare SQL identifier, throwing a descriptive error
 * otherwise. `label` names the offending field in the message (e.g.
 * `'etl_schema'`).
 */
export function assertSqlIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (!isSafeSqlIdentifier(value)) {
    throw new Error(
      `Invalid ${label} ${JSON.stringify(
        value,
      )}: only letters, digits, and underscores are allowed.`,
    );
  }
}

/**
 * Quote `identifier` as a Trino delimited identifier: wrap it in double quotes
 * and double any embedded double quote. An embedded `"` is escaped to `""`
 * rather than terminating the identifier, so the value cannot inject SQL
 * regardless of its contents -- the safe way to interpolate an arbitrary
 * catalog / schema / table name into a query.
 */
export function quoteTrinoIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
