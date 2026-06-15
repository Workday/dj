/**
 * Shared filter primitives for the Live and History tabs in the Query
 * Control Center. Both tabs render the same filter UI
 * (search + state chips + user/source dropdowns), so we keep the
 * constants and helpers in one place to avoid two-copy drift.
 *
 * Tab-specific extras (`dbtOnly` on Live, `profileFilter` on History)
 * are passed in as optional props on `QueryFilterBar` — they don't
 * need to be reflected here.
 */

export const KNOWN_STATES = [
  'RUNNING',
  'FINISHED',
  'FAILED',
  'QUEUED',
] as const;
export type KnownState = (typeof KNOWN_STATES)[number];
export type StateChip = KnownState | 'other';
export const STATE_CHIPS: readonly StateChip[] = [...KNOWN_STATES, 'other'];

/** Bucket non-canonical states (PLANNING, STARTING, …) under `'other'`. */
export function stateKeyFor(state: string): StateChip {
  return (KNOWN_STATES as readonly string[]).includes(state)
    ? (state as KnownState)
    : 'other';
}

/**
 * Fully overrides SelectSingle's default `h-10 py-2.5 pl-3 pr-16` so
 * the User/Source/Profile filter selects can fit a 420 px sidebar
 * without wrapping the Clear button to a new row. Passed to
 * `<SelectSingle className={...}>` — the prop *replaces* the default
 * (see SelectSingle.tsx). Keeps the chevron room via `pr-7`.
 */
export const COMPACT_SELECT_CLASSNAME =
  'w-full h-7 rounded border border-neutral bg-background text-background-contrast text-xs px-2 pr-7 focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Standard `value: ''` = "All" header, followed by distinct values
 * from the visible rows. If the current value isn't in the distinct
 * list (e.g. a filter survived after the underlying row was filtered
 * out), it's preserved at the bottom with a `(not in results)` label
 * so users always see what they're filtering by.
 */
export function buildSingleSelectOptions(
  distinct: string[],
  currentValue: string,
  allLabel = 'All',
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [
    { value: '', label: allLabel },
    ...distinct.map((v) => ({ value: v, label: v })),
  ];
  if (currentValue && !distinct.includes(currentValue)) {
    opts.push({
      value: currentValue,
      label: `${currentValue} (not in results)`,
    });
  }
  return opts;
}
