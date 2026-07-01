import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Resolved in beforeAll to a freshly-created temp dir containing
// `charts/` + `dashboards/`. The dashboardsAsCode mock below reads it at
// call time, so assigning it before the first `rebuild()` is sufficient.
// Must be `mock`-prefixed to satisfy jest's hoisted-factory scope rules.
let mockTmpRoot = '';

jest.mock(
  'vscode',
  () => ({
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => undefined }),
    },
  }),
  { virtual: true },
);

// Point LightdashContent at our temp fixture root instead of the real
// workspace, and give it a stable workspace-relative label.
jest.mock('@services/lightdash/dashboardsAsCode', () => ({
  getDashboardsAsCodeAbsolutePath: () => mockTmpRoot,
  getDashboardsAsCodeRelativePath: () => 'lightdash',
}));

import { LightdashContent } from '@services/lightdash/content';

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Known dbt model names used to exercise the longest-prefix fallback. */
const KNOWN_MODELS = new Set(['mart__core__foo__bar']);

function writeFixture(relPath: string, body: string): void {
  const full = path.join(mockTmpRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf-8');
}

async function build(): Promise<LightdashContent> {
  const content = new LightdashContent(noopLogger, () => KNOWN_MODELS);
  await content.rebuild();
  return content;
}

beforeAll(() => {
  mockTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-ld-content-'));

  // --- charts -------------------------------------------------------------
  writeFixture(
    'charts/orders-by-region.yml',
    [
      'slug: orders-by-region',
      'name: Orders by Region',
      'metricQuery:',
      '  exploreName: mart_orders',
      '  dimensions:',
      '    - mart_orders_region',
    ].join('\n'),
  );
  writeFixture(
    'charts/top-customers.yml',
    [
      'slug: top-customers',
      'name: Top Customers',
      'metricQuery:',
      '  exploreName: mart_customers',
    ].join('\n'),
  );
  // Saved WITHIN exec-overview (no matching tile in the dashboard YAML);
  // rebuild() must splice it into the dashboard via `dashboardSlug`.
  writeFixture(
    'charts/drill-orders.yml',
    [
      'slug: drill-orders',
      'name: Drill Orders',
      'dashboardSlug: exec-overview',
      'metricQuery:',
      '  exploreName: mart_orders_detail',
    ].join('\n'),
  );
  // No exploreName: model must be resolved via the longest-prefix fallback
  // against KNOWN_MODELS (mart__core__foo__bar), NOT the leading `mart`.
  writeFixture(
    'charts/no-explore.yml',
    [
      'slug: no-explore',
      'name: No Explore Chart',
      'metricQuery:',
      '  dimensions:',
      '    - mart__core__foo__bar_id',
    ].join('\n'),
  );
  // Shares its display name with a dashboard to exercise findAssetsByName.
  writeFixture(
    'charts/shared-name-chart.yml',
    [
      'slug: shared-name-chart',
      'name: Shared Name',
      'metricQuery:',
      '  exploreName: mart_orders',
    ].join('\n'),
  );

  // --- dashboards ---------------------------------------------------------
  // References orders-by-region + top-customers as tiles, plus a
  // `missing-chart` slug that has NO local YAML (stale chart reference).
  writeFixture(
    'dashboards/exec-overview.yml',
    [
      'slug: exec-overview',
      'name: Executive Overview',
      'tiles:',
      '  - type: saved_chart',
      '    properties:',
      '      chartSlug: orders-by-region',
      '  - type: saved_chart',
      '    properties:',
      '      chartSlug: top-customers',
      '  - type: saved_chart',
      '    properties:',
      '      chartSlug: missing-chart',
    ].join('\n'),
  );
  writeFixture(
    'dashboards/shared-name-dash.yml',
    ['slug: shared-name-dash', 'name: Shared Name', 'tiles: []'].join('\n'),
  );
});

afterAll(() => {
  if (mockTmpRoot) {
    fs.rmSync(mockTmpRoot, { recursive: true, force: true });
  }
});

describe('LightdashContent reverse lookups', () => {
  it('listAssets summarizes dashboards + charts with distinct model names', async () => {
    const assets = (await build()).listAssets();

    const dash = assets.find(
      (a) => a.kind === 'dashboard' && a.slug === 'exec-overview',
    );
    expect(dash).toBeDefined();
    // orders-by-region -> mart_orders, top-customers -> mart_customers,
    // drill-orders (saved-within) -> mart_orders_detail. missing-chart has
    // no YAML so contributes nothing. Sorted + de-duplicated.
    expect(dash?.modelNames).toEqual([
      'mart_customers',
      'mart_orders',
      'mart_orders_detail',
    ]);

    const chart = assets.find(
      (a) => a.kind === 'chart' && a.slug === 'orders-by-region',
    );
    expect(chart?.modelNames).toEqual(['mart_orders']);

    // Dashboards carry their chart count (tiles + saved-within splice:
    // orders-by-region, top-customers, missing-chart, drill-orders).
    expect(dash?.chartCount).toBe(4);

    // Charts carry the dashboard(s) they belong to; orphans are empty.
    expect(chart?.dashboardNames).toEqual(['Executive Overview']);
    const orphan = assets.find(
      (a) => a.kind === 'chart' && a.slug === 'no-explore',
    );
    expect(orphan?.dashboardNames).toEqual([]);

    // Picker order: dashboards first, then charts, each alphabetical.
    const kinds = assets.map((a) => a.kind);
    const firstChartIdx = kinds.indexOf('chart');
    expect(kinds.slice(0, firstChartIdx).every((k) => k === 'dashboard')).toBe(
      true,
    );
    expect(kinds.slice(firstChartIdx).every((k) => k === 'chart')).toBe(true);
    const dashNames = assets
      .filter((a) => a.kind === 'dashboard')
      .map((a) => a.name);
    const chartNames = assets
      .filter((a) => a.kind === 'chart')
      .map((a) => a.name);
    expect(dashNames).toEqual(
      [...dashNames].sort((a, b) => a.localeCompare(b)),
    );
    expect(chartNames).toEqual(
      [...chartNames].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('getAssetModels (dashboard) unions models across tiles + saved-within charts', async () => {
    const result = (await build()).getAssetModels('dashboard', 'exec-overview');
    expect(result).not.toBeNull();
    expect(result?.anchor.kind).toBe('dashboard');
    expect(result?.modelNames).toEqual([
      'mart_customers',
      'mart_orders',
      'mart_orders_detail',
    ]);

    // The saved-within chart is present but flagged as not a tile.
    const drill = result?.anchor.charts?.find((c) => c.slug === 'drill-orders');
    expect(drill).toBeDefined();
    expect(drill?.embeddedAsTile).toBe(false);
    expect(drill?.hasYaml).toBe(true);
    expect(drill?.modelName).toBe('mart_orders_detail');

    // The dangling tile reference is surfaced as a stale chart row.
    const missing = result?.anchor.charts?.find(
      (c) => c.slug === 'missing-chart',
    );
    expect(missing?.hasYaml).toBe(false);
    expect(missing?.modelName).toBeNull();

    // A dashboard anchor has no parent dashboards of its own.
    expect(result?.parentDashboards).toEqual([]);
  });

  it('getAssetModels (chart) returns the single referenced model', async () => {
    const result = (await build()).getAssetModels('chart', 'orders-by-region');
    expect(result?.anchor.kind).toBe('chart');
    expect(result?.modelNames).toEqual(['mart_orders']);
  });

  it('getAssetModels (chart) surfaces the parent dashboard(s)', async () => {
    const content = await build();

    // orders-by-region is a tile of exec-overview.
    const inDash = content.getAssetModels('chart', 'orders-by-region');
    expect(inDash?.parentDashboards.map((d) => d.slug)).toEqual([
      'exec-overview',
    ]);
    expect(inDash?.parentDashboards[0]?.kind).toBe('dashboard');
    expect(inDash?.parentDashboards[0]?.name).toBe('Executive Overview');

    // drill-orders is saved WITHIN exec-overview (via its dashboardSlug).
    const savedWithin = content.getAssetModels('chart', 'drill-orders');
    expect(savedWithin?.parentDashboards.map((d) => d.slug)).toEqual([
      'exec-overview',
    ]);

    // no-explore belongs to no dashboard -> standalone.
    const orphan = content.getAssetModels('chart', 'no-explore');
    expect(orphan?.parentDashboards).toEqual([]);
  });

  it('resolves a chart without exploreName via longest-prefix fallback', async () => {
    // Without the fallback this would be null (or the buggy `mart`).
    const result = (await build()).getAssetModels('chart', 'no-explore');
    expect(result?.modelNames).toEqual(['mart__core__foo__bar']);
  });

  it('returns null for an unknown slug', async () => {
    const content = await build();
    expect(content.getAssetModels('chart', 'does-not-exist')).toBeNull();
    expect(content.getAssetModels('dashboard', 'does-not-exist')).toBeNull();
  });

  it('findAssetsByName returns every asset sharing a name (collisions)', async () => {
    const matches = (await build()).findAssetsByName('Shared Name');
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.kind).sort()).toEqual(['chart', 'dashboard']);
  });

  it('findAssetsByName is case-insensitive and falls back to substring', async () => {
    const content = await build();
    expect(content.findAssetsByName('executive overview')).toHaveLength(1);
    // No exact match for "Executive" -> substring fallback still resolves.
    expect(content.findAssetsByName('Executive').length).toBeGreaterThan(0);
    expect(content.findAssetsByName('   ')).toEqual([]);
  });
});
