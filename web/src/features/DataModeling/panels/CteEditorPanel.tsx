import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button, DialogBox, Tab } from '@web/elements';
import { type CteState, useModelStore } from '@web/stores/useModelStore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CteFiltersTab } from './CteFiltersTab';
import { CteGeneralTab } from './CteGeneralTab';
import { CteSelectTab } from './CteSelectTab';
import { CteValidationTab } from './CteValidationTab';

interface CteEditorPanelProps {
  /**
   * The DOM element the popover anchors to (the CTE row). Provided by
   * `CteNode` for the row whose index matches `editingCteIndex`. Used by
   * the click-outside handler so clicks on the trigger row don't bubble
   * into a close.
   */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * On-canvas popover for rich per-CTE editing. Mounted as a sibling of the
 * editing CTE's row inside `CteNode`, positioned to its right via
 * `absolute top-0 left-full`. Visibility is driven by
 * `state.editingCteIndex !== null`.
 *
 * Replaces the previous Headless UI Dialog (right-side slide-out modal)
 * with a contextual popover anchored next to the trigger row -- mirrors the
 * LightdashNode chart-list pattern from `features/lightdash-lineage` so
 * popovers across the canvas dismiss the same way.
 *
 * React Flow escape hatches (`nodrag nopan nowheel`) keep clicks, drags,
 * and wheel-scroll inside the popover. Outside-click and Escape both
 * dismiss; clicks on the trigger row are excluded so they can re-open with
 * a different `editingCteIndex` without an intermediate close.
 *
 * Keeps the most recent analysis API response visible while a new
 * request is in flight so the popover does not flash on every keystroke;
 * the only loading indicator is a subtle "updating" tag on the count
 * pill in the Select tab.
 */
export const CteEditorPanel: React.FC<CteEditorPanelProps> = ({
  anchorRef,
}) => {
  const editingCteIndex = useModelStore((s) => s.editingCteIndex);
  const closeCteEditor = useModelStore((s) => s.closeCteEditor);
  const ctes = useModelStore((s) => s.ctes);
  const removeCte = useModelStore((s) => s.removeCte);
  const patchCte = useModelStore((s) => s.patchCte);
  const cteAnalysis = useModelStore((s) => s.cteAnalysis);

  const popoverRef = useRef<HTMLDivElement | null>(null);

  const isOpen = editingCteIndex !== null;
  const cte: CteState | null =
    editingCteIndex !== null ? ctes[editingCteIndex] ?? null : null;

  const cteName = cte?.name ?? '';
  // Diagnostics for the currently-edited CTE -- drives error/warning chips
  // on the tabs and the most-relevant-tab focus heuristic on open.
  const myDiagnostics = useMemo(
    () => cteAnalysis.diagnostics.filter((d) => d.cteIndex === editingCteIndex),
    [cteAnalysis.diagnostics, editingCteIndex],
  );
  const errorCount = myDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = myDiagnostics.filter(
    (d) => d.severity === 'warning',
  ).length;

  // Pick the most relevant tab to focus on open. If columns are missing for
  // the CTE, jump to Select; if there are diagnostics, jump to Validation;
  // otherwise General. Derived from the *current* analysis snapshot so the
  // tab reflects what the user is most likely to act on.
  const defaultTabIndex = useMemo(() => {
    if (!cte) return 0;
    const cols = cteAnalysis.columns[cteName] ?? [];
    if (
      cols.length === 0 &&
      Array.isArray(cte.select) &&
      cte.select.length > 0
    ) {
      return 1; // Select
    }
    if (errorCount > 0) {
      return 3; // Validation
    }
    return 0; // General
  }, [cte, cteAnalysis.columns, cteName, errorCount]);

  const handlePatch = useCallback(
    (patch: Partial<CteState>) => {
      if (editingCteIndex === null) return;
      patchCte(editingCteIndex, patch);
    },
    [editingCteIndex, patchCte],
  );

  const [pendingDelete, setPendingDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (editingCteIndex === null) return;
    setPendingDelete(true);
  }, [editingCteIndex]);

  const handleConfirmDelete = useCallback(() => {
    setPendingDelete(false);
    if (editingCteIndex === null) return;
    removeCte(editingCteIndex);
    closeCteEditor();
  }, [closeCteEditor, editingCteIndex, removeCte]);

  // Dismiss on outside-click / Escape so the popover never gets stranded
  // over the canvas. Clicks on the anchor row (the CTE list item) are
  // excluded -- those let the user reopen the popover for a different CTE
  // without an intermediate close. Mirrors LightdashNode dismissal.
  //
  // We also ignore clicks landing inside Headless UI portals (Combobox /
  // Listbox / Menu options render into document.body via
  // `[data-headlessui-portal]`, outside our popoverRef subtree). Without
  // this guard, picking an option in the inline "Add manual column" or any
  // SelectSingle dropdown would be treated as an outside-click and close
  // the panel before the selection registers.
  useEffect(() => {
    if (!isOpen) return;
    // A nested DialogBox owns its own dismissal; the panel-level listeners
    // would otherwise also close the editor when the dialog is dismissed.
    if (pendingDelete) return;
    const isInsidePortaledOverlay = (target: Node): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          [
            '[data-headlessui-portal]',
            '[data-radix-popper-content-wrapper]',
            '[role="listbox"]',
            '[role="option"]',
            '[role="menu"]',
            '[role="dialog"]',
            '[role="alertdialog"]',
          ].join(','),
        ),
      );
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      if (isInsidePortaledOverlay(target)) return;
      closeCteEditor();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCteEditor();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchorRef, closeCteEditor, isOpen, pendingDelete]);

  if (!isOpen || !cte) {
    return null;
  }

  const tabLabels = [
    'General',
    'Select',
    'Filters',
    `Validation${errorCount + warningCount > 0 ? ` (${errorCount + warningCount})` : ''}`,
  ];

  return (
    // `nodrag nopan nowheel` keep ReactFlow from interpreting interactions
    // inside the popover as canvas drag / pan / zoom. `z-50` puts the
    // popover above ReactFlow handles; the wizard's own modals (Dialog
    // confirms etc.) stay above at `z-[10000]+`.
    //
    // Uses a definite `h-[640px]` instead of `max-h-[640px]` so the inner
    // `flex-1 min-h-0` chain resolves a real height for the tab body.
    // With only `max-height`, `h-full` on `TAB_BODY` collapses to content
    // size and `overflow-y-auto` never engages on tall tabs.
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Edit CTE ${cteName || 'cte'}`}
      className="nodrag nopan nowheel absolute top-0 left-full ml-3 z-50 w-[560px] h-[640px] bg-background border border-neutral rounded-lg shadow-xl flex flex-col"
    >
      {/* Diamond caret pointing back at the trigger row. Border-bottom +
          border-left + 45deg rotation produce a card-coloured arrow flush
          against the popover's left edge. */}
      <div
        aria-hidden
        className="absolute top-4 -left-1.5 w-3 h-3 bg-background border-b border-l border-neutral -rotate-45"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral shrink-0">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Editing CTE
          </div>
          <div className="font-mono text-sm text-foreground truncate">
            {cteName || `cte_${(editingCteIndex ?? 0) + 1}`}
          </div>
        </div>
        <Button
          variant="iconButton"
          aria-label="Close CTE editor"
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface"
          icon={<XMarkIcon className="w-5 h-5" />}
          onClick={closeCteEditor}
        />
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Tab
          defaultIndex={defaultTabIndex}
          tabs={tabLabels}
          panels={[
            <CteGeneralTab key="general" cte={cte} onPatch={handlePatch} />,
            <CteSelectTab key="select" cte={cte} onPatch={handlePatch} />,
            <CteFiltersTab key="filters" cte={cte} onPatch={handlePatch} />,
            <CteValidationTab
              key="validation"
              cteIndex={editingCteIndex ?? -1}
            />,
          ]}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-neutral shrink-0">
        <Button
          variant="link"
          label="Delete CTE"
          onClick={handleDelete}
          className="text-error hover:underline"
        />
        <Button variant="primary" label="Done" onClick={closeCteEditor} />
      </div>

      <DialogBox
        open={pendingDelete}
        variant="warning"
        title="Remove CTE?"
        description={`Remove CTE "${cteName}"? This will also strip every reference to it across the model.`}
        confirmCTALabel="Remove"
        discardCTALabel="Cancel"
        onConfirm={handleConfirmDelete}
        onDiscard={() => setPendingDelete(false)}
      />
    </div>
  );
};
