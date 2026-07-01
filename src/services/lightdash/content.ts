import {
  applyGitignoreEntry,
  type LightdashChartContent,
  type LightdashDashboardContent,
  parseChartDoc,
  parseDashboardDoc,
  resolveModelFromFieldId,
} from '@services/lightdash/contentParser';
import {
  getDashboardsAsCodeAbsolutePath,
  getDashboardsAsCodeRelativePath,
} from '@services/lightdash/dashboardsAsCode';
import type {
  LightdashAssetSummary,
  LightdashLineageNode,
} from '@shared/modellineage/types';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';

export type {
  LightdashChartContent,
  LightdashDashboardContent,
} from '@services/lightdash/contentParser';

interface DownstreamEntry {
  dashboards: Set<string>;
  /** Charts that don't appear inside any dashboard tile. */
  orphanCharts: Set<string>;
}

interface ContentLogger {
  debug?: (msg: string, ...args: unknown[]) => void;
  info?: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

const TOGGLE_SETTING = 'dataExplorer.showLightdashLineage';
const PATH_SETTING = 'lightdash.dashboardsAsCodePath';
/** Mirrors `dj.syncDebounceMs` style, prevents thrash during git checkouts. */
const REBUILD_DEBOUNCE_MS = 1500;

/**
 * Parses Lightdash Dashboards-as-Code YAML and exposes a downstream lookup
 * for the Model Lineage view. Activation is gated by the user-opt-in
 * setting `dj.dataExplorer.showLightdashLineage` so users who don't use
 * Lightdash incur zero overhead.
 */
export class LightdashContent {
  private readonly log: ContentLogger;
  private chartsBySlug: Map<string, LightdashChartContent> = new Map();
  private dashboardsBySlug: Map<string, LightdashDashboardContent> = new Map();
  private modelDownstream: Map<string, DownstreamEntry> = new Map();
  /**
   * For each dashboard, the subset of `chartSlugs` that originate from
   * `tiles[]` in the dashboard YAML. Charts that are only associated via
   * the chart's own `dashboardSlug` field (saved-within-dashboard) are
   * NOT in this set, which lets the lineage UI flag them so users
   * understand why a chart appears in the popover but not on the
   * dashboard itself.
   */
  private tileEmbeddedChartSlugs: Map<string, Set<string>> = new Map();
  /**
   * Reverse index: chart slug -> dashboard slugs that reference it (via a
   * tile or the saved-within splice). Built in `doRebuild`; powers the
   * picker's "in <dashboard>" membership hint and the reverse-lineage
   * graph's parent-dashboard nodes.
   */
  private chartToDashboards: Map<string, Set<string>> = new Map();
  private watcher?: vscode.FileSystemWatcher;
  private rebuildTimer?: NodeJS.Timeout;
  private configSubscription?: vscode.Disposable;
  private resolvedAbsolutePath?: string;
  private populated = false;
  /**
   * In-flight rescan, so concurrent triggers (the file watcher and an
   * on-demand `ensurePopulated`) coalesce into a single run rather than
   * clobbering each other's freshly-reset maps.
   */
  private rebuildInFlight?: Promise<void>;
  /**
   * Supplies the set of known dbt model names, used to resolve charts
   * that lack an explicit `metricQuery.exploreName` (longest-prefix match
   * against the field id). Injected lazily by the Coder so it reflects the
   * currently-loaded manifest; optional so unit tests can construct the
   * service without a dbt service (resolution simply falls back to null).
   */
  private readonly getKnownModelNames?: () => ReadonlySet<string>;

  constructor(
    log: ContentLogger,
    getKnownModelNames?: () => ReadonlySet<string>,
  ) {
    this.log = log;
    this.getKnownModelNames = getKnownModelNames;
  }

  activate(context: vscode.ExtensionContext): void {
    if (this.isToggleEnabled()) {
      void this.rebuild();
      this.installWatcher();
    }

    this.configSubscription = vscode.workspace.onDidChangeConfiguration(
      (event) => {
        if (event.affectsConfiguration(`dj.${TOGGLE_SETTING}`)) {
          this.handleToggleChanged();
        } else if (event.affectsConfiguration(`dj.${PATH_SETTING}`)) {
          // Path moved underneath us - tear down and rebuild against the
          // new location so stale watchers don't fire on the old folder.
          this.disposeWatcher();
          if (this.isToggleEnabled()) {
            void this.rebuild();
            this.installWatcher();
          }
        }
      },
    );
    context.subscriptions.push(this.configSubscription);
  }

  deactivate(): void {
    this.disposeWatcher();
    this.configSubscription?.dispose();
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = undefined;
    }
  }

  /**
   * Retrieve downstream Lightdash dependencies for a dbt model. Returns
   * empty arrays when the model has no charts/dashboards or when the
   * service is disabled / not yet populated.
   */
  getDownstream(modelName: string): {
    dashboards: LightdashLineageNode[];
    charts: LightdashLineageNode[];
  } {
    const entry = this.modelDownstream.get(modelName);
    if (!entry) {
      return { dashboards: [], charts: [] };
    }

    const { lightdashUrl, projectUuid, linkable } = this.getLinkContext();
    const buildChartRow = (chartSlug: string, parentDashboardSlug?: string) =>
      this.buildChartRow(chartSlug, parentDashboardSlug);

    const dashboards: LightdashLineageNode[] = [];
    for (const slug of entry.dashboards) {
      const dashboard = this.dashboardsBySlug.get(slug);
      if (!dashboard) {
        continue;
      }
      dashboards.push({
        id: `lightdash::dashboard::${slug}`,
        slug,
        name: dashboard.name || slug,
        kind: 'dashboard',
        url: linkable
          ? `${lightdashUrl}/projects/${projectUuid}/dashboards/${slug}/view`
          : undefined,
        charts: dashboard.chartSlugs.map((cs) => buildChartRow(cs, slug)),
        filePath: dashboard.filePath,
      });
    }

    // Orphan charts (saved charts not embedded in any dashboard) collapse
    // into a single synthetic container per mart so a model with many
    // one-off charts doesn't explode the canvas into tiny nodes. The
    // container exposes no aggregate URL / YAML file - per-row buttons
    // in the popover open each chart individually.
    const charts: LightdashLineageNode[] = [];
    const orphanRows = Array.from(entry.orphanCharts)
      .filter((slug) => this.chartsBySlug.has(slug))
      .map((slug) => buildChartRow(slug));
    if (orphanRows.length > 0) {
      orphanRows.sort((a, b) => a.name.localeCompare(b.name));
      charts.push({
        id: `lightdash::standalone-charts::${modelName}`,
        slug: `${modelName}::standalone-charts`,
        name: 'Standalone Charts',
        kind: 'standalone-charts',
        filePath: '',
        charts: orphanRows,
      });
    }

    dashboards.sort((a, b) => a.name.localeCompare(b.name));
    return { dashboards, charts };
  }

  /* ------------------------------------------------------------------ */
  /* Reverse lookups (Dashboard / Chart -> upstream models)             */
  /* ------------------------------------------------------------------ */

  /**
   * Rebuild only when not already populated. The reverse-lineage view is
   * an explicit user action, so it works even when the forward toggle
   * `dj.dataExplorer.showLightdashLineage` is off (which is why the
   * forward-path watcher hasn't populated the index).
   */
  async ensurePopulated(): Promise<void> {
    if (this.populated) {
      return;
    }
    await this.rebuild();
  }

  /**
   * All parsed dashboards + charts, summarized for the reverse-lineage
   * picker / search. `modelNames` is the distinct set of dbt models each
   * asset references, shown in the picker so users can disambiguate
   * same-named assets. Sorted by name (then kind) for a stable picker.
   */
  listAssets(): LightdashAssetSummary[] {
    const assets: LightdashAssetSummary[] = [];
    for (const dashboard of this.dashboardsBySlug.values()) {
      const modelNames = new Set<string>();
      for (const chartSlug of dashboard.chartSlugs) {
        const modelName = this.chartsBySlug.get(chartSlug)?.modelName;
        if (modelName) {
          modelNames.add(modelName);
        }
      }
      assets.push({
        kind: 'dashboard',
        slug: dashboard.slug,
        name: dashboard.name || dashboard.slug,
        modelNames: Array.from(modelNames).sort(),
        chartCount: dashboard.chartSlugs.length,
      });
    }
    for (const chart of this.chartsBySlug.values()) {
      assets.push({
        kind: 'chart',
        slug: chart.slug,
        name: chart.name || chart.slug,
        modelNames: chart.modelName ? [chart.modelName] : [],
        dashboardNames: this.parentDashboardSlugs(chart.slug)
          .map((ds) => this.dashboardsBySlug.get(ds)?.name || ds)
          .sort((a, b) => a.localeCompare(b)),
      });
    }
    // Dashboards first, then charts, each alphabetical by name. Badges in
    // the picker reinforce the kind; this ordering surfaces dashboards (the
    // smaller, higher-level set) above the long tail of charts.
    const rank = (k: 'dashboard' | 'chart') => (k === 'dashboard' ? 0 : 1);
    assets.sort(
      (a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name),
    );
    return assets;
  }

  /**
   * Dashboard slugs that contain `chartSlug`: those that reference it via a
   * tile or the saved-within splice (`chartToDashboards`), unioned with the
   * chart's own `dashboardSlug` (covers the case where the parent dashboard
   * YAML was not downloaded locally, so the splice never ran). Empty when
   * the chart belongs to no dashboard (standalone).
   */
  private parentDashboardSlugs(chartSlug: string): string[] {
    const slugs = new Set(this.chartToDashboards.get(chartSlug) ?? []);
    const own = this.chartsBySlug.get(chartSlug)?.dashboardSlug;
    if (own) {
      slugs.add(own);
    }
    return Array.from(slugs);
  }

  /**
   * Resolve the anchor node + the distinct dbt model names a single
   * dashboard / chart references. Returns null when the slug is unknown.
   * For a dashboard the anchor carries per-chart popover rows (each with
   * its own `modelName`); a chart anchor stands alone. The caller
   * (`ModelLineage.getReverseLineage`) maps `modelNames` to manifest
   * nodes and flags any that are missing as stale.
   */
  getAssetModels(
    kind: 'dashboard' | 'chart',
    slug: string,
  ): {
    anchor: LightdashLineageNode;
    modelNames: string[];
    parentDashboards: LightdashLineageNode[];
  } | null {
    const { lightdashUrl, projectUuid, linkable } = this.getLinkContext();

    if (kind === 'dashboard') {
      const dashboard = this.dashboardsBySlug.get(slug);
      if (!dashboard) {
        return null;
      }
      const modelNames = new Set<string>();
      for (const chartSlug of dashboard.chartSlugs) {
        const modelName = this.chartsBySlug.get(chartSlug)?.modelName;
        if (modelName) {
          modelNames.add(modelName);
        }
      }
      const anchor: LightdashLineageNode = {
        id: `lightdash::dashboard::${slug}`,
        slug,
        name: dashboard.name || slug,
        kind: 'dashboard',
        url: linkable
          ? `${lightdashUrl}/projects/${projectUuid}/dashboards/${slug}/view`
          : undefined,
        charts: dashboard.chartSlugs.map((cs) => this.buildChartRow(cs, slug)),
        filePath: dashboard.filePath,
      };
      return {
        anchor,
        modelNames: Array.from(modelNames).sort(),
        parentDashboards: [],
      };
    }

    const chart = this.chartsBySlug.get(slug);
    if (!chart) {
      return null;
    }
    const anchor: LightdashLineageNode = {
      id: `lightdash::chart::${slug}`,
      slug,
      name: chart.name || slug,
      kind: 'chart',
      url: linkable
        ? `${lightdashUrl}/projects/${projectUuid}/saved/${slug}`
        : undefined,
      filePath: chart.filePath,
    };
    // Dashboard(s) that embed this chart, rendered to the right of the
    // anchor so the reverse graph reads models -> chart -> dashboard. Each
    // carries its own chart popover (when the dashboard YAML is local) and
    // a deep link, mirroring the forward view's dashboard node.
    const parentDashboards: LightdashLineageNode[] = this.parentDashboardSlugs(
      slug,
    )
      .map((ds) => {
        const dashboard = this.dashboardsBySlug.get(ds);
        return {
          id: `lightdash::dashboard::${ds}`,
          slug: ds,
          name: dashboard?.name || ds,
          kind: 'dashboard' as const,
          url: linkable
            ? `${lightdashUrl}/projects/${projectUuid}/dashboards/${ds}/view`
            : undefined,
          charts: dashboard
            ? dashboard.chartSlugs.map((cs) => this.buildChartRow(cs, ds))
            : undefined,
          filePath: dashboard?.filePath ?? '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      anchor,
      modelNames: chart.modelName ? [chart.modelName] : [],
      parentDashboards,
    };
  }

  /**
   * Find all assets whose name matches `name`, case-insensitively. Names
   * are not unique (e.g. a chart and a dashboard can share a name), so
   * this returns every match for the caller to disambiguate. Prefers
   * exact matches; falls back to substring matches when there is no exact
   * hit, so a partial command argument still resolves.
   */
  findAssetsByName(name: string): LightdashAssetSummary[] {
    const needle = name.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    const all = this.listAssets();
    const exact = all.filter((asset) => asset.name.toLowerCase() === needle);
    if (exact.length > 0) {
      return exact;
    }
    return all.filter((asset) => asset.name.toLowerCase().includes(needle));
  }

  /** True iff at least one chart or dashboard parsed successfully. */
  isPopulated(): boolean {
    return this.populated;
  }

  isToggleEnabled(): boolean {
    return (
      vscode.workspace
        .getConfiguration('dj')
        .get<boolean>(TOGGLE_SETTING, false) === true
    );
  }

  /** Workspace-relative content root, for use in the empty-state banner. */
  getResolvedPath(): string {
    return getDashboardsAsCodeRelativePath();
  }

  /**
   * Rescan the Lightdash content directory. Async + non-blocking so the
   * extension host stays responsive while parsing large projects
   * (thousands of YAML files). Concurrent callers share a single in-flight
   * run; used by tests, the watcher, and the manual Refresh button.
   */
  rebuild(): Promise<void> {
    if (this.rebuildInFlight) {
      return this.rebuildInFlight;
    }
    this.rebuildInFlight = this.doRebuild().finally(() => {
      this.rebuildInFlight = undefined;
    });
    return this.rebuildInFlight;
  }

  private async doRebuild(): Promise<void> {
    const root = getDashboardsAsCodeAbsolutePath();
    this.resolvedAbsolutePath = root;
    this.chartsBySlug = new Map();
    this.dashboardsBySlug = new Map();
    this.modelDownstream = new Map();
    this.tileEmbeddedChartSlugs = new Map();
    this.chartToDashboards = new Map();
    this.populated = false;

    if (!fs.existsSync(root)) {
      this.log.info?.(
        `[LightdashContent] No Lightdash content directory at ${root} (skipping)`,
      );
      return;
    }

    const chartsDir = path.join(root, 'charts');
    const dashboardsDir = path.join(root, 'dashboards');

    let parsedCount = 0;

    const chartFiles = await this.collectYamlFiles(chartsDir);
    const charts = await this.parseInBatches(chartFiles, (file) =>
      this.parseChartFile(file),
    );
    for (const chart of charts) {
      this.chartsBySlug.set(chart.slug, chart);
      parsedCount++;
    }

    const dashboardFiles = await this.collectYamlFiles(dashboardsDir);
    const dashboards = await this.parseInBatches(dashboardFiles, (file) =>
      this.parseDashboardFile(file),
    );
    for (const dashboard of dashboards) {
      this.dashboardsBySlug.set(dashboard.slug, dashboard);
      parsedCount++;
    }

    // Snapshot the tile-only chart slugs per dashboard BEFORE the
    // saved-within splice below mutates `chartSlugs`. Used in
    // `getDownstream` to flag the spliced-in charts as not displayed
    // on the dashboard.
    for (const dashboard of this.dashboardsBySlug.values()) {
      this.tileEmbeddedChartSlugs.set(
        dashboard.slug,
        new Set(dashboard.chartSlugs),
      );
    }

    // A chart can also be associated with a dashboard via its own
    // `dashboardSlug` field (charts saved inside a dashboard's space -
    // drilled views, detached tiles - which Lightdash exports without
    // a corresponding entry in the dashboard's `tiles[]`). Splice those
    // into the parent dashboard's chart list so the rest of the rebuild
    // (orphan detection, mart-to-dashboard membership, popover content)
    // treats them uniformly with tile-embedded charts. Saved-within
    // charts are appended after tile charts in alphabetical order so
    // popover ordering stays deterministic across rebuilds.
    const savedWithinByDashboard = new Map<string, LightdashChartContent[]>();
    for (const chart of this.chartsBySlug.values()) {
      if (!chart.dashboardSlug) {
        continue;
      }
      const dashboard = this.dashboardsBySlug.get(chart.dashboardSlug);
      if (!dashboard) {
        continue;
      }
      if (dashboard.chartSlugs.includes(chart.slug)) {
        continue;
      }
      const arr = savedWithinByDashboard.get(chart.dashboardSlug) ?? [];
      arr.push(chart);
      savedWithinByDashboard.set(chart.dashboardSlug, arr);
    }
    for (const [dashboardSlug, charts] of savedWithinByDashboard) {
      charts.sort((a, b) => a.name.localeCompare(b.name));
      const dashboard = this.dashboardsBySlug.get(dashboardSlug)!;
      for (const chart of charts) {
        dashboard.chartSlugs.push(chart.slug);
      }
    }

    // Finalize the model name for the rare charts that lacked an explicit
    // `metricQuery.exploreName` (~2/1267 in practice). The pure parser
    // can't resolve these because DJ model names contain `__` separators;
    // do it here with a longest-prefix match of the first field id against
    // the known dbt model names. No-op without a provider (unit tests) or
    // when nothing matches, leaving `modelName` null rather than attaching
    // a bogus `mart` prefix. Must run before the membership computation
    // below, which reads `chart.modelName`.
    const knownModelNames = this.getKnownModelNames?.();
    if (knownModelNames && knownModelNames.size > 0) {
      for (const chart of this.chartsBySlug.values()) {
        if (chart.modelName) {
          continue;
        }
        const firstField = chart.dimensions[0] ?? chart.metrics[0];
        chart.modelName = resolveModelFromFieldId(firstField, knownModelNames);
      }
    }

    // Compute orphan-chart membership: a chart is orphan iff no
    // dashboard claims it (either via a tile or via the chart's own
    // `dashboardSlug` cross-reference splice above).
    const referencedChartSlugs = new Set<string>();
    for (const dashboard of this.dashboardsBySlug.values()) {
      for (const chartSlug of dashboard.chartSlugs) {
        referencedChartSlugs.add(chartSlug);
        let owners = this.chartToDashboards.get(chartSlug);
        if (!owners) {
          owners = new Set<string>();
          this.chartToDashboards.set(chartSlug, owners);
        }
        owners.add(dashboard.slug);
      }
    }

    for (const chart of this.chartsBySlug.values()) {
      if (!chart.modelName) {
        continue;
      }
      const entry = this.getOrCreateEntry(chart.modelName);
      if (!referencedChartSlugs.has(chart.slug)) {
        entry.orphanCharts.add(chart.slug);
      }
    }

    for (const dashboard of this.dashboardsBySlug.values()) {
      const referencedModels = new Set<string>();
      for (const chartSlug of dashboard.chartSlugs) {
        const chart = this.chartsBySlug.get(chartSlug);
        if (chart?.modelName) {
          referencedModels.add(chart.modelName);
        }
      }
      for (const modelName of referencedModels) {
        const entry = this.getOrCreateEntry(modelName);
        entry.dashboards.add(dashboard.slug);
      }
    }

    this.populated = parsedCount > 0;
    this.log.info?.(
      `[LightdashContent] Parsed ${this.chartsBySlug.size} chart(s) and ${this.dashboardsBySlug.size} dashboard(s) from ${root}`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private installWatcher(): void {
    if (this.watcher) {
      return;
    }
    const root = getDashboardsAsCodeAbsolutePath();
    // RelativePattern keys the watcher to an absolute base so it survives
    // multi-root workspaces and absolute-path settings.
    const pattern = new vscode.RelativePattern(root, '**/*.{yml,yaml}');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const debouncedRebuild = () => this.scheduleRebuild();
    this.watcher.onDidCreate(debouncedRebuild);
    this.watcher.onDidChange(debouncedRebuild);
    this.watcher.onDidDelete(debouncedRebuild);
  }

  private disposeWatcher(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private handleToggleChanged(): void {
    if (this.isToggleEnabled()) {
      void this.rebuild();
      this.installWatcher();
    } else {
      this.disposeWatcher();
      this.chartsBySlug = new Map();
      this.dashboardsBySlug = new Map();
      this.modelDownstream = new Map();
      this.chartToDashboards = new Map();
      this.populated = false;
    }
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = undefined;
      void this.rebuild();
    }, REBUILD_DEBOUNCE_MS);
  }

  private async collectYamlFiles(dir: string): Promise<string[]> {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const out: string[] = [];
    const walk = async (current: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (err: unknown) {
        this.log.warn(
          `[LightdashContent] Failed to read directory ${current}:`,
          err,
        );
        return;
      }
      const subdirs: string[] = [];
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          subdirs.push(full);
        } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          out.push(full);
        }
      }
      for (const sub of subdirs) {
        await walk(sub);
      }
    };
    await walk(dir);
    return out;
  }

  /**
   * Read + parse files in bounded-concurrency batches, awaiting each batch
   * so a large scan yields to the event loop instead of blocking the
   * extension host. Null (malformed / slug-less) results are dropped.
   */
  private async parseInBatches<T>(
    files: string[],
    parse: (file: string) => Promise<T | null>,
  ): Promise<T[]> {
    const BATCH_SIZE = 32;
    const out: T[] = [];
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((file) => parse(file)));
      for (const result of results) {
        if (result) {
          out.push(result);
        }
      }
    }
    return out;
  }

  private async readYaml(filePath: string): Promise<unknown> {
    try {
      const text = await fs.promises.readFile(filePath, 'utf-8');
      return parseYaml(text) as unknown;
    } catch (err: unknown) {
      this.log.warn(
        `[LightdashContent] Failed to parse YAML ${filePath}:`,
        err,
      );
      return null;
    }
  }

  private async parseChartFile(
    filePath: string,
  ): Promise<LightdashChartContent | null> {
    const doc = await this.readYaml(filePath);
    const parsed = parseChartDoc(doc, this.toWorkspaceRelative(filePath));
    if (!parsed) {
      this.log.debug?.(
        `[LightdashContent] Chart at ${filePath} has no slug or is malformed; skipping`,
      );
    }
    return parsed;
  }

  private async parseDashboardFile(
    filePath: string,
  ): Promise<LightdashDashboardContent | null> {
    const doc = await this.readYaml(filePath);
    const parsed = parseDashboardDoc(doc, this.toWorkspaceRelative(filePath));
    if (!parsed) {
      this.log.debug?.(
        `[LightdashContent] Dashboard at ${filePath} has no slug or is malformed; skipping`,
      );
    }
    return parsed;
  }

  private getOrCreateEntry(modelName: string): DownstreamEntry {
    let entry = this.modelDownstream.get(modelName);
    if (!entry) {
      entry = { dashboards: new Set(), orphanCharts: new Set() };
      this.modelDownstream.set(modelName, entry);
    }
    return entry;
  }

  /**
   * Lightdash deep-link context. Both env vars are required to build a
   * link to the Lightdash UI; when either is absent callers leave `url`
   * undefined so the open button renders disabled rather than pointing at
   * a non-functional URL.
   */
  private getLinkContext(): {
    lightdashUrl: string | undefined;
    projectUuid: string | undefined;
    linkable: boolean;
  } {
    const lightdashUrl = process.env.LIGHTDASH_URL?.replace(/\/+$/, '');
    const projectUuid = process.env.LIGHTDASH_PROJECT;
    return {
      lightdashUrl,
      projectUuid,
      linkable: Boolean(lightdashUrl && projectUuid),
    };
  }

  /**
   * Build a single chart-row for a dashboard / container popover.
   * `parentDashboardSlug` is set for rows inside a dashboard's popover so
   * we can flag rows whose chart is associated via `dashboardSlug` only
   * (not rendered as a tile); it stays undefined for the standalone-charts
   * container, where the embedded-as-tile concept does not apply.
   * `modelName` is the chart's referenced dbt model, surfaced for the
   * reverse-lineage popover (ignored by the forward view).
   */
  private buildChartRow(chartSlug: string, parentDashboardSlug?: string) {
    const { lightdashUrl, projectUuid, linkable } = this.getLinkContext();
    const chart = this.chartsBySlug.get(chartSlug);
    // `hasYaml` is false when a dashboard's `tiles[]` references a
    // chartSlug we have no local YAML for (chart removed / never
    // exported). The lineage UI uses this to flag the row as a stale
    // reference and disable the Open YAML action.
    const hasYaml = chart !== undefined;
    const tileSet = parentDashboardSlug
      ? this.tileEmbeddedChartSlugs.get(parentDashboardSlug)
      : undefined;
    const embeddedAsTile = parentDashboardSlug
      ? tileSet?.has(chartSlug) ?? true
      : undefined;
    return {
      slug: chartSlug,
      name: chart?.name ?? chartSlug,
      url: linkable
        ? `${lightdashUrl}/projects/${projectUuid}/saved/${chartSlug}`
        : undefined,
      filePath: chart?.filePath ?? '',
      embeddedAsTile,
      hasYaml,
      modelName: chart?.modelName ?? null,
    };
  }

  private toWorkspaceRelative(absPath: string): string {
    if (!this.resolvedAbsolutePath) {
      return absPath;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return absPath;
    }
    return path.relative(workspaceRoot, absPath).split(path.sep).join('/');
  }
}

/**
 * Idempotently ensure `<workspace>/.gitignore` ignores the configured
 * Lightdash content directory. Used by the "Add path to .gitignore"
 * checkbox on the Dashboards-as-Code Download tab.
 *
 * Creates `.gitignore` if absent. See `applyGitignoreEntry` (in
 * `contentParser.ts`) for the pure idempotency rules tested in unit tests.
 */
export function ensureLightdashPathInGitignore(rawPath: string): {
  added: boolean;
  alreadyPresent: boolean;
  gitignorePath: string;
} {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error('No workspace folder is open.');
  }
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  let body = '';
  if (fs.existsSync(gitignorePath)) {
    body = fs.readFileSync(gitignorePath, 'utf-8');
  }

  const { updatedBody, alreadyPresent } = applyGitignoreEntry(body, rawPath);
  if (alreadyPresent) {
    return { added: false, alreadyPresent: true, gitignorePath };
  }

  fs.writeFileSync(gitignorePath, updatedBody, 'utf-8');
  return { added: true, alreadyPresent: false, gitignorePath };
}
