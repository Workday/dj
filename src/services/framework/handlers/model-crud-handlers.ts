import { getDjConfig } from '@services/config';
import {
  frameworkBuildColumns,
  frameworkBuildCteColumnRegistry,
  frameworkGenerateModelOutput,
  frameworkGetModelId,
  frameworkGetModelName,
  frameworkGetModelPrefix,
  frameworkMakeModelTemplate,
} from '@services/framework/utils';
import {
  formatValidationErrors,
  getValidatorForType,
  validateCteColumnReferences,
  validateCtes,
} from '@services/modelValidation';
import { requireProject, safeAsync } from '@services/types';
import { jsonParse, removeEmpty } from '@shared';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { FrameworkColumn, FrameworkModel } from '@shared/framework/types';
import * as fs from 'fs';
import { applyEdits, modify } from 'jsonc-parser';
import { isEqual } from 'lodash';
import * as vscode from 'vscode';

import type { FrameworkContext } from '../context';

const JSONC_FORMAT_OPTIONS = {
  tabSize: 4,
  insertSpaces: true,
  eol: '\n',
};

/**
 * Handles API requests for creating, updating, and previewing Framework models.
 *
 * These are the most complex handlers in the Framework service:
 * - Model Create: Validates, writes new model JSON, clears state
 * - Model Update: Merges with existing, validates, handles renames, triggers sync
 * - Model Preview: Generates SQL/YAML/columns from model JSON for preview
 */
export class ModelCrudHandlers {
  constructor(private readonly ctx: FrameworkContext) {}

  /**
   * Creates a new model file from the provided model JSON.
   *
   * Flow:
   * 1. Read auto-generate tests config from VS Code settings
   * 2. Generate model template with tests
   * 3. Validate model doesn't already exist
   * 4. Write model.json file
   * 5. Clear form state
   * 6. Open file in editor
   */
  async handleModelCreate(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-model-create' }
    >,
  ): Promise<ApiResponse> {
    // Read configuration for auto-generating tests
    const autoGenerateTestsConfig = getDjConfig().autoGenerateTests;

    const baseModelJson = frameworkMakeModelTemplate(
      payload.request,
      autoGenerateTestsConfig,
    );

    // Remove empty values from the model json
    const modelJson = removeEmpty(baseModelJson);

    const { projectName } = payload.request;
    const project = requireProject(
      this.ctx.dbt.projects.get(projectName),
      projectName,
      'model-create',
    );
    const modelPrefix = frameworkGetModelPrefix({
      modelJson,
      project,
    });
    const modelUri = vscode.Uri.file(`${modelPrefix}.model.json`);
    if (fs.existsSync(modelUri.fsPath)) {
      const modelName = frameworkGetModelName(modelJson);
      throw new Error(
        `Model ${modelName} already exists, please choose a different name or topic`,
      );
    }
    await vscode.workspace.fs.writeFile(
      modelUri,
      Buffer.from(JSON.stringify(modelJson, null, '    ')),
    );

    // Clear form state (non-critical operation)
    await safeAsync(
      'clear-model-create-form-state',
      () =>
        this.ctx.api.handleApi({
          type: 'state-clear',
          request: { formType: 'model-create' },
        }),
      { log: this.ctx.log },
    );

    this.ctx.dbt.disposeWebviewPanelModelCreate();
    vscode.window.showTextDocument(modelUri);
    return apiResponse<typeof payload.type>('Model created');
  }

  /**
   * Updates an existing model file with new/modified data.
   *
   * Complex flow with many edge cases:
   * 1. Validate project and original file exist
   * 2. Merge with existing model JSON (for partial updates)
   * 3. Validate model JSON against schema
   * 4. Check if path changed (name/topic/group changed)
   * 5. Validate new path doesn't exist if path changed
   * 6. Write updated model.json
   * 7. Clear temp state and edit drafts
   * 8. Trigger DJ Sync if not already running
   * 9. Open file in editor
   */
  async handleModelUpdate(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-model-update' }
    >,
  ): Promise<ApiResponse> {
    const { originalModelPath, modelJson, projectName } = payload.request;
    const project = requireProject(
      this.ctx.dbt.projects.get(projectName),
      projectName,
      'model-update',
    );

    // Check if the original model file exists
    const originalModelUri = vscode.Uri.file(originalModelPath);
    if (!fs.existsSync(originalModelUri.fsPath)) {
      throw new Error('Original model file not found');
    }

    // Read existing file content to enable comment-preserving edits.
    // jsonc-parser's modify()/applyEdits() operate on raw text, so we
    // apply each changed property as a targeted text edit rather than
    // round-tripping through JSON.stringify (which strips JSONC comments).
    let rawFileContent: string | null = null;
    let existingModelJson: FrameworkModel | null = null;
    try {
      const fileBytes = await vscode.workspace.fs.readFile(originalModelUri);
      rawFileContent = fileBytes.toString();
      existingModelJson = jsonParse(rawFileContent) as FrameworkModel;
    } catch (error: unknown) {
      this.ctx.log.warn('Could not read existing model JSON for merge:', error);
    }

    // Merge with existing model JSON.
    // Fields the UI doesn't track are absent from modelJson, so the spread
    // of existingModelJson preserves them (e.g. materialization, partitioned_by
    // when the UI didn't load them). Only explicit null/undefined from the
    // client signals deletion.
    let updatedModelJson = modelJson;
    if (existingModelJson) {
      const mergedBase: Record<string, unknown> = {
        ...existingModelJson,
      };
      for (const [k, v] of Object.entries(modelJson)) {
        if (v === undefined || v === null) {
          delete mergedBase[k];
        } else {
          mergedBase[k] = v;
        }
      }
      updatedModelJson = mergedBase as unknown as typeof modelJson;
    }

    // Remove properties that should not be in the model JSON schema before validation
    const {
      projectName: _,
      source: __,
      ...modelJsonForValidation
    } = updatedModelJson as any;

    this.ctx.log.info(
      '[Model Update] Validating model JSON',
      modelJsonForValidation,
    );

    // Get type-specific validator - required!
    const validator = getValidatorForType(
      this.ctx.ajv,
      modelJsonForValidation.type,
    );

    if (!validator) {
      throw new Error('Model JSON Validation Not Active');
    }

    validator(modelJsonForValidation); // Will return false if invalid
    const errors = validator.errors;
    if (errors) {
      // Clean up temp file on validation error
      const modelName = frameworkGetModelName(modelJsonForValidation);
      try {
        await this.ctx.stateManager.clearModelEditDraft(modelName);
      } catch (cleanupError: unknown) {
        this.ctx.log.warn(
          `Failed to clean up temp edit file after validation error: ${String(cleanupError)}`,
        );
      }

      this.ctx.log.error('Model validation errors:', errors);
      const errorMessages = formatValidationErrors(
        errors,
        'model',
        modelJsonForValidation.type,
      );
      const message = errorMessages.join('\n');
      // Set diagnostics on the original model file
      this.ctx.diagnosticModelJson.set(originalModelUri, [
        new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message),
      ]);
      this.ctx.log.error('MODEL JSON INVALID', message);
      this.ctx.log.show(true);
      const error = new Error('Model JSON Invalid');
      (error as any).details = errorMessages; // Attach array to error object
      throw error;
    }

    // CTE constraints (unique names, no forward refs) can't be expressed
    // in JSON Schema alone, so we validate them as a secondary pass.
    const cteErrors = validateCtes(modelJsonForValidation);
    if (cteErrors.length > 0) {
      const modelName = frameworkGetModelName(modelJsonForValidation);
      try {
        await this.ctx.stateManager.clearModelEditDraft(modelName);
      } catch (cleanupError: unknown) {
        this.ctx.log.warn(
          `Failed to clean up temp edit file after CTE validation error: ${String(cleanupError)}`,
        );
      }
      const message = `CTE validation errors:\n${cteErrors.join('\n')}`;
      this.ctx.diagnosticModelJson.set(originalModelUri, [
        new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message),
      ]);
      this.ctx.log.error('CTE VALIDATION FAILED', message);
      this.ctx.log.show(true);
      const error = new Error('CTE Validation Failed');
      (error as any).details = cteErrors;
      throw error;
    }

    // Validate exclude/include column references if CTEs are present
    if (
      'ctes' in modelJsonForValidation &&
      modelJsonForValidation.ctes?.length
    ) {
      const cteColumnRegistry = frameworkBuildCteColumnRegistry({
        ctes: modelJsonForValidation.ctes,
        modelJson: modelJsonForValidation,
        project,
      });
      const colRefErrors = validateCteColumnReferences(
        modelJsonForValidation,
        cteColumnRegistry,
      );
      if (colRefErrors.length > 0) {
        const modelName = frameworkGetModelName(modelJsonForValidation);
        try {
          await this.ctx.stateManager.clearModelEditDraft(modelName);
        } catch (cleanupError: unknown) {
          this.ctx.log.warn(
            `Failed to clean up temp edit file after CTE column reference error: ${String(cleanupError)}`,
          );
        }
        const message = `CTE column reference errors:\n${colRefErrors.join('\n')}`;
        this.ctx.diagnosticModelJson.set(originalModelUri, [
          new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message),
        ]);
        this.ctx.log.error('CTE COLUMN REFERENCE VALIDATION FAILED', message);
        this.ctx.log.show(true);
        const error = new Error('CTE Column Reference Validation Failed');
        (error as any).details = colRefErrors;
        throw error;
      }
    }

    // No validation errors, so we'll clear any previous diagnostics on this file
    this.ctx.diagnosticModelJson.delete(originalModelUri);

    const modelName = frameworkGetModelName(modelJsonForValidation);
    const modelId = frameworkGetModelId({
      modelJson: modelJsonForValidation,
      project,
    });
    if (!modelId) {
      throw new Error(`Unable to determine model ID for ${modelName}`);
    }

    // Calculate the new model prefix (handles name/topic/group changes)
    const newModelPrefix = frameworkGetModelPrefix({
      modelJson: modelJsonForValidation,
      project,
    });
    const newModelPath = `${newModelPrefix}.model.json`;

    // Check if the model path has changed (name/topic/group changed)
    const pathChanged = originalModelPath !== newModelPath;

    // If path changed, check that the new path doesn't already exist
    if (pathChanged && fs.existsSync(newModelPath)) {
      // Clean up temp file when model already exists
      try {
        await this.ctx.stateManager.clearModelEditDraft(modelName);
        this.ctx.log.info(
          `🗑️ Cleaned up temp edit file when model exists for: ${modelName}`,
        );
      } catch (cleanupError: unknown) {
        this.ctx.log.warn(
          `Failed to clean up temp edit file when model exists: ${String(cleanupError)}`,
        );
      }

      throw new Error(
        `A model with the updated name/topic/group already exists: ${modelName}`,
      );
    }

    // Build the updated file content, preserving JSONC comments when possible.
    let modelJsonString: string;
    if (rawFileContent && existingModelJson) {
      let updatedContent = rawFileContent;
      for (const [key, value] of Object.entries(modelJsonForValidation)) {
        const existingValue = (
          existingModelJson as unknown as Record<string, unknown>
        )[key];
        if (isEqual(existingValue, value)) {
          continue;
        }
        const edits = modify(updatedContent, [key], value, {
          formattingOptions: JSONC_FORMAT_OPTIONS,
        });
        updatedContent = applyEdits(updatedContent, edits);
      }
      // Remove keys that existed before but were deleted (set to null/undefined)
      for (const key of Object.keys(existingModelJson)) {
        if (
          !(key in modelJsonForValidation) &&
          key !== 'projectName' &&
          key !== 'source'
        ) {
          const edits = modify(updatedContent, [key], undefined, {
            formattingOptions: JSONC_FORMAT_OPTIONS,
          });
          updatedContent = applyEdits(updatedContent, edits);
        }
      }
      modelJsonString = updatedContent;
    } else {
      modelJsonString = JSON.stringify(modelJsonForValidation, null, '    ');
    }

    this.ctx.diagnosticModelJson.delete(originalModelUri);

    // Lock the file if path changed (DJ Sync will be triggered)
    if (pathChanged) {
      this.ctx.lockedModelFiles.add(originalModelPath);
    }

    try {
      await vscode.workspace.fs.writeFile(
        originalModelUri,
        Buffer.from(modelJsonString),
      );
    } catch (err: unknown) {
      // Clean up temp file on error
      try {
        await this.ctx.stateManager.clearModelEditDraft(modelName);
      } catch (cleanupError: unknown) {
        this.ctx.log.warn(
          `Failed to clean up temp edit file after error: ${String(cleanupError)}`,
        );
      }

      vscode.window.showErrorMessage('Error writing model file');
      this.ctx.log.error('ERROR WRITING MODEL FILE', err);
      this.ctx.log.show(true);
      throw new Error(
        `Failed to write model file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // Clear the model edit temp state
    try {
      await this.ctx.api.handleApi({
        type: 'state-clear',
        request: { formType: `model-${modelName}` },
      });
    } catch (error: unknown) {
      this.ctx.log.warn(
        `Failed to clear model edit form state for ${modelName}:`,
        error,
      );
    }

    // Also directly clean up the temp file from .dj directory
    try {
      await this.ctx.stateManager.clearModelEditDraft(modelName);
    } catch (error: unknown) {
      this.ctx.log.warn(
        `Failed to clean up temp edit file for ${modelName}:`,
        error,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const isCurrentlySync = this.ctx.framework.isSyncing();
    if (!isCurrentlySync) {
      const fileInfo =
        await this.ctx.coder.fetchFileInfoFromPath(originalModelPath);
      if (fileInfo?.type === 'framework-model') {
        try {
          await this.ctx.framework.handleGenerateModelFiles(fileInfo);
        } catch (err: unknown) {
          this.ctx.log.error('ERROR in fallback sync after model update:', err);
        }
      } else {
        this.ctx.log.info('DJ Sync already triggered by file watcher.');
      }

      // Attempt fallback sync (non-critical)
      await safeAsync(
        'fallback-model-sync',
        async () => {
          if (!isCurrentlySync) {
            const fileInfo =
              await this.ctx.coder.fetchFileInfoFromPath(originalModelPath);
            if (fileInfo?.type === 'framework-model') {
              await this.ctx.handleGenerateModelFiles(fileInfo);
            }
          }
        },
        { log: this.ctx.log },
      );
    }

    vscode.window.showTextDocument(originalModelUri);

    return apiResponse<typeof payload.type>('Model updated successfully');
  }

  /**
   * Generates a preview of model SQL, YAML, and columns without saving.
   *
   * Used by the Model Wizard to show users what will be generated.
   *
   * Flow:
   * 1. Format model JSON with auto-generated tests
   * 2. Generate SQL and YAML from model JSON
   * 3. Extract column metadata
   * 4. Return preview data for display
   * 5. Return partial results on error (graceful degradation)
   */
  handleModelPreview(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-model-preview' }
    >,
  ): ApiResponse {
    const { projectName, modelJson } = payload.request;
    const project = requireProject(
      this.ctx.dbt.projects.get(projectName),
      projectName,
      'model-preview',
    );

    let formattedModelJson = modelJson as FrameworkModel;

    try {
      // Read configuration for auto-generating tests
      const autoGenerateTestsConfig = getDjConfig().autoGenerateTests;

      // Use frameworkMakeModelTemplate to format the JSON properly
      formattedModelJson = frameworkMakeModelTemplate(
        modelJson as any,
        autoGenerateTestsConfig,
      );
    } catch (error: unknown) {
      this.ctx.log.warn('Error formatting model JSON:', error);
    }

    try {
      // Generate SQL and YAML using existing utility
      const generated = frameworkGenerateModelOutput({
        dj: { config: getDjConfig() },
        project,
        modelJson: formattedModelJson,
      });

      // Extract columns from frameworkBuildColumns
      const { columns } = frameworkBuildColumns({
        dj: { config: getDjConfig() },
        modelJson: formattedModelJson,
        project,
      });

      // Map columns to the expected format
      const columnMetadata = columns.map((col: FrameworkColumn) => ({
        name: col.name,
        description: col.description || '',
        type: col.meta?.type === 'fct' ? ('fct' as const) : ('dim' as const),
        dataType: col.data_type || 'string',
      }));

      // Remove empty values from the json response
      const json = removeEmpty(formattedModelJson);

      return apiResponse<typeof payload.type>({
        json: JSON.stringify(json, null, 4),
        sql: generated.sql,
        yaml: generated.yml,
        columns: columnMetadata,
      });
    } catch (error: unknown) {
      // Return partial results on error
      this.ctx.log.warn('Error generating model preview:', error);

      // Remove empty values from the json response
      const json = removeEmpty(formattedModelJson);

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return apiResponse<typeof payload.type>({
        json: JSON.stringify(json, null, 4),
        sql: `-- Error generating SQL:\n-- ${errorMessage}`,
        yaml: `# Error generating YAML:\n# ${errorMessage}`,
        columns: [],
      });
    }
  }
}
