/**
 * Sync Engine Module
 *
 * This is the main orchestrator for the JSON sync process.
 * It coordinates all sync phases using specialized processors.
 *
 */

import type { AutoGenerateTestsConfig } from '@services/framework/utils';
import { frameworkGetModelName } from '@services/framework/utils';
import { jsonParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type { FrameworkModel, FrameworkSyncOp } from '@shared/framework/types';
import * as path from 'path';
import * as vscode from 'vscode';

import type { CacheManager } from './cacheManager';
import { SYNC_BATCH_SIZES } from './constants';
import {
  buildOrderedResources,
  extractFrameworkDependencies,
  groupByDependencyLevel,
} from './dependencyGraph';
import { buildUriMap, executeSyncOperationsVSCode } from './fileOperations';
import { ManifestManager } from './ManifestManager';
import { ModelProcessor } from './ModelProcessor';
import { RenameHandler } from './RenameHandler';
import { SourceProcessor } from './SourceProcessor';
import type {
  CacheUpdateInfo,
  DetectedRename,
  SyncCallbacks,
  SyncConfig,
  SyncError,
  SyncExecuteParams,
  SyncResource,
  SyncResult,
  SyncStats,
  ValidationServiceParams,
} from './types';
import { ValidationService } from './ValidationService';

export class SyncEngine {
  private readonly renameHandler: RenameHandler;
  private readonly manifestManager: ManifestManager;
  private readonly validationService: ValidationService | null;

  constructor(
    private readonly config: SyncConfig,
    private readonly callbacks: SyncCallbacks = {},
    validationParams?: ValidationServiceParams,
  ) {
    this.renameHandler = new RenameHandler(config.logger);
    this.manifestManager = new ManifestManager();

    // Initialize ValidationService if params provided and validation enabled
    if (
      validationParams &&
      (config.enableValidation === undefined || config.enableValidation)
    ) {
      this.validationService = new ValidationService(
        validationParams.ajv,
        validationParams.sourceValidator,
        config.logger,
      );
    } else {
      this.validationService = null;
    }
  }

  /**
   * Discovery phase: Pre-scan model.json files to extract framework-level dependencies.
   * This ensures accurate dependency levels even for new or changed models.
   *
   * @param params - Discovery parameters
   * @returns Map of resource ID to array of parent model names
   */
  private async discoverFrameworkDependencies(params: {
    project: DbtProject;
    jsonUris: vscode.Uri[];
  }): Promise<Map<string, string[]>> {
    const { project, jsonUris } = params;
    const frameworkDependencies = new Map<string, string[]>();

    // Filter for model.json files in this project
    const modelJsonUris = jsonUris.filter(
      (uri) =>
        uri.fsPath.endsWith('.model.json') &&
        uri.fsPath.includes(project.pathSystem),
    );

    this.config.logger.info(
      `Discovering framework dependencies for ${modelJsonUris.length} models in ${project.name}`,
    );

    // Process all model files in parallel for speed
    await Promise.all(
      modelJsonUris.map(async (uri) => {
        try {
          const fileContent = await vscode.workspace.fs.readFile(uri);
          const jsonContent = fileContent.toString();
          const modelJson = jsonParse(jsonContent) as FrameworkModel;
          const modelName = frameworkGetModelName(modelJson);
          const resourceId = `model.${project.name}.${modelName}`;

          // Extract framework-level dependencies
          const dependencies = extractFrameworkDependencies(modelJson);

          if (dependencies.length > 0) {
            frameworkDependencies.set(resourceId, dependencies);
          }
        } catch (err: unknown) {
          // If we can't parse a file, skip it (it may be invalid or new)
          this.config.logger.debug?.(
            `Failed to parse ${uri.fsPath} during discovery:`,
            err,
          );
        }
      }),
    );

    this.config.logger.info(
      `Discovered ${frameworkDependencies.size} models with framework dependencies`,
    );

    return frameworkDependencies;
  }

  async execute(params: SyncExecuteParams): Promise<SyncResult> {
    const startTime = Date.now();
    const {
      project: initialProject,
      jsonUris,
      cacheManager,
      roots,
      autoGenerateTestsConfig,
    } = params;

    const modelProcessor = new ModelProcessor(
      this.config,
      cacheManager,
      this.callbacks,
    );
    const sourceProcessor = new SourceProcessor(
      this.config,
      cacheManager,
      this.callbacks,
    );

    const errors: SyncError[] = [];
    const renames: DetectedRename[] = [];
    const allOperations: FrameworkSyncOp[] = [];
    const allCacheUpdates: CacheUpdateInfo[] = [];
    let processedCount = 0;
    let skippedCount = 0;

    const jsonUriMap = buildUriMap(jsonUris);

    this.callbacks.onProgress?.('Starting sync...');

    let project = initialProject;
    let manifest = await params.fetchManifest(project);

    const shouldParse = this.manifestManager.shouldReparse({
      manifest,
      lastFileChange: params.lastFileChange ?? null,
      hasRoots: (roots?.length ?? 0) > 0,
      forceReparse: params.forceReparse,
    });

    if (shouldParse) {
      this.callbacks.onProgress?.('Parsing ' + project.name + ' manifest...');
      this.config.logger.info('Parsing manifest for ' + project.name);
      try {
        manifest = await params.parseManifest(project);
      } catch {
        this.config.logger.error(
          'Error parsing manifest for ' +
            project.name +
            ', proceeding without one',
        );
        manifest = null;
      }
    } else {
      this.config.logger.info('Using existing manifest for ' + project.name);
    }

    project = { ...project, ...(manifest && { manifest }) };

    // Discovery phase: Extract framework-level dependencies from model.json files
    // This ensures accurate dependency levels even for new or changed models
    this.callbacks.onProgress?.('Discovering framework dependencies...');
    let frameworkDependencies = await this.discoverFrameworkDependencies({
      project,
      jsonUris,
    });

    if (roots?.length) {
      this.config.logger.info(
        `SyncEngine: Checking renames for ${roots.length} root(s): ${JSON.stringify(roots.map((r) => ({ id: r.id, pathJson: r.pathJson })))}`,
      );

      const detectedRenames = this.renameHandler.detectRenames({
        roots,
        project,
      });

      if (detectedRenames.length > 0) {
        this.config.logger.info(
          `SyncEngine: detectRenames found ${detectedRenames.length}: ${JSON.stringify(detectedRenames.map((r) => ({ old: r.oldName, new: r.newName, pathJson: r.pathJson })))}`,
        );
      } else {
        this.config.logger.info(
          'SyncEngine: No renames detected (ID matches filename)',
        );
      }

      for (const rename of detectedRenames) {
        const conflict = this.renameHandler.checkConflict({
          newName: rename.newName,
          oldName: rename.oldName,
          project,
          jsonUris,
        });

        if (conflict.hasConflict) {
          this.config.logger.info(
            `SyncEngine: Rename conflict — '${rename.newName}' already exists in manifest. Aborting sync.`,
          );
          const shouldAbort = this.callbacks.onRenameConflict?.(
            rename.oldName,
            rename.newName,
          );

          if (shouldAbort === false) {
            return {
              success: false,
              aborted: true,
              stats: this.buildStats({
                totalResources: 0,
                processedCount: 0,
                skippedCount: 0,
                levelCount: 0,
                maxParallelism: 0,
                startTime,
              }),
              renames: [],
              errors: [
                {
                  resourceId: rename.pathJson,
                  message: "Model '" + rename.newName + "' already exists",
                },
              ],
            };
          }
        }

        renames.push(rename);
      }
    }

    let orderedResources = buildOrderedResources({
      project,
      rootIds: roots?.map((r) => r.id),
      frameworkDependencies,
    });

    this.config.logger.info(
      `SyncEngine: buildOrderedResources returned ${orderedResources.length} resource(s) for rootIds=${roots?.map((r) => r.id).join(', ') ?? 'ALL'}`,
    );

    // When a root sync produces zero ordered resources, the requested root
    // (and likely its parents) are missing from the manifest. Force a reparse
    // and retry once before falling back to createResourcesForNewRoots so
    // generation runs against an up-to-date manifest. Covers cases where new
    // models arrive without a preceding manifest update (branch switch missed
    // by the git-log watcher, agent scaffold, file copy, fast successive
    // checkouts). Skipped when this sync already reparsed the manifest.
    if (orderedResources.length === 0 && roots?.length && !shouldParse) {
      this.config.logger.info(
        'SyncEngine: roots not in manifest, forcing reparse before fallback',
      );
      this.callbacks.onProgress?.(
        'Refreshing ' + project.name + ' manifest...',
      );
      try {
        const reparsed = await params.parseManifest(project);
        if (reparsed) {
          manifest = reparsed;
          project = { ...project, manifest };
          frameworkDependencies = await this.discoverFrameworkDependencies({
            project,
            jsonUris,
          });
          orderedResources = buildOrderedResources({
            project,
            rootIds: roots?.map((r) => r.id),
            frameworkDependencies,
          });
          this.config.logger.info(
            `SyncEngine: buildOrderedResources after reparse returned ${orderedResources.length} resource(s)`,
          );
        }
      } catch {
        this.config.logger.error(
          'SyncEngine: forced reparse failed, falling through to new-root fallback',
        );
      }
    }

    if (orderedResources.length === 0 && roots?.length) {
      // Resolve pathJson for roots that only have an ID.
      // The queue passes pathJson when available (from the watcher debounce),
      // but falls back to searching jsonUris by resource name within the project.
      const resolvedRoots = roots.map((root) => {
        if (root.pathJson) {
          return root;
        }
        const parts = root.id.split('.');
        const resourceName = parts[parts.length - 1];
        // Scope the search to this project's path to avoid cross-project mismatches
        const matchingUri = jsonUris.find(
          (uri) =>
            uri.fsPath.startsWith(project.pathSystem) &&
            (uri.fsPath.endsWith(`${resourceName}.model.json`) ||
              uri.fsPath.endsWith(`${resourceName}.source.json`)),
        );
        return matchingUri ? { ...root, pathJson: matchingUri.fsPath } : root;
      });

      const newResources =
        await this.manifestManager.createResourcesForNewRoots({
          roots: resolvedRoots,
          project,
          frameworkDependencies,
        });
      orderedResources = newResources;
    }

    this.config.logger.info(
      'Found ' + orderedResources.length + ' resources to process',
    );
    this.callbacks.onProgress?.(
      '0/' + orderedResources.length + ' resources processed (0%)',
    );

    const levels = groupByDependencyLevel(orderedResources);
    const maxParallelism = Math.max(
      ...levels.map((l) => l.resources.length),
      0,
    );

    this.config.logger.info(
      'Grouped into ' +
        levels.length +
        ' dependency levels, max parallelism: ' +
        maxParallelism,
    );

    // Track resources that had content changes across all levels
    // This allows child models to detect when parents changed and regenerate accordingly
    const allChangedResourceIds = new Set<string>();

    for (const level of levels) {
      if (this.callbacks.shouldAbort?.()) {
        return {
          success: false,
          aborted: true,
          stats: this.buildStats({
            totalResources: orderedResources.length,
            processedCount,
            skippedCount,
            levelCount: levels.length,
            maxParallelism,
            startTime,
          }),
          renames,
          errors,
        };
      }

      const levelResult = await this.processLevel({
        level,
        project,
        jsonUriMap,
        modelProcessor,
        sourceProcessor,
        cacheManager,
        changedParentIds: allChangedResourceIds,
        autoGenerateTestsConfig,
      });

      processedCount += levelResult.processedCount;
      skippedCount += levelResult.skippedCount;
      allOperations.push(...levelResult.operations);
      allCacheUpdates.push(...levelResult.cacheUpdates);
      errors.push(...levelResult.errors);

      // Accumulate changed resource IDs for next level's parent change detection
      for (const id of levelResult.changedResourceIds) {
        allChangedResourceIds.add(id);
      }

      if (levelResult.updatedProject) {
        project = levelResult.updatedProject;
      }

      // Report progress after level completes
      const totalCompleted = processedCount + skippedCount;
      const progressPercent = Math.round(
        (totalCompleted / orderedResources.length) * 100,
      );
      this.callbacks.onProgress?.(
        totalCompleted +
          '/' +
          orderedResources.length +
          ' resources processed (' +
          progressPercent +
          '%)',
      );

      this.config.logger.info(
        'Level ' +
          level.depth +
          ' complete: ' +
          levelResult.processedCount +
          ' processed (validated + generated), ' +
          levelResult.skippedCount +
          ' skipped (cache hit)',
      );
    }

    // Build the authoritative rename list from ModelProcessor's actual file operations.
    // ModelProcessor reads the real file content from disk, so its rename operations
    // always have the correct old/new paths — even when roots have stale data from
    // syncsPending (where both ID and pathJson can reference intermediate states).
    //
    // We discard RenameHandler-detected renames that have no corresponding rename
    // operation, as they originate from stale root data (e.g., pathJson pointing to
    // a file that was already renamed by a previous sync). Using such stale renames
    // would cause propagateRenames() to search for the wrong old name in downstream
    // files.
    const operationRenames: DetectedRename[] = [];
    const seenOldPaths = new Set<string>();

    for (const op of allOperations) {
      if (
        op.type === 'rename' &&
        op.oldPath.endsWith('.model.json') &&
        !seenOldPaths.has(op.oldPath)
      ) {
        const oldName = path.basename(op.oldPath).replace(/\.model\.json$/, '');
        const newName = path.basename(op.newPath).replace(/\.model\.json$/, '');
        operationRenames.push({
          oldName,
          newName,
          pathJson: op.oldPath,
          newPathJson: op.newPath,
        });
        seenOldPaths.add(op.oldPath);
      }
    }

    // Replace the renames array: use only operation-backed renames.
    // RenameHandler renames that have no matching operation were from stale roots
    // (the resource was never processed because the file at pathJson didn't exist).
    renames.length = 0;
    renames.push(...operationRenames);

    if (renames.length > 0) {
      this.callbacks.onProgress?.('Propagating model renames...');

      const renameOps = await this.renameHandler.propagateRenames({
        renames,
        jsonUris,
        project,
        extensionConfig: this.config.extensionConfig,
      });

      allOperations.push(...renameOps);
    }

    if (allOperations.length > 0) {
      this.callbacks.onProgress?.(
        'Writing ' + allOperations.length + ' file changes...',
      );

      // Notify caller BEFORE file operations so watcher suppression is set up
      // before WorkspaceEdit.renameFile() triggers file watcher events.
      this.callbacks.onBeforeFileOps?.(allOperations);

      const ioResult = await executeSyncOperationsVSCode(
        allOperations,
        this.config.parallelBatchSize ?? SYNC_BATCH_SIZES.RESOURCE_PROCESSING,
        this.config.logger,
      );

      this.config.logger.info(
        'File I/O complete: ' +
          ioResult.writesCount +
          ' writes, ' +
          ioResult.deletesCount +
          ' deletes, ' +
          ioResult.renamesCount +
          ' renames',
      );

      // Apply cache updates now that file writes have succeeded
      // This ensures cache only reflects content actually written to disk
      for (const cacheInfo of allCacheUpdates) {
        if (cacheInfo.isSource) {
          cacheManager.updateSource(
            cacheInfo.pathJson,
            cacheInfo.jsonContent,
            cacheInfo.yml,
          );
        } else {
          cacheManager.update(
            cacheInfo.pathJson,
            cacheInfo.jsonContent,
            cacheInfo.sql,
            cacheInfo.yml,
          );
        }
      }

      this.config.logger.info(
        'Cache updated for ' + allCacheUpdates.length + ' resources',
      );
    }

    const stats = this.buildStats({
      totalResources: orderedResources.length,
      processedCount,
      skippedCount,
      levelCount: levels.length,
      maxParallelism,
      startTime,
    });

    this.config.logger.info(
      'Sync complete in ' +
        stats.totalTimeMs +
        'ms: ' +
        processedCount +
        ' processed (validated + generated), ' +
        skippedCount +
        ' skipped (cache hit)',
    );

    return {
      success: errors.length === 0,
      stats,
      renames,
      errors,
    };
  }

  private async processLevel(params: {
    level: { depth: number; resources: SyncResource[] };
    project: DbtProject;
    jsonUriMap: Map<string, vscode.Uri>;
    modelProcessor: ModelProcessor;
    sourceProcessor: SourceProcessor;
    cacheManager: CacheManager;
    changedParentIds: Set<string>;
    autoGenerateTestsConfig?: AutoGenerateTestsConfig;
  }): Promise<{
    processedCount: number;
    skippedCount: number;
    operations: FrameworkSyncOp[];
    errors: SyncError[];
    updatedProject: DbtProject | null;
    cacheUpdates: CacheUpdateInfo[];
    changedResourceIds: Set<string>;
  }> {
    const {
      level,
      jsonUriMap,
      modelProcessor,
      sourceProcessor,
      cacheManager,
      changedParentIds,
    } = params;
    let { project } = params;

    const operations: FrameworkSyncOp[] = [];
    const errors: SyncError[] = [];
    const cacheUpdates: CacheUpdateInfo[] = [];
    const changedResourceIds = new Set<string>();
    let processedCount = 0;
    let skippedCount = 0;
    let updatedProject: DbtProject | null = null;

    const batchSize =
      this.config.parallelBatchSize ?? SYNC_BATCH_SIZES.RESOURCE_PROCESSING;

    // Process resources in batches with parallel processing within each batch.
    // We batch to limit concurrent operations and avoid overwhelming the system.
    // Manifest updates are merged sequentially after parallel processing completes
    // to ensure correct granular updates without race conditions.
    for (let i = 0; i < level.resources.length; i += batchSize) {
      const batch = level.resources.slice(i, i + batchSize);

      // Process batch in parallel for performance
      const batchResults = await Promise.all(
        batch.map(async (resource) => {
          const jsonUri = jsonUriMap.get(resource.pathJson);
          if (!jsonUri) {
            return { resource, result: null };
          }

          try {
            const fileContent = await vscode.workspace.fs.readFile(jsonUri);
            let jsonContent = fileContent.toString();

            // Check if any parent had content changes in this sync
            const hasChangedParent = resource.parentIds.some((parentId) =>
              changedParentIds.has(parentId),
            );

            // Check cache first for true skip (no validation, no generation)
            // If content hasn't changed AND no parent changed, skip entirely
            if (
              this.config.enableChangeDetection &&
              !hasChangedParent &&
              !cacheManager.hasJsonChanged(resource.pathJson, jsonContent)
            ) {
              // True cache hit - skip validation and generation
              return {
                resource,
                result: {
                  skipped: true,
                  operations: [],
                  updatedProject: null,
                } as any,
              };
            }

            // Cache miss or changed - proceed with validation and generation
            // Validate and optionally enhance if validation service is available
            if (this.validationService) {
              if (resource.type === 'model') {
                const modelJson = jsonParse(jsonContent) as FrameworkModel;
                const validation = this.validationService.validateModel({
                  modelJson,
                  pathJson: resource.pathJson,
                  config: (params as any).autoGenerateTestsConfig,
                  projectPath: project.pathSystem,
                  rawJsonContent: jsonContent,
                });

                if (!validation.valid) {
                  this.callbacks.onModelValidationError?.(
                    jsonUri,
                    validation.error ?? 'Validation failed',
                    validation.errors,
                    jsonContent,
                  );
                  errors.push({
                    resourceId: resource.id,
                    message: validation.error ?? 'Validation failed',
                  });
                  return { resource, result: null };
                }

                // Use enhanced JSON if available (includes auto-generated tests)
                if (validation.enhancedJsonContent) {
                  jsonContent = validation.enhancedJsonContent;
                }
              } else if (resource.type === 'source') {
                const sourceJson = jsonParse(jsonContent);
                const validation = this.validationService.validateSource({
                  sourceJson,
                  pathJson: resource.pathJson,
                });

                if (!validation.valid) {
                  this.callbacks.onModelValidationError?.(
                    jsonUri,
                    validation.error ?? 'Validation failed',
                    validation.errors,
                    jsonContent,
                  );
                  errors.push({
                    resourceId: resource.id,
                    message: validation.error ?? 'Validation failed',
                  });
                  return { resource, result: null };
                }
              }
            }

            switch (resource.type) {
              case 'model': {
                const modelResult = await modelProcessor.process({
                  resource,
                  jsonContent,
                  project,
                });
                return { resource, result: modelResult };
              }

              case 'source': {
                const sourceResult = await sourceProcessor.process({
                  resource,
                  jsonContent,
                  project,
                });
                return { resource, result: sourceResult };
              }

              default:
                return { resource, result: null };
            }
          } catch (err: unknown) {
            this.config.logger.error(
              'Error processing ' + resource.id + ':',
              err,
            );
            errors.push({
              resourceId: resource.id,
              message: err instanceof Error ? err.message : 'Unknown error',
              error: err instanceof Error ? err : undefined,
            });
            return { resource, result: null };
          }
        }),
      );

      // Merge results sequentially to ensure manifest consistency
      for (const item of batchResults) {
        if (!item?.result) {
          continue;
        }

        const { resource, result } = item;

        if (result.skipped) {
          skippedCount++;
        } else {
          processedCount++;
        }

        operations.push(...result.operations);

        // Track resources that had actual content changes (write operations)
        // These resources will cause their children to bypass cache checks
        const hasWriteOperations = result.operations.some(
          (op: FrameworkSyncOp) => op.type === 'write',
        );
        if (hasWriteOperations) {
          changedResourceIds.add(resource.id);
        }

        // Collect cache info for deferred update after file writes
        if (result.cacheInfo) {
          cacheUpdates.push(result.cacheInfo);
        }

        // Merge manifest updates from parallel processing
        // (even if resource was skipped, we might have an updatedProject if the manifest was stale)
        if (result.updatedProject) {
          project = this.manifestManager.mergeResourceUpdate(project, result);
          updatedProject = project;
        }
      }
    }

    return {
      processedCount,
      skippedCount,
      operations,
      errors,
      updatedProject,
      cacheUpdates,
      changedResourceIds,
    };
  }

  private buildStats(params: {
    totalResources: number;
    processedCount: number;
    skippedCount: number;
    levelCount: number;
    maxParallelism: number;
    startTime: number;
  }): SyncStats {
    return {
      totalResources: params.totalResources,
      processedResources: params.processedCount,
      skippedResources: params.skippedCount,
      dependencyLevels: params.levelCount,
      maxParallelism: params.maxParallelism,
      totalTimeMs: Date.now() - params.startTime,
    };
  }
}
