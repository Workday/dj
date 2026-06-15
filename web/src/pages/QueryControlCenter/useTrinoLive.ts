import { useContext } from 'react';

import {
  TrinoLiveContext,
  type TrinoLiveContextValue,
} from './TrinoLiveContext';

export function useTrinoLive(): TrinoLiveContextValue {
  const ctx = useContext(TrinoLiveContext);
  if (!ctx) {
    throw new Error('useTrinoLive must be used within <TrinoLiveProvider>');
  }
  return ctx;
}
