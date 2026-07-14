import { getDjConfig } from '@services/config';
import { WORKSPACE_ROOT } from 'admin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Environment variables for Python virtual environment activation.
 * These variables mimic the effect of running `source venv/bin/activate`.
 */
export interface VenvEnvironment {
  /** Modified PATH with venv bin directory prepended */
  PATH: string;
  /** Absolute path to the virtual environment directory */
  VIRTUAL_ENV: string;
  /** PYTHONHOME must be unset for venv to work correctly */
  PYTHONHOME?: undefined;
}

/**
 * Get the Python virtual environment configuration.
 * Returns environment variables needed to activate the venv for spawned processes.
 *
 * This function:
 * - Reads the pythonVenvPath from DJ configuration
 * - Handles both relative and absolute paths
 * - Validates that the venv exists before returning configuration
 * - Returns an empty object if no venv is configured or it doesn't exist
 *
 * @returns Partial VenvEnvironment with PATH, VIRTUAL_ENV, and PYTHONHOME settings
 *
 * @example
 * ```typescript
 * const venvEnv = getVenvEnvironment();
 * if (venvEnv.PATH) {
 *   console.log('Using venv:', venvEnv.VIRTUAL_ENV);
 * }
 * ```
 */
export function getVenvEnvironment(): Partial<VenvEnvironment> {
  try {
    const { pythonVenvPath } = getDjConfig();
    if (!pythonVenvPath) {
      return {};
    }

    // Handle both relative and absolute paths
    const absVenv = path.isAbsolute(pythonVenvPath)
      ? pythonVenvPath
      : path.join(WORKSPACE_ROOT, pythonVenvPath);

    // Virtual environments place their executables (and the activate marker)
    // under Scripts on Windows and bin elsewhere.
    const isWindows = process.platform === 'win32';
    const binPath = path.join(absVenv, isWindows ? 'Scripts' : 'bin');
    const activatePath = path.join(
      binPath,
      isWindows ? 'activate.bat' : 'activate',
    );

    // Validate venv exists before using it
    if (!fs.existsSync(activatePath)) {
      return {};
    }

    return {
      VIRTUAL_ENV: absVenv,
      PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ''}`,
      PYTHONHOME: undefined,
    };
  } catch {
    // Fail-safe: return empty object if any error occurs
    return {};
  }
}

/**
 * Build a complete process environment with Python virtual environment support.
 * This is the primary utility for spawning Python-based CLI tools (dbt, lightdash, etc.).
 *
 * This function:
 * - Starts with the current process environment
 * - Applies venv configuration (PATH, VIRTUAL_ENV, removes PYTHONHOME)
 * - Merges any additional environment variables provided
 *
 * @param additionalEnv - Optional additional environment variables to set (e.g., CI: 'true')
 * @returns Complete NodeJS.ProcessEnv suitable for safeSpawn()
 *
 * @example
 * ```typescript
 * // Basic usage for dbt
 * const env = buildProcessEnv();
 * safeSpawn('dbt', ['compile'], { env });
 *
 * // With additional env vars for Lightdash
 * const env = buildProcessEnv({ CI: 'true' });
 * safeSpawn('lightdash', ['start-preview'], { env });
 *
 * // Override specific variables
 * const env = buildProcessEnv({ DBT_HOST: 'custom-host' });
 * ```
 */
export function buildProcessEnv(
  additionalEnv?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env };
  const venvEnv = getVenvEnvironment();

  // Apply venv environment variables
  if (venvEnv.PATH) {
    baseEnv.PATH = venvEnv.PATH;
  }
  if (venvEnv.VIRTUAL_ENV) {
    baseEnv.VIRTUAL_ENV = venvEnv.VIRTUAL_ENV;
  }
  // Remove PYTHONHOME if venv is configured (required for venv to work correctly)
  if ('PYTHONHOME' in venvEnv) {
    delete baseEnv.PYTHONHOME;
  }

  // Apply additional environment variables
  if (additionalEnv) {
    for (const [key, value] of Object.entries(additionalEnv)) {
      if (value === undefined) {
        delete baseEnv[key];
      } else {
        baseEnv[key] = value;
      }
    }
  }

  return baseEnv;
}
