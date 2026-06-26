import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import type { LightdashAssetSummary } from '@shared/modellineage/types';
import { makeClassName } from '@web';
import { useApp, useEnvironment } from '@web/context';
import { Banner, Button, SelectSingle, Spinner } from '@web/elements';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';

import {
  type ReverseLineageData,
  useReverseLineageStore,
} from '../../stores/useReverseLineageStore';
import ReverseLineageGraph from './ReverseLineageGraph';

type AssetOption = { label: string; value: string };

/** Picker filter segments. */
type AssetFilter = 'All' | 'Dashboards' | 'Charts' | 'Standalone';
const FILTER_OPTIONS: AssetFilter[] = [
  'All',
  'Dashboards',
  'Charts',
  'Standalone',
];

const KIND_BADGE: Record<
  'dashboard' | 'chart',
  { label: string; Icon: typeof Squares2X2Icon; className: string }
> = {
  dashboard: {
    label: 'Dashboard',
    Icon: Squares2X2Icon,
    className:
      'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-600/20 dark:text-purple-400 dark:border-purple-600/40',
  },
  chart: {
    label: 'Chart',
    Icon: ChartBarIcon,
    className:
      'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-600/20 dark:text-blue-400 dark:border-blue-600/40',
  },
};

/** Leading kind pill rendered in front of each picker option. */
function KindBadge({ kind }: { kind: 'dashboard' | 'chart' }) {
  const { label, Icon, className } = KIND_BADGE[kind];
  return (
    <span
      className={makeClassName(
        'flex-shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
        className,
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

/**
 * Second (muted) line of a picker option: chart membership (`in <Dashboard>`
 * / `Standalone`) or a dashboard's chart count.
 */
function assetSubLine(asset: LightdashAssetSummary): string {
  if (asset.kind === 'dashboard') {
    const n = asset.chartCount ?? 0;
    return `${n} ${n === 1 ? 'chart' : 'charts'}`;
  }
  const dashboards = asset.dashboardNames ?? [];
  if (dashboards.length === 0) {
    return 'Standalone';
  }
  if (dashboards.length === 1) {
    return `in ${dashboards[0]}`;
  }
  return `in ${dashboards[0]} +${dashboards.length - 1}`;
}

/** Compact segmented filter for the floating toolbar (replaces the bulky ButtonGroup). */
function FilterSegments({
  value,
  onChange,
}: {
  value: AssetFilter;
  onChange: (value: AssetFilter) => void;
}) {
  return (
    <div className="inline-flex h-10 items-stretch rounded-md bg-surface p-1">
      {FILTER_OPTIONS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={makeClassName(
              'inline-flex items-center rounded px-3 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-contrast shadow'
                : 'text-background-contrast/70 hover:text-background-contrast',
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** Encode/decode an asset (kind + slug) into the SelectSingle option value. */
const encodeAsset = (kind: 'dashboard' | 'chart', slug: string) =>
  `${kind}::${slug}`;
const decodeAsset = (
  value: string,
): { kind: 'dashboard' | 'chart'; slug: string } | null => {
  const idx = value.indexOf('::');
  if (idx < 0) return null;
  const kind = value.slice(0, idx);
  const slug = value.slice(idx + 2);
  if (kind !== 'dashboard' && kind !== 'chart') return null;
  return { kind, slug };
};

export function LightdashReverseLineage() {
  const { api } = useApp();
  const { vscode } = useEnvironment();
  const {
    data,
    isLoading,
    error,
    anchorRef,
    assets,
    isLoadingAssets,
    assetsError,
    lightdashAvailable,
    lightdashResolvedPath,
    setApiHandler,
    fetchAssets,
    fetchReverseLineage,
    clearLineage,
    openDashboardsAsCode,
    refreshProjects,
  } = useReverseLineageStore();

  const [selected, setSelected] = useState<AssetOption | null>(null);
  const [filter, setFilter] = useState<AssetFilter>('All');
  // Drives the Refresh button's busy affordance for the whole compound op
  // (re-scan assets, then reload the anchor) so the click registers instantly
  // and stays busy through both backend round-trips.
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Wire the API handler before any fetches fire.
  useEffect(() => {
    setApiHandler(api.post);
  }, [api.post, setApiHandler]);

  // Load the asset list for the picker once the handler is ready.
  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Consume the anchor pushed from the command / click-through, and signal
  // readiness so the extension flushes any buffered anchor.
  useEffect(() => {
    if (!vscode) return;

    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message?._channelId) return; // API responses handled elsewhere
      if (message?.type === 'reverse-lineage-init') {
        const { kind, slug } = message;
        if (
          (kind === 'dashboard' || kind === 'chart') &&
          typeof slug === 'string'
        ) {
          setSelected({ label: slug, value: encodeAsset(kind, slug) });
          void fetchReverseLineage({ kind, slug });
        }
      }
    };

    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'reverse-lineage-ready' });
    return () => window.removeEventListener('message', handler);
  }, [vscode, fetchReverseLineage]);

  // Keep the picker label in sync with the resolved anchor name.
  useEffect(() => {
    if (data?.anchor && anchorRef) {
      setSelected({
        label: data.anchor.name,
        value: encodeAsset(anchorRef.kind, anchorRef.slug),
      });
    }
  }, [data?.anchor, anchorRef]);

  // Lookup over ALL assets (not just the filtered view) so a selected anchor
  // outside the current filter still resolves its badge + sub-line.
  const assetByValue = useMemo(
    () => new Map(assets.map((a) => [encodeAsset(a.kind, a.slug), a] as const)),
    [assets],
  );

  const visibleAssets = useMemo(
    () =>
      assets.filter((a) => {
        switch (filter) {
          case 'Dashboards':
            return a.kind === 'dashboard';
          case 'Charts':
            return a.kind === 'chart';
          case 'Standalone':
            return a.kind === 'chart' && !a.dashboardNames?.length;
          default:
            return true;
        }
      }),
    [assets, filter],
  );

  const options = useMemo<AssetOption[]>(
    () =>
      visibleAssets.map((asset) => ({
        label: asset.name,
        value: encodeAsset(asset.kind, asset.slug),
      })),
    [visibleAssets],
  );

  // Two-line option: kind badge + name on top, membership / chart-count
  // beneath. The leading badge replaces the old "· chart" suffix; the
  // sub-line surfaces dashboard membership without widening the row.
  const renderAssetOption = (option: AssetOption, isSelected: boolean) => {
    const asset = assetByValue.get(option.value);
    const kind = asset?.kind ?? decodeAsset(option.value)?.kind ?? 'chart';
    const subLine = asset ? assetSubLine(asset) : '';
    const fullList =
      asset?.kind === 'chart' && asset.dashboardNames?.length
        ? `In: ${asset.dashboardNames.join(', ')}`
        : undefined;
    return (
      <div className="flex items-center gap-2 min-w-0">
        <KindBadge kind={kind} />
        <div className="min-w-0">
          <div
            className={makeClassName('truncate', isSelected && 'font-semibold')}
          >
            {option.label}
          </div>
          {subLine && (
            <div
              className="truncate text-xs text-background-contrast/60"
              title={fullList}
            >
              {subLine}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handlePick = (option: AssetOption | null) => {
    setSelected(option);
    if (!option) return;
    const decoded = decodeAsset(option.value);
    if (decoded) {
      void fetchReverseLineage(decoded);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      // Always re-scan the content directory so newly downloaded (or removed)
      // assets show up in the picker.
      await fetchAssets(true);
      const current = anchorRef;
      if (!current) {
        return;
      }
      // Reload the selected anchor only if it survived the re-scan; otherwise
      // drop the now-missing selection and its graph.
      const stillPresent = useReverseLineageStore
        .getState()
        .assets.some((a) => a.kind === current.kind && a.slug === current.slug);
      if (stillPresent) {
        await fetchReverseLineage(current);
      } else {
        clearLineage();
        setSelected(null);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const hasNoModels =
    !!data &&
    data.manifestAvailable &&
    data.models.length === 0 &&
    data.staleModels.length === 0;

  return (
    <div className="flex flex-col h-screen w-full bg-background text-background-contrast">
      {/* Body fills the panel; the toolbar floats over it (no header bar). */}
      <div className="flex-1 min-h-0 relative">
        {/* Floating toolbar: filter segments -> asset picker -> reload */}
        <div
          className="nopan nowheel absolute left-3 top-3 z-20 flex items-center gap-3 rounded border border-neutral bg-card p-2 shadow"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {assets.length > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-background-contrast/60">
                  Filter
                </span>
                <FilterSegments value={filter} onChange={setFilter} />
              </div>
              <div className="h-6 w-px border-l border-neutral" />
            </>
          )}
          <div className="w-96">
            <SelectSingle
              options={options}
              value={selected}
              onChange={handlePick}
              onBlur={() => undefined}
              renderOptionLabel={(o, state) =>
                renderAssetOption(o, state.selected)
              }
              placeholder={
                isLoadingAssets
                  ? 'Loading dashboards & charts…'
                  : 'Select a dashboard or chart…'
              }
              disabled={isLoadingAssets}
              virtualized
              filterDebounceMs={150}
            />
          </div>
          <div className="h-6 w-px border-l border-neutral" />
          <Button
            variant="iconButton"
            disabled={isRefreshing}
            icon={
              <ArrowPathIcon
                className={makeClassName(
                  'w-4 h-4',
                  isRefreshing && 'animate-spin',
                )}
              />
            }
            title={
              isRefreshing
                ? 'Re-scanning content…'
                : anchorRef
                  ? 'Re-scan content & reload lineage'
                  : 'Re-scan for downloaded Lightdash content'
            }
            onClick={() => void handleRefresh()}
          />
          {assetsError && !isRefreshing && (
            <>
              <div className="h-6 w-px border-l border-neutral" />
              <div
                className="flex items-center gap-1.5 text-xs text-error max-w-[14rem]"
                title={assetsError}
              >
                <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Refresh failed</span>
              </div>
            </>
          )}
          {lightdashResolvedPath && (
            <>
              <div className="h-6 w-px border-l border-neutral" />
              <div
                className="flex items-center gap-1.5 text-xs text-background-contrast/60"
                title={
                  `Lineage is computed from the Lightdash content under "${lightdashResolvedPath}" ` +
                  `(the dj.lightdash.dashboardsAsCodePath setting). Download to a different folder, ` +
                  `or set a new default path in the Dashboards as Code panel, to view another project.`
                }
              >
                <FolderIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[14rem]">
                  Lineage from{' '}
                  <span className="font-medium text-background-contrast/80">
                    {lightdashResolvedPath}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner size={24} />
          </div>
        )}

        {/* Re-scan overlay: sits above the (still-mounted) graph but below the
            z-20 toolbar, so the spinning Refresh button stays visible. Covers
            the gap before the late isLoading spinner of the anchor reload. */}
        {isRefreshing && !isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2">
              <Spinner size={24} />
              <span className="text-xs text-background-contrast/70">
                Re-scanning Lightdash content…
              </span>
            </div>
          </div>
        )}

        {!isLoading && error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md text-center text-sm text-error">
              {error}
            </div>
          </div>
        )}

        {/* Pre-selection states: nothing resolved yet. Show a spinner while
            the asset list is still scanning, the download prompt when no
            content exists, otherwise the "pick one" hint. */}
        {!isLoading && !error && !data && (
          <>
            {isLoadingAssets && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner size={24} />
              </div>
            )}
            {!isLoadingAssets && !lightdashAvailable && (
              <NotDownloadedBanner
                resolvedPath={lightdashResolvedPath}
                onOpenDashboardsAsCode={() => void openDashboardsAsCode()}
              />
            )}
            {!isLoadingAssets && lightdashAvailable && <EmptyHint />}
          </>
        )}

        {!isLoading && !error && data && (
          <ReverseLineageContent
            data={data}
            hasNoModels={hasNoModels}
            onOpenDashboardsAsCode={() => void openDashboardsAsCode()}
            onRefreshProjects={() => void refreshProjects()}
          />
        )}
      </div>
    </div>
  );
}

/** Initial state before any asset is selected. */
function EmptyHint() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Squares2X2Icon className="w-10 h-10 mx-auto text-neutral mb-3" />
        <p className="text-sm text-background-contrast/80">
          Select a Lightdash dashboard or chart above to see the upstream dbt
          models it depends on.
        </p>
      </div>
    </div>
  );
}

function ReverseLineageContent({
  data,
  hasNoModels,
  onOpenDashboardsAsCode,
  onRefreshProjects,
}: {
  data: ReverseLineageData;
  hasNoModels: boolean;
  onOpenDashboardsAsCode: () => void;
  onRefreshProjects: () => void;
}) {
  // Prerequisite states, in priority order.
  if (!data.lightdashAvailable) {
    return (
      <NotDownloadedBanner
        resolvedPath={data.lightdashResolvedPath}
        onOpenDashboardsAsCode={onOpenDashboardsAsCode}
      />
    );
  }

  if (!data.manifestAvailable) {
    return (
      <CenteredBanner>
        <Banner
          layout="card"
          variant="warning"
          icon={<ExclamationTriangleIcon className="w-5 h-5" />}
          title="dbt project not parsed yet"
          actions={
            <Button
              variant="secondary"
              label="Refresh Projects"
              onClick={onRefreshProjects}
            />
          }
        >
          {`Upstream models come from the dbt manifest, which hasn't been ` +
            `built yet. Run a dbt parse, then refresh.` +
            (data.staleModels.length > 0
              ? `\n\nReferenced by this ${data.anchor.kind}: ${data.staleModels.join(
                  ', ',
                )}`
              : '')}
        </Banner>
      </CenteredBanner>
    );
  }

  if (hasNoModels) {
    return (
      <CenteredBanner>
        <Banner
          layout="card"
          variant="info"
          icon={<Squares2X2Icon className="w-5 h-5" />}
          title="No referenced models"
        >
          {`This ${data.anchor.kind} doesn't reference any dbt models that the framework can resolve.`}
        </Banner>
      </CenteredBanner>
    );
  }

  return (
    <ReactFlowProvider>
      <ReverseLineageGraph />
    </ReactFlowProvider>
  );
}

/** Centers a card-layout Banner inside the (relative) body container. */
function CenteredBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      {children}
    </div>
  );
}

/**
 * Prompt shown when the local Lightdash content directory is missing/empty.
 * Reused at the page level (before any asset is selected) and inside a
 * resolved payload, so both entry points stay in sync.
 */
function NotDownloadedBanner({
  resolvedPath,
  onOpenDashboardsAsCode,
}: {
  resolvedPath: string;
  onOpenDashboardsAsCode: () => void;
}) {
  return (
    <CenteredBanner>
      <Banner
        layout="card"
        variant="warning"
        icon={<ArrowDownTrayIcon className="w-5 h-5" />}
        title="No Lightdash content found"
        actions={
          <Button
            variant="secondary"
            label="Open Dashboards as Code"
            onClick={onOpenDashboardsAsCode}
          />
        }
      >
        {`No dashboards or charts were found at ${
          resolvedPath || 'the configured path'
        }. Download them with Dashboards as Code first.`}
      </Banner>
    </CenteredBanner>
  );
}
