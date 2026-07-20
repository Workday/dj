/**
 * Type definitions for the JSON Sync Engine
 *
 * This module contains all type definitions used by the sync engine
 * for processing dbt model and source JSON files.
 */

import type { AutoGenerateTestsConfig } from '@services/framework/utils';
import type { CoderConfig } from '@services/types/config';
import type {
  DbtProject,
  DbtProjectManifest,
  DbtResourceType,
} from '@shared/dbt/types';
import type { FrameworkModel, FrameworkSyncOp } from '@shared/framework/types';
import type { Ajv, ValidateFunction } from 'ajv';
import type * as vscode from 'vscode';

import type { CacheManager } from './cacheManager';

/**
 * Represents a resource (model, source, or seed) to be synced.
 * Contains all information needed to process the resource.
 */
export interface SyncResource {
  /** Unique identifier (e.g., "model.project.stg__users") */
  id: string;
  /** Path to the .model.json or .source.json file */
  pathJson: string;
  /** Path to the output resource file (.sql for models, .yml for sources) */
  pathResource: string;
  /** Type of resource */
  type: DbtResourceType;
  /** IDs of parent resources this depends on */
  parentIds: string[];
  /** Dependency depth (0 = no parents, 1 = depends on depth 0, etc.) */
  depth: number;
}

/**
 * A group of resources at the same dependency depth.
 * Resources within a level can be processed in parallel.
 */
export interface DependencyLevel {
  /** Depth level (0 = sources/seeds, higher = more downstream) */
  depth: number;
  /** Resources at this depth level */
  resources: SyncResource[];
}

/**
 * Root resource to sync (from user action or file watcher).
 */
export interface SyncRoot {
  /** Resource ID (e.g., "model.project.stg__users") */
  id: string;
  /** Path to the JSON file (optional for manifest-based lookups) */
  pathJson?: string;
}

/**
 * Logger interface for sync operations.
 * Abstracted to allow different logging implementations.
 */
export interface SyncLogger {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
}

/**
 * Configuration for a sync operation.
 * Follows the "Configuration Object" pattern for clarity and extensibility.
 *
 * @example
 * ```typescript
 * const config: SyncConfig = {
 *   extensionConfig: { aiHintTag: 'AI_HINT' },
 *   logger: console,
 *   enableChangeDetection: true,
 *   parallelBatchSize: 10,
 *   enableValidation: true,
 * };
 * ```
 */
export interface SyncConfig {
  /** Extension configuration (aiHintTag, etc.) */
  extensionConfig: CoderConfig;
  /** Logger for sync operations */
  logger: SyncLogger;
  /** Enable change detection to skip unchanged files (default: true) */
  enableChangeDetection: boolean;
  /** Max concurrent operations per batch (default: 10) */
  parallelBatchSize: number;
  /** Enable model/source validation before processing (default: true) */
  enableValidation?: boolean;
}

/**
 * Callbacks for sync lifecycle events.
 * Enables framework.ts to handle VS Code-specific concerns without
 * coupling the sync engine to VS Code APIs.
 *
 * All callbacks are optional - provide only what you need.
 *
 * @example
 * ```typescript
 * const callbacks: SyncCallbacks = {
 *   onProgress: (msg) => progress.report({ message: msg }),
 *   onModelValidationError: (uri, msg, errors, jsonContent) => {
 *     diagnostics.set(uri, [new Diagnostic(range, msg)]);
 *   },
 * };
 * ```
 */
export interface SyncCallbacks {
  /** Called when model or source validation fails */
  onModelValidationError?: (
    uri: vscode.Uri,
    message: string,
    errors?: ValidationErrorDetail[],
    jsonContent?: string,
  ) => void;

  /**
   * Called for non-blocking validation issues (e.g. CTE column reference
   * warnings, main-model aggregation soft-fails). Optionally carries
   * structured per-error details (with `instancePath`) so the consumer can
   * pin diagnostics to specific JSON locations.
   */
  onModelValidationWarning?: (
    uri: vscode.Uri,
    message: string,
    errors?: ValidationErrorDetail[],
    jsonContent?: string,
  ) => void;

  /**
   * Called for structured non-blocking lint warnings (e.g. reserved-key
   * collisions in model/column `meta`). Unlike `onModelValidationWarning`,
   * each entry carries a JSON-pointer `instancePath` so the caller can
   * position the diagnostic at the offending node in the source file.
   * Callers are expected to render these at Warning severity and append
   * them to any diagnostics already posted for the file (instead of
   * replacing, which would stomp on co-existing error diagnostics).
   */
  onModelValidationLintWarnings?: (
    uri: vscode.Uri,
    warnings: ValidationErrorDetail[],
    jsonContent: string,
  ) => void;

  /** Called when SQL/YML generation fails */
  onGenerationError?: (
    uri: vscode.Uri,
    modelName: string,
    error: Error,
  ) => void;

  /** Called to clear diagnostics for a successfully processed file */
  onDiagnosticsClear?: (uri: vscode.Uri) => void;

  /** Called to report progress during sync */
  onProgress?: (message: string) => void;

  /**
   * Called when a rename conflict is detected.
   * Return false to abort the sync operation.
   */
  onRenameConflict?: (oldName: string, newName: string) => boolean;

  /** Check if sync should be aborted (e.g., user cancelled) */
  shouldAbort?: () => boolean;

  /**
   * Called before file operations execute, for watcher suppression setup.
   * Receives all operations that are about to be performed so the caller
   * can record operation timestamps for watcher suppression.
   */
  onBeforeFileOps?: (operations: FrameworkSyncOp[]) => void;
}

/**
 * Information needed to update the cache after file writes succeed.
 * This is collected during processing and applied after file operations complete.
 */
export interface CacheUpdateInfo {
  /** Path to the JSON file */
  pathJson: string;
  /** Current JSON file content */
  jsonContent: string;
  /** Generated SQL content (empty for sources) */
  sql: string;
  /** Generated YML content */
  yml: string;
  /** Whether this is a source (true) or model (false) */
  isSource: boolean;
}

/**
 * Result of processing a single model resource.
 */
export interface ModelProcessingResult {
  /** Model ID */
  modelId: string;
  /** Model name (for display/logging) */
  modelName: string;
  /** Generated SQL content */
  sql: string;
  /** Generated YML content */
  yml: string;
  /** Updated project with manifest changes */
  updatedProject: DbtProject | null;
  /** File operations to perform */
  operations: FrameworkSyncOp[];
  /** Whether the model was skipped (unchanged) */
  skipped: boolean;
  /** Cache update info to apply after file writes succeed */
  cacheInfo?: CacheUpdateInfo;
  /** Error information if processing failed */
  error?: {
    uri: vscode.Uri;
    message: string;
  };
}

/**
 * Result of processing a single source resource.
 */
export interface SourceProcessingResult {
  /** Source ID */
  sourceId: string;
  /** Source name (for display/logging) */
  sourceName: string;
  /** Generated YML content */
  yml: string;
  /** Updated project with manifest changes */
  updatedProject: DbtProject | null;
  /** File operations to perform */
  operations: FrameworkSyncOp[];
  /** Whether the source was skipped (unchanged) */
  skipped: boolean;
  /** Cache update info to apply after file writes succeed */
  cacheInfo?: CacheUpdateInfo;
}

/**
 * Combined result type for resource processing.
 */
export type ResourceProcessingResult =
  | ModelProcessingResult
  | SourceProcessingResult;

/**
 * Detected model rename (name in JSON differs from file path).
 */
export interface DetectedRename {
  /** Old model name (from file path) */
  oldName: string;
  /** New model name (from JSON content) */
  newName: string;
  /** Path to the model.json file (old path) */
  pathJson: string;
  /** New path to the model.json file (populated after ModelProcessor computes it) */
  newPathJson?: string;
}

/**
 * Result of checking for rename conflicts.
 */
export interface RenameConflictResult {
  /** Whether a conflict exists */
  hasConflict: boolean;
  /** Path to existing model if conflict exists */
  existingPath?: string;
}

/**
 * Error that occurred during sync.
 */
export interface SyncError {
  /** Resource ID that caused the error */
  resourceId: string;
  /** Error message */
  message: string;
  /** Original error object */
  error?: Error;
}

/**
 * Statistics for a completed sync operation.
 * Useful for logging, debugging, and performance monitoring.
 */
export interface SyncStats {
  /** Total resources discovered */
  totalResources: number;
  /** Resources actually processed (not skipped) */
  processedResources: number;
  /** Resources skipped due to no changes */
  skippedResources: number;
  /** Number of dependency levels */
  dependencyLevels: number;
  /** Maximum parallelism achieved (largest level size) */
  maxParallelism: number;
  /** Total time in milliseconds */
  totalTimeMs?: number;
  /** Time spent on file I/O in milliseconds */
  ioTimeMs?: number;
  /** Time spent on generation in milliseconds */
  generationTimeMs?: number;
}

/**
 * Result of a complete sync operation.
 * Provides detailed information about what happened.
 */
export interface SyncResult {
  /** Whether the sync completed successfully */
  success: boolean;
  /** Statistics about the sync operation */
  stats: SyncStats;
  /** Model renames that were processed */
  renames: DetectedRename[];
  /** Errors that occurred during sync */
  errors: SyncError[];
  /** Whether the sync was aborted */
  aborted?: boolean;
}

/**
 * Parameters for executing a sync operation.
 */
export interface SyncExecuteParams {
  /** The dbt project to sync */
  project: DbtProject;
  /** All JSON file URIs in the workspace */
  jsonUris: vscode.Uri[];
  /** Cache manager for change detection */
  cacheManager: CacheManager;
  /** Optional specific resources to sync (if not provided, syncs all) */
  roots?: SyncRoot[];
  /** Last file change timestamp (for manifest freshness check) */
  lastFileChange?: Date | null;
  /** Force manifest reparse at start of sync (e.g., after a previous rename sync) */
  forceReparse?: boolean;
  /** Optional auto-test generation configuration */
  autoGenerateTestsConfig?: AutoGenerateTestsConfig;
  /**
   * Function to parse the manifest.
   * Injected to avoid coupling sync engine to API layer.
   */
  parseManifest: (project: DbtProject) => Promise<DbtProjectManifest>;
  /**
   * Function to fetch the current manifest.
   * Injected to avoid coupling sync engine to API layer.
   */
  fetchManifest: (project: DbtProject) => Promise<DbtProjectManifest | null>;
}

/**
 * Context passed through the sync pipeline.
 * Mutable state that accumulates during processing.
 */
export interface SyncContext {
  /** Current project state (updated as models are processed) */
  project: DbtProject;
  /** Sync configuration */
  config: SyncConfig;
  /** Map of JSON file paths to their URIs for O(1) lookup */
  jsonUriMap: Map<string, vscode.Uri>;
  /** Content hash cache for change detection */
  cacheManager: CacheManager;
  /** Accumulated file operations to execute at the end */
  pendingOperations: FrameworkSyncOp[];
  /** Detected model renames */
  renames: DetectedRename[];
  /** Errors encountered during processing */
  errors: SyncError[];
  /** Statistics being collected */
  stats: SyncStats;
}

/**
 * Cache entry for content hashing.
 * Stores hashes of all file contents for change detection.
 */
export interface ContentHashEntry {
  /** Hash of the JSON file content */
  jsonHash: string;
  /** Hash of the generated SQL content */
  sqlHash: string;
  /** Hash of the generated YML content */
  ymlHash: string;
  /** Timestamp when this entry was created */
  timestamp: number;
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Parameters for initializing ValidationService.
 * Contains dependencies needed for validation and enhancement.
 */
export interface ValidationServiceParams {
  /** AJV instance for schema validation (null if not initialized) */
  ajv: Ajv | null;
  /** Validator function for source JSON schemas */
  sourceValidator: ValidateFunction | undefined;
  /** Configuration for auto-generating tests (optional) */
  autoGenerateTestsConfig?: AutoGenerateTestsConfig;
}

/**
 * A single validation error with its JSON pointer path for diagnostic positioning.
 */
export interface ValidationErrorDetail {
  /** Human-readable error message */
  message: string;
  /** AJV JSON pointer path, e.g. "/tables/0/freshness" */
  instancePath: string;
  /**
   * Optional per-detail severity override. When omitted, the consumer
   * (e.g. `resolveValidationDiagnostics`) applies its default severity for
   * the channel (Error for AJV failures, Warning for post-generation
   * checks). Set to 'error' on a detail emitted via the warning channel
   * to render it as a red squiggle without overwriting sibling warnings.
   */
  severity?: 'error' | 'warning';
}

/**
 * Result of model JSON validation.
 * Contains enhanced model JSON with auto-generated tests if applicable.
 */
export interface ModelValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Path to the JSON file being validated */
  pathJson: string;
  /** Error message if validation failed */
  error?: string;
  /** Individual errors with JSON paths for diagnostic positioning */
  errors?: ValidationErrorDetail[];
  /** Enhanced model JSON with auto-generated tests (if valid) */
  enhancedModelJson?: FrameworkModel;
  /** Stringified enhanced JSON content ready for processing (if valid) */
  enhancedJsonContent?: string;
  /** Number of auto-tests added (if any) */
  testsAdded?: number;
}

/**
 * Result of source JSON validation.
 */
export interface SourceValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Path to the JSON file being validated */
  pathJson: string;
  /** Error message if validation failed */
  error?: string;
  /** Individual errors with JSON paths for diagnostic positioning */
  errors?: ValidationErrorDetail[];
}

/**
 * Result of python model JSON validation.
 */
export interface PythonModelValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Path to the JSON file being validated */
  pathJson: string;
  /** Error message if validation failed */
  error?: string;
  /** Individual errors with JSON paths for diagnostic positioning */
  errors?: ValidationErrorDetail[];
}
