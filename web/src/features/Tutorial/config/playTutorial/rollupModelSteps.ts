import {
  ActionType,
  // TutorialComponentState,
} from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Static tutorial steps for Rollup Model demo
 * These steps show a walkthrough with prefilled data
 */
export const rollupModelSteps: TutorialStep[] = [
  // ========== BASIC INFORMATION ==========
  {
    element: '[data-tutorial-id="project-select"]',
    popover: {
      title: 'Select Project',
      description:
        "Start by selecting your dbt project. For this tutorial, we'll use your <strong>demo project</strong>.<br/><br/>" +
        '💡 Projects organize your dbt models by business domain.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="source-selection"]',
    popover: {
      title: 'Select Source Layer',
      description:
        'Rollup models typically live in the <strong>Marts</strong> layer, where we create business-ready aggregated datasets.<br/><br/>' +
        '• <strong>Staging</strong>: Raw data preparation<br/>' +
        '• <strong>Intermediate</strong>: Business logic transformations<br/>' +
        '• <strong>Marts</strong>: Final, business-ready datasets',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="type-selection"]',
    popover: {
      title: 'Model Type: Rollup',
      description:
        'Rollup models aggregate granular data into summary tables.<br/><br/>' +
        '<strong>Common Use Cases:</strong><br/>' +
        '• Daily/monthly sales summaries<br/>' +
        '• User activity aggregations<br/>' +
        '• Performance metrics rollups<br/><br/>' +
        '💡 Perfect for creating fast, pre-aggregated reporting tables.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="group-selection"]',
    popover: {
      title: 'Group',
      description:
        "We'll put this in the <strong>reporting</strong> group since it's an aggregated dataset for reports.<br/><br/>" +
        '💡 Common groups: analytics, ml, reporting, finance',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="topic-input"]',
    popover: {
      title: 'Topic',
      description:
        "We'll use <strong>sales_analytics</strong> as the topic for this model.<br/><br/>" +
        '💡 Topics help you find related models quickly.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="model-name-input"]',
    popover: {
      title: 'Model Name',
      description:
        "We'll create a Rollup model called <strong>monthly_sales_summary</strong> that aggregates order data by month.<br/><br/>" +
        '💡 Use lowercase letters, numbers, and underscores.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="materialization-select"]',
    popover: {
      title: 'Materialization',
      description:
        'Rollup models should be materialized as <strong>tables</strong> for fast query performance.<br/><br/>' +
        '• <strong>View</strong>: Would recalculate aggregations every query (slow)<br/>' +
        '• <strong>Table</strong>: Pre-computed aggregations (fast)<br/>' +
        '• <strong>Incremental</strong>: Efficient updates for large datasets',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },

  // ========== MODEL PREVIEW (Basic Information) ==========
  {
    element: '[data-tutorial-id="model-preview"]',
    popover: {
      title: 'Real-Time Model Preview 🔍',
      description:
        'This live preview shows your ROLLUP model as you build it!<br/><br/>' +
        'Updates automatically when you configure aggregations.<br/><br/>' +
        '💡 Watch the SQL update with GROUP BY and aggregation functions.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 0,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('sql');
    },
  },
  {
    element: '[data-tutorial-id="model-preview-content"]',
    popover: {
      title: 'SQL Preview - Live Preview',
      description:
        'This shows the generated SQL with GROUP BY and aggregation functions (SUM, AVG, COUNT).<br/><br/>' +
        "Based on the rollup configuration you'll set, this SQL will aggregate your data.<br/><br/>" +
        '💡 The SQL updates automatically as you add metrics!',
      side: 'left',
      align: 'start',
    },
    wizardStep: 0,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('sql');
    },
  },
  {
    element: '[data-tutorial-id="model-preview-content"]',
    popover: {
      title: 'YAML Preview',
      description:
        'Switch to <strong>YML</strong> tab!<br/><br/>' +
        'This shows the dbt schema configuration with rollup definitions.<br/><br/>' +
        '💡 YAML defines your model metadata for dbt.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 0,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('yaml');
    },
  },
  {
    element: '[data-tutorial-id="model-preview-content"]',
    popover: {
      title: 'JSON Preview',
      description:
        'Switch to <strong>JSON</strong> tab!<br/><br/>' +
        'This shows the complete model structure including rollup configuration in JSON format.<br/><br/>' +
        '💡 JSON is useful for debugging and API integration.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 0,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('json');
    },
    requiresWizardAdvance: true,
  },

  // ========== DATA MODELING ==========
  {
    element: '[data-tutorial-id="data-modeling-container"]',
    popover: {
      title: 'Data Modeling Canvas',
      description:
        "For Rollup models, you'll configure dimensions (GROUP BY) and metrics (aggregations).<br/><br/>" +
        '💡 Think of rollups as creating a summary table from detail data.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 1,
  },
  {
    element: '[data-tutorial-id="select-node"]',
    popover: {
      title: 'Select Source for Rollup',
      description:
        "Choose the detailed table to aggregate. We'll start with <strong>order_details</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Select the source from the dropdown.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },

  // ========== ROLLUP NODE ==========
  {
    element: '[data-tutorial-id="rollup-node"]',
    popover: {
      title: 'Rollup Configuration',
      description:
        "This is where you configure time-based aggregations. We'll create a monthly sales summary.<br/><br/>" +
        '💡 Rollups transform detail data into time-aggregated summary tables.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'rollupNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="rollup-dimensions"]',
    popover: {
      title: 'Select Time Interval',
      description:
        'Choose the time interval for aggregation:<br/><br/>' +
        '• <strong>Day</strong>: Daily aggregations<br/>' +
        '• <strong>Hour</strong>: Hourly aggregations<br/>' +
        '• <strong>Month</strong>: Monthly aggregations<br/>' +
        '• <strong>Year</strong>: Yearly aggregations<br/><br/>' +
        "We'll use <strong>Month</strong> for monthly sales summaries.<br/><br/>" +
        '💡 The interval defines the granularity of your time-based summary.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'rollupNode',
    zoomLevel: 0.7,
  },

  // ========== LIGHTDASH NODE ==========
  {
    element: '[data-tutorial-id="actions-bar"]',
    popover: {
      title: 'Action Nodes',
      description:
        'You can add optional transformations like:<br/>' +
        '• <strong>Lightdash</strong>: Analytics metadata<br/>' +
        '• <strong>Where</strong>: Filters<br/><br/>' +
        "Let's add Lightdash configuration for analytics!",
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    onStepEnter: (store) => {
      // Enable Lightdash action
      store.toggleTutorialAction(ActionType.LIGHTDASH);
    },
  },
  {
    element: '[data-tutorial-id="lightdash-node"]',
    popover: {
      title: 'Lightdash Node',
      description:
        'Configure analytics metadata for your time-aggregated data.<br/><br/>' +
        '💡 Lightdash makes your rollup data business-ready!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lightdashNode',
    zoomLevel: 0.55,
    requiresWizardAdvance: true,
    onStepExit: (store) => {
      // Clear actions when moving to next wizard step
      store.clearTutorialActions();
    },
  },

  // ========== ADDITIONAL FIELDS ==========
  {
    element: '[data-tutorial-id="additional-fields-section"]',
    popover: {
      title: 'Additional Fields',
      description:
        'Add metadata to document this rollup model.<br/><br/>' +
        '💡 Document what metrics are being calculated and why!',
      side: 'top',
      align: 'start',
    },
    wizardStep: 2,
    isInformational: true,
  },
  {
    element: '[data-tutorial-id="description-input"]',
    popover: {
      title: 'Model Description',
      description:
        'Describe what this rollup model represents.<br/><br/>' +
        'Example: "Monthly aggregated sales metrics by product category for executive reporting"<br/><br/>' +
        '💡 Document the business metrics being calculated.',
      side: 'top',
      align: 'start',
    },
    wizardStep: 2,
  },
  {
    element: '[data-tutorial-id="tags-input"]',
    popover: {
      title: 'Tags',
      description:
        'Add tags to categorize this rollup model.<br/><br/>' +
        'Examples: <code>sales</code>, <code>rollup</code>, <code>reporting</code>, <code>monthly</code><br/><br/>' +
        '💡 Use tags for filtering and dbt selectors.',
      side: 'top',
      align: 'start',
    },
    wizardStep: 2,
    requiresWizardAdvance: true,
  },

  // ========== FINAL PREVIEW ==========
  {
    element: '[data-tutorial-id="final-preview"]',
    popover: {
      title: 'Final Preview',
      description:
        'Review your complete rollup model before saving.<br/><br/>' +
        '💡 Check the GROUP BY and aggregation functions in the SQL.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'SQL Preview - Aggregation SQL',
      description:
        'Review the generated SQL. Notice the GROUP BY clause with dimensions and aggregation functions for metrics.<br/><br/>' +
        '💡 The SQL shows SUM(), AVG(), COUNT() with GROUP BY.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('sql');
    },
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'YAML Preview',
      description:
        'Switch to <strong>YML</strong> tab to see the rollup configuration.<br/><br/>' +
        'This YAML file defines:<br/>' +
        '• Rollup dimensions<br/>' +
        '• Metric calculations<br/>' +
        '• Aggregation functions<br/><br/>' +
        '💡 dbt uses this to generate aggregation SQL.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('yaml');
    },
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'JSON Preview',
      description:
        'Switch to <strong>JSON</strong> tab to see the raw rollup structure.<br/><br/>' +
        'This shows the complete model definition with all rollup configuration.<br/><br/>' +
        '💡 Useful for debugging complex aggregations.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('json');
    },
  },
  {
    element: '[data-tutorial-id="finish-button"]',
    popover: {
      title: 'Tutorial Complete! 🎉',
      description:
        "You've learned how to create a Rollup model!<br/><br/>" +
        'Key steps:<br/>' +
        '1. Set basic information<br/>' +
        '2. Select source table<br/>' +
        '3. Define dimensions (GROUP BY)<br/>' +
        '4. Add metrics with aggregations<br/>' +
        '5. Review SQL and save<br/><br/>' +
        '💡 Rollups are essential for fast reporting and analytics!',
      side: 'left',
      align: 'end',
    },
    wizardStep: 3,
  },
];
