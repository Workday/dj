/**
 * Constants for the Sync Engine
 *
 * Centralizes configuration values used throughout the sync module
 * to improve maintainability and consistency.
 */

/**
 * Batch sizes for parallel processing operations.
 * These values balance performance with resource usage.
 */
export const SYNC_BATCH_SIZES = {
  /** Batch size for parallel resource processing within a dependency level */
  RESOURCE_PROCESSING: 10,

  /** Batch size for parallel rename propagation file updates */
  RENAME_PROPAGATION: 50,

  /** Batch size for parallel file I/O operations (writes/deletes) */
  FILE_OPERATIONS: 20,
} as const;

/**
 * Standard error messages used across the sync module.
 * Centralizing these ensures consistent user-facing messaging.
 */
export const ERROR_MESSAGES = {
  /**
   * Error message for a failed SQL/YML generation for a model.
   *
   * The wording intentionally avoids blaming any specific authoring construct
   * (e.g. "double check any expr") because this wrapper catches every kind of
   * failure -- malformed inherited dimension meta, missing parents, invalid
   * schema-shape after manifest round-trip, etc. -- not just SQL expressions.
   * Misleading users into auditing `expr` syntax for an unrelated failure
   * caused real debugging pain in production.
   *
   * @param errorMsg - The underlying error message from the generator
   */
  INVALID_MODEL_SQL: (errorMsg: string) =>
    `Failed to generate SQL/YML for this model:\n\n${errorMsg}`,

  /** Error when model prefix cannot be determined */
  UNABLE_TO_GET_PREFIX: (resourceName: string) =>
    `Unable to get prefix for: ${resourceName}`,

  /** Error when SQL or YML generation produces empty output */
  EMPTY_OUTPUT_GENERATED: (resourceName: string) =>
    `Empty SQL or YML generated for: ${resourceName}`,
} as const;
