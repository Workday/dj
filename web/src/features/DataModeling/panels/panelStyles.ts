/**
 * Shared typographic + layout tokens for the CTE editor tabs.
 *
 * Each tab (General, Select, Filters, Validation) was using its own ad-hoc
 * combination of `text-sm font-medium`, `uppercase tracking-wide`,
 * `text-[10px]`, etc. -- inconsistent enough that section headings, field
 * labels, hints, and badges visually differed across tabs. This file
 * collects the canonical class strings so the tabs stay aligned and a
 * future tweak only needs to land here.
 *
 * The tokens are intentionally Tailwind-class strings (rather than CSS
 * variables) so they compose with conditional classes (`clsx`-style) at
 * the call site.
 */

/**
 * Section heading at the top of each subsection within a tab. Designed to
 * sit inside a `SECTION_HEADER_ROW` container along with an optional
 * tooltip icon -- so the token itself drops vertical margin (`mb-2`
 * lives on the row instead) and uses `leading-none` to vertically
 * centre against `w-4 h-4` icons.
 *
 * If you render the heading standalone (no tooltip), wrap it in a
 * `<div className={SECTION_HEADER_ROW}>` for consistent spacing with
 * sibling headings.
 */
export const SECTION_HEADING =
  'text-sm font-medium text-foreground leading-none';

/**
 * Container row for a section heading + optional tooltip icon. Use as
 *
 *   <div className={SECTION_HEADER_ROW}>
 *     <h3 className={SECTION_HEADING}>Joins</h3>
 *     <Tooltip ...><InformationCircleIcon className="w-4 h-4" /></Tooltip>
 *   </div>
 *
 * The `gap-1.5` keeps the icon close enough to look like it belongs to
 * the heading without crowding it; `items-center` lines the icon's mid
 * point with the heading's cap height (heading uses `leading-none`).
 */
export const SECTION_HEADER_ROW = 'flex items-center gap-1.5 mb-2';

/** Field label sitting above an input / segmented control. */
export const FIELD_LABEL = 'block text-sm text-foreground mb-1';

/**
 * Field label rendered in monospace because the underlying key surfaces in
 * the user's JSON (e.g. `exclude_framework_artifacts`).
 */
export const FIELD_LABEL_MONO = 'block text-sm text-foreground mb-1 font-mono';

/** Secondary hint shown next to a label or under a section. */
export const SECONDARY_HINT = 'text-xs text-muted-foreground';

/**
 * Muted chip used for severity / metadata badges (e.g. "inherited" badge,
 * validation severity). Reads as metadata without competing visually
 * with the surrounding text.
 */
export const MUTED_CHIP =
  'text-[11px] text-muted-foreground border border-neutral rounded px-1 py-0.5';

/** Monospace value rendering -- column names, key names, etc. */
export const MONO_VALUE = 'font-mono text-sm';

/** Vertical spacing between sections within a tab body. */
export const SECTION_GAP = 'space-y-5';

/**
 * Tab body padding. `p-3` keeps labels, inputs, and controls clear of
 * the popover edge while leaving room for the scroll gutter.
 */
export const TAB_BODY =
  'overflow-y-auto h-full p-3 react-flow__node-scrollable';

/** Dashed-bordered empty-state block. */
export const EMPTY_STATE =
  'border border-dashed border-neutral rounded p-4 text-sm text-muted-foreground';
