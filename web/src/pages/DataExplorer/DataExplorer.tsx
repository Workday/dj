import { useEffect } from 'react';

import { useDataExplorerStore } from '../../stores/dataExplorerStore';
import { ColumnLineage } from '../ColumnLineage';
import ModelLineage from '../ModelLineage';
import ProjectOverview from '../ModelLineage/ProjectOverview';
import QueryPreview from '../QueryPreview';
import SidebarNav from './SidebarNav';

/**
 * DataExplorer wrapper component
 * Currently routes to ModelLineage, future will include ColumnLineage
 */
export default function DataExplorer() {
  const activeView = useDataExplorerStore((s) => s.activeView);
  const setActiveView = useDataExplorerStore((s) => s.setActiveView);
  const fetchLineage = useDataExplorerStore((s) => s.fetchLineage);
  const detectActiveModel = useDataExplorerStore((s) => s.detectActiveModel);

  // Route incoming extension messages to the right sidebar view.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg?.type) return;
      if (msg.type === 'show-adhoc-query') {
        setActiveView('sql');
      } else if (msg.type === 'set-active-model' || msg.type === 'select-model') {
        if (msg.modelName) setActiveView('model');
      } else if (
        msg.type === 'column-lineage-init' ||
        msg.type === 'column-lineage-source-init'
      ) {
        setActiveView('column');
      } else if (msg.type === 'trigger-compilation' || msg.type === 'trigger-run-query') {
        setActiveView('model');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setActiveView]);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <SidebarNav />
      <div className="flex-1 min-w-0 relative">
        <div
          className={`absolute inset-0 ${activeView === 'home' ? '' : 'hidden'}`}
        >
          <ProjectOverview
            onSelectModel={(modelName, projectName) => {
              setActiveView('model');
              void fetchLineage(modelName, projectName);
            }}
            onDetectActiveModel={() => {
              setActiveView('model');
              void detectActiveModel();
            }}
          />
        </div>
        <div
          className={`absolute inset-0 ${activeView === 'model' ? '' : 'hidden'}`}
        >
          <ModelLineage />
        </div>
        <div
          className={`absolute inset-0 ${activeView === 'column' ? '' : 'hidden'}`}
        >
          <ColumnLineage />
        </div>
        <div
          className={`absolute inset-0 ${activeView === 'sql' ? '' : 'hidden'}`}
        >
          <QueryPreview />
        </div>
      </div>
    </div>
  );
}
