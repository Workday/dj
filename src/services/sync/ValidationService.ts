/**
 * Validation Service Module
 *
 * Handles model and source JSON schema validation and auto-test generation.
 * Extracted from framework.ts to unify validation across single-file and batch processing.
 *
 * Responsibilities:
 * - Model JSON schema validation (AJV)
 * - Source JSON schema validation
 * - Auto-test generation for qualifying models (respects targetFolders)
 * - Return enhanced model JSON with generated tests
 *
 * Important: Auto-test generation during sync now respects targetFolders configuration.
 * Tests are only added if:
 * 1. Model is a join model (int_join_models or mart_join_models)
 * 2. Model doesn't already have tests
 * 3. Model path is within configured targetFolders (or no targetFolders configured)
 */

import {
  type AutoGenerateTestsConfig,
  generateAutoTests,
} from '@services/framework/utils';
import {
  formatValidationErrorDetails,
  formatValidationErrors,
  getValidatorForType,
  validateCteLightdashMetrics,
  validateCtes,
  validateSubqueries,
} from '@services/modelValidation';
import type { FrameworkModel, FrameworkSource } from '@shared/framework/types';
import type { Ajv, ValidateFunction } from 'ajv';
import { applyEdits, modify } from 'jsonc-parser';
import * as path from 'path';

import type {
  ModelValidationResult,
  SourceValidationResult,
  SyncLogger,
} from './types';

const JSONC_FORMAT_OPTIONS = {
  tabSize: 4,
  insertSpaces: true,
  eol: '\n',
};

/**
 * ValidationService handles schema validation and model enhancement.
 *
 * This service provides:
 * - Type-specific model JSON validation using AJV
 * - Source JSON validation
 * - Auto-test generation for join models
 * - Enhanced JSON content with tests included
 *
 * @example
 * ```typescript
 * const service = new ValidationService(ajv, sourceValidator, logger);
 *
 * // Validate and enhance a model
 * const result = service.validateModel({
 *   modelJson,
 *   pathJson: '/path/to/model.json',
 *   config: autoGenerateTestsConfig,
 * });
 *
 * if (result.valid) {
 *   // Use result.enhancedModelJson (includes auto-generated tests)
 *   // Use result.enhancedJsonContent (stringified JSON)
 * }
 * ```
 */
export class ValidationService {
  constructor(
    private readonly ajv: Ajv | null,
    private readonly sourceValidator: ValidateFunction | undefined,
    private readonly logger: SyncLogger,
  ) {}

  /**
   * Check if a model path is within any of the configured target folders.
   *
   * @param modelPath - Absolute path to the model JSON file
   * @param projectPath - Absolute path to the dbt project root
   * @param targetFolders - Array of relative folder paths from project root
   * @returns true if model is within target folders, false otherwise (or if no folders configured)
   */
  private isInTargetFolders(
    modelPath: string,
    projectPath: string,
    targetFolders?: string[],
  ): boolean {
    // If no target folders configured, return false (disabled - don't apply to any)
    if (!targetFolders || targetFolders.length === 0) {
      return false;
    }

    // Get relative path from project root
    const relativePath = path.relative(projectPath, modelPath);

    // Check if model is within any target folder
    return targetFolders.some((targetFolder) => {
      const normalizedTarget = path.normalize(targetFolder);
      // Ensure we match directory boundaries by checking if:
      // 1. Relative path starts with the target folder
      // 2. Next character is a path separator OR it's the end of the path
      return (
        relativePath === normalizedTarget ||
        relativePath.startsWith(normalizedTarget + path.sep)
      );
    });
  }

  /**
   * Validate a model JSON and optionally enhance it with auto-generated tests.
   *
   * This method:
   * 1. Validates the model against its type-specific schema
   * 2. If valid and qualifying, generates auto-tests (respecting targetFolders)
   * 3. Returns enhanced JSON content ready for processing
   *
   * @param params - Validation parameters
   * @returns Validation result with enhanced JSON if valid
   */
  validateModel(params: {
    modelJson: FrameworkModel;
    pathJson: string;
    config?: AutoGenerateTestsConfig;
    projectPath?: string;
    rawJsonContent?: string;
  }): ModelValidationResult {
    const { modelJson, pathJson, config } = params;

    // Check if AJV is available
    if (!this.ajv) {
      return {
        valid: false,
        error: 'JSON Schema validation not initialized',
        pathJson,
      };
    }

    // Get type-specific validator
    const validator = getValidatorForType(this.ajv, modelJson.type);

    if (!validator) {
      return {
        valid: false,
        error: `Model type not found: ${modelJson.type}`,
        pathJson,
      };
    }

    // Validate against schema
    validator(modelJson);
    const errors = validator.errors;

    if (errors) {
      const errorMessages = formatValidationErrors(
        errors,
        'model',
        modelJson.type,
      );
      const message = errorMessages.join('\n');

      this.logger.error?.(`Model validation failed for ${pathJson}:`, message);

      return {
        valid: false,
        error: message,
        errors: formatValidationErrorDetails(errors),
        pathJson,
      };
    }

    // Validate CTE constraints
    const cteErrors = validateCtes(modelJson);
    if (cteErrors.length > 0) {
      const message = `CTE validation errors:\n${cteErrors.join('\n')}`;
      this.logger.error?.(`CTE validation failed for ${pathJson}:`, message);
      return {
        valid: false,
        error: message,
        pathJson,
      };
    }

    // Reject lightdash.metrics / lightdash.metrics_merge on CTE select items.
    // The framework silently drops those from CTEs -- surface it as an error
    // so users move the metric declarations to the main-model select. Return
    // `errors` so diagnostics land on each offending `lightdash` block rather
    // than at line 1 of the file.
    const cteLightdashErrors = validateCteLightdashMetrics(modelJson);
    if (cteLightdashErrors.length > 0) {
      const message = `CTE Lightdash validation errors:\n${cteLightdashErrors
        .map((e) => e.message)
        .join('\n')}`;
      this.logger.error?.(
        `CTE Lightdash validation failed for ${pathJson}:`,
        message,
      );
      return {
        valid: false,
        error: message,
        errors: cteLightdashErrors,
        pathJson,
      };
    }

    // Validate subquery constraints
    const subqueryErrors = validateSubqueries(modelJson);
    if (subqueryErrors.length > 0) {
      const message = `Subquery validation errors:\n${subqueryErrors.join('\n')}`;
      this.logger.error?.(
        `Subquery validation failed for ${pathJson}:`,
        message,
      );
      return {
        valid: false,
        error: message,
        pathJson,
      };
    }

    // Validation passed - now check if we should generate tests
    let enhancedModelJson = modelJson;
    let testsAdded = 0;

    if (config) {
      const enhancement = this.enhanceModelWithTests({
        modelJson,
        config,
        pathJson,
        projectPath: params.projectPath,
      });
      enhancedModelJson = enhancement.modelJson;
      testsAdded = enhancement.testsAdded;

      if (testsAdded > 0) {
        this.logger.info(
          `Auto-generated ${testsAdded} test(s) for ${modelJson.name}`,
        );
      }
    }

    // Use comment-preserving edits when raw content is available and tests were added.
    // This preserves JSONC comments in the original file instead of stripping them
    // via JSON.stringify.
    let enhancedJsonContent: string;
    if (testsAdded > 0 && params.rawJsonContent) {
      const edits = modify(
        params.rawJsonContent,
        ['data_tests'],
        (enhancedModelJson as any).data_tests,
        { formattingOptions: JSONC_FORMAT_OPTIONS },
      );
      enhancedJsonContent = applyEdits(params.rawJsonContent, edits);
    } else if (testsAdded > 0) {
      enhancedJsonContent = JSON.stringify(enhancedModelJson, null, 4);
    } else {
      enhancedJsonContent =
        params.rawJsonContent ?? JSON.stringify(enhancedModelJson, null, 4);
    }

    return {
      valid: true,
      pathJson,
      enhancedModelJson,
      enhancedJsonContent,
      testsAdded,
    };
  }

  /**
   * Validate a source JSON against the source schema.
   *
   * @param params - Validation parameters
   * @returns Validation result
   */
  validateSource(params: {
    sourceJson: FrameworkSource;
    pathJson: string;
  }): SourceValidationResult {
    const { sourceJson, pathJson } = params;

    if (!this.sourceValidator) {
      return {
        valid: false,
        error: 'Source JSON validation not active',
        pathJson,
      };
    }

    this.sourceValidator(sourceJson);
    const errors = this.sourceValidator.errors;

    if (errors) {
      const errorMessages = formatValidationErrors(errors, 'source');
      const message = errorMessages.join('\n');

      this.logger.error?.(`Source validation failed for ${pathJson}:`, message);

      return {
        valid: false,
        error: message,
        errors: formatValidationErrorDetails(errors),
        pathJson,
      };
    }

    return {
      valid: true,
      pathJson,
    };
  }

  /**
   * Enhance a model JSON with auto-generated tests if qualifying.
   *
   * Only applies to join models (int_join_models, mart_join_models) that
   * don't already have tests and are within configured targetFolders.
   *
   * @param params - Enhancement parameters
   * @returns Enhanced model JSON and count of tests added
   */
  enhanceModelWithTests(params: {
    modelJson: FrameworkModel;
    config: AutoGenerateTestsConfig;
    pathJson?: string;
    projectPath?: string;
  }): { modelJson: FrameworkModel; testsAdded: number } {
    const { modelJson, config, pathJson, projectPath } = params;

    // Only enhance join models
    const isJoinModel =
      modelJson.type === 'int_join_models' ||
      modelJson.type === 'mart_join_models';

    if (!isJoinModel) {
      return { modelJson, testsAdded: 0 };
    }

    // Skip if tests already exist
    const existingTests = (modelJson as any).data_tests;
    if (existingTests && existingTests.length > 0) {
      return { modelJson, testsAdded: 0 };
    }

    // Collect all target folders from enabled test types
    const allTargetFolders: string[] = [];

    if (
      config.tests?.equalRowCount?.enabled &&
      config.tests.equalRowCount.targetFolders
    ) {
      allTargetFolders.push(...config.tests.equalRowCount.targetFolders);
    }

    if (
      config.tests?.equalOrLowerRowCount?.enabled &&
      config.tests.equalOrLowerRowCount.targetFolders
    ) {
      allTargetFolders.push(...config.tests.equalOrLowerRowCount.targetFolders);
    }

    // If targetFolders are configured, we MUST have pathJson and projectPath to validate
    if (allTargetFolders.length > 0) {
      if (!pathJson || !projectPath) {
        // Can't validate folder membership without paths, skip test generation
        return { modelJson, testsAdded: 0 };
      }

      const isInTarget = this.isInTargetFolders(
        pathJson,
        projectPath,
        allTargetFolders,
      );
      if (!isInTarget) {
        // Model is not in any target folder, skip test generation
        return { modelJson, testsAdded: 0 };
      }
    } else {
      // No targetFolders configured = disabled, don't generate tests
      return { modelJson, testsAdded: 0 };
    }

    // Generate auto-tests
    const autoTests = generateAutoTests(modelJson.from, config);

    if (autoTests.length === 0) {
      return { modelJson, testsAdded: 0 };
    }

    // Return enhanced model with tests
    const enhancedModel = {
      ...modelJson,
      data_tests: autoTests,
    } as FrameworkModel;

    return {
      modelJson: enhancedModel,
      testsAdded: autoTests.length,
    };
  }
}
