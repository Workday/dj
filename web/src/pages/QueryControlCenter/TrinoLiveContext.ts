import type {
  TrinoCoordinatorPing,
  TrinoPersistedQuery,
  TrinoProfile,
  TrinoQuerySummary,
} from '@shared/trino/types';
import { createContext } from 'react';

/**
 * Single poll cadence shared by the entire Query Control Center.
 *
 * `TrinoLiveProvider` runs one `/v1/query` poll on this interval and
 * derives both the Live tab rows and the coordinator status pill's
 * ok/failed state from the same response — a successful `/v1/query`
 * proves the coordinator is reachable and the profile's credentials
 * work, which is exactly what the pill needs. The Trino version
 * label is fetched once per profile change via `/v1/info` and cached.
 */
export const POLL_INTERVAL_MS = 5_000;

export type TrinoLiveContextValue = {
  profiles: TrinoProfile[];
  active: string | null;
  activeProfile: TrinoProfile | null;
  profilesLoaded: boolean;
  refreshProfiles: () => Promise<void>;
  setActiveProfile: (name: string) => Promise<void>;
  /**
   * `true` between the moment the user picks a profile from the
   * dropdown and the moment the backend confirms the switch. Used by
   * ConnectionPanel to disable the dropdown (prevents rapid re-clicks
   * from racing the in-flight RPC) and by the polling effects to skip
   * fetches against a profile we're about to change away from.
   */
  switchingProfile: boolean;
  /**
   * Fire the parent's `onProfileChanged` hook without changing the
   * active profile. ProfilesManager calls this after a save/delete so
   * the parent can re-key dependent panels (e.g. QueryDetail) when the
   * currently-active profile's URL or credentials may have changed.
   */
  notifyProfileChanged: () => void;

  rows: TrinoQuerySummary[];
  responseSource: 'rest' | 'cli' | null;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;

  ping: TrinoCoordinatorPing | null;

  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  dbtOnly: boolean;
  setDbtOnly: (value: boolean) => void;
  refresh: () => Promise<void>;
  pollIntervalMs: number;

  /**
   * History queries (sanitized diagnostic JSON written to
   * `.dj/diagnostics/`), loaded on mount and mutated in place by
   * `deleteHistoryItem`. Not polled — files only change when the
   * user runs Analyze with AI or Load full details on a Live row,
   * both of which call `refreshHistory` explicitly. `historyLoading`
   * is only `true` on the initial load; background refreshes swap
   * the array silently so the History list never flashes a full-tab
   * spinner.
   */
  historyQueries: TrinoPersistedQuery[];
  historyLoading: boolean;
  historyError: Error | null;
  refreshHistory: () => Promise<void>;
  /**
   * Delete the on-disk sanitized JSON for `queryId` and remove the
   * entry from `historyQueries` in one step, so any consumer
   * (HistoryTab, QueryDetail) reflects the change immediately.
   */
  deleteHistoryItem: (queryId: string) => Promise<void>;
};

export const TrinoLiveContext = createContext<TrinoLiveContextValue | null>(
  null,
);
