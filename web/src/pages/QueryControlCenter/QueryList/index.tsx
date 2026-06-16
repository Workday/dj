import { Tab } from '@web/elements';

import type { QueryListProps } from '../types';
import { HistoryTab } from './HistoryTab';
import { LiveTab } from './LiveTab';

/**
 * Master pane for the Query Control Center. Renders the Live and
 * History tabs and forwards selection events back up to the parent.
 * All data fetching lives inside `LiveTab` / `HistoryTab` via the
 * shared `TrinoLiveContext`, so this wrapper stays layout-only.
 */
export function QueryList(props: QueryListProps) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <Tab
        tabs={['Live', 'History']}
        panels={[
          <LiveTab key="live" {...props} />,
          <HistoryTab key="history" {...props} />,
        ]}
      />
    </div>
  );
}
