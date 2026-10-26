import { formatDuplicateColumnMessage } from '@web/features/DataModeling/utils/columnOutputDuplicates';
import type { ModelingStateAdapter } from '@web/stores/useModelStore';

import { modelValidationRules } from './formValidation';

// ==================== BASIC FIELDS VALIDATION ====================

export interface BasicFieldsValidation {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateBasicFields(
  basicFields: Record<string, unknown>,
): BasicFieldsValidation {
  const errors: Record<string, string> = {};

  if (!basicFields.projectName) {
    errors.projectName = modelValidationRules.projectName.required;
  }
  if (!basicFields.name) {
    errors.name = modelValidationRules.name.required;
  }
  if (!basicFields.source) {
    errors.source = modelValidationRules.source.required;
  }
  if (!basicFields.type) {
    errors.type = modelValidationRules.type.required;
  }
  if (!basicFields.group) {
    errors.group = modelValidationRules.group.required;
  }
  if (!basicFields.topic) {
    errors.topic = modelValidationRules.topic.required;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// ==================== NODE VALIDATION RESULTS ====================

export interface NodeValidationResult {
  isValid: boolean;
  nodeType:
    | 'select'
    | 'join'
    | 'joinColumn'
    | 'rollup'
    | 'lookback'
    | 'union'
    | 'columnSelection'
    | null;
  errorMessage: string | null;
}

// ==================== SELECT NODE VALIDATION ====================

export function validateSelectNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  const hasSelection =
    !!modelingState.from?.model || !!modelingState.from?.source;
  return {
    isValid: hasSelection,
    nodeType: 'select',
    errorMessage: hasSelection ? null : 'Please select a model or source',
  };
}

// ==================== JOIN NODE VALIDATION ====================

export function validateJoinNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  if (!Array.isArray(modelingState.join)) {
    // int_join_column type doesn't need additional join validation here
    return { isValid: true, nodeType: 'join', errorMessage: null };
  }

  const hasJoins = modelingState.join && modelingState.join.length > 0;
  const allConfigured =
    hasJoins &&
    modelingState.join.every(
      (join: any) => join.model && join.type,
      // TODO: Uncomment this once we have a way to validate the conditions
      //&& join.on?.and?.length > 0,
    );

  return {
    isValid: !!allConfigured,
    nodeType: 'join',
    errorMessage: !hasJoins
      ? 'Please add at least one join model'
      : !allConfigured
        ? `Please configure join model's source`
        : null,
  };
}

// ==================== JOIN COLUMN NODE VALIDATION ====================

export function validateJoinColumnNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  const joinColumn = modelingState.join as any;

  const hasColumn = !!joinColumn?.column;
  const hasFields =
    joinColumn?.fields &&
    Array.isArray(joinColumn.fields) &&
    joinColumn.fields.length > 0;

  return {
    isValid: hasColumn && hasFields,
    nodeType: 'joinColumn',
    errorMessage: !hasColumn
      ? 'Please select a column to unnest'
      : !hasFields
        ? 'Please add at least one field'
        : null,
  };
}

// ==================== ROLLUP NODE VALIDATION ====================

export function validateRollupNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  const hasRollup = !!modelingState.rollup?.interval;
  return {
    isValid: hasRollup,
    nodeType: 'rollup',
    errorMessage: hasRollup
      ? null
      : 'Please configure rollup settings (interval and date expression)',
  };
}

// ==================== LOOKBACK NODE VALIDATION ====================

export function validateLookbackNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  const hasLookback =
    !!modelingState.lookback?.days && modelingState.lookback.days > 0;
  return {
    isValid: hasLookback,
    nodeType: 'lookback',
    errorMessage: hasLookback
      ? null
      : 'Please configure lookback days (must be greater than 0)',
  };
}

// ==================== UNION NODE VALIDATION ====================

export function validateUnionNode(
  modelingState: ModelingStateAdapter,
): NodeValidationResult {
  const hasModels =
    !!modelingState.union?.models && modelingState.union.models.length > 0;
  const hasSources =
    !!modelingState.union?.sources && modelingState.union.sources.length > 0;
  const hasSelection = hasModels || hasSources;

  return {
    isValid: hasSelection,
    nodeType: 'union',
    errorMessage: hasSelection
      ? null
      : 'Please select at least one model or source for union',
  };
}

// ==================== COLUMN SELECTION VALIDATION ====================

export function validateColumnSelectionNode(
  duplicateNames: string[],
): NodeValidationResult {
  if (duplicateNames.length === 0) {
    return {
      isValid: true,
      nodeType: 'columnSelection',
      errorMessage: null,
    };
  }
  return {
    isValid: false,
    nodeType: 'columnSelection',
    errorMessage: formatDuplicateColumnMessage(duplicateNames),
  };
}

// ==================== COMBINED VALIDATION ====================

export function getFirstInvalidNode(
  modelingState: ModelingStateAdapter,
  modelType?: string | null,
  columnSelectionDuplicateNames: string[] = [],
): NodeValidationResult | null {
  const validations: NodeValidationResult[] = [];

  // Always validate select node
  validations.push(validateSelectNode(modelingState));

  // Validate based on model type
  if (modelType?.includes('join_column')) {
    validations.push(validateJoinColumnNode(modelingState));
  } else if (modelType?.includes('join')) {
    validations.push(validateJoinNode(modelingState));
  }

  if (modelType?.includes('rollup')) {
    validations.push(validateRollupNode(modelingState));
  }

  if (modelType?.includes('lookback')) {
    validations.push(validateLookbackNode(modelingState));
  }

  if (modelType?.includes('union')) {
    validations.push(validateUnionNode(modelingState));
  }

  if (
    Array.isArray(modelingState.select) &&
    modelingState.select.length > 0
  ) {
    validations.push(
      validateColumnSelectionNode(columnSelectionDuplicateNames),
    );
  }

  // Return first invalid node
  return validations.find((v) => !v.isValid) || null;
}

// ==================== STEP VALIDATION ====================

export interface StepValidationResult {
  isValid: boolean;
  errors?: Record<string, string> | NodeValidationResult | null;
}

export function validateStep(
  step: number,
  basicFields: Record<string, unknown>,
  modelingState?: ModelingStateAdapter,
  modelType?: string | null,
  columnSelectionDuplicateNames: string[] = [],
): StepValidationResult {
  switch (step) {
    case 0: {
      // Step 0: Basic Information
      return validateBasicFields(basicFields);
    }
    case 1: {
      // Step 1: Data Modeling
      if (!modelingState) {
        return { isValid: true };
      }
      const invalidNode = getFirstInvalidNode(
        modelingState,
        modelType,
        columnSelectionDuplicateNames,
      );
      return {
        isValid: !invalidNode || invalidNode.isValid,
        errors: invalidNode,
      };
    }
    case 2: {
      // Step 2: Additional Fields
      return { isValid: true };
    }
    case 3: {
      // Step 3: Final Preview
      return { isValid: true };
    }
    default:
      return { isValid: false };
  }
}

// ==================== UTILITY FUNCTIONS ====================

// Get node type string for navigation
export function getNodeTypeForNavigation(
  nodeType: string | null,
): string | null {
  const nodeTypeMap: Record<string, string> = {
    select: 'selectNode',
    join: 'joinNode',
    joinColumn: 'joinColumnNode',
    rollup: 'rollupNode',
    lookback: 'lookbackNode',
    union: 'unionNode',
    columnSelection: 'columnSelectionNode',
  };

  return nodeType ? nodeTypeMap[nodeType] || null : null;
}
