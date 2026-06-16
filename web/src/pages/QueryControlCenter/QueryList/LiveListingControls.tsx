import { Button, Checkbox } from '@web/elements';

export type LiveListingControlsProps = {
  autoRefresh: boolean;
  onAutoRefreshChange: (next: boolean) => void;
  refreshing: boolean;
  onRefresh: () => void;
  pollIntervalMs: number;
};

/**
 * Compact control strip above the Live query list — auto-refresh
 * toggle (interval inlined into its label) and a manual Refresh
 * button. The active profile and REST/CLI source live in the sidebar
 * ConnectionPanel, so this row stays controls-only.
 */
export function LiveListingControls({
  autoRefresh,
  onAutoRefreshChange,
  refreshing,
  onRefresh,
  pollIntervalMs,
}: LiveListingControlsProps) {
  const pollSeconds = Math.round(pollIntervalMs / 1000);
  return (
    <div className="px-3 py-1 text-xs opacity-80 border-b border-neutral flex items-center justify-end gap-3 whitespace-nowrap">
      <Checkbox
        // Inline the cadence into the checkbox label so it stays on one
        // line at sidebar widths and we don't need a separate redundant
        // hint span next to the Refresh button. Tooltip carries the long
        // explanation.
        label={autoRefresh ? `Auto-refresh (${pollSeconds}s)` : 'Auto-refresh'}
        title={
          autoRefresh
            ? `Polling every ${pollSeconds}s.`
            : 'Polling paused. Click Refresh to reload.'
        }
        checked={autoRefresh}
        onChange={(checked) =>
          onAutoRefreshChange(
            typeof checked === 'boolean' ? checked : checked.target.checked,
          )
        }
      />
      <Button
        variant="iconButton"
        icon={
          <span
            aria-hidden
            className={`inline-block ${refreshing ? 'animate-spin' : ''}`}
          >
            ↻
          </span>
        }
        label="Refresh"
        disabled={refreshing}
        title={refreshing ? 'Refreshing…' : 'Refresh now'}
        onClick={onRefresh}
      />
    </div>
  );
}
