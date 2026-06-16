import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {
  Bars3Icon,
  DocumentDuplicateIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Square3Stack3DIcon } from '@heroicons/react/24/solid';
import { Button, DialogBox } from '@web/elements';
import { type CteState, useModelStore } from '@web/stores/useModelStore';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { HoverTooltip } from '../components/HoverTooltip';
import { CteEditorPanel } from '../panels/CteEditorPanel';

/**
 * One-line description of a CTE's `from` for the list summary. Mirrors the four
 * schema variants in `model.cte.schema.json` (model, cte, model+union, cte+union).
 */
function summarizeFrom(from: CteState['from'] | undefined): string {
  if (!from || typeof from !== 'object') {
    return 'no source';
  }
  const f = from;
  if (f.union && typeof f.union === 'object') {
    const u = f.union as Record<string, unknown>;
    const ctes = Array.isArray(u.ctes) ? (u.ctes as string[]) : null;
    const models = Array.isArray(u.models) ? (u.models as string[]) : null;
    if (ctes) {
      const head = typeof f.cte === 'string' ? f.cte : '';
      return `union of ${1 + ctes.length} CTE${ctes.length ? 's' : ''}${
        head ? ` (${head}, ...)` : ''
      }`;
    }
    if (models) {
      const head = typeof f.model === 'string' ? f.model : '';
      return `union of ${1 + models.length} model${models.length ? 's' : ''}${
        head ? ` (${head}, ...)` : ''
      }`;
    }
  }
  if (typeof f.cte === 'string' && f.cte) {
    return `CTE: ${f.cte}`;
  }
  if (typeof f.model === 'string' && f.model) {
    return `model: ${f.model}`;
  }
  return 'no source';
}

function summarizeBadges(cte: CteState): string {
  const parts: string[] = [];
  const sel = cte.select;
  if (Array.isArray(sel) && sel.length > 0) {
    parts.push(`${sel.length} select`);
  }
  const fromObj = cte.from as Record<string, unknown> | undefined;
  if (fromObj && typeof fromObj === 'object' && fromObj.rollup) {
    parts.push('rollup');
  }
  if (cte.where) {
    parts.push('where');
  }
  if (cte.group_by) {
    parts.push('group_by');
  }
  if (cte.having) {
    parts.push('having');
  }
  return parts.join(' · ');
}

/**
 * Compact React Flow node listing the CTEs defined on the model. The rich
 * per-CTE editor lives in the side-panel mounted at the wizard root; clicking
 * a row dispatches `openCteEditor`. Empty state shows a single "Add CTE" CTA.
 *
 * Internal scroll is capped at max-h-[480px] so the React Flow node never
 * overflows regardless of CTE count -- avoids fragile per-row height math in
 * the layout pass and keeps very long CTE lists usable.
 */
export const CteNode: React.FC<NodeProps> = ({ data: _data }) => {
  const { ctes, addCte, removeCte, moveCte, duplicateCte, openCteEditor } =
    useModelStore((state) => ({
      ctes: state.ctes,
      addCte: state.addCte,
      removeCte: state.removeCte,
      moveCte: state.moveCte,
      duplicateCte: state.duplicateCte,
      openCteEditor: state.openCteEditor,
    }));
  const editingCteIndex = useModelStore((state) => state.editingCteIndex);
  const diagnostics = useModelStore((state) => state.cteAnalysis.diagnostics);
  const setCteNodeMeasuredHeight = useModelStore(
    (state) => state.setCteNodeMeasuredHeight,
  );

  // The CteEditorPanel popover anchors to the CteNode root (the whole list
  // card) rather than the individual editing row. The list is a scroll
  // container with `overflow-y-auto` -- positioning the popover off a
  // specific row gets clipped at the scroll edges and would also need to
  // track the row's rect across scrolls. Anchoring off the node mirrors
  // the LightdashNode pattern (chart list popover anchors off the
  // dashboard node, not its rows) and keeps interactions stable.
  // The currently-edited row is highlighted via `isEditing` styling so
  // the user still sees which CTE the popover targets.
  const nodeRootRef = useRef<HTMLDivElement | null>(null);

  // Observe the rendered height of the CTE node and publish it into the
  // store. `useLayoutManager` reads this value to compute the
  // `preSource -> source` vertical gap correctly. Without this, the
  // layout pass treats every node as 200px tall (LAYOUT_CONFIG.nodeHeight)
  // and the SelectNode ends up overlapping the CTE list as it grows.
  useEffect(() => {
    const el = nodeRootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        setCteNodeMeasuredHeight(h);
      }
    });
    ro.observe(el);
    // Seed with the current height (ResizeObserver fires asynchronously and
    // the very first layout pass would otherwise see null).
    setCteNodeMeasuredHeight(el.getBoundingClientRect().height);
    return () => {
      ro.disconnect();
      // Don't reset to null on unmount -- the node will remount on the
      // next render and we'd briefly drop back to the 200px default,
      // causing a layout flicker.
    };
  }, [setCteNodeMeasuredHeight]);

  // Bucket diagnostics by CTE index so each row can show error/warning
  // chips without filtering the full list per render. Diagnostics without
  // a `cteIndex` apply to the model as a whole and aren't shown here.
  const diagnosticsByIndex = useMemo(() => {
    const buckets = new Map<number, { errors: number; warnings: number }>();
    for (const d of diagnostics) {
      if (d.cteIndex === undefined) continue;
      const existing = buckets.get(d.cteIndex) ?? { errors: 0, warnings: 0 };
      if (d.severity === 'error') existing.errors += 1;
      else existing.warnings += 1;
      buckets.set(d.cteIndex, existing);
    }
    return buckets;
  }, [diagnostics]);

  const handleAddCte = useCallback(() => {
    const name = `cte_${(ctes?.length || 0) + 1}`;
    addCte({
      name,
      from: { model: '' },
    });
    openCteEditor(ctes?.length || 0);
  }, [addCte, ctes, openCteEditor]);

  // Confirm before deleting from the row's trash icon. The trash sits next
  // to the duplicate / edit affordances and is easy to misclick; removeCte
  // also strips every cross-reference to the deleted name, so an accidental
  // click can quietly invalidate other parts of the model.
  const [pendingDelete, setPendingDelete] = useState<{
    index: number;
    name: string;
  } | null>(null);

  const handleConfirmDelete = useCallback(() => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    removeCte(target.index);
  }, [pendingDelete, removeCte]);

  // Drag-and-drop reorder via `@hello-pangea/dnd`, mirroring the pattern
  // used by `ColumnSelectionNode`. `moveCte` already handles arbitrary
  // index moves so we can call it once per drag instead of stepping the
  // row through every intermediate position.
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const fromIndex = result.source.index;
      const toIndex = result.destination.index;
      if (fromIndex === toIndex) return;
      moveCte(fromIndex, toIndex);
    },
    [moveCte],
  );

  const cteCount = ctes?.length || 0;

  return (
    <div
      ref={nodeRootRef}
      // `nopan` -- without this React Flow grabs the pointer when the
      // user starts dragging anywhere inside the CTE list (including
      // the row's drag handle) and pans the canvas. The handle still
      // works because @hello-pangea/dnd already owns its own pointer
      // events; this just stops the canvas from also reacting.
      className="nopan relative px-2 py-3 shadow-lg rounded-lg bg-background border-2 border-neutral min-w-[420px] max-w-[480px]"
      data-tutorial-id="cte-node"
    >
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
        className="bg-muted"
      />

      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Square3Stack3DIcon className="w-5 h-5 text-foreground" />
          <div className="text-sm font-bold text-muted-foreground">
            CTEs ({cteCount})
          </div>
          {(() => {
            // Aggregated header chip: counts both per-CTE diagnostics and
            // model-wide ones (cteIndex === undefined). Lets users see
            // "this model has 2 CTE errors" at a glance without expanding.
            let totalErrors = 0;
            let totalWarnings = 0;
            for (const d of diagnostics) {
              if (d.severity === 'error') totalErrors += 1;
              else totalWarnings += 1;
            }
            return (
              <>
                {totalErrors > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs text-error"
                    title={`${totalErrors} CTE validation error${totalErrors === 1 ? '' : 's'}`}
                  >
                    <ExclamationCircleIcon className="w-3.5 h-3.5" />
                    {totalErrors}
                  </span>
                )}
                {totalWarnings > 0 && totalErrors === 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs text-warning"
                    title={`${totalWarnings} CTE warning${totalWarnings === 1 ? '' : 's'}`}
                  >
                    <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                    {totalWarnings}
                  </span>
                )}
              </>
            );
          })()}
        </div>
        <Button
          variant="outlineIconButton"
          onClick={handleAddCte}
          label="Add CTE"
          icon={<PlusIcon className="w-4 h-4" />}
          className="p-1"
        />
      </div>

      {cteCount === 0 ? (
        <div className="border border-dashed border-neutral rounded-md py-6 px-3 text-center">
          <div className="text-sm text-muted-foreground mb-2">
            No CTEs defined yet
          </div>
          <div className="text-xs text-muted-foreground">
            CTEs are inline transformations rendered as SQL{' '}
            <code className="font-mono">WITH</code> clauses. Click{' '}
            <span className="font-medium">Add CTE</span> to create one.
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="cte-list">
            {(droppableProvided) => (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className="flex flex-col gap-1 max-h-[480px] overflow-y-auto pr-1 react-flow__node-scrollable"
                onWheel={(e) => {
                  // Stop wheel from panning React Flow when user scrolls inside the list.
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                }}
              >
                {ctes.map((cte, index) => {
                  const badges = summarizeBadges(cte);
                  const counts = diagnosticsByIndex.get(index);
                  const errorCount = counts?.errors ?? 0;
                  const warningCount = counts?.warnings ?? 0;
                  const rowBorder =
                    errorCount > 0
                      ? 'border-error'
                      : warningCount > 0
                        ? 'border-warning'
                        : 'border-neutral';
                  // Reinforce invalid rows with a left bar and a precise hover
                  // hint -- mirrors the VS Code Problems-tab convention so users
                  // recognise the affordance immediately.
                  const rowAccent =
                    errorCount > 0
                      ? 'border-l-2 border-l-error'
                      : warningCount > 0
                        ? 'border-l-2 border-l-warning'
                        : '';
                  const rowTitle =
                    errorCount > 0
                      ? `${errorCount} error${errorCount === 1 ? '' : 's'} -- open to fix`
                      : warningCount > 0
                        ? `${warningCount} warning${warningCount === 1 ? '' : 's'} -- open to review`
                        : undefined;
                  const isEditing = editingCteIndex === index;
                  // Stable drag id keyed on name + index; the index segment
                  // disambiguates rows whose names happen to collide while
                  // the user is mid-rename.
                  const draggableId = `cte-${cte.name || 'unnamed'}-${index}`;
                  return (
                    <Draggable
                      key={draggableId}
                      draggableId={draggableId}
                      index={index}
                    >
                      {(draggableProvided, snapshot) => {
                        // Portal the dragging clone to <body> so it escapes
                        // React Flow's `transform: translate(...) scale(...)`
                        // wrapper. Without this, `@hello-pangea/dnd`'s
                        // `position: fixed` interacts with the parent
                        // transform and the cloned row visually drifts away
                        // from the cursor while dragging (the drop semantics
                        // still work, but the affordance is broken).
                        const node = (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            // Editing highlight uses an inset border colour +
                            // tinted background so the indicator sits inside
                            // the row's box, which keeps it visible inside
                            // the parent's `overflow-y-auto` clipping area.
                            // Border width stays at 1px (matching every
                            // other row) so toggling selection does not
                            // shift layout.
                            className={`border ${
                              isEditing
                                ? 'border-primary bg-primary/5'
                                : rowBorder
                            } ${rowAccent} rounded-md px-2 py-1.5 hover:bg-surface/50 cursor-pointer ${
                              snapshot.isDragging ? 'bg-surface shadow-lg' : ''
                            }`}
                            style={draggableProvided.draggableProps.style}
                            onClick={() => openCteEditor(index)}
                            title={rowTitle}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {/* Drag handle. Stop propagation so clicking
                                  the handle doesn't open the editor and so
                                  React Flow doesn't hijack the pointer. */}
                                <div
                                  {...draggableProvided.dragHandleProps}
                                  // `nodrag` + `nopan` -- without nopan React
                                  // Flow treats the drag handle's pointer-down
                                  // as a canvas pan, so the user's reorder
                                  // gesture also drags the entire canvas.
                                  // `nodrag` is a belt-and-suspenders against
                                  // node-drag (we also stopPropagation below).
                                  className="nodrag nopan cursor-grab active:cursor-grabbing select-none shrink-0"
                                  aria-label={`Reorder CTE ${cte.name || `cte_${index + 1}`}`}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  <Bars3Icon className="w-4 h-4 text-muted-foreground hover:text-foreground pointer-events-none" />
                                </div>
                                <span className="text-xs text-muted-foreground w-5 shrink-0">
                                  {index + 1}.
                                </span>
                                <span className="font-mono text-sm font-medium text-foreground truncate">
                                  {cte.name || `cte_${index + 1}`}
                                </span>
                                {errorCount > 0 && (
                                  <span
                                    className="flex items-center gap-0.5 text-xs text-error shrink-0"
                                    title={`${errorCount} validation error${errorCount === 1 ? '' : 's'}`}
                                  >
                                    <ExclamationCircleIcon className="w-3.5 h-3.5" />
                                    {errorCount}
                                  </span>
                                )}
                                {warningCount > 0 && errorCount === 0 && (
                                  <span
                                    className="flex items-center gap-0.5 text-xs text-warning shrink-0"
                                    title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
                                  >
                                    <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                                    {warningCount}
                                  </span>
                                )}
                              </div>
                              <div
                                className="flex items-center gap-0.5 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <HoverTooltip
                                  content="Edit CTE"
                                  placement="top"
                                >
                                  <Button
                                    variant="iconButton"
                                    aria-label="Edit CTE"
                                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface"
                                    icon={
                                      <PencilSquareIcon className="w-4 h-4" />
                                    }
                                    onClick={() => openCteEditor(index)}
                                  />
                                </HoverTooltip>
                                <HoverTooltip
                                  content="Duplicate CTE"
                                  placement="top"
                                >
                                  <Button
                                    variant="iconButton"
                                    aria-label="Duplicate CTE"
                                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface"
                                    icon={
                                      <DocumentDuplicateIcon className="w-4 h-4" />
                                    }
                                    onClick={() => duplicateCte(index)}
                                  />
                                </HoverTooltip>
                                <HoverTooltip
                                  content="Remove CTE"
                                  placement="top"
                                >
                                  <Button
                                    variant="iconButton"
                                    aria-label="Remove CTE"
                                    className="p-1 text-muted-foreground hover:text-error hover:bg-surface"
                                    icon={<TrashIcon className="w-4 h-4" />}
                                    onClick={() =>
                                      setPendingDelete({
                                        index,
                                        name: cte.name || `cte_${index + 1}`,
                                      })
                                    }
                                  />
                                </HoverTooltip>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-0.5 pl-11">
                              <span className="text-xs text-muted-foreground truncate">
                                {summarizeFrom(cte.from)}
                              </span>
                              {badges && (
                                <span className="text-xs text-muted-foreground/80 ml-2 shrink-0">
                                  {badges}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                        return snapshot.isDragging
                          ? createPortal(node, document.body)
                          : node;
                      }}
                    </Draggable>
                  );
                })}
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
        className="bg-muted"
      />

      {/* On-canvas CTE editor popover. Renders only when a CTE is open for
          editing; anchors to the right of the entire CTE node so it doesn't
          get clipped by the scroll container of individual rows. */}
      {editingCteIndex !== null && <CteEditorPanel anchorRef={nodeRootRef} />}

      <DialogBox
        open={pendingDelete !== null}
        variant="warning"
        title="Remove CTE?"
        description={
          pendingDelete
            ? `Remove CTE "${pendingDelete.name}"? This will also strip every reference to it across the model.`
            : ''
        }
        confirmCTALabel="Remove"
        discardCTALabel="Cancel"
        onConfirm={handleConfirmDelete}
        onDiscard={() => setPendingDelete(null)}
      />
    </div>
  );
};
