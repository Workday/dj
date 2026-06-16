import { useCallback, useEffect, useState } from 'react';

import { ConnectionPanel } from './ConnectionPanel';
import { ProfilesManager } from './ProfilesManager';
import { QueryDetail } from './QueryDetail';
import { QueryList } from './QueryList';
import { TrinoLiveProvider } from './TrinoLiveProvider';
import type { SelectedQuery } from './types';

export type { SelectedQuery, SelectionSource } from './types';

/**
 * Master-detail Trino query browser. The extension host can preselect
 * a specific query by passing `?queryId=<id>` in the route URL (read
 * from the injected `<meta name="route">` tag — `window.location.search`
 * is always empty inside a `vscode-webview://` URL) or by posting a
 * `query-control-center-select` message after the panel mounts.
 *
 * The right pane is dual-mode: by default it shows `QueryDetail` for
 * the currently selected query; when the user clicks "Manage profiles"
 * in the sidebar it swaps to `ProfilesManager`. Clicking a query row
 * auto-exits manage mode so the surface always settles on a single
 * action.
 */
export function QueryControlCenter() {
  const [selected, setSelected] = useState<SelectedQuery | null>(() => {
    if (typeof document === 'undefined') return null;
    const meta =
      document.getElementsByName('route')[0]?.getAttribute('content') ?? '';
    const q = meta.indexOf('?');
    if (q < 0) return null;
    const queryId = new URLSearchParams(meta.slice(q)).get('queryId');
    if (!queryId) return null;
    return { queryId, summary: null, source: 'preselect' };
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [manageMode, setManageMode] = useState(false);

  useEffect(() => {
    function handler(event: MessageEvent) {
      const data = event.data;
      if (
        data &&
        typeof data === 'object' &&
        data.type === 'query-control-center-select' &&
        typeof data.queryId === 'string'
      ) {
        setSelected({
          queryId: data.queryId,
          summary: null,
          source: 'preselect',
        });
        setManageMode(false);
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleProfileChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSelectQuery = useCallback((sel: SelectedQuery) => {
    // An empty queryId from a child (e.g. HistoryTab after deleting the
    // currently-selected history item) means "clear the selection".
    setSelected(sel.queryId ? sel : null);
    setManageMode(false);
  }, []);

  return (
    <TrinoLiveProvider onProfileChanged={handleProfileChanged}>
      <div className="flex h-screen min-h-0">
        <div className="w-[420px] border-r border-neutral flex flex-col min-h-0">
          <ConnectionPanel onManage={() => setManageMode(true)} />
          <QueryList
            selectedQueryId={selected?.queryId ?? null}
            onSelectQuery={handleSelectQuery}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {manageMode ? (
            <ProfilesManager onClose={() => setManageMode(false)} />
          ) : (
            <QueryDetail key={`detail-${refreshKey}`} selected={selected} />
          )}
        </div>
      </div>
    </TrinoLiveProvider>
  );
}
