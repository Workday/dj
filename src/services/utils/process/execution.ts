import { WORKSPACE_ROOT } from 'admin';

import { safeSpawn } from './safeSpawn';
import { buildProcessEnv } from './venv';

export interface RunProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  logger?: {
    error?: (text: string) => void;
    info?: (text: string) => void;
  };
  additionalEnv?: Record<string, string | undefined>;
}

/**
 * Execute a shell command with Python venv support.
 * Uses buildProcessEnv for proper environment variable handling.
 *
 * @param options - Process execution options
 * @returns Promise resolving to stdout output
 *
 * @example
 * ```typescript
 * // Execute git command
 * const result = await runProcess({
 *   command: 'git',
 *   args: ['status'],
 *   cwd: '/path/to/repo'
 * });
 *
 * // Execute with logging
 * const result = await runProcess({
 *   command: 'dbt',
 *   args: ['run'],
 *   logger: {
 *     info: (msg) => console.log(msg),
 *     error: (msg) => console.error(msg)
 *   }
 * });
 * ```
 */
export function runProcess(options: RunProcessOptions): Promise<string> {
  const {
    command,
    args = [],
    cwd = WORKSPACE_ROOT,
    logger,
    additionalEnv,
  } = options;

  const env = buildProcessEnv(additionalEnv);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    // safeSpawn resolves the executable on every platform (PATHEXT / .cmd
    // shims on Windows) without a shell, so shell: false keeps argv boundaries
    // intact and repository-controlled arguments (e.g. model selectors) are
    // never re-parsed by a shell.
    const childProcess = safeSpawn(command, args, {
      cwd,
      env,
      shell: false,
    });

    childProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      logger?.info?.(output);
      stdout += output;
    });

    childProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      logger?.error?.(error);
      stderr += error;
    });

    childProcess.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Process exited with code ${code}`));
      }
    });

    childProcess.on('error', (error) => {
      reject(error);
    });
  });
}
