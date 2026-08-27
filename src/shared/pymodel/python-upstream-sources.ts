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
 * Falls back to legacy comma-separated `schema.table` strings when JSON parse fails.
 */
export function parseUpstreamSourcesProperty(
  raw: string | undefined,
): PythonModelUpstreamSource[] {
  if (!raw?.trim()) {
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
