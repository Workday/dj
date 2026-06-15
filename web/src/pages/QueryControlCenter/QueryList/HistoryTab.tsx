import { Box, Button, DialogBox, Spinner, Text } from '@web/elements';
import { useCallback, useMemo, useState } from 'react';

import type { QueryListProps } from '../types';
import { useTrinoLive } from '../useTrinoLive';
import { QueryFilterBar } from './QueryFilterBar';
import {
  buildSingleSelectOptions,
  type StateChip,
  stateKeyFor,
} from './queryFilters';
import { QueryRow } from './QueryRow';

/**
 * History tab. List + delete come from the shared `TrinoLiveContext`
 * so deletes stay consistent across consumers and this component
 * carries no fetch / interval / confirm-dialog state of its own.
 *
 * Filters mirror the Live tab's set (search + state chips + user +
 * source) plus a History-only Profile dropdown sourced from the
 * diagnostics' captured `profileName`.
 */
export function HistoryTab({ selectedQueryId, onSelectQuery }: QueryListProps) {
  const {
    historyQueries: items,
    historyLoading: loading,
    historyError: error,
    deleteHistoryItem,
  } = useTrinoLive();

  const [search, setSearch] = useState('');
  const [selectedStates, setSelectedStates] = useState<Set<StateChip>>(
    () => new Set(),
  );
  const [userFilter, setUserFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [profileFilter, setProfileFilter] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Bulk delete state: `mode` drives the dialog wording (all vs the
  // filtered subset) and `targets` is the frozen list of queryIds to
  // remove. Captured at click time so a filter change after the
  // dialog opens can't surprise the user with a different scope.
  const [pendingBulkDelete, setPendingBulkDelete] = useState<{
    mode: 'all' | 'filtered';
    targets: string[];
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  const distinctUsers = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p) => {
      if (p.summary.user) {
        set.add(p.summary.user);
      }
    });
    return Array.from(set).sort();
  }, [items]);

  const distinctSources = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p) => {
      if (p.summary.source) {
        set.add(p.summary.source);
      }
    });
    return Array.from(set).sort();
  }, [items]);

  const distinctProfiles = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p) => {
      if (p.profileName) {
        set.add(p.profileName);
      }
    });
    return Array.from(set).sort();
  }, [items]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((p) => {
      const q = p.summary;
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
      if (profileFilter && p.profileName !== profileFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return [q.queryId, q.user, q.source, q.state, q.query, p.profileName]
        .filter(Boolean)
        .some((v) => v!.toString().toLowerCase().includes(needle));
    });
  }, [items, search, selectedStates, userFilter, sourceFilter, profileFilter]);

  const toggleState = useCallback((state: StateChip) => {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  }, []);

  const activeFilterCount =
    selectedStates.size +
    (userFilter ? 1 : 0) +
    (sourceFilter ? 1 : 0) +
    (profileFilter ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setSelectedStates(new Set());
    setUserFilter('');
    setSourceFilter('');
    setProfileFilter('');
    setSearch('');
  }, []);

  const userOptions = useMemo(
    () => buildSingleSelectOptions(distinctUsers, userFilter),
    [distinctUsers, userFilter],
  );
  const sourceOptions = useMemo(
    () => buildSingleSelectOptions(distinctSources, sourceFilter),
    [distinctSources, sourceFilter],
  );
  const profileOptions = useMemo(() => {
    const opts = [
      { value: '', label: 'All' },
      ...distinctProfiles.map((p) => ({ value: p, label: p })),
    ];
    if (profileFilter && !distinctProfiles.includes(profileFilter)) {
      opts.push({
        value: profileFilter,
        label: `${profileFilter} (not in results)`,
      });
    }
    return opts;
  }, [distinctProfiles, profileFilter]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }
    const id = pendingDelete;
    try {
      await deleteHistoryItem(id);
      setPendingDelete(null);
      setDeleteError(null);
      if (selectedQueryId === id) {
        // Empty queryId is the "clear selection" sentinel honoured by
        // QueryControlCenter/index.tsx -> handleSelectQuery, so the
        // right pane resets to its empty state.
        onSelectQuery({ queryId: '', summary: null, source: 'history' });
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [deleteHistoryItem, onSelectQuery, pendingDelete, selectedQueryId]);

  const confirmBulkDelete = useCallback(async () => {
    if (!pendingBulkDelete) {
      return;
    }
    const targets = pendingBulkDelete.targets;
    setBulkDeleting(true);
    setDeleteError(null);
    // Sequential deletes keep the provider's `setHistoryQueries`
    // updates ordered and let us bail out on the first failure with
    // the rest of the diagnostics still on disk. Reuses the per-id
    // message rather than adding a bulk API.
    try {
      for (const id of targets) {
        await deleteHistoryItem(id);
      }
      if (selectedQueryId && targets.includes(selectedQueryId)) {
        onSelectQuery({ queryId: '', summary: null, source: 'history' });
      }
      setPendingBulkDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err : new Error(String(err)));
      setPendingBulkDelete(null);
    } finally {
      setBulkDeleting(false);
    }
  }, [deleteHistoryItem, onSelectQuery, pendingBulkDelete, selectedQueryId]);

  if (loading) {
    return (
      <Box variant="padded">
        <Spinner />
      </Box>
    );
  }
  if (error) {
    return (
      <Box variant="padded">
        <Text>Failed to load history: {error.message}</Text>
      </Box>
    );
  }
  if (items.length === 0) {
    return (
      <Box variant="padded">
        <div className="text-sm font-semibold">No analyzed queries yet.</div>
        <div className="text-xs opacity-70 mt-2 leading-relaxed">
          Click &ldquo;Analyze with AI&rdquo; on a live or finished query — its
          sanitized diagnostic JSON lands in <code>.dj/diagnostics/</code> and
          shows up here even after the coordinator forgets the query.
        </div>
      </Box>
    );
  }

  // Bulk delete derives its scope from the current filter state at
  // click time: with no filters active the button purges every
  // history entry, otherwise it purges only the filtered subset.
  // Computed inline so the label/scope re-evaluate on every render
  // as filters change.
  const bulkMode: 'all' | 'filtered' =
    activeFilterCount > 0 ? 'filtered' : 'all';
  const bulkTargets =
    bulkMode === 'all'
      ? items.map((p) => p.queryId)
      : visible.map((p) => p.queryId);
  const bulkLabel =
    bulkMode === 'all' ? 'Delete all' : `Delete ${bulkTargets.length} filtered`;

  // The outer Tab panel is `h-full min-h-0` but not a flex column, so
  // the list needs its own `flex flex-col h-full min-h-0` wrapper to
  // give the inner `flex-1 overflow-auto` something to constrain.
  // Without this wrapper the page itself scrolls instead of the list.
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
        profileFilter={profileFilter}
        profileOptions={profileOptions}
        onProfileFilterChange={setProfileFilter}
      />
      <div className="flex-1 overflow-auto min-h-0">
        {visible.length === 0 ? (
          <Box variant="padded">
            <div className="text-sm font-semibold">
              No analyzed queries match the current filter.
            </div>
            <div className="text-xs opacity-70 mt-2">
              Adjust the filters above or click <strong>Clear</strong> to see
              every diagnostic in <code>.dj/diagnostics/</code>.
            </div>
          </Box>
        ) : (
          visible.map((item) => (
            <QueryRow
              key={item.queryId}
              query={item.summary}
              selected={selectedQueryId === item.queryId}
              onSelect={() =>
                onSelectQuery({
                  queryId: item.queryId,
                  summary: item.summary,
                  source: 'history',
                })
              }
              onDelete={(id) => setPendingDelete(id)}
              profileBadge={
                item.profileName
                  ? {
                      profileName: item.profileName,
                      coordinatorUrl: item.coordinatorUrl,
                    }
                  : null
              }
            />
          ))
        )}
      </div>
      <div className="flex items-center justify-between text-xs pt-1">
        <span className="opacity-70">{items.length} saved</span>
        <Button
          variant="secondary"
          label={bulkLabel}
          disabled={bulkDeleting || bulkTargets.length === 0}
          onClick={() =>
            setPendingBulkDelete({ mode: bulkMode, targets: bulkTargets })
          }
        />
      </div>
      {deleteError && (
        <Box variant="padded">
          <Text>Failed to delete: {deleteError.message}</Text>
        </Box>
      )}
      <DialogBox
        open={pendingDelete !== null}
        variant="warning"
        title="Remove from history?"
        description={
          pendingDelete
            ? `This permanently deletes the saved diagnostic files for ${pendingDelete} from .dj/diagnostics/. The coordinator copy (if it still exists) is not affected.`
            : undefined
        }
        confirmCTALabel="Delete"
        discardCTALabel="Cancel"
        onConfirm={() => void confirmDelete()}
        onDiscard={() => setPendingDelete(null)}
      />
      <DialogBox
        open={pendingBulkDelete !== null}
        variant="warning"
        title={
          pendingBulkDelete?.mode === 'filtered'
            ? `Delete ${pendingBulkDelete.targets.length} filtered diagnostics?`
            : 'Delete all saved diagnostics?'
        }
        description={
          pendingBulkDelete
            ? `This permanently deletes the saved diagnostic files for ${pendingBulkDelete.targets.length} ${
                pendingBulkDelete.targets.length === 1 ? 'query' : 'queries'
              } from .dj/diagnostics/. The coordinator copies (if they still exist) are not affected.`
            : undefined
        }
        confirmCTALabel={bulkDeleting ? 'Deleting...' : 'Delete'}
        discardCTALabel="Cancel"
        onConfirm={() => void confirmBulkDelete()}
        onDiscard={() => setPendingBulkDelete(null)}
      />
    </div>
  );
}
