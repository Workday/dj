import {
  DEPRECATED_MATERIALIZATION_TOP_LEVEL_KEYS,
  deprecatedMaterializationNullSentinels,
  normalizeMaterializationFromLegacyRequest,
} from '@shared/framework/materialization';
import type { SchemaModelMaterialization } from '@shared/schema/types/model.materialization.schema';
import type { IncrementalStrategy } from '@shared/schema/types/model.materialization.schema';
import type { SchemaModelMaterialized } from '@shared/schema/types/model.materialized.schema';
import type { SchemaModelPartitionedBy } from '@shared/schema/types/model.partitioned_by.schema';

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

type TransformOptions = {
  /** When true, emit null sentinels so edit merge deletes legacy top-level keys */
  clearDeprecatedTopLevelFields?: boolean;
  materializationExtras?: Record<string, unknown>;
};

/**
 * Transform form values to API format.
 * Removes UI-only fields like source, originalModelPath, projectName.
 * Converts select to array if it's not already.
 * Builds canonical `materialization` from wizard fields.
 */
export const transformFormValuesToApi = (
  values: Record<string, unknown>,
  options: TransformOptions = {},
) => {
  const {
    source: _source,
    materialization,
    materialized: legacyMaterialized,
    projectName,
    type,
    originalModelPath: _originalModelPath,
    incremental_strategy,
    partitioned_by,
    ...rest
  } = values;

  for (const key of DEPRECATED_MATERIALIZATION_TOP_LEVEL_KEYS) {
    delete rest[key];
  }

  const selectValue = values.select;
  const apiRequest: Record<string, unknown> = {
    ...rest,
    type,
    projectName,
  };

  if (type !== 'int_rollup_model') {
    apiRequest.select =
      Array.isArray(selectValue) && selectValue.length > 0 ? selectValue : [];
  }

  const built = normalizeMaterializationFromLegacyRequest({
    materialized: legacyMaterialized as SchemaModelMaterialized | undefined,
    materialization: materialization as SchemaModelMaterialization | undefined,
    incremental_strategy: incremental_strategy as
      | IncrementalStrategy
      | undefined,
    partitioned_by: partitioned_by as SchemaModelPartitionedBy | undefined,
    extras: options.materializationExtras ?? {},
  });

  if (built) {
    apiRequest.materialization = built;
    if (options.clearDeprecatedTopLevelFields) {
      Object.assign(apiRequest, deprecatedMaterializationNullSentinels());
    }
  }

  return apiRequest;
};
