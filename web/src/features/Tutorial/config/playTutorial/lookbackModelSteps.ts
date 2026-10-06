import {
  ActionType,
  // TutorialComponentState,
} from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Static tutorial steps for Lookback Model demo
 * These steps show a walkthrough with prefilled data
 */
export const lookbackModelSteps: TutorialStep[] = [
  // ========== BASIC INFORMATION ==========
  {
    element: '[data-tutorial-id="project-select"]',
    popover: {
      title: 'Select Project',
      description:
        "Start by selecting your dbt project. For this tutorial, we'll use your <strong>project</strong>.<br/><br/>" +
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
        'Lookback models typically live in the <strong>Intermediate</strong> layer, where we analyze time-series and historical data.<br/><br/>' +
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
      title: 'Model Type: Lookback',
      description:
        'Lookback models analyze data within a time window (e.g., last 30 days, last 90 days).<br/><br/>' +
        '<strong>Common Use Cases:</strong><br/>' +
        '• Customer lifetime value (30-day, 90-day)<br/>' +
        '• Rolling window metrics<br/>' +
        '• Time-based cohort analysis<br/>' +
        '• Trend analysis over fixed periods<br/><br/>' +
        '💡 Perfect for time-series analysis and historical metrics.',
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
        "We'll put this in the <strong>ml</strong> (machine learning) group since it's for predictive analytics.<br/><br/>" +
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
        "We'll use <strong>customer_value</strong> as the topic for this model.<br/><br/>" +
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
        "We'll create a Lookback model called <strong>customer_ltv_30day</strong> that analyzes 30-day customer lifetime value.<br/><br/>" +
        '💡 Include the time window in the name (e.g., _30day, _90day).',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    element: '[data-tutorial-id="materialized-select"]',
    popover: {
      title: 'Materialization',
      description:
        'Lookback models work well as <strong>incremental</strong> for efficient daily updates.<br/><br/>' +
        '• <strong>View</strong>: Recalculates every query (slow for large datasets)<br/>' +
        '• <strong>Table</strong>: Full refresh each time<br/>' +
        '• <strong>Incremental</strong>: Only process new/changed data (efficient)',
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
        'This live preview shows your LOOKBACK model as you build it!<br/><br/>' +
        'Updates automatically when you configure the time window.<br/><br/>' +
        '💡 Watch the SQL update with date filters and window functions.',
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
        'This shows the generated SQL with date filtering for the lookback window.<br/><br/>' +
        "Based on the lookback configuration you'll set, this SQL will filter data within the time window.<br/><br/>" +
        '💡 The SQL updates automatically as you configure the lookback period!',
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
        'This shows the dbt schema configuration with lookback definitions.<br/><br/>' +
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
        'This shows the complete model structure including lookback configuration in JSON format.<br/><br/>' +
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
        "For Lookback models, you'll configure the time window and select relevant columns.<br/><br/>" +
        '💡 Lookback models focus on time-series analysis.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 1,
  },
  {
    element: '[data-tutorial-id="select-node"]',
    popover: {
      title: 'Select Source for Lookback',
      description:
        "Choose the table with time-series data. We'll select <strong>stg__ml__metrics__model_deployments</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Select the source from the dropdown.<br/><br/>' +
        '💡 The source should have a date/timestamp column.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },

  // ========== LOOKBACK NODE ==========
  {
    element: '[data-tutorial-id="lookback-node"]',
    popover: {
      title: 'Lookback Configuration',
      description:
        "This is where you configure the time window. We'll analyze the last 30 days of data.<br/><br/>" +
        '💡 Lookback windows create rolling time-based metrics.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lookbackNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="lookback-days-input"]',
    popover: {
      title: 'Set Lookback Window',
      description:
        "Specify the number of days to look back. We'll use <strong>30 days</strong>.<br/><br/>" +
        '<strong>Common Windows:</strong><br/>' +
        '• 7 days: Weekly metrics<br/>' +
        '• 30 days: Monthly metrics<br/>' +
        '• 90 days: Quarterly metrics<br/>' +
        '• 365 days: Yearly metrics<br/><br/>' +
        '✏️ <strong>Action:</strong> Enter the number of days.<br/><br/>' +
        '💡 This defines how far back in time to include data.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lookbackNode',
    zoomLevel: 0.7,
  },

  // ========== COLUMN SELECTION ==========
  {
    element: '[data-tutorial-id="column-selection-node"]',
    popover: {
      title: 'Select Columns for Analysis',
      description:
        "Choose which columns to include in your lookback analysis. We'll select:<br/>" +
        '• model_id<br/>' +
        '• model_name<br/>' +
        '• model_version<br/>' +
        '• namespace<br/>' +
        '• environment<br/>' +
        '• model_created_at<br/><br/>' +
        '💡 Include columns needed for time-series analysis.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.65,
    nodeType: 'columnSelectionNode',
  },
  {
    element: '[data-tutorial-id="add-column-button"]',
    popover: {
      title: 'Add Custom Column',
      description:
        "You can add custom columns manually. Let's click the <strong>Add Columns Manually</strong> button.<br/><br/>" +
        '💡 Custom columns let you create expressions and transformations.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.65,
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
        'Configure analytics metadata for your time-series data.<br/><br/>' +
        '💡 Lightdash makes your lookback data business-ready!',
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
        'Add metadata to document this lookback model.<br/><br/>' +
        '💡 Document the time window and what metrics are being calculated!',
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
        'Describe what this lookback model represents.<br/><br/>' +
        'Example: "30-day customer lifetime value and transaction metrics for predictive modeling"<br/><br/>' +
        '💡 Include the time window in the description.',
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
        'Add tags to categorize this lookback model.<br/><br/>' +
        'Examples: <code>customer</code>, <code>ltv</code>, <code>lookback</code>, <code>ml</code>, <code>30days</code><br/><br/>' +
        '💡 Include the time window in tags for easy filtering.',
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
        'Review your complete lookback model before saving.<br/><br/>' +
        '💡 Check the date filters in the SQL to ensure the time window is correct.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'SQL Preview - Lookback Window',
      description:
        'Review the generated SQL. Notice the date filtering for the 30-day lookback window.<br/><br/>' +
        '💡 The SQL shows WHERE clauses filtering data within the time window.',
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
        'Switch to <strong>YML</strong> tab to see the lookback configuration.<br/><br/>' +
        'This YAML file defines:<br/>' +
        '• Lookback window (30 days)<br/>' +
        '• Date column<br/>' +
        '• Exclude event date setting<br/><br/>' +
        '💡 dbt uses this to generate date-filtered SQL.',
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
        'Switch to <strong>JSON</strong> tab to see the raw lookback structure.<br/><br/>' +
        'This shows the complete model definition with all lookback configuration.<br/><br/>' +
        '💡 Useful for debugging time window logic.',
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
        "You've learned how to create a Lookback model!<br/><br/>" +
        'Key steps:<br/>' +
        '1. Set basic information<br/>' +
        '2. Select source table<br/>' +
        '3. Configure lookback window (days)<br/>' +
        '4. Select date column<br/>' +
        '5. Choose columns for analysis<br/>' +
        '6. Review SQL and save<br/><br/>' +
        '💡 Lookback models are essential for time-series analysis and trending!',
      side: 'left',
      align: 'end',
    },
    wizardStep: 3,
  },
];
