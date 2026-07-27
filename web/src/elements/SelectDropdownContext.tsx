import { createContext, useContext } from 'react';

/**
 * How a select dropdown is positioned relative to its trigger.
 *
 * - `anchored` — body-portaled menu at screen-native text size (forms, dialogs).
 * - `inline` — body-portaled menu (so option clicks are never trapped by React
 *   Flow node stacking) with option text sized to the canvas zoom via fontSize.
 */
export type SelectDropdownPlacement = 'anchored' | 'inline';

export type SelectDropdownContextValue = {
  placement: SelectDropdownPlacement;
  /** React Flow viewport zoom; `1` off-canvas. */
  zoom: number;
};

export const SelectDropdownContext =
  createContext<SelectDropdownContextValue | null>(null);

/** Resolves prop override → canvas/context default → anchored. */
export function useSelectDropdownPlacement(
  prop?: SelectDropdownPlacement,
): SelectDropdownPlacement {
  const fromContext = useContext(SelectDropdownContext);
  return prop ?? fromContext?.placement ?? 'anchored';
}

/** Canvas zoom from context, or `1` when not under a provider. */
export function useSelectDropdownZoom(): number {
  return useContext(SelectDropdownContext)?.zoom ?? 1;
}
