/**
 * Parsers for Trino's heterogeneous duration / data-size encodings.
 *
 * Trino's REST APIs return durations and data sizes in two shapes
 * depending on the endpoint and version:
 *
 *   - Numeric: raw milliseconds (durations) or bytes (sizes).
 *   - String:  human-readable values like "12.34s", "1.5GB",
 *              "10ms", "500MB", "1h", "1d".
 *
 * These helpers normalise either shape into a number so consumers
 * (sanitizer, REST client shaper, webview stage row renderer) can
 * just `formatMs(parseDurationMs(value))` without branching.
 *
 * Lives under `src/shared/` so both the extension host and the
 * webview can import the same implementation.
 */

/**
 * Parse a Trino duration into milliseconds.
 *
 * Accepts numeric milliseconds (returned as-is, rounded) or strings
 * of the form `<number><unit>` with unit one of `ns`, `us`, `ms`,
 * `s`, `m`, `h`, `d`. A missing unit is treated as seconds (Trino's
 * default when serialising small values). Returns `undefined` for
 * inputs that don't match — callers can then render a placeholder.
 */
export function parseDurationMs(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return Math.round(raw);
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const m = raw.match(/^([\d.]+)\s*(ns|us|ms|s|m|h|d)?$/);
  if (!m) {
    return undefined;
  }
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) {
    return undefined;
  }
  switch (m[2]) {
    case 'ns':
      return Math.round(n / 1e6);
    case 'us':
      return Math.round(n / 1e3);
    case 'ms':
      return Math.round(n);
    case 's':
    case undefined:
      return Math.round(n * 1000);
    case 'm':
      return Math.round(n * 60_000);
    case 'h':
      return Math.round(n * 3_600_000);
    case 'd':
      return Math.round(n * 86_400_000);
    default:
      return undefined;
  }
}

/**
 * Parse a Trino data size into bytes.
 *
 * Accepts numeric bytes (returned as-is, rounded) or strings of the
 * form `<number><unit>` with unit one of `B`, `kB` / `KB`, `MB`,
 * `GB`, `TB`, `PB` (case-insensitive). A missing unit is treated as
 * bytes. Returns `undefined` for inputs that don't match.
 */
export function parseDataSize(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return Math.round(raw);
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const m = raw.match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB|PB)?$/);
  if (!m) {
    return undefined;
  }
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) {
    return undefined;
  }
  const unit = (m[2] ?? 'B').toUpperCase();
  switch (unit) {
    case 'B':
      return Math.round(n);
    case 'KB':
      return Math.round(n * 1024);
    case 'MB':
      return Math.round(n * 1024 ** 2);
    case 'GB':
      return Math.round(n * 1024 ** 3);
    case 'TB':
      return Math.round(n * 1024 ** 4);
    case 'PB':
      return Math.round(n * 1024 ** 5);
    default:
      return undefined;
  }
}

/**
 * Parse a Trino duration into nanoseconds (millis * 1e6). Convenience
 * wrapper used by operator-summary trimming where the consumer expects
 * nanos — e.g. `operatorSummary[].cpuNanos`.
 */
export function parseDurationNanos(raw: unknown): number | undefined {
  const ms = parseDurationMs(raw);
  if (ms === undefined) {
    return undefined;
  }
  return ms * 1e6;
}
