export interface FragmentSelectionResult {
  include?: string[];
  exclude?: string[];
}

function isEntryFor(item: unknown, fragment: string): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    'fragment' in item &&
    (item as { fragment?: unknown }).fragment === fragment
  );
}

/**
 * Write a fragment's column selection back into a `select` list. An existing
 * entry for the fragment is replaced at its own index, so its position and any
 * `overrides` survive. A new entry is appended. With `remove`, the entry is
 * dropped instead.
 */
export function upsertFragmentSelect(
  select: readonly unknown[],
  fragment: string,
  type: string,
  result: FragmentSelectionResult,
  remove = false,
): unknown[] {
  const index = select.findIndex((item) => isEntryFor(item, fragment));
  if (remove) {
    return select.filter((_, i) => i !== index);
  }

  const previous =
    index >= 0 ? (select[index] as Record<string, unknown>) : undefined;
  const entry: Record<string, unknown> = { fragment, type };
  if (previous?.overrides !== undefined) {
    entry.overrides = previous.overrides;
  }
  if (result.include?.length) {
    entry.include = result.include;
  }
  if (result.exclude?.length) {
    entry.exclude = result.exclude;
  }

  if (index < 0) {
    return [...select, entry];
  }
  const next = [...select];
  next[index] = entry;
  return next;
}
