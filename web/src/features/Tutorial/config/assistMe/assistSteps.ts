import type { TutorialStore } from '@web/stores/useTutorialStore';
import { TutorialComponentState } from '@web/stores/useTutorialStore';

import type { TutorialStep } from '../../types';

/**
 * Data Modeling Guide Step Enum
 * Defines all possible guide steps for self-exploratory tutorial
 */
export enum DataModelingGuideStep {
  NONE = 'none',

  // Welcome & Basic Information
  WELCOME = 'welcome',
  PROJECT = 'project',
  SOURCE_LAYER = 'source-layer',
  MODEL_TYPE = 'model-type',
  GROUP = 'group',
  TOPIC = 'topic',
  MODEL_NAME = 'model-name',
  MATERIALIZATION = 'materialization',

  // Canvas Overview
  DATA_MODELING_INTRO = 'data-modeling-intro',
  NAVIGATION_BAR = 'navigation-bar',
  ACTIONS_BAR = 'actions-bar',

  // Node Guides (triggered by NavigationBar clicks)
  SELECT_NODE = 'select-node',
  JOIN_NODE = 'join-node',
  UNION_NODE = 'union-node',
  ROLLUP_NODE = 'rollup-node',
  LOOKBACK_NODE = 'lookback-node',
  COLUMN_SELECTION_NODE = 'column-selection-node',
  LIGHTDASH_NODE = 'lightdash-node',
  GROUPBY_NODE = 'groupby-node',
  WHERE_NODE = 'where-node',

  // Column Selection Features
  ADD_JOIN_BUTTON = 'add-join-button',
  ADD_COLUMN_BUTTON = 'add-column-button',
  ADD_COLUMN_MODAL = 'add-column-modal',
  COLUMN_CONFIGURATION = 'column-configuration-overview',
  GROUP_BY_DIMENSIONS = 'group-by-dimensions-checkbox',

  // Action Node Guides (triggered by ActionsBar clicks)
  ACTION_LIGHTDASH = 'action-lightdash',
  ACTION_GROUPBY = 'action-groupby',
  ACTION_WHERE = 'action-where',

  // Additional Fields & Final Steps
  ADDITIONAL_FIELDS_INTRO = 'additional-fields-intro',
  DESCRIPTION = 'description',
  TAGS = 'tags',
  FINAL_PREVIEW = 'final-preview',
  SUBMIT_BUTTON = 'submit-button',
}

/**
 * Model state interface for assist steps
 */
export interface ModelState {
  projectName?: string;
  name?: string;
  source?: string;
  type?: string;
  group?: string;
  topic?: string;
  materialization?: string;
  fromModel?: string;
  fromSource?: string;
  hasJoins?: boolean;
  hasSelect?: boolean;
  hasUnions?: boolean;
  hasColumns?: boolean;
  // UI state flags for conditional steps
  isAddColumnModalOpen?: boolean;
  isColumnConfigOpen?: boolean;
  isLightdashActive?: boolean;
  isGroupByActive?: boolean;
  isWhereActive?: boolean;
}

/**
 * Assist rule definition
 */
interface AssistRule {
  id: DataModelingGuideStep;
  element: string;
  when: (state: ModelState) => boolean;
  isCompleted?: (state: ModelState) => boolean;
  popover: {
    title: string;
    description: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
  };
  wizardStep: number;
  requiresWizardAdvance?: boolean | ((state: ModelState) => boolean);
  isInformational?: boolean;
  canSkip?: boolean;
  nodeType?: string;
  zoomLevel?: number;
  onStepEnter?: (tutorialStore: TutorialStore) => void;
  onStepExit?: (tutorialStore: TutorialStore) => void;
}

/**
 * All assist rules - dynamically filtered based on state
 */
const ASSIST_RULES: AssistRule[] = [
  // ========== WELCOME STEP ==========
  {
    id: DataModelingGuideStep.WELCOME,
    element: '[data-tutorial-id="wizard-container"]',
    when: () => true,
    popover: {
      title: "Welcome to DJ's Model Creation Wizard! 🎉",
      description:
        'This guided assistant will help you create your dbt model step-by-step.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 0,
    isInformational: true,
  },

  // ========== BASIC INFORMATION ==========
  {
    id: DataModelingGuideStep.PROJECT,
    element: '[data-tutorial-id="project-select"]',
    when: () => true,
    isCompleted: (state) => !!state.projectName,
    popover: {
      title: 'Select Your Project 📁',
      description: 'Choose the dbt project where your model will be created.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    id: DataModelingGuideStep.SOURCE_LAYER,
    element: '[data-tutorial-id="source-selection"]',
    when: () => true,
    isCompleted: (state) => !!state.source,
    popover: {
      title: 'Choose Source Layer 📊',
      description: 'Staging (raw) | Intermediate (transforms) | Marts (final)',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    id: DataModelingGuideStep.MODEL_TYPE,
    element: '[data-tutorial-id="type-selection"]',
    when: (state) => !!state.source,
    isCompleted: (state) => !!state.type,
    popover: {
      title: 'Pick Model Type 🔧',
      description:
        'Select (simple queries) | Join (combine tables) | Union (stack rows) | Rollup (aggregate) | Lookback (historical analysis)',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    id: DataModelingGuideStep.GROUP,
    element: '[data-tutorial-id="group-selection"]',
    when: (state) => !!state.source && !!state.type,
    isCompleted: (state) => !!state.group,
    popover: {
      title: 'Select Group 🗂️',
      description:
        'Organize models by business domain (e.g., analytics, finance, ml).',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    id: DataModelingGuideStep.TOPIC,
    element: '[data-tutorial-id="topic-input"]',
    when: (state) => !!state.source && !!state.type,
    isCompleted: (state) => !!state.topic?.trim(),
    popover: {
      title: 'Enter Topic 🏷️',
      description:
        'Specify subject area (e.g., customers, orders/daily) using lowercase with underscores or slashes.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
  },
  {
    id: DataModelingGuideStep.MODEL_NAME,
    element: '[data-tutorial-id="model-name-input"]',
    when: (state) => !!state.source && !!state.type,
    isCompleted: (state) => !!state.name?.trim(),
    popover: {
      title: 'Name Your Model ✏️',
      description:
        'Use lowercase letters, numbers, and underscores (e.g., customer_orders).',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
    // For staging models, advance to Data Modeling step after name is entered
    requiresWizardAdvance: (state: ModelState) => state.source === 'staging',
  },
  {
    id: DataModelingGuideStep.MATERIALIZATION,
    element: '[data-tutorial-id="materialization-select"]',
    when: (state) => state.source === 'intermediate',
    isCompleted: (state) => !!state.materialization,
    popover: {
      title: 'Choose Materialization ⚙️',
      description:
        'Incremental: append-only updates | Ephemeral: CTE (temporary)',
      side: 'right',
      align: 'start',
    },
    wizardStep: 0,
    requiresWizardAdvance: true,
  },

  // ========== DATA MODELING ==========
  {
    id: DataModelingGuideStep.DATA_MODELING_INTRO,
    element: '[data-tutorial-id="data-modeling-container"]',
    when: (state) => !!state.type,
    popover: {
      title: 'Data Modeling Canvas 🎨',
      description: 'Configure your transformation visually.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 1,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.NAVIGATION_BAR,
    element: '[data-tutorial-id="navigation-bar"]',
    when: (state) => !!state.type,
    popover: {
      title: 'Navigation Bar 🧭',
      description: 'Quick jump to different sections of your model.',
      side: 'right',
      align: 'center',
    },
    wizardStep: 1,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.ACTIONS_BAR,
    element: '[data-tutorial-id="actions-bar"]',
    when: (state) => !!state.type && state.source !== 'staging',
    popover: {
      title: 'Actions Bar 🎯',
      description:
        'Where (filter) | Group By (aggregate) | Lightdash (BI metrics)',
      side: 'right',
      align: 'center',
    },
    wizardStep: 1,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.SELECT_NODE,
    element: '[data-tutorial-id="select-node"]',
    when: (state) => !!state.type,
    isCompleted: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Select Source Table 📋',
      description: 'Choose which table or model to query from.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    nodeType: 'selectNode',
  },

  // ========== JOIN-SPECIFIC ==========
  {
    id: DataModelingGuideStep.ADD_JOIN_BUTTON,
    element: '[data-tutorial-id="add-join-button-node"]',
    when: (state) =>
      !!state.type &&
      state.type.includes('join') &&
      state.type !== 'int_join_column',
    popover: {
      title: 'Add Join Tables 🔗',
      description: 'Add tables you want to join.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'addJoinButtonNode',
    zoomLevel: 0.7,
  },
  {
    id: DataModelingGuideStep.JOIN_NODE,
    element: '[data-tutorial-id="join-node"]',
    when: (state) =>
      !!state.type && state.type.includes('join') && !!state.hasJoins,
    popover: {
      title: 'Configure Join ⚡',
      description:
        'Select table, join type (LEFT/INNER/RIGHT), and join conditions.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'joinNode',
    zoomLevel: 0.7,
  },

  // ========== UNION-SPECIFIC ==========
  {
    id: DataModelingGuideStep.UNION_NODE,
    element: '[data-tutorial-id="union-node"]',
    when: (state) => !!state.type && state.type.includes('union'),
    popover: {
      title: 'Add Union Sources 📚',
      description:
        'Add more tables to combine. All sources should have similar columns.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'unionNode',
    zoomLevel: 0.7,
  },

  // ========== ROLLUP-SPECIFIC ==========
  {
    id: DataModelingGuideStep.ROLLUP_NODE,
    element: '[data-tutorial-id="rollup-node"]',
    when: (state) => !!state.type && state.type.includes('rollup'),
    popover: {
      title: 'Configure Rollup 📈',
      description:
        'Set time interval (day/month/year) and aggregations (SUM/AVG/COUNT).',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'rollupNode',
    zoomLevel: 0.7,
  },

  // ========== LOOKBACK-SPECIFIC ==========
  {
    id: DataModelingGuideStep.LOOKBACK_NODE,
    element: '[data-tutorial-id="lookback-node"]',
    when: (state) => !!state.type && state.type.includes('lookback'),
    popover: {
      title: 'Set Lookback Window ⏰',
      description: 'Specify time period (days) to analyze historical data.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'lookbackNode',
    zoomLevel: 0.7,
  },

  // ========== COMMON NODES ==========
  {
    id: DataModelingGuideStep.COLUMN_SELECTION_NODE,
    element: '[data-tutorial-id="column-selection-node"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Select Columns 📝',
      description:
        'Pick specific columns, add calculated ones, or rename them.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.35,
  },
  {
    id: DataModelingGuideStep.GROUP_BY_DIMENSIONS,
    element: '[data-tutorial-id="group-by-dimensions-checkbox"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Group By Dimensions 📊',
      description: 'Group data by dimension columns.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.65,
    onStepEnter: () => {
      // Scroll to the checkbox element (delay to coordinate with zoom transitions)
      setTimeout(() => {
        const element = document.querySelector(
          '[data-tutorial-id="group-by-dimensions-checkbox"]',
        );
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
      }, 500);
    },
  },
  {
    id: DataModelingGuideStep.ADD_COLUMN_BUTTON,
    element: '[data-tutorial-id="add-column-button"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Add Custom Column ➕',
      description: 'Create calculated columns with SQL expressions.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.65,
    onStepEnter: () => {
      // Scroll to the button element (increased delay to coordinate with zoom transitions)
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
      }, 500);
    },
  },

  // ========== ADD COLUMN BASIC FORM ==========
  {
    id: DataModelingGuideStep.ADD_COLUMN_MODAL,
    element: '[data-tutorial-id="add-column-modal"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Add Column Form 📝',
      description:
        'Fill in Type, Name, Data Type, Description, and SQL Expression.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'columnSelectionNode',
    zoomLevel: 0.35,
    onStepEnter: (store) => {
      // Set the state to open the modal
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
      }, 500);
    },
    onStepExit: (store) => {
      // Switch to Column Configuration state
      store.setCurrentComponentState(
        TutorialComponentState.COLUMN_CONFIG_OVERVIEW,
      );
    },
  },

  // ========== COLUMN CONFIGURATION NODE ==========
  {
    id: DataModelingGuideStep.COLUMN_CONFIGURATION,
    element: '[data-tutorial-id="column-configuration-node"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Column Configuration 🔧',
      description:
        'Configure advanced properties across General, Lightdash, and Others tabs.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    canSkip: true,
    isInformational: true,
    nodeType: 'columnConfigurationNode',
    zoomLevel: 0.45,
    onStepExit: (store) => {
      // Clear column configuration state
      store.setTutorialActiveTabIndex(null);
      store.setCurrentComponentState(TutorialComponentState.NONE);
      store.setActiveColumnConfigTab(null);
      store.setTutorialSelectedColumn(null);
    },
  },

  // ========== ACTION-SPECIFIC GUIDES (Triggered by ActionsBar clicks) ==========
  {
    id: DataModelingGuideStep.ACTION_LIGHTDASH,
    element: '[data-tutorial-id="lightdash-node"]',
    when: (state) =>
      !!(state.fromModel || state.fromSource) &&
      state.source !== 'staging' &&
      !!state.isLightdashActive,
    popover: {
      title: 'Lightdash Node 📊',
      description: 'Configure dimensions, metrics, and BI tool properties.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'lightdashNode',
    zoomLevel: 0.7,
  },
  {
    id: DataModelingGuideStep.ACTION_GROUPBY,
    element: '[data-tutorial-id="groupby-node"]',
    when: (state) =>
      !!(state.fromModel || state.fromSource) &&
      state.source !== 'staging' &&
      !!state.isGroupByActive,
    popover: {
      title: 'Group By Node 📦',
      description: 'Aggregate data by grouping dimensions.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'groupByNode',
    zoomLevel: 0.7,
  },
  {
    id: DataModelingGuideStep.ACTION_WHERE,
    element: '[data-tutorial-id="where-node"]',
    when: (state) =>
      !!(state.fromModel || state.fromSource) &&
      state.source !== 'staging' &&
      !!state.isWhereActive,
    popover: {
      title: 'Where Node 🔍',
      description: 'Apply filters to your data.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 1,
    isInformational: true,
    nodeType: 'whereNode',
    zoomLevel: 0.7,
  },

  // ========== ADDITIONAL FIELDS ==========
  {
    id: DataModelingGuideStep.ADDITIONAL_FIELDS_INTRO,
    element: '[data-tutorial-id="additional-fields-container"]',
    when: () => true, // Always show intro for Additional Fields step
    popover: {
      title: 'Add Metadata 📄',
      description: 'Document your model with descriptions and tags.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 2,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.DESCRIPTION,
    element: '[data-tutorial-id="description-input"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Model Description 📝',
      description: 'Add a description for Lightdash tooltips and dbt docs.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 2,
    canSkip: true,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.TAGS,
    element: '[data-tutorial-id="tags-input"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Add Tags 🏷️',
      description:
        'Organize with tags like "lightdash", "pii", or custom ones.',
      side: 'right',
      align: 'start',
    },
    wizardStep: 2,
    canSkip: true,
    isInformational: true,
    requiresWizardAdvance: true,
  },

  // ========== FINAL PREVIEW ==========
  {
    id: DataModelingGuideStep.FINAL_PREVIEW,
    element: '[data-tutorial-id="final-preview"]',
    when: () => true, // Always show intro for Final Preview step
    popover: {
      title: 'Review Your Model 👀',
      description: 'Check generated SQL, YAML, and JSON before creating.',
      side: 'left',
      align: 'center',
    },
    wizardStep: 3,
    isInformational: true,
  },
  {
    id: DataModelingGuideStep.SUBMIT_BUTTON,
    element: '[data-tutorial-id="submit-button"]',
    when: (state) => !!(state.fromModel || state.fromSource),
    popover: {
      title: 'Create Model ✅',
      description: 'Click to generate SQL and YAML files in your dbt project.',
      side: 'top',
      align: 'center',
    },
    wizardStep: 3,
    isInformational: true,
  },
];

/**
 * Generate assist steps based on current model state
 */
export function generateAssistSteps(state: ModelState): TutorialStep[] {
  return ASSIST_RULES.filter((rule) => rule.when(state)).map((rule) => ({
    id: rule.id,
    element: rule.element,
    popover: {
      title: rule.popover.title,
      description: rule.popover.description,
      side: rule.popover.side || 'right',
      align: rule.popover.align || 'start',
    },
    wizardStep: rule.wizardStep,
    // Evaluate requiresWizardAdvance if it's a function
    requiresWizardAdvance:
      typeof rule.requiresWizardAdvance === 'function'
        ? rule.requiresWizardAdvance(state)
        : rule.requiresWizardAdvance,
    isInformational: rule.isInformational,
    canSkip: rule.canSkip,
    isCompleted: rule.isCompleted?.(state),
    nodeType: rule.nodeType,
    zoomLevel: rule.zoomLevel,
    onStepEnter: rule.onStepEnter,
    onStepExit: rule.onStepExit,
  }));
}

/**
 * Find the first empty/incomplete step to start from
 * Takes the already-generated steps array to ensure index consistency
 */
export function findStartingAssistStep(steps: TutorialStep[]): number {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isCompleted = step.isCompleted ?? false;

    // Skip informational-only steps when finding starting point
    if (!isCompleted && !step.isInformational) {
      return i;
    }
  }

  // If all completed, start from beginning
  return 0;
}

/**
 * Map React Flow node type to Data Modeling guide step
 * Used when user clicks NavigationBar items
 */
export function mapNodeTypeToGuideStep(
  nodeType: string,
): DataModelingGuideStep {
  const mapping: Record<string, DataModelingGuideStep> = {
    selectNode: DataModelingGuideStep.SELECT_NODE,
    joinNode: DataModelingGuideStep.JOIN_NODE,
    joinColumnNode: DataModelingGuideStep.JOIN_NODE, // Cross Join Unnest uses same guide
    unionNode: DataModelingGuideStep.UNION_NODE,
    rollupNode: DataModelingGuideStep.ROLLUP_NODE,
    lookbackNode: DataModelingGuideStep.LOOKBACK_NODE,
    columnSelectionNode: DataModelingGuideStep.COLUMN_SELECTION_NODE,
    lightdashNode: DataModelingGuideStep.LIGHTDASH_NODE,
    groupByNode: DataModelingGuideStep.GROUPBY_NODE,
    whereNode: DataModelingGuideStep.WHERE_NODE,
  };

  return mapping[nodeType] || DataModelingGuideStep.NONE;
}

/**
 * Map ActionType to Data Modeling guide step
 * Used when user clicks ActionsBar actions
 */
export function mapActionTypeToGuideStep(
  actionType: string,
): DataModelingGuideStep {
  const mapping: Record<string, DataModelingGuideStep> = {
    lightdash: DataModelingGuideStep.ACTION_LIGHTDASH,
    groupby: DataModelingGuideStep.ACTION_GROUPBY,
    where: DataModelingGuideStep.ACTION_WHERE,
  };

  return mapping[actionType] || DataModelingGuideStep.NONE;
}

/**
 * Get guide definition for a specific Data Modeling guide step
 * Returns the assist rule matching the guide step ID
 */
export function getGuideForStep(
  step: DataModelingGuideStep,
  state: ModelState,
): AssistRule | null {
  if (step === DataModelingGuideStep.NONE) {
    return null;
  }

  // Find the rule that matches the guide step
  const rule = ASSIST_RULES.find((r) => r.id === step);

  if (!rule) {
    return null;
  }

  // For action-specific guides (triggered by user clicking actions),
  // bypass the when condition check since the action is already enabled
  const isActionGuide =
    step === DataModelingGuideStep.ACTION_LIGHTDASH ||
    step === DataModelingGuideStep.ACTION_GROUPBY ||
    step === DataModelingGuideStep.ACTION_WHERE;

  if (isActionGuide) {
    return rule;
  }

  // For other guides, check if the rule's when condition is satisfied
  if (rule.when(state)) {
    return rule;
  }

  return null;
}
