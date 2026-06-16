import type { DjModelMatch, TrinoQuerySummary } from '@shared/trino/types';
import { makeClassName } from '@web';
import { Text } from '@web/elements';

import { formatDateTime } from '../format';
import { LabeledValue } from './LabeledValue';
import { ModelLabel } from './ModelLabel';
import { Section } from './Section';

export type MetadataCardProps = {
  summary: TrinoQuerySummary;
  /**
   * DJ model match resolved server-side. `undefined` while the full
   * snapshot hasn't been fetched yet (summary mode), `null` once the
   * matcher has run and produced no link. See `ModelLabel` for the
   * three render states.
   */
  modelMatch?: DjModelMatch | null;
  className?: string;
};

/**
 * Left-hand card on the Overview tab. Groups the query's identifying
 * fields (DJ Model / User / Source / Catalog / Schema) and lifecycle
 * timestamps (Created / Started / Ended) into two `Section`s.
 *
 * The card border uses the single-thickness `border-neutral` token to
 * match `QueryInfoCard` (matters for dark mode — the default
 * un-themed `border-2` reads too bright). The "Metadata" heading is
 * sticky at the top of the card so only the inner field rows scroll
 * when the content is taller than the available height.
 */
export function MetadataCard({
  summary,
  modelMatch,
  className,
}: MetadataCardProps) {
  return (
    <div
      className={makeClassName(
        'rounded border border-neutral flex flex-col h-full min-h-0 overflow-hidden',
        className,
      )}
    >
      <div className="sticky top-0 z-10 bg-background px-3 pt-2 pb-2 border-b border-neutral">
        <Text variant="label">Metadata</Text>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 py-3 flex flex-col gap-3">
        <Section title="Identification">
          <ModelLabel modelMatch={modelMatch} />
          <LabeledValue label="User" value={summary.user} />
          <LabeledValue label="Source" value={summary.source} />
          <LabeledValue label="Catalog" value={summary.catalog} />
          <LabeledValue label="Schema" value={summary.schema} />
        </Section>
        <Section title="Timing">
          <LabeledValue
            label="Created"
            value={formatDateTime(summary.created)}
          />
          <LabeledValue
            label="Started"
            value={formatDateTime(summary.started)}
          />
          <LabeledValue label="Ended" value={formatDateTime(summary.ended)} />
        </Section>
      </div>
    </div>
  );
}
