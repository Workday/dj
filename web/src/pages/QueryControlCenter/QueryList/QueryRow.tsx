import { TrashIcon } from '@heroicons/react/20/solid';
import type { TrinoQuerySummary } from '@shared/trino/types';
import { Button } from '@web/elements';

import { formatBytes, formatMs, relativeAge, stateColor } from '../format';

export type QueryRowProps = {
  query: TrinoQuerySummary;
  selected: boolean;
  onSelect: (id: string) => void;
  /** When set, a trash affordance is rendered (history rows only). */
  onDelete?: (id: string) => void;
  /**
   * History-only pill showing which profile wrote the diagnostic JSON.
   * `null` for live rows and for diagnostics whose JSON does not
   * record a profile.
   */
  profileBadge?: { profileName: string; coordinatorUrl?: string } | null;
};

/**
 * Single row in the Live / History list. Renders the queryId, state,
 * relative age, source, wall-time, peak memory, and (for live rows
 * mid-flight) a progress percentage.
 *
 * Layout note: two sibling buttons inside a wrapper instead of a
 * nested `<button>` inside a `<button>`. HTML5 forbids nested
 * interactive content and browsers silently drop the inner click when
 * it happens, so the trash needs its own real `<button>` next to the
 * row body.
 *
 * The row body itself is kept as a native `<button>`. The
 * design-system `<Button>` variants (primary / secondary /
 * iconButton / link / …) all bake in centred text, padding, rounded
 * corners and a specific colour scheme that don't fit a list row
 * with custom internal layout — the same reason `FileTree.tsx` in
 * `web/src/elements/` uses a native `<button>` for its clickable row.
 * The trash sibling goes through the design-system
 * `<Button variant="iconButton">`.
 */
export function QueryRow({
  query,
  selected,
  onSelect,
  onDelete,
  profileBadge,
}: QueryRowProps) {
  const progress =
    query.totalSplits && query.completedSplits !== undefined
      ? Math.round(
          (100 * query.completedSplits) / Math.max(query.totalSplits, 1),
        )
      : null;
  return (
    <div
      className={`flex items-stretch border-b border-neutral hover:bg-list-item-hover ${
        selected ? 'bg-message-info border-l-4 border-l-message-info' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(query.queryId)}
        className="text-left flex-1 min-w-0 px-3 py-2"
      >
        <div className="flex justify-between items-baseline gap-2">
          <span className="font-mono text-xs truncate" title={query.queryId}>
            {query.queryId}
          </span>
          <div className="flex items-baseline gap-1.5 flex-shrink-0">
            {profileBadge && (
              <span
                className="text-xs px-1.5 py-0.5 rounded border border-neutral opacity-80"
                title={
                  profileBadge.coordinatorUrl
                    ? `Diagnostic captured from profile "${profileBadge.profileName}" (${profileBadge.coordinatorUrl})`
                    : `Diagnostic captured from profile "${profileBadge.profileName}"`
                }
              >
                {profileBadge.profileName}
              </span>
            )}
            <span
              className={`text-xs font-semibold ${stateColor(query.state)}`}
            >
              {query.state}
            </span>
          </div>
        </div>
        <div className="text-xs opacity-70 flex gap-3 mt-1">
          <span>{relativeAge(query.created ?? query.started)}</span>
          {query.source ? (
            <span className="truncate" title={query.source}>
              {query.source}
            </span>
          ) : null}
          {query.wallTimeMs !== undefined ? (
            <span>{formatMs(query.wallTimeMs)}</span>
          ) : null}
          {query.peakUserMemoryBytes !== undefined ? (
            <span>{formatBytes(query.peakUserMemoryBytes)}</span>
          ) : null}
          {progress !== null ? <span>{progress}%</span> : null}
        </div>
      </button>
      {onDelete && (
        <Button
          variant="iconButton"
          icon={<TrashIcon className="w-4 h-4" />}
          aria-label="Delete from history"
          title="Delete from history"
          onClick={() => onDelete(query.queryId)}
          className="flex-shrink-0 hover:text-error"
        />
      )}
    </div>
  );
}
