import type { DemoData } from '../types';

/**
 * Demo data for Lookback Model tutorial
 * This data will be progressively filled as the user advances through steps
 */
export const lookbackModelDemoData: DemoData = {
  // Basic Information
  name: 'orders_30day',
  source: 'intermediate',
  type: 'int_lookback_model',
  group: 'sales',
  topic: 'orders',
  materialization: 'incremental',

  // Data Modeling
  fromModel: 'stg__sales__orders__standardized',

  // Lookback configuration
  from: {
    model: 'stg__sales__orders__standardized',
    lookback: {
      days: 30,
      exclude_event_date: false,
    },
  },

  select: [
    {
      type: 'all_from_model',
      model: 'stg__sales__orders__standardized',
      exclude: ['deployment_id'],
      include: [
        'order_id',
        'customer_id',
        'store_id',
        'order_date',
        'order_total_cents',
        'status',
      ],
    },
  ],

  // Lightdash configuration (table-level)
  lightdash: {
    table: {
      label: 'Customer Summary',
      group_label: 'Customer Analytics',
    },
    metrics: [
      {
        name: 'total_customers',
        type: 'count',
        label: 'Total Customers',
        description: 'Count of all customer records',
      },
      {
        name: 'avg_order_value',
        type: 'average',
        label: 'Average Order Value',
        description: 'Average value across all orders',
      },
    ],
    metrics_include: ['count', 'sum'],
    metrics_exclude: ['max', 'min'],
  },

  // Group By configuration
  groupBy: {
    dimensions: true,
    columns: ['customer_id', 'customer_name'],
    expressions: [
      "DATE_TRUNC('month', created_at)",
      "CASE WHEN status = 'active' THEN 1 ELSE 0 END",
    ],
  },

  // Where clause configuration
  where: {
    and: [
      { expr: "status = 'active'" },
      { expr: "created_at >= '2024-01-01'" },
      { expr: 'email IS NOT NULL' },
    ],
  },

  // Additional metadata
  description: '30-day customer lifetime value and transaction metrics',
  tags: ['sales', 'orders', 'lookback', '30days'],
};
