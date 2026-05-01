/**
 * Model Processor Module
 *
 * Handles model-specific processing logic for the sync engine.
 * Extracted from framework.ts for single responsibility and testability.
 *
 * Responsibilities:
 * - Parse model JSON files
 * - Check cache for changes
 * - Generate SQL and YML output
 * - Build file operations
 * - Update cache after successful generation
 */

import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateModelOutput,
  frameworkGetModelName,
  frameworkGetModelPrefix,
} from '@services/framework/utils';
import {
  validateCteColumnReferences,
  validateDeadOuterLayer,
  validateDjIcebergPartitionOverwrite,
  validateMainModelAggregation,
} from '@services/modelValidation';
import { jsonParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type { FrameworkModel, FrameworkSyncOp } from '@shared/framework/types';
import * as fs from 'fs';
import * as vscode from 'vscode';

import type { CacheManager } from './cacheManager';
import { ERROR_MESSAGES } from './constants';
import type {
  ModelProcessingResult,
  SyncCallbacks,
  SyncConfig,
  SyncResource,
  ValidationErrorDetail,
} from './types';

const JSONC_FORMAT_OPTIONS = {
  tabSize: 4,
  insertSpaces: true,
  eol: '\n',
};

/**
 * ModelProcessor handles the processing of individual model resources.
 *
 * This class encapsulates all model-specific logic:
 * - JSON parsing and validation
 * - Change detection via cache
 * - SQL/YML generation
 * - File operation building
 *
 * @example
 * ```typescript
 * const processor = new ModelProcessor(config, cacheManager, callbacks);
 * const result = await processor.process({
 *   resource,
 *   jsonContent,
 *   project,
 * });
 * ```
 */
export class ModelProcessor {
  constructor(
    private readonly config: SyncConfig,
    private readonly cacheManager: CacheManager,
    private readonly callbacks: SyncCallbacks = {},
  ) {}

  /**
   * Process a single model resource.
   *
   * @param params - Processing parameters
   * @param params.resource - The model resource to process
   * @param params.jsonContent - Raw JSON file content
   * @param params.project - Current dbt project state
   * @returns Processing result with operations and updated project
   */
  async process(params: {
    resource: SyncResource;
    jsonContent: string;
    project: DbtProject;
  }): Promise<ModelProcessingResult> {
    const { resource, jsonContent, project } = params;
    const { pathJson } = resource;

    // 1. Parse the model JSON
    const modelJson = jsonParse(jsonContent) as FrameworkModel;
    const modelName = frameworkGetModelName(modelJson);

    // 2. Calculate paths
    const oldPrefix = pathJson.replace(/\.model\.json$/, '');
    const newPrefix = frameworkGetModelPrefix({ project, modelJson });

    if (!newPrefix) {
      this.config.logger.error(ERROR_MESSAGES.UNABLE_TO_GET_PREFIX(modelName));
      return {
        modelId: resource.id,
        modelName,
        sql: '',
        yml: '',
        updatedProject: null,
        operations: [],
        skipped: true,
      };
    }

    const newJson = jsonContent;
    const newJsonPath = `${newPrefix}.model.json`;
    const newJsonUri = vscode.Uri.file(newJsonPath);
    const newSqlPath = `${newPrefix}.sql`;
    const newYmlPath = `${newPrefix}.yml`;

    // 3. Read old files for comparison (async)
    const oldSqlPath = `${oldPrefix}.sql`;
    const oldYmlPath = `${oldPrefix}.yml`;
    const [oldSql, oldYml] = await Promise.all([
      fs.promises.readFile(oldSqlPath, 'utf8').catch(() => ''),
      fs.promises.readFile(oldYmlPath, 'utf8').catch(() => ''),
    ]);

    // 4. Pre-generation registry-aware checks. These now emit non-blocking
    // warnings -- SQL/YML generation always proceeds. Users still see
    // diagnostics in the Problems tab but are not blocked from iterating.
    const hasCtes = 'ctes' in modelJson && !!modelJson.ctes?.length;
    const cteColumnRegistry = hasCtes
      ? frameworkBuildCteColumnRegistry({
          ctes: modelJson.ctes!,
          modelJson,
          project,
        })
      : undefined;

    // Collect all non-blocking validation warnings here. Emitted as a single
    // structured `onModelValidationWarning` call after generation so each
    // detail can be pinned to its specific `select[]` JSON range.
    const validationWarnings: ValidationErrorDetail[] = [];

    const aggErrors = validateMainModelAggregation(
      modelJson,
      cteColumnRegistry,
    );
    if (aggErrors.length > 0) {
      for (const err of aggErrors) {
        this.config.logger.warn?.(`${modelName}: ${err.message}`);
      }
      validationWarnings.push(...aggErrors);
    }

    // 5. Generate SQL and YML
    let newSql = '';
    let newYml = '';
    let updatedProject = project;

    try {
      const generated = frameworkGenerateModelOutput({
        dj: { config: this.config.extensionConfig },
        project,
        modelJson,
      });
      updatedProject = generated.project;
      newSql = generated.sql;
      newYml = generated.yml;

      // Validate exclude/include column references against the CTE registry
      if (cteColumnRegistry) {
        const colRefErrors = validateCteColumnReferences(
          modelJson,
          cteColumnRegistry,
        );
        if (colRefErrors.length > 0) {
          for (const msg of colRefErrors) {
            this.config.logger.warn?.(`${modelName}: ${msg}`);
            validationWarnings.push({ message: msg, instancePath: '' });
          }
        }
      }

      // Dead outer-layer warning: main select is a single passthrough of a
      // CTE with identical group_by. Warning-only -- the SQL is still valid.
      const deadLayerWarnings = validateDeadOuterLayer(modelJson);
      if (deadLayerWarnings.length > 0) {
        for (const w of deadLayerWarnings) {
          this.config.logger.warn?.(`${modelName}: ${w.message}`);
          validationWarnings.push(w);
        }
      }

      // dj_iceberg_partition_overwrite requires Iceberg format on the target
      // table; emit a hard Error (red squiggle) when the resolved format is
      // not Iceberg so users notice immediately. Each detail carries
      // severity: 'error' so it renders correctly even when batched
      // alongside warnings on the same URI.
      const icebergStrategyErrors = validateDjIcebergPartitionOverwrite(
        modelJson,
        project.variables?.storage_type,
      );
      if (icebergStrategyErrors.length > 0) {
        for (const e of icebergStrategyErrors) {
          this.config.logger.error(`${modelName}: ${e.message}`);
          validationWarnings.push(e);
        }
      }

      if (validationWarnings.length > 0) {
        const summary = `Model validation warnings:\n${validationWarnings
          .map((w) => w.message)
          .join('\n')}`;
        this.callbacks.onModelValidationWarning?.(
          newJsonUri,
          summary,
          validationWarnings,
          jsonContent,
        );
      } else {
        this.callbacks.onDiagnosticsClear?.(newJsonUri);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const message = ERROR_MESSAGES.INVALID_MODEL_SQL(error.message);

      this.config.logger.error(
        `ERROR GENERATING SQL/YML FOR: ${modelName}`,
        error,
      );

      // Report error via callback
      this.callbacks.onGenerationError?.(newJsonUri, modelName, error);

      return {
        modelId: resource.id,
        modelName,
        sql: '',
        yml: '',
        updatedProject: null,
        operations: [],
        skipped: false,
        error: {
          uri: newJsonUri,
          message,
        },
      };
    }

    // 5. Validate generated output
    if (!newSql || !newYml) {
      this.config.logger.error(
        ERROR_MESSAGES.EMPTY_OUTPUT_GENERATED(modelName),
      );
      return {
        modelId: resource.id,
        modelName,
        sql: '',
        yml: '',
        updatedProject: null,
        operations: [],
        skipped: false,
      };
    }

    // 6. Build file operations
    const operations: FrameworkSyncOp[] = [];

    // 7. Check if we can skip file I/O by comparing actual file content.
    // This catches manual edits and ensures we don't overwrite unchanged files.
    //
    // CRITICAL: Even if we skip writing files, we must return the 'updatedProject'.
    // This ensures that the accumulated 'project' object in SyncEngine contains the full,
    // up-to-date metadata for all resources, which is required for downstream inheritance.
    //
    // Note: Cache will be updated AFTER file writes succeed (in SyncEngine.execute())
    const isJsonUnchanged = newJson === jsonContent;
    const isContentUnchanged =
      isJsonUnchanged && newSql === oldSql && newYml === oldYml;

    if (isContentUnchanged && pathJson === newJsonPath) {
      // Content matches and path is same - no need to write files, but we DO return updatedProject
      // This handles the "stale manifest but fresh files" case
      return {
        modelId: resource.id,
        modelName,
        sql: newSql,
        yml: newYml,
        updatedProject,
        operations: [], // No file ops
        skipped: true, // Mark as skipped for stats, but we provide updatedProject
        cacheInfo: {
          pathJson,
          jsonContent,
          sql: newSql,
          yml: newYml,
          isSource: false,
        },
      };
    }

    if (pathJson !== newJsonPath) {
      // Path changed (model renamed/moved) - rename atomically, then overwrite content.
      // Using rename ops ensures WorkspaceEdit.renameFile() is used, which:
      // 1. Atomically renames the file on disk
      // 2. Updates all open editor tabs to point to the new path
      // This prevents auto-save from re-creating the old file.
      operations.push({
        type: 'rename',
        oldPath: pathJson,
        newPath: newJsonPath,
      });
      operations.push({
        type: 'rename',
        oldPath: oldSqlPath,
        newPath: newSqlPath,
      });
      operations.push({
        type: 'rename',
        oldPath: oldYmlPath,
        newPath: newYmlPath,
      });
      operations.push({ type: 'write', text: newJson, path: newJsonPath });
      operations.push({ type: 'write', text: newSql, path: newSqlPath });
      operations.push({ type: 'write', text: newYml, path: newYmlPath });
    } else {
      // Same path - only write if content changed
      if (newJson !== jsonContent) {
        operations.push({ type: 'write', text: newJson, path: newJsonPath });
      }
      if (newSql !== oldSql) {
        operations.push({ type: 'write', text: newSql, path: newSqlPath });
      }
      if (newYml !== oldYml) {
        operations.push({ type: 'write', text: newYml, path: newYmlPath });
      }
    }

    return {
      modelId: resource.id,
      modelName,
      sql: newSql,
      yml: newYml,
      updatedProject,
      operations,
      skipped: false,
      cacheInfo: {
        pathJson: pathJson !== newJsonPath ? newJsonPath : pathJson,
        jsonContent: pathJson !== newJsonPath ? newJson : jsonContent,
        sql: newSql,
        yml: newYml,
        isSource: false,
      },
    };
  }

  /**
   * Process a model from raw file content (for new models not in manifest).
   *
   * @param params - Processing parameters
   * @param params.pathJson - Path to the model.json file
   * @param params.project - Current dbt project state
   * @returns Processing result
   */
  async processFromFile(params: {
    pathJson: string;
    project: DbtProject;
  }): Promise<ModelProcessingResult> {
    const { pathJson, project } = params;

    // Read file content
    const file = await vscode.workspace.fs.readFile(vscode.Uri.file(pathJson));
    const jsonContent = file.toString();

    // Create a minimal resource
    const modelJson = jsonParse(jsonContent) as FrameworkModel;
    const modelName = frameworkGetModelName(modelJson);

    const resource: SyncResource = {
      id: `model.${project.name}.${modelName}`,
      pathJson,
      pathResource: pathJson.replace(/\.model\.json$/, '.sql'),
      type: 'model',
      parentIds: [],
      depth: 0,
    };

    return this.process({ resource, jsonContent, project });
  }
}
