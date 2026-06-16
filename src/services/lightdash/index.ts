import { getDjConfig } from '@services/config';
import type { Dbt } from '@services/dbt';
import type { DJLogger } from '@services/djLogger';
import type { ApiEnabledService } from '@services/types';
import { buildProcessEnv } from '@services/utils/process';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';

/**
 * Generic API callback type for routing messages.
 * Uses `unknown` for payload to avoid complex overload type issues.
 */
type ApiCallback = (payload: unknown) => Promise<ApiResponse>;
import { COMMAND_ID, VIEW_ID } from '@services/constants';
import { ensureLightdashPathInGitignore } from '@services/lightdash/content';
import {
  deleteYamlFiles,
  executeLightdashDownload,
  executeLightdashUpload,
  getDashboardsAsCodeAbsolutePath,
  getDashboardsAsCodeRelativePath,
  isYamlExtensionInstalled,
  listLightdashFiles,
  openYamlInEditor,
  promptInstallYamlExtension,
  readYamlFile,
  syncYamlSchemasSetting,
} from '@services/lightdash/dashboardsAsCode';
import { getHtml } from '@services/webview/utils';
import {
  describeLightdashRestriction,
  resolveLightdashUploadRestriction,
} from '@shared/lightdash/restrictions';
import type {
  LightdashModel,
  LightdashPreview,
  LightdashYamlLog,
} from '@shared/lightdash/types';
import type { TreeItem } from 'admin';
import { ThemeIcon, WORKSPACE_ROOT } from 'admin';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class Lightdash implements ApiEnabledService<'lightdash'> {
  readonly treeItemLightdashPreview: TreeItem = {
    command: {
      command: COMMAND_ID.LIGHTDASH_PREVIEW,
      title: 'Lightdash Preview',
    },
    iconPath: new ThemeIcon('lightbulb-sparkle'),
    label: 'Lightdash Preview',
  };

  readonly treeItemLightdashDashboardsAsCode: TreeItem = {
    command: {
      command: COMMAND_ID.LIGHTDASH_DASHBOARDS_AS_CODE,
      title: 'Lightdash Dashboards as Code',
    },
    iconPath: new ThemeIcon('file-code'),
    label: 'Lightdash Dashboards as Code',
  };

  private currentWebviewPanel?: vscode.WebviewPanel;
  private dashboardsAsCodePanel?: vscode.WebviewPanel;

  constructor(
    private readonly dbt: Dbt,
    private readonly log: DJLogger,
    /**
     * Handler for routing API calls through the main Api router.
     * This breaks the circular dependency - Lightdash doesn't need Api instance.
     */
    private readonly apiCallback: ApiCallback,
  ) {}

  /**
   * Handle API requests for Lightdash-related operations.
   * Manages preview creation, deletion, model fetching, and logging.
   */
  async handleApi(payload: ApiPayload<'lightdash'>): Promise<ApiResponse> {
    switch (payload.type) {
      case 'lightdash-fetch-models': {
        try {
          this.log.info('Fetching models...');
          const models = this.fetchModels();
          this.log.info(`Loaded ${models.length} models`, models);
          return apiResponse<typeof payload.type>(models);
        } catch (error: unknown) {
          this.log.error('Error fetching models:', error);
          return apiResponse<typeof payload.type>([]);
        }
      }
      case 'lightdash-start-preview': {
        try {
          const { previewName, selectedModels } = payload.request;
          const { projectDir, profilesDir } = await this.getDbtProjectPaths();

          const previewUrl = await this.executeAndCaptureUrl(
            {
              previewName,
              projectDir,
              profilesDir,
              selectedModels,
            },
            this.currentWebviewPanel,
          );

          // Save preview to storage
          this.savePreview({
            name: previewName,
            url: previewUrl,
            createdAt: new Date().toISOString(),
            models: selectedModels,
            status: 'active',
          });

          // Send success log to webview
          if (this.currentWebviewPanel) {
            this.currentWebviewPanel.webview.postMessage({
              type: 'log',
              log: {
                level: 'success',
                message: `Step 5/5: Preview URL - ${previewUrl}`,
                timestamp: new Date().toISOString(),
                isProgress: true,
                isPreviewSuccess: true,
              },
            });
          }

          return apiResponse<typeof payload.type>({
            success: true,
            url: previewUrl,
          });
        } catch (error: unknown) {
          let errorMessage = '';

          if (error instanceof Error) {
            // dbt not found
            if (
              error.message.includes('Failed to get dbt --version') ||
              error.message.includes('spawn dbt ENOENT')
            ) {
              const { pythonVenvPath } = getDjConfig();

              errorMessage =
                'dbt command not found. ' +
                (pythonVenvPath
                  ? `Using Python venv: '${pythonVenvPath}'. `
                  : 'If dbt is in a Python virtual environment, configure "dj.pythonVenvPath" in VS Code settings. ') +
                '\n\nSee https://docs.getdbt.com/docs/core/installation for installation instructions';

              vscode.window.showErrorMessage(errorMessage);
            } else {
              // Missing dbt projects, User cancelled project selection, etc.
              errorMessage = error.message;
            }
          } else {
            errorMessage = 'Unknown error';
          }

          this.log.error('Error starting preview:', error);

          // Send error to webview if available
          if (this.currentWebviewPanel) {
            this.currentWebviewPanel.webview.postMessage({
              type: 'log',
              log: {
                level: 'error',
                message: `✖ Error: ${errorMessage}`,
                timestamp: new Date().toISOString(),
              },
            });
          }

          return apiResponse<typeof payload.type>({
            success: false,
            error: errorMessage,
          });
        }
      }
      case 'lightdash-stop-preview': {
        try {
          const { previewName } = payload.request;
          await this.stopPreview(previewName);
          this.deletePreview(previewName);
          return apiResponse<typeof payload.type>({ success: true });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.log.error('Error stopping preview:', error);
          return apiResponse<typeof payload.type>({
            success: false,
            error: errorMessage,
          });
        }
      }
      case 'lightdash-fetch-previews': {
        try {
          this.log.info('Fetching previews...');
          const previews = this.loadPreviews();
          this.log.info(`Loaded ${previews.length} previews`, previews);
          return apiResponse<typeof payload.type>(previews);
        } catch (error: unknown) {
          this.log.error('Error fetching previews:', error);
          return apiResponse<typeof payload.type>([]);
        }
      }
      case 'lightdash-get-preview-name': {
        const defaultPreviewName =
          process.env.LIGHTDASH_PREVIEW_NAME || 'DJ Preview';
        return apiResponse<typeof payload.type>(defaultPreviewName);
      }
      case 'lightdash-add-log': {
        // This is handled via webview postMessage
        return apiResponse<typeof payload.type>({ success: true });
      }
      case 'lightdash-yaml-list-files': {
        try {
          const requestedPath = payload.request.path?.trim();
          const absolutePath = requestedPath
            ? path.isAbsolute(requestedPath)
              ? requestedPath
              : path.join(WORKSPACE_ROOT, requestedPath)
            : getDashboardsAsCodeAbsolutePath();
          const relPath = path
            .relative(WORKSPACE_ROOT, absolutePath)
            .split(path.sep)
            .join('/');
          const tree = listLightdashFiles(absolutePath);
          return apiResponse<typeof payload.type>({
            success: true,
            path: relPath || getDashboardsAsCodeRelativePath(),
            absolutePath,
            tree,
          });
        } catch (err: unknown) {
          this.log.error('Error listing Lightdash YAML files:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-read-file': {
        try {
          const { content, absolutePath } = readYamlFile(payload.request.path);
          return apiResponse<typeof payload.type>({
            success: true,
            content,
            absolutePath,
          });
        } catch (err: unknown) {
          this.log.error('Error reading Lightdash YAML file:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-edit-file': {
        try {
          await openYamlInEditor(payload.request.path);
          return apiResponse<typeof payload.type>({ success: true });
        } catch (err: unknown) {
          this.log.error('Error opening Lightdash YAML file:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-download': {
        // Logs are streamed live to the webview via `lightdash-yaml-log`
        // window messages; the API response intentionally omits them so
        // the output panel doesn't get a duplicate replay.
        const onLog = (log: LightdashYamlLog) => {
          this.dashboardsAsCodePanel?.webview.postMessage({
            type: 'lightdash-yaml-log',
            log,
          });
        };
        try {
          const result = await executeLightdashDownload(
            payload.request,
            this.log,
            onLog,
          );
          // After every successful download, refresh the yaml.schemas binding
          // so the JSON schema autocomplete keeps tracking the configured path
          // (no-op if `path` matches the default and bindings exist).
          if (result.success) {
            await syncYamlSchemasSetting(this.log);
          }
          return apiResponse<typeof payload.type>({
            success: result.success,
            tree: result.tree,
            absolutePath: result.absolutePath,
            error: result.error,
          });
        } catch (err: unknown) {
          this.log.error('Error executing lightdash download:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-upload': {
        const onLog = (log: LightdashYamlLog) => {
          this.dashboardsAsCodePanel?.webview.postMessage({
            type: 'lightdash-yaml-log',
            log,
          });
        };
        try {
          const result = await executeLightdashUpload(
            payload.request,
            this.log,
            onLog,
          );
          return apiResponse<typeof payload.type>({
            success: result.success,
            uploadedFiles: result.uploadedFiles,
            error: result.error,
            restriction: result.restriction,
          });
        } catch (err: unknown) {
          this.log.error('Error executing lightdash upload:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-check-upload-policy': {
        const project = payload.request.project.trim();
        const status = resolveLightdashUploadRestriction(
          project,
          getDjConfig().lightdashRestrictedProjects ?? [],
        );
        if (status.status === 'allow') {
          return apiResponse<typeof payload.type>(status);
        }
        return apiResponse<typeof payload.type>({
          ...status,
          message: describeLightdashRestriction(status),
        });
      }
      case 'lightdash-yaml-delete-files': {
        try {
          deleteYamlFiles(payload.request.paths);
          return apiResponse<typeof payload.type>({ success: true });
        } catch (err: unknown) {
          this.log.error('Error deleting Lightdash YAML files:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-get-default-path': {
        return apiResponse<typeof payload.type>({
          path: getDashboardsAsCodeRelativePath(),
          absolutePath: getDashboardsAsCodeAbsolutePath(),
        });
      }
      case 'lightdash-yaml-get-download-defaults': {
        return apiResponse<typeof payload.type>({
          addPathToGitignore:
            getDjConfig().lightdashDefaultAddPathToGitignore ?? true,
        });
      }
      case 'lightdash-yaml-set-default-path': {
        try {
          const newPath = payload.request.path.trim();
          await vscode.workspace
            .getConfiguration('dj')
            .update(
              'lightdash.dashboardsAsCodePath',
              newPath || undefined,
              vscode.ConfigurationTarget.Workspace,
            );
          // Refresh the yaml.schemas binding so autocomplete tracks the
          // new path immediately.
          await syncYamlSchemasSetting(this.log);
          return apiResponse<typeof payload.type>({
            success: true,
            absolutePath: getDashboardsAsCodeAbsolutePath(),
          });
        } catch (err: unknown) {
          this.log.error('Error updating dashboardsAsCodePath setting:', err);
          return apiResponse<typeof payload.type>({
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      case 'lightdash-yaml-ensure-gitignore': {
        const onLog = (level: LightdashYamlLog['level'], message: string) => {
          this.dashboardsAsCodePanel?.webview.postMessage({
            type: 'lightdash-yaml-log',
            log: {
              level,
              message,
              timestamp: new Date().toISOString(),
            },
          });
        };
        try {
          const result = ensureLightdashPathInGitignore(payload.request.path);
          if (result.alreadyPresent) {
            onLog(
              'info',
              `"${payload.request.path}" already in .gitignore - skipped.`,
            );
          } else if (result.added) {
            onLog('success', `Added "${payload.request.path}" to .gitignore.`);
          }
          return apiResponse<typeof payload.type>({
            success: true,
            added: result.added,
            alreadyPresent: result.alreadyPresent,
            gitignorePath: result.gitignorePath,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.log.error('Error updating .gitignore:', err);
          onLog('error', `Failed to update .gitignore: ${message}`);
          return apiResponse<typeof payload.type>({
            success: false,
            error: message,
          });
        }
      }
      default: {
        // TypeScript exhaustiveness check
        const _exhaustiveCheck: never = payload;
        return _exhaustiveCheck;
      }
    }
  }

  /**
   * Get the path to previews.json storage file
   */
  private getPreviewsFilePath(): string {
    const djDir = path.join(WORKSPACE_ROOT, '.dj', 'lightdash');
    return path.join(djDir, 'previews.json');
  }

  /**
   * Ensure the .dj/lightdash directory exists
   */
  private ensurePreviewsDirectory(): void {
    const djDir = path.join(WORKSPACE_ROOT, '.dj', 'lightdash');
    if (!fs.existsSync(djDir)) {
      fs.mkdirSync(djDir, { recursive: true });
    }
  }

  /**
   * Load all previews from storage
   */
  private loadPreviews(): LightdashPreview[] {
    const filePath = this.getPreviewsFilePath();
    this.log.info(`Looking for previews file at: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      this.log.info('Previews file does not exist yet');
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const previews = data.previews ?? [];
      this.log.info(`Loaded ${previews.length} previews from file`);
      return previews;
    } catch (error: unknown) {
      this.log.error('Error loading previews:', error);
      return [];
    }
  }

  /**
   * Save a preview to storage
   */
  private savePreview(preview: LightdashPreview): void {
    this.ensurePreviewsDirectory();
    const filePath = this.getPreviewsFilePath();
    const previews = this.loadPreviews();

    // Check if preview with same name exists and update it
    const existingIndex = previews.findIndex((p) => p.name === preview.name);
    if (existingIndex >= 0) {
      previews[existingIndex] = preview;
    } else {
      previews.push(preview);
    }

    const data = { previews };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Delete a preview from storage
   */
  private deletePreview(previewName: string): void {
    const filePath = this.getPreviewsFilePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    const previews = this.loadPreviews();
    const filteredPreviews = previews.filter((p) => p.name !== previewName);

    const data = { previews: filteredPreviews };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Fetch all models that start with mart_ from dbt service
   */
  private fetchModels(): LightdashModel[] {
    try {
      const models: LightdashModel[] = [];

      // Check if dbt models are available
      const dbtModelsCount = this.dbt.models.size;
      this.log.info(`Total dbt models available: ${dbtModelsCount}`);

      if (dbtModelsCount === 0) {
        this.log.warn(
          'No dbt models found. The dbt project may not be parsed yet.',
        );
        return [];
      }

      // Access dbt models directly from the dbt service
      for (const model of this.dbt.models.values()) {
        if (
          model.name.startsWith('mart_') ||
          model.config?.tags?.includes('lightdash-explore')
        ) {
          models.push({
            name: model.name,
            tags: model.tags ?? model.config?.tags ?? [],
            description: model.description || '',
          });
        }
      }

      this.log.info(`Filtered to ${models.length} mart models`);
      return models.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: unknown) {
      this.log.error('Error fetching models from dbt service:', error);
      return [];
    }
  }

  /**
   * Stop a preview using lightdash CLI
   */
  private async stopPreview(previewName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['stop-preview', '--name', previewName];

      // Build environment with Python venv support and CI mode
      const env = buildProcessEnv({ CI: 'true' });

      this.log.info(`Executing: lightdash ${args.join(' ')}`);

      const childProcess = spawn('lightdash', args, {
        cwd: WORKSPACE_ROOT,
        env,
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          this.log.info(`Preview ${previewName} stopped successfully`);
          resolve();
        } else {
          this.log.error(`Failed to stop preview: ${errorOutput || output}`);
          reject(new Error(`Failed to stop preview: ${errorOutput || output}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(new Error(`Failed to execute stop-preview: ${error.message}`));
      });
    });
  }

  /**
   * Execute the lightdash command and capture the URL
   * @param previewName - The name of the preview
   * @param projectDir - The directory of the project
   * @param profilesDir - The directory of the profiles
   * @param selectedModels - Optional array of selected models
   * @param webviewPanel - Optional webview panel for streaming logs
   * @returns The URL of the preview or an error message
   */
  private async executeAndCaptureUrl(
    {
      previewName,
      projectDir,
      profilesDir,
      selectedModels,
    }: {
      previewName: string;
      projectDir: string;
      profilesDir: string;
      selectedModels?: string[];
    },
    webviewPanel?: vscode.WebviewPanel,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        'start-preview',
        '--name',
        previewName,
        '--profiles-dir',
        profilesDir,
        '--project-dir',
        projectDir,
      ];

      // Add model selection
      if (selectedModels && selectedModels.length > 0) {
        args.push('-s', ...selectedModels);
      } else {
        args.push('-s', 'tag:lightdash tag:lightdash-explore');
      }

      args.push('--skip-warehouse-catalog'); // Skip caching, force re-read from profile
      args.push('--verbose');

      // Build environment with Python venv support and CI mode
      // Override Trino host for Docker environments when LIGHTDASH_TRINO_HOST is set
      // (the host should be the container name instead of localhost for Docker networking)
      const additionalEnv: Record<string, string> = { CI: 'true' };
      if (process.env.LIGHTDASH_TRINO_HOST) {
        additionalEnv.DBT_HOST = process.env.LIGHTDASH_TRINO_HOST;
        this.log.info(
          `Overriding Trino host: ${process.env.LIGHTDASH_TRINO_HOST}`,
        );
      }
      const env = buildProcessEnv(additionalEnv);

      this.log.info(`Executing: lightdash ${args.join(' ')}`);

      // Execute lightdash command
      const childProcess = spawn('lightdash', args, {
        cwd: WORKSPACE_ROOT,
        env,
      });

      let output = '';
      let errorOutput = '';
      let lastProgressMessage = '';

      // Collect stdout output
      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
      });

      // Collect stderr output and update progress
      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;

        // Send logs and progress to webview
        if (webviewPanel) {
          let level: 'info' | 'success' | 'error' | 'warning' = 'info';
          let progressMessage: string | undefined;

          // Determine log level based on content
          if (text.includes('✔') || text.includes('SUCCESS>')) {
            level = 'success';
          } else if (text.includes('Error') || text.includes('Failed')) {
            level = 'error';
          } else if (text.includes('Warning')) {
            level = 'warning';
          }

          // Determine progress step based on actual Lightdash output
          if (text.includes('Copying charts and dashboards')) {
            progressMessage =
              'Step 1/5: Copying charts and dashboards from source';
          } else if (text.includes('Creating new project preview')) {
            progressMessage = 'Step 2/5: Creating preview project';
          } else if (text.includes('Updating project preview')) {
            progressMessage = 'Step 2/5: Updating preview project';
          } else if (
            text.includes('Compiling with project dir') ||
            text.includes('Running: dbt ls')
          ) {
            progressMessage = 'Step 3/5: Compiling dbt models';
          } else if (
            text.includes('Loading dbt manifest') ||
            (text.includes('Validating') && text.includes('models'))
          ) {
            progressMessage = 'Step 4/5: Validating models';
          } else if (text.includes('Converting explores')) {
            progressMessage = 'Step 4/5: Converting models to explores';
          } else if (
            text.includes('Making HTTP PUT request') ||
            (text.includes('Compiled') && text.includes('explores'))
          ) {
            progressMessage = 'Step 5/5: Uploading explores to Lightdash';
          } else if (
            text.includes('New project created on') ||
            text.includes('Project updated on')
          ) {
            progressMessage = 'Step 5/5: Preview ready!';
          }

          // Send log message
          webviewPanel.webview.postMessage({
            type: 'log',
            log: {
              level,
              message: text.trim(),
              timestamp: new Date().toISOString(),
            },
          });

          // Send progress step as a log only if we detected a specific milestone and it's different from last
          if (progressMessage && progressMessage !== lastProgressMessage) {
            webviewPanel.webview.postMessage({
              type: 'log',
              log: {
                level: 'info',
                message: progressMessage,
                timestamp: new Date().toISOString(),
                isProgress: true,
              },
            });
            lastProgressMessage = progressMessage;
          }
        }
      });

      // On completion of lightdash command, handle the result
      childProcess.on('close', (code, signal) => {
        this.log.info(
          `Lightdash command completed with code: ${code}, signal: ${signal}`,
        );

        this.log.info(`Full stdout output: ${output}`);
        this.log.error(`Full stderr output: ${errorOutput}`);

        // Handle process killed by signal (user killed terminal, Ctrl+C, etc.)
        if (signal) {
          reject(
            new Error(`Lightdash command was terminated by signal ${signal}.`),
          );
          return;
        }

        if (code !== 0) {
          reject(
            new Error(
              `Lightdash command failed with code ${code}: ${errorOutput})`,
            ),
          );
          return;
        }

        // If lightdash command completes successfully, look for preview URL in complete output
        // Check both stdout and stderr since Lightdash may write to either
        const combinedOutput = output + '\n' + errorOutput;
        this.log.info(`Searching for URL in combined output`);

        const urlMatch = combinedOutput.match(
          /(Project updated on|New project created on)\s+(https?:\/\/[^\s]+\/projects\/[^\s]+)/i,
        );
        if (urlMatch) {
          const previewUrl = urlMatch[2].trim();
          this.log.info(`Found preview URL: ${previewUrl}`);
          resolve(previewUrl);
          return;
        }

        // No URL found in complete output
        const errorMsg =
          'No preview URL found in complete output. Please check the Lightdash logs for more details.';
        reject(new Error(errorMsg));
      });

      // If lightdash fails to start
      childProcess.on('error', (error) => {
        reject(new Error(`Failed to start Lightdash: ${error.message}`));
      });

      // Timeout after 2 minutes if lightdash takes too long
      setTimeout(() => {
        childProcess.kill();
        reject(new Error('Lightdash command timed out after 2 minutes.'));
      }, 120000);
    });
  }

  private async getDbtProjectPaths(): Promise<{
    projectDir: string;
    profilesDir: string;
  }> {
    const config = getDjConfig();

    // Check for custom configuration override for project path
    if (config.lightdashProjectPath) {
      const projectDir = `${WORKSPACE_ROOT}/${config.lightdashProjectPath}`;
      // Use configured profiles path, otherwise fallback to workspace root
      const profilesDir = config.lightdashProfilesPath
        ? `${WORKSPACE_ROOT}/${config.lightdashProfilesPath}`
        : WORKSPACE_ROOT;

      return { projectDir, profilesDir };
    }

    // Auto-detect from available dbt projects
    const dbtProjects = Array.from(this.dbt.projects.values());

    if (dbtProjects.length === 0) {
      throw new Error(
        'No dbt projects found in workspace. Please ensure your workspace contains a dbt_project.yml file or configure a custom path using "dj.lightdashProjectPath".',
      );
    }

    if (dbtProjects.length === 1) {
      return {
        projectDir: dbtProjects[0].pathSystem,
        profilesDir: WORKSPACE_ROOT,
      };
    }

    // Multiple projects - show picker
    const projectItems = dbtProjects.map((project) => ({
      label: project.name,
      description: project.pathRelative,
      project: project,
    }));

    const selected = await vscode.window.showQuickPick(projectItems, {
      placeHolder: 'Select dbt project for Lightdash preview',
      title: 'Multiple dbt projects found',
    });

    if (!selected) {
      throw new Error('Lightdash preview cancelled: No project selected');
    }

    this.log.info(`Selected dbt project: ${selected.project.name}`);
    return {
      projectDir: selected.project.pathSystem,
      profilesDir: WORKSPACE_ROOT,
    };
  }

  activate(context: vscode.ExtensionContext): void {
    this.registerCommands(context);

    // Sync schemas on activation. No-ops silently if the YAML extension
    // isn't installed yet.
    void syncYamlSchemasSetting(this.log);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('dj.lightdash.dashboardsAsCodePath')) {
          await syncYamlSchemasSetting(this.log);
        }
      }),
    );

    // Auto-sync schemas if the user installs the YAML extension later.
    context.subscriptions.push(
      vscode.extensions.onDidChange(() => {
        if (isYamlExtensionInstalled()) {
          void syncYamlSchemasSetting(this.log);
        }
      }),
    );
  }

  /**
   * Register Lightdash-specific commands - Lightdash Preview
   * @param context
   */
  registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.LIGHTDASH_PREVIEW, () => {
        try {
          this.log.info('Lightdash Preview command triggered');

          // Create or show webview panel
          if (this.currentWebviewPanel) {
            this.log.info('Webview panel already exists, revealing it');
            this.currentWebviewPanel.reveal(vscode.ViewColumn.One);
            return;
          }

          this.log.info('Creating new webview panel');
          const panel = vscode.window.createWebviewPanel(
            VIEW_ID.LIGHTDASH_PREVIEW_MANAGER,
            'Lightdash Preview Manager',
            vscode.ViewColumn.One,
            {
              enableScripts: true,
              retainContextWhenHidden: true,
            },
          );

          this.currentWebviewPanel = panel;
          this.log.info('Webview panel created successfully');

          panel.onDidDispose(() => {
            this.currentWebviewPanel = undefined;
          });

          const html = getHtml({
            extensionUri: context.extensionUri,
            route: '/lightdash/preview-manager',
            webview: panel.webview,
          });
          panel.webview.html = html;

          // Handle webview messages
          panel.webview.onDidReceiveMessage(
            async (message: any) => {
              this.log.info('Received webview message:', message.type);

              // Handle copy to clipboard
              if (message.type === 'copy-to-clipboard') {
                await vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage(
                  'Link copied to clipboard',
                );
                return;
              }

              // Check if it's an API call (the message IS the API payload with _channelId)
              if (message._channelId) {
                try {
                  this.log.info('Processing API call:', message.type);

                  // Extract the API payload (remove _channelId)
                  const { _channelId, ...payload } = message;

                  const response = await this.apiCallback(payload);
                  this.log.info('API call successful, sending response');
                  panel.webview.postMessage({
                    _channelId,
                    response,
                  });
                } catch (error: unknown) {
                  // Enhanced error logging
                  if (error instanceof Error) {
                    this.log.error('API call error:', error.message);
                    this.log.error('Error stack:', error.stack);
                  } else {
                    this.log.error(
                      'API call error (non-Error):',
                      String(error),
                    );
                  }

                  panel.webview.postMessage({
                    _channelId: message._channelId,
                    error:
                      error instanceof Error ? error.message : 'Unknown error',
                  });
                }
              } else {
                this.log.warn('Unknown message type:', message.type);
              }
            },
            undefined,
            context.subscriptions,
          );
        } catch (err: unknown) {
          this.log.error('ERROR OPENING PREVIEW MANAGER: ', err);
          vscode.window.showErrorMessage(
            'Failed to open Lightdash Preview Manager',
          );
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.LIGHTDASH_DASHBOARDS_AS_CODE,
        () => {
          try {
            this.log.info('Lightdash Dashboards as Code command triggered');

            void promptInstallYamlExtension(context, this.log);

            if (this.dashboardsAsCodePanel) {
              this.dashboardsAsCodePanel.reveal(vscode.ViewColumn.One);
              return;
            }

            const panel = vscode.window.createWebviewPanel(
              VIEW_ID.LIGHTDASH_DASHBOARDS_AS_CODE,
              'Lightdash · Dashboards as Code',
              vscode.ViewColumn.One,
              {
                enableScripts: true,
                retainContextWhenHidden: true,
              },
            );

            this.dashboardsAsCodePanel = panel;

            panel.onDidDispose(() => {
              this.dashboardsAsCodePanel = undefined;
            });

            panel.webview.html = getHtml({
              extensionUri: context.extensionUri,
              route: '/lightdash/dashboards-as-code',
              webview: panel.webview,
            });

            panel.webview.onDidReceiveMessage(
              async (message: any) => {
                if (message.type === 'copy-to-clipboard') {
                  await vscode.env.clipboard.writeText(message.text);
                  vscode.window.showInformationMessage('Copied to clipboard');
                  return;
                }

                if (message._channelId) {
                  try {
                    const { _channelId, ...payload } = message;
                    const response = await this.apiCallback(payload);
                    panel.webview.postMessage({ _channelId, response });
                  } catch (error: unknown) {
                    this.log.error('Dashboards-as-Code API error:', error);
                    panel.webview.postMessage({
                      _channelId: message._channelId,
                      error:
                        error instanceof Error
                          ? error.message
                          : 'Unknown error',
                    });
                  }
                }
              },
              undefined,
              context.subscriptions,
            );
          } catch (err: unknown) {
            this.log.error('ERROR OPENING DASHBOARDS-AS-CODE PANEL: ', err);
            vscode.window.showErrorMessage(
              'Failed to open Lightdash Dashboards as Code',
            );
          }
        },
      ),
    );
  }

  deactivate() {}
}
