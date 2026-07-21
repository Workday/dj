/**
 * Sync Module
 *
 * This module provides the JSON sync engine for dbt models and sources.
 * It handles the `dj.command.jsonSync` operation with:
 * - Building dependency graphs from dbt manifest
 * - Parallel processing by dependency level (respecting DAG order)
 * - Content-based change detection to skip unchanged files
 * - Model rename detection and propagation
 *
 * Architecture:
 * - SyncEngine: Main orchestrator
 * - ModelProcessor: Handles model JSON processing
 * - SourceProcessor: Handles source JSON processing
 * - RenameHandler: Detects and propagates renames
 * - ManifestManager: Checks manifest freshness
 * - CacheManager: Content-based change detection
 *
 * Note: This module uses Node.js and VS Code APIs, so it cannot be used in
 * the web/browser environment. For shared pure utilities, see `@shared/framework/`.
 *
 * @example
 * ```typescript
 * import { SyncEngine, CacheManager } from '@services/sync';
 *
 * const cacheManager = new CacheManager();
 * const engine = new SyncEngine(config, callbacks);
 *
 * const result = await engine.execute({
 *   project,
 *   jsonUris,
 *   cacheManager,
 *   parseManifest: async (p) => await api.parseProject(p),
 *   fetchManifest: async (p) => await dbt.fetchManifest(p),
 * });
 * ```
 */

// Main Entry Point

export { SyncEngine } from './SyncEngine';
export { SyncQueue } from './SyncQueue';

// Processors

export { ManifestManager } from './ManifestManager';
export { ModelProcessor } from './ModelProcessor';
export { PythonModelSyncService } from './PythonModelSyncService';
/** @deprecated Use PythonModelSyncService */
export type {
  PythonModelFileSet,
  PythonModelSyncLogger,
  PythonModelSyncSource,
} from './PythonModelSyncService';
export { PythonModelSyncService as PredbtSyncService } from './PythonModelSyncService';
export { RenameHandler } from './RenameHandler';
export { SourceProcessor } from './SourceProcessor';
export { ValidationService } from './ValidationService';
/** @deprecated Use PythonModel* types */
export type {
  PythonModelFileSet as PredbtFileSet,
  PythonModelSyncLogger as PredbtSyncLogger,
  PythonModelSyncSource as PredbtSyncSource,
} from './PythonModelSyncService';

// Support Utilities

export { CacheManager } from './cacheManager';
export { ERROR_MESSAGES, SYNC_BATCH_SIZES } from './constants';
export {
  buildOrderedResources,
  getManifestResources,
  groupByDependencyLevel,
} from './dependencyGraph';
export {
  buildUriMap,
  executeSyncOperationsVSCode,
  readOldModelFiles,
  readOldSourceFile,
} from './fileOperations';

// Types

export type {
  // Cache
  ContentHashEntry,
  DependencyLevel,
  // Rename types
  DetectedRename,
  // Processing results
  ModelProcessingResult,
  // Validation results
  ModelValidationResult,
  RenameConflictResult,
  ResourceProcessingResult,
  SourceProcessingResult,
  SourceValidationResult,
  SyncCallbacks,
  // Configuration
  SyncConfig,
  // Context
  SyncContext,
  SyncError,
  // Execution
  SyncExecuteParams,
  SyncLogger,
  // Core types
  SyncResource,
  SyncResult,
  SyncRoot,
  SyncStats,
  ValidationErrorDetail,
  ValidationServiceParams,
} from './types';
