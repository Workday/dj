import type { TrinoQueryInfo, TrinoQuerySummary } from '@shared/trino/types';
import DataSearchIcon from '@web/assets/icons/data-search.svg?react';
import { useApp } from '@web/context';
import { Alert, Button, SlimBanner, Spinner, Tab } from '@web/elements';
import { useError } from '@web/hooks';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { SelectedQuery } from '../types';
import { useTrinoLive } from '../useTrinoLive';
import { ErrorTab } from './ErrorTab';
import { OperatorTable } from './OperatorTable';
import { OverviewTab } from './OverviewTab';
import { QueryInfoCard } from './QueryInfoCard';
import { StageTree } from './StageTree';

export type QueryDetailProps = {
  selected: SelectedQuery | null;
};

/**
 * Terminal coordinator states. Once a query lands here, refetching
 * from the coordinator returns identical bytes (or HTTP 410 if it has
 * aged out of memory), so the UI hides "Refresh from coordinator" and
 * the live progress bar.
 */
const TERMINAL_STATES = new Set(['FINISHED', 'FAILED', 'CANCELED']);

/**
 * Detail pane. Selection sources drive the auto-fetch policy:
 * - `live` — show summary from the row data; wait for an explicit
 *   "Load full details" click before fetching. Zero REST cost for
 *   browsing the Live tab.
 * - `history` — auto-load with `prefer: 'persisted'`. Always reads
 *   from `.dj/diagnostics/<id>.json` (no network).
 * - `preselect` — opened via URL / external command. Auto-load with
 *   `prefer: 'persisted'`; falls through to REST if no local copy.
 *
 * Render shape is unified: a `QueryInfoCard` carries the headline +
 * stats + mutually-exclusive banner slot, followed by a `Tab` with
 * Overview only in summary mode and Stages / Operators / Errors
 * added once a full snapshot is in hand.
 */
export function QueryDetail({ selected }: QueryDetailProps) {
  const { api } = useApp();
  const { error, handleError, clearError } = useError();
  // `refreshHistory` is invoked after any action that writes to
  // .dj/diagnostics/ (REST fetches, Analyze with AI, Refresh from
  // coordinator) so the History tab picks up new diagnostics inline.
  const { refreshHistory } = useTrinoLive();
  const [info, setInfo] = useState<TrinoQueryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<{
    jsonPath: string;
    prompt: string;
  } | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const queryId = selected?.queryId ?? null;

  // Computed before any early-return so the progress hook below runs
  // on every render (rules-of-hooks).
  const effectiveSummary: TrinoQuerySummary | null = info
    ? info.summary
    : selected?.summary ??
      (selected ? { queryId: selected.queryId, state: 'UNKNOWN' } : null);
  const effectiveSql = info?.query ?? selected?.summary?.query;

  const progressPercent = useMemo<number | null>(() => {
    if (!effectiveSummary) {
      return null;
    }
    if (TERMINAL_STATES.has(effectiveSummary.state)) {
      return null;
    }
    // Summary mode reads from `system.runtime.queries`, which doesn't
    // expose split / driver counters. Anything we'd show before
    // `Load full details` would be a placeholder that contradicts
    // the real value once the REST snapshot lands, so hide it
    // entirely until `info` is in hand.
    if (!info) {
      return null;
    }
    if (!effectiveSummary.totalSplits) {
      return null;
    }
    const done = effectiveSummary.completedSplits ?? 0;
    return Math.min(
      100,
      Math.round((100 * done) / effectiveSummary.totalSplits),
    );
  }, [effectiveSummary, info]);

  const load = useCallback(
    async (id: string, prefer: 'persisted' | 'rest' = 'persisted') => {
      try {
        setLoading(true);
        clearError();
        const res = await api.post({
          type: 'trino-fetch-query-info',
          request: { queryId: id, prefer },
        });
        setInfo(res);
        // Only refresh the History list when the backend actually
        // wrote a new (or refreshed) sanitized JSON — i.e. on a REST
        // fetch, whether explicit (Refresh from coordinator, Load
        // full details) or implicit (persisted-first fell through to
        // REST because no local copy existed yet). Straight persisted
        // hits skip the refresh: the file isn't touched, so a
        // re-listing would be a wasted round-trip.
        if (res.loadedFrom === 'rest') {
          void refreshHistory();
        }
      } catch (err) {
        handleError(err);
      } finally {
        setLoading(false);
      }
    },
    [api, handleError, clearError, refreshHistory],
  );

  // Reset cached info whenever the selection changes. Then auto-load
  // only for `history` / `preselect` — `live` waits for the user.
  useEffect(() => {
    setInfo(null);
    clearError();
    setLastAnalysis(null);
    setPromptOpen(false);
    if (!selected) {
      return;
    }
    if (selected.source === 'history' || selected.source === 'preselect') {
      void load(selected.queryId, 'persisted');
    }
  }, [selected, load, clearError]);

  async function handleAnalyze() {
    if (!queryId) {
      return;
    }
    try {
      setAnalyzing(true);
      const res = await api.post({
        type: 'trino-analyze-query',
        request: { queryId },
      });
      try {
        await navigator.clipboard.writeText(res.promptSnippet);
      } catch {
        // Clipboard write can fail when the webview is not focused —
        // the View prompt toggle still surfaces the text so the user
        // can copy it manually.
      }
      setLastAnalysis({ jsonPath: res.jsonPath, prompt: res.promptSnippet });
      // Reload the persisted-first path so the panel reflects the
      // freshly sanitized snapshot inline. `load(prefer: 'persisted')`
      // can serve from disk without re-persisting, so it won't
      // trigger `refreshHistory` itself — call it directly because
      // `trino-analyze-query` does write a fresh diagnostic when none
      // existed yet.
      void load(queryId, 'persisted');
      void refreshHistory();
    } catch (err) {
      handleError(err);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleJumpToModel() {
    if (!queryId) {
      return;
    }
    try {
      await api.post({
        type: 'trino-jump-to-model-from-query',
        request: { queryId },
      });
    } catch (err) {
      handleError(err);
    }
  }

  if (!selected || !effectiveSummary) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="flex items-center gap-8 max-w-2xl">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold m-0">
              Select a query to view details
            </h2>
            <p className="text-sm opacity-70 m-0">
              Pick a query from Live or History to view its plan, stats, and SQL
              &mdash; or run an AI analysis on it.
            </p>
          </div>
          <DataSearchIcon
            className="w-24 h-24 opacity-30 shrink-0"
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }

  // Mode is derived purely from whether a full snapshot is in hand.
  const isSummaryMode = !info;

  // "Refresh" makes sense whenever the snapshot in hand is still
  // non-terminal — the coordinator may have newer data for the same
  // queryId, regardless of whether the user reached this view via
  // Live or History. Terminal queries are skipped because re-fetching
  // returns identical bytes (or 410 if it has aged out).
  const showRefresh = !!info && !TERMINAL_STATES.has(effectiveSummary.state);

  // Single right-anchored row with a fixed slot order so the primary
  // CTA (rightmost) never shifts position as conditional buttons come
  // and go. From left to right:
  //   Jump to Model · Refresh · Copy AI Prompt · Load full details
  // Buttons that don't apply to the current snapshot are simply not
  // rendered; rightmost neighbours fill the space without re-ordering.
  const actionParts: ReactNode[] = [];
  if (!isSummaryMode) {
    actionParts.push(
      <span
        key="jump"
        title={
          info?.modelMatch
            ? `Open ${info.modelMatch.project}:${info.modelMatch.modelName}`
            : "No DJ model linked. The matcher couldn't resolve this query via dbt's query_comment, materialization FQN, or trailing CTE pattern."
        }
      >
        <Button
          variant="outlineIconButton"
          className="text-sm"
          label="Jump to Model"
          disabled={!info?.modelMatch}
          onClick={() => void handleJumpToModel()}
        />
      </span>,
    );
  }
  if (showRefresh) {
    actionParts.push(
      <span
        key="refresh"
        title="Refresh from coordinator — fetches the latest /v1/query/{id} snapshot and rewrites the sanitized JSON."
      >
        <Button
          variant="outlineIconButton"
          className="text-sm"
          label="Refresh"
          onClick={() => void load(selected.queryId, 'rest')}
        />
      </span>,
    );
  }
  actionParts.push(
    <Button
      key="copy-prompt"
      variant={isSummaryMode ? 'outlineIconButton' : 'primary'}
      className={isSummaryMode ? 'text-sm' : undefined}
      label="Copy AI Prompt"
      loading={analyzing}
      onClick={() => void handleAnalyze()}
    />,
  );
  if (isSummaryMode) {
    actionParts.push(
      <Button
        key="load-full"
        variant="primary"
        label="Load full details"
        onClick={() => void load(selected.queryId, 'rest')}
      />,
    );
  }
  const actions = <>{actionParts}</>;

  // Mutually-exclusive banner slot. Order matters: loading wins over
  // the preview banner, the preview banner wins over success banners,
  // and the error Alert sits underneath whichever is active so the
  // user always sees both the current snapshot state and why the most
  // recent action failed. The wrapper uses a tight `gap-1` so stacked
  // banners stay visually grouped without pushing the stats grid down.
  const bannerSlot = (
    <div className="flex flex-col gap-1">
      {loading && (
        <SlimBanner variant="info">
          <span className="inline-flex items-center gap-2">
            <Spinner size={12} />
            Loading query info…
          </span>
        </SlimBanner>
      )}
      {!loading && isSummaryMode && !error && (
        <SlimBanner variant="info">
          Preview only. Click <strong>Load full details</strong> to fetch the
          execution plan, operator table, and stage tree from the coordinator.
        </SlimBanner>
      )}
      {!loading && !isSummaryMode && info?.jsonPath && (
        <SlimBanner
          variant="success"
          actions={
            <Button
              variant="secondary"
              label="Copy path"
              title="Copy the sanitized JSON path to the clipboard"
              onClick={() =>
                void navigator.clipboard.writeText(info.jsonPath ?? '')
              }
            />
          }
        >
          <span className="opacity-90">Sanitized JSON file generated:</span>{' '}
          <code className="font-mono break-all">{info.jsonPath}</code>
        </SlimBanner>
      )}
      {!loading && !isSummaryMode && info?.fullJsonPath && (
        <SlimBanner
          variant="info"
          actions={
            <Button
              variant="secondary"
              label="Copy path"
              title="Copy the full coordinator snapshot path to the clipboard"
              onClick={() =>
                void navigator.clipboard.writeText(info.fullJsonPath ?? '')
              }
            />
          }
        >
          <span className="opacity-90">
            Full coordinator snapshot (large, raw):
          </span>{' '}
          <code className="font-mono break-all">{info.fullJsonPath}</code>
        </SlimBanner>
      )}
      {!loading && lastAnalysis && (
        <SlimBanner
          variant="success"
          actions={
            <>
              <Button
                variant="secondary"
                label={promptOpen ? 'Hide prompt' : 'View prompt'}
                onClick={() => setPromptOpen((o) => !o)}
              />
              <Button
                variant="secondary"
                label="Copy prompt"
                onClick={() =>
                  void navigator.clipboard.writeText(lastAnalysis.prompt)
                }
              />
            </>
          }
        >
          AI prompt copied to your clipboard. Paste it into your AI agent with
          the <code>dj-trino-analyzer</code> skill loaded — the prompt
          references the sanitized JSON above.
        </SlimBanner>
      )}
      {lastAnalysis && promptOpen && (
        <pre className="text-xs whitespace-pre-wrap opacity-90 max-h-64 overflow-auto border border-neutral rounded p-2">
          {lastAnalysis.prompt}
        </pre>
      )}
      {error && (
        <Alert
          label="Failed to fetch query info"
          description={error.message}
          variant="error"
        />
      )}
    </div>
  );

  // Tabs: always show Overview. Add Stages / Operators / Errors as
  // the coordinator data arrives. The Tab is keyed on the tab count
  // so it resets to index 0 when the panel expands from 1 tab
  // (summary mode) to 4 tabs (full mode), avoiding stale-index
  // selection.
  const tabs: string[] = ['Overview'];
  const panels: React.ReactNode[] = [
    <OverviewTab
      key="overview"
      summary={effectiveSummary}
      sql={effectiveSql}
      modelMatch={info?.modelMatch}
    />,
  ];
  if (info?.rootStage) {
    tabs.push('Stages');
    panels.push(<StageTree key="stages" stage={info.rootStage} />);
  }
  // Length check (not just truthy) — the sanitizer can emit an empty
  // operatorSummary array on Trino versions that ship the field but
  // populate it elsewhere. An empty tab with "no operator data" is
  // noise; only show the tab when there's content.
  if (info?.operatorSummary && info.operatorSummary.length > 0) {
    tabs.push('Operators');
    panels.push(
      <OperatorTable key="operators" operators={info.operatorSummary} />,
    );
  }
  if (info) {
    tabs.push('Errors');
    panels.push(<ErrorTab key="errors" info={info} />);
  }

  return (
    <div className="p-3 flex flex-col gap-3 h-full min-h-0">
      <QueryInfoCard
        summary={effectiveSummary}
        profileName={info?.profileName}
        progressPercent={progressPercent}
        bannerSlot={bannerSlot}
        actions={actions}
      />
      <div className="flex-1 min-h-0">
        <Tab key={`tabs-${tabs.length}`} tabs={tabs} panels={panels} />
      </div>
    </div>
  );
}
