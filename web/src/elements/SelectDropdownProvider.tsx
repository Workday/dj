import React, { useMemo } from 'react';

import {
  SelectDropdownContext,
  type SelectDropdownPlacement,
} from './SelectDropdownContext';

export function SelectDropdownProvider({
  placement,
  zoom = 1,
  children,
}: {
  placement: SelectDropdownPlacement;
  /** React Flow viewport zoom; omit (defaults to 1) off-canvas. */
  zoom?: number;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ placement, zoom }), [placement, zoom]);

  return (
    <SelectDropdownContext.Provider value={value}>
      {children}
    </SelectDropdownContext.Provider>
  );
}
