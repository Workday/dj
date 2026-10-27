import type { DemoData } from '../types';

/**
 * Demo data for Rollup Model tutorial
 * This data will be progressively filled as the user advances through steps
 */
export const rollupModelDemoData: DemoData = {
  // Basic Information
  name: 'daily_revenue',
  source: 'intermediate',
  type: 'int_rollup_model',
  group: 'sales',
  topic: 'revenue',
  materialization: 'incremental',

  // Data Modeling
  from: {
    model: 'stg__sales__orders__standardized',
    rollup: {
      datetime_expr: 'order_date',
      interval: 'day',
    },
  },

  // Column selections
  select: [
    {
      type: 'all_from_model',
      model: 'stg__sales__orders__standardized',
      exclude: ['transaction_id'],
      include: [
        'order_id',
        'customer_id',
        'store_id',
        'order_date',
        'order_total_cents',
      ],
    },
  ],

  lightdash: {
    table: {
      label: 'Monthly Sales Summary',
      group_label: 'Sales Analytics',
    },
    metrics: [
      {
        name: 'total_queries',
        type: 'count',
        label: 'Total Queries',
        description: 'Count of all queries',
      },
    ],
    metrics_include: ['count', 'sum'],
    metrics_exclude: ['max', 'min'],
  },

  // Group By configuration (for rollup aggregations)
  groupBy: {
    dimensions: true,
    columns: ['customer_id', 'store_id'],
    expressions: ["DATE_TRUNC('day', order_date)"],
  },

  // Where clause configuration
  where: {
    and: [
      { expr: "order_date >= '2024-01-01'" },
      { expr: 'execution_time IS NOT NULL' },
    ],
  },

  // Additional metadata
  description: 'Monthly aggregated sales metrics by product category',
  tags: ['sales', 'rollup', 'reporting', 'daily'],
};
