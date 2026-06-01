import { DataModelingGuideStep } from '@web/features/Tutorial/config/assistMe/assistSteps';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { SchemaSelect } from './useModelStore';

// Re-export ActionType from DataModeling for convenience
export enum ActionType {
  LIGHTDASH = 'lightdash',
  GROUPBY = 'groupby',
  WHERE = 'where',
  CTE = 'cte',
}

export type TutorialMode = 'select' | 'join' | 'union' | 'rollup' | 'lookback';

/**
 * Tutorial Component State Enum
 * Single source of truth for all tutorial UI states
 * Replaces multiple boolean flags with clear, explicit states
 */
export enum TutorialComponentState {
  // Idle/Default
  NONE = 'none',

  // Column Selection States
  COLUMN_SELECTION_IDLE = 'column_selection_idle',
  COLUMN_SELECTION_ADD_BUTTON = 'column_selection_add_button',

  // Add Column Basic States
  ADD_COLUMN_MODAL_OPEN = 'add_column_modal_open',
  ADD_COLUMN_TYPE = 'add_column_type',
  ADD_COLUMN_NAME = 'add_column_name',
  ADD_COLUMN_DATATYPE = 'add_column_datatype',
  ADD_COLUMN_DESCRIPTION = 'add_column_description',
  ADD_COLUMN_EXPRESSION = 'add_column_expression',

  // Column Configuration States
  COLUMN_CONFIG_OVERVIEW = 'column_config_overview',
  COLUMN_CONFIG_TABS = 'column_config_tabs',
  COLUMN_CONFIG_GENERAL_TAB = 'column_config_general_tab',
  COLUMN_CONFIG_LIGHTDASH_TAB = 'column_config_lightdash_tab',
  COLUMN_CONFIG_OTHERS_TAB = 'column_config_others_tab',

  // Lightdash Tab Sub-states
  LIGHTDASH_DIMENSION = 'lightdash_dimension',
  LIGHTDASH_STANDARD_METRICS = 'lightdash_standard_metrics',
  LIGHTDASH_CUSTOM_METRICS = 'lightdash_custom_metrics',
  LIGHTDASH_METRICS_MERGE = 'lightdash_metrics_merge',

  // Others Tab Sub-states
  OTHERS_EXCLUDE_GROUPBY = 'others_exclude_groupby',
  OTHERS_INTERVAL = 'others_interval',
  OTHERS_DATA_TESTS = 'others_data_tests',

  // Action Nodes
  ACTIONS_BAR = 'actions_bar',
  ACTION_LIGHTDASH_NODE = 'action_lightdash_node',
  ACTION_GROUPBY_NODE = 'action_groupby_node',
  ACTION_WHERE_NODE = 'action_where_node',

  // Join States
  JOIN_NODE = 'join_node',
  JOIN_ADD_BUTTON = 'join_add_button',
}

/**
 * Tutorial Store Interface
 * Manages state for Play Tutorial feature AND Assist Mode
 */
export interface TutorialStore {
  // ===== Play Tutorial Mode & State =====
  isPlayTutorialActive: boolean;
  tutorialMode: TutorialMode | null;
  currentStepIndex: number;
  totalSteps: number;

  // ===== Form Ready State (Coordination Signal) =====
  isFormReady: boolean; // Signals that the form is fully loaded and ready for tutorial

  // ===== Assist Mode State =====
  assistModeEnabled: boolean;
  hasCompletedIntro: boolean;
  currentAssistStepIndex: number;
  isAssistTutorialActive: boolean; // Whether the assist tutorial driver is currently running

  // ===== Data Modeling Self-Exploratory Guide =====
  currentDataModelingGuideStep: DataModelingGuideStep; // Current guide step for on-demand tutorials

  // ===== NEW: Single State for UI Components =====
  currentComponentState: TutorialComponentState; // Single source of truth for UI state
  activeColumnConfigTab: 'general' | 'lightdash' | 'others' | null; // Active tab in Column Configuration
  tutorialActiveTabIndex: number | null; // Active tab index for components with tabs
  tutorialPreviewType: 'sql' | 'yaml' | 'json' | 'meta' | null; // Active preview type in FinalPreview

  // ===== Data States (Actual Tutorial Data) =====
  tutorialSelectedColumn: Partial<SchemaSelect> | null; // Pre-filled column data
  tutorialActiveActions: Set<ActionType>; // Which actions are toggled on
  tutorialJoinConfigs: Array<{
    model: string;
    type: string;
    uuid?: string;
  }>; // Pre-configured joins

  // ===== Navigation & Highlighting =====
  tutorialNavigationNodeType: string | null; // Which node to navigate to
  tutorialNavigationZoomLevel: number; // Zoom level for React Flow navigation (default: 1, lower = zoomed out)
  tutorialHighlightElement: string | null; // Which element to highlight

  // ===== Wizard Step Control =====
  tutorialWizardStep: number; // Current wizard step (0-3)

  // ===== Actions =====

  // Initialize Play Tutorial
  startPlayTutorial: (mode: TutorialMode, totalSteps: number) => void;
  stopPlayTutorial: () => void;

  // Progress Management
  setCurrentStep: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;

  // Form Ready Management
  setFormReady: (ready: boolean) => void;

  // Assist Mode Management
  enableAssistMode: () => void;
  disableAssistMode: () => void;
  toggleAssistMode: () => void;
  setHasCompletedIntro: (completed: boolean) => void;
  setCurrentAssistStepIndex: (index: number) => void;
  setAssistTutorialActive: (active: boolean) => void;

  // Assist Mode Step Navigation
  assistMoveToStepFn: ((stepId: string) => void) | null;
  setAssistMoveToStepFn: (fn: ((stepId: string) => void) | null) => void;
  moveToAssistStep: (stepId: string) => void;

  // Data Modeling Self-Exploratory Guide Management
  setDataModelingGuideStep: (step: DataModelingGuideStep) => void;
  clearDataModelingGuideStep: () => void;

  // ===== NEW: UI State Management =====
  setCurrentComponentState: (state: TutorialComponentState) => void;
  setActiveColumnConfigTab: (
    tab: 'general' | 'lightdash' | 'others' | null,
  ) => void;
  setTutorialActiveTabIndex: (index: number | null) => void;
  setTutorialPreviewType: (
    type: 'sql' | 'yaml' | 'json' | 'meta' | null,
  ) => void;

  // ===== Data Management =====
  setTutorialSelectedColumn: (column: Partial<SchemaSelect> | null) => void;

  // Action Node Control
  setTutorialActiveActions: (actions: Set<ActionType>) => void;
  toggleTutorialAction: (action: ActionType) => void;
  clearTutorialActions: () => void;

  // Join Configuration
  setTutorialJoinConfigs: (
    configs: Array<{ model: string; type: string; uuid?: string }>,
  ) => void;

  // Navigation
  setTutorialNavigationNodeType: (
    nodeType: string | null,
    zoomLevel?: number,
  ) => void;
  setTutorialHighlightElement: (element: string | null) => void;

  // Wizard Step
  setTutorialWizardStep: (step: number) => void;

  // Reset
  reset: () => void;
}

// Initial State
const initialState = {
  // Play Tutorial
  isPlayTutorialActive: false,
  tutorialMode: null,
  currentStepIndex: 0,
  totalSteps: 0,

  // Form Ready
  isFormReady: false,

  // Assist Mode
  assistModeEnabled: false,
  hasCompletedIntro: false,
  currentAssistStepIndex: 0,
  isAssistTutorialActive: false,

  // Data Modeling Self-Exploratory Guide
  currentDataModelingGuideStep: DataModelingGuideStep.NONE,

  // NEW: Single state management
  currentComponentState: TutorialComponentState.NONE,
  activeColumnConfigTab: null,
  tutorialActiveTabIndex: null,
  tutorialPreviewType: null,

  // Data states
  tutorialSelectedColumn: null,
  tutorialActiveActions: new Set<ActionType>(),
  tutorialJoinConfigs: [],

  // Navigation
  tutorialNavigationNodeType: null,
  tutorialNavigationZoomLevel: 1,
  tutorialHighlightElement: null,
  tutorialWizardStep: 0,

  // Assist Mode Step Navigation
  assistMoveToStepFn: null,
};

/**
 * Tutorial Store
 * Manages all state for the Play Tutorial feature
 * Enables UI simulation without actual user interaction
 */
export const useTutorialStore = create<TutorialStore>()(
  subscribeWithSelector((set, get) => ({
    // ===== Initial State =====
    ...initialState,

    // ===== Actions =====

    /**
     * Start Play Tutorial
     * Initializes tutorial with specified mode
     */
    startPlayTutorial: (mode: TutorialMode, totalSteps: number) => {
      set({
        isPlayTutorialActive: true,
        tutorialMode: mode,
        currentStepIndex: 0,
        totalSteps,
        tutorialWizardStep: 0,
      });
    },

    /**
     * Stop Play Tutorial
     * Resets all tutorial state
     */
    stopPlayTutorial: () => {
      set({
        ...initialState,
        tutorialActiveActions: new Set<ActionType>(), // Recreate Set to avoid reference issues
      });
    },

    /**
     * Set current step index
     */
    setCurrentStep: (index: number) => {
      set({ currentStepIndex: index });
    },

    /**
     * Move to next step
     */
    nextStep: () => {
      const { currentStepIndex, totalSteps } = get();
      if (currentStepIndex < totalSteps - 1) {
        set({ currentStepIndex: currentStepIndex + 1 });
      }
    },

    /**
     * Move to previous step
     */
    previousStep: () => {
      const { currentStepIndex } = get();
      if (currentStepIndex > 0) {
        set({ currentStepIndex: currentStepIndex - 1 });
      }
    },

    // ===== Form Ready Management =====

    /**
     * Set form ready state
     * Called when the form is fully loaded and ready for tutorial
     */
    setFormReady: (ready: boolean) => {
      set({ isFormReady: ready });
    },

    // ===== Assist Mode Management =====

    /**
     * Enable Assist Mode
     */
    enableAssistMode: () => {
      set({ assistModeEnabled: true });
    },

    /**
     * Disable Assist Mode
     */
    disableAssistMode: () => {
      set({ assistModeEnabled: false });
    },

    /**
     * Toggle Assist Mode on/off
     */
    toggleAssistMode: () => {
      const { assistModeEnabled } = get();
      set({ assistModeEnabled: !assistModeEnabled });
    },

    /**
     * Set whether user has completed intro tutorial
     */
    setHasCompletedIntro: (completed: boolean) => {
      set({ hasCompletedIntro: completed });
    },

    /**
     * Set current assist step index
     */
    setCurrentAssistStepIndex: (index: number) => {
      set({ currentAssistStepIndex: index });
    },

    /**
     * Set assist tutorial active state
     */
    setAssistTutorialActive: (active: boolean) => {
      set({ isAssistTutorialActive: active });
    },

    /**
     * Register the moveToStep function from useAssistTutorial
     */
    setAssistMoveToStepFn: (fn: ((stepId: string) => void) | null) => {
      set({ assistMoveToStepFn: fn });
    },

    /**
     * Move to a specific assist step by ID
     */
    moveToAssistStep: (stepId: string) => {
      const { assistMoveToStepFn } = get();
      if (assistMoveToStepFn) {
        assistMoveToStepFn(stepId);
      } else {
        console.warn(
          '[TutorialStore] moveToAssistStep called but no function registered',
        );
      }
    },

    // ===== Data Modeling Self-Exploratory Guide Management =====

    /**
     * Set current Data Modeling guide step for on-demand tutorials
     */
    setDataModelingGuideStep: (step: DataModelingGuideStep) => {
      set({ currentDataModelingGuideStep: step });
    },

    /**
     * Clear current Data Modeling guide step
     */
    clearDataModelingGuideStep: () => {
      set({ currentDataModelingGuideStep: DataModelingGuideStep.NONE });
    },

    // ===== NEW: UI State Management =====

    /**
     * Set the current component state (single source of truth for UI)
     */
    setCurrentComponentState: (state: TutorialComponentState) => {
      set({ currentComponentState: state });
    },

    /**
     * Set the active tab in Column Configuration
     */
    setActiveColumnConfigTab: (
      tab: 'general' | 'lightdash' | 'others' | null,
    ) => {
      set({ activeColumnConfigTab: tab });
    },

    /**
     * Set the active tab index for components with tabs
     */
    setTutorialActiveTabIndex: (index: number | null) => {
      set({ tutorialActiveTabIndex: index });
    },

    /**
     * Set the active preview type in FinalPreview
     */
    setTutorialPreviewType: (type: 'sql' | 'yaml' | 'json' | 'meta' | null) => {
      set({ tutorialPreviewType: type });
    },

    // ===== Data Management =====

    /**
     * Set pre-filled column data for configuration
     */
    setTutorialSelectedColumn: (column: Partial<SchemaSelect> | null) => {
      set({ tutorialSelectedColumn: column });
    },

    // ===== Action Node Control =====

    /**
     * Set which actions are active (replaces entire set)
     */
    setTutorialActiveActions: (actions: Set<ActionType>) => {
      set({ tutorialActiveActions: new Set(actions) });
    },

    /**
     * Toggle a specific action on/off
     */
    toggleTutorialAction: (action: ActionType) => {
      const { tutorialActiveActions } = get();
      const newActions = new Set(tutorialActiveActions);

      if (newActions.has(action)) {
        newActions.delete(action);
      } else {
        newActions.add(action);
      }

      set({ tutorialActiveActions: newActions });
    },

    /**
     * Clear all active actions
     */
    clearTutorialActions: () => {
      set({ tutorialActiveActions: new Set<ActionType>() });
    },

    // ===== Join Configuration =====

    /**
     * Set pre-configured join configurations
     */
    setTutorialJoinConfigs: (
      configs: Array<{ model: string; type: string; uuid?: string }>,
    ) => {
      set({ tutorialJoinConfigs: configs });
    },

    // ===== Navigation =====

    /**
     * Set which node to navigate to
     */
    setTutorialNavigationNodeType: (
      nodeType: string | null,
      zoomLevel?: number,
    ) => {
      set({
        tutorialNavigationNodeType: nodeType,
        tutorialNavigationZoomLevel: zoomLevel ?? 1,
      });
    },

    /**
     * Set which element to highlight
     */
    setTutorialHighlightElement: (element: string | null) => {
      set({ tutorialHighlightElement: element });
    },

    // ===== Wizard Step =====

    /**
     * Set current wizard step (0-3)
     */
    setTutorialWizardStep: (step: number) => {
      set({ tutorialWizardStep: step });
    },

    // ===== Reset =====

    /**
     * Reset all tutorial state to initial values
     */
    reset: () => {
      set({
        ...initialState,
        tutorialActiveActions: new Set<ActionType>(), // Recreate Set to avoid reference issues
      });
    },
  })),
);

/**
 * Selector Hooks for Performance Optimization
 * Use these in components that only need specific slices of state
 */

// Check if Play Tutorial is active
export const useIsPlayTutorialActive = () =>
  useTutorialStore((state) => state.isPlayTutorialActive);

// Get current tutorial mode
export const useTutorialMode = () =>
  useTutorialStore((state) => state.tutorialMode);

// Get current step index
export const useCurrentStepIndex = () =>
  useTutorialStore((state) => state.currentStepIndex);

// ===== NEW: Enum-based State Selectors =====

// Get current component state
export const useCurrentComponentState = () =>
  useTutorialStore((state) => state.currentComponentState);

// Get active Column Configuration tab
export const useActiveColumnConfigTab = () =>
  useTutorialStore((state) => state.activeColumnConfigTab);

// ===== Data Selectors =====

// Get tutorial column data
export const useTutorialColumnData = () =>
  useTutorialStore((state) => ({
    selectedColumn: state.tutorialSelectedColumn,
    activeActions: state.tutorialActiveActions,
  }));

// ===== Form Ready Selectors =====

// Check if form is ready for tutorial
export const useIsFormReady = () =>
  useTutorialStore((state) => state.isFormReady);

// ===== Assist Mode Selectors =====

// Check if Assist Mode is enabled
export const useAssistModeEnabled = () =>
  useTutorialStore((state) => state.assistModeEnabled);

// Check if user has completed intro
export const useHasCompletedIntro = () =>
  useTutorialStore((state) => state.hasCompletedIntro);

// Get current assist step index
export const useCurrentAssistStepIndex = () =>
  useTutorialStore((state) => state.currentAssistStepIndex);

// Check if assist tutorial is currently active
export const useIsAssistTutorialActive = () =>
  useTutorialStore((state) => state.isAssistTutorialActive);
