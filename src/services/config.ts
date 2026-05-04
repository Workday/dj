import { COMMAND_ID } from '@services/constants';
import { FRAMEWORK_JSON_SYNC_EXCLUDE_PATHS } from '@services/framework/constants';
import type { CoderConfig } from '@services/types/config';
import { DEFAULT_INCREMENTAL_STRATEGY } from '@shared/framework/constants';
import { WORKSPACE_ROOT } from 'admin';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Update VSCode JSON schema associations in settings.
 * @param schemas Array of schema associations, each with fileMatch and url.
 * Example:
 *   updateVSCodeJsonSchemas([
 *     { fileMatch: ['*.model.json'], url: '.dj/schemas/model.schema.json' },
 *     { fileMatch: ['*.source.json'], url: '.dj/schemas/source.schema.json' }
 *   ]);
 */
export function updateVSCodeJsonSchemas(
  schemas: { fileMatch: string[]; url: string }[],
) {
  return vscode.workspace.getConfiguration('json').update('schemas', schemas);
}

/**
 * Get the complete DJ configuration object
 * @returns CoderConfig with all settings from package.json
 */
export function getDjConfig(): CoderConfig {
  const config = vscode.workspace.getConfiguration('dj');

  return {
    // Optional settings (no defaults in package.json)
    airflowTargetVersion: config.get('airflowTargetVersion', undefined),
    airflowDagsPath: config.get('airflowDagsPath', undefined),
    aiHintTag: config.get('aiHintTag', undefined),
    codingAgent: config.get('codingAgent', undefined),
    dbtProjectNames: config.get('dbtProjectNames', undefined),
    dbtGenericTestsPath: config.get('dbtGenericTestsPath', undefined),
    dbtMacroPath: config.get('dbtMacroPath', undefined),
    pythonVenvPath: config.get('pythonVenvPath', undefined),
    trinoPath: config.get('trinoPath', undefined),
    lightdashProjectPath: config.get('lightdashProjectPath', undefined),
    lightdashProfilesPath: config.get('lightdashProfilesPath', undefined),

    // Settings with defaults from package.json.
    // All fallbacks (extension, webview, generator) route through the shared
    // `DEFAULT_INCREMENTAL_STRATEGY` constant so the default can be changed
    // in one place. The `default` in `package.json` must be updated in
    // tandem since VS Code's settings schema cannot reference TS constants.
    materializationDefaultIncrementalStrategy: config.get(
      'materialization.defaultIncrementalStrategy',
      DEFAULT_INCREMENTAL_STRATEGY,
    ),
    airflowGenerateDags: config.get('airflowGenerateDags', false),
    columnLineageAutoRefresh: config.get('columnLineage.autoRefresh', true),
    dataExplorerAutoRefresh: config.get('dataExplorer.autoRefresh', false),
    logLevel: config.get('logLevel', 'info'),
    autoGenerateTests: config.get('autoGenerateTests', {
      enabled: false,
      tests: {
        equalRowCount: {
          enabled: false,
          applyTo: ['left'],
          targetFolders: [],
        },
        equalOrLowerRowCount: {
          enabled: false,
          applyTo: [],
          targetFolders: [],
        },
      },
    }),
  };
}

/**
 * Get configured dbt project names from VS Code settings
 * @returns Array of project names or null if none configured
 */
export function getConfigDbtProjectNames(): string[] | null {
  const { dbtProjectNames } = getDjConfig();

  if (Array.isArray(dbtProjectNames) && dbtProjectNames.length > 0) {
    return dbtProjectNames;
  }

  return null;
}

/**
 * Get dynamic exclude paths for dbt_project.yml file searches, including configured Python venv path
 * @returns Glob pattern string for excluding paths
 */
export function getDbtProjectExcludePaths(): string {
  const excludePatterns = [...FRAMEWORK_JSON_SYNC_EXCLUDE_PATHS];

  const { pythonVenvPath } = getDjConfig();

  // Add custom venv path if configured
  if (pythonVenvPath) {
    // Remove leading/trailing slashes and ensure proper glob pattern
    const cleanPath = pythonVenvPath.replace(/^\/+|\/+$/g, '');
    if (cleanPath) {
      // Add both relative and absolute path patterns
      excludePatterns.push(`**/${cleanPath}/**`);
      if (!cleanPath.includes('*')) {
        excludePatterns.push(`${cleanPath}/**`);
      }
    }
  }

  return `{${excludePatterns.join(',')}}`;
}

/**
 * Check if a project name is allowed based on current configuration
 * @param projectName The name of the dbt project to check
 * @returns true if the project name is configured or no dbt project names are set, false otherwise
 */
export function isDbtProjectNameConfigured(projectName: string): boolean {
  const dbtProjectNames = getConfigDbtProjectNames();

  // If no dbt project names are set, all projects are allowed
  if (!dbtProjectNames) {
    return true;
  }

  return dbtProjectNames.includes(projectName);
}

/**
 * Setting reload requirement type
 */
export type SettingReloadAction =
  | 'none'
  | 'refresh'
  | 'compile'
  | 'file-switch';

/**
 * Metadata about a setting's reload requirements
 */
export interface SettingReloadRequirement {
  /** Whether this setting requires any action to take effect */
  requiresAction: boolean;
  /** Type of action required */
  action: SettingReloadAction;
  /** VS Code command to run (if applicable) */
  actionCommand?: string;
  /** User-friendly description of when/how setting takes effect */
  description: string;
}

/**
 * Get metadata about when a setting takes effect
 * @param settingKey The setting key (e.g., 'dbtProjectNames', 'pythonVenvPath')
 * @returns Metadata about the setting's reload requirements
 */
export function getSettingReloadRequirement(
  settingKey: string,
): SettingReloadRequirement {
  const requirements: Record<string, SettingReloadRequirement> = {
    // Immediate effect settings
    logLevel: {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect immediately',
    },
    'columnLineage.autoRefresh': {
      requiresAction: false,
      action: 'file-switch',
      description: 'Takes effect on next file switch',
    },
    'dataExplorer.autoRefresh': {
      requiresAction: false,
      action: 'file-switch',
      description: 'Takes effect on next file switch',
    },

    // Next command execution settings
    pythonVenvPath: {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect on next dbt/Python command',
    },
    trinoPath: {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect on next Trino query',
    },
    lightdashProjectPath: {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect on next Lightdash preview command',
    },
    lightdashProfilesPath: {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect on next Lightdash preview command',
    },

    // Requires project refresh settings
    dbtProjectNames: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    airflowGenerateDags: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    airflowTargetVersion: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    airflowDagsPath: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    dbtMacroPath: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    codingAgent: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },
    dbtGenericTestsPath: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        "Requires 'DJ: Refresh Projects' command or workspace reload",
    },

    // Requires compile settings
    'materialization.defaultIncrementalStrategy': {
      requiresAction: true,
      action: 'compile',
      actionCommand: 'dj.command.jsonSync',
      description: "Requires 'DJ: Sync to SQL and YML' to take effect",
    },
    aiHintTag: {
      requiresAction: true,
      action: 'compile',
      actionCommand: 'dj.command.jsonSync',
      description: "Requires 'DJ: Sync to SQL and YML' to take effect",
    },

    // Complex settings
    autoGenerateTests: {
      requiresAction: true,
      action: 'refresh',
      actionCommand: 'dj.command.refreshProjects',
      description:
        'For new models: immediate. For existing models in targetFolders: requires workspace reload',
    },
  };

  return (
    requirements[settingKey] ?? {
      requiresAction: false,
      action: 'none',
      description: 'Takes effect based on setting usage',
    }
  );
}

/**
 * Validation result for a setting
 */
export interface SettingValidationResult {
  valid: boolean;
  message?: string;
  severity?: 'error' | 'warning' | 'info';
}

/**
 * Validate pythonVenvPath setting
 * @param venvPath The python venv path to validate
 * @returns Validation result
 */
export function validatePythonVenvPath(
  venvPath: string | undefined,
): SettingValidationResult {
  if (!venvPath) {
    return { valid: true }; // Optional setting
  }

  try {
    // Handle both relative and absolute paths
    const absPath = path.isAbsolute(venvPath)
      ? venvPath
      : path.join(WORKSPACE_ROOT, venvPath);

    // Check if directory exists
    if (!fs.existsSync(absPath)) {
      return {
        valid: false,
        severity: 'warning',
        message: `Python venv directory does not exist: ${venvPath}`,
      };
    }

    // Check if it's a valid venv (has bin/activate)
    const activatePath = path.join(absPath, 'bin', 'activate');
    if (!fs.existsSync(activatePath)) {
      return {
        valid: false,
        severity: 'warning',
        message: `Not a valid Python virtual environment (missing bin/activate): ${venvPath}`,
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      severity: 'error',
      message: `Error validating Python venv path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate trinoPath setting
 * Supports command names (trino, trino-cli), full paths, and directory paths
 * @param trinoPath The Trino CLI path, command name, or directory to validate
 * @returns Validation result
 */
export function validateTrinoPath(
  trinoPath: string | undefined,
): SettingValidationResult {
  if (!trinoPath) {
    return { valid: true }; // Optional setting, will look in PATH
  }

  try {
    // Check if it's a command name (no path separators) vs a file path
    const isCommandName = !trinoPath.includes('/') && !trinoPath.includes('\\');

    if (isCommandName) {
      // It's a command name like 'trino' or 'trino-cli' - assume it's in PATH
      // We can't validate it exists without executing 'which' or 'where', so just accept it
      return {
        valid: true,
        message: `Trino CLI command '${trinoPath}' will be resolved from PATH. Use "DJ: Test Trino Connection" to verify it works.`,
        severity: 'info',
      };
    }

    // It's a file path (relative or absolute) - validate it exists
    const absPath = path.isAbsolute(trinoPath)
      ? trinoPath
      : path.join(WORKSPACE_ROOT, trinoPath);

    // Check if path exists
    if (!fs.existsSync(absPath)) {
      return {
        valid: false,
        severity: 'warning',
        message: `Trino CLI path not found: ${trinoPath}`,
      };
    }

    const stats = fs.statSync(absPath);

    // If it's a directory, check for trino-cli or trino inside it
    if (stats.isDirectory()) {
      const trinoCliPath = path.join(absPath, 'trino-cli');
      const trinoPath2 = path.join(absPath, 'trino');

      const hasTrinoCli = fs.existsSync(trinoCliPath);
      const hasTrino = fs.existsSync(trinoPath2);

      if (!hasTrinoCli && !hasTrino) {
        return {
          valid: false,
          severity: 'warning',
          message: `Directory ${trinoPath} does not contain 'trino-cli' or 'trino' executable`,
        };
      }

      const foundExecutable = hasTrinoCli ? 'trino-cli' : 'trino';
      return {
        valid: true,
        message: `Found '${foundExecutable}' in directory. Use "DJ: Test Trino Connection" to verify it works.`,
        severity: 'info',
      };
    }

    // It's a file - check if it's executable (on Unix-like systems)
    if (process.platform !== 'win32') {
      try {
        fs.accessSync(absPath, fs.constants.X_OK);
      } catch {
        return {
          valid: false,
          severity: 'warning',
          message: `Trino CLI is not executable: ${trinoPath}. Run: chmod +x ${trinoPath}`,
        };
      }
    }

    return {
      valid: true,
      message:
        'Trino CLI path updated. Use "DJ: Test Trino Connection" to verify it works.',
      severity: 'info',
    };
  } catch (error: unknown) {
    return {
      valid: false,
      severity: 'error',
      message: `Error validating Trino path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate dbtProjectNames setting
 * @param projectNames The project names to validate
 * @param availableProjects Available project names in workspace
 * @returns Validation result
 */
export function validateDbtProjectNames(
  projectNames: string[] | undefined,
  availableProjects: string[],
): SettingValidationResult {
  if (!projectNames || projectNames.length === 0) {
    return { valid: true }; // Empty means all projects allowed
  }

  // Check if any configured project names match available projects
  const matchingProjects = projectNames.filter((name) =>
    availableProjects.includes(name),
  );

  if (matchingProjects.length === 0 && availableProjects.length > 0) {
    return {
      valid: false,
      severity: 'warning',
      message: `No matching dbt projects found. Configured: [${projectNames.join(', ')}]. Available: [${availableProjects.join(', ')}]`,
    };
  }

  if (matchingProjects.length < projectNames.length) {
    const missing = projectNames.filter(
      (name) => !availableProjects.includes(name),
    );
    return {
      valid: true,
      severity: 'info',
      message: `Some configured projects not found: [${missing.join(', ')}]`,
    };
  }

  return { valid: true };
}

/**
 * Validate airflowDagsPath setting
 * @param dagsPath The Airflow DAGs path to validate
 * @returns Validation result
 */
export function validateAirflowDagsPath(
  dagsPath: string | undefined,
): SettingValidationResult {
  if (!dagsPath) {
    return { valid: true }; // Uses default
  }

  try {
    // Should be a relative path
    if (path.isAbsolute(dagsPath)) {
      return {
        valid: false,
        severity: 'warning',
        message: `Airflow DAGs path should be relative to workspace root, not absolute: ${dagsPath}`,
      };
    }

    const absPath = path.join(WORKSPACE_ROOT, dagsPath);
    const parentDir = path.dirname(absPath);

    // Check if parent directory exists
    if (!fs.existsSync(parentDir)) {
      return {
        valid: false,
        severity: 'warning',
        message: `Parent directory does not exist: ${parentDir}. The extension can create it on project refresh.`,
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      severity: 'error',
      message: `Error validating Airflow DAGs path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate dbtMacroPath setting
 * @param macroPath The dbt macro path to validate
 * @returns Validation result
 */
export function validateDbtMacroPath(
  macroPath: string | undefined,
): SettingValidationResult {
  if (!macroPath) {
    return { valid: true }; // Uses default
  }

  try {
    // Should be a relative path
    if (path.isAbsolute(macroPath)) {
      return {
        valid: false,
        severity: 'error',
        message: `dbt macro path should be relative, not absolute: ${macroPath}`,
      };
    }

    // Check for parent directory references
    if (macroPath.includes('..')) {
      return {
        valid: false,
        severity: 'error',
        message: `dbt macro path should not contain parent directory references (..): ${macroPath}`,
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    return {
      valid: false,
      severity: 'error',
      message: `Error validating dbt macro path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Show a notification to the user about a setting change
 * @param settingKey The setting that changed
 * @param requirement The reload requirement for the setting
 */
export async function showSettingChangeNotification(
  settingKey: string,
  requirement: SettingReloadRequirement,
): Promise<void> {
  const settingDisplay = `dj.${settingKey}`;

  if (!requirement.requiresAction) {
    // Settings that don't require action - just show a status message
    if (requirement.action === 'none') {
      void vscode.window.setStatusBarMessage(
        `DJ: ${settingDisplay} updated - ${requirement.description}`,
        3000,
      );
    }
    return;
  }

  // Settings that require action - show notification with action button
  const actionLabel =
    requirement.action === 'refresh'
      ? 'Refresh Projects'
      : requirement.action === 'compile'
        ? 'Regenerate SQL/YML'
        : 'OK';

  const message = `DJ: Setting '${settingDisplay}' changed. ${requirement.description}`;

  const action = await vscode.window.showInformationMessage(
    message,
    actionLabel,
    'Later',
  );

  if (action === actionLabel && requirement.actionCommand) {
    await vscode.commands.executeCommand(requirement.actionCommand);
  }
}

/**
 * Show a validation warning/error to the user
 * @param settingKey The setting that was validated
 * @param result The validation result
 */
export function showValidationMessage(
  settingKey: string,
  result: SettingValidationResult,
): void {
  if (result.valid || !result.message) {
    return;
  }

  const settingDisplay = `dj.${settingKey}`;
  const message = `DJ: ${settingDisplay} - ${result.message}`;

  switch (result.severity) {
    case 'error':
      void vscode.window.showErrorMessage(message);
      break;
    case 'warning':
      void vscode.window.showWarningMessage(message);
      break;
    case 'info':
      void vscode.window.showInformationMessage(message);
      break;
    default:
      void vscode.window.showWarningMessage(message);
  }
}

/**
 * Centralized configuration change handler with validation and notifications
 * Handles ALL settings in one place - validates, notifies, and offers actions
 * @param context VS Code extension context
 * @param availableProjects Optional list of available dbt projects for validation
 */
export function registerConfigurationChangeHandler(
  context: vscode.ExtensionContext,
  availableProjects: () => string[] = () => [],
): void {
  // Settings that require project refresh
  const projectLevelSettings = [
    'dbtProjectNames',
    'airflowGenerateDags',
    'airflowTargetVersion',
    'airflowDagsPath',
    'dbtMacroPath',
    'codingAgent',
    'dbtGenericTestsPath',
    'autoGenerateTests',
  ];

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      // Track which project-level settings changed (for batch notification)
      const changedProjectSettings = projectLevelSettings.filter((setting) =>
        event.affectsConfiguration(`dj.${setting}`),
      );

      // pythonVenvPath - validate and notify
      if (event.affectsConfiguration('dj.pythonVenvPath')) {
        const config = getDjConfig();
        const validation = validatePythonVenvPath(config.pythonVenvPath);

        if (!validation.valid) {
          showValidationMessage('pythonVenvPath', validation);
        } else {
          void vscode.window.setStatusBarMessage(
            'DJ: Python venv path updated - will be used on next command',
            3000,
          );
        }
      }

      // trinoPath - validate and offer to test connection
      if (event.affectsConfiguration('dj.trinoPath')) {
        const config = getDjConfig();
        const validation = validateTrinoPath(config.trinoPath);

        if (!validation.valid) {
          showValidationMessage('trinoPath', validation);
        } else if (config.trinoPath) {
          // Offer to test the connection
          const action = await vscode.window.showInformationMessage(
            'Trino CLI path updated. Would you like to test the connection?',
            'Test Connection',
            'Skip',
          );

          if (action === 'Test Connection') {
            await vscode.commands.executeCommand(
              COMMAND_ID.TEST_TRINO_CONNECTION,
            );
          }
        } else {
          // No trinoPath set - will use default from PATH
          void vscode.window.setStatusBarMessage(
            'DJ: Trino CLI path cleared - will use default from PATH',
            3000,
          );
        }
      }

      // dbtProjectNames - validate (no separate notification, handled below with project settings)
      if (event.affectsConfiguration('dj.dbtProjectNames')) {
        const config = getDjConfig();
        const validation = validateDbtProjectNames(
          config.dbtProjectNames,
          availableProjects(),
        );

        if (!validation.valid || validation.message) {
          showValidationMessage('dbtProjectNames', validation);
        }
      }

      // airflowDagsPath - validate (no separate notification, handled below with project settings)
      if (event.affectsConfiguration('dj.airflowDagsPath')) {
        const config = getDjConfig();
        const validation = validateAirflowDagsPath(config.airflowDagsPath);

        if (!validation.valid) {
          showValidationMessage('airflowDagsPath', validation);
        }
      }

      // dbtMacroPath - validate (no separate notification, handled below with project settings)
      if (event.affectsConfiguration('dj.dbtMacroPath')) {
        const config = getDjConfig();
        const validation = validateDbtMacroPath(config.dbtMacroPath);

        if (!validation.valid) {
          showValidationMessage('dbtMacroPath', validation);
        }
      }

      // materialization.defaultIncrementalStrategy - notify about compile requirement
      if (
        event.affectsConfiguration(
          'dj.materialization.defaultIncrementalStrategy',
        )
      ) {
        void vscode.window.setStatusBarMessage(
          "DJ: Default incremental strategy updated - run 'DJ: Sync to SQL and YML' to apply",
          5000,
        );
      }

      // aiHintTag - notify about compile requirement
      if (event.affectsConfiguration('dj.aiHintTag')) {
        void vscode.window.setStatusBarMessage(
          "DJ: AI Hint tag updated - run 'DJ: Sync to SQL and YML' to apply",
          5000,
        );
      }

      // Lightdash paths - simple notifications
      if (event.affectsConfiguration('dj.lightdashProjectPath')) {
        void vscode.window.setStatusBarMessage(
          'DJ: Lightdash project path updated - will be used on next preview',
          3000,
        );
      }

      if (event.affectsConfiguration('dj.lightdashProfilesPath')) {
        void vscode.window.setStatusBarMessage(
          'DJ: Lightdash profiles path updated - will be used on next preview',
          3000,
        );
      }

      // UNIFIED: Handle project-level settings with ONE notification
      if (changedProjectSettings.length > 0) {
        const settingsDisplay = changedProjectSettings
          .map((s) => `dj.${s}`)
          .join(', ');
        const message =
          changedProjectSettings.length === 1
            ? `Setting '${settingsDisplay}' changed. Would you like to refresh projects now?`
            : `Settings changed: ${settingsDisplay}. Would you like to refresh projects now?`;

        const action = await vscode.window.showInformationMessage(
          message,
          'Refresh Projects',
          'Later',
        );

        if (action === 'Refresh Projects') {
          await vscode.commands.executeCommand('dj.command.refreshProjects');
        }
      }
    }),
  );
}
