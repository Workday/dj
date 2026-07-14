/**
 * Process utilities for spawning Python-based CLI tools with virtual environment support.
 *
 * This module provides centralized utilities for:
 * - Python virtual environment configuration
 * - Building process environments for safeSpawn()
 * - High-level process execution with venv support
 *
 * @example
 * ```typescript
 * import { buildProcessEnv, safeSpawn } from '@services/utils/process';
 *
 * // Spawn dbt with venv support
 * const env = buildProcessEnv();
 * safeSpawn('dbt', ['compile'], { env });
 *
 * // Spawn lightdash with additional env vars
 * const env = buildProcessEnv({ CI: 'true' });
 * safeSpawn('lightdash', ['start-preview'], { env });
 *
 * // High-level process execution
 * const result = await runProcess({
 *   command: 'git',
 *   args: ['status']
 * });
 * ```
 */
export { runProcess, type RunProcessOptions } from './execution';
export { safeSpawn } from './safeSpawn';
export type { VenvEnvironment } from './venv';
export { buildProcessEnv, getVenvEnvironment } from './venv';
