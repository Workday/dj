import type { TrinoOperatorSummaryEntry } from '@shared/trino/types';
import { Table, Text } from '@web/elements';
import { useMemo } from 'react';

import { formatBytes, formatMs, formatNumber } from '../format';

export type OperatorTableProps = {
  operators: TrinoOperatorSummaryEntry[];
};

/**
 * Compute the simple heuristic warning chips referenced by the
 * `dj-trino-analyzer` skill so the UI surfaces the same diagnoses
 * the LLM will reach for. Returned as an array of compact labels per
 * operator, e.g. `['broadcast-join-blowup']`.
 */
function operatorHeuristics(
  op: TrinoOperatorSummaryEntry,
  totalCpuNanos: number,
  maxMemoryReservation: number,
): string[] {
  const chips: string[] = [];
  const peakMem =
    typeof op.peakMemoryReservation === 'number'
      ? op.peakMemoryReservation
      : Number(op.peakMemoryReservation ?? 0);

  if (
    (op.operatorType ?? '').match(/LookupJoin|HashJoin/) &&
    peakMem > 0 &&
    maxMemoryReservation > 0 &&
    peakMem / maxMemoryReservation > 0.5
  ) {
    chips.push('broadcast-join-blowup');
  }
  if (
    (op.operatorType ?? '').includes('Json') &&
    op.cpuNanos !== undefined &&
    totalCpuNanos > 0 &&
    op.cpuNanos / totalCpuNanos > 0.3
  ) {
    chips.push('json-parser-cpu');
  }
  if (
    op.blockedWallNanos !== undefined &&
    op.cpuNanos !== undefined &&
    op.cpuNanos > 0 &&
    op.blockedWallNanos / op.cpuNanos > 1
  ) {
    chips.push('blocked-time-high');
  }
  return chips;
}

export function OperatorTable({ operators }: OperatorTableProps) {
  const { rows, total } = useMemo(() => {
    const sorted = [...operators].sort((a, b) => {
      const am =
        typeof a.peakMemoryReservation === 'number'
          ? a.peakMemoryReservation
          : Number(a.peakMemoryReservation ?? 0);
      const bm =
        typeof b.peakMemoryReservation === 'number'
          ? b.peakMemoryReservation
          : Number(b.peakMemoryReservation ?? 0);
      return bm - am;
    });
    const totalCpuNanos = sorted.reduce(
      (acc, op) => acc + (op.cpuNanos ?? 0),
      0,
    );
    const maxMem = sorted.reduce((acc, op) => {
      const m =
        typeof op.peakMemoryReservation === 'number'
          ? op.peakMemoryReservation
          : Number(op.peakMemoryReservation ?? 0);
      return Math.max(acc, m);
    }, 0);
    return { rows: sorted, total: { totalCpuNanos, maxMem } };
  }, [operators]);

  if (!rows.length) {
    return <Text>No operator data available for this query.</Text>;
  }

  return (
    // Outer wrapper bounds the table to the Tab panel's height. The
    // panel itself has `flex-1 min-h-0` but no overflow, so without
    // this the table flows past the panel boundary on long queries.
    // Horizontal scroll handles the wide Heuristics column on narrow
    // pane widths.
    <div className="h-full min-h-0 overflow-auto">
      <Table
        columns={[
          { id: 'op', label: 'Operator' },
          { id: 'in', label: 'Rows in' },
          { id: 'out', label: 'Rows out' },
          { id: 'cpu', label: 'CPU' },
          { id: 'mem', label: 'Peak memory' },
          { id: 'flags', label: 'Heuristics' },
        ]}
        rows={rows.map((op, idx) => {
          const flags = operatorHeuristics(
            op,
            total.totalCpuNanos,
            total.maxMem,
          );
          const cpuMs =
            op.cpuNanos !== undefined ? op.cpuNanos / 1_000_000 : undefined;
          return {
            items: [
              {
                id: `op-${idx}`,
                element: (
                  <span className="font-mono text-xs">
                    {op.operatorType ?? '—'}
                    {op.planNodeId ? (
                      <span className="opacity-70"> [{op.planNodeId}]</span>
                    ) : null}
                  </span>
                ),
              },
              { id: `in-${idx}`, element: formatNumber(op.inputPositions) },
              { id: `out-${idx}`, element: formatNumber(op.outputPositions) },
              { id: `cpu-${idx}`, element: formatMs(cpuMs) },
              {
                id: `mem-${idx}`,
                element: formatBytes(op.peakMemoryReservation),
              },
              {
                id: `flags-${idx}`,
                element: flags.length ? (
                  <span className="flex gap-1 flex-wrap">
                    {flags.map((f) => (
                      <span
                        key={f}
                        className="inline-block bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded"
                      >
                        {f}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="opacity-50 text-xs">—</span>
                ),
              },
            ],
          };
        })}
      />
    </div>
  );
}
