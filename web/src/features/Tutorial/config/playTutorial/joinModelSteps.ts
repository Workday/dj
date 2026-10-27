import {
  ActionType,
  TutorialComponentState,
} from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Static tutorial steps for Join Model demo
 * These steps show a walkthrough with prefilled data
 */
export const joinModelSteps: TutorialStep[] = [
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
        'Join models typically live in the <strong>Intermediate</strong> layer, where we combine and transform data.<br/><br/>' +
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
      title: 'Model Type: Join',
      description:
        'Join models combine data from multiple sources using SQL joins.<br/><br/>' +
        '<strong>Join Types:</strong><br/>' +
        '• LEFT: All base records + matching joined records<br/>' +
        '• INNER: Only matching records<br/>' +
        '• RIGHT: All joined records + matching base records<br/>' +
        '• FULL: All records from both sources<br/><br/>' +
        '💡 Perfect for creating wide tables with related data.',
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
        "We'll put this in the <strong>analytics</strong> group since it combines data for analysis.<br/><br/>" +
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
        "We'll use <strong>order_analysis</strong> as the topic for this model.<br/><br/>" +
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
        "We'll create a Join model called <strong>customer_orders_joined</strong> that combines customer and order data.<br/><br/>" +
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
        'Join models are often materialized as <strong>tables</strong> for better query performance.<br/><br/>' +
        '• <strong>View</strong>: Virtual table (query on demand)<br/>' +
        '• <strong>Table</strong>: Physical table (pre-computed)<br/>' +
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
        'This live preview shows your JOIN model as you build it!<br/><br/>' +
        'Updates automatically when you add joins or change fields.<br/><br/>' +
        '💡 Watch the SQL update as you configure joins.',
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
        'This shows the generated SQL with JOIN clauses for your model.<br/><br/>' +
        "Based on the joins you'll configure, this SQL query will run in your database.<br/><br/>" +
        '💡 The SQL updates automatically as you add joins!',
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
        'This shows the dbt schema configuration with join definitions.<br/><br/>' +
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
        'This shows the complete model structure including join configuration in JSON format.<br/><br/>' +
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
        "For Join models, you'll see multiple nodes: your base source and join nodes for each table you're combining.<br/><br/>" +
        '💡 Drag nodes to rearrange them for better visualization.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 1,
  },
  {
    element: '[data-tutorial-id="select-node"]',
    popover: {
      title: 'Select Base Source',
      description:
        "Choose your primary table to join from. We'll start with <strong>stg_customers</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Select the base source from the dropdown.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },

  // ========== ADD JOIN BUTTON ==========
  {
    element: '[data-tutorial-id="add-join-button-node"]',
    popover: {
      title: 'Add Join Button',
      description:
        "Click the <strong>Add Join</strong> button to add tables to your join. We'll join <strong>stg_orders</strong> to get order information for each customer.<br/><br/>" +
        '✏️ <strong>Action:</strong> Click the button to add a new join.<br/><br/>' +
        '💡 You can add multiple joins to combine many tables!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'addJoinButtonNode',
    zoomLevel: 0.7,
    // Prefill join data HERE (see usePlayTutorial.ts) so JoinNode exists for next step
  },
  // ========== JOIN NODE ==========
  {
    element: '[data-tutorial-id="join-node"]',
    popover: {
      title: 'Join Configuration',
      description:
        'After clicking Add Join, the join node appears where you configure the join details.<br/><br/>' +
        '💡 Each join node represents a table being joined to your base source.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'joinNode',
    zoomLevel: 0.7,
    // Note: Join data prefilled at add-join-button-node step
    // The 500ms delay in usePlayTutorial.ts after navigation should be sufficient
  },
  {
    element: '[data-tutorial-id="join-model-select"]',
    popover: {
      title: 'Select Model to Join',
      description:
        "Choose which model to join. We'll select <strong>stg_orders</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Click the dropdown and select a model to join.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'joinNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="join-type-select"]',
    popover: {
      title: 'Join Type',
      description:
        'Select the type of join:<br/>' +
        '• <strong>LEFT</strong>: All customers, even without orders<br/>' +
        '• <strong>INNER</strong>: Only customers with orders<br/>' +
        '• <strong>RIGHT</strong>: All orders<br/>' +
        '• <strong>FULL</strong>: Everything<br/><br/>' +
        "We'll use <strong>LEFT</strong> join.",
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'joinNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="join-conditions"]',
    popover: {
      title: 'Join Conditions',
      description:
        "Define how tables are related. We'll join on:<br/>" +
        '<code>customers.customer_id = orders.customer_id</code><br/><br/>' +
        '✏️ <strong>Action:</strong> Select matching columns from both tables.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'joinNode',
    zoomLevel: 0.7,
  },

  // ========== COLUMN SELECTION ==========
  {
    element: '[data-tutorial-id="column-selection-node"]',
    popover: {
      title: 'Select Columns from Both Tables',
      description:
        "Choose columns from all joined tables. We'll select:<br/>" +
        '<strong>From customers:</strong> customer_id, customer_name, email<br/>' +
        '<strong>From orders:</strong> order_id, order_date, total_amount<br/><br/>' +
        '💡 Columns from all joined tables are available here.',
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
        'Configure analytics metadata for your BI tool.<br/><br/>' +
        '💡 Lightdash integration makes your joined data business-ready!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'lightdashNode',
    zoomLevel: 0.55,
  },

  // ========== WHERE NODE ==========
  {
    element: '[data-tutorial-id="actions-bar"]',
    popover: {
      title: 'Where Clause Action',
      description:
        "Now let's add a Where clause to filter the joined data.<br/><br/>" +
        '💡 Where clauses are critical for data quality and performance!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    onStepEnter: (store) => {
      // Clear Lightdash, Enable Where action
      store.clearTutorialActions();
      store.toggleTutorialAction(ActionType.WHERE);
    },
  },
  {
    element: '[data-tutorial-id="where-node"]',
    popover: {
      title: 'Where Clause',
      description:
        'Filter your joined data with WHERE conditions.<br/><br/>' +
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

  // ========== ADDITIONAL FIELDS ==========
  {
    element: '[data-tutorial-id="additional-fields-section"]',
    popover: {
      title: 'Additional Fields',
      description:
        'Add metadata to document this join model.<br/><br/>' +
        '💡 Document which business questions this model answers!',
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
        'Describe what this join model represents.<br/><br/>' +
        'Example: "Combined customer and order data for customer lifetime value analysis"<br/><br/>' +
        '💡 Good descriptions help teammates understand complex joins.',
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
        'Add tags to categorize this join model.<br/><br/>' +
        'Examples: <code>customer</code>, <code>orders</code>, <code>join</code>, <code>analytics</code><br/><br/>' +
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
        'Review your complete join model before saving.<br/><br/>' +
        '💡 Check the JOIN SQL to ensure your conditions are correct.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'SQL Preview - JOIN Syntax',
      description:
        'Review the generated JOIN SQL. Notice how dbt generates the proper JOIN syntax with your conditions.<br/><br/>' +
        '💡 The SQL shows the complete query with all joins and conditions.',
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
        'Switch to <strong>YML</strong> tab to see the join configuration.<br/><br/>' +
        'This YAML file defines:<br/>' +
        '• Join relationships<br/>' +
        '• Column mappings<br/>' +
        '• Join conditions<br/><br/>' +
        '💡 dbt uses this to generate JOIN SQL.',
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
        'Switch to <strong>JSON</strong> tab to see the raw join structure.<br/><br/>' +
        'This shows the complete model definition with all join configuration.<br/><br/>' +
        '💡 Useful for debugging complex joins.',
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
        "You've learned how to create a Join model!<br/><br/>" +
        'Key steps:<br/>' +
        '1. Set basic information<br/>' +
        '2. Select base source<br/>' +
        '3. Add joins with conditions<br/>' +
        '4. Choose columns from all sources<br/>' +
        '5. Review JOIN SQL and save<br/><br/>' +
        '💡 You can add multiple joins to combine many tables!',
      side: 'left',
      align: 'end',
    },
    wizardStep: 3,
  },
];
