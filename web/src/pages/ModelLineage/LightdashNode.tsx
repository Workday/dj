import {
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  RectangleGroupIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';

import type { LightdashNodeData } from './types';

// A single chart row inside the popover can be in one of three states,
// derived from `embeddedAsTile` + `hasYaml` on the row payload. Each
// state has a leading icon (rendered in place of the legacy cyan dot)
// and a tooltip; the footer legend at the bottom of the popover keeps
// the encoding decodable without hovering each row.
type ChartRowState = 'visible' | 'hidden' | 'missing';

const ROW_STATE: Record<
  ChartRowState,
  {
    label: string;
    Icon: typeof EyeIcon;
    iconClass: string;
    tooltip: string;
  }
> = {
  visible: {
    label: 'Visible',
    Icon: EyeIcon,
    iconClass: 'text-cyan-700 dark:text-cyan-400',
    tooltip: 'Displayed as a tile on this dashboard',
  },
  hidden: {
    label: 'Hidden',
    Icon: EyeSlashIcon,
    iconClass: 'text-surface-contrast opacity-60',
    tooltip:
      'Saved within this dashboard but not displayed as a tile (drilled view or detached chart)',
  },
  missing: {
    label: 'Missing',
    Icon: ExclamationTriangleIcon,
    iconClass: 'text-amber-700 dark:text-amber-400',
    tooltip:
      'Referenced by this dashboard but no local chart YAML found (chart may have been removed)',
  },
};

// Sort priority for chart rows inside the popover. Visible rows lead so
// the dashboard's actual contents are read first; hidden rows follow
// (saved-within-dashboard); missing rows sink to the bottom so stale
// references don't push real content out of view in tall dashboards.
const STATE_PRIORITY: Record<ChartRowState, number> = {
  visible: 0,
  hidden: 1,
  missing: 2,
};

const getRowState = (chart: {
  embeddedAsTile?: boolean;
  hasYaml?: boolean;
}): ChartRowState => {
  if (chart.hasYaml === false) return 'missing';
  if (chart.embeddedAsTile === false) return 'hidden';
  return 'visible';
};

const KIND_LABEL: Record<LightdashNodeData['kind'], string> = {
  dashboard: 'Dashboard',
  'standalone-charts': 'Standalone Charts',
};

// Per-kind accent colors. The icon container is tinted so the kind reads
// at a glance even before the header text is parsed. Light-mode and
// dark-mode pairings are tuned separately: light uses a saturated `*-100`
// fill with a darker `*-700` glyph for contrast against the card; dark
// uses a softer `*-600/15` tint that blends with the surface.
const KIND_STYLES: Record<
  LightdashNodeData['kind'],
  { iconContainer: string; icon: string }
> = {
  dashboard: {
    iconContainer:
      'bg-purple-100 border-purple-300 dark:bg-purple-600/15 dark:border-purple-600/40',
    icon: 'text-purple-700 dark:text-purple-400',
  },
  // Cyan accent so a "Standalone Charts" container reads as charts-grouped,
  // visually distinct from the purple dashboard accent.
  'standalone-charts': {
    iconContainer:
      'bg-cyan-100 border-cyan-300 dark:bg-cyan-600/15 dark:border-cyan-600/40',
    icon: 'text-cyan-700 dark:text-cyan-400',
  },
};

const KIND_ICON: Record<LightdashNodeData['kind'], typeof Squares2X2Icon> = {
  dashboard: Squares2X2Icon,
  'standalone-charts': RectangleGroupIcon,
};

export default function LightdashNode({ data }: { data: LightdashNodeData }) {
  const { name, kind, url, charts, filePath, onOpen, onOpenYaml } = data;
  // Per-row state encoding (visible / hidden / missing) only makes sense
  // inside a dashboard's popover, where each chart has a defined
  // relationship to the dashboard. Standalone-charts containers list
  // charts that don't belong to any dashboard, so a "Visible on this
  // dashboard" tooltip would be misleading and `hidden` / `missing`
  // can't occur (orphan rows are pre-filtered to those with local
  // YAML). We render those rows with the original simple bullet and
  // skip the legend entirely.
  const showStateUi = kind === 'dashboard';
  // Stable-sort chart rows by state priority so visible rows lead, hidden
  // follows, and missing references sink to the bottom. `Array.sort` is
  // stable as of ES2019, which preserves backend ordering (dashboard YAML
  // tile order, then alphabetical for saved-within charts) within each
  // state bucket. Skipped for standalone-charts where every row is in
  // the same effective state and backend ordering is already final.
  const renderedCharts = charts
    ? showStateUi
      ? [...charts].sort(
          (a, b) =>
            STATE_PRIORITY[getRowState(a)] - STATE_PRIORITY[getRowState(b)],
        )
      : charts
    : undefined;
  const chartCount = renderedCharts?.length ?? 0;
  const hasCharts = chartCount > 0;
  // Aggregate header buttons (Open YAML / Open in Lightdash) only make
  // sense when there's a single underlying target. Standalone-charts
  // containers expose those actions per row in the popover instead.
  const hasAggregateActions = kind !== 'standalone-charts';
  const [expanded, setExpanded] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const KindIcon = KIND_ICON[kind];
  const kindStyle = KIND_STYLES[kind];

  // Dismiss the floating chart popover on outside click / Escape so it never
  // gets stranded over the canvas.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (url) {
      onOpen(url);
    }
  };

  const handleOpenYaml = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath) {
      onOpenYaml(filePath);
    }
  };

  const handleToggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  };

  const chipExpandTitle = (() => {
    if (expanded) return 'Hide chart list';
    const noun = chartCount === 1 ? 'chart' : 'charts';
    return kind === 'standalone-charts'
      ? `Show ${chartCount} ${noun} for this model`
      : `Show ${chartCount} ${noun} in this dashboard`;
  })();

  return (
    <div className="bg-card border border-neutral rounded-lg w-[320px] shadow-sm hover:shadow-md hover:border-neutral-hover transition-all relative">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-2.5 h-2.5 !bg-neutral !border-2 !border-card"
      />

      {/* Header: icon + name */}
      <div className="px-3 py-2.5 flex items-center gap-2.5">
        <div
          className={`flex-shrink-0 w-8 h-8 rounded border flex items-center justify-center ${kindStyle.iconContainer}`}
        >
          <KindIcon className={`w-4 h-4 ${kindStyle.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="font-mono font-semibold text-xs text-foreground break-words leading-tight"
            title={name}
          >
            {name}
          </div>
        </div>
      </div>

      {/* Footer: Lightdash chip + N Charts chip + actions */}
      <div className="px-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="font-mono text-[10px] px-2 py-0.5 rounded border font-medium bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-600/20 dark:text-purple-400 dark:border-purple-600/40 flex-shrink-0"
            title={KIND_LABEL[kind]}
          >
            Lightdash
          </span>
          {hasCharts && (
            <button
              ref={triggerRef}
              onClick={handleToggleExpanded}
              className="nodrag font-mono text-[10px] px-2 py-0.5 rounded border bg-surface border-neutral text-surface-contrast hover:text-foreground hover:bg-card transition-colors inline-flex items-center gap-1 flex-shrink-0"
              title={chipExpandTitle}
              aria-expanded={expanded}
            >
              {chartCount} {chartCount === 1 ? 'Chart' : 'Charts'}
              {/* Chevron points right when collapsed (popover opens to the
                  right) and rotates to point back at the popover when open. */}
              <ChevronRightIcon
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
        {hasAggregateActions && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={handleOpenYaml}
              disabled={!filePath}
              className="p-1 rounded hover:bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                filePath
                  ? `Open ${filePath}`
                  : 'Source YAML file path is unknown'
              }
            >
              <DocumentTextIcon className="w-4 h-4 text-surface-contrast" />
            </button>
            <button
              onClick={handleOpen}
              disabled={!url}
              className="p-1 rounded hover:bg-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                url
                  ? 'Open dashboard in Lightdash'
                  : 'Set the LIGHTDASH_URL and LIGHTDASH_PROJECT environment variables to enable this link'
              }
            >
              <ArrowTopRightOnSquareIcon className="w-4 h-4 text-surface-contrast" />
            </button>
          </div>
        )}
      </div>

      {/* Floating chart-list popover, anchored to the right of the node so
          it floats into the empty canvas next to the dashboard column
          rather than overlapping sibling nodes below. Absolutely positioned
          so it does not contribute to the node's measured size. React Flow
          escape hatches: `nodrag` / `nopan` keep clicks and drags inside
          the popover; `nowheel` keeps wheel-scroll inside the chart list
          rather than zooming the canvas. */}
      {hasCharts && expanded && (
        <div
          ref={popoverRef}
          className="nodrag nopan nowheel absolute top-0 left-full ml-2 z-20 w-72 bg-card border border-neutral rounded-lg shadow-xl overflow-hidden"
          role="dialog"
          aria-label={`${chartCount} charts`}
        >
          {/* Diamond caret pointing back at the trigger chip on the parent
              node. Border-bottom + border-left + 45deg rotation produce a
              card-colored arrow flush against the popover's left edge. */}
          <div
            aria-hidden
            className="absolute top-3 -left-1.5 w-3 h-3 bg-card border-b border-l border-neutral -rotate-45"
          />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-wider text-surface-contrast px-3 pt-2 pb-1 border-b border-neutral">
              Charts ({chartCount})
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y divide-neutral">
              {renderedCharts!.map((chart) => {
                // Standalone-charts rows skip the state machinery entirely
                // (see `showStateUi` derivation above) and render with the
                // simple bullet + always-on action buttons.
                const state = showStateUi ? getRowState(chart) : null;
                const stateMeta = state ? ROW_STATE[state] : null;
                const StateIcon = stateMeta?.Icon;
                const isMissing = state === 'missing';
                return (
                  <li
                    key={chart.slug}
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface transition-colors"
                    title={chart.slug}
                  >
                    {StateIcon && stateMeta ? (
                      <StateIcon
                        className={`w-3.5 h-3.5 flex-shrink-0 ${stateMeta.iconClass}`}
                        aria-label={stateMeta.tooltip}
                        title={stateMeta.tooltip}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="w-1.5 h-1.5 rounded-full bg-cyan-600 dark:bg-cyan-400 flex-shrink-0"
                      />
                    )}
                    <span
                      className={`flex-1 min-w-0 text-[11px] break-words leading-snug ${
                        isMissing
                          ? 'italic text-surface-contrast'
                          : 'text-foreground'
                      }`}
                    >
                      {chart.name}
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
                      {/* Open YAML is hidden for `missing` rows: there is
                          no local YAML file to open. */}
                      {!isMissing && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (chart.filePath) onOpenYaml(chart.filePath);
                          }}
                          disabled={!chart.filePath}
                          className="p-1 rounded hover:bg-card transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            chart.filePath
                              ? `Open ${chart.filePath}`
                              : 'Source YAML file path is unknown'
                          }
                        >
                          <DocumentTextIcon className="w-3.5 h-3.5 text-surface-contrast" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (chart.url) onOpen(chart.url);
                        }}
                        disabled={!chart.url}
                        className="p-1 rounded hover:bg-card transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          chart.url
                            ? isMissing
                              ? 'Open in Lightdash (chart may have been removed)'
                              : 'Open chart in Lightdash'
                            : 'Set the LIGHTDASH_URL and LIGHTDASH_PROJECT environment variables to enable this link'
                        }
                      >
                        <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 text-surface-contrast" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Legend lives inside the `nowheel` popover so it stays
                glued to the chart list and never competes with the
                canvas for scroll. Only rendered for dashboard popovers
                where the leading icons actually encode state. */}
            {showStateUi && (
              <div
                aria-hidden
                className="flex items-center justify-center gap-3 px-3 py-1.5 border-t border-neutral text-[10px] text-surface-contrast opacity-70"
              >
                {(['visible', 'hidden', 'missing'] as const).map((state) => {
                  const meta = ROW_STATE[state];
                  const Icon = meta.Icon;
                  return (
                    <span
                      key={state}
                      className="flex items-center gap-1"
                      title={meta.tooltip}
                    >
                      <Icon
                        className={`w-3 h-3 ${meta.iconClass}`}
                        aria-label={meta.tooltip}
                      />
                      {meta.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
