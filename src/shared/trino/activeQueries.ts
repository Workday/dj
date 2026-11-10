import type { TrinoQuerySummary } from './types';

/**
 * Timestamps as Trino emits them: REST uses ISO-8601 (`2026-11-03T06:17:15.988Z`,
 * sometimes with microsecond precision), the CLI uses a space separator and
 * may append a zone name (`2026-11-03 06:17:15.988 Asia/Kolkata`).
 */
const TRINO_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2}|[A-Za-z_]+(?:\/[A-Za-z_+-]+)*)?$/;

const NUMERIC_OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/**
 * Epoch milliseconds for a Trino timestamp string, or `undefined` when the
 * input doesn't match. Numeric offsets are applied; `Z`, `UTC`, and named
 * zones are read as UTC wall-clock. A single coordinator reports every row
 * in one session zone, so that keeps relative order intact.
 */
export function parseTrinoTimestampMs(
  raw: string | undefined,
): number | undefined {
  if (!raw) {
    return undefined;
  }
  const match = TRINO_TIMESTAMP_RE.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const millis = Number((fraction ?? '').slice(0, 3).padEnd(3, '0'));
  let epochMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  );
  const offset = zone ? NUMERIC_OFFSET_RE.exec(zone) : null;
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const offsetMinutes = Number(offset[2]) * 60 + Number(offset[3]);
    epochMs -= sign * offsetMinutes * 60_000;
  }
  return Number.isNaN(epochMs) ? undefined : epochMs;
}

/**
 * Returns a new array ordered newest first by `created`, falling back to
 * `started` when `created` is absent or unparseable. Rows with no usable
 * time sort last. Ties are broken by `queryId` descending, which matches
 * chronological order because Trino IDs are timestamp-prefixed
 * (`20261103_061715_00988_vsmvd`).
 */
export function sortQueriesByRecency(
  rows: TrinoQuerySummary[],
): TrinoQuerySummary[] {
  const keyed = rows.map((row) => ({
    row,
    time:
      parseTrinoTimestampMs(row.created) ?? parseTrinoTimestampMs(row.started),
  }));
  keyed.sort((a, b) => {
    if (a.time !== b.time) {
      if (a.time === undefined) {
        return 1;
      }
      if (b.time === undefined) {
        return -1;
      }
      return b.time - a.time;
    }
    if (a.row.queryId === b.row.queryId) {
      return 0;
    }
    return a.row.queryId < b.row.queryId ? 1 : -1;
  });
  return keyed.map((entry) => entry.row);
}
