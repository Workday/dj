import type { DemoData } from '../types';

/**
 * Demo data for Join Model tutorial
 * This data will be progressively filled as the user advances through steps
 */
export const joinModelDemoData: DemoData = {
  // Basic Information
  name: 'orders_enriched',
  source: 'intermediate',
  type: 'int_join_models',
  group: 'sales',
  topic: 'orders',
  materialization: 'incremental' as const,

  // Data Modeling - from with join
  from: {
    model: 'stg__sales__orders__standardized',
  },

  // Joins
  join: [
    {
      model: 'stg__customers__profiles__clean',
      type: 'left',
      on: {
        and: ['customer_id'],
      },
    },
    {
      model: 'stg__sales__stores__locations',
      type: 'left',
      on: {
        and: ['store_id'],
      },
    },
  ],

  select: [
    {
      type: 'all_from_model',
      model: 'stg__sales__orders__standardized',
      include: ['order_id', 'customer_id', 'store_id', 'order_date'],
    },
    {
      type: 'all_from_model',
      model: 'stg__customers__profiles__clean',
      include: ['customer_name', 'customer_first_name'],
    },
    {
      type: 'all_from_model',
      model: 'stg__sales__stores__locations',
      include: ['store_name', 'store_tax_rate'],
    },
    { name: 'customer_name', type: 'dim' },
    { name: 'email', type: 'dim' },
    { name: 'created_at', type: 'dim' },
    // ⭐ Sample column with FULL configuration (for tutorial demo)
    {
      name: 'full_name',
      type: 'dim',
      expr: "CONCAT(first_name, ' ', last_name)",
      data_type: 'string',
      description: 'Full name combining first and last name',
      lightdash: {
        dimension: {
          label: 'Customer Full Name',
          group_label: 'Customer Info',
        },
        metrics: [
          'count', // Standard metric
          {
            // Custom metric
            name: 'unique_full_names',
            type: 'count_distinct',
            label: 'Unique Full Names',
            description: 'Count of distinct full names',
          },
        ],
      },
      data_tests: ['not_null', 'unique'],
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
  description: 'Combined customer and order data for analysis',
  tags: ['sales', 'orders', 'join', 'analytics'],
};
