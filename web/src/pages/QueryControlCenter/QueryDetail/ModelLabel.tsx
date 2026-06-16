import type { DjModelMatch } from '@shared/trino/types';
import { Tooltip } from '@web/elements';

export type ModelLabelProps = { modelMatch?: DjModelMatch | null };

/**
 * Metadata row for the DJ model that maps to the current query.
 * Renders three states keyed by `modelMatch`:
 *
 * - `undefined` — the full snapshot hasn't been fetched yet (the
 *   detail pane is in summary mode), so the matcher hasn't been
 *   consulted. Renders a muted placeholder with a tooltip explaining
 *   that "Load full details" is needed to resolve the match.
 * - `null` — the snapshot has been loaded but the matcher couldn't
 *   link this query to a DJ model (ad-hoc query, or dbt's
 *   `query-comment` is disabled in dbt_project.yml).
 * - populated — `project:modelName` plus a `[matchedBy]` caption.
 *   Match origin: `comment` (from dbt's `query_comment` `node_id`,
 *   highest confidence), `fqn` (from the materialization target
 *   FQN), or `cte` (from the trailing CTE pattern in compiled SQL).
 *
 * The long explanations live inside the design-system `Tooltip`
 * (~150 ms open) rather than a native `title=` attribute (~1-2 s)
 * so the information surfaces without a perceptible delay.
 */
export function ModelLabel({ modelMatch }: ModelLabelProps) {
  if (modelMatch === undefined) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs uppercase opacity-70">Model</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono opacity-70">
            — (load details to resolve)
          </span>
          <Tooltip content="Load full details to resolve the DJ model match. The matcher reads the SQL text and consults the dbt manifest server-side." />
        </div>
      </div>
    );
  }
  if (!modelMatch) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs uppercase opacity-70">Model</span>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono opacity-70">— (unmatched)</span>
          <Tooltip content="This Trino query couldn't be linked to a DJ model. The query may be ad-hoc, or dbt's `query-comment` has been disabled in dbt_project.yml. The matcher tries dbt's `node_id` comment, the materialization FQN, and the trailing CTE pattern." />
        </div>
      </div>
    );
  }
  const reason =
    modelMatch.matchedBy === 'comment'
      ? 'Matched via dbt query_comment node_id (highest confidence).'
      : modelMatch.matchedBy === 'fqn'
        ? 'Matched via the materialization target (CREATE TABLE / INSERT INTO).'
        : 'Matched via the trailing CTE pattern in compiled SQL.';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase opacity-70">Model</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-mono break-all">
          {modelMatch.project}:{modelMatch.modelName}
        </span>
        <span className="text-xs opacity-70">[{modelMatch.matchedBy}]</span>
        <Tooltip content={reason} />
      </div>
    </div>
  );
}
