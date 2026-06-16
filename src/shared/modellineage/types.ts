export type MaterializationType =
  | 'ephemeral'
  | 'incremental'
  | 'view'
  | 'table';

export interface LineageNode {
  id: string; // manifest unique_id
  name: string; // model name
  type: 'model' | 'source' | 'seed';
  description?: string;
  tags?: string[];
  path: string; // relative file path
  pathSystem?: string; // full system file path
  schema?: string;
  database?: string;
  materialized?: MaterializationType;
  testCount?: number;
  // Whether this node has its own upstream/downstream models (for expand buttons)
  hasOwnUpstream?: boolean;
  hasOwnDownstream?: boolean;
}

/**
 * A downstream Lightdash content dependency for a mart model.
 *
 * Sourced from the local Dashboards-as-Code YAML files under the path
 * configured by `dj.lightdash.dashboardsAsCodePath` (default `lightdash/`).
 * Only emitted when the user has opted into the lineage view via
 * `dj.dataExplorer.showLightdashLineage`.
 */
export interface LightdashLineageNode {
  /** Stable React Flow id (`lightdash::<kind>::<slug>`). */
  id: string;
  /** Lightdash slug from the YAML file. */
  slug: string;
  /** Display name (`name` from YAML, falling back to slug). */
  name: string;
  /**
   * - `dashboard`: one node per Lightdash dashboard. The dashboard's saved
   *   charts are surfaced inside a popover via the `charts` field below.
   * - `standalone-charts`: synthetic per-mart container that bundles all
   *   "orphan" charts (saved charts not embedded in any dashboard) into a
   *   single node, so a model with many one-off charts does not explode the
   *   canvas. Aggregate `url` / `filePath` are intentionally empty - each
   *   chart is opened individually from per-row buttons in the popover.
   * - `chart`: a single saved chart used as the anchor (sink) of the
   *   reverse-lineage view. Carries its own `url` / `filePath`.
   */
  kind: 'dashboard' | 'standalone-charts' | 'chart';
  /**
   * Deep link into the Lightdash UI. Built from `LIGHTDASH_URL` +
   * `LIGHTDASH_PROJECT`; undefined when either env var is missing so the
   * "Open in Lightdash" button stays disabled rather than 404-ing.
   * Always undefined for `standalone-charts` containers.
   */
  url?: string;
  /**
   * Saved charts surfaced inside the node's popover. `name` is the
   * human-readable Lightdash title (slug used as tooltip fallback);
   * `url` and `filePath` drive the per-row "Open in Lightdash" / "Open
   * YAML" buttons.
   *
   * `embeddedAsTile` and `hasYaml` together encode three rendering states
   * the lineage UI distinguishes via a leading icon + footer legend:
   *
   * - `tile`    (`embeddedAsTile === true && hasYaml === true`):
   *   the chart is rendered as a tile on the parent dashboard.
   * - `hidden`  (`embeddedAsTile === false && hasYaml === true`):
   *   the chart belongs to the dashboard via its own `dashboardSlug`
   *   field (drilled view / detached chart) but is not in `tiles[]`,
   *   so it does not display on the dashboard itself.
   * - `missing` (`hasYaml === false`):
   *   the dashboard YAML references a chartSlug for which there is no
   *   local chart YAML (chart removed / never exported). The Open YAML
   *   button is hidden for these rows.
   *
   * Both flags are undefined for rows inside `standalone-charts`
   * containers, where neither concept applies and rows are always
   * treated as a plain default.
   */
  charts?: {
    slug: string;
    name: string;
    url?: string;
    filePath: string;
    embeddedAsTile?: boolean;
    hasYaml?: boolean;
    /**
     * dbt model this chart references (the Lightdash explore). Populated
     * for the reverse-lineage view so each popover row can show which
     * upstream model it maps to; `null` when the model could not be
     * resolved. Undefined / ignored by the forward model-lineage view.
     */
    modelName?: string | null;
  }[];
  /**
   * Workspace-relative path to the source YAML file, used by the
   * node-level "Open YAML" button. Empty string for `standalone-charts`
   * containers (no single file represents the whole group).
   */
  filePath: string;
}

export interface LineageData {
  current: LineageNode;
  upstream: LineageNode[];
  downstream: LineageNode[];
  /**
   * Downstream Lightdash dependencies of `current`. Populated only when
   * the Data Explorer Lightdash-lineage toggle is enabled AND `current` is
   * a mart model; undefined otherwise.
   */
  lightdashDownstream?: LightdashLineageNode[];
  /**
   * True iff the local Lightdash content directory exists and contains at
   * least one parsed chart or dashboard. Drives the empty-state banner.
   */
  lightdashAvailable?: boolean;
  /** Workspace-relative content root used for the lookup (for the banner). */
  lightdashResolvedPath?: string;
  /** Echo of the toggle setting so the webview can drive its UI. */
  lightdashEnabled?: boolean;
}

/**
 * A Lightdash dashboard or chart, summarized for the reverse-lineage
 * picker / search. `modelNames` is the distinct set of dbt models the
 * asset references (resolved at parse time), shown as the QuickPick
 * detail line so users can disambiguate same-named assets.
 */
export interface LightdashAssetSummary {
  kind: 'dashboard' | 'chart';
  slug: string;
  name: string;
  modelNames: string[];
  /**
   * For charts: display names of the dashboard(s) this chart belongs to
   * (via a dashboard tile or the chart's own `dashboardSlug`). Empty/absent
   * means the chart is standalone (in no dashboard). Unused for dashboards.
   */
  dashboardNames?: string[];
  /** For dashboards: number of charts the dashboard contains. */
  chartCount?: number;
}

/**
 * Result of listing Lightdash assets for the reverse-lineage picker. Wraps
 * the asset list with availability metadata so the panel can render the
 * not-downloaded banner at first load — before any asset is selected —
 * rather than waiting for a (never-arriving) selection.
 */
export interface LightdashAssetListResult {
  assets: LightdashAssetSummary[];
  /**
   * True iff the local Lightdash content directory exists and contains at
   * least one parsed chart or dashboard.
   */
  lightdashAvailable: boolean;
  /** Workspace-relative content root used for the lookup (for the banner). */
  lightdashResolvedPath: string;
}

/**
 * Reverse lineage for a single Lightdash dashboard or chart: the asset is
 * the graph sink (`anchor`), and `models` are the upstream dbt mart models
 * it references, resolved against the dbt manifest. Drives the dedicated
 * reverse-lineage view.
 */
export interface ReverseLineageData {
  /** The dashboard / chart being inspected (graph sink). */
  anchor: LightdashLineageNode;
  /**
   * Upstream dbt models referenced by the asset that resolved to a node
   * in the dbt manifest. Rendered to the left of the anchor; each carries
   * `hasOwnUpstream` so the existing expand-upstream button can drill
   * further.
   */
  models: LineageNode[];
  /**
   * Referenced model names that could NOT be resolved in the manifest.
   * Rendered as flagged "not found in project" nodes. Also populated with
   * every referenced name when `manifestAvailable` is false so the webview
   * can still list them while prompting a `dbt parse`.
   */
  staleModels: string[];
  /** Project the resolved models belong to (used for drill-down calls). */
  projectName: string;
  /**
   * False when no dbt manifest has been loaded yet (no `dbt parse`). The
   * webview shows a "run a dbt parse" banner instead of erroring.
   */
  manifestAvailable: boolean;
  /**
   * False when the local Lightdash content directory is missing/empty.
   * Drives the not-downloaded banner (reuses Dashboards-as-Code).
   */
  lightdashAvailable: boolean;
  /** Workspace-relative Lightdash content root (for the banner). */
  lightdashResolvedPath: string;
  /**
   * For a chart anchor, the dashboard(s) that contain it (via a tile or the
   * chart's own `dashboardSlug`). Rendered to the right of the chart so the
   * graph reads models -> chart -> dashboard. Empty for dashboard anchors or
   * standalone charts.
   */
  parentDashboards?: LightdashLineageNode[];
}

export type ModelLineageApi =
  | {
      type: 'data-explorer-get-model-lineage';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: LineageData;
    }
  | {
      type: 'data-explorer-list-lightdash-assets';
      service: 'model-lineage';
      /**
       * `force` re-scans the Lightdash content directory from disk before
       * listing, rather than serving the already-populated in-memory index.
       * The manual Refresh / re-scan action sets it so newly downloaded (or
       * removed) charts/dashboards are picked up within a session.
       */
      request: { force?: boolean } | null;
      response: LightdashAssetListResult;
    }
  | {
      type: 'data-explorer-get-reverse-lineage';
      service: 'model-lineage';
      request: { kind: 'dashboard' | 'chart'; slug: string };
      response: ReverseLineageData;
    }
  | {
      type: 'data-explorer-refresh-projects';
      service: 'model-lineage';
      request: null;
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-open-reverse-lineage';
      service: 'model-lineage';
      request: { kind: 'dashboard' | 'chart'; slug: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-open-lightdash-url';
      service: 'model-lineage';
      request: { url: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-set-lightdash-toggle';
      service: 'model-lineage';
      request: { enabled: boolean };
      response: { enabled: boolean };
    }
  | {
      type: 'data-explorer-open-dashboards-as-code';
      service: 'model-lineage';
      request: null;
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-open-lightdash-yaml';
      service: 'model-lineage';
      request: { filePath: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-execute-query';
      service: 'model-lineage';
      request: { modelName: string; projectName: string; limit?: number };
      response: {
        columns: string[];
        rows: unknown[][];
        rowCount: number;
        executionTime?: number;
      };
    }
  | {
      type: 'data-explorer-ready';
      service: 'model-lineage';
      request: null;
      response: void;
    }
  | {
      type: 'data-explorer-detect-active-model';
      service: 'model-lineage';
      request: null;
      response: { modelName: string; projectName: string } | null;
    }
  | {
      type: 'data-explorer-open-model-file';
      service: 'model-lineage';
      request: {
        modelName: string;
        projectName: string;
        nodeType?: 'model' | 'source' | 'seed';
      };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-get-compiled-sql';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: {
        sql: string | null;
        compiledPath?: string;
        lastModified?: number; // Unix timestamp in milliseconds
      };
    }
  | {
      type: 'data-explorer-get-project-overview';
      service: 'model-lineage';
      request: null;
      response: ProjectOverviewData | null;
    };

export interface ProjectOverviewItem {
  id: string;
  name: string;
  type: 'model';
  description?: string;
  materialized?: MaterializationType;
  testCount?: number;
}

export interface ProjectOverviewGroup {
  layer: 'staging' | 'intermediate' | 'mart';
  label: string;
  items: ProjectOverviewItem[];
}

export interface ProjectOverviewData {
  projectName: string;
  groups: ProjectOverviewGroup[];
}
