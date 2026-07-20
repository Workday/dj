// Check if form has any data to determine discard button state
export const checkFormHasData = (values: Record<string, unknown>): boolean => {
  return Object.values(values).some(
    (value) => value !== null && value !== undefined && value !== '',
  );
};

// Wizard step definitions
export const wizardSteps = [
  {
    id: 'basic',
    label: 'Basic Information',
    tooltip: 'Set up model name, project, source layer, and type.',
  },
  {
    id: 'modeling',
    label: 'Data Modeling',
    tooltip: 'Optional step to configure your data model visually.',
  },
  {
    id: 'additional',
    label: 'Additional Fields',
    tooltip: 'Configure materialization, schema, tags, and column excludes.',
  },
  {
    id: 'preview',
    label: 'Final Preview',
    tooltip: 'Review generated SQL, YAML, and JSON before creating your model.',
  },
];

// Check if current step is the first step
export const isFirstStep = (currentStep: number): boolean => {
  return currentStep === 0;
};

// Check if current step is the last step
export const isLastStep = (currentStep: number): boolean => {
  return currentStep === wizardSteps.length - 1;
};

// Get next step index
export const getNextStep = (currentStep: number): number => {
  return Math.min(currentStep + 1, wizardSteps.length - 1);
};

// Get previous step index
export const getPreviousStep = (currentStep: number): number => {
  return Math.max(currentStep - 1, 0);
};

/**
 * Transform form values to API format.
 * Removes UI-only fields like source, originalModelPath, projectName.
 * Converts select to array if it's not already.
 * Adds materialized if it's provided.
 *
 * @param values - Form values
 * @returns API request object
 */
export const transformFormValuesToApi = (values: Record<string, unknown>) => {
  const {
    source: _source,
    materialized,
    projectName,
    type,
    originalModelPath: _originalModelPath,
    ...rest
  } = values;

  // Create the API request object excluding UI-only fields
  const selectValue = values.select;
  const apiRequest: Record<string, unknown> = {
    ...rest,
    type,
    projectName, // Include projectName in API request
  };

  if (type !== 'int_rollup_model') {
    apiRequest.select =
      Array.isArray(selectValue) && selectValue.length > 0 ? selectValue : [];
  }

  // Add materialized only if it's provided and not empty
  if (
    materialized &&
    typeof materialized === 'string' &&
    materialized.trim() !== ''
  ) {
    apiRequest.materialized = materialized;
  }

  return apiRequest;
};
