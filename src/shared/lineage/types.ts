/**
 * Common types shared between column lineage and model lineage
 */

/** Model layer type based on naming conventions */
export type ModelLayerType =
  | 'source'
  | 'staging'
  | 'intermediate'
  | 'mart'
  | 'python';

/** Model layer prefixes for name-based detection */
export const MODEL_LAYER_PREFIXES = {
  staging: 'stg__',
  intermediate: 'int__',
  mart: 'mart__',
} as const;

/**
 * Get the model layer type from model name based on prefix conventions
 *
 * Prefix conventions:
 * - `stg__` -> staging
 * - `int__` -> intermediate
 * - `mart__` -> mart
 * - default -> intermediate
 *
 * @param modelName - Name of the model
 * @returns Model layer type
 */
export function getModelLayer(modelName: string): ModelLayerType {
  if (modelName.startsWith(MODEL_LAYER_PREFIXES.staging)) {
    return 'staging';
  }
  if (modelName.startsWith(MODEL_LAYER_PREFIXES.intermediate)) {
    return 'intermediate';
  }
  if (modelName.startsWith(MODEL_LAYER_PREFIXES.mart)) {
    return 'mart';
  }
  return 'intermediate';
}
