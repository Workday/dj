import { Box, Spinner, Text } from '@web/elements';
import { useMemo, useState } from 'react';

import type { QueryListProps } from '../types';
import { useTrinoLive } from '../useTrinoLive';
import { LiveListingControls } from './LiveListingControls';
import { QueryFilterBar } from './QueryFilterBar';
import {
  buildSingleSelectOptions,
  type StateChip,
  stateKeyFor,
} from './queryFilters';
import { QueryRow } from './QueryRow';

/**
 * Live tab. Pure consumer of the shared `TrinoLiveContext` — no
 * `setInterval`, fetch, or error state of its own. The connection
 * pill (ConnectionPanel) reads the same context so the two surfaces
 * stay on a single source of truth.
 */
export function LiveTab({ selectedQueryId, onSelectQuery }: QueryListProps) {
  const {
    rows: queries,
    loading,
    refreshing,
    error,
    autoRefresh,
    setAutoRefresh,
    dbtOnly,
    setDbtOnly,
    refresh,
    responseSource,
    pollIntervalMs,
  } = useTrinoLive();
  const [search, setSearch] = useState('');
  const [selectedStates, setSelectedStates] = useState<Set<StateChip>>(
    () => new Set(),
  );
  const [userFilter, setUserFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const distinctUsers = useMemo(() => {
    const set = new Set<string>();
    queries.forEach((q) => {
      if (q.user) {
        set.add(q.user);
      }
    });
    return Array.from(set).sort();
  }, [queries]);

  const distinctSources = useMemo(() => {
    const set = new Set<string>();
    queries.forEach((q) => {
      if (q.source) {
        set.add(q.source);
      }
    });
    return Array.from(set).sort();
  }, [queries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return queries.filter((q) => {
      if (
        selectedStates.size > 0 &&
        !selectedStates.has(stateKeyFor(q.state))
      ) {
        return false;
      }
      if (userFilter && q.user !== userFilter) {
        return false;
      }
      if (sourceFilter && q.source !== sourceFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [q.queryId, q.user, q.source, q.state, q.query]
        .filter(Boolean)
        .some((v) => v!.toString().toLowerCase().includes(needle));
    });
  }, [queries, search, selectedStates, userFilter, sourceFilter]);

  const toggleState = (state: StateChip) => {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  const activeFilterCount =
    selectedStates.size +
    (userFilter ? 1 : 0) +
    (sourceFilter ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearAllFilters = () => {
    setSelectedStates(new Set());
    setUserFilter('');
    setSourceFilter('');
    setSearch('');
  };

  const userOptions = useMemo(
    () => buildSingleSelectOptions(distinctUsers, userFilter),
    [distinctUsers, userFilter],
  );
  const sourceOptions = useMemo(
    () => buildSingleSelectOptions(distinctSources, sourceFilter),
    [distinctSources, sourceFilter],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <QueryFilterBar
        search={search}
        onSearchChange={setSearch}
        selectedStates={selectedStates}
        onToggleState={toggleState}
        userFilter={userFilter}
        userOptions={userOptions}
        onUserFilterChange={setUserFilter}
        sourceFilter={sourceFilter}
        sourceOptions={sourceOptions}
        onSourceFilterChange={setSourceFilter}
        activeFilterCount={activeFilterCount}
        onClearAll={clearAllFilters}
        dbtOnly={dbtOnly}
        onDbtOnlyChange={setDbtOnly}
      />
      {responseSource !== null && (
        <LiveListingControls
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          pollIntervalMs={pollIntervalMs}
        />
      )}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <Box variant="padded">
            <Spinner />
          </Box>
        ) : error ? (
          <Box variant="padded">
            <Text>Failed to load active queries: {error.message}</Text>
          </Box>
        ) : visible.length === 0 ? (
          <Box variant="padded">
            <div className="text-sm font-semibold">
              No queries match the current filter.
            </div>
            <div className="text-xs opacity-70 mt-2 leading-relaxed">
              The Trino coordinator only keeps recent queries in memory
              (typically the last ~100 queries or the last ~15 minutes,
              whichever comes first). Past queries you&apos;ve clicked
              &ldquo;Analyze with AI&rdquo; on are saved to{' '}
              <code>.dj/diagnostics/</code> and show up under the{' '}
              <strong>History</strong> tab.
            </div>
          </Box>
        ) : (
          visible.map((q) => (
            <QueryRow
              key={q.queryId}
              query={q}
              selected={selectedQueryId === q.queryId}
              onSelect={() =>
                onSelectQuery({
                  queryId: q.queryId,
                  summary: q,
                  source: 'live',
                })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
