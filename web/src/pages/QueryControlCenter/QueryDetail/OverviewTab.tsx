import type { DjModelMatch, TrinoQuerySummary } from '@shared/trino/types';

import { MetadataCard } from './MetadataCard';
import { QuerySqlCard } from './QuerySqlCard';

export type OverviewTabProps = {
  summary: TrinoQuerySummary;
  sql?: string;
  modelMatch?: DjModelMatch | null;
};

/**
 * Overview tab content: a two-column layout pairing the `MetadataCard`
 * (left) with the `QuerySqlCard` (right). On narrow widths the columns
 * stack vertically so the Metadata sidebar doesn't crowd the SQL.
 */
export function OverviewTab({ summary, sql, modelMatch }: OverviewTabProps) {
  return (
    <div className="flex flex-col md:flex-row gap-3 h-full min-h-0">
      <MetadataCard
        summary={summary}
        modelMatch={modelMatch}
        className="md:w-72 shrink-0"
      />
      <QuerySqlCard sql={sql} className="flex-1 min-h-0" />
    </div>
  );
}
