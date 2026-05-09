import { useEffect, useState } from 'react';

import ModelLineage from '../ModelLineage';
import QueryPreview from '../QueryPreview';

export default function DataExplorer() {
  const [showAdhocQuery, setShowAdhocQuery] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'show-adhoc-query') {
        setShowAdhocQuery(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (showAdhocQuery) {
    return <QueryPreview onClose={() => setShowAdhocQuery(false)} />;
  }

  return <ModelLineage onShowAdhocQuery={() => setShowAdhocQuery(true)} />;
}
