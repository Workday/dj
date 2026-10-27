import type { Api } from '@shared/api/types';
import type { AdditionalFieldsSchema } from '@web/stores/useModelStore';

/**
 * Complete form values type for the Model Wizard.
 * Combines API schema with additional UI-specific fields.
 */
export type ModelWizardFormValues = Api<'framework-model-create'>['request'] & {
  source?: string;
  materialization?: string;
  cloneModel?: string;
} & AdditionalFieldsSchema;
