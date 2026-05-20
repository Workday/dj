import { useApp } from '@web/context';
import { Tab } from '@web/elements';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useCallback, useEffect } from 'react';

import { DownloadView } from './DownloadView';
import { ExplorerView } from './ExplorerView';
import { PostUploadDialog } from './PostUploadDialog';
import { UploadView } from './UploadView';

const TABS = ['Download', 'Explorer', 'Upload'] as const;
type TabLabel = (typeof TABS)[number];

const TAB_TO_KEY: Record<TabLabel, 'download' | 'explorer' | 'upload'> = {
  Download: 'download',
  Explorer: 'explorer',
  Upload: 'upload',
};

const KEY_TO_INDEX: Record<'download' | 'explorer' | 'upload', number> = {
  download: 0,
  explorer: 1,
  upload: 2,
};

export function LightdashDashboardsAsCode() {
  const { api } = useApp();
  const {
    activeTab,
    setActiveTab,
    setDefaultPath,
    setCurrentPath,
    setAbsolutePath,
    setIsLoadingPath,
    setTree,
    setIsLoadingTree,
    appendLogToActiveChannel,
  } = useLightdashYamlStore();

  const loadInitial = useCallback(async () => {
    setIsLoadingPath(true);
    setIsLoadingTree(true);
    try {
      const pathResp = await api.post({
        type: 'lightdash-yaml-get-default-path',
        request: null,
      });
      setDefaultPath(pathResp.path);
      setCurrentPath(pathResp.path);
      setAbsolutePath(pathResp.absolutePath);

      const listResp = await api.post({
        type: 'lightdash-yaml-list-files',
        request: { path: pathResp.path },
      });
      if (listResp.success) {
        setTree(listResp.tree ?? []);
        if (listResp.absolutePath) {
          setAbsolutePath(listResp.absolutePath);
        }
      }
    } catch (err) {
      console.error('[DashboardsAsCode] Failed to load initial state:', err);
    } finally {
      setIsLoadingPath(false);
      setIsLoadingTree(false);
    }
  }, [
    api,
    setDefaultPath,
    setCurrentPath,
    setAbsolutePath,
    setIsLoadingPath,
    setTree,
    setIsLoadingTree,
  ]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Listen for streamed CLI logs from the extension host (real or mocked)
  // and route them to whichever workflow (download / upload) is active.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'lightdash-yaml-log' && msg.log) {
        appendLogToActiveChannel(msg.log);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [appendLogToActiveChannel]);

  return (
    <div className="h-screen text-surface-contrast flex flex-col gap-4 overflow-hidden">
      <header className="px-4 flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Dashboards as Code</h1>
        <p className="text-sm flex">
          Manage Lightdash charts and dashboards as YAML files using the{' '}
          <code>lightdash download</code> and <code>lightdash upload</code> CLI
          commands.
        </p>
      </header>

      <main className="px-4 pb-4 flex-1 min-h-0 overflow-hidden flex flex-col">
        <Tab
          tabs={[...TABS]}
          defaultIndex={KEY_TO_INDEX[activeTab]}
          onChange={({ value }) => setActiveTab(TAB_TO_KEY[value as TabLabel])}
          panels={[<DownloadView />, <ExplorerView />, <UploadView />]}
        />
      </main>

      <PostUploadDialog />
    </div>
  );
}
