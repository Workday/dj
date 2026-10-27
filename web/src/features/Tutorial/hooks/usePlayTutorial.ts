import 'driver.js/dist/driver.css';
import '../tutorial-custom.css'; // Custom styling for close button visibility

import { useTutorialStore } from '@web/stores/useTutorialStore';
import type { Driver, DriveStep } from 'driver.js';
import { driver } from 'driver.js';
import { useCallback, useEffect, useRef } from 'react';

import {
  PLAY_TUTORIAL_CONFIG,
  WIZARD_STEP_TRANSITION_DELAY,
} from '../config/constants';
import { joinModelSteps } from '../config/playTutorial/joinModelSteps';
import { lookbackModelSteps } from '../config/playTutorial/lookbackModelSteps';
import { rollupModelSteps } from '../config/playTutorial/rollupModelSteps';
import { selectModelSteps } from '../config/playTutorial/selectModelSteps';
import { unionModelSteps } from '../config/playTutorial/unionModelSteps';
import { joinModelDemoData } from '../data/joinModelDemo';
import { lookbackModelDemoData } from '../data/lookbackModelDemo';
import { rollupModelDemoData } from '../data/rollupModelDemo';
import { selectModelDemoData } from '../data/selectModelDemo';
import { unionModelDemoData } from '../data/unionModelDemo';
import type { DemoData, TutorialMode, TutorialStep } from '../types';

interface UsePlayTutorialProps {
  currentWizardStep: number;
  onWizardStepChange: (step: number) => void;
  onDataPrefill: (data: Partial<DemoData>) => void;
  onDataClear: () => void;
  setNavigationNodeType: (nodeType: string | null) => void;
  defaultProjectName?: string; // Default project to use for tutorials
}

interface UsePlayTutorialReturn {
  startPlayTutorial: (mode: TutorialMode) => void;
  stopPlayTutorial: () => void;
  isPlayTutorialActive: boolean;
}

/**
 * Play Tutorial hook - Demo walkthrough with prefilled data
 * Shows users how to create different types of models with example data
 * Now integrated with useTutorialStore for centralized state management
 */
export function usePlayTutorial({
  currentWizardStep,
  onWizardStepChange,
  onDataPrefill,
  onDataClear,
  setNavigationNodeType,
  defaultProjectName,
}: UsePlayTutorialProps): UsePlayTutorialReturn {
  const driverInstance = useRef<Driver | null>(null);

  // Get only the state we need (not the entire store object)
  const isPlayTutorialActive = useTutorialStore(
    (state) => state.isPlayTutorialActive,
  );

  // Keep refs for Driver.js callbacks (can't use store state directly in callbacks)
  const currentStepIndexRef = useRef(0);
  const currentModeRef = useRef<TutorialMode | null>(null);
  const tutorialStepsRef = useRef<TutorialStep[]>([]);

  // Get tutorial steps based on mode
  const getTutorialSteps = useCallback((mode: TutorialMode): TutorialStep[] => {
    switch (mode) {
      case 'select':
        return selectModelSteps;
      case 'join':
        return joinModelSteps;
      case 'union':
        return unionModelSteps;
      case 'rollup':
        return rollupModelSteps;
      case 'lookback':
        return lookbackModelSteps;
      default:
        return selectModelSteps;
    }
  }, []);

  // Get demo data based on mode
  const getDemoData = useCallback(
    (mode: TutorialMode): DemoData => {
      let baseData: DemoData;
      switch (mode) {
        case 'select':
          baseData = selectModelDemoData;
          break;
        case 'join':
          baseData = joinModelDemoData;
          break;
        case 'union':
          baseData = unionModelDemoData;
          break;
        case 'rollup':
          baseData = rollupModelDemoData;
          break;
        case 'lookback':
          baseData = lookbackModelDemoData;
          break;
        default:
          baseData = selectModelDemoData;
      }

      // Inject user's actual project name (if provided)
      return {
        ...baseData,
        projectName:
          defaultProjectName || baseData.projectName || 'demo_project',
      };
    },
    [defaultProjectName],
  );

  // Stop Play Tutorial and cleanup
  const stopPlayTutorial = useCallback(() => {
    if (driverInstance.current) {
      driverInstance.current.destroy();
      driverInstance.current = null;
    }

    // Reset tutorial store (use getState to avoid dependency)
    useTutorialStore.getState().stopPlayTutorial();

    // Reset refs
    currentStepIndexRef.current = 0;
    currentModeRef.current = null;
    tutorialStepsRef.current = [];

    // Clear data and reset to Basic Information
    onDataClear();
    onWizardStepChange(0);
  }, [onDataClear, onWizardStepChange]);

  // Prefill data progressively as user advances through steps
  const prefillDataForStep = useCallback(
    (stepIndex: number, steps: TutorialStep[], demoData: DemoData) => {
      const currentStep = steps[stepIndex];
      if (!currentStep || !currentStep.element) return;

      // Determine what data to prefill based on the step
      const element =
        typeof currentStep.element === 'string' ? currentStep.element : '';

      if (element.includes('actions-bar')) {
        // Prefill data BEFORE action nodes render
        // Check which action is about to be shown based on next step
        const nextStepIndex = stepIndex + 1;
        const nextStep = steps[nextStepIndex];

        if (nextStep && nextStep.element) {
          const nextElement =
            typeof nextStep.element === 'string' ? nextStep.element : '';

          // Prefill GroupBy before GroupBy node renders
          if (nextElement.includes('groupby-node') && demoData.groupBy) {
            const groupByData = demoData.groupBy as {
              dimensions?: boolean;
              columns?: string[];
              expressions?: string[];
            };

            const groupByArray: Array<
              string | { expr: string } | { type: 'dims' }
            > = [];

            if (groupByData.dimensions) {
              groupByArray.push({ type: 'dims' });
            }

            if (groupByData.columns) {
              groupByArray.push(...groupByData.columns);
            }

            if (groupByData.expressions) {
              groupByArray.push(
                ...groupByData.expressions.map((expr: string) => ({ expr })),
              );
            }

            if (groupByArray.length > 0) {
              onDataPrefill({ group_by: groupByArray as any });
            }
          }

          // Prefill Where before Where node renders
          if (nextElement.includes('where-node') && demoData.where) {
            onDataPrefill({ where: demoData.where });
          }
        }
      } else if (element.includes('project-select')) {
        // Prefill project
        onDataPrefill({ projectName: demoData.projectName });
      } else if (element.includes('model-name-input')) {
        // Prefill model name
        onDataPrefill({ name: demoData.name });
      } else if (element.includes('source-selection')) {
        // Prefill source layer
        onDataPrefill({ source: demoData.source });
      } else if (element.includes('type-selection')) {
        // Prefill type
        onDataPrefill({ type: demoData.type });
      } else if (element.includes('group-selection')) {
        // Prefill group
        onDataPrefill({ group: demoData.group });
      } else if (element.includes('topic-input')) {
        // Prefill topic
        onDataPrefill({ topic: demoData.topic });
      } else if (element.includes('materialization-select')) {
        // Prefill materialization
        onDataPrefill({ materialization: demoData.materialization });
      } else if (element.includes('select-node')) {
        // Prefill source selection (from.model or from.source)
        if (demoData.from) {
          onDataPrefill({
            from: demoData.from,
          });
        }
      } else if (element.includes('add-join-button-node')) {
        // Prefill join data BEFORE the join node is shown (timing fix)
        // This ensures the JoinNode component exists when we navigate to it
        if (demoData.join) {
          onDataPrefill({
            join: demoData.join,
          });
        }
      } else if (element.includes('join-node')) {
        // Join data already prefilled at add-join-button-node step
        // Keep this for backwards compatibility or direct navigation
        if (demoData.join) {
          onDataPrefill({
            join: demoData.join,
          });
        }
      } else if (element.includes('column-selection')) {
        // Prefill column selections
        if (demoData.select) {
          onDataPrefill({
            select: demoData.select,
          });
        }
      } else if (
        element.includes('lookback-node') ||
        element.includes('lookback-period')
      ) {
        // Prefill lookback configuration
        if (
          demoData.from &&
          typeof demoData.from === 'object' &&
          'lookback' in demoData.from
        ) {
          onDataPrefill({
            from: demoData.from,
          });
        }
      } else if (
        element.includes('rollup-node') ||
        element.includes('rollup-dimensions')
      ) {
        // Prefill rollup configuration
        if (
          demoData.from &&
          typeof demoData.from === 'object' &&
          'rollup' in demoData.from
        ) {
          onDataPrefill({
            from: demoData.from,
          });
        }
      } else if (element.includes('union-node')) {
        // Prefill union configuration
        // Union data can be at top-level (demoData.union) or nested (demoData.from.union)
        const unionData =
          demoData.union ||
          (demoData.from &&
          typeof demoData.from === 'object' &&
          'union' in demoData.from
            ? (demoData.from as { union: typeof demoData.union }).union
            : null);

        if (unionData) {
          onDataPrefill({
            union: unionData,
          });
        }
      } else if (element.includes('description-input')) {
        // Prefill description
        if (demoData.description) {
          onDataPrefill({ description: demoData.description });
        }
      } else if (element.includes('tags-input')) {
        // Prefill tags
        if (demoData.tags) {
          onDataPrefill({ tags: demoData.tags });
        }
      } else if (
        element.includes('add-column-modal') ||
        element.includes('add-column-type') ||
        element.includes('add-column-name') ||
        element.includes('add-column-datatype') ||
        element.includes('add-column-description') ||
        element.includes('add-column-expression')
      ) {
        // Prefill AddColumnBasic - find the custom column being added
        if (demoData.select) {
          const customColumn = demoData.select.find(
            (col) =>
              typeof col === 'object' &&
              'expr' in col &&
              col.expr &&
              'name' in col,
          );
          if (customColumn) {
            // Set this column as the one being created/edited
            useTutorialStore.getState().setTutorialSelectedColumn(customColumn);
          }
        }
      } else if (
        element.includes('column-configuration-node') ||
        element.includes('colconfig-general-type') ||
        element.includes('colconfig-lightdash-dimension') ||
        element.includes('colconfig-lightdash-metrics') ||
        element.includes('colconfig-others-datatests')
      ) {
        // Prefill ColumnConfiguration - set the column to edit
        if (demoData.select) {
          const columnToEdit = demoData.select.find(
            (col) =>
              typeof col === 'object' &&
              'name' in col &&
              'expr' in col &&
              col.name === 'full_name', // Specific column with full config
          );
          if (columnToEdit) {
            // Set this column as being edited
            useTutorialStore.getState().setTutorialSelectedColumn(columnToEdit);
          }
        }
      } else if (element.includes('lightdash-node')) {
        // Prefill Lightdash Node - table-level lightdash configuration
        if (demoData.lightdash) {
          onDataPrefill({ lightdash: demoData.lightdash });
        }
      }
      // Note: GroupBy and Where prefilling is now handled in the 'actions-bar' step
      // to ensure data is set BEFORE the node renders (timing issue fix)
      // Add more prefill logic for other steps as needed
    },
    [onDataPrefill],
  );

  // Handle tutorial exit (close button clicked)
  const handleTutorialExit = useCallback(() => {
    // 1. Clear all demo data
    onDataClear();

    // 2. Navigate back to Basic Information (wizardStep 0)
    onWizardStepChange(0);

    // 3. Stop the tutorial and reset store
    stopPlayTutorial();

    // 4. Clear navigation state
    setNavigationNodeType(null);
  }, [
    onDataClear,
    onWizardStepChange,
    stopPlayTutorial,
    setNavigationNodeType,
  ]);

  // Start Play Tutorial with specified mode
  const startPlayTutorial = useCallback(
    (mode: TutorialMode) => {
      // Stop any existing tutorial
      if (driverInstance.current) {
        stopPlayTutorial();
      }

      currentModeRef.current = mode;
      const tutorialSteps = getTutorialSteps(mode);
      const baseDemoData = getDemoData(mode);

      const demoData: DemoData = {
        ...baseDemoData,
        projectName: defaultProjectName || baseDemoData.projectName,
      };

      // Store tutorial steps in ref for callbacks
      tutorialStepsRef.current = tutorialSteps;

      // Initialize tutorial store (use getState to avoid dependency)
      useTutorialStore.getState().startPlayTutorial(mode, tutorialSteps.length);

      const driveSteps: DriveStep[] = tutorialSteps.map(
        (step): DriveStep => ({
          element: step.element,
          popover: step.popover,
        }),
      );

      // Create driver instance
      driverInstance.current = driver({
        ...PLAY_TUTORIAL_CONFIG,
        steps: driveSteps,
        onDestroyStarted: () => {
          // User clicked the close button or ESC key
          handleTutorialExit();
        },
        onNextClick: (_element, _step, _options) => {
          const handleNext = async () => {
            const currentStep = tutorialSteps[currentStepIndexRef.current];
            const nextStep = tutorialSteps[currentStepIndexRef.current + 1];
            const store = useTutorialStore.getState();

            // Execute onStepExit for current step
            if (currentStep?.onStepExit) {
              currentStep.onStepExit(store);
            }

            // ⭐ CRITICAL: Prefill data BEFORE navigation
            // This ensures nodes exist before we try to navigate to them
            if (nextStep) {
              prefillDataForStep(
                currentStepIndexRef.current + 1, // Next step index
                tutorialSteps,
                demoData,
              );
              // Wait for React to process state updates and create nodes
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            // Check if we need to advance wizard step
            if (currentStep?.requiresWizardAdvance && nextStep) {
              const nextWizardStep = nextStep.wizardStep ?? currentWizardStep;

              // Only advance if we're moving to a different wizard step
              if (nextWizardStep !== currentWizardStep) {
                // Advance wizard step
                onWizardStepChange(nextWizardStep);
                store.setTutorialWizardStep(nextWizardStep);

                // Wait for DOM to update
                await new Promise((resolve) =>
                  setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
                );
              }
            }

            // Navigate to the next node if it has a nodeType (Data Modeling step)
            if (nextStep?.nodeType) {
              setNavigationNodeType(nextStep.nodeType);
              store.setTutorialNavigationNodeType(
                nextStep.nodeType,
                nextStep.zoomLevel,
              );
              // Wait for navigation animation to complete (800ms animation + buffer)
              await new Promise((resolve) => setTimeout(resolve, 900));
            }

            // Move to next tutorial step
            currentStepIndexRef.current += 1;
            store.setCurrentStep(currentStepIndexRef.current);

            // Execute onStepEnter for next step
            if (nextStep?.onStepEnter) {
              nextStep.onStepEnter(store);
              // Wait for React Flow to re-render after state change (especially for action nodes)
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            driverInstance.current?.moveNext();
          };

          void handleNext();
        },
        onPrevClick: (_element, _step, _options) => {
          const handlePrev = async () => {
            const currentStep = tutorialSteps[currentStepIndexRef.current];
            const prevStep = tutorialSteps[currentStepIndexRef.current - 1];
            const store = useTutorialStore.getState();

            // Execute onStepExit for current step (going backwards)
            if (currentStep?.onStepExit) {
              currentStep.onStepExit(store);
            }

            // Check if we need to go back wizard step
            if (prevStep && currentStep) {
              const prevWizardStep = prevStep.wizardStep ?? currentWizardStep;
              const currWizardStep =
                currentStep.wizardStep ?? currentWizardStep;

              // Only go back if we're moving to a different wizard step
              if (prevWizardStep !== currWizardStep) {
                // Go back wizard step
                onWizardStepChange(prevWizardStep);
                store.setTutorialWizardStep(prevWizardStep);

                // Wait for DOM to update
                await new Promise((resolve) =>
                  setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
                );
              }
            }

            // Move to previous tutorial step FIRST
            currentStepIndexRef.current -= 1;
            store.setCurrentStep(currentStepIndexRef.current);

            // Execute onStepEnter for previous step
            if (prevStep?.onStepEnter) {
              prevStep.onStepEnter(store);
              // Wait for React Flow to re-render after state change (especially for action nodes)
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            // Navigate to the previous node if it has a nodeType (Data Modeling step)
            if (prevStep?.nodeType) {
              setNavigationNodeType(prevStep.nodeType);
              store.setTutorialNavigationNodeType(
                prevStep.nodeType,
                prevStep.zoomLevel,
              );
              // Wait for navigation animation to complete (800ms animation + buffer)
              await new Promise((resolve) => setTimeout(resolve, 900));
            }

            driverInstance.current?.movePrevious();
          };

          void handlePrev();
        },
      });

      // Prefill data for the first step
      prefillDataForStep(0, tutorialSteps, demoData);

      // Navigate to starting node if it has a nodeType
      const startingStep = tutorialSteps[0];
      const store = useTutorialStore.getState();

      // Execute onStepEnter for the first step
      if (startingStep?.onStepEnter) {
        startingStep.onStepEnter(store);
      }

      if (startingStep?.nodeType) {
        setNavigationNodeType(startingStep.nodeType);
        store.setTutorialNavigationNodeType(
          startingStep.nodeType,
          startingStep.zoomLevel,
        );
        // Wait for navigation to complete before highlighting
        setTimeout(() => {
          if (driverInstance.current) {
            currentStepIndexRef.current = 0;
            useTutorialStore.getState().setCurrentStep(0);
            driverInstance.current.drive();
          }
        }, 900); // Wait for 800ms animation + buffer
      } else {
        // Start immediately if no navigation needed
        currentStepIndexRef.current = 0;
        store.setCurrentStep(0);
        driverInstance.current.drive();
      }
    },
    [
      getTutorialSteps,
      getDemoData,
      stopPlayTutorial,
      handleTutorialExit,
      currentWizardStep,
      onWizardStepChange,
      prefillDataForStep,
      setNavigationNodeType,
      defaultProjectName,
    ],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayTutorial();
    };
  }, [stopPlayTutorial]);

  return {
    startPlayTutorial,
    stopPlayTutorial,
    isPlayTutorialActive,
  };
}
