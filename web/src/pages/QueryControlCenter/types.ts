import type { TrinoQuerySummary } from '@shared/trino/types';

/**
 * Where the current selection came from. This drives whether the
 * detail pane auto-fetches:
 * - `live` — user clicked a row in the Live tab. Detail pane shows
 *   the headline from the row data and waits for an explicit
 *   "Load full details" click. Zero REST cost for browsing.
 * - `history` — user clicked a row in the History tab. Detail pane
 *   auto-loads from `.dj/diagnostics/<id>.json` (no REST).
 * - `preselect` — the panel was opened with `?queryId=<id>` or via a
 *   `query-control-center-select` message (e.g. an external command).
 *   We don't have a row summary, so the pane auto-loads
 *   (persisted-first, REST only as fallback).
 */
export type SelectionSource = 'live' | 'history' | 'preselect';

export type SelectedQuery = {
  queryId: string;
  /** Row data for the queryId, when available. */
  summary: TrinoQuerySummary | null;
  source: SelectionSource;
};

export type QueryListProps = {
  selectedQueryId: string | null;
  /**
   * Called when the user clicks a row. The parent uses the `source` tag
   * to decide whether the detail pane should auto-fetch (history /
   * preselect) or wait for an explicit "Load full details" click (live).
   */
  onSelectQuery: (selection: SelectedQuery) => void;
};
