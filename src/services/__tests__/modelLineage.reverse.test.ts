import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ModelLineage transitively imports `admin` (reads workspaceFolders at load),
// `config`, and `dashboardsAsCode`, all of which require `vscode`. A minimal
// virtual mock satisfies the whole chain; the reverse-lineage path itself
// only touches the (stubbed) coder.
jest.mock(
  'vscode',
  () => ({
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => undefined }),
    },
    commands: { executeCommand: jest.fn() },
    Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
  }),
  { virtual: true },
);

import type { Coder } from '@services/coder';
import { ModelLineage } from '@services/modelLineage';
import type {
  LightdashLineageNode,
  ReverseLineageData,
} from '@shared/modellineage/types';

type AssetResult = {
  anchor: LightdashLineageNode;
  modelNames: string[];
  parentDashboards?: LightdashLineageNode[];
} | null;

/** Mutable per-test return for the stubbed LightdashContent. */
let assetResult: AssetResult = null;

function makeManifest() {
  return {
    nodes: {
      'model.demo.mart_orders': {
        name: 'mart_orders',
        resource_type: 'model',
        original_file_path: 'models/mart/mart_orders.sql',
        description: 'Orders mart',
        tags: ['mart'],
        config: { materialized: 'table' },
      },
      'model.demo.mart_customers': {
        name: 'mart_customers',
        resource_type: 'model',
        original_file_path: 'models/mart/mart_customers.sql',
        config: { materialized: 'incremental' },
      },
      'model.demo.int_orders': {
        name: 'int_orders',
        resource_type: 'model',
      },
    },
    parent_map: {
      'model.demo.mart_orders': ['model.demo.int_orders'],
      'model.demo.mart_customers': [],
    },
    child_map: {},
  };
}

function makeCoder(withManifest: boolean): Coder {
  const project = {
    name: 'demo',
    pathSystem: '/repo/demo',
    manifest: makeManifest(),
  };
  const models = withManifest
    ? new Map<string, unknown>([
        [
          'model.demo.mart_orders',
          { name: 'mart_orders', unique_id: 'model.demo.mart_orders' },
        ],
        [
          'model.demo.mart_customers',
          { name: 'mart_customers', unique_id: 'model.demo.mart_customers' },
        ],
      ])
    : new Map<string, unknown>();

  const lightdashContent = {
    ensurePopulated: jest.fn(() => undefined),
    rebuild: jest.fn(() => Promise.resolve()),
    isPopulated: () => true,
    getResolvedPath: () => 'lightdash',
    listAssets: () => [],
    getAssetModels: () => assetResult,
  };

  return {
    log: { info: () => undefined, error: () => undefined },
    lightdashContent,
    framework: {
      dbt: {
        models,
        projects: new Map([['demo', project]]),
      },
    },
  } as unknown as Coder;
}

function dashboardAnchor(slug = 'exec-overview'): LightdashLineageNode {
  return {
    id: `lightdash::dashboard::${slug}`,
    slug,
    name: 'Executive Overview',
    kind: 'dashboard',
    filePath: `lightdash/dashboards/${slug}.yml`,
    charts: [],
  };
}

function chartAnchor(slug = 'orders-by-region'): LightdashLineageNode {
  return {
    id: `lightdash::chart::${slug}`,
    slug,
    name: 'Orders by Region',
    kind: 'chart',
    filePath: `lightdash/charts/${slug}.yml`,
  };
}

async function getReverse(
  coder: Coder,
  kind: 'dashboard' | 'chart',
  slug: string,
): Promise<ReverseLineageData> {
  const modelLineage = new ModelLineage({ coder });
  const result = await modelLineage.handleApi({
    type: 'data-explorer-get-reverse-lineage',
    service: 'model-lineage',
    request: { kind, slug },
  } as never);
  return result as unknown as ReverseLineageData;
}

beforeEach(() => {
  assetResult = null;
});

describe('ModelLineage.getReverseLineage', () => {
  it('resolves a multi-model dashboard and flags missing models as stale', async () => {
    assetResult = {
      anchor: dashboardAnchor(),
      modelNames: ['mart_orders', 'mart_customers', 'mart_missing'],
    };
    const data = await getReverse(
      makeCoder(true),
      'dashboard',
      'exec-overview',
    );

    expect(data.manifestAvailable).toBe(true);
    expect(data.lightdashAvailable).toBe(true);
    expect(data.projectName).toBe('demo');
    expect(data.models.map((m) => m.name).sort()).toEqual([
      'mart_customers',
      'mart_orders',
    ]);
    expect(data.staleModels).toEqual(['mart_missing']);

    // Upstream-expandability + config are carried through from the manifest.
    // (manifestNodeToLineageNode only surfaces ephemeral/incremental/view;
    // a plain `table` materialization is left undefined by design.)
    const orders = data.models.find((m) => m.name === 'mart_orders');
    expect(orders?.hasOwnUpstream).toBe(true);
    const customers = data.models.find((m) => m.name === 'mart_customers');
    expect(customers?.hasOwnUpstream).toBe(false);
    expect(customers?.materialized).toBe('incremental');
  });

  it('resolves a single-model chart anchor', async () => {
    assetResult = {
      anchor: chartAnchor(),
      modelNames: ['mart_orders'],
    };
    const data = await getReverse(makeCoder(true), 'chart', 'orders-by-region');

    expect(data.anchor.kind).toBe('chart');
    expect(data.models).toHaveLength(1);
    expect(data.models[0]?.name).toBe('mart_orders');
    expect(data.staleModels).toEqual([]);
  });

  it('passes a chart anchor parent dashboards through', async () => {
    assetResult = {
      anchor: chartAnchor(),
      modelNames: ['mart_orders'],
      parentDashboards: [dashboardAnchor()],
    };
    const data = await getReverse(makeCoder(true), 'chart', 'orders-by-region');

    expect(data.parentDashboards?.map((d) => d.slug)).toEqual([
      'exec-overview',
    ]);
    expect(data.parentDashboards?.[0]?.kind).toBe('dashboard');
  });

  it('flags a reference to a non-existent model as stale', async () => {
    assetResult = {
      anchor: chartAnchor('ghost-chart'),
      modelNames: ['mart_missing'],
    };
    const data = await getReverse(makeCoder(true), 'chart', 'ghost-chart');

    expect(data.models).toHaveLength(0);
    expect(data.staleModels).toEqual(['mart_missing']);
  });

  it('returns an empty anchor for an unknown slug', async () => {
    assetResult = null; // LightdashContent.getAssetModels miss
    const data = await getReverse(makeCoder(true), 'dashboard', 'nope');

    expect(data.anchor.slug).toBe('nope');
    expect(data.anchor.name).toBe('nope');
    expect(data.models).toEqual([]);
    expect(data.staleModels).toEqual([]);
    expect(data.lightdashAvailable).toBe(true);
    expect(data.parentDashboards).toEqual([]);
  });

  it('echoes referenced models as stale when the manifest is not loaded', async () => {
    assetResult = {
      anchor: dashboardAnchor(),
      modelNames: ['mart_orders', 'mart_customers'],
    };
    const data = await getReverse(
      makeCoder(false),
      'dashboard',
      'exec-overview',
    );

    expect(data.manifestAvailable).toBe(false);
    expect(data.models).toEqual([]);
    // Still lists what the asset depends on so the webview can prompt a parse.
    expect(data.staleModels).toEqual(['mart_orders', 'mart_customers']);
  });
});

describe('ModelLineage list-lightdash-assets force re-scan', () => {
  type LightdashContentSpies = {
    rebuild: jest.Mock;
    ensurePopulated: jest.Mock;
  };

  async function listAssets(
    coder: Coder,
    request: { force?: boolean } | null,
  ): Promise<void> {
    const modelLineage = new ModelLineage({ coder });
    await modelLineage.handleApi({
      type: 'data-explorer-list-lightdash-assets',
      service: 'model-lineage',
      request,
    } as never);
  }

  it('rebuilds from disk when force is set', async () => {
    const coder = makeCoder(true);
    const lc = coder.lightdashContent as unknown as LightdashContentSpies;
    await listAssets(coder, { force: true });
    expect(lc.rebuild).toHaveBeenCalledTimes(1);
    expect(lc.ensurePopulated).not.toHaveBeenCalled();
  });

  it('serves the populated index when force is absent', async () => {
    const coder = makeCoder(true);
    const lc = coder.lightdashContent as unknown as LightdashContentSpies;
    await listAssets(coder, null);
    expect(lc.ensurePopulated).toHaveBeenCalledTimes(1);
    expect(lc.rebuild).not.toHaveBeenCalled();
  });
});
