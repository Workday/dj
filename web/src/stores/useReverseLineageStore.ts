import type {
  LightdashAssetListResult,
  LightdashAssetSummary,
} from '@shared/modellineage/types';
import { create } from 'zustand';

import type {
  LightdashLineageNode,
  LineageNode,
} from '../pages/ModelLineage/types';

/** Anchor reference (dashboard / chart) the reverse view is built around. */
export interface ReverseAnchorRef {
  kind: 'dashboard' | 'chart';
  slug: string;
}

/**
 * Reverse lineage payload pushed by the extension. Mirrors the backend
 * `ReverseLineageData`; typed locally against the web node shapes (which
 * are structurally compatible) to avoid cross-importing the extension
 * node types.
 */
export interface ReverseLineageData {
  anchor: LightdashLineageNode;
  models: LineageNode[];
  staleModels: string[];
  projectName: string;
  manifestAvailable: boolean;
  lightdashAvailable: boolean;
  lightdashResolvedPath: string;
  /**
   * For a chart anchor, the dashboard(s) that contain it. Rendered to the
   * right of the chart so the graph reads models -> chart -> dashboard.
   * Empty for dashboard anchors or standalone charts.
   */
  parentDashboards?: LightdashLineageNode[];
}

interface ReverseLineageStore {
  // The asset currently anchoring the graph.
  anchorRef: ReverseAnchorRef | null;
  data: ReverseLineageData | null;
  isLoading: boolean;
  error: string | null;

  // Asset picker data (all dashboards + charts).
  assets: LightdashAssetSummary[];
  isLoadingAssets: boolean;
  /** Set when a (re-)scan fails so the panel can surface it instead of silently no-op'ing. */
  assetsError: string | null;

  // Availability of local Lightdash content, captured when the asset list is
  // fetched so the panel can show the not-downloaded banner before any asset
  // is selected (there is nothing to select until content is downloaded).
  lightdashAvailable: boolean;
  lightdashResolvedPath: string;

  // Client-side upstream expansion (drill further left from a model).
  expandedUpstream: Set<string>;
  additionalNodes: LineageNode[];
  additionalEdges: Array<{ source: string; target: string }>;

  // API handler (set from the app context).

  _apiHandler: any;
  setApiHandler: (handler: any) => void;

  // Actions
  fetchAssets: (force?: boolean) => Promise<void>;
  fetchReverseLineage: (anchor: ReverseAnchorRef) => Promise<void>;
  /** Drop the current anchor + graph (e.g. when a re-scan removes it). */
  clearLineage: () => void;
  expandUpstreamNode: (modelName: string, projectName: string) => Promise<void>;
  isNodeUpstreamExpanded: (nodeId: string) => boolean;
  resetExpansion: () => void;
  openModelInDataExplorer: (
    modelName: string,
    projectName: string,
  ) => Promise<void>;
  compileModel: (pathSystem: string) => Promise<void>;
  previewModel: (pathSystem: string) => Promise<void>;
  openColumnLineage: (pathSystem: string) => Promise<void>;
  openLightdashUrl: (url: string) => Promise<void>;
  openLightdashYaml: (filePath: string) => Promise<void>;
  openDashboardsAsCode: () => Promise<void>;
  refreshProjects: () => Promise<void>;
}

export const useReverseLineageStore = create<ReverseLineageStore>(
  (set, get) => ({
    anchorRef: null,
    data: null,
    isLoading: false,
    error: null,

    assets: [],
    // Start in the loading state: the panel always scans for assets on mount,
    // so the spinner shows until the first list resolves instead of briefly
    // flashing the not-downloaded banner.
    isLoadingAssets: true,
    assetsError: null,
    lightdashAvailable: false,
    lightdashResolvedPath: '',

    expandedUpstream: new Set<string>(),
    additionalNodes: [],
    additionalEdges: [],

    _apiHandler: null,
    setApiHandler: (handler: any) => set({ _apiHandler: handler }),

    fetchAssets: async (force?: boolean) => {
      const { _apiHandler } = get();
      if (!_apiHandler) {
        return;
      }
      set({ isLoadingAssets: true, assetsError: null });
      try {
        // `force` re-scans the content directory on the backend so newly
        // downloaded (or removed) charts/dashboards show up; the default
        // (mount) path serves the already-populated index.
        const response = (await _apiHandler({
          type: 'data-explorer-list-lightdash-assets',
          request: force ? { force: true } : null,
        })) as LightdashAssetListResult;
        set({
          assets: response?.assets ?? [],
          lightdashAvailable: response?.lightdashAvailable ?? false,
          lightdashResolvedPath: response?.lightdashResolvedPath ?? '',
          isLoadingAssets: false,
        });
      } catch (error) {
        console.error('[ReverseLineageStore] Error listing assets:', error);
        set({
          isLoadingAssets: false,
          assetsError:
            error instanceof Error
              ? error.message
              : 'Could not re-scan Lightdash content.',
        });
      }
    },

    clearLineage: () =>
      set({
        anchorRef: null,
        data: null,
        error: null,
        expandedUpstream: new Set<string>(),
        additionalNodes: [],
        additionalEdges: [],
      }),

    fetchReverseLineage: async (anchor: ReverseAnchorRef) => {
      const { _apiHandler } = get();
      if (!_apiHandler) {
        console.error('[ReverseLineageStore] API handler not set');
        return;
      }
      // Reset expansion when re-anchoring so stale drill-downs don't leak.
      set({
        anchorRef: anchor,
        isLoading: true,
        error: null,
        expandedUpstream: new Set<string>(),
        additionalNodes: [],
        additionalEdges: [],
      });
      try {
        const response = (await _apiHandler({
          type: 'data-explorer-get-reverse-lineage',
          request: anchor,
        })) as ReverseLineageData;
        set({ data: response, isLoading: false });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to load reverse lineage';
        console.error('[ReverseLineageStore] Error fetching lineage:', error);
        set({ error: errorMessage, isLoading: false, data: null });
      }
    },

    expandUpstreamNode: async (modelName: string, projectName: string) => {
      const {
        _apiHandler,
        expandedUpstream,
        additionalNodes,
        additionalEdges,
      } = get();
      if (!_apiHandler) {
        return;
      }
      try {
        const response = (await _apiHandler({
          type: 'data-explorer-get-model-lineage',
          request: { modelName, projectName },
        })) as {
          current: LineageNode;
          upstream: LineageNode[];
        };

        const data = get().data;
        const existingNodeIds = new Set<string>([
          ...additionalNodes.map((n) => n.id),
          ...(data?.models.map((n) => n.id) ?? []),
          ...(data?.anchor ? [data.anchor.id] : []),
        ]);

        const newNodes = response.upstream.filter(
          (n) => !existingNodeIds.has(n.id),
        );
        const newEdges = response.upstream.map((upstream) => ({
          source: upstream.id,
          target: response.current.id,
        }));

        const newExpandedUpstream = new Set(expandedUpstream);
        newExpandedUpstream.add(response.current.id);

        set({
          additionalNodes: [...additionalNodes, ...newNodes],
          additionalEdges: [...additionalEdges, ...newEdges],
          expandedUpstream: newExpandedUpstream,
        });
      } catch (error) {
        console.error('[ReverseLineageStore] Error expanding upstream:', error);
      }
    },

    isNodeUpstreamExpanded: (nodeId: string) =>
      get().expandedUpstream.has(nodeId),

    resetExpansion: () =>
      set({
        expandedUpstream: new Set<string>(),
        additionalNodes: [],
        additionalEdges: [],
      }),

    openModelInDataExplorer: async (modelName: string, projectName: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-open-with-model',
          request: { modelName, projectName },
        });
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error opening model in Data Explorer:',
          error,
        );
      }
    },

    compileModel: async (pathSystem: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler || !pathSystem) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-compile-model',
          request: { pathSystem },
        });
      } catch (error) {
        console.error('[ReverseLineageStore] Error compiling model:', error);
      }
    },

    previewModel: async (pathSystem: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler || !pathSystem) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-preview-model',
          request: { pathSystem },
        });
      } catch (error) {
        console.error('[ReverseLineageStore] Error previewing model:', error);
      }
    },

    openColumnLineage: async (pathSystem: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler || !pathSystem) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-open-column-lineage',
          request: { pathSystem },
        });
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error opening column lineage:',
          error,
        );
      }
    },

    openLightdashUrl: async (url: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler || !url) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-open-lightdash-url',
          request: { url },
        });
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error opening Lightdash URL:',
          error,
        );
      }
    },

    openLightdashYaml: async (filePath: string) => {
      const { _apiHandler } = get();
      if (!_apiHandler || !filePath) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-open-lightdash-yaml',
          request: { filePath },
        });
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error opening Lightdash YAML:',
          error,
        );
      }
    },

    openDashboardsAsCode: async () => {
      const { _apiHandler } = get();
      if (!_apiHandler) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-open-dashboards-as-code',
          request: null,
        });
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error opening Dashboards as Code:',
          error,
        );
      }
    },

    refreshProjects: async () => {
      const { _apiHandler, anchorRef, fetchReverseLineage } = get();
      if (!_apiHandler) {
        return;
      }
      try {
        await _apiHandler({
          type: 'data-explorer-refresh-projects',
          request: null,
        });
        // Re-resolve the current anchor so the re-read manifest is reflected
        // without the user re-selecting the asset.
        if (anchorRef) {
          await fetchReverseLineage(anchorRef);
        }
      } catch (error) {
        console.error(
          '[ReverseLineageStore] Error refreshing projects:',
          error,
        );
      }
    },
  }),
);
