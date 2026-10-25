import type { DemoData } from '../types';

/**
 * Demo data for Select Model tutorial
 * This data will be progressively filled as the user advances through steps
 */
export const selectModelDemoData: DemoData = {
  // Basic Information
  name: 'customer_summary',
  source: 'intermediate',
  type: 'int_select_model',
  group: 'customers',
  topic: 'profiles',
  materialization: 'incremental',

  // Data Modeling - from
  from: {
    model: 'stg__customers__profiles__clean',
  },

  // Column selections
  select: [
    {
      type: 'all_from_model',
      model: 'stg__customers__profiles__clean',
      include: [
        'customer_id',
        'customer_name',
        'customer_first_name',
        'customer_last_name',
      ],
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
  description: 'Summary of customer data from staging layer',
  tags: ['customer', 'profiles', 'analytics'],
};
