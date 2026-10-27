import {
  ActionType,
  TutorialComponentState,
} from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Static tutorial steps for Union Model demo
 * These steps show a walkthrough with prefilled data
 */
export const unionModelSteps: TutorialStep[] = [
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
        'Union models typically live in the <strong>Intermediate</strong> or <strong>Marts</strong> layer, where we combine similar data from multiple sources.<br/><br/>' +
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
      title: 'Model Type: Union',
      description:
        'Union models combine rows from multiple tables with the same structure.<br/><br/>' +
        '<strong>Common Use Cases:</strong><br/>' +
        '• Combining data from multiple regions<br/>' +
        '• Merging historical and current data<br/>' +
        '• Consolidating multi-channel data (online, store, mobile)<br/><br/>' +
        '💡 Perfect for creating unified datasets from similar sources.',
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
        "We'll put this in the <strong>analytics</strong> group since it consolidates data for analysis.<br/><br/>" +
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
        "We'll use <strong>transactions</strong> as the topic for this model.<br/><br/>" +
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
        "We'll create a Union model called <strong>all_transactions</strong> that combines transactions from all channels.<br/><br/>" +
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
        'Union models are often materialized as <strong>tables</strong> since they combine large datasets.<br/><br/>' +
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
        'This live preview shows your UNION model as you build it!<br/><br/>' +
        'Updates automatically when you add union sources or change fields.<br/><br/>' +
        '💡 Watch the SQL update as you configure unions.',
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
        'This shows the generated SQL with UNION ALL clauses for your model.<br/><br/>' +
        "Based on the sources you'll configure, this SQL query will combine all data.<br/><br/>" +
        '💡 The SQL updates automatically as you add union sources!',
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
        'This shows the dbt schema configuration with union source definitions.<br/><br/>' +
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
        'This shows the complete model structure including union configuration in JSON format.<br/><br/>' +
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
        "For Union models, you'll see nodes for each source you're combining.<br/><br/>" +
        '💡 All sources must have the same column structure to be unioned.',
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
        "Choose your first table to union. We'll start with <strong>online_transactions</strong>.<br/><br/>" +
        '✏️ <strong>Action:</strong> Select the first source from the dropdown.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },

  // ========== UNION NODE ==========
  {
    element: '[data-tutorial-id="union-node"]',
    popover: {
      title: 'Union Configuration',
      description:
        "This is where you configure union sources. We'll combine transactions from multiple channels:<br/><br/>" +
        '• Online transactions<br/>' +
        '• Store transactions<br/>' +
        '• Mobile transactions<br/><br/>' +
        '💡 You can union as many sources as you need!',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'unionNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="union-type-select"]',
    popover: {
      title: 'Union Type',
      description:
        'Select the union type. <strong>ALL</strong> keeps all rows including duplicates (default).<br/><br/>' +
        '💡 UNION ALL is faster than UNION DISTINCT.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'unionNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="union-source-select"]',
    popover: {
      title: 'Select Union Sources',
      description:
        "Choose additional models to union. We'll add:<br/>" +
        '• <strong>store_transactions</strong><br/>' +
        '• <strong>mobile_transactions</strong><br/><br/>' +
        '✏️ <strong>Action:</strong> Click the dropdown and select a model.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'unionNode',
    zoomLevel: 0.7,
  },
  {
    element: '[data-tutorial-id="add-union-source-button"]',
    popover: {
      title: 'Add Union Source',
      description:
        'Click <strong>Add Source</strong> to add another table to union.<br/><br/>' +
        '✏️ <strong>Action:</strong> Click to add a new source to the union.<br/><br/>' +
        '💡 Each source must have compatible columns.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'unionNode',
    zoomLevel: 0.7,
  },

  // ========== COLUMN SELECTION ==========
  {
    element: '[data-tutorial-id="column-selection-node"]',
    popover: {
      title: 'Select Common Columns',
      description:
        "Choose columns that exist in ALL union sources. We'll select:<br/>" +
        '• transaction_id<br/>' +
        '• transaction_date<br/>' +
        '• amount<br/>' +
        '• customer_id<br/><br/>' +
        '💡 Only common columns across all sources can be selected.',
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
    zoomLevel: 0.65,
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
    defaultTabIndex: 0,
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
    defaultTabIndex: 1,
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
        'Configure analytics metadata for your unified dataset.<br/><br/>' +
        '💡 Lightdash makes your union data business-ready!',
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
        "Now let's add a Where clause to filter the combined data.<br/><br/>" +
        '💡 Where clauses are applied after union!',
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
        'Filter your union data with WHERE conditions.<br/><br/>' +
        '<strong>Basic Mode:</strong> Simple filter expression<br/>' +
        '<strong>Advanced Mode:</strong> Multiple conditions with AND/OR<br/><br/>' +
        "Example: <code>transaction_date >= '2023-01-01'</code><br/><br/>" +
        '💡 Use Where clauses to filter across all union sources.',
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
        'Add metadata to document this union model.<br/><br/>' +
        '💡 Document which sources are being combined and why!',
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
        'Describe what this union model represents.<br/><br/>' +
        'Example: "Combined transactions from all channels (online, store, mobile) for unified reporting"<br/><br/>' +
        '💡 Document the source systems being unified.',
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
        'Add tags to categorize this union model.<br/><br/>' +
        'Examples: <code>transactions</code>, <code>union</code>, <code>multi-channel</code><br/><br/>' +
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
        'Review your complete union model before saving.<br/><br/>' +
        '💡 Check the UNION SQL to ensure all sources are included.',
      side: 'left',
      align: 'start',
    },
    wizardStep: 3,
  },
  {
    element: '[data-tutorial-id="sql-preview"]',
    popover: {
      title: 'SQL Preview - UNION ALL Syntax',
      description:
        'Review the generated UNION SQL. Notice how dbt combines all sources with UNION ALL.<br/><br/>' +
        '💡 UNION ALL keeps all rows (including duplicates) for better performance.',
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
        'Switch to <strong>YML</strong> tab to see the union configuration.<br/><br/>' +
        'This YAML file defines:<br/>' +
        '• Union sources<br/>' +
        '• Column mappings<br/>' +
        '• Source identifiers<br/><br/>' +
        '💡 dbt uses this to generate UNION SQL.',
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
        'Switch to <strong>JSON</strong> tab to see the raw union structure.<br/><br/>' +
        'This shows the complete model definition with all union configuration.<br/><br/>' +
        '💡 Useful for debugging complex unions.',
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
        "You've learned how to create a Union model!<br/><br/>" +
        'Key steps:<br/>' +
        '1. Set basic information<br/>' +
        '2. Add multiple union sources<br/>' +
        '3. Add source identifiers<br/>' +
        '4. Select common columns<br/>' +
        '5. Review UNION SQL and save<br/><br/>' +
        '💡 Union models are perfect for consolidating similar data!',
      side: 'left',
      align: 'end',
    },
    wizardStep: 3,
  },
];
