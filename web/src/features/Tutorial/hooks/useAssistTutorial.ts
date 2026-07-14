import 'driver.js/dist/driver.css';

import { useTutorialStore } from '@web/stores/useTutorialStore';
import type { Driver, DriveStep } from 'driver.js';
import { driver } from 'driver.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ModelState } from '../config/assistMe/assistSteps';
import {
  findStartingAssistStep,
  generateAssistSteps,
} from '../config/assistMe/assistSteps';
import {
  ASSIST_MODE_CONFIG,
  WIZARD_STEP_TRANSITION_DELAY,
} from '../config/constants';
import { useAssistMode } from './useAssistMode';

interface UseAssistTutorialProps {
  currentWizardStep: number;
  onWizardStepChange: (step: number) => void;
  modelState: ModelState;
}

interface UseAssistTutorialReturn {
  startAssistMode: () => void;
  stopAssistMode: () => void;
  isAssistActive: boolean;
  moveToStep: (stepId: string) => void;
}

/**
 * Hook for Assist Mode - context-aware, auto-focus tutorial
 *
 * IMPORTANT: Tutorial only starts AFTER isFormReady becomes true
 * This prevents flickering and ensures the form is fully loaded
 */
export function useAssistTutorial({
  currentWizardStep,
  onWizardStepChange,
  modelState,
}: UseAssistTutorialProps): UseAssistTutorialReturn {
  const driverInstance = useRef<Driver | null>(null);
  const currentStepIndexRef = useRef(0);
  const isRegeneratingRef = useRef(false);
  const prevWizardStepRef = useRef(currentWizardStep);

  // Track previous assistModeEnabled to detect manual toggle (false -> true)
  const prevAssistModeEnabledRef = useRef<boolean | null>(null);

  // Get state from store (centralized state management)
  const {
    assistModeEnabled,
    isFormReady,
    isAssistTutorialActive,
    setCurrentAssistStepIndex,
    setTutorialNavigationNodeType,
    setHasCompletedIntro,
    setAssistTutorialActive,
  } = useTutorialStore();

  const { hasCompletedIntro, disableAssist } = useAssistMode();

  // Alias for backward compatibility
  const isAssistActive = isAssistTutorialActive;

  // Generate assist steps based on current model state
  const hasName = !!modelState.name;
  const hasTopic = !!modelState.topic;

  const assistSteps = useMemo(() => {
    const stableState = {
      ...modelState,
      name:
        modelState.name && modelState.name.length > 0 ? 'filled' : undefined,
      topic:
        modelState.topic && modelState.topic.length > 0 ? 'filled' : undefined,
    };
    return generateAssistSteps(stableState);
  }, [
    modelState.projectName,
    modelState.source,
    modelState.type,
    modelState.group,
    modelState.materialized,
    modelState.fromModel,
    modelState.fromSource,
    modelState.hasJoins,
    modelState.hasSelect,
    hasName,
    hasTopic,
  ]);

  // Stop assist mode and disable it
  const stopAssistMode = useCallback(() => {
    if (driverInstance.current) {
      driverInstance.current.destroy();
      driverInstance.current = null;
    }

    // Disconnect dropdown observer

    if ((window as any).__tutorialDropdownObserver) {
      (window as any).__tutorialDropdownObserver.disconnect();

      delete (window as any).__tutorialDropdownObserver;
    }

    // Update centralized store state
    setAssistTutorialActive(false);
    // Disable assist mode with proper persistence
    disableAssist();
  }, [disableAssist, setAssistTutorialActive]);

  // Helper to apply pointer events fix and dropdown z-index
  const applyPointerEventsFix = useCallback(() => {
    const overlay = document.querySelector('.driver-overlay');
    if (overlay) {
      (overlay as HTMLElement).style.pointerEvents = 'none';
    }

    const activeElement = document.querySelector('.driver-active-element');
    if (activeElement) {
      (activeElement as HTMLElement).style.pointerEvents = 'auto';
    }

    const popover = document.querySelector('.driver-popover');
    if (popover) {
      (popover as HTMLElement).style.pointerEvents = 'auto';
    }

    // Fix dropdown z-index
    const fixDropdownMenus = () => {
      const dropdownMenus = document.querySelectorAll(
        '[role="listbox"], [role="menu"], [role="option"], .dropdown-menu, div[class*="menu"], div[class*="dropdown"], div[class*="option"], div[class*="listbox"]',
      );
      dropdownMenus.forEach((menu) => {
        const htmlElement = menu as HTMLElement;
        htmlElement.style.pointerEvents = 'auto';
        htmlElement.style.zIndex = '10002';
      });
    };

    fixDropdownMenus();

    const observer = new MutationObserver(() => {
      fixDropdownMenus();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    (window as any).__tutorialDropdownObserver = observer;
  }, []);

  // Helper to auto-focus field (no auto-opening dropdowns)
  const autoFocusField = useCallback(
    (element: Element | undefined, shouldOpenDropdown = false) => {
      if (!element) return;

      // Scroll element into view
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'center',
      });

      // Wait for scroll to complete
      setTimeout(() => {
        // Try to focus the element
        if (element instanceof HTMLElement) {
          // For input fields - only focus, don't open
          if (
            element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.hasAttribute('contenteditable')
          ) {
            element.focus();
          }

          // Only open dropdowns if explicitly requested
          if (shouldOpenDropdown) {
            // For dropdowns - try to click to open
            const selectButton = element.querySelector(
              'button[role="combobox"]',
            );
            if (selectButton && selectButton instanceof HTMLElement) {
              selectButton.click();
              return;
            }

            // For Headless UI Listbox
            const listboxButton = element.querySelector('[role="button"]');
            if (listboxButton && listboxButton instanceof HTMLElement) {
              listboxButton.click();
            }
          }
        }
      }, 500);
    },
    [],
  );

  // Create onNextClick handler
  const createOnNextClick = useCallback(() => {
    return async () => {
      const currentStep = assistSteps[currentStepIndexRef.current];
      const nextStep = assistSteps[currentStepIndexRef.current + 1];

      // Check if we need to advance wizard step
      if (currentStep?.requiresWizardAdvance && nextStep) {
        const nextWizardStep = nextStep.wizardStep ?? currentWizardStep;

        if (nextWizardStep !== currentWizardStep) {
          onWizardStepChange(nextWizardStep);
          await new Promise((resolve) =>
            setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
          );
        }
      }

      // Navigate to next node if it has a nodeType
      if (nextStep?.nodeType) {
        setTutorialNavigationNodeType(nextStep.nodeType, nextStep.zoomLevel);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      // Move to next step
      currentStepIndexRef.current += 1;
      setCurrentAssistStepIndex(currentStepIndexRef.current);

      // Execute onStepEnter for next step
      if (nextStep?.onStepEnter) {
        nextStep.onStepEnter(useTutorialStore.getState());
        // Wait for React Flow to re-render after state change
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // Auto-focus the next element (no auto-open)
      if (nextStep?.element && typeof nextStep.element === 'string') {
        const nextElement = document.querySelector(nextStep.element);
        if (nextElement) {
          autoFocusField(nextElement, false);
        }
      }

      driverInstance.current?.moveNext();
    };
  }, [
    assistSteps,
    currentWizardStep,
    onWizardStepChange,
    setTutorialNavigationNodeType,
    autoFocusField,
    setCurrentAssistStepIndex,
  ]);

  // Create onPrevClick handler
  const createOnPrevClick = useCallback(() => {
    return async () => {
      const currentStep = assistSteps[currentStepIndexRef.current];
      const prevStep = assistSteps[currentStepIndexRef.current - 1];

      if (prevStep && currentStep) {
        const prevWizardStep = prevStep.wizardStep ?? currentWizardStep;
        const currWizardStep = currentStep.wizardStep ?? currentWizardStep;

        if (prevWizardStep !== currWizardStep) {
          onWizardStepChange(prevWizardStep);
          await new Promise((resolve) =>
            setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
          );
        }
      }

      if (prevStep?.nodeType) {
        setTutorialNavigationNodeType(prevStep.nodeType, prevStep.zoomLevel);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      currentStepIndexRef.current -= 1;
      setCurrentAssistStepIndex(currentStepIndexRef.current);

      // Execute onStepEnter for previous step
      if (prevStep?.onStepEnter) {
        prevStep.onStepEnter(useTutorialStore.getState());
        // Wait for React Flow to re-render after state change
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (prevStep?.element && typeof prevStep.element === 'string') {
        const prevElement = document.querySelector(prevStep.element);
        if (prevElement) {
          autoFocusField(prevElement, false);
        }
      }

      driverInstance.current?.movePrevious();
    };
  }, [
    assistSteps,
    currentWizardStep,
    onWizardStepChange,
    setTutorialNavigationNodeType,
    autoFocusField,
    setCurrentAssistStepIndex,
  ]);

  // Regenerate driver when steps change (debounced to prevent focus loss)
  // Using a longer debounce and tracking previous steps to avoid unnecessary regenerations
  const prevAssistStepsLengthRef = useRef(0);

  useEffect(() => {
    if (!isAssistActive || !driverInstance.current || isRegeneratingRef.current)
      return;

    // Only regenerate if the number of steps actually changed
    if (prevAssistStepsLengthRef.current === assistSteps.length) {
      return;
    }

    // Debounce regeneration to prevent focus loss during typing
    const regenerateTimer = setTimeout(() => {
      if (!driverInstance.current || isRegeneratingRef.current) return;

      isRegeneratingRef.current = true;
      prevAssistStepsLengthRef.current = assistSteps.length;

      const currentStepIndex = currentStepIndexRef.current;
      const currentElement = document.activeElement; // Save current focus

      driverInstance.current.destroy();

      const driveSteps: DriveStep[] = assistSteps.map(
        (step): DriveStep => ({
          element: step.element,
          popover: step.popover,
        }),
      );

      driverInstance.current = driver({
        ...ASSIST_MODE_CONFIG,
        steps: driveSteps,
        onNextClick: () => {
          void createOnNextClick()();
        },
        onPrevClick: () => {
          void createOnPrevClick()();
        },
        onCloseClick: () => {
          setHasCompletedIntro(true);
          stopAssistMode();
        },
        onDestroyStarted: () => {
          stopAssistMode();
        },
        onHighlightStarted: applyPointerEventsFix,
      });

      const newStepIndex = Math.min(currentStepIndex, driveSteps.length - 1);
      currentStepIndexRef.current = newStepIndex;
      driverInstance.current.drive(newStepIndex);

      // Restore focus after regeneration
      setTimeout(() => {
        if (currentElement && currentElement instanceof HTMLElement) {
          currentElement.focus();
        }
        isRegeneratingRef.current = false;
      }, 100);
    }, 300); // Reduced to 300ms for faster button updates

    return () => clearTimeout(regenerateTimer);
  }, [
    assistSteps.length, // Only watch the length, not the entire array
    isAssistActive,
    createOnNextClick,
    createOnPrevClick,
    applyPointerEventsFix,
    stopAssistMode,
    setHasCompletedIntro,
  ]);

  // Start assist mode - smart resume from current context
  const startAssistMode = useCallback(async () => {
    // Clean up any existing instance first
    if (driverInstance.current) {
      driverInstance.current.destroy();
      driverInstance.current = null;
    }

    // Find the appropriate starting step based on current wizard step and form state
    // This allows manual toggles to resume from where the user is
    const startingIndex = findStartingAssistStep(assistSteps);

    const driveSteps: DriveStep[] = assistSteps.map(
      (step): DriveStep => ({
        element: step.element,
        popover: step.popover,
      }),
    );

    // Update centralized store state
    setAssistTutorialActive(true);
    prevAssistStepsLengthRef.current = assistSteps.length;

    driverInstance.current = driver({
      ...ASSIST_MODE_CONFIG,
      steps: driveSteps,
      onNextClick: () => {
        void createOnNextClick()();
      },
      onPrevClick: () => {
        void createOnPrevClick()();
      },
      onCloseClick: () => {
        setHasCompletedIntro(true);
        stopAssistMode();
      },
      onDestroyStarted: () => {
        stopAssistMode();
      },
      onHighlightStarted: applyPointerEventsFix,
    });

    // Get the wizard step for the starting assist step
    const startingStep = assistSteps[startingIndex];
    const targetWizardStep = startingStep?.wizardStep ?? 0;

    // Only navigate to a different wizard step if needed
    if (targetWizardStep !== currentWizardStep) {
      onWizardStepChange(targetWizardStep);
      // Wait for wizard step transition to complete
      await new Promise((resolve) =>
        setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
      );
    }

    // Navigate to the node if needed
    if (startingStep?.nodeType) {
      setTutorialNavigationNodeType(
        startingStep.nodeType,
        startingStep.zoomLevel,
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    // Now start the tutorial
    if (driverInstance.current) {
      currentStepIndexRef.current = startingIndex;
      setCurrentAssistStepIndex(startingIndex);

      // Execute onStepEnter for the starting step
      if (startingStep?.onStepEnter) {
        startingStep.onStepEnter(useTutorialStore.getState());
        // Wait for React Flow to re-render after state change
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      driverInstance.current.drive(startingIndex);

      // Auto-focus the starting element (no auto-open)
      if (startingStep?.element && typeof startingStep.element === 'string') {
        const element = document.querySelector(startingStep.element);
        if (element) {
          autoFocusField(element, false);
        }
      }
    }
  }, [
    assistSteps,
    currentWizardStep,
    stopAssistMode,
    createOnNextClick,
    createOnPrevClick,
    applyPointerEventsFix,
    autoFocusField,
    setCurrentAssistStepIndex,
    onWizardStepChange,
    setTutorialNavigationNodeType,
    setHasCompletedIntro,
    setAssistTutorialActive,
  ]);

  /**
   * SINGLE COORDINATED ENTRY POINT for starting assist mode
   *
   * Two scenarios:
   * 1. AUTO-START on page load (new users):
   *    - isFormReady && assistModeEnabled && !isAssistActive && !hasCompletedIntro
   *
   * 2. MANUAL START (user clicks "Assist Me" button):
   *    - assistModeEnabled goes from false to true
   *    - Starts regardless of hasCompletedIntro
   */
  useEffect(() => {
    // Wait for form to be ready
    if (!isFormReady) {
      prevAssistModeEnabledRef.current = assistModeEnabled;
      return;
    }

    // Detect manual toggle: assistModeEnabled went from false to true
    const wasManuallyEnabled =
      prevAssistModeEnabledRef.current === false && assistModeEnabled === true;

    // Update the ref for next render
    prevAssistModeEnabledRef.current = assistModeEnabled;

    // Start tutorial if:
    // 1. Manual enable (user clicked "Assist Me") - ignore hasCompletedIntro
    // 2. Auto-start for new users - respect hasCompletedIntro
    if (assistModeEnabled && !isAssistActive) {
      const shouldStart = wasManuallyEnabled || !hasCompletedIntro;

      if (shouldStart) {
        // Small delay to ensure DOM is fully ready
        const timer = setTimeout(() => {
          void startAssistMode();
        }, 100);
        return () => clearTimeout(timer);
      }
    }

    // Stop assist mode when disabled
    if (!assistModeEnabled && isAssistActive) {
      stopAssistMode();
    }
  }, [
    isFormReady,
    assistModeEnabled,
    isAssistActive,
    hasCompletedIntro,
    startAssistMode,
    stopAssistMode,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverInstance.current) {
        driverInstance.current.destroy();
      }
    };
  }, []);

  // Move to a specific step by ID
  const moveToStep = useCallback(
    async (stepId: string) => {
      if (!isAssistActive || !driverInstance.current) {
        console.warn(
          '[useAssistTutorial] Cannot move to step - assist mode not active',
        );
        return;
      }

      // Find the step index by ID
      const stepIndex = assistSteps.findIndex((step) => step.id === stepId);

      if (stepIndex === -1) {
        console.warn(`[useAssistTutorial] Step with ID "${stepId}" not found`);
        return;
      }

      const targetStep = assistSteps[stepIndex];

      // Check if we need to advance wizard step
      if (
        targetStep.wizardStep !== undefined &&
        targetStep.wizardStep !== currentWizardStep
      ) {
        onWizardStepChange(targetStep.wizardStep);
        await new Promise((resolve) =>
          setTimeout(resolve, WIZARD_STEP_TRANSITION_DELAY),
        );
      }

      // Navigate to target node if it has a nodeType
      if (targetStep.nodeType) {
        setTutorialNavigationNodeType(
          targetStep.nodeType,
          targetStep.zoomLevel,
        );
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      // Update the current step index
      currentStepIndexRef.current = stepIndex;
      setCurrentAssistStepIndex(stepIndex);

      // Execute onStepEnter for target step
      if (targetStep.onStepEnter) {
        targetStep.onStepEnter(useTutorialStore.getState());
        // Wait for React Flow to re-render after state change
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // Drive to the target step
      driverInstance.current.drive(stepIndex);

      // Auto-focus the target element
      if (targetStep.element && typeof targetStep.element === 'string') {
        const element = document.querySelector(targetStep.element);
        if (element) {
          autoFocusField(element, false);
        }
      }
    },
    [
      isAssistActive,
      assistSteps,
      currentWizardStep,
      onWizardStepChange,
      setTutorialNavigationNodeType,
      autoFocusField,
      setCurrentAssistStepIndex,
    ],
  );

  // Register moveToStep function with the tutorial store
  useEffect(() => {
    if (isAssistActive) {
      useTutorialStore
        .getState()
        .setAssistMoveToStepFn((stepId: string) => void moveToStep(stepId));
    } else {
      useTutorialStore.getState().setAssistMoveToStepFn(null);
    }

    // Cleanup on unmount
    return () => {
      useTutorialStore.getState().setAssistMoveToStepFn(null);
    };
  }, [isAssistActive, moveToStep]);

  /**
   * Auto-navigate to intro steps when wizard step changes
   * This only works when the tutorial is ALREADY running - it doesn't start a new instance
   * Starting the tutorial is handled by the single coordinated entry point above
   */
  useEffect(() => {
    // Only proceed if:
    // 1. Tutorial is actively running
    // 2. Wizard step actually changed
    if (!isAssistActive || prevWizardStepRef.current === currentWizardStep) {
      prevWizardStepRef.current = currentWizardStep;
      return;
    }

    prevWizardStepRef.current = currentWizardStep;

    // Map wizard steps to their intro step IDs
    const introStepMap: Record<number, string> = {
      2: 'additional-fields-intro',
      3: 'final-preview',
    };

    const introStepId = introStepMap[currentWizardStep];

    // If there's an intro step for this wizard step, navigate to it
    if (introStepId) {
      const introStepIndex = assistSteps.findIndex(
        (step) => step.id === introStepId,
      );

      // Navigate to intro step if found and not already there
      if (
        introStepIndex !== -1 &&
        currentStepIndexRef.current !== introStepIndex
      ) {
        // Delay to allow step transition to complete
        setTimeout(() => {
          void moveToStep(introStepId);
        }, WIZARD_STEP_TRANSITION_DELAY + 100);
      }
    }
  }, [currentWizardStep, assistSteps, moveToStep, isAssistActive]);

  return {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Consumers handle promise appropriately
    startAssistMode,
    stopAssistMode,
    isAssistActive,
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Consumers handle promise appropriately
    moveToStep,
  };
}
