import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import type { TrinoQuerySummary } from '@shared/trino/types';
import { Button } from '@web/elements';

import { StatsGrid } from './StatsGrid';

export type QueryInfoCardProps = {
  summary: TrinoQuerySummary;
  /** Profile this snapshot was captured against. Renders the chip
   *  inline with the Query ID when set. */
  profileName?: string;
  /**
   * Live progress percent (0-100). Threaded into the State card on
   * the stats grid so the standalone progress bar can be retired.
   * `null` while in summary mode or for terminal queries.
   */
  progressPercent?: number | null;
  bannerSlot?: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Top "Query Info" card. Identical between summary-only and full-info
 * modes; only the `bannerSlot` and `actions` differ. The header
 * carries the identifying facts (Query ID + profile chip) so they
 * stay visible regardless of which tab is active below. The DJ model
 * match and the snapshot source (coordinator / .dj/diagnostics) live
 * elsewhere — model match inside the Overview tab's Metadata card,
 * snapshot source in the banner row directly under the header.
 */
export function QueryInfoCard({
  summary,
  profileName,
  progressPercent,
  bannerSlot,
  actions,
}: QueryInfoCardProps) {
  return (
    <div className="rounded border border-neutral p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-lg font-semibold m-0">Query Info</h2>
          <div className="flex items-center text-xs opacity-70 min-w-0 flex-wrap">
            <span>ID: {summary.queryId}</span>
            <Button
              variant="iconButton"
              className="!p-1"
              title="Copy Query ID"
              icon={
                <ClipboardDocumentIcon
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              }
              onClick={() =>
                void navigator.clipboard.writeText(summary.queryId)
              }
            />
            {profileName && (
              // Inlined chip — the previous standalone `ProfileChip`
              // component had a single use site once the optional
              // coordinator URL was dropped, so the markup lives here.
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded border border-neutral text-xs font-semibold"
                title={`Captured from profile "${profileName}"`}
              >
                {profileName}
              </span>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex gap-2 flex-wrap ml-auto shrink-0">{actions}</div>
        )}
      </div>
      {bannerSlot}
      <StatsGrid summary={summary} progressPercent={progressPercent} />
    </div>
  );
}
