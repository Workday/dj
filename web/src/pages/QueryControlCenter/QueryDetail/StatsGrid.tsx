import type { TrinoQuerySummary } from '@shared/trino/types';

import { formatBytes, formatMs, formatNumber, stateColor } from '../format';
import { StatCard } from './StatCard';

/**
 * Coordinator states that are reached after the query has stopped
 * executing. The inline progress percent on the State card is hidden
 * for these so the cell shows just the final state label.
 */
const TERMINAL_STATES = new Set(['FINISHED', 'FAILED', 'CANCELED']);

export type StatsGridProps = {
  summary: TrinoQuerySummary;
  /**
   * 0-100 progress percent threaded down from `QueryDetail`. Rendered
   * inline on the State card to the right of the state label so the
   * card stays a single row and we can drop the standalone progress
   * bar. `null` (or any value while the state is terminal) hides the
   * percent.
   */
  progressPercent?: number | null;
};

/**
 * 4x2 metric tile grid for the Query Info card. The State card
 * doubles as the live progress indicator: state label on the left,
 * percent right-aligned, no separate bar. `largestOperator` renders
 * "—" until `trino-fetch-query-info` populates it, so the grid
 * doesn't reflow between summary and full modes.
 */
export function StatsGrid({ summary, progressPercent }: StatsGridProps) {
  const showPercent =
    typeof progressPercent === 'number' && !TERMINAL_STATES.has(summary.state);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="State">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-semibold ${stateColor(summary.state)}`}>
            {summary.state}
          </span>
          {showPercent && (
            <span className="text-xs opacity-70 tabular-nums">
              {progressPercent}%
            </span>
          )}
        </div>
      </StatCard>
      <StatCard label="Wall time">{formatMs(summary.wallTimeMs)}</StatCard>
      <StatCard label="CPU time">{formatMs(summary.cpuTimeMs)}</StatCard>
      <StatCard label="Peak memory">
        {formatBytes(summary.peakUserMemoryBytes)}
      </StatCard>
      <StatCard label="Total splits">
        {formatNumber(summary.totalSplits)}
      </StatCard>
      <StatCard label="Blocked time">
        {formatMs(summary.blockedTimeMs)}
      </StatCard>
      <StatCard label="Processed rows">
        {formatNumber(summary.processedRows)}
      </StatCard>
      <StatCard label="Largest operator">
        <span className="font-mono text-xs">
          {summary.largestOperator ?? '—'}
        </span>
      </StatCard>
    </div>
  );
}
