/**
 * Framework utilities - Main export file
 *
 * This file re-exports all utility functions from their respective modules
 * to maintain backward compatibility with existing imports.
 *
 * **Module Structure (4 modules):**
 * - `model-utils.ts` - Model metadata, IDs, names, layers
 * - `source-utils.ts` - Source operations and metadata
 * - `column-utils.ts` - All column processing
 * - `sql-utils.ts` - All SQL generation
 *
 * **Current State:**
 * - All functions have been migrated from `src/shared/framework/utils.ts`
 * - Original `utils.ts` has been deleted
 */

// Model utilities
export * from './model-utils';

// Source utilities
export * from './source-utils';

// Column utilities
export * from './column-utils';

// SQL utilities (includes buildConditionsSql, frameworkGenerateCteSql for CTE support)
export * from './sql-utils';

// Reserved-key lint for model/column meta
export * from './meta-lint';

// Re-export types that utilities depend on
export type { DbtProject } from '@shared/dbt/types';
export type {
  FrameworkColumn,
  FrameworkModel,
  FrameworkSelected,
} from '@shared/framework/types';
