export type MaterializationType =
  | 'ephemeral'
  | 'incremental'
  | 'view'
  | 'table';

export interface LineageNode {
  id: string; // manifest unique_id
  name: string; // model name
  type: 'model' | 'source' | 'seed' | 'python';
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
   */
  kind: 'dashboard' | 'standalone-charts';
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
  /** Python model edges connecting python model nodes to source nodes */
  pythonModelEdges?: { pythonModelNodeId: string; sourceNodeId: string }[];
}

export type ModelLineageApi =
  | {
      type: 'data-explorer-get-model-lineage';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: LineageData;
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
