import { assertExhaustive, removeEmpty } from '@shared';
import type { ApiHandler, ApiMessage, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { DbtProjectManifest } from '@shared/dbt/types';
import { DEFAULT_INCREMENTAL_STRATEGY } from '@shared/framework/constants';
import type { FrameworkModel } from '@shared/framework/types';
import type { LightdashYamlNode } from '@shared/lightdash/types';
import { TrinoProvider } from '@web/context/trino';
import { useEnvironment } from '@web/context/useEnvironment';
import DataExplorer from '@web/pages/DataExplorer';
import { Home } from '@web/pages/Home';
import { LightdashDashboardsAsCode } from '@web/pages/LightdashDashboardsAsCode';
import { LightdashPreviewManager } from '@web/pages/LightdashPreviewManager';
import { ModelCreate } from '@web/pages/ModelCreate';
import { ModelRun } from '@web/pages/ModelRun';
import { ModelTest } from '@web/pages/ModelTest';
import { QueryControlCenter } from '@web/pages/QueryControlCenter';
import { SourceCreate } from '@web/pages/SourceCreate';
import { useCallback, useMemo, useState } from 'react';
import {
  BrowserRouter,
  createBrowserRouter,
  Route,
  RouterProvider,
  Routes,
} from 'react-router';
import { useMount, useUnmount } from 'react-use';
import * as uuid from 'uuid';

import { createMockProject } from '../features/DataModeling/mock/mockData';
import { getMockEditFlowResponse } from '../features/ModelWizard/mock/editFlowTestData';
import { AppContext, type AppValue } from './AppContext';

type WebRoute = {
  element: React.ReactElement;
  label: string;
  path: string;
  regex: RegExp;
};

const routeConfigs: WebRoute[] = [
  {
    element: <Home />,
    label: 'Home',
    regex: /^\/$/,
    path: '/',
  },
  {
    element: <ModelCreate />,
    label: 'Model Create',
    path: '/model/create',
    regex: /^\/model\/create$/,
  },
  {
    element: <ModelCreate mode="edit" />,
    label: 'Model Edit',
    path: '/model/edit',
    regex: /^\/model\/edit$/,
  },
  {
    element: <ModelRun />,
    label: 'Model Run',
    path: '/model/run',
    regex: /^\/model\/run$/,
  },
  {
    element: <ModelTest />,
    label: 'Model Test',
    path: '/model/test',
    regex: /^\/model\/test$/,
  },
  {
    element: <DataExplorer />,
    label: 'Model Lineage',
    path: '/model/lineage',
    regex: /^\/model\/lineage(\?.*)?$/,
  },
  {
    element: <QueryControlCenter />,
    label: 'Query Control Center',
    path: '/query/control-center',
    regex: /^\/query\/control-center(\?.*)?$/,
  },
  {
    element: <SourceCreate />,
    label: 'Source Create',
    path: '/source/create',
    regex: /^\/source\/create$/,
  },
  {
    element: <LightdashPreviewManager />,
    label: 'Lightdash Preview Manager',
    path: '/lightdash/preview-manager',
    regex: /^\/lightdash\/preview-manager$/,
  },
  {
    element: <LightdashDashboardsAsCode />,
    label: 'Lightdash Dashboards as Code',
    path: '/lightdash/dashboards-as-code',
    regex: /^\/lightdash\/dashboards-as-code$/,
  },
];

const additionalRouteConfigs: WebRoute[] = [];

const apiChannels: {
  [id: string]: {
    resolve: (value: Promise<ApiResponse>) => void;
    reject: (err: unknown) => void;
  };
} = {};

/**
 * Shared mock file tree used by the Lightdash Dashboards-as-Code mocks so the
 * Explorer keeps showing files after a simulated download/upload.
 */
const MOCK_LIGHTDASH_TREE: LightdashYamlNode[] = [
  {
    name: 'charts',
    type: 'dir',
    path: 'lightdash/charts',
    children: [
      {
        name: 'sales_by_region.yml',
        type: 'file',
        path: 'lightdash/charts/sales_by_region.yml',
      },
      {
        name: 'top_customers.yml',
        type: 'file',
        path: 'lightdash/charts/top_customers.yml',
      },
    ],
  },
  {
    name: 'dashboards',
    type: 'dir',
    path: 'lightdash/dashboards',
    children: [
      {
        name: 'executive_overview.yml',
        type: 'file',
        path: 'lightdash/dashboards/executive_overview.yml',
      },
    ],
  },
];

/**
 * Mutable mock tree state so the dev server can model the
 * delete-files / list-files / download cycle realistically: clearing local
 * files empties the tree, downloading repopulates it.
 */
let mockTreeState: LightdashYamlNode[] = MOCK_LIGHTDASH_TREE;

/**
 * Streams a sequence of fake CLI log entries via `window` message events
 * (mirroring how the real extension host pushes `lightdash-yaml-log`
 * messages) and resolves once the last entry has been dispatched.
 */
function streamMockLightdashYamlLogs(
  entries: {
    message: string;
    level?: 'info' | 'success' | 'warning' | 'error';
  }[],
  stepMs = 120,
): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0;
    entries.forEach((entry, idx) => {
      elapsed += stepMs;
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'lightdash-yaml-log',
              log: {
                level: entry.level ?? 'info',
                message: entry.message,
                timestamp: new Date().toISOString(),
              },
            },
          }),
        );
        if (idx === entries.length - 1) {
          resolve();
        }
      }, elapsed);
    });
    if (entries.length === 0) {
      resolve();
    }
  });
}

export function AppProvider() {
  const { environment, route, vscode } = useEnvironment();
  // const [colorMode, setColorMode] = useColorMode();
  const [ready, setReady] = useState(false);

  const handleApi = useCallback(
    async (payload: ApiMessage): Promise<ApiResponse> => {
      let promise: Promise<ApiResponse>;
      switch (environment) {
        // In coder env, we attach a unique id to the request so we can send the response back to the correct channel
        case 'coder': {
          promise = new Promise<ApiResponse>((resolve, reject) => {
            const _channelId = uuid.v4();
            // We're assigning the resolve and reject functions to the channel obj so we can resolve the promise later
            apiChannels[_channelId] = { resolve, reject };
            const message = { ...payload, _channelId };
            vscode?.postMessage(message);
          });
          break;
        }
        // In web, we are just returning test responses
        case 'web': {
          promise = new Promise((resolve) => {
            // Simulate network delay with setTimeout
            setTimeout(() => {
              const payloadType = payload.type;
              switch (payloadType) {
                case 'dbt-fetch-modified-models': {
                  return resolve(
                    apiResponse<typeof payloadType>(['model_a', 'model_b']),
                  );
                }
                case 'dbt-fetch-projects': {
                  const projects = [createMockProject()];
                  return resolve(apiResponse<typeof payloadType>(projects));
                }
                case 'dbt-fetch-sources': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      'test_source_1',
                      'test_source_2',
                    ]),
                  );
                }
                case 'dbt-fetch-available-models': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      'model_a',
                      'model_b',
                      'model_c',
                      'model_d',
                      'model_e',
                    ]),
                  );
                }
                case 'dbt-get-model-info': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      modelName: 'sample_model',
                      projectName: 'sample_project',
                      projectPath: '/path/to/project',
                    }),
                  );
                }
                case 'dbt-parse-project': {
                  return resolve(
                    apiResponse<typeof payloadType>({} as DbtProjectManifest),
                  );
                }
                case 'dbt-run-model': {
                  return resolve(apiResponse<typeof payloadType>(null));
                }
                case 'dbt-fetch-models-with-tests': {
                  const emptyModelInfo = {
                    name: 'model_a',
                    testCount: 0,
                    testDetails: [],
                    hasJoins: false,
                    hasAggregates: false,
                    hasPortalPartitionDaily: false,
                    modelType: null,
                    existingDataTests: [],
                    fromModel: null,
                    firstJoinType: null,
                  };
                  return resolve(
                    apiResponse<typeof payloadType>({
                      modifiedModels: [emptyModelInfo],
                      availableModels: [
                        emptyModelInfo,
                        { ...emptyModelInfo, name: 'model_b' },
                      ],
                    }),
                  );
                }
                case 'dbt-add-model-tests': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      addedTests: [],
                    }),
                  );
                }
                case 'dbt-remove-model-tests': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      modelsUpdated: 0,
                    }),
                  );
                }
                case 'dbt-run-test': {
                  return resolve(apiResponse<typeof payloadType>(null));
                }
                case 'framework-model-create': {
                  return resolve(
                    apiResponse<typeof payloadType>(
                      'Model created successfully',
                    ),
                  );
                }
                case 'framework-model-update': {
                  return resolve(
                    apiResponse<typeof payloadType>(
                      'Model updated successfully',
                    ),
                  );
                }
                case 'framework-source-create': {
                  return resolve(
                    apiResponse<typeof payloadType>(
                      'Source created successfully',
                    ),
                  );
                }
                case 'lightdash-fetch-models': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        name: 'mart_product_data',
                        tags: ['lightdash', 'lightdash-explore'],
                        description: 'Product data mart model',
                      },
                      {
                        name: 'mart_daily_sales',
                        tags: ['lightdash-explore'],
                        description: 'Daily sales aggregation',
                      },
                      {
                        name: 'mart_user_analytics',
                        tags: [],
                        description: 'User analytics mart',
                      },
                    ]),
                  );
                }
                case 'lightdash-start-preview': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      url: 'https://lightdash.example.com/preview/175613134586',
                    }),
                  );
                }
                case 'lightdash-stop-preview': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'lightdash-fetch-previews': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        name: 'workspace-test',
                        url: 'https://lightdash.example.com/preview/123456',
                        createdAt: new Date(
                          Date.now() - 5 * 24 * 60 * 60 * 1000,
                        ).toISOString(),
                        models: ['mart_product_data', 'mart_daily_sales'],
                        status: 'active' as const,
                      },
                      {
                        name: 'old-preview',
                        url: 'https://lightdash.example.com/preview/654321',
                        createdAt: new Date(
                          Date.now() - 45 * 24 * 60 * 60 * 1000,
                        ).toISOString(),
                        models: ['mart_user_analytics'],
                        status: 'inactive' as const,
                      },
                    ]),
                  );
                }
                case 'lightdash-get-preview-name': {
                  return resolve(
                    apiResponse<typeof payloadType>('default-preview-name'),
                  );
                }
                case 'lightdash-add-log': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'lightdash-yaml-list-files': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      path: 'lightdash',
                      absolutePath: '/mock/workspace/lightdash',
                      tree: mockTreeState,
                    }),
                  );
                }
                case 'lightdash-yaml-read-file': {
                  const filePath = (payload.request as { path: string }).path;
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      content: `# ${filePath}\nversion: 1\nslug: ${filePath
                        .split('/')
                        .pop()
                        ?.replace(/\.ya?ml$/, '')}\n`,
                      absolutePath: `/mock/workspace/${filePath}`,
                    }),
                  );
                }
                case 'lightdash-yaml-edit-file': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'lightdash-yaml-download': {
                  const req = payload.request as {
                    scope?: 'all' | 'specific';
                    dashboardIds?: string[];
                    chartIds?: string[];
                  };
                  const args = ['download', '-p', 'lightdash'];
                  for (const id of req.dashboardIds ?? []) {
                    args.push('-d', id);
                  }
                  for (const id of req.chartIds ?? []) {
                    args.push('-c', id);
                  }
                  // Stream first, resolve only after the last log fires —
                  // matching the real extension flow where the CLI completes
                  // before the API response, so `activeLogChannel` stays set
                  // long enough for the streamed logs to land.
                  void streamMockLightdashYamlLogs([
                    { message: `$ lightdash ${args.join(' ')}` },
                    {
                      message:
                        req.scope === 'specific'
                          ? `Downloading ${(req.dashboardIds?.length ?? 0) + (req.chartIds?.length ?? 0)} resource(s)…`
                          : 'Downloading entire project…',
                    },
                    {
                      level: 'success',
                      message: 'Downloaded 3 charts and 1 dashboard.',
                    },
                  ]).then(() => {
                    // A mock download always restores the canonical tree so
                    // the Explorer re-populates after a clear.
                    mockTreeState = MOCK_LIGHTDASH_TREE;
                    resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        tree: mockTreeState,
                        absolutePath: '/mock/workspace/lightdash',
                      }),
                    );
                  });
                  return;
                }
                case 'lightdash-yaml-upload': {
                  const req = payload.request as {
                    chartSlugs?: string[];
                    dashboardSlugs?: string[];
                    force?: boolean;
                    includeCharts?: boolean;
                  };
                  const args = ['upload', '-p', 'lightdash'];
                  for (const slug of req.dashboardSlugs ?? []) {
                    args.push('-d', slug);
                  }
                  for (const slug of req.chartSlugs ?? []) {
                    args.push('-c', slug);
                  }
                  if (req.includeCharts) {
                    args.push('--include-charts');
                  }
                  if (req.force) {
                    args.push('--force');
                  }
                  const uploaded = [
                    ...(req.dashboardSlugs ?? []),
                    ...(req.chartSlugs ?? []),
                  ];
                  void streamMockLightdashYamlLogs([
                    { message: `$ lightdash ${args.join(' ')}` },
                    {
                      message:
                        uploaded.length === 0
                          ? 'Uploading entire project…'
                          : `Uploading ${uploaded.length} resource(s)…`,
                    },
                    {
                      level: 'success',
                      message: `Uploaded ${uploaded.length === 0 ? 'entire project' : `${uploaded.length} file(s)`}.`,
                    },
                  ]).then(() =>
                    resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        uploadedFiles: uploaded,
                      }),
                    ),
                  );
                  return;
                }
                case 'lightdash-yaml-check-upload-policy': {
                  // No `dj.lightdash.restrictedProjects` setting in the
                  // mocked browser/test environment, so always allow.
                  return resolve(
                    apiResponse<typeof payloadType>({ status: 'allow' }),
                  );
                }
                case 'lightdash-yaml-delete-files': {
                  // Clear the mocked working directory so the next list-files
                  // returns "No files yet." until a download repopulates it.
                  mockTreeState = [];
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'lightdash-yaml-get-default-path': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      path: 'lightdash',
                      absolutePath: '/mock/workspace/lightdash',
                    }),
                  );
                }
                case 'lightdash-yaml-get-download-defaults': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      addPathToGitignore: true,
                    }),
                  );
                }
                case 'lightdash-yaml-set-default-path': {
                  const newPath = (payload.request as { path: string }).path;
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      absolutePath: `/mock/workspace/${newPath}`,
                    }),
                  );
                }
                case 'data-explorer-get-model-lineage': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      current: {
                        id: 'model.data_marts.int_orders',
                        name: 'int_orders',
                        type: 'model',
                        description:
                          'Intermediate orders model joining orders with customers',
                        tags: ['intermediate', 'orders'],
                        path: 'models/intermediate/int_orders.sql',
                        schema: 'analytics',
                        database: 'analytics_db',
                        materialized: 'incremental',
                        testCount: 3,
                        hasOwnUpstream: true,
                        hasOwnDownstream: true,
                      },
                      upstream: [
                        {
                          id: 'model.data_marts.stg_orders',
                          name: 'stg_orders',
                          type: 'model',
                          description:
                            'Staging model for orders with basic transformations',
                          tags: ['staging'],
                          path: 'models/staging/stg_orders.sql',
                          schema: 'analytics',
                          database: 'analytics_db',
                          materialized: 'view',
                          testCount: 2,
                          hasOwnUpstream: true, // Has source upstream
                          hasOwnDownstream: true,
                        },
                        {
                          id: 'model.data_marts.base_customers',
                          name: 'base_customers',
                          type: 'model',
                          description:
                            'Ephemeral base model for customer transformations',
                          tags: ['base'],
                          path: 'models/base/base_customers.sql',
                          schema: 'analytics',
                          database: 'analytics_db',
                          materialized: 'ephemeral',
                          testCount: 0,
                          hasOwnUpstream: false, // No further upstream
                          hasOwnDownstream: true,
                        },
                        {
                          id: 'seed.data_marts.country_codes',
                          name: 'country_codes',
                          type: 'seed',
                          description: 'Seed file with country code mappings',
                          tags: ['seed'],
                          path: 'seeds/country_codes.csv',
                          schema: 'analytics',
                          database: 'analytics_db',
                          testCount: 1,
                          hasOwnUpstream: false, // Seeds have no upstream
                          hasOwnDownstream: true,
                        },
                        {
                          id: 'source.data_marts.raw_orders',
                          name: 'raw_orders',
                          type: 'source',
                          description: 'Raw orders from source system',
                          tags: ['source'],
                          path: 'models/sources.yml',
                          schema: 'raw',
                          database: 'source_db',
                          testCount: 0,
                          hasOwnUpstream: false, // Sources have no upstream
                          hasOwnDownstream: true,
                        },
                      ],
                      downstream: [
                        {
                          id: 'model.data_marts.fct_orders',
                          name: 'fct_orders',
                          type: 'model',
                          description: 'Final fact table for orders',
                          tags: ['mart', 'fact'],
                          path: 'models/marts/fct_orders.sql',
                          schema: 'analytics',
                          database: 'analytics_db',
                          materialized: 'table',
                          testCount: 5,
                          hasOwnUpstream: true,
                          hasOwnDownstream: false, // No further downstream
                        },
                      ],
                      // Mock Lightdash data so the new node can be exercised in
                      // browser dev mode. The mocked current model is named
                      // `int_orders`, not a mart, so the production extension
                      // would suppress these - but in dev mode we surface them
                      // to make the UI testable end-to-end.
                      lightdashEnabled: true,
                      lightdashAvailable: true,
                      lightdashResolvedPath: 'lightdash',
                      lightdashDownstream: [
                        {
                          id: 'lightdash::dashboard::executive-overview',
                          slug: 'executive-overview',
                          name: 'Executive Overview',
                          kind: 'dashboard',
                          // Mock charts cover all three popover row
                          // states so the Eye / EyeSlash / Warning icons,
                          // italic muted name, and per-row action button
                          // overrides can be exercised without a real
                          // Lightdash content directory:
                          // - `tile`    → Eye icon, default styling
                          // - `hidden`  → EyeSlash icon (saved-within)
                          // - `missing` → amber warning, italic name,
                          //               Open YAML hidden, Open in
                          //               Lightdash tooltip warns the
                          //               chart may have been removed.
                          charts: [
                            {
                              slug: 'orders-by-region',
                              name: 'Orders by Region',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/orders-by-region',
                              filePath: 'lightdash/charts/orders-by-region.yml',
                              embeddedAsTile: true,
                              hasYaml: true,
                            },
                            {
                              slug: 'top-customers',
                              name: 'Top Customers',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/top-customers',
                              filePath: 'lightdash/charts/top-customers.yml',
                              embeddedAsTile: true,
                              hasYaml: true,
                            },
                            {
                              slug: 'orders-by-region-drilldown',
                              name: 'Orders by Region (Drill-down)',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/orders-by-region-drilldown',
                              filePath:
                                'lightdash/charts/orders-by-region-drilldown.yml',
                              embeddedAsTile: false,
                              hasYaml: true,
                            },
                            {
                              slug: 'removed-chart',
                              name: 'Removed Chart',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/removed-chart',
                              filePath: '',
                              embeddedAsTile: true,
                              hasYaml: false,
                            },
                          ],
                          url: 'https://example.lightdash.cloud/projects/mock/dashboards/executive-overview/view',
                          filePath:
                            'lightdash/dashboards/executive-overview.yml',
                        },
                        {
                          id: 'lightdash::standalone-charts::int_orders',
                          slug: 'int_orders::standalone-charts',
                          name: 'Standalone Charts',
                          kind: 'standalone-charts',
                          filePath: '',
                          charts: [
                            {
                              slug: 'orders-funnel-debug',
                              name: 'Orders Funnel (Debug)',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/orders-funnel-debug',
                              filePath:
                                'lightdash/charts/orders-funnel-debug.yml',
                            },
                            {
                              slug: 'one-off-revenue-spike',
                              name: 'One-off Revenue Spike Investigation',
                              url: 'https://example.lightdash.cloud/projects/mock/saved/one-off-revenue-spike',
                              filePath:
                                'lightdash/charts/one-off-revenue-spike.yml',
                            },
                          ],
                        },
                      ],
                    }),
                  );
                }
                case 'data-explorer-open-lightdash-url': {
                  console.log(
                    '[Mock] Opening Lightdash URL:',
                    (payload.request as { url: string }).url,
                  );
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'data-explorer-set-lightdash-toggle': {
                  const enabled = (payload.request as { enabled: boolean })
                    .enabled;
                  console.log('[Mock] Setting Lightdash toggle:', enabled);
                  return resolve(apiResponse<typeof payloadType>({ enabled }));
                }
                case 'data-explorer-open-dashboards-as-code': {
                  console.log('[Mock] Opening Dashboards as Code panel');
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'data-explorer-open-lightdash-yaml': {
                  console.log(
                    '[Mock] Opening Lightdash YAML file:',
                    (payload.request as { filePath: string }).filePath,
                  );
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'lightdash-yaml-ensure-gitignore': {
                  const path = (payload.request as { path: string }).path;
                  console.log('[Mock] Ensuring .gitignore contains:', path);
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      added: true,
                      alreadyPresent: false,
                      gitignorePath: '/mock/workspace/.gitignore',
                    }),
                  );
                }
                case 'data-explorer-execute-query': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      columns: [
                        'order_id',
                        'customer_id',
                        'order_date',
                        'total_amount',
                      ],
                      rows: [
                        [1, 101, '2024-01-15', 150.5],
                        [2, 102, '2024-01-16', 275.0],
                        [3, 101, '2024-01-17', 99.99],
                        [4, 103, '2024-01-18', 450.25],
                      ],
                      rowCount: 4,
                      executionTime: 1250,
                    }),
                  );
                }
                case 'data-explorer-get-compiled-sql': {
                  const request = payload.request as {
                    modelName?: string;
                    projectName?: string;
                  };
                  const modelName = request.modelName || 'int_orders';
                  return resolve(
                    apiResponse<typeof payloadType>({
                      sql: `-- Compiled SQL for ${modelName}
-- Generated by dbt

WITH base_orders AS (
    SELECT
        order_id,
        customer_id,
        CAST(order_date AS DATE) AS order_date,
        ROUND(total_amount, 2) AS total_amount,
        status
    FROM "raw"."ecommerce"."orders"
    WHERE order_date >= DATE '2024-01-01'
),

customer_aggregates AS (
    SELECT
        customer_id,
        COUNT(*) AS order_count,
        SUM(total_amount) AS total_spent,
        MIN(order_date) AS first_order_date,
        MAX(order_date) AS last_order_date
    FROM base_orders
    GROUP BY customer_id
),

final AS (
    SELECT
        b.order_id,
        b.customer_id,
        b.order_date,
        b.total_amount,
        b.status,
        c.order_count AS customer_total_orders,
        c.total_spent AS customer_lifetime_value
    FROM base_orders b
    LEFT JOIN customer_aggregates c
        ON b.customer_id = c.customer_id
)

SELECT * FROM final`,
                      compiledPath: `/path/to/target/compiled/project/models/${modelName}.sql`,
                      lastModified: Date.now() - 1000 * 60 * 15, // 15 minutes ago
                    }),
                  );
                }
                case 'data-explorer-ready': {
                  return resolve(apiResponse<typeof payloadType>(undefined));
                }
                case 'data-explorer-detect-active-model': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      modelName: 'mock_model',
                      projectName: 'mock_project',
                    }),
                  );
                }
                case 'dbt-model-compile': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: true,
                      message: 'Model compiled successfully',
                    }),
                  );
                }
                case 'data-explorer-open-model-file': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'data-explorer-get-project-overview': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      projectName: 'mock_project',
                      groups: [
                        {
                          layer: 'staging',
                          label: 'Staging Models',
                          items: [
                            {
                              id: 'model.mock_project.stg__customers',
                              name: 'stg__customers',
                              type: 'model',
                              testCount: 3,
                            },
                          ],
                        },
                        {
                          layer: 'intermediate',
                          label: 'Intermediate Models',
                          items: [
                            {
                              id: 'model.mock_project.int__customer_orders',
                              name: 'int__customer_orders',
                              type: 'model',
                              materialized: 'ephemeral',
                              testCount: 1,
                            },
                          ],
                        },
                        {
                          layer: 'mart',
                          label: 'Mart Models',
                          items: [
                            {
                              id: 'model.mock_project.mart__customers',
                              name: 'mart__customers',
                              type: 'model',
                              materialized: 'incremental',
                              testCount: 5,
                            },
                          ],
                        },
                      ],
                    }),
                  );
                }
                case 'data-explorer-open-with-model': {
                  console.log(
                    '[Mock] Opening Data Explorer with model:',
                    payload.request,
                  );
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'dbt-check-compiled-status': {
                  // Mock: randomly return compiled/not compiled for demonstration
                  const isCompiled = Math.random() > 0.5;
                  return resolve(
                    apiResponse<typeof payloadType>({
                      isCompiled,
                      compiledPath: isCompiled
                        ? '/path/to/target/compiled/data_marts/models/int_orders.sql'
                        : undefined,
                      lastCompiled: isCompiled
                        ? new Date(Date.now() - 3600000).toISOString()
                        : undefined,
                    }),
                  );
                }
                case 'dbt-check-model-outdated': {
                  // Mock: randomly return outdated/up-to-date for demonstration
                  const isOutdated = Math.random() > 0.5;
                  const hasCompiledFile = Math.random() > 0.3;
                  return resolve(
                    apiResponse<typeof payloadType>({
                      isOutdated,
                      hasCompiledFile,
                      reason: isOutdated
                        ? 'Source file has changed since last compilation'
                        : undefined,
                    }),
                  );
                }
                case 'dbt-compile-with-logs': {
                  // Mock: simulate compilation with delay and logs
                  // In real implementation, logs come via postMessage
                  setTimeout(() => {
                    resolve(apiResponse<typeof payloadType>({ success: true }));
                  }, 2000);
                  return;
                }
                case 'trino-fetch-catalogs': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      'catalog_1',
                      'catalog_2',
                      'catalog_3',
                      'catalog_4',
                      'catalog_5',
                    ]),
                  );
                }
                case 'trino-fetch-columns': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        column: 'column_1',
                        type: 'varchar',
                        extra: '',
                        comment: '',
                      },
                      {
                        column: 'column_2',
                        type: 'varchar',
                        extra: '',
                        comment: '',
                      },
                      {
                        column: 'column_3',
                        type: 'varchar',
                        extra: '',
                        comment: '',
                      },
                    ]),
                  );
                }
                case 'trino-fetch-etl-sources': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        source_id: 'source_1',
                        properties: '{}',
                        etl_active: true,
                      },
                      {
                        source_id: 'source_2',
                        properties: '{}',
                        etl_active: false,
                      },
                    ]),
                  );
                }
                case 'trino-fetch-schemas': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      'schema_1',
                      'schema_2',
                      'schema_3',
                      'schema_4',
                      'schema_5',
                    ]),
                  );
                }
                case 'trino-fetch-system-nodes': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        coordinator: true,
                        http_uri: 'http://localhost:8080',
                        node_id: 'node_1',
                        node_version: 1,
                        state: 'active',
                      },
                      {
                        coordinator: false,
                        http_uri: 'http://localhost:8081',
                        node_id: 'node_2',
                        node_version: 1,
                        state: 'active',
                      },
                    ]),
                  );
                }
                case 'trino-fetch-tables': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      'table_1',
                      'table_2',
                      'table_3',
                      'table_4',
                      'table_5',
                    ]),
                  );
                }
                case 'trino-fetch-active-queries': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      source: 'cli',
                      profileName: null,
                      rows: [
                        {
                          queryId: '20250511_180000_00001_abc',
                          state: 'RUNNING',
                          user: 'mock_user',
                          source: 'dbt-trino-1.7.17',
                          catalog: 'hive',
                          schema: 'analytics',
                          created: new Date(Date.now() - 60_000).toISOString(),
                          started: new Date(Date.now() - 55_000).toISOString(),
                          wallTimeMs: 55_000,
                          cpuTimeMs: 38_000,
                          peakUserMemoryBytes: 1_200_000_000,
                          totalSplits: 240,
                          completedSplits: 142,
                          runningSplits: 12,
                          queuedSplits: 86,
                        },
                        {
                          queryId: '20250511_175900_00000_xyz',
                          state: 'FINISHED',
                          user: 'mock_user',
                          source: 'lightdash',
                          catalog: 'hive',
                          schema: 'analytics',
                          created: new Date(Date.now() - 600_000).toISOString(),
                          started: new Date(Date.now() - 595_000).toISOString(),
                          ended: new Date(Date.now() - 540_000).toISOString(),
                          wallTimeMs: 55_000,
                          cpuTimeMs: 41_200,
                          peakUserMemoryBytes: 850_000_000,
                          totalSplits: 180,
                          completedSplits: 180,
                        },
                      ],
                    }),
                  );
                }
                case 'trino-fetch-persisted-queries': {
                  return resolve(
                    apiResponse<typeof payloadType>([
                      {
                        queryId: '20250510_120000_00000_yesterday',
                        persistedAt: new Date(
                          Date.now() - 24 * 3600 * 1000,
                        ).toISOString(),
                        jsonPath:
                          '/mock/workspace/.dj/diagnostics/20250510_120000_00000_yesterday.json',
                        profileName: 'prod',
                        coordinatorUrl: 'https://trino-prod.example.com:443',
                        summary: {
                          queryId: '20250510_120000_00000_yesterday',
                          state: 'FAILED',
                          user: 'mock_user',
                          source: 'dbt-trino-1.7.17',
                          wallTimeMs: 12_000,
                          peakUserMemoryBytes: 950_000_000,
                          errorCode: 'EXCEEDED_LOCAL_MEMORY_LIMIT',
                          failureMessage:
                            'Query exceeded per-node memory limit of 8GB',
                        },
                      },
                      {
                        // Legacy entry written before profile-stamping
                        // landed — exercises the History tab's
                        // "(none)" profile filter bucket and the
                        // "no badge" QueryRow rendering path.
                        queryId: '20250509_090000_00000_legacy',
                        persistedAt: new Date(
                          Date.now() - 48 * 3600 * 1000,
                        ).toISOString(),
                        jsonPath:
                          '/mock/workspace/.dj/diagnostics/20250509_090000_00000_legacy.json',
                        summary: {
                          queryId: '20250509_090000_00000_legacy',
                          state: 'FINISHED',
                          user: 'other_user',
                          source: 'lightdash',
                          wallTimeMs: 3_500,
                          peakUserMemoryBytes: 120_000_000,
                        },
                      },
                    ]),
                  );
                }
                case 'trino-delete-persisted-query': {
                  const req = payload.request as { queryId: string };
                  return resolve(
                    apiResponse<typeof payloadType>({
                      queryId: req.queryId,
                      deleted: true,
                    }),
                  );
                }
                case 'trino-fetch-query-info': {
                  const req = payload.request as {
                    queryId: string;
                    prefer?: 'persisted' | 'rest';
                  };
                  return resolve(
                    apiResponse<typeof payloadType>({
                      summary: {
                        queryId: req.queryId,
                        state: 'FINISHED',
                        user: 'mock_user',
                        source: 'dbt-trino-1.7.17',
                        catalog: 'hive',
                        schema: 'analytics',
                        wallTimeMs: 55_000,
                        cpuTimeMs: 41_200,
                        peakUserMemoryBytes: 850_000_000,
                        peakTotalMemoryBytes: 950_000_000,
                        totalSplits: 180,
                        completedSplits: 180,
                        blockedTimeMs: 4_000,
                        dataSkewScore: 1.2,
                        largestOperator: 'LookupJoinOperator',
                        connectorTypes: ['hive'],
                      },
                      query:
                        '/* {"app": "dbt", "node_id": "model.mock_project.int__finance__billing__daily"} */\nselect * from analytics.daily',
                      modelMatch: {
                        project: 'mock_project',
                        modelName: 'int__finance__billing__daily',
                        modelJsonPath:
                          '/mock/workspace/models/intermediate/finance/billing/int__finance__billing__daily.model.json',
                        matchedBy: 'comment',
                      },
                      operatorSummary: [
                        {
                          operatorType: 'LookupJoinOperator',
                          pipelineId: 1,
                          inputPositions: 12_000_000,
                          outputPositions: 11_800_000,
                          cpuNanos: 18_000_000_000,
                          peakMemoryReservation: 600_000_000,
                        },
                        {
                          operatorType: 'TableScanOperator',
                          pipelineId: 0,
                          inputPositions: 12_000_000,
                          outputPositions: 12_000_000,
                          cpuNanos: 8_000_000_000,
                          peakMemoryReservation: 120_000_000,
                        },
                      ],
                      loadedFrom: req.prefer === 'rest' ? 'rest' : 'persisted',
                      jsonPath: `/mock/workspace/.dj/diagnostics/${req.queryId}.json`,
                    }),
                  );
                }
                case 'trino-analyze-query': {
                  const req = payload.request as { queryId: string };
                  return resolve(
                    apiResponse<typeof payloadType>({
                      queryId: req.queryId,
                      jsonPath: `/mock/workspace/.dj/diagnostics/${req.queryId}.json`,
                      fullJsonPath: `/mock/workspace/.dj/diagnostics/${req.queryId}.full.json`,
                      modelMatch: {
                        project: 'mock_project',
                        modelName: 'int__finance__billing__daily',
                        modelJsonPath:
                          '/mock/workspace/models/intermediate/finance/billing/int__finance__billing__daily.model.json',
                        matchedBy: 'comment',
                      },
                      promptSnippet: `Read .dj/diagnostics/${req.queryId}.json and apply the dj-trino-analyzer skill.`,
                    }),
                  );
                }
                case 'trino-list-profiles': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      active: 'dev',
                      profiles: [
                        {
                          name: 'dev',
                          coordinatorUrl: 'https://trino.dev.example.com',
                          user: 'mock_user',
                          authMethod: 'basic',
                          authSource: 'secret-storage',
                          verifyTls: true,
                        },
                        {
                          name: 'prod',
                          coordinatorUrl: 'https://trino.prod.example.com',
                          user: 'mock_user',
                          authMethod: 'bearer',
                          authSource: 'env-var',
                          secretEnvVar: 'TRINO_PROD_BEARER',
                        },
                      ],
                    }),
                  );
                }
                case 'trino-save-profile': {
                  return resolve(apiResponse<typeof payloadType>({ ok: true }));
                }
                case 'trino-delete-profile': {
                  return resolve(apiResponse<typeof payloadType>({ ok: true }));
                }
                case 'trino-set-active-profile': {
                  return resolve(apiResponse<typeof payloadType>({ ok: true }));
                }
                case 'trino-set-credentials': {
                  return resolve(apiResponse<typeof payloadType>({ ok: true }));
                }
                case 'trino-ping-coordinator': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      ok: true,
                      version: '470',
                      environment: 'mock',
                    }),
                  );
                }
                case 'trino-jump-to-model-from-query': {
                  return resolve(
                    apiResponse<typeof payloadType>({
                      matched: true,
                      modelMatch: {
                        project: 'mock_project',
                        modelName: 'int__finance__billing__daily',
                        modelJsonPath:
                          '/mock/workspace/models/intermediate/finance/billing/int__finance__billing__daily.model.json',
                        matchedBy: 'comment',
                      },
                    }),
                  );
                }
                case 'state-save': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'state-load': {
                  return resolve(
                    apiResponse<typeof payloadType>({ data: null }),
                  );
                }
                case 'state-clear': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'framework-get-current-model-data': {
                  // Return mock data for testing edit flow in local web development
                  const mockResponse = getMockEditFlowResponse();
                  if (mockResponse) {
                    return resolve(
                      apiResponse<typeof payloadType>(mockResponse),
                    );
                  }
                  break;
                }
                case 'framework-close-panel': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'framework-show-message': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'framework-open-external-url': {
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'framework-get-model-data': {
                  return resolve(apiResponse<typeof payloadType>(null));
                }
                case 'framework-get-model-settings': {
                  // Mock model settings for web development
                  const mockSettings = {
                    loadedSteps: [''], // Mock some pre-loaded steps for testing
                  };
                  return resolve(apiResponse<typeof payloadType>(mockSettings));
                }
                case 'framework-set-model-settings': {
                  // Mock success response for web development
                  return resolve(
                    apiResponse<typeof payloadType>({ success: true }),
                  );
                }
                case 'framework-model-preview': {
                  // Mock preview response for web development
                  const request = payload.request as unknown as {
                    projectName: string;
                    modelJson: Partial<FrameworkModel>;
                  };

                  // Remove empty values from the model json
                  const json = removeEmpty(request.modelJson);

                  return resolve(
                    apiResponse<typeof payloadType>({
                      json: JSON.stringify(json, null, 4),
                      sql: `-- Mock SQL Preview\n-- Model: ${request.modelJson.name || 'unnamed'}\n\nSELECT * FROM mock_table;`,
                      yaml: `# Mock YAML Preview\nversion: "2"\nmodels:\n  - name: ${request.modelJson.name || 'unnamed'}\n    description: "Mock model"`,
                      columns: [
                        {
                          name: 'mock_column_1',
                          description: 'Mock dimension column',
                          type: 'dim' as const,
                          dataType: 'varchar',
                        },
                        {
                          name: 'mock_column_2',
                          description: 'Mock fact column',
                          type: 'fct' as const,
                          dataType: 'bigint',
                        },
                      ],
                    }),
                  );
                }
                case 'framework-get-original-model-files': {
                  // Mock original files response for web development
                  return resolve(
                    apiResponse<typeof payloadType>({
                      json: '{\n  "name": "sample_model",\n  "type": "int_join_models"\n}',
                      sql: '-- Original SQL file\nSELECT * FROM original_table;',
                      yaml: '# Original YAML file\nversion: "2"\nmodels:\n  - name: sample_model',
                    }),
                  );
                }
                case 'framework-column-lineage': {
                  // Mock unified column lineage API for web development
                  const action = (
                    payload.request as unknown as { action: string }
                  ).action;
                  if (action === 'webview-ready') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                      }),
                    );
                  }
                  if (action === 'validate') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        modelName: 'sample_model',
                      }),
                    );
                  }
                  if (action === 'get-columns') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        modelName: 'sample_model',
                        columns: [
                          {
                            name: 'customer_id',
                            data_type: 'varchar',
                            description: 'Customer identifier',
                            tags: [],
                            meta: { type: 'dim' as const },
                            internal: {},
                          },
                          {
                            name: 'order_count',
                            data_type: 'bigint',
                            description: 'Total number of orders',
                            tags: [],
                            meta: { type: 'fct' as const },
                            internal: {},
                          },
                        ],
                      }),
                    );
                  }
                  if (action === 'compute') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        modelName: 'sample_model',
                        dag: {
                          targetColumn: 'customer_id',
                          nodes: [
                            {
                              id: 'source.customer_id',
                              columnName: 'customer_id',
                              modelName: 'source',
                              modelLayer: 'source' as const,
                              modelType: 'source',
                              dataType: 'varchar',
                              description: 'Customer ID from source',
                              transformation: 'raw' as const,
                            },
                            {
                              id: 'stg_customers.customer_id',
                              columnName: 'customer_id',
                              modelName: 'stg_customers',
                              modelLayer: 'staging' as const,
                              modelType: 'stg_select_source',
                              dataType: 'varchar',
                              description: 'Customer identifier',
                              transformation: 'passthrough' as const,
                            },
                          ],
                          edges: [
                            {
                              source: 'source.customer_id',
                              target: 'stg_customers.customer_id',
                              transformation: 'passthrough' as const,
                            },
                          ],
                          roots: ['source.customer_id'],
                          leaves: ['stg_customers.customer_id'],
                          hasMoreUpstream: false,
                          hasMoreDownstream: true,
                        },
                      }),
                    );
                  }
                  // Mock source-related actions for web development
                  if (action === 'get-source-tables') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        sourceName: 'sample_source',
                        tables: [
                          { name: 'raw_customers', columnCount: 5 },
                          { name: 'raw_orders', columnCount: 8 },
                          { name: 'raw_products', columnCount: 12 },
                        ],
                      }),
                    );
                  }
                  if (action === 'get-source-columns') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        modelName: 'sample_source.raw_customers',
                        columns: [
                          {
                            name: 'id',
                            data_type: 'varchar',
                            description: 'Primary key',
                            tags: [],
                            meta: { type: 'dim' as const },
                            internal: {},
                          },
                          {
                            name: 'name',
                            data_type: 'varchar',
                            description: 'Customer name',
                            tags: [],
                            meta: { type: 'dim' as const },
                            internal: {},
                          },
                          {
                            name: 'email',
                            data_type: 'varchar',
                            description: 'Customer email',
                            tags: [],
                            meta: { type: 'dim' as const },
                            internal: {},
                          },
                        ],
                      }),
                    );
                  }
                  if (action === 'compute-source-lineage') {
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        dag: {
                          targetColumn: 'source.sample.raw_customers.id',
                          nodes: [
                            {
                              id: 'source.sample.raw_customers.id',
                              columnName: 'id',
                              modelName: 'sample_source.raw_customers',
                              modelLayer: 'source' as const,
                              modelType: 'source',
                              dataType: 'varchar',
                              description: 'Primary key',
                              transformation: 'raw' as const,
                            },
                            {
                              id: 'model.stg_customers.customer_id',
                              columnName: 'customer_id',
                              modelName: 'stg_customers',
                              modelLayer: 'staging' as const,
                              modelType: 'stg_select_source',
                              dataType: 'varchar',
                              description:
                                'Customer identifier (renamed from id)',
                              transformation: 'renamed' as const,
                              expression: 'id',
                            },
                          ],
                          edges: [
                            {
                              source: 'source.sample.raw_customers.id',
                              target: 'model.stg_customers.customer_id',
                              transformation: 'renamed' as const,
                              expression: 'id',
                            },
                          ],
                          roots: ['source.sample.raw_customers.id'],
                          leaves: ['model.stg_customers.customer_id'],
                          hasMoreUpstream: false,
                          hasMoreDownstream: true,
                        },
                      }),
                    );
                  }
                  return resolve(
                    apiResponse<typeof payloadType>({
                      success: false,
                      error: `Unknown action: ${action}`,
                    }),
                  );
                }
                case 'framework-preferences': {
                  // Mock preferences API for web development
                  const action = (
                    payload.request as unknown as { action: string }
                  ).action;
                  const context = (
                    payload.request as unknown as { context: string }
                  ).context;

                  if (action === 'get') {
                    if (context === 'default-incremental-strategy') {
                      return resolve(
                        apiResponse<typeof payloadType>({
                          success: true,
                          value: DEFAULT_INCREMENTAL_STRATEGY,
                        }),
                      );
                    }
                    let value = true; // Default value for web development
                    if (context === 'data-explorer') {
                      value = false; // Data explorer defaults to disabled
                    }
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        value,
                      }),
                    );
                  }
                  if (action === 'set') {
                    const value = (payload.request as { value?: boolean })
                      .value;
                    return resolve(
                      apiResponse<typeof payloadType>({
                        success: true,
                        value: typeof value === 'boolean' ? value : true,
                      }),
                    );
                  }
                  break;
                }
                case 'framework-check-model-exists': {
                  // Mock file existence check for web development
                  const request = payload.request as unknown as {
                    projectName: string;
                    modelJson: {
                      type: string;
                      group: string;
                      topic: string;
                      name: string;
                    };
                  };

                  // Extract model layer from type (stg, int, mart)
                  const layer = request.modelJson.type?.split('_')[0] || 'int';

                  // Normalize topic (replace slashes with double underscores)
                  const normalizedTopic =
                    request.modelJson.topic?.replace(/\//g, '__') || '';

                  // Generate the file name
                  const fileName = `${layer}__${request.modelJson.group}__${normalizedTopic}__${request.modelJson.name}.model.json`;
                  const filePath = `/mock/path/to/models/${layer}/${request.modelJson.group}/${request.modelJson.topic}/${fileName}`;

                  // Simulate file exists scenario: if model name contains "existing", pretend it exists
                  // This allows testing both success and error states
                  const exists =
                    request.modelJson.name
                      ?.toLowerCase()
                      .includes('existing') || false;

                  return resolve(
                    apiResponse<typeof payloadType>({
                      exists,
                      fileName,
                      filePath,
                    }),
                  );
                }
                case 'query-draft-create': {
                  // Mock query draft creation for web development
                  const filepath = `.dj/drafts/${Date.now()}.draft.sql`;
                  return resolve(apiResponse<typeof payloadType>({ filepath }));
                }
                case 'query-draft-execute': {
                  // Mock query execution for web development
                  const mockColumns = ['id', 'name', 'value', 'created_at'];
                  const mockRows = [
                    [1, 'Alice', 100, '2025-01-01'],
                    [2, 'Bob', 200, '2025-01-02'],
                    [3, 'Charlie', 300, '2025-01-03'],
                  ];
                  return resolve(
                    apiResponse<typeof payloadType>({
                      columns: mockColumns,
                      rows: mockRows,
                      rowCount: mockRows.length,
                      executionTime: 150,
                    }),
                  );
                }
                default:
                  return assertExhaustive<ApiResponse>(payloadType);
              }
            }, 1000);
          });
        }
      }

      return await promise;
    },
    [environment, vscode],
  );

  const api = useMemo(
    () => ({
      post: handleApi as ApiHandler,
    }),
    [handleApi],
  );

  /** Listen for message to come back from parent iframe and update the channel so api request can resolve */
  const handleMessage = useCallback((event: MessageEvent) => {
    const _channelId = event.data?._channelId;
    if (!_channelId) return;
    const apiChannel = apiChannels[_channelId];
    if (!apiChannel) return;
    const { err, response } = event.data;
    if (err) {
      apiChannel.reject(err);
    } else if (response) {
      apiChannel.resolve(response);
    }
    delete apiChannels[_channelId];
  }, []);

  useMount(() => {
    switch (environment) {
      case 'coder': {
        // Listen for messages from parent iframe
        window.addEventListener('message', handleMessage);
        break;
      }
      case 'web': {
        break;
      }
    }
    setReady(true);
  });

  useUnmount(() => {
    window.removeEventListener('message', handleMessage);
  });

  const value: AppValue = useMemo(
    () => ({ api, environment, vscode }),
    [api, environment, vscode],
  );

  if (!ready) return null;

  return (
    <AppContext.Provider value={value}>
      <TrinoProvider initialValue={{}}>
        <RenderRoute route={route} />
      </TrinoProvider>
    </AppContext.Provider>
  );
}

function RenderRoute({ route }: { route: string | null }) {
  // Combine all route configs
  const allRouteConfigs = [...routeConfigs, ...additionalRouteConfigs];

  if (route) {
    // Running in extension at specific route
    const routeConfig = allRouteConfigs.find((r) => r.regex.test(route));
    if (!routeConfig) {
      return <div>404: Route not found</div>;
    }
    // Split off the query string so react-router's `pathname` doesn't
    // include `?queryId=…`. Treat everything after the first `?` as
    // `search` verbatim — we never re-parse it here, so a malformed
    // trailer can't break route matching.
    const qIdx = route.indexOf('?');
    const pathname = qIdx >= 0 ? route.slice(0, qIdx) : route;
    const search = qIdx >= 0 ? route.slice(qIdx) : '';
    // Even though we're running in the extesion, wrap this like a browser route, so we can use react-router hooks
    return (
      <BrowserRouter basename="/">
        <Routes location={{ pathname, search }}>
          <Route path={routeConfig.path} element={routeConfig.element} />
        </Routes>
      </BrowserRouter>
    );
  } else {
    // Running in separate browser
    const router = createBrowserRouter(allRouteConfigs);
    return <RouterProvider router={router} />;
  }
}
