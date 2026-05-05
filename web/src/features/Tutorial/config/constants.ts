// Tutorial constants and configuration
import type { AllowedButtons } from 'driver.js';

export const TUTORIAL_STORAGE_KEY = 'dj-tutorial-seen';
export const TUTORIAL_PROGRESS_KEY = 'dj-tutorial-progress';

// Base configuration shared by tutorial modes
const BASE_CONFIG = {
  showProgress: true,
  overlayClickNext: false, // Don't advance on overlay click
  onPopoverRender: (popover: { wrapper: HTMLElement }) => {
    // Prevent popover from closing on outside click
    popover.wrapper.addEventListener('click', (e: Event) => {
      e.stopPropagation();
    });
  },
  progressText: '{{current}} of {{total}}',
  nextBtnText: 'Next',
  prevBtnText: 'Previous',
  doneBtnText: 'Finish',
  animate: true,
  overlayOpacity: 0.5, // Visible overlay but transparent enough to see through
  smoothScroll: true,
};

// Play Tutorial configuration - demo walkthrough with prefilled data
export const PLAY_TUTORIAL_CONFIG = {
  ...BASE_CONFIG,
  allowClose: false, // Cannot close by clicking outside (only via close button)
  showButtons: ['next', 'previous', 'close'] as AllowedButtons[], // Added close button
  disableActiveInteraction: false, // User can see and interact with prefilled data
};

// Assist Mode configuration - context-aware guidance for real data
export const ASSIST_MODE_CONFIG = {
  ...BASE_CONFIG,
  allowClose: false, // Prevent accidental closure by clicking outside - use Close button instead
  showButtons: ['next', 'previous', 'close'] as AllowedButtons[],
  disableActiveInteraction: false, // User needs to interact with real fields
};

// Delay to wait for DOM updates after wizard step changes (ms)
export const WIZARD_STEP_TRANSITION_DELAY = 500;

// Delay for scroll and highlight animations (ms)
export const HIGHLIGHT_ANIMATION_DELAY = 300;
