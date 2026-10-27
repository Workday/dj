import { v4 as uuidv4 } from 'uuid';

/**
 * Mock test data for testing edit flow in local web development
 * This simulates the data structure returned by framework-get-current-model-data API
 * Model names match those in web/src/features/DataModeling/mock/mockData.ts
 */

// Mock data for a SELECT model (simpler case)
export const mockSelectModelData = {
  modelData: {
    projectName: 'demo_data_platform',
    name: 'stg__analytics__cloud__raw_usage_data',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/staging/analytics/cloud/stg__analytics__cloud__raw_usage_data.model.json',
    group: 'analytics',
    topic: 'cloud',
    type: 'stg_select_model',
    source: 'staging',
    from: {
      model: 'stg__analytics__cloud__raw_usage_data',
    },
    select: [
      {
        model: 'stg__analytics__cloud__raw_usage_data',
        type: 'all_from_model',
      },
    ],
  },
  editFormType: 'model-stg__analytics__cloud__raw_usage_data',
  isEditMode: true,
};

// Mock data for a JOIN model (complex case with multiple joins) - matches format from user request
export const mockJoinModelData = {
  modelData: {
    projectName: 'demo_data_platform',
    name: 'int__sales__inventory__billing_raw',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/intermediate/sales/inventory/int__sales__inventory__billing_raw.model.json',
    group: 'sales',
    topic: 'inventory',
    type: 'int_join_models',
    source: 'intermediate',
    description: 'this is a sample description',
    tags: ['lightdash'],
    materialization: 'incremental',
    from: {
      model: 'stg__demo__models__deployments',
      join: [
        {
          model: 'stg__sales__inventory__product_metrics',
          on: {
            and: [
              {
                expr: 'stg__sales__inventory__product_metrics.category = stg__demo__models__deployments.category',
              },
              {
                expr: 'stg__sales__inventory__product_metrics.region = stg__demo__models__deployments.region',
              },
              {
                expr: '{{ var("environment") }} = product_metrics.environment',
              },
              {
                expr: 'region IS NOT NULL',
              },
            ],
          },
          type: 'left',
          _uuid: uuidv4(),
        },
        {
          model: 'int__analytics__cloud__billing_hourly_aggregated',
          on: {
            and: [
              {
                expr: 'int__analytics__cloud__billing_hourly_aggregated.created_at >= stg__sales__inventory__product_metrics.usage_hour',
              },
              {
                expr: 'stg__sales__inventory__product_metrics.environment = int__analytics__cloud__billing_hourly_aggregated.billing_period',
              },
              {
                expr: '{{ get_current_timestamp() }} > billing.usage_hour',
              },
            ],
          },
          type: 'left',
          _uuid: uuidv4(),
        },
      ],
    },
    select: [
      {
        model: 'stg__demo__models__deployments',
        type: 'all_from_model',
      },
      {
        model: 'int__analytics__cloud__billing_hourly_aggregated',
        type: 'dims_from_model',
      },
      {
        model: 'stg__sales__inventory__product_metrics',
        type: 'fcts_from_model',
      },
    ],
    lightdash: {
      table: {
        group_label: 'group_label',
        label: 'label',
      },
      metrics: [
        {
          name: 'test_metric',
          type: 'count',
        },
      ],
      metrics_exclude: ['metric2_2'],
      metrics_include: ['metric_1'],
    },
    group_by: [
      {
        type: 'dims',
      },
    ],
    where: {
      and: [
        {
          expr: 'stg__sales__inventory__product_metrics.category = stg__demo__models__deployments.category',
        },
      ],
    },
    incremental_strategy: {
      type: 'merge',
      unique_key: 'testing',
      merge_update_columns: ['another'],
      merge_exclude_columns: ['another 2'],
    },
    partitioned_by: ['tesst'],
    sql_hooks: {
      pre: ['pre hook 1', 'pre hook 2'],
      post: ['post hook 1', 'post hook n'],
    },
    exclude_daily_filter: true,
    exclude_date_filter: true,
    exclude_portal_partition_columns: true,
    exclude_portal_source_count: true,
  },
  editFormType: 'model-int__sales__inventory__billing_raw',
  isEditMode: true,
};

export const mockLookbackModelData = {
  modelData: {
    projectName: 'demo_data_platform',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/intermediate/analytics/cloud/int__analytics__test__sample.model.json',
    group: 'analytics',
    topic: 'test',
    name: 'sample',
    materialization: 'incremental',
    description: 'this is a updated description',
    tags: ['lightdash-explore'],
    type: 'int_lookback_model',
    from: {
      model: 'int__analytics__cloud__billing_hourly_aggregated',
      lookback: {
        days: 7,
        exclude_event_date: false,
      },
    },
    exclude_portal_source_count: false,
    select: [
      {
        model: 'int__analytics__cloud__billing_hourly_aggregated',
        type: 'all_from_model',
      },
    ],
    group_by: [
      {
        type: 'dims',
      },
    ],
  },
  editFormType: 'model-int__analytics__test__sample',
  isEditMode: true,
};

// Mock data for a ROLLUP model (aggregation case)
export const mockRollupModelData = {
  modelData: {
    projectName: 'demo_data_platform',
    name: 'int__analytics__cloud_cost_summary',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/intermediate/analytics/int__analytics__cloud_cost_summary.model.json',
    group: 'analytics',
    topic: 'cloud_cost',
    type: 'int_rollup_model',
    source: 'intermediate',
    from: {
      model: 'int__analytics__cloud__billing_hourly_aggregated',
    },
    select: [
      {
        model: 'int__analytics__cloud__billing_hourly_aggregated',
        type: 'dims_from_model',
      },
      {
        model: 'int__analytics__cloud__billing_hourly_aggregated',
        type: 'fcts_from_model',
      },
    ],
  },
  editFormType: 'model-int__analytics__cloud_cost_summary',
  isEditMode: true,
};

// Mock data for a UNION SOURCES staging model
export const mockUnionSourcesModelData = {
  modelData: {
    projectName: 'demo_data_platform',
    name: 'stg__demo__cloud__demo_union_sources',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/staging/demo/cloud/stg__demo__cloud__demo_union_sources.model.json',
    group: 'demo',
    topic: 'cloud',
    type: 'stg_union_sources',
    source: 'staging',
    from: {
      source: 'cloud_billing.usage_data',
      union: {
        type: 'all',
        sources: ['warehouse__logs.access_log'],
      },
    },
    select: [
      {
        source: 'stg__demo__cloud__demo_union_sources',
        type: 'dims_from_model',
        include: ['test', 'test2'],
      },
    ],
    materialization: 'ephemeral',
  },
  editFormType: 'model-stg__demo__cloud__demo_union_sources',
  isEditMode: true,
};

export const mockMartSelectModelData = {
  modelData: {
    name: 'mart__analytics__cloud_cost_summary',
    originalModelPath:
      '/home/coder/demo_data_platform/dbt/models/marts/analytics/mart__analytics__cloud_cost_summary.model.json',
    group: 'analytics',
    topic: 'cloud_cost',
    from: {
      model: 'mart__analytics__cloud_cost_summary',
    },
    select: [
      {
        model: 'mart__analytics__cloud_cost_summary',
        type: 'all_from_model',
      },
    ],
    group_by: null,
    where: null,
    lightdash: null,
    description: '',
    tags: [],
    incremental_strategy: null,
    sql_hooks: null,
    partitioned_by: null,
    exclude_portal_partition_columns: null,
    exclude_portal_source_count: null,
    type: 'mart_select_model',
    projectName: 'demo_data_platform',
  },
  editFormType: 'model-mart__analytics__cloud_cost_summary',
  isEditMode: true,
};

// Configuration for switching between test scenarios
export type TestCaseType =
  | 'MART_SELECT_MODEL'
  | 'SELECT_MODEL'
  | 'JOIN_MODEL'
  | 'ROLLUP_MODEL'
  | 'UNION_SOURCES_MODEL'
  | 'LOOKBACK_MODEL';

export const editFlowTestConfig = {
  // Default to JOIN_MODEL as it's the most comprehensive test case
  activeTestCase: 'JOIN_MODEL' as TestCaseType,

  // Enable/disable edit mode simulation
  simulateEditMode: true,

  getCurrentTestData() {
    switch (this.activeTestCase) {
      case 'SELECT_MODEL':
        return mockSelectModelData.modelData;
      case 'JOIN_MODEL':
        return mockJoinModelData.modelData;
      case 'ROLLUP_MODEL':
        return mockRollupModelData.modelData;
      case 'UNION_SOURCES_MODEL':
        return mockUnionSourcesModelData.modelData;
      case 'MART_SELECT_MODEL':
        return mockMartSelectModelData.modelData;
      default:
        return mockJoinModelData.modelData;
    }
  },
};

/**
 * Get the mock response for framework-get-current-model-data API
 * This is used by the app.tsx handler to return mock data in development
 */
export function getMockEditFlowResponse() {
  if (!editFlowTestConfig.simulateEditMode) {
    return null;
  }

  switch (editFlowTestConfig.activeTestCase) {
    case 'SELECT_MODEL':
      return mockSelectModelData;
    case 'JOIN_MODEL':
      return mockJoinModelData;
    case 'ROLLUP_MODEL':
      return mockRollupModelData;
    case 'MART_SELECT_MODEL':
      return mockMartSelectModelData;
    case 'UNION_SOURCES_MODEL':
      return mockUnionSourcesModelData;
    case 'LOOKBACK_MODEL':
      return mockLookbackModelData;
    default:
      return mockJoinModelData;
  }
}
