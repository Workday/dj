import {
  applyGitignoreEntry,
  type LightdashChartContent,
  type LightdashDashboardContent,
  parseChartDoc,
  parseDashboardDoc,
} from '@services/lightdash/contentParser';
import {
  getDashboardsAsCodeAbsolutePath,
  getDashboardsAsCodeRelativePath,
} from '@services/lightdash/dashboardsAsCode';
import type { LightdashLineageNode } from '@shared/modellineage/types';
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
  private watcher?: vscode.FileSystemWatcher;
  private rebuildTimer?: NodeJS.Timeout;
  private configSubscription?: vscode.Disposable;
  private resolvedAbsolutePath?: string;
  private populated = false;

  constructor(log: ContentLogger) {
    this.log = log;
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

    // Both env vars are required to build a deep link to the Lightdash
    // UI; when either is absent we leave `url` undefined so the open
    // button renders disabled with an explanatory tooltip rather than
    // pointing at a non-functional URL.
    const lightdashUrl = process.env.LIGHTDASH_URL?.replace(/\/+$/, '');
    const projectUuid = process.env.LIGHTDASH_PROJECT;
    const linkable = lightdashUrl && projectUuid;

    // `parentDashboardSlug` is set for chart rows inside a dashboard's
    // popover so we can flag rows whose chart is associated via
    // `dashboardSlug` only (not actually rendered as a tile). It stays
    // undefined for rows in the standalone-charts container popover,
    // where the embedded-as-tile concept does not apply.
    const buildChartRow = (
      chartSlug: string,
      parentDashboardSlug?: string,
    ) => {
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
        ? (tileSet?.has(chartSlug) ?? true)
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
      };
    };

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

  /** Force a synchronous rescan (used by tests + the manual Refresh button). */
  rebuild(): void {
    const root = getDashboardsAsCodeAbsolutePath();
    this.resolvedAbsolutePath = root;
    this.chartsBySlug = new Map();
    this.dashboardsBySlug = new Map();
    this.modelDownstream = new Map();
    this.tileEmbeddedChartSlugs = new Map();
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

    for (const file of this.collectYamlFiles(chartsDir)) {
      const chart = this.parseChartFile(file);
      if (chart) {
        this.chartsBySlug.set(chart.slug, chart);
        parsedCount++;
      }
    }

    for (const file of this.collectYamlFiles(dashboardsDir)) {
      const dashboard = this.parseDashboardFile(file);
      if (dashboard) {
        this.dashboardsBySlug.set(dashboard.slug, dashboard);
        parsedCount++;
      }
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
      if (!chart.dashboardSlug) {continue;}
      const dashboard = this.dashboardsBySlug.get(chart.dashboardSlug);
      if (!dashboard) {continue;}
      if (dashboard.chartSlugs.includes(chart.slug)) {continue;}
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

    // Compute orphan-chart membership: a chart is orphan iff no
    // dashboard claims it (either via a tile or via the chart's own
    // `dashboardSlug` cross-reference splice above).
    const referencedChartSlugs = new Set<string>();
    for (const dashboard of this.dashboardsBySlug.values()) {
      for (const chartSlug of dashboard.chartSlugs) {
        referencedChartSlugs.add(chartSlug);
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

  private collectYamlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const out: string[] = [];
    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (err: unknown) {
        this.log.warn(
          `[LightdashContent] Failed to read directory ${current}:`,
          err,
        );
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          out.push(full);
        }
      }
    };
    walk(dir);
    return out;
  }

  private readYaml(filePath: string): unknown {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      return parseYaml(text) as unknown;
    } catch (err: unknown) {
      this.log.warn(
        `[LightdashContent] Failed to parse YAML ${filePath}:`,
        err,
      );
      return null;
    }
  }

  private parseChartFile(filePath: string): LightdashChartContent | null {
    const doc = this.readYaml(filePath);
    const parsed = parseChartDoc(doc, this.toWorkspaceRelative(filePath));
    if (!parsed) {
      this.log.debug?.(
        `[LightdashContent] Chart at ${filePath} has no slug or is malformed; skipping`,
      );
    }
    return parsed;
  }

  private parseDashboardFile(
    filePath: string,
  ): LightdashDashboardContent | null {
    const doc = this.readYaml(filePath);
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
