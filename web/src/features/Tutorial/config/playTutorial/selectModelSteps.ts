import {
  ActionType,
  TutorialComponentState,
} from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Static tutorial steps for Select Model demo
 * These steps show a walkthrough with prefilled data
 */
export const selectModelSteps: TutorialStep[] = [
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
        "Choose where your model will live in the data pipeline. We'll create an <strong>Intermediate</strong> model.<br/><br/>" +
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
      title: 'Model Type',
      description:
        'Select models pull data from a single source. This is the simplest type of model and perfect for beginners.<br/><br/>' +
        '💡 Other types include Join, Union, Rollup, and Lookback.',
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
        "Groups help organize related models. We'll put this in the <strong>ml</strong> (machine learning) group.<br/><br/>" +
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
        "Topics provide additional categorization. We'll use <strong>customer_analytics</strong> for this model.<br/><br/>" +
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
        "Every model needs a unique name. We'll create a model called <strong>customer_summary</strong>.<br/><br/>" +
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
        'This determines how dbt will build your model:<br/>' +
        '• <strong>View</strong>: Virtual table (query on demand)<br/>' +
        '• <strong>Table</strong>: Physical table (pre-computed)<br/>' +
        '• <strong>Incremental</strong>: Efficient updates for large datasets<br/><br/>' +
        "We'll use <strong>table</strong> for this example.",
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
        'This live preview shows your model as you build it!<br/><br/>' +
        'Updates automatically when you change any fields above.<br/><br/>' +
        '💡 Use this to see SQL, YAML, and JSON in real-time.',
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
        'This shows the generated SQL for your model.<br/><br/>' +
        "Based on the fields you've entered, this SQL query will run in your database.<br/><br/>" +
        '💡 The SQL updates automatically as you modify model properties!',
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
        'This shows the dbt schema configuration file.<br/><br/>' +
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
        'This shows the complete model structure in JSON format.<br/><br/>' +
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
        "This visual canvas shows your data flow. You'll see nodes for your source and transformations.<br/><br/>" +
        '💡 Drag nodes to rearrange them for better visualization.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 1,
  },
  {
    element: '[data-tutorial-id="select-node"]',
    popover: {
      title: 'Select Your Source',
      description:
        "For a Select model, choose which table or model to pull data from. We'll select <strong>stg_customers</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Click the dropdown and select a source.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },
  {
    element: '[data-tutorial-id="column-selection-node"]',
    popover: {
      title: 'Select Columns',
      description:
        "Choose which columns from your source to include in the model. We'll select:<br/>" +
        '• customer_id<br/>' +
        '• customer_name<br/>' +
        '• email<br/>' +
        '• created_at<br/><br/>' +
        '💡 You can select columns from the list.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.65,
    nodeType: 'columnSelectionNode',
  },
  {
    element: '[data-tutorial-id="group-by-dimensions-checkbox"]',
    popover: {
      title: 'Group By Dimensions',
      description:
        'You can group your data by all dimension columns. When enabled, this will automatically add a GROUP BY clause with all dimension columns in your SQL query.<br/><br/>' +
        '💡 This option is only available for certain model types and when dimension columns are present.',
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
        "You can add custom calculated columns manually. Let's click the <strong>Add Columns Manually</strong> button.<br/><br/>" +
        '💡 Custom columns let you create expressions and transformations.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.65, // Zoom out to see entire ColumnSelectionNode
    onStepEnter: () => {
      // Scroll to the button element
      setTimeout(() => {
        const element = document.querySelector(
          '[data-tutorial-id="add-column-button"]',
        );
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }, 200);
    },
  },
  // ========== ADD COLUMN BASIC FORM ==========
  {
    element: '[data-tutorial-id="add-column-modal"]',
    popover: {
      title: 'Add Column Form',
      description:
        'This form lets you create custom columns. Fill in the following fields:<br/><br/>' +
        '• <strong>Type:</strong> Dimension or Metric<br/>' +
        '• <strong>Column Name:</strong> Name of the column (e.g., full_name)<br/>' +
        '• <strong>Data Type:</strong> VARCHAR, INTEGER, etc.<br/>' +
        '• <strong>Description:</strong> What the column represents<br/>' +
        '• <strong>Expression:</strong> SQL expression to calculate the column<br/><br/>' +
        '💡 You can add transformations and expressions here!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.35,
    onStepEnter: (store) => {
      // NEW: Use enum state
      store.setCurrentComponentState(
        TutorialComponentState.ADD_COLUMN_MODAL_OPEN,
      );
      setTimeout(() => {
        const element = document.querySelector(
          '[data-tutorial-id="add-column-modal"]',
        );
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }, 300);
    },
    onStepExit: (store) => {
      // NEW: Use enum state - switch to Column Configuration
      store.setCurrentComponentState(
        TutorialComponentState.COLUMN_CONFIG_OVERVIEW,
      );
      store.setTutorialSelectedColumn({
        name: 'full_name',
        type: 'dim',
        data_type: 'varchar',
        description: 'Full name of the customer',
        expr: "concat(first_name, ' ', last_name)",
      });
    },
  },

  // ========== COLUMN CONFIGURATION NODE ==========
  {
    element: '[data-tutorial-id="column-configuration-node"]',
    popover: {
      title: 'Column Configuration',
      description:
        'Now you can configure advanced properties for your column across three tabs:<br/><br/>' +
        '• <strong>General</strong>: Basic column info<br/>' +
        '• <strong>Lightdash</strong>: Analytics metadata<br/>' +
        '• <strong>Others</strong>: Data tests & overrides<br/><br/>' +
        "Let's explore each tab!",
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.45,
    nodeType: 'columnConfigurationNode',
  },
  {
    element: '[data-tutorial-id="colconfig-general-type"]',
    popover: {
      title: 'General Tab - Column Type',
      description:
        'In the General tab, you can refine the column type (Dimension/Metric).<br/><br/>' +
        '💡 This is the same as in the Add Column form.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.45,
    nodeType: 'columnConfigurationNode',
    defaultTabIndex: 0, // General tab
    onStepEnter: (store) => {
      store.setTutorialActiveTabIndex(0);
      store.setActiveColumnConfigTab('general');
    },
  },
  {
    element: '[data-tutorial-id="colconfig-lightdash-dimension"]',
    popover: {
      title: 'Lightdash Tab - Dimension',
      description:
        'Switch to the <strong>Lightdash</strong> tab!<br/><br/>' +
        'Configure dimension properties like:<br/>' +
        '• AI Hint (for semantic understanding)<br/>' +
        '• Group Label<br/>' +
        '• Label<br/>' +
        '• Hidden status<br/><br/>' +
        '💡 Lightdash uses these for analytics dashboards.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.45,
    nodeType: 'columnConfigurationNode',
    defaultTabIndex: 1, // Lightdash tab
    onStepEnter: (store) => {
      store.setTutorialActiveTabIndex(1);
      store.setCurrentComponentState(
        TutorialComponentState.LIGHTDASH_DIMENSION,
      );
      store.setActiveColumnConfigTab('lightdash');
    },
  },
  {
    element: '[data-tutorial-id="colconfig-lightdash-standard-metrics"]',
    popover: {
      title: 'Lightdash - Standard Metrics',
      description:
        'Select pre-built metrics like:<br/>' +
        '• Count<br/>' +
        '• Sum<br/>' +
        '• Average<br/>' +
        '• Min/Max<br/><br/>' +
        '💡 These are common aggregations for analytics.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.45,
    nodeType: 'columnConfigurationNode',
  },
  {
    element: '[data-tutorial-id="colconfig-lightdash-custom-metrics"]',
    popover: {
      title: 'Lightdash - Custom Metrics',
      description:
        'Create custom metrics with:<br/>' +
        '• Custom names<br/>' +
        '• Custom SQL logic<br/>' +
        '• Formatting options<br/><br/>' +
        '💡 Use this for business-specific calculations.<br/><br/>' +
        "That's it for Column Configuration! Let's move on.",
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    zoomLevel: 0.45,
    nodeType: 'columnConfigurationNode',
    onStepExit: (store) => {
      // Clear column configuration state
      store.setTutorialActiveTabIndex(null);
      store.setCurrentComponentState(TutorialComponentState.NONE);
      store.setActiveColumnConfigTab(null);
      store.setTutorialSelectedColumn(null);
    },
  },

  // ========== PHASE 2A: LIGHTDASH NODE ==========
  {
    element: '[data-tutorial-id="actions-bar"]',
    popover: {
      title: 'Action Nodes',
      description:
        'You can add optional transformations like:<br/>' +
        '• <strong>Lightdash</strong>: Analytics metadata<br/>' +
        '• <strong>Group By</strong>: Aggregations<br/>' +
        '• <strong>Where</strong>: Filters<br/><br/>' +
        "Let's explore these powerful features!",
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
        'Configure analytics metadata for your BI tool.<br/><br/>' +
        '💡 Lightdash integration makes your data models business-ready!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lightdashNode',
    zoomLevel: 0.55,
  },
  {
    element: '[data-tutorial-id="lightdash-metrics"]',
    popover: {
      title: 'Lightdash Metrics',
      description:
        'Define custom metrics for analysis.<br/><br/>' +
        'Metric types:<br/>' +
        '• Count<br/>' +
        '• Sum<br/>' +
        '• Average<br/>' +
        '• Min/Max<br/><br/>' +
        '💡 Metrics are reusable calculations for your dashboards.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lightdashNode',
    zoomLevel: 0.55,
  },
  {
    element: '[data-tutorial-id="lightdash-table-properties"]',
    popover: {
      title: 'Table Properties',
      description:
        'Configure table-level settings:<br/>' +
        '• Group Label: Organize tables<br/>' +
        '• Required Attributes: Enforce filters<br/>' +
        '• Required Filters: Pre-apply conditions<br/><br/>' +
        '💡 These settings control how your table appears in Lightdash.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lightdashNode',
    zoomLevel: 0.55,
  },

  // ========== PHASE 2B: GROUPBY NODE ==========
  {
    element: '[data-tutorial-id="actions-bar"]',
    popover: {
      title: 'Group By Action',
      description:
        "Now let's add a Group By to aggregate data.<br/><br/>" +
        '💡 Group By is essential for creating summary tables!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    onStepEnter: (store) => {
      // Clear Lightdash, Enable GroupBy action
      store.clearTutorialActions();
      store.toggleTutorialAction(ActionType.GROUPBY);
    },
  },
  {
    element: '[data-tutorial-id="groupby-node"]',
    popover: {
      title: 'Group By Node',
      description:
        'Aggregate data by dimensions or columns.<br/><br/>' +
        '<strong>Options:</strong><br/>' +
        '• Group by All Dimensions: Auto-groups dimension columns<br/>' +
        '• Group by Columns: Specify exact columns<br/>' +
        '• Group by Expressions: Use custom SQL<br/><br/>' +
        '💡 Useful for creating summary and rollup tables.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'groupByNode',
    zoomLevel: 0.6,
  },

  // ========== PHASE 2C: WHERE NODE ==========
  {
    element: '[data-tutorial-id="actions-bar"]',
    popover: {
      title: 'Where Clause Action',
      description:
        "Finally, let's add a Where clause to filter data.<br/><br/>" +
        '💡 Where clauses are critical for data quality and performance!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    onStepEnter: (store) => {
      // Clear GroupBy, Enable Where action
      store.clearTutorialActions();
      store.toggleTutorialAction(ActionType.WHERE);
    },
  },
  {
    element: '[data-tutorial-id="where-node"]',
    popover: {
      title: 'Where Clause',
      description:
        'Filter your data with WHERE conditions.<br/><br/>' +
        '<strong>Basic Mode:</strong> Simple filter expression<br/>' +
        '<strong>Advanced Mode:</strong> Multiple conditions with AND/OR<br/><br/>' +
        "Example: <code>created_at >= '2023-01-01'</code><br/><br/>" +
        '💡 Use Where clauses to include only the data you need.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'whereNode',
    zoomLevel: 0.6,
    requiresWizardAdvance: true,
    onStepExit: (store) => {
      // Clear actions when moving to next wizard step
      store.clearTutorialActions();
    },
  },

  // ========== PHASE 3: ADDITIONAL FIELDS ==========
  {
    element: '[data-tutorial-id="additional-fields-section"]',
    popover: {
      title: 'Additional Fields',
      description:
        'Add metadata and documentation to your model.<br/><br/>' +
        '💡 Good documentation makes your models easier to maintain!',
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
        'Add a clear description of what this model does.<br/><br/>' +
        'Example: "Customer dimension table with complete profile data"<br/><br/>' +
        '💡 Descriptions appear in your dbt docs and help teammates understand your models.',
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
        'Add tags to organize and categorize models.<br/><br/>' +
        'Examples: <code>customer</code>, <code>pii</code>, <code>daily</code><br/><br/>' +
        '💡 Use tags for filtering, grouping, and dbt selectors.',
      side: 'top',
      align: 'start',
    },
    wizardStep: 2,
  },
  {
    element: '[data-tutorial-id="column-excludes"]',
    popover: {
      title: 'Column Excludes',
      description:
        'Specify columns to exclude from certain operations.<br/><br/>' +
        '<strong>Exclude from Daily:</strong> Skip in daily refreshes<br/>' +
        '<strong>Exclude from Groupby:</strong> Not used for aggregation<br/><br/>' +
        '💡 Fine-tune which columns participate in operations.',
      side: 'top',
      align: 'start',
    },
    wizardStep: 2,
    requiresWizardAdvance: true,
  },

  // ========== PHASE 4: FINAL PREVIEW ==========
  {
    element: '[data-tutorial-id="final-preview"]',
    popover: {
      title: 'Final Preview',
      description:
        'Review your complete model before saving.<br/><br/>' +
        '💡 You can view SQL, YAML, and JSON representations.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'SQL Preview - Default Tab',
      description:
        'Review the generated SQL code for your model.<br/><br/>' +
        'This shows exactly what dbt will execute in your database.<br/><br/>' +
        '💡 Click <strong>Copy</strong> to copy the SQL to your clipboard.',
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
        'Switch to <strong>YML</strong> tab to see the dbt schema configuration.<br/><br/>' +
        'This YAML file defines:<br/>' +
        '• Model metadata<br/>' +
        '• Column descriptions<br/>' +
        '• Data tests<br/><br/>' +
        '💡 dbt uses this to document and test your model.',
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
        'Switch to <strong>JSON</strong> tab to see the raw model structure.<br/><br/>' +
        'This shows the complete model definition in JSON format.<br/><br/>' +
        '💡 Useful for debugging and API integration.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('json');
    },
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'Meta Information',
      description:
        'Switch to <strong>Meta Information</strong> tab.<br/><br/>' +
        'This table shows:<br/>' +
        '• All column names<br/>' +
        '• Column types (Dimension/Metric)<br/>' +
        '• Data types<br/>' +
        '• Descriptions<br/><br/>' +
        '💡 Great for a quick overview of your model!',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
    onStepEnter: (store) => {
      store.setTutorialPreviewType('meta');
    },
  },
  {
    element: '[data-tutorial-id="finish-button"]',
    popover: {
      title: 'Tutorial Complete! 🎉',
      description:
        "You've learned how to create a Select model!<br/><br/>" +
        'Key steps:<br/>' +
        '1. Set basic information (name, source, type)<br/>' +
        '2. Select your data source<br/>' +
        '3. Choose columns<br/>' +
        '4. Review and save<br/><br/>' +
        '💡 Click <strong>Finish</strong> to exit the tutorial.',
      side: 'left',
      align: 'end',
    },
    wizardStep: 3,
  },
];
