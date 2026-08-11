import type { DbtRunConfig, SelectedModel } from '@shared/dbt/types';
import { useCallback, useMemo } from 'react';

interface ValidationErrors {
  startDate?: string;
  endDate?: string;
  statePath?: string;
  defer?: string;
  multiModel?: string;
}

interface UseModelRunValidationProps {
  config: DbtRunConfig;
  fetchingModifiedModels: boolean;
  modifiedModels: string[];
  selectedModifiedModels: SelectedModel[];
  hasFetchedModels?: boolean; // Flag to track if we've attempted/completed a fetch
}

/**
 * Custom hook for ModelRun form validation
 * Memoizes validation logic to prevent unnecessary recalculations
 */
export function useModelRunValidation({
  config,
  fetchingModifiedModels,
  modifiedModels,
  selectedModifiedModels,
  hasFetchedModels = false,
}: UseModelRunValidationProps) {
  /**
   * Validates a date string
   */
  const validateDate = useCallback((date: string): boolean => {
    if (!date) return true; // Empty is valid
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) return false;

    // Check if it's a valid date
    const dateObj = new Date(date);
    return !isNaN(dateObj.getTime());
  }, []);

  /**
   * Computes validation errors for the current config
   * Memoized to prevent recalculation on every render
   */
  const validationErrors = useMemo((): ValidationErrors => {
    const errors: ValidationErrors = {};
    const { startDate, endDate, defer, scope, statePath, selectedModels } =
      config;

    // Date validation helpers
    const hasStartDate = !!startDate;
    const hasEndDate = !!endDate;
    const isStartDateValid = !startDate || validateDate(startDate);
    const isEndDateValid = !endDate || validateDate(endDate);

    // Validate date formats
    if (hasStartDate && !isStartDateValid) {
      errors.startDate = 'Invalid date format. Use YYYY-MM-DD';
    }

    if (hasEndDate && !isEndDateValid) {
      errors.endDate = 'Invalid date format. Use YYYY-MM-DD';
    }

    // Validate date pairs - only require startDate if endDate is provided
    if (!hasStartDate && hasEndDate) {
      errors.startDate = 'Start date is required when end date is provided';
    }

    // Validate date range (only if both dates are valid)
    if (hasStartDate && hasEndDate && isStartDateValid && isEndDateValid) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start > end) {
        errors.endDate = 'End date must be after start date';
      }
    }

    // Validate state path when defer is enabled
    if (defer && !statePath) {
      errors.statePath = 'State path is required when defer is enabled';
    }

    // Validate that modified models exist when 'modified' scope is selected
    // Only show error after we've completed at least one fetch attempt
    const shouldValidateModifiedModels =
      scope === 'modified' && !fetchingModifiedModels && hasFetchedModels;

    if (shouldValidateModifiedModels && modifiedModels.length === 0) {
      errors.defer =
        'No model changes detected from master branch. All models are up to date.';
    }

    // Validate that at least one modified model is selected
    if (
      scope === 'modified' &&
      !fetchingModifiedModels &&
      hasFetchedModels &&
      modifiedModels.length > 0 &&
      selectedModifiedModels.length === 0
    ) {
      errors.defer = 'At least one modified model must be selected to run.';
    }

    // Validate multi-model scope
    if (scope === 'multi-model') {
      if (!selectedModels || selectedModels.length === 0) {
        errors.multiModel =
          'At least one model must be selected for multi-model scope';
      } else {
        // Validate that each selected model has a lineage configured
        const modelsWithoutLineage = selectedModels.filter(
          (model) => !model.lineage,
        );
        if (modelsWithoutLineage.length > 0) {
          errors.multiModel =
            'All selected models must have a lineage configured';
        }
      }
    }

    return errors;
  }, [
    config,
    fetchingModifiedModels,
    modifiedModels.length,
    selectedModifiedModels.length,
    hasFetchedModels,
    validateDate,
  ]);

  /**
   * Check if form is currently valid
   */
  const isFormValid = useMemo(() => {
    return Object.keys(validationErrors).length === 0;
  }, [validationErrors]);

  /**
   * Get error for a specific field
   */
  const getFieldError = useCallback(
    (field: keyof ValidationErrors) => {
      return validationErrors[field];
    },
    [validationErrors],
  );

  return {
    validationErrors,
    isFormValid,
    getFieldError,
    validateDate,
  };
}
