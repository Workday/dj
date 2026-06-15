import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  Bars3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  Button,
  Checkbox,
  DialogBox,
  InputText,
  RadioGroup,
  SelectSingle,
  Tooltip,
} from '@web/elements';
import { type CteState, useModelStore } from '@web/stores/useModelStore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { AddColumnBasic } from '../components/AddColumnBasic';
import {
  ColumnSection,
  type ColumnSectionColumn,
} from '../components/ColumnSection';
import {
  extractColumnsFromNode,
  findModelNode,
} from '../utils/manifestColumns';
import {
  EMPTY_STATE,
  FIELD_LABEL,
  FIELD_LABEL_MONO,
  SECONDARY_HINT,
  SECTION_GAP,
  SECTION_HEADER_ROW,
  SECTION_HEADING,
  TAB_BODY,
} from './panelStyles';
import { useProjectModels } from './useProjectModels';

interface CteSelectTabProps {
  cte: CteState;
  onPatch: (patch: Partial<CteState>) => void;
}

/**
 * Schema-aware select-item kind discriminators. The CTE select array accepts
 * 15 distinct shapes; we group them as "bulk" (the six `*_from_*` directives
 * that operate on a whole upstream) and "manual" (every other shape, written
 * one row at a time).
 */
type SelectItemKind =
  | 'col_name' // bare string (passthrough)
  | 'col'
  | 'col_with_agg'
  | 'expr'
  | 'expr_with_agg'
  | 'interval'
  | 'from_model'
  | 'from_model_with_agg'
  | 'from_cte'
  | 'all_from_model'
  | 'dims_from_model'
  | 'fcts_from_model'
  | 'all_from_cte'
  | 'dims_from_cte'
  | 'fcts_from_cte';

type BulkMode = 'none' | 'all' | 'dims' | 'fcts';
type BulkUpstream = 'model' | 'cte';

const TYPE_OPTIONS = [
  { label: 'dim', value: 'dim' },
  { label: 'fct', value: 'fct' },
];

const AGG_OPTIONS = [
  { label: 'count', value: 'count' },
  { label: 'sum', value: 'sum' },
  { label: 'min', value: 'min' },
  { label: 'max', value: 'max' },
  { label: 'hll', value: 'hll' },
  { label: 'tdigest', value: 'tdigest' },
];

const INTERVAL_OPTIONS = [
  { label: 'day', value: 'day' },
  { label: 'hour', value: 'hour' },
  { label: 'month', value: 'month' },
  { label: 'year', value: 'year' },
];

/**
 * Devtools-toggleable trace. Set `window.DJ_DEBUG_CTE_SELECT = true` to
 * surface before/after snapshots at every bulk-row mutation site. The flag
 * is read fresh on every call so it can be flipped mid-session from the
 * console without a reload.
 */
function debugCteSelect(label: string, payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const flag = (window as unknown as Record<string, unknown>)
    .DJ_DEBUG_CTE_SELECT;
  if (!flag) return;

  console.log(`[CteSelectTab] ${label}`, payload);
}

/**
 * Manual-row kinds, surfaced in the "+ Add manual column" picker. The plan's
 * shorthand: Expression / Expression + agg / Interval / From upstream model /
 * From earlier CTE / Bare column name.
 */
const MANUAL_KIND_OPTIONS: { label: string; value: SelectItemKind }[] = [
  { label: 'Bare column name (passthrough)', value: 'col_name' },
  { label: 'Column (with metadata)', value: 'col' },
  { label: 'Column + aggregation', value: 'col_with_agg' },
  { label: 'Expression', value: 'expr' },
  { label: 'Expression + aggregation', value: 'expr_with_agg' },
  { label: 'Interval (datetime)', value: 'interval' },
  { label: 'From upstream model (named)', value: 'from_model' },
  { label: 'From upstream model + agg', value: 'from_model_with_agg' },
  { label: 'From earlier CTE (named)', value: 'from_cte' },
];

function inferKind(item: unknown): SelectItemKind {
  if (typeof item === 'string') return 'col_name';
  if (!item || typeof item !== 'object') return 'col_name';
  const o = item as Record<string, unknown>;
  if (typeof o.type === 'string') {
    if (o.type === 'all_from_model') return 'all_from_model';
    if (o.type === 'dims_from_model') return 'dims_from_model';
    if (o.type === 'fcts_from_model') return 'fcts_from_model';
    if (o.type === 'all_from_cte') return 'all_from_cte';
    if (o.type === 'dims_from_cte') return 'dims_from_cte';
    if (o.type === 'fcts_from_cte') return 'fcts_from_cte';
  }
  if ('interval' in o && typeof o.interval === 'string') return 'interval';
  if ('cte' in o && typeof o.cte === 'string') return 'from_cte';
  if ('model' in o && typeof o.model === 'string') {
    if ('agg' in o || 'aggs' in o) return 'from_model_with_agg';
    return 'from_model';
  }
  if ('expr' in o && typeof o.expr === 'string') {
    if ('agg' in o || 'aggs' in o) return 'expr_with_agg';
    return 'expr';
  }
  if ('agg' in o || 'aggs' in o) return 'col_with_agg';
  return 'col';
}

function makeNewItem(kind: SelectItemKind): unknown {
  switch (kind) {
    case 'col_name':
      return '';
    case 'col':
      return { name: '', type: 'dim' };
    case 'col_with_agg':
      return { name: '', type: 'fct' };
    case 'expr':
      return { name: '', expr: '', type: 'dim' };
    case 'expr_with_agg':
      return { name: '', expr: '', type: 'fct' };
    case 'interval':
      return { name: 'datetime', interval: 'day', type: 'dim' };
    case 'from_model':
      return { model: '', name: '', type: 'dim' };
    case 'from_model_with_agg':
      return { model: '', name: '', type: 'fct' };
    case 'from_cte':
      return { cte: '', name: '', type: 'dim' };
    case 'all_from_model':
    case 'dims_from_model':
    case 'fcts_from_model':
      return { type: kind, model: '' };
    case 'all_from_cte':
    case 'dims_from_cte':
    case 'fcts_from_cte':
      return { type: kind, cte: '' };
  }
}

function isBulkKind(kind: SelectItemKind): boolean {
  return (
    kind === 'all_from_model' ||
    kind === 'dims_from_model' ||
    kind === 'fcts_from_model' ||
    kind === 'all_from_cte' ||
    kind === 'dims_from_cte' ||
    kind === 'fcts_from_cte'
  );
}

function bulkModeFromKind(kind: SelectItemKind): BulkMode {
  if (kind === 'all_from_model' || kind === 'all_from_cte') return 'all';
  if (kind === 'dims_from_model' || kind === 'dims_from_cte') return 'dims';
  if (kind === 'fcts_from_model' || kind === 'fcts_from_cte') return 'fcts';
  return 'none';
}

function kindForBulk(
  mode: BulkMode,
  upstream: BulkUpstream,
): SelectItemKind | null {
  if (mode === 'none') return null;
  const role = mode;
  if (upstream === 'cte') {
    if (role === 'all') return 'all_from_cte';
    if (role === 'dims') return 'dims_from_cte';
    return 'fcts_from_cte';
  }
  if (role === 'all') return 'all_from_model';
  if (role === 'dims') return 'dims_from_model';
  return 'fcts_from_model';
}

/**
 * Detect whether the CTE's `from` clause points at a model or a CTE so the
 * bulk picker writes the appropriate `_from_{model,cte}` variant. Defaults
 * to `model` when the picker has no upstream yet (the General tab's Source
 * radios are how that gets set).
 */
function inferBulkUpstream(from: CteState['from']): BulkUpstream {
  const f = from ?? {};
  if (typeof f.cte === 'string') return 'cte';
  return 'model';
}

interface BulkItemView {
  index: number;
  kind: SelectItemKind;
  mode: BulkMode;
  upstream: BulkUpstream;
  exclude: string[];
  include: string[];
  /** Identifier (`{ model: x }` or `{ cte: x }`) so the new mode can preserve it. */
  upstreamValue: string;
}

/**
 * Find the first bulk directive in the select array (the visual editor only
 * surfaces one in this single-panel view). Returns `null` when the array
 * has only manual rows.
 */
function findBulkItem(items: unknown[]): BulkItemView | null {
  for (let i = 0; i < items.length; i++) {
    const kind = inferKind(items[i]);
    if (!isBulkKind(kind)) continue;
    const o = items[i] as Record<string, unknown>;
    const upstream: BulkUpstream = kind.endsWith('_from_cte') ? 'cte' : 'model';
    return {
      index: i,
      kind,
      mode: bulkModeFromKind(kind),
      upstream,
      exclude: Array.isArray(o.exclude) ? (o.exclude as string[]) : [],
      include: Array.isArray(o.include) ? (o.include as string[]) : [],
      upstreamValue:
        upstream === 'cte'
          ? typeof o.cte === 'string'
            ? o.cte
            : ''
          : typeof o.model === 'string'
            ? o.model
            : '',
    };
  }
  return null;
}

/**
 * Plain-passthrough predicate. A select entry counts as "plain" when it
 * just keeps an upstream column as-is, with no SQL-altering metadata:
 *   - bare string entries (`'col_name'`)
 *   - `{ name: 'col_name' }` (or `{ name, type, data_type, description }`)
 *     rows with no overrides that change the SQL output -- specifically no
 *     `expr`, no `agg`/`aggs`, no `interval`, and no `model`/`cte` pointer
 *     that would route the column through a different upstream.
 *
 * These are the rows the upstream-column picker can fully represent via
 * its checkbox. Anything else (expr, agg, interval, cross-source) is a
 * derived row that belongs in the "Manual rows" list.
 */
function isPlainPassthroughItem(item: unknown): boolean {
  if (typeof item === 'string') return true;
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) return false;
  if (typeof o.expr === 'string') return false;
  if ('agg' in o || 'aggs' in o) return false;
  if (typeof o.interval === 'string') return false;
  if (typeof o.model === 'string') return false;
  if (typeof o.cte === 'string') return false;
  return true;
}

/**
 * Plain-passthrough predicate scoped to a specific column name. Built on
 * top of `isPlainPassthroughItem` -- same "no SQL-altering metadata"
 * gate, but additionally requires the entry to refer to `columnName`.
 *
 * Used both for "is this column already kept by the manual rows?" and for
 * "remove all duplicates of this column when unchecking". Derived rows
 * (with `expr`, `agg`, `model`, ...) are NOT matched, so a resolved-column
 * toggle never silently rewrites them.
 */
function isPlainPassthroughForColumn(
  item: unknown,
  columnName: string,
): boolean {
  if (!isPlainPassthroughItem(item)) return false;
  if (typeof item === 'string') return item === columnName;
  const o = item as Record<string, unknown>;
  return o.name === columnName;
}

function hasInvalidLightdashMetrics(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  const ld = o.lightdash as Record<string, unknown> | undefined;
  if (!ld) return false;
  return (
    ('metrics' in ld && ld.metrics != null) ||
    ('metrics_merge' in ld && ld.metrics_merge != null)
  );
}

/**
 * CTE Select tab — single-panel design.
 *
 * Layout (top to bottom):
 *  1. Header pill with the resolved-column count (live from `cteAnalysis`).
 *  2. Bulk-directive picker (radio: None / All / Dims / Fcts) that maps onto
 *     the `*_from_{model,cte}` schema variants based on the CTE's `from`.
 *  3. Resolved-columns checkbox list. Toggling under an active directive
 *     writes/removes the column from `exclude[]` (default-keep semantics);
 *     toggling with no active directive falls through to manual entries.
 *  4. Manual rows: drag-handle reorderable list of every non-bulk select
 *     item, each with an inline "Configure" expansion exposing the schema
 *     fields relevant to its kind.
 *  5. "+ Add manual column" dropdown for the 9 manual kinds.
 *  6. Validation chips (`lightdash.metrics` on a CTE row → silently dropped
 *     at sync time; surface a warning).
 *
 * All 15 schema shapes still round-trip — only the input UI changed.
 */
export const CteSelectTab: React.FC<CteSelectTabProps> = ({ cte, onPatch }) => {
  const ctes = useModelStore((s) => s.ctes);
  const editingCteIndex = useModelStore((s) => s.editingCteIndex);
  const cteAnalysis = useModelStore((s) => s.cteAnalysis);
  const { manifest } = useProjectModels();

  const items = useMemo(
    () => (Array.isArray(cte.select) ? cte.select : []),
    [cte.select],
  );

  const bulk = useMemo(() => findBulkItem(items), [items]);
  const bulkUpstream: BulkUpstream = bulk
    ? bulk.upstream
    : inferBulkUpstream(cte.from);

  const earlierCteOptions = useMemo(() => {
    const ix = editingCteIndex ?? ctes.length;
    return ctes.slice(0, ix).map((c) => ({ label: c.name, value: c.name }));
  }, [ctes, editingCteIndex]);

  // Upstream-derived column list -- what's available to pick from. The
  // previous version pulled from `cteAnalysis.columns[cte.name]`, which is
  // this CTE's *own output* (i.e. what it emits after applying its select).
  // That caused the picker to shrink after each selection: as soon as the
  // user added columns explicitly, the cte's output narrowed and the
  // remaining unselected columns disappeared from the list.
  //
  // What we actually want is the union of columns the upstream(s) make
  // available, regardless of what this CTE has currently selected:
  //   - `from.model` -> read columns from the manifest's model node
  //   - `from.cte`   -> read the upstream CTE's analysis output
  //   - `from.union` -> head-only fallback (intersection logic would be
  //     more accurate but is out of scope; head is correct for the common
  //     case where union branches share their column shape)
  //   - `from.join`  -> head-only here; joined column lists could be merged
  //     in a follow-up
  const resolvedColumns = useMemo(() => {
    const fromObj = cte.from ?? {};
    let raw: (typeof cteAnalysis.columns)[string] = [];

    if (typeof fromObj.cte === 'string' && fromObj.cte) {
      raw = cteAnalysis.columns[fromObj.cte] ?? [];
    } else if (typeof fromObj.model === 'string' && fromObj.model && manifest) {
      const node = findModelNode(manifest, fromObj.model);
      raw = extractColumnsFromNode(node).map((c) => ({
        name: c.name,
        type: c.type === 'fact' ? ('fct' as const) : ('dim' as const),
        dataType: c.dataType,
        description: c.description,
      }));
    }

    // Dedupe by `name`. Joined / unioned heads can introduce duplicates;
    // keep the first occurrence so the source's natural order is preserved
    // and the checkbox list's `key={col.name}` invariant holds.
    const seen = new Set<string>();
    const out: typeof raw = [];
    for (const col of raw) {
      if (seen.has(col.name)) continue;
      seen.add(col.name);
      out.push(col);
    }
    return out;
  }, [cte.from, cteAnalysis.columns, manifest]);

  // Header pill stays on the CTE's *own* output count -- the number the
  // SELECT eventually emits, surfaced by the analysis pass. This is the
  // number users want to see ("how many columns does this CTE produce");
  // it's independent of which upstream we picker from above.
  const ownOutputCount = (cteAnalysis.columns[cte.name] ?? []).length;

  /**
   * Manual rows = every select item except (a) the tracked bulk directive
   * and (b) plain passthroughs. Plain passthroughs are represented in the
   * upstream column-picker above as ticked checkboxes; double-rendering
   * them in the Manual rows section would suggest two independent edits
   * for the same row and confuse the "resolved N of M" counters.
   */
  const manualItems = useMemo(
    () =>
      items
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(({ originalIndex }) => bulk?.index !== originalIndex)
        .filter(({ item }) => !isPlainPassthroughItem(item)),
    [items, bulk],
  );

  const writeItems = useCallback(
    (next: unknown[]) => {
      onPatch({ select: next.length > 0 ? next : undefined });
    },
    [onPatch],
  );

  // Cache of the most recently dropped bulk directive's `include` / `exclude`
  // arrays, scoped to a (role, upstream) pair. Restored on a matching
  // re-enable so a user who clicks "Custom" then "Dims" again (or swaps
  // Dims -> Fcts -> Dims) does not lose the column list they curated.
  // Cleared per CTE: a fresh editor mount starts with no cache.
  type CachedBulk = {
    role: BulkMode;
    upstream: BulkUpstream;
    include: string[];
    exclude: string[];
  };
  const lastRemovedBulkRef = useRef<CachedBulk | null>(null);

  // Pending destructive bulk change awaiting confirmation. When non-null,
  // a DialogBox is rendered and `onConfirm` runs only if the user accepts.
  // The radio group stays controlled off `bulk?.mode` so canceling reverts
  // the visual state automatically without any extra wiring.
  type PendingConfirm = {
    title: string;
    description: string;
    onConfirm: () => void;
  };
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );

  // Keep the bulk row's `model` / `cte` in lockstep with the CTE's
  // `from.model` / `from.cte`. The standalone "Upstream model" / "Upstream
  // CTE" input that used to live under the radio is gone -- the upstream
  // is whatever the General tab sets, and the bulk directive should
  // mirror it without manual intervention. We patch only when the value
  // actually drifts so this effect doesn't loop on itself.
  useEffect(() => {
    if (!bulk) return;
    const fromObj = cte.from ?? {};
    const desired =
      bulk.upstream === 'cte'
        ? typeof fromObj.cte === 'string'
          ? fromObj.cte
          : ''
        : typeof fromObj.model === 'string'
          ? fromObj.model
          : '';
    if (desired === bulk.upstreamValue) return;
    const existing = items[bulk.index] as Record<string, unknown>;
    const next: Record<string, unknown> = { ...existing };
    if (bulk.upstream === 'cte') {
      next.cte = desired;
      delete next.model;
    } else {
      next.model = desired;
      delete next.cte;
    }
    const copy = [...items];
    copy[bulk.index] = next;
    debugCteSelect('sync-bulk-upstream', {
      bulkIndex: bulk.index,
      from: existing,
      to: next,
    });
    writeItems(copy);
  }, [bulk, cte.from, items, writeItems]);

  const updateItemAt = useCallback(
    (originalIndex: number, next: unknown) => {
      const copy = [...items];
      copy[originalIndex] = next;
      writeItems(copy);
    },
    [items, writeItems],
  );

  const removeItemAt = useCallback(
    (originalIndex: number) => {
      writeItems(items.filter((_, i) => i !== originalIndex));
    },
    [items, writeItems],
  );

  // Bulk-mode change. Three cases:
  //   - new mode is none -> drop the bulk row (caching include/exclude so
  //     accidental round-trips don't destroy the curated column list).
  //   - new mode + existing bulk row -> swap kind in place. Role swaps drop
  //     include/exclude (the column set differs across roles); a confirm
  //     dialog fires first when those arrays are non-empty.
  //   - new mode + no existing bulk row -> push a fresh one at the front,
  //     restoring cached include/exclude if the (role, upstream) matches.
  const handleBulkModeChange = useCallback(
    (nextMode: BulkMode) => {
      if (nextMode === 'none') {
        if (!bulk) return;
        const dropBulk = () => {
          lastRemovedBulkRef.current = {
            role: bulk.mode,
            upstream: bulk.upstream,
            include: [...bulk.include],
            exclude: [...bulk.exclude],
          };
          debugCteSelect('remove-bulk', {
            bulkIndex: bulk.index,
            cached: lastRemovedBulkRef.current,
          });
          writeItems(items.filter((_, i) => i !== bulk.index));
        };
        if (bulk.include.length > 0 || bulk.exclude.length > 0) {
          setPendingConfirm({
            title: 'Remove bulk directive?',
            description:
              'Removing the directive will drop the column include/exclude list. The list is cached and will be restored if you re-enable the same role on the same upstream.',
            onConfirm: dropBulk,
          });
          return;
        }
        dropBulk();
        return;
      }
      const nextKind = kindForBulk(nextMode, bulkUpstream);
      if (!nextKind) return;
      if (bulk) {
        const roleSwap = bulk.mode !== nextMode;
        const swapBulk = () => {
          const existing = items[bulk.index] as Record<string, unknown>;
          const swapped: Record<string, unknown> = {
            ...existing,
            type: nextKind,
          };
          if (roleSwap) {
            // Cache before stripping so a later swap-back can restore.
            lastRemovedBulkRef.current = {
              role: bulk.mode,
              upstream: bulk.upstream,
              include: [...bulk.include],
              exclude: [...bulk.exclude],
            };
            delete swapped.exclude;
            delete swapped.include;
          }
          const copy = [...items];
          copy[bulk.index] = swapped;
          debugCteSelect('swap-bulk-kind', {
            bulkIndex: bulk.index,
            roleSwap,
            from: existing,
            to: swapped,
          });
          writeItems(copy);
        };
        if (roleSwap && (bulk.include.length > 0 || bulk.exclude.length > 0)) {
          setPendingConfirm({
            title: 'Switch bulk role?',
            description:
              'Switching between All / Dims / Fcts resets the column include/exclude list because the eligible column set differs across roles. The list is cached and will be restored if you switch back.',
            onConfirm: swapBulk,
          });
          return;
        }
        swapBulk();
      } else {
        const fresh = makeNewItem(nextKind) as Record<string, unknown>;
        // Preserve any current upstream value on `from` so the directive
        // points at the right place out of the gate.
        if (bulkUpstream === 'cte') {
          const fromCte = (cte.from as Record<string, unknown> | undefined)
            ?.cte;
          if (typeof fromCte === 'string') fresh.cte = fromCte;
        } else {
          const fromModel = (cte.from as Record<string, unknown> | undefined)
            ?.model;
          if (typeof fromModel === 'string') fresh.model = fromModel;
        }
        // Restore from the most recent removed/role-swapped bulk if it
        // matches the (role, upstream) the user is re-enabling now. Empty
        // arrays are deliberately NOT written back so the schema-required
        // `minItems: 1` invariant on `include` / `exclude` is not violated.
        const cached = lastRemovedBulkRef.current;
        if (
          cached &&
          cached.role === nextMode &&
          cached.upstream === bulkUpstream
        ) {
          if (cached.include.length > 0) fresh.include = [...cached.include];
          if (cached.exclude.length > 0) fresh.exclude = [...cached.exclude];
        }
        debugCteSelect('prepend-fresh-bulk', {
          fresh,
          restoredFromCache:
            cached &&
            cached.role === nextMode &&
            cached.upstream === bulkUpstream,
        });
        writeItems([fresh, ...items]);
      }
    },
    [bulk, bulkUpstream, items, writeItems, cte.from],
  );

  /**
   * Resolved-column checkbox toggle. Semantics:
   *   - If a bulk role applies to this column (all-role covers everything;
   *     dims-role only covers dims; fcts-role only facts), the column is
   *     "kept by default". Unchecking adds it to `exclude[]`; rechecking
   *     removes it.
   *   - If a bulk row exists but doesn't cover this column (e.g. dims
   *     directive + a fact column), the column needs an explicit manual
   *     entry — fall through to "add a passthrough manual row".
   *   - If no bulk row exists at all, also fall through to manual.
   */
  const handleResolvedColumnToggle = useCallback(
    (
      columnName: string,
      isCovered: boolean,
      isExcluded: boolean,
      columnRole?: string,
    ) => {
      if (bulk && isCovered) {
        const existing = items[bulk.index] as Record<string, unknown>;
        const exclude = Array.isArray(existing.exclude)
          ? (existing.exclude as string[]).slice()
          : [];
        const nextExclude = isExcluded
          ? exclude.filter((n) => n !== columnName)
          : [...exclude, columnName];
        const next: Record<string, unknown> = { ...existing };
        if (nextExclude.length > 0) {
          next.exclude = nextExclude;
        } else {
          delete next.exclude;
        }
        const copy = [...items];
        copy[bulk.index] = next;
        writeItems(copy);
        return;
      }
      // No bulk in effect (or row not covered) -- toggling the checkbox is
      // synonymous with adding/removing a passthrough entry. We match both
      // bare-string and `{ name: X }` non-bulk objects so toggling a column
      // that already exists as a metadata-bearing row (without an `expr` /
      // `agg` / etc.) removes it instead of appending a duplicate bare
      // string. Derived rows (with `expr`, `agg`, `model`, ...) are left
      // untouched -- the user has to remove those from the manual list.
      const exists = items.some((it) =>
        isPlainPassthroughForColumn(it, columnName),
      );
      if (exists) {
        writeItems(
          items.filter((it) => !isPlainPassthroughForColumn(it, columnName)),
        );
      } else {
        // For columns whose upstream role is `fct`, write the object
        // form `{ name, type: 'fct' }` so the framework keeps treating
        // it as a fact downstream (a bare string would default to
        // `dim`). Dim and unknown roles still emit a bare string for
        // the common-case minimal JSON.
        const next: unknown =
          columnRole === 'fct' ? { name: columnName, type: 'fct' } : columnName;
        writeItems([...items, next]);
      }
    },
    [bulk, items, writeItems],
  );

  // Manual-list reorder. Map the within-manual indices back to the
  // underlying `cte.select` indices so the relative order of the bulk row
  // is preserved (the bulk row never participates in the drag).
  const handleManualDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const fromIdx = result.source.index;
      const toIdx = result.destination.index;
      if (fromIdx === toIdx) return;
      const fromOriginal = manualItems[fromIdx]?.originalIndex;
      const toOriginal = manualItems[toIdx]?.originalIndex;
      if (fromOriginal === undefined || toOriginal === undefined) return;
      const copy = [...items];
      const [moved] = copy.splice(fromOriginal, 1);
      copy.splice(toOriginal, 0, moved);
      writeItems(copy);
    },
    [manualItems, items, writeItems],
  );

  // Inline-form toggle. Replaces the old `+ Add manual column` Combobox so
  // we get the same UX as the main-model `AddColumnBasic` -- including a
  // Configure entrypoint for Lightdash dimension / interval keys that are
  // CTE-compatible.
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddConfigure, setShowAddConfigure] = useState(false);
  const [pendingLightdash, setPendingLightdash] = useState<
    Record<string, unknown>
  >({});

  const resetAddForm = useCallback(() => {
    setShowAddForm(false);
    setShowAddConfigure(false);
    setPendingLightdash({});
  }, []);

  const handleInlineAdd = useCallback(
    (item: unknown) => {
      // Merge any CTE-compatible Lightdash dimension config the user
      // configured via the inline Configure popover. The popover only
      // exposes keys that `validateCteLightdashMetrics` lets through --
      // metrics / metrics_merge are not rendered at all -- so the merged
      // row never carries fields that sync would silently drop.
      const lightdashKeys = Object.keys(pendingLightdash).filter(
        (k) => pendingLightdash[k] !== undefined && pendingLightdash[k] !== '',
      );
      let finalRow: unknown = item;
      if (lightdashKeys.length > 0) {
        if (typeof item === 'string') {
          // Promote bare passthrough strings to `{ name: x, lightdash: ... }`
          // so the Lightdash block has somewhere to live.
          finalRow = {
            name: item,
            lightdash: { dimension: { ...pendingLightdash } },
          };
        } else if (item && typeof item === 'object') {
          finalRow = {
            ...(item as Record<string, unknown>),
            lightdash: { dimension: { ...pendingLightdash } },
          };
        }
      }
      writeItems([...items, finalRow]);
      resetAddForm();
    },
    [items, pendingLightdash, resetAddForm, writeItems],
  );

  // Build the upstream-models list for the inline form: the CTE's own
  // `from.model` and any models reachable via `from.join`. Keeps the picker
  // anchored on the CTE's actual upstreams rather than the main model's.
  const cteUpstreamModels = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const fromObj = cte.from ?? {};
    if (typeof fromObj.model === 'string' && fromObj.model) {
      out.push({ value: fromObj.model, label: fromObj.model });
    }
    if (Array.isArray(fromObj.join)) {
      for (const j of fromObj.join as Array<Record<string, unknown>>) {
        if (typeof j?.model === 'string' && j.model) {
          if (!out.some((m) => m.value === j.model)) {
            out.push({ value: j.model, label: j.model });
          }
        }
      }
    }
    return out;
  }, [cte.from]);

  // In-scope CTE list for the inline form's Source CTE picker. Mirrors
  // `cteUpstreamModels`: head + joined + union branches. The previous
  // version wired this to `earlierCteOptions` (every CTE defined before
  // this one), which let users author rows pointing at CTEs that aren't
  // joined / unioned into this one -- valid JSON but unresolvable at SQL
  // generation time.
  const cteUpstreamCtes = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const fromObj = cte.from ?? {};
    if (typeof fromObj.cte === 'string' && fromObj.cte) {
      out.push({ value: fromObj.cte, label: fromObj.cte });
    }
    if (Array.isArray(fromObj.join)) {
      for (const j of fromObj.join as Array<Record<string, unknown>>) {
        if (typeof j?.cte === 'string' && j.cte) {
          const jCte = j.cte;
          if (!out.some((c) => c.value === jCte)) {
            out.push({ value: jCte, label: jCte });
          }
        }
      }
    }
    const union = (fromObj.union as Record<string, unknown> | undefined) ?? {};
    if (Array.isArray(union.ctes)) {
      for (const c of union.ctes as unknown[]) {
        if (typeof c === 'string' && c) {
          if (!out.some((x) => x.value === c)) {
            out.push({ value: c, label: c });
          }
        }
      }
    }
    return out;
  }, [cte.from]);

  const isUnion = useMemo(() => {
    const fromObj = cte.from ?? {};
    return !!fromObj.union;
  }, [cte.from]);

  // Column-list search + dim/fct partitioning to match the canvas Select
  // node's UX. The split mirrors the upstream column-section component;
  // unknown roles (`type === undefined`) collapse into Dimensions so they
  // surface alongside dims rather than getting their own near-empty
  // section.
  const [columnSearch, setColumnSearch] = useState('');
  const filteredColumns = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return resolvedColumns;
    return resolvedColumns.filter((c) => c.name.toLowerCase().includes(q));
  }, [resolvedColumns, columnSearch]);
  const dimColumns = useMemo(
    () => filteredColumns.filter((c) => c.type !== 'fct'),
    [filteredColumns],
  );
  const fctColumns = useMemo(
    () => filteredColumns.filter((c) => c.type === 'fct'),
    [filteredColumns],
  );

  // Compute the per-section "included" lists in the shape ColumnSection
  // expects (`includedColumns: string[]`). Under an active bulk directive
  // the included set is "everything in this section that is NOT in
  // exclude[]"; without a bulk directive it's the columns that appear as
  // explicit passthrough rows.
  const includedDimNames = useMemo(() => {
    if (bulk) {
      return dimColumns
        .filter((c) => coverageForBulkAndColumn(bulk, c) === 'covered')
        .filter((c) => !bulk.exclude.includes(c.name))
        .map((c) => c.name);
    }
    return dimColumns
      .filter((c) =>
        items.some((it) => isPlainPassthroughForColumn(it, c.name)),
      )
      .map((c) => c.name);
  }, [bulk, dimColumns, items]);

  const includedFctNames = useMemo(() => {
    if (bulk) {
      return fctColumns
        .filter((c) => coverageForBulkAndColumn(bulk, c) === 'covered')
        .filter((c) => !bulk.exclude.includes(c.name))
        .map((c) => c.name);
    }
    return fctColumns
      .filter((c) =>
        items.some((it) => isPlainPassthroughForColumn(it, c.name)),
      )
      .map((c) => c.name);
  }, [bulk, fctColumns, items]);

  // Toggle handler shared by both sections. `ColumnSection` only emits
  // the column name; we look up the resolved column to recover its role
  // and coverage and then delegate to the existing handler.
  const handleColumnSectionToggle = useCallback(
    (columnName: string) => {
      const col = resolvedColumns.find((c) => c.name === columnName);
      if (!col) return;
      const coverage = coverageForBulkAndColumn(bulk, col);
      const isExcluded = bulk?.exclude.includes(columnName) ?? false;
      handleResolvedColumnToggle(
        columnName,
        coverage !== 'uncovered',
        isExcluded,
        col.type,
      );
    },
    [bulk, handleResolvedColumnToggle, resolvedColumns],
  );

  const resetColumnFilters = useCallback(() => {
    setColumnSearch('');
    if (bulk) handleBulkModeChange('none');
  }, [bulk, handleBulkModeChange]);

  // `ColumnSection` accepts a stricter `dataType: string`; resolved CTE
  // columns may omit it. Substitute an em-dash so the badge stays neutral
  // for unknown types rather than rendering as an error.
  const toSectionColumns = useCallback(
    (cols: typeof resolvedColumns): ColumnSectionColumn[] =>
      cols.map((c) => ({
        name: c.name,
        dataType: c.dataType ?? '\u2014',
      })),
    [],
  );

  return (
    <div className={`${TAB_BODY} flex flex-col ${SECTION_GAP}`}>
      {/* Header pill: live resolved-column count + manifest staleness hint.
          The pill shows what this CTE *emits* (cteAnalysis output for the
          current CTE), so it's a quick sanity check on the SELECT shape.
          Distinct from the upstream-picker list below, which shows what's
          *available* to select. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">
            {items.length} select item{items.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-surface text-foreground border border-neutral">
            {ownOutputCount} output column
            {ownOutputCount === 1 ? '' : 's'}
            {cteAnalysis.loading && (
              <span
                className="ml-1 italic"
                title="Re-analyzing CTE columns..."
                style={{ borderBottom: '1px dotted currentColor' }}
              >
                updating
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Bulk directive picker. Mirrors the SelectNode + ModelColumns
          radios; emits the `_from_cte` variants when the upstream is a CTE
          and `_from_model` otherwise. */}
      <section>
        <div className={SECTION_HEADER_ROW}>
          <h3 className={SECTION_HEADING}>Bulk directive</h3>
          <Tooltip content="Custom: pick columns one at a time below; no bulk row is emitted. All / Dims / Fcts include every column of that role from the upstream, with the column-list checkboxes maintaining an exclude[] list.">
            <span className="text-muted-foreground cursor-help">
              <InformationCircleIcon className="w-4 h-4" />
            </span>
          </Tooltip>
        </div>
        <div className="space-y-2">
          <RadioGroup
            name="cte-select-bulk-mode"
            options={[
              { label: 'Custom', value: 'none' },
              {
                label:
                  bulkUpstream === 'cte' ? 'All from CTE' : 'All from model',
                value: 'all',
              },
              { label: 'Dims', value: 'dims' },
              { label: 'Fcts', value: 'fcts' },
            ]}
            value={bulk?.mode ?? 'none'}
            onChange={(v) => handleBulkModeChange(v as BulkMode)}
            className="w-max gap-4"
          />
          {/* The directive's upstream tracks the CTE's `from` automatically
              (see effect above). Authoring a bulk row that targets a
              different model/CTE than the head was confusing in practice
              and produces SQL the sync layer can't resolve; users switch
              the upstream on the General tab now. */}
        </div>
      </section>

      {/* Resolved columns. Visual parity with the canvas Select node's
          column picker: section header + Reset, search input, and one
          ColumnSection each for Dimensions and Facts with their own
          counters. Empty state when the analysis pass hasn't produced a
          column list yet. */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className={SECTION_HEADER_ROW + ' mb-0'}>
            <h3 className={SECTION_HEADING}>Columns</h3>
            <Tooltip
              content={
                bulk
                  ? 'Uncheck to add to exclude[]; re-check to remove. Manual rows below override per-column.'
                  : 'Toggle to add a passthrough column. Use Add manual column for derived or aggregated columns.'
              }
            >
              <span className="text-muted-foreground cursor-help">
                <InformationCircleIcon className="w-4 h-4" />
              </span>
            </Tooltip>
          </div>
          {(columnSearch.length > 0 || bulk) && (
            <Button
              variant="link"
              label="Reset"
              onClick={resetColumnFilters}
              className="text-xs text-muted-foreground hover:text-foreground"
            />
          )}
        </div>
        {resolvedColumns.length === 0 ? (
          <div className={EMPTY_STATE}>
            No upstream columns to pick from. Set this CTE&apos;s source on the
            General tab (a model or earlier CTE) to populate the list.
            {cteAnalysis.error && (
              <div className="mt-2 text-error">{cteAnalysis.error}</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <InputText
              value={columnSearch}
              onChange={(e) => setColumnSearch(e.target.value)}
              placeholder="Search Columns"
            />
            {dimColumns.length === 0 && fctColumns.length === 0 ? (
              <div className={SECONDARY_HINT}>
                No columns match &quot;{columnSearch}&quot;.
              </div>
            ) : (
              <>
                {dimColumns.length > 0 && (
                  <ColumnSection
                    title="Dimensions"
                    tooltip="Dimension columns inferred from this CTE's upstream sources."
                    columns={toSectionColumns(dimColumns)}
                    includedColumns={includedDimNames}
                    onColumnToggle={handleColumnSectionToggle}
                  />
                )}
                {fctColumns.length > 0 && (
                  <ColumnSection
                    title="Facts"
                    tooltip="Fact columns inferred from this CTE's upstream sources."
                    columns={toSectionColumns(fctColumns)}
                    includedColumns={includedFctNames}
                    onColumnToggle={handleColumnSectionToggle}
                  />
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Manual rows. Drag-handled list with inline configure expansion. */}
      <section>
        {/* Custom flex container -- shares the mb-2 + items-center spacing
            with SECTION_HEADER_ROW but adds justify-between so the
            "Add Column Manually" affordance lines up to the right. */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <h3 className={SECTION_HEADING}>Manual rows</h3>
          {!showAddForm && (
            <Button
              variant="secondary"
              onClick={() => setShowAddForm(true)}
              label="Add Column Manually"
              icon={<PlusIcon className="w-4 h-4" />}
            />
          )}
        </div>

        {/* Inline AddColumnBasic in CTE mode. Visually matches the
            main-model authoring form; the `onAdd` callback appends the
            built schema row to `cte.select` (this tab's `writeItems`),
            and the `onConfigure` callback opens the CTE-specific
            Configure popover below -- the main-model
            ColumnConfiguration modal isn't used here because it doesn't
            know about CTE state and would route writes back to
            `modelingState.select`. */}
        {showAddForm && (
          <div className="mb-3">
            <AddColumnBasic
              mode="cte"
              availableCtes={cteUpstreamCtes}
              availableModels={cteUpstreamModels}
              intervalOptions={INTERVAL_OPTIONS}
              onAdd={handleInlineAdd}
              onCancel={resetAddForm}
              onConfirm={() => {}}
              onConfigure={() => setShowAddConfigure((v) => !v)}
            />
            {showAddConfigure && (
              <CteAddColumnConfigure
                value={pendingLightdash}
                onChange={setPendingLightdash}
              />
            )}
          </div>
        )}
        {manualItems.length === 0 ? (
          <div className={EMPTY_STATE}>
            No manual rows. Use Add manual column for expressions, aggregations,
            intervals, or upstream-qualified columns.
          </div>
        ) : (
          <DragDropContext onDragEnd={handleManualDragEnd}>
            <Droppable droppableId="cte-manual-rows">
              {(droppableProvided) => (
                <ul
                  ref={droppableProvided.innerRef}
                  {...droppableProvided.droppableProps}
                  className="flex flex-col gap-2"
                >
                  {manualItems.map(({ item, originalIndex }, manualIdx) => {
                    const kind = inferKind(item);
                    const draggableId = `manual-${originalIndex}-${kind}`;
                    return (
                      <Draggable
                        key={draggableId}
                        draggableId={draggableId}
                        index={manualIdx}
                      >
                        {(draggableProvided, snapshot) => {
                          // Portal the dragging clone to <body> so it
                          // escapes the CTE editor panel's positioned
                          // container (and any React Flow transform up the
                          // tree). Without this, `position: fixed` from
                          // @hello-pangea/dnd interacts with the parent
                          // transform and the row visually drifts.
                          const node = (
                            <li
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              style={draggableProvided.draggableProps.style}
                              className={`border border-neutral rounded-md p-2 bg-card ${
                                snapshot.isDragging
                                  ? 'shadow-lg bg-surface'
                                  : ''
                              }`}
                            >
                              <ManualRow
                                dragHandleProps={
                                  draggableProvided.dragHandleProps
                                }
                                item={item}
                                kind={kind}
                                cteOptions={earlierCteOptions}
                                onChange={(next) =>
                                  updateItemAt(originalIndex, next)
                                }
                                onRemove={() => removeItemAt(originalIndex)}
                              />
                            </li>
                          );
                          return snapshot.isDragging
                            ? createPortal(node, document.body)
                            : node;
                        }}
                      </Draggable>
                    );
                  })}
                  {droppableProvided.placeholder}
                </ul>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </section>

      {/* Lightdash metrics warning -- carries over from the original tab so
          users see "you authored metrics on a CTE; sync will drop them"
          inline rather than only at sync time. */}
      {items.some(hasInvalidLightdashMetrics) && (
        <div className="text-xs flex items-start gap-1 text-warning border border-warning/40 bg-warning/5 rounded px-2 py-1">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-mono">lightdash.metrics</span> /{' '}
            <span className="font-mono">lightdash.metrics_merge</span> on a CTE
            select are silently dropped at sync time
            (validateCteLightdashMetrics). Move metrics to the main-model select
            instead.
          </span>
        </div>
      )}

      {isUnion && (
        <div className={`${SECONDARY_HINT}`}>
          This CTE unions multiple sources. Bulk directives still emit;
          per-branch column selection happens upstream.
        </div>
      )}

      {/* Destructive bulk-change confirmation. Anchored at the panel root so
          the dialog overlay covers the whole editor. Cancelling clears the
          pending action; the radio group stays controlled off `bulk?.mode`
          so it visually snaps back without extra wiring. */}
      <DialogBox
        open={pendingConfirm !== null}
        variant="warning"
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description ?? ''}
        confirmCTALabel="Continue"
        discardCTALabel="Cancel"
        onConfirm={() => {
          const fn = pendingConfirm?.onConfirm;
          setPendingConfirm(null);
          fn?.();
        }}
        onDiscard={() => setPendingConfirm(null)}
      />
    </div>
  );
};

/**
 * Tri-valued coverage check: does the active bulk directive cover this
 * column (so it would be emitted by default), or does it fall outside the
 * directive's role?
 */
function coverageForBulkAndColumn(
  bulk: BulkItemView | null,
  col: { name: string; type?: string },
): 'covered' | 'uncovered' | 'no-bulk' {
  if (!bulk) return 'no-bulk';
  if (bulk.mode === 'all') return 'covered';
  if (bulk.mode === 'dims') return col.type === 'fct' ? 'uncovered' : 'covered';
  if (bulk.mode === 'fcts') return col.type === 'fct' ? 'covered' : 'uncovered';
  return 'no-bulk';
}

interface ManualRowProps {
  item: unknown;
  kind: SelectItemKind;
  cteOptions: { label: string; value: string }[];
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> | null;
  onChange: (next: unknown) => void;
  onRemove: () => void;
}

/**
 * One manual row. Renders a compact "header" (drag handle + name + kind
 * chip + remove + expand chevron) and an inline configure expansion below
 * with the schema fields relevant to this row's kind.
 */
const ManualRow: React.FC<ManualRowProps> = ({
  item,
  kind,
  cteOptions,
  dragHandleProps,
  onChange,
  onRemove,
}) => {
  const [expanded, setExpanded] = useState(false);

  const obj =
    item && typeof item === 'object' ? (item as Record<string, unknown>) : {};

  const displayName =
    kind === 'col_name'
      ? typeof item === 'string'
        ? item
        : ''
      : typeof obj.name === 'string'
        ? obj.name
        : '';

  const kindLabel =
    MANUAL_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div
          {...dragHandleProps}
          className="cursor-grab active:cursor-grabbing select-none"
          aria-label="Reorder row"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Bars3Icon className="w-4 h-4 text-muted-foreground hover:text-foreground pointer-events-none" />
        </div>
        <Button
          variant="iconButton"
          aria-label={expanded ? 'Collapse row' : 'Expand row'}
          className="p-0.5 text-muted-foreground hover:text-foreground"
          icon={
            expanded ? (
              <ChevronDownIcon className="w-4 h-4" />
            ) : (
              <ChevronRightIcon className="w-4 h-4" />
            )
          }
          onClick={() => setExpanded((v) => !v)}
        />
        <span className="font-mono text-sm text-foreground min-w-0 truncate flex-1">
          {displayName || <em className="text-muted-foreground">(unnamed)</em>}
        </span>
        <span className={`${SECONDARY_HINT} shrink-0`}>{kindLabel}</span>
        <Button
          variant="iconButton"
          aria-label="Remove row"
          className="p-1 text-muted-foreground hover:text-error"
          icon={<TrashIcon className="w-4 h-4" />}
          onClick={onRemove}
        />
      </div>

      {expanded && (
        <div className="mt-2 pl-6 border-l border-neutral">
          <ManualRowFields
            item={item}
            kind={kind}
            cteOptions={cteOptions}
            onChange={onChange}
          />
        </div>
      )}
    </div>
  );
};

interface ManualRowFieldsProps {
  item: unknown;
  kind: SelectItemKind;
  cteOptions: { label: string; value: string }[];
  onChange: (next: unknown) => void;
}

/**
 * Per-kind form fields. Extracted so the expand/collapse and drag-handle
 * chrome stays in `ManualRow` and only the schema-specific bits live here.
 * Trims empty-string fields on update so the JSON tab stays clean.
 */
const ManualRowFields: React.FC<ManualRowFieldsProps> = ({
  item,
  kind,
  cteOptions,
  onChange,
}) => {
  if (kind === 'col_name') {
    return (
      <InputText
        value={typeof item === 'string' ? item : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="column_name"
        className="font-mono w-full"
      />
    );
  }

  const obj =
    item && typeof item === 'object' ? (item as Record<string, unknown>) : {};

  const update = (patch: Record<string, unknown>) => {
    const next = { ...obj, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === '') delete next[k];
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD_LABEL_MONO}>name</label>
          <InputText
            value={(obj.name as string) || ''}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="column_name"
            className="font-mono"
          />
        </div>
        <div>
          <label className={FIELD_LABEL}>Type</label>
          <SelectSingle
            options={TYPE_OPTIONS}
            value={
              typeof obj.type === 'string'
                ? { label: obj.type, value: obj.type }
                : null
            }
            onChange={(opt) => update({ type: opt?.value })}
            onBlur={() => {}}
            placeholder="dim"
          />
        </div>
      </div>

      {(kind === 'expr' || kind === 'expr_with_agg') && (
        <div>
          <label className={FIELD_LABEL}>SQL expression</label>
          <textarea
            value={(obj.expr as string) || ''}
            onChange={(e) => update({ expr: e.target.value })}
            placeholder="cast(col as timestamp(6))"
            className="w-full font-mono text-sm px-2 py-1.5 border border-neutral rounded bg-background text-foreground placeholder-muted-foreground focus:outline-none"
            rows={2}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {(kind === 'from_model' || kind === 'from_model_with_agg') && (
        <div>
          <label className={FIELD_LABEL}>Upstream model</label>
          <InputText
            value={(obj.model as string) || ''}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="upstream_model_name"
          />
        </div>
      )}

      {kind === 'from_cte' && (
        <SelectSingle
          label="CTE"
          options={cteOptions}
          value={
            typeof obj.cte === 'string' && obj.cte
              ? { label: obj.cte, value: obj.cte }
              : null
          }
          onChange={(opt) => update({ cte: opt?.value || '' })}
          onBlur={() => {}}
          placeholder="Pick an earlier CTE"
        />
      )}

      {kind === 'interval' && (
        <SelectSingle
          label="Interval"
          options={INTERVAL_OPTIONS}
          value={
            typeof obj.interval === 'string'
              ? {
                  label: obj.interval,
                  value: obj.interval,
                }
              : null
          }
          onChange={(opt) => update({ interval: opt?.value })}
          onBlur={() => {}}
          placeholder="day"
        />
      )}

      {(kind === 'col_with_agg' ||
        kind === 'expr_with_agg' ||
        kind === 'from_model_with_agg') && (
        <div>
          <label className={FIELD_LABEL}>Aggregation</label>
          <SelectSingle
            options={AGG_OPTIONS}
            value={
              typeof obj.agg === 'string'
                ? { label: obj.agg, value: obj.agg }
                : null
            }
            onChange={(opt) => update({ agg: opt?.value })}
            onBlur={() => {}}
            placeholder="sum"
          />
        </div>
      )}

      <div>
        <label className={FIELD_LABEL}>Description (optional)</label>
        <InputText
          value={(obj.description as string) || ''}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Column description"
        />
      </div>

      {hasInvalidLightdashMetrics(item) && (
        <div className="mt-1 text-xs flex items-start gap-1 text-warning">
          <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-mono">lightdash.metrics</span> on a CTE select
            is dropped at sync time. Move to the main-model select.
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <PlusIcon className="w-3 h-3 text-muted-foreground" />
        <span className={SECONDARY_HINT}>
          Additional schema fields (e.g. `data_tests`, `meta`, `lightdash`) can
          be edited via the JSON tab; only common fields are surfaced here.
        </span>
      </div>
    </div>
  );
};

/**
 * Time-intervals enum values accepted by `lightdash.dimension.time_intervals`
 * when not set to the special `"OFF"` literal. Match the schema definition in
 * `schemas/lightdash.dimension.schema.json` -- keep in sync if that changes.
 */
const TIME_INTERVAL_VALUES = [
  'DAY',
  'DAY_OF_WEEK_INDEX',
  'DAY_OF_WEEK_NAME',
  'DAY_OF_MONTH_NUM',
  'DAY_OF_YEAR_NUM',
  'HOUR',
  'MONTH',
  'MONTH_NAME',
  'MONTH_NUM',
  'QUARTER',
  'QUARTER_NAME',
  'QUARTER_NUM',
  'RAW',
  'WEEK',
  'WEEK_NUM',
  'YEAR',
  'YEAR_NUM',
] as const;

const FORMAT_OPTIONS = [
  { label: 'eur', value: 'eur' },
  { label: 'gbp', value: 'gbp' },
  { label: 'id', value: 'id' },
  { label: 'km', value: 'km' },
  { label: 'mi', value: 'mi' },
  { label: 'percent', value: 'percent' },
  { label: 'usd', value: 'usd' },
];

interface CteAddColumnConfigureProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Inline Lightdash dimension configure mini-form for the CTE Add Column
 * flow. Exposes only the keys that `validateCteLightdashMetrics` lets
 * round-trip through CTE select items today:
 *
 *   - `label`, `hidden`, `format`, `round`
 *   - `time_intervals` -- with the special `"OFF"` literal exposed as a
 *     standalone toggle alongside the enum picker.
 *
 * `metrics` and `metrics_merge` are not rendered here at all -- they're
 * silently dropped at sync time on CTE selects, so rendering inputs that
 * users would expect to persist would be misleading. The framework calls
 * `lightdashBuildMetrics` only on the main-model select array (see
 * `services/framework/utils/column-utils.ts`), so Lightdash metrics
 * authored on a CTE never make it to the dbt YAML.
 *
 * Anchored inside the CTE side panel; the panel's outside-click handler
 * already ignores `[role="listbox"]` portals so SelectSingle pickers
 * inside this form don't close the parent popover.
 */
const CteAddColumnConfigure: React.FC<CteAddColumnConfigureProps> = ({
  value,
  onChange,
}) => {
  const set = (patch: Record<string, unknown>) => {
    const next = { ...value, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === '' || next[k] === undefined) delete next[k];
    }
    onChange(next);
  };

  const timeIntervalsValue = value.time_intervals;
  const isTimeIntervalsOff = timeIntervalsValue === 'OFF';
  const timeIntervalsArray = Array.isArray(timeIntervalsValue)
    ? (timeIntervalsValue as string[])
    : [];

  return (
    <div className="mt-2 p-3 border border-neutral rounded bg-surface space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          Configure (Lightdash dimension)
        </h4>
        <span className={`${SECONDARY_HINT}`}>CTE-compatible keys only</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD_LABEL}>Label</label>
          <InputText
            value={(value.label as string) || ''}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="Display label"
          />
        </div>
        <div className="flex items-center gap-2 mt-5">
          <Checkbox
            id="cte-cfg-hidden"
            checked={!!value.hidden}
            onChange={(c) =>
              set({ hidden: typeof c === 'boolean' ? c : c.target.checked })
            }
            label="Hidden"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={FIELD_LABEL}>Format</label>
          <SelectSingle
            options={FORMAT_OPTIONS}
            value={
              typeof value.format === 'string'
                ? { label: value.format, value: value.format }
                : null
            }
            onChange={(opt) => set({ format: opt?.value || '' })}
            onBlur={() => {}}
            placeholder="Pick a format"
          />
        </div>
        <div>
          <label className={FIELD_LABEL}>Round</label>
          <InputText
            value={typeof value.round === 'number' ? String(value.round) : ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v === '') set({ round: undefined });
              else if (/^\d+$/.test(v)) set({ round: Number(v) });
            }}
            placeholder="e.g. 2"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={FIELD_LABEL + ' mb-0'}>Time intervals</label>
          <Tooltip content='Use "OFF" to opt this column out of Lightdash auto time intervals, or pick a specific subset.'>
            <span className="text-muted-foreground cursor-help">
              <InformationCircleIcon className="w-4 h-4" />
            </span>
          </Tooltip>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Checkbox
            id="cte-cfg-ti-off"
            checked={isTimeIntervalsOff}
            onChange={(c) => {
              const checked = typeof c === 'boolean' ? c : c.target.checked;
              set({ time_intervals: checked ? 'OFF' : undefined });
            }}
            label='Set "OFF"'
          />
          {!isTimeIntervalsOff && (
            <div className="flex-1 min-w-[200px]">
              <SelectSingle
                options={TIME_INTERVAL_VALUES.map((v) => ({
                  label: v,
                  value: v,
                }))}
                value={
                  timeIntervalsArray.length > 0
                    ? {
                        label: timeIntervalsArray[0],
                        value: timeIntervalsArray[0],
                      }
                    : null
                }
                onChange={(opt) =>
                  set({
                    time_intervals: opt?.value ? [opt.value] : undefined,
                  })
                }
                onBlur={() => {}}
                placeholder="Pick an interval"
              />
            </div>
          )}
        </div>
        {timeIntervalsArray.length > 1 && (
          <p className={`${SECONDARY_HINT} mt-1`}>
            Editing multi-interval lists inline is not yet supported. Pick a
            single interval here or edit the array via the JSON tab.
          </p>
        )}
      </div>

      <div className={`${SECONDARY_HINT} pt-1 border-t border-neutral`}>
        <span className="font-mono">lightdash.metrics</span> and{' '}
        <span className="font-mono">lightdash.metrics_merge</span> are
        intentionally hidden: the framework only emits Lightdash metrics from
        the main-model select array (see{' '}
        <span className="font-mono">lightdashBuildMetrics</span>), so authoring
        them on a CTE select has no effect at sync time.
      </div>
    </div>
  );
};
