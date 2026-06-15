import type {
  TrinoCoordinatorPing,
  TrinoPersistedQuery,
  TrinoProfile,
  TrinoQuerySummary,
} from '@shared/trino/types';
import { useApp } from '@web/context';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  POLL_INTERVAL_MS,
  TrinoLiveContext,
  type TrinoLiveContextValue,
} from './TrinoLiveContext';

/**
 * Normalize anything we catch into an Error with a readable message.
 *
 * `api.post()` rejects with whatever the extension host serialized
 * across `postMessage`, which is a plain JSON object
 * (`{ message, name, code, … }`) and not an `Error` instance — the
 * prototype is lost over the wire. `String(plainObject)` would
 * render `'[object Object]'`, so pull `.message` out explicitly.
 */
function toError(err: unknown): Error {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === 'string') {
    return new Error(err);
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    return new Error(
      typeof message === 'string' ? message : JSON.stringify(message),
    );
  }
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

export type TrinoLiveProviderProps = {
  children: ReactNode;
  /**
   * Fired after the active profile changes (via `setActiveProfile`) or
   * after a profile is saved/deleted in the manager. The parent uses
   * this to bump a re-key counter on `QueryDetail` so any cached
   * single-query state is dropped.
   */
  onProfileChanged?: () => void;
};

export function TrinoLiveProvider({
  children,
  onProfileChanged,
}: TrinoLiveProviderProps) {
  const { api } = useApp();

  const [profiles, setProfiles] = useState<TrinoProfile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);

  const [rows, setRows] = useState<TrinoQuerySummary[]>([]);
  const [responseSource, setResponseSource] = useState<'rest' | 'cli' | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const [version, setVersion] = useState<string | undefined>(undefined);
  const [ping, setPing] = useState<TrinoCoordinatorPing | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [dbtOnly, setDbtOnly] = useState(false);

  const [historyQueries, setHistoryQueries] = useState<TrinoPersistedQuery[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<Error | null>(null);

  // The poll closure reads dbtOnly + version via refs so toggling
  // either of them does NOT recreate `fetchActive`, which would
  // otherwise tear down and re-arm the interval on every keystroke /
  // version-load.
  const dbtOnlyRef = useRef(dbtOnly);
  dbtOnlyRef.current = dbtOnly;
  const versionRef = useRef<string | undefined>(undefined);
  versionRef.current = version;

  const onProfileChangedRef = useRef(onProfileChanged);
  onProfileChangedRef.current = onProfileChanged;

  const refreshProfiles = useCallback(async () => {
    try {
      const res = await api.post({
        type: 'trino-list-profiles',
        request: null,
      });
      setProfiles(res.profiles);
      setActive(res.active);
    } finally {
      setProfilesLoaded(true);
    }
  }, [api]);

  const setActiveProfile = useCallback(
    async (name: string) => {
      // No-op fast path — picking the already-active profile shouldn't
      // pay for a coordinator round-trip or flicker the status pill.
      if (name === active) {
        return;
      }
      // Optimistic update so the dropdown reflects the user's choice
      // immediately, without waiting for the `trino-set-active-profile`
      // RPC. `ping` and `version` are cleared so StatusLine drops into
      // its spinner mode against the new coordinator URL; the gated
      // effects below refetch both once the backend confirms.
      const previous = active;
      setActive(name);
      setPing(null);
      setVersion(undefined);
      setSwitchingProfile(true);
      try {
        await api.post({
          type: 'trino-set-active-profile',
          request: { name },
        });
        onProfileChangedRef.current?.();
      } catch (err) {
        // Roll back so the dropdown matches the still-active backend
        // profile. The thrown error bubbles to the caller's onChange
        // handler so they can surface it.
        setActive(previous);
        throw err;
      } finally {
        setSwitchingProfile(false);
      }
    },
    [api, active],
  );

  const notifyProfileChanged = useCallback(() => {
    onProfileChangedRef.current?.();
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  // Version fetch — one-shot per profile change. Not on the poll loop.
  const fetchVersion = useCallback(async () => {
    if (!active) {
      setVersion(undefined);
      return;
    }
    try {
      const res = await api.post({
        type: 'trino-ping-coordinator',
        request: {},
      });
      setVersion(res.ok ? res.version : undefined);
    } catch {
      setVersion(undefined);
    }
  }, [api, active]);

  useEffect(() => {
    // Skip while a profile switch is in flight — we'd just be querying
    // the soon-to-be-stale active profile on the backend. The effect
    // re-runs the moment `switchingProfile` flips back to false, so
    // the version fetches the *new* coordinator's build automatically.
    if (switchingProfile) {
      return;
    }
    void fetchVersion();
  }, [fetchVersion, switchingProfile]);

  // When version finishes loading after a profile change, mirror it
  // into the current ping so the pill picks it up without waiting for
  // the next 5 s tick. We only patch a healthy ping — if the pill is
  // showing a failure, the version is moot.
  useEffect(() => {
    setPing((prev) => (prev?.ok ? { ...prev, version } : prev));
  }, [version]);

  const fetchActive = useCallback(async () => {
    setRefreshing(true);
    try {
      const envelope = await api.post({
        type: 'trino-fetch-active-queries',
        request: {
          filter: dbtOnlyRef.current ? 'dbt-trino-only' : 'all',
        },
      });
      setRows(envelope.rows);
      setResponseSource(envelope.source);
      setError(null);
      setPing({ ok: true, version: versionRef.current });
    } catch (err) {
      const e = toError(err);
      setError(e);
      setPing({ ok: false, error: e.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  // Single poll loop. Re-runs (and fires an immediate fetch) when the
  // active profile or dbt-only filter changes, or when the user
  // toggles auto-refresh. Paused while a profile switch is in flight
  // so polls don't race the in-flight `trino-set-active-profile` RPC
  // and overwrite the row list against the wrong backend profile.
  useEffect(() => {
    if (switchingProfile) {
      return undefined;
    }
    void fetchActive();
    if (!autoRefresh) {
      return undefined;
    }
    const id = setInterval(() => {
      void fetchActive();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchActive, autoRefresh, active, dbtOnly, switchingProfile]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchVersion(), fetchActive()]);
  }, [fetchActive, fetchVersion]);

  // Tracks whether we've ever successfully loaded the history list.
  // The first load shows the full-tab spinner; subsequent background
  // refreshes (Load full details, Analyze with AI, …) swap the array
  // silently because the rows haven't gone anywhere — at most one
  // entry was appended.
  const hasLoadedHistoryRef = useRef(false);

  const refreshHistory = useCallback(async () => {
    const isInitial = !hasLoadedHistoryRef.current;
    if (isInitial) {
      setHistoryLoading(true);
    }
    try {
      const list = await api.post({
        type: 'trino-fetch-persisted-queries',
        request: null,
      });
      setHistoryQueries(list);
      setHistoryError(null);
      hasLoadedHistoryRef.current = true;
    } catch (err) {
      setHistoryError(toError(err));
      // Don't flip the "loaded once" flag on error — the next call
      // should still be allowed to show the spinner.
    } finally {
      if (isInitial) {
        setHistoryLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const deleteHistoryItem = useCallback(
    async (queryId: string) => {
      await api.post({
        type: 'trino-delete-persisted-query',
        request: { queryId },
      });
      setHistoryQueries((prev) => prev.filter((p) => p.queryId !== queryId));
    },
    [api],
  );

  const activeProfile = useMemo(
    () => profiles.find((p) => p.name === active) ?? null,
    [profiles, active],
  );

  const value = useMemo<TrinoLiveContextValue>(
    () => ({
      profiles,
      active,
      activeProfile,
      profilesLoaded,
      refreshProfiles,
      setActiveProfile,
      switchingProfile,
      notifyProfileChanged,
      rows,
      responseSource,
      loading,
      refreshing,
      error,
      ping,
      autoRefresh,
      setAutoRefresh,
      dbtOnly,
      setDbtOnly,
      refresh,
      pollIntervalMs: POLL_INTERVAL_MS,
      historyQueries,
      historyLoading,
      historyError,
      refreshHistory,
      deleteHistoryItem,
    }),
    [
      profiles,
      active,
      activeProfile,
      profilesLoaded,
      refreshProfiles,
      setActiveProfile,
      switchingProfile,
      notifyProfileChanged,
      rows,
      responseSource,
      loading,
      refreshing,
      error,
      ping,
      autoRefresh,
      dbtOnly,
      refresh,
      historyQueries,
      historyLoading,
      historyError,
      refreshHistory,
      deleteHistoryItem,
    ],
  );

  return (
    <TrinoLiveContext.Provider value={value}>
      {children}
    </TrinoLiveContext.Provider>
  );
}
