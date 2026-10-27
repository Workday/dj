import type { PythonModelUpstreamSource } from '@shared/framework/types';

/** Normalize a single object or array into a list of upstream source entries. */
export function normalizeUpstreamSources(
  raw: unknown,
): PythonModelUpstreamSource[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.filter(isUpstreamSourceEntry);
  }
  if (isUpstreamSourceEntry(raw)) {
    return [raw];
  }
  return [];
}

function isUpstreamSourceEntry(
  value: unknown,
): value is PythonModelUpstreamSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    (entry.type === 'trino' || entry.type === 'external') &&
    typeof entry.value === 'string' &&
    entry.value.length > 0
  );
}

/** Serialize upstream sources for the Iceberg `python_model_upstream_sources` property. */
export function serializeUpstreamSourcesForProperty(
  entries: PythonModelUpstreamSource[],
): string {
  return JSON.stringify(entries);
}

/**
 * Parse `python_model_upstream_sources` from Iceberg table properties.
 *
 * The raw value may arrive as a JSON string (e.g. read verbatim from the
 * property) OR as an already-parsed array/object: the Trino CSV reader
 * (`parseTrinoValue`) eagerly `JSON.parse`s any cell starting with `[`/`{`,
 * so the property surfaces as a structured value rather than a string.
 * Both shapes are handled. Falls back to legacy comma-separated
 * `schema.table` strings when a string fails JSON parsing.
 */
export function parseUpstreamSourcesProperty(
  raw: unknown,
): PythonModelUpstreamSource[] {
  if (raw == null) {
    return [];
  }

  // Already parsed into an array/object by the Trino CSV reader.
  if (typeof raw !== 'string') {
    return normalizeUpstreamSources(raw);
  }

  if (!raw.trim()) {
    return [];
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return normalizeUpstreamSources(parsed);
    } catch {
      // fall through to legacy format
    }
  }

  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((value) => ({ type: 'trino' as const, value }));
}

export interface ParsedTrinoUpstreamRef {
  catalog: string;
  schema: string;
  table: string;
}

/**
 * Parse a trino upstream_sources value as catalog.schema.table (3-part)
 * or schema.table (2-part, using fallbackCatalog).
 */
export function parseTrinoUpstreamValue(
  value: string,
  fallbackCatalog: string,
): ParsedTrinoUpstreamRef | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split('.');
  if (parts.length >= 3) {
    return {
      catalog: parts[0]!,
      schema: parts[1]!,
      table: parts.slice(2).join('.'),
    };
  }
  if (parts.length === 2) {
    return {
      catalog: fallbackCatalog,
      schema: parts[0]!,
      table: parts[1]!,
    };
  }
  return null;
}
