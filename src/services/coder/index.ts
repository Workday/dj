import { Api } from '@services/api';
import { classifyWatchedPath } from '@services/coder/classifyWatchedPath';
import type { CoderFileInfo } from '@services/coder/types';
import { ColumnLineageService } from '@services/columnLineage';
import {
  getDbtProjectExcludePaths,
  registerConfigurationChangeHandler,
} from '@services/config';
import { COMMAND_ID, VIEW_ID } from '@services/constants';
import { DataExplorer } from '@services/dataExplorer';
import { Dbt } from '@services/dbt';
import { DJLogger } from '@services/djLogger';
import { Framework } from '@services/framework';
import { FrameworkState } from '@services/framework/FrameworkState';
import {
  frameworkGetModelId,
  frameworkGetModelName,
  frameworkGetSourceId,
  frameworkMakeSourceName,
} from '@services/framework/utils';
import { Lightdash } from '@services/lightdash';
import { LightdashContent } from '@services/lightdash/content';
import { SERVICE_NAMES, ServiceLocator } from '@services/ServiceLocator';
import { StateManager } from '@services/statemanager';
import { Trino } from '@services/trino';
import { type GitAction, gitLastLog } from '@services/utils/git';
import { getVenvEnvironment } from '@services/utils/process';
import { sqlFormat } from '@services/utils/sql';
import type { ApiMessage } from '@shared/api/types';
import type { DbtProject, DbtProjectManifest } from '@shared/dbt/types';
import { getDbtModelId, getDbtProperties } from '@shared/dbt/utils';
import type { WebviewMessage } from '@shared/webview/types';
import { WORKSPACE_ROOT } from 'admin';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class Coder {
  private locator: ServiceLocator;

  // Service references (resolved from locator)
  api: Api;
  columnLineage: ColumnLineageService;
  context: vscode.ExtensionContext;
  dataExplorer: DataExplorer;
  dbt: Dbt; // Added for convenience (same as framework.dbt)
  framework: Framework;
  gitPending: boolean;
  lastFileChange: Date | null;
  lastGitLog: { action: GitAction | null; line: string };
  lightdash: Lightdash;
  lightdashContent: LightdashContent;
  log: DJLogger;
  stateManager: StateManager;
  trino: Trino;
  watcher?: vscode.FileSystemWatcher; // Created later in activateFileWatchers()

  // Watchers for dynamic project/manifest detection
  private projectWatcher?: vscode.FileSystemWatcher;
  private manifestWatcher?: vscode.FileSystemWatcher;
  // Track if full services have been activated (for late initialization)
  private servicesActivated: boolean = false;

  // Debounce timers for model/source sync to coalesce rapid saves and auto-save events
  private pendingModelSyncs: Map<string, NodeJS.Timeout> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.gitPending = false;
    this.lastFileChange = null;

    try {
      // Create service locator
      this.locator = new ServiceLocator();

      // Register core primitives and state
      this.locator.registerInstance(SERVICE_NAMES.ExtensionContext, context);
      const frameworkState = new FrameworkState();
      this.locator.registerInstance(
        SERVICE_NAMES.FrameworkState,
        frameworkState,
      );

      // Register services with lazy factories
      this.locator.register(SERVICE_NAMES.Logger, () => new DJLogger());

      this.locator.register(
        SERVICE_NAMES.StateManager,
        () =>
          new StateManager(
            this.locator.get(SERVICE_NAMES.ExtensionContext),
            this,
          ),
      );

      this.locator.register(
        SERVICE_NAMES.Trino,
        () => new Trino({ coder: this }),
      );

      this.locator.register(
        SERVICE_NAMES.ColumnLineage,
        () => new ColumnLineageService(this),
      );

      this.locator.register(
        SERVICE_NAMES.DataExplorer,
        () => new DataExplorer({ coder: this }),
      );

      this.locator.register(
        SERVICE_NAMES.Dbt,
        () =>
          new Dbt({
            coder: this,
            context: this.locator.get(SERVICE_NAMES.ExtensionContext),
            log: this.locator.get(SERVICE_NAMES.Logger),
            state: this.locator.get(SERVICE_NAMES.FrameworkState),
          }),
      );

      this.locator.register(
        SERVICE_NAMES.Framework,
        () =>
          new Framework({
            // Lazy getter to avoid circular dependency with Api
            getApi: () => this.locator.get(SERVICE_NAMES.Api),
            coder: this,
            dbt: this.locator.get(SERVICE_NAMES.Dbt),
            log: this.locator.get(SERVICE_NAMES.Logger),
            state: this.locator.get(SERVICE_NAMES.FrameworkState),
            stateManager: this.locator.get(SERVICE_NAMES.StateManager),
          }),
      );

      this.locator.register(
        SERVICE_NAMES.Api,
        () =>
          new Api(
            this.locator.get(SERVICE_NAMES.Dbt),
            this.locator.get(SERVICE_NAMES.Framework),
            this.locator.get(SERVICE_NAMES.DataExplorer),
            this.locator.get(SERVICE_NAMES.Trino),
            this.locator.get(SERVICE_NAMES.StateManager),
            // Lazy getter - Lightdash handler is resolved only when needed
            () => (payload) =>
              this.locator
                .get<Lightdash>(SERVICE_NAMES.Lightdash)
                .handleApi(payload),
          ),
      );

      this.locator.register(
        SERVICE_NAMES.Lightdash,
        () =>
          new Lightdash(
            this.locator.get(SERVICE_NAMES.Dbt),
            this.locator.get(SERVICE_NAMES.Logger),
            // Lazy callback for Api routing
            (payload) =>
              this.locator
                .get<Api>(SERVICE_NAMES.Api)
                .handleApi(payload as never),
          ),
      );

      this.locator.register(
        SERVICE_NAMES.LightdashContent,
        () => new LightdashContent(this.locator.get(SERVICE_NAMES.Logger)),
      );

      // Resolve all services (triggers lazy instantiation)
      this.log = this.locator.get(SERVICE_NAMES.Logger);
      this.log.info('Logger initialized');
      this.stateManager = this.locator.get(SERVICE_NAMES.StateManager);
      this.log.info('StateManager resolved');
      this.trino = this.locator.get(SERVICE_NAMES.Trino);
      this.log.info('Trino resolved');
      this.columnLineage = this.locator.get(SERVICE_NAMES.ColumnLineage);
      this.log.info('ColumnLineage resolved');
      this.dataExplorer = this.locator.get(SERVICE_NAMES.DataExplorer);
      this.log.info('DataExplorer resolved');
      this.framework = this.locator.get(SERVICE_NAMES.Framework);
      this.log.info('Framework resolved');
      this.dbt = this.framework.dbt; // Convenience reference
      this.log.info('Dbt reference set');
      this.api = this.locator.get(SERVICE_NAMES.Api);
      this.log.info('Api resolved');
      this.lightdash = this.locator.get(SERVICE_NAMES.Lightdash);
      this.log.info('Lightdash resolved');
      this.lightdashContent = this.locator.get(SERVICE_NAMES.LightdashContent);
      this.log.info('LightdashContent resolved');
    } catch (error: unknown) {
      console.error('[DJ] FATAL ERROR in Coder constructor:', error);
      throw error;
    }

    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.columnLineage.handleAutoRefresh(editor);
        void this.dataExplorer.handleAutoRefresh(editor);
      }),
    );

    void this.columnLineage.handleAutoRefresh(vscode.window.activeTextEditor);
    void this.dataExplorer.handleAutoRefresh(vscode.window.activeTextEditor);

    try {
      const gitLogFile = fs.readFileSync(
        path.join(WORKSPACE_ROOT, '.git', 'logs', 'HEAD'),
      );
      this.lastGitLog = gitLastLog(gitLogFile.toString());
    } catch {
      this.lastGitLog = { action: null, line: '' };
    }

    // Note: General file watcher (this.watcher) is created later in activateFileWatchers()
    // after initialization completes to avoid race conditions
  }

  activate() {
    return vscode.window.withProgress(
      {
        title: 'DJ Loading',
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
      },
      async (progress, _token) => {
        this.log.info('EXTENSION LOADING');

        const trackProgress = this.createProgressTracker(progress);

        try {
          const hasProjects = await this.initializeServices(trackProgress);

          // Skip manifest loading and finalization if no dbt projects exist
          if (!hasProjects) {
            this.log.info('EXTENSION READY (no dbt projects)');
            // Activate discovery watchers even with no projects to detect when they appear
            this.activateDiscoveryWatchers();
            return;
          }

          await this.loadProjectManifests(trackProgress);
          await this.finalizeActivation(trackProgress);

          // Activate discovery watchers AFTER schemas are created
          this.activateDiscoveryWatchers();

          // Activate file watchers AFTER all initialization is complete
          // This prevents race conditions where file changes trigger before schemas exist
          this.activateFileWatchers();

          this.log.info('EXTENSION READY');
        } catch (error: unknown) {
          this.log.error('EXTENSION ACTIVATION FAILED:', error);
          if (error instanceof Error) {
            this.log.error('Error name:', error.name);
            this.log.error('Error message:', error.message);
            this.log.error('Error stack:', error.stack);
          } else {
            this.log.error('Non-Error object thrown:', JSON.stringify(error));
          }
          throw error;
        }
      },
    );
  }

  private createProgressTracker(
    progress: vscode.Progress<{ increment?: number; message?: string }>,
  ) {
    // Steps: tree views, framework, dbt, target folders, trino, lightdash, dataExplorer, columnLineage, commands, projects (N), finalization
    const totalSteps = 9 + this.framework.dbt.projects.size + 1;
    const incrementPerStep = 100 / totalSteps;

    return (message: string) => {
      progress.report({
        increment: incrementPerStep,
        message,
      });
    };
  }

  /**
   * Initialize services and return whether dbt projects were found.
   * @returns true if dbt projects exist and full initialization was done, false otherwise
   */
  private async initializeServices(
    trackProgress: (message: string) => void,
  ): Promise<boolean> {
    try {
      trackProgress('Registering tree view providers');
      this.registerSubscriptions();

      // Register refresh command
      this.registerRefreshCommand();

      // Discover dbt projects first (before any file/folder creation)
      trackProgress('Discovering dbt projects');
      await this.framework.dbt.activate(this.context);

      // Check if any dbt projects were found
      if (this.framework.dbt.projects.size === 0) {
        this.log.info(
          'No dbt projects found in workspace. Skipping DJ initialization.',
        );
        // Update tree views to show "no projects" message
        this.framework.dbt.viewProjectNavigator.setData([
          { label: 'No dbt projects found' },
        ]);
        this.framework.dbt.viewModelActions.setData([
          { label: 'No dbt projects found' },
        ]);
        return false; // Exit early - don't create folders or update settings
      }

      // Only proceed with framework activation if dbt projects exist
      trackProgress('Activating framework');
      await this.framework.activate(this.context);

      trackProgress('Processing target folders');
      await this.framework.processTargetFolders();

      trackProgress('Activating trino features');
      this.log.info('Starting Trino activation...');
      this.trino.activate(this.context);
      this.log.info('Trino activation completed');

      trackProgress('Activating lightdash features');
      this.log.info('Starting Lightdash activation...');
      this.lightdash.activate(this.context);
      this.lightdashContent.activate(this.context);
      this.log.info('Lightdash activation completed');

      trackProgress('Activating data explorer features');
      this.log.info('Starting Data Explorer activation...');
      this.dataExplorer.activate(this.context);
      this.log.info('Data Explorer activation completed');

      trackProgress('Activating column lineage features');
      this.log.info('Starting Column Lineage activation...');
      this.columnLineage.activate(this.context);
      this.log.info('Column Lineage activation completed');

      this.servicesActivated = true;
      return true;
    } catch (error: unknown) {
      this.log.error('Service initialization failed:', error);
      // Convert any error to a proper Error object
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(
          `Service initialization failed: ${JSON.stringify(error)}`,
        );
      }
    }
  }

  private async loadProjectManifests(trackProgress: (message: string) => void) {
    const projects = Array.from(this.framework.dbt.projects.values());

    for (const project of projects) {
      trackProgress(`Loading manifest: ${project.name}`);
      let manifest: DbtProjectManifest | null = null;

      try {
        manifest = await this.framework.dbt.fetchManifest({ project });
      } catch (err: unknown) {
        this.log.error('ERROR FETCHING INITIAL MANIFEST', err);
        continue;
      }

      if (!manifest) {
        this.log.error(
          `SKIPPING: NO MANIFEST FOUND FOR PROJECT: ${project.name}`,
        );
        continue;
      }

      try {
        await this.framework.dbt.handleManifest({ manifest, project });
        project.manifest = manifest;
      } catch (err: unknown) {
        this.log.error('ERROR HANDLING INITIAL MANIFEST', err);
      }

      // Don't await in case Trino is slow / times out
      this.framework.handleLoadEtlSources({ project }).catch((err) => {
        this.log.error(`ERROR LOADING ETL SOURCES: ${project.name}`, err);
      });
    }
  }

  private async finalizeActivation(trackProgress: (message: string) => void) {
    trackProgress('Handling initial document');

    try {
      await this.handleCurrentDocument();
    } catch (err: unknown) {
      this.log.error('ERROR HANDLING INITIAL DOCUMENT: ', err);
    }
  }

  /**
   * Return the current document (if one is open in the editor)
   */
  getCurrentDocument() {
    return vscode.window.activeTextEditor?.document;
  }

  /**
   * Return the path to the current document (if it exists)
   */
  getCurrentPath() {
    return this.getCurrentDocument()?.uri.fsPath;
  }

  /**
   * Fetch info about the current document
   */
  async fetchCurrentInfo() {
    const info = await this.fetchFileInfoFromPath(this.getCurrentPath());
    return info;
  }

  /**
   * Ensures a directory exists, creating it if necessary
   */
  async fileDirCreate(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Check if a file exists and is readable
   * @param filePath The full system path for a given file
   * @returns A promise that resolves to true if the file exists and is readable, false otherwise
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads a JSON file with error handling
   */
  async fileReadJSON<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content) as T;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      console.error(
        `[FileSystemUtils] Error reading JSON file ${filePath}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Writes JSON to file
   */
  async fileWriteJSON<T>(filePath: string, data: T): Promise<void> {
    // Ensure directory exists
    const dirPath = path.dirname(filePath);
    await this.fileDirCreate(dirPath);
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(data, null, 2),
      'utf8',
    );
  }

  /**
   * Handles the active editor document
   */
  async handleCurrentDocument() {
    try {
      await this.handleTextDocument(this.getCurrentDocument());
    } catch (err: unknown) {
      this.log.error('ERROR HANDLING OPENED DOCUMENT: ', err);
    }
  }

  /**
   *
   * @param filePath The full system path for a given file
   * @returns Relevant information about the file
   */
  async fetchFileInfoFromPath(
    filePath?: string,
  ): Promise<CoderFileInfo | undefined> {
    if (!filePath) {
      return null;
    }

    const classified = classifyWatchedPath(filePath, WORKSPACE_ROOT);

    // Workspace-root system files (currently just .git/logs/HEAD) are
    // detected before any extension-based filtering. The HEAD file has no
    // extension, so an extension regex would otherwise reject it and we
    // would never set gitPending on checkout/pull.
    if (classified.kind === 'git-log') {
      try {
        const gitLogFile = fs.readFileSync(
          path.join(WORKSPACE_ROOT, '.git', 'logs', 'HEAD'),
        );
        return {
          type: 'git-log',
          log: gitLastLog(gitLogFile.toString()),
        };
      } catch {
        return null;
      }
    }

    if (classified.kind === 'unsupported') {
      return null;
    }

    const uri = vscode.Uri.file(filePath);
    const { name, extension, workspacePath } = classified;

    this.log.info(
      `🔍 [TRACE] File parsed - name: ${name}, extension: ${extension}, workspacePath: ${workspacePath}`,
    );

    this.log.info(
      `🔍 [TRACE] Extension ${extension} is supported, checking for dbt project...`,
    );

    let project: DbtProject | null = null;
    for (const [_projectName, _project] of this.framework.dbt.projects) {
      if (filePath.startsWith(_project.pathSystem)) {
        project = _project;
        break;
      }
    }

    if (project) {
      // If this file was found in a dbt project, we're now looking for dbt and framework files
      const projectPath = filePath.replace(project.pathSystem, '');
      const projectPathParts = projectPath.split('/').filter(Boolean);
      switch (extension) {
        case 'sql': {
          if (project.macroPaths.includes(projectPathParts[0])) {
            // Macro file was edited
            return { type: 'macro', name, project };
          }

          const modelId = getDbtModelId({
            modelName: name,
            projectName: project.name,
          });
          const model = modelId ? this.framework.dbt.models.get(modelId) : null;
          if (!model) {
            return null;
          }

          if (project.modelPaths.includes(projectPathParts[0]) && model) {
            // dbt model file
            const filePrefix = filePath.split('.sql')[0];
            return { type: 'model', filePrefix, model, project };
          }

          if (
            projectPathParts[0] === 'target' &&
            projectPathParts[1] === 'compiled'
          ) {
            // Compiled SQL file was updated
            const sqlFile = await vscode.workspace.fs.readFile(
              vscode.Uri.file(filePath),
            );
            let sql = sqlFile.toString();
            try {
              sql = sqlFormat(sql);
            } catch {
              // Fail silently
            }
            return {
              type: 'compiled',
              filePath,
              model,
              name,
              project,
              sql,
            };
          }
          return null;
        }
        case 'json': {
          if (projectPathParts[0] === 'target' || name === 'manifest') {
            // Manifest file was updated
            const manifest = await this.framework.dbt.fetchManifest({
              project,
            });
            if (!manifest) {
              return null;
            }
            return { type: 'manifest', project, manifest };
          }
          break;
        }
        case 'model.json': {
          const modelJson = await this.framework.fetchModelJson(
            vscode.Uri.file(filePath),
          );
          if (!modelJson) {
            return null;
          }
          const modelName = frameworkGetModelName(modelJson);
          const modelId = getDbtModelId({
            modelName,
            projectName: project.name,
          });
          const model = this.framework.dbt.models.get(modelId || '');
          return {
            type: 'framework-model',
            filePath,
            model,
            modelJson,
            project,
          };
        }
        case 'source.json': {
          const sourceJson = await this.framework.fetchSourceJson(
            vscode.Uri.file(filePath),
          );

          if (!sourceJson) {
            return null;
          }
          return {
            type: 'framework-source',
            filePath,
            project,
            sourceJson,
          };
        }
        case 'yml': {
          const ymlFile = await vscode.workspace.fs.readFile(uri);
          const properties = getDbtProperties(ymlFile.toString());
          return {
            type: 'yml',
            filePath,
            project,
            properties,
          };
        }
      }
    }

    return null;
  }

  /**
   * Handles the supplied editor document
   */
  async handleTextDocument(document?: vscode.TextDocument) {
    const documentPath = document?.uri.fsPath;
    const info = await this.fetchFileInfoFromPath(documentPath);

    switch (info?.type) {
      case 'framework-model':
      case 'model': {
        if (!info?.model) {
          return;
        }
        void this.framework.dbt.handleModelNavigate(info);
        break;
      }
      default:
        this.framework.dbt.viewModelActions.setData([
          this.framework.dbt.treeItemJsonSync,
          this.framework.dbt.treeItemProjectClean,
          this.framework.dbt.treeItemModelCreate,
          this.framework.dbt.treeItemSourceCreate,
          this.lightdash.treeItemLightdashPreview,
          this.lightdash.treeItemLightdashDashboardsAsCode,
          this.framework.dbt.treeItemModelRun,
          this.framework.dbt.treeItemModelCompile,
        ]);
        this.framework.dbt.viewSelectedResource.setData(
          this.framework.dbt.buildSelectedResource(info),
        );
    }
  }

  /**
   * Handles file change events
   */
  /**
   * Get the sync debounce delay from configuration.
   * Defaults to 1500ms if not configured.
   */
  getSyncDebounceMs(): number {
    return vscode.workspace
      .getConfiguration('dj')
      .get<number>('syncDebounceMs', 1500);
  }

  /**
   * Clear pending debounce timers for the given paths.
   * Called before file operations execute to prevent stale debounce timers
   * from firing after a rename (the old path no longer exists).
   */
  clearPendingTimersForPaths(paths: Iterable<string>): void {
    for (const p of paths) {
      const timer = this.pendingModelSyncs.get(p);
      if (timer) {
        clearTimeout(timer);
        this.pendingModelSyncs.delete(p);
        this.log.info(`DEBOUNCE: Cleared pending timer for managed path ${p}`);
      }
    }
  }

  /**
   * Debounce and then process a model or source file change.
   * Re-reads the file from disk when the timer fires, ensuring the latest content is used.
   */
  debounceFrameworkSync(filePath: string) {
    // Clear any existing pending sync for this file path
    const existingTimer = this.pendingModelSyncs.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const debounceMs = this.getSyncDebounceMs();
    const timer = setTimeout(() => {
      void (async () => {
        this.pendingModelSyncs.delete(filePath);

        try {
          // If a git operation (checkout/pull) is pending, request a full sync
          if (this.gitPending) {
            this.log.info(
              `DEBOUNCE: Git operation pending, enqueuing full sync`,
            );
            this.framework.syncQueue.enqueueFullSync();
            return;
          }

          // Re-read file info from disk to get the latest content
          const info = await this.fetchFileInfoFromPath(filePath);
          if (!info) {
            this.log.info(
              `DEBOUNCE: No file info found for ${filePath} (file may have been renamed)`,
            );
            return;
          }

          if (info.type === 'framework-model') {
            const modelName = frameworkGetModelName(info.modelJson);
            const id = frameworkGetModelId(info);
            if (!id) {
              this.log.error(`DEBOUNCE: No model ID found for ${filePath}`);
              return;
            }
            // Pass filePath as pathJson so the SyncEngine can find the file
            // even when the ID is derived from the NEW name but the file is
            // still at the OLD path (pre-rename).
            this.log.info(
              `DEBOUNCE: Enqueuing sync for ${id} (modelName=${modelName}, pathJson: ${filePath})`,
            );
            this.framework.syncQueue.enqueue(id, filePath);
          } else if (info.type === 'framework-source') {
            const sourceName = frameworkMakeSourceName(info.sourceJson);
            const id = frameworkGetSourceId({
              project: info.project,
              source: sourceName,
            });
            if (!id) {
              return;
            }
            this.log.info(
              `DEBOUNCE: Enqueuing sync for ${id} (pathJson: ${filePath})`,
            );
            this.framework.syncQueue.enqueue(id, filePath);
          }
        } catch (err: unknown) {
          this.log.error('DEBOUNCE: Error processing file', err);
        }
      })();
    }, debounceMs);

    this.pendingModelSyncs.set(filePath, timer);
    this.log.info(
      `DEBOUNCE: Scheduled sync for ${filePath} in ${debounceMs}ms`,
    );
  }

  async handleWatcherEvent({
    type,
    uri,
  }: {
    type: 'change' | 'create' | 'delete';
    uri: vscode.Uri;
  }) {
    try {
      this.log.info(`FILE WATCHER EVENT: ${type} - ${uri.fsPath}`);

      // First check whether a schema file was changed
      if (uri.fsPath.endsWith('.schema.json')) {
        this.log.info(`SKIPPING SCHEMA FILE: ${uri.fsPath}`);
        return;
      }

      // Ask SyncQueue how to handle this event. SyncQueue is the single
      // decision-maker: it uses timestamp-based suppression (narrow window
      // after each file operation) instead of blanket path suppression.
      const action = this.framework.syncQueue.shouldProcessEvent(
        uri.fsPath,
        type,
      );
      if (action === 'suppress') {
        this.log.info(
          `SUPPRESSED (within sync artifact window): ${type} - ${uri.fsPath}`,
        );
        return;
      }
      if (action === 'debounce') {
        this.log.info(
          `DEBOUNCE: ${type} event for framework file: ${uri.fsPath}`,
        );
        this.debounceFrameworkSync(uri.fsPath);
        return;
      }

      const currentDocument = this.getCurrentDocument();

      // Assume it was a dbt related file change
      switch (type) {
        case 'change': {
          const changedPath = uri.fsPath;
          this.log.info(`PROCESSING CHANGE EVENT: ${changedPath}`);

          const info = await this.fetchFileInfoFromPath(changedPath);
          if (!info) {
            this.log.info(`NO FILE INFO FOUND FOR: ${changedPath}`);
            return;
          }

          this.log.info(`FILE INFO TYPE: ${info.type} for ${changedPath}`);

          switch (info.type) {
            case 'compiled': {
              this.log.info(`HANDLING COMPILED FILE: ${changedPath}`);
              if (currentDocument?.uri.fsPath === info.model.pathSystemFile) {
                // If we are currently viewing the updated model, update the views
                await this.handleTextDocument(currentDocument);
              }
              break;
            }
            case 'git-log': {
              if (this.lastGitLog.line === info.log.line) {
                // If the last log line didn't change, do nothing
              } else {
                // Otherwise, set a new last log line and handle the change
                this.lastGitLog = info.log;
                // Re-sync all json files after these git actions
                switch (info.log.action) {
                  case 'checkout':
                  case 'pull': {
                    this.log.info('GIT ACTION: ', info.log.action);
                    this.gitPending = true;
                    setTimeout(() => {
                      // Keeps this true for 2 seconds, so that if file changes come in during the window, we know to trigger a full sync
                      this.gitPending = false;
                    }, 2000);
                  }
                }
              }
              break;
            }
            case 'manifest': {
              // Manifest changes are handled by dedicated manifestWatcher
              // to avoid duplicate processing
              this.log.info(
                'Manifest change detected, skipping (handled by dedicated watcher)',
              );
              break;
            }
            case 'macro':
            case 'model':
            case 'yml': {
              this.lastFileChange = new Date();
              break;
            }
          }
          break;
        }
        case 'create': {
          this.log.info(`PROCESSING CREATE EVENT: ${uri.fsPath}`);

          const info = await this.fetchFileInfoFromPath(uri.fsPath);
          if (!info) {
            this.log.info(`NO FILE INFO FOUND FOR CREATE: ${uri.fsPath}`);
            return;
          }

          this.log.info(`CREATED FILE TYPE: ${info.type} for ${uri.fsPath}`);

          switch (info?.type) {
            case 'macro':
            case 'model':
            case 'yml': {
              this.lastFileChange = new Date();
              break;
            }
          }
          break;
        }
        default:
          this.log.info(
            `UNHANDLED FILE WATCHER EVENT: ${type} - ${uri.fsPath}`,
          );
          break;
      }
    } catch (err: unknown) {
      this.log.error('FILE WATCHER ERROR: ', err);
    }
  }

  /**
   * Handler for api request messages coming from webviews
   */
  async handleWebviewMessage({
    message,
    webview,
  }: {
    message: ApiMessage;
    webview: vscode.Webview;
  }) {
    // When a message is received from the webview, it should be a normal api payload with an id for resolving the request
    const _channelId = message._channelId;
    try {
      // Extract API payload by removing the _channelId
      const { _channelId: _, ...payload } = message;
      const response = await this.api.handleApi(payload as any);
      webview.postMessage({ _channelId, response });
    } catch (err: unknown) {
      this.log.error('ERROR HANDLING WEBVIEW MESSAGE: ', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Unknown Error';
      const errorDetails =
        typeof err === 'object' && err !== null && 'details' in err
          ? err.details
          : undefined;
      webview.postMessage({
        _channelId,
        err: {
          message: errorMessage,
          details: errorDetails,
        },
      });
    }
  }

  public createWebviewMessageHandler(
    panel: vscode.WebviewPanel,
    panelType: string,
  ) {
    return async (message: WebviewMessage) => {
      // Check if it's a close panel message
      if (message.type === 'close-panel' && message.panelType === panelType) {
        panel.dispose();
        return;
      }

      if (
        message.type === 'save-draft-and-close' &&
        message.panelType === panelType &&
        panelType !== 'model-edit'
      ) {
        panel.dispose();
        return;
      }

      // Check if it's an open external URL message
      if (message.type === 'open-external-url') {
        if (message.url) {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          } catch (error: unknown) {
            console.error('[Coder] Failed to open external URL:', error);
          }
        }
        return;
      }

      if (message.type === 'model-updated') {
        if (message.formType) {
          try {
            // Extract model name from form type: model-{modelName}
            const modelName = message.formType.replace('model-', '');
            await this.stateManager.clearModelEditDraft(modelName);
            this.log.info(
              'Cleaned up temp file after model update:',
              modelName,
            );
            await this.framework.dbt.updateEditDraftsView();

            if (message.success && message.message) {
              vscode.window.showInformationMessage(String(message.message));
            }

            panel.dispose();
          } catch (error: unknown) {
            this.log.error(
              '[Coder] Failed to clean up temp file after update:',
              error,
            );
          }
        }
        return;
      }

      if (message.type === 'model-created') {
        try {
          if (message.formType) {
            try {
              await this.stateManager.clearFormState(message.formType);
            } catch (cleanupError: unknown) {
              this.log.warn(
                'Failed to clean up temp file after model creation:',
                cleanupError,
              );
            }
          }

          if (message.success && message.message) {
            vscode.window.showInformationMessage(String(message.message));
          }
          panel.dispose();
        } catch (error: unknown) {
          this.log.error(
            '[Coder] Failed to handle model created message:',
            error,
          );
        }
        return;
      }

      if (
        message.type === 'api-request' &&
        message.apiType &&
        message.request
      ) {
        try {
          const apiMessage = {
            type: message.apiType,
            request: message.request,
            _channelId: Date.now().toString(), // Generate a simple channel ID
          };

          const response = await this.api.handleApi(apiMessage as any);
          this.log.info('API request completed successfully:', response);

          // Handle successful model update specifically
          if (message.apiType === 'framework-model-update') {
            // Show success message to user
            vscode.window.showInformationMessage('Model updated successfully');
            panel.dispose();
            await this.framework.dbt.updateEditDraftsView();
            return;
          }

          // Optionally send success message back to webview for other API types
          panel.webview.postMessage({
            type: 'api-response',
            success: true,
            response: response,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          this.log.error('[Coder] API request failed:', {
            apiType: message.apiType,
            error: error,
            message: errorMessage,
            request: message.request,
          });

          // Show error message to user for model update operations
          if (message.apiType === 'framework-model-update') {
            vscode.window.showErrorMessage(
              `Failed to update model: ${errorMessage}`,
            );
          }

          panel.webview.postMessage({
            type: 'api-response',
            success: false,
            error: errorMessage,
          });
        }
        return;
      }

      // Fallback: try to handle as API message (for backwards compatibility)
      void this.handleWebviewMessage({
        message: message as unknown as ApiMessage,
        webview: panel.webview,
      });
    };
  }

  /**
   * Watcher for all sql files in workspace
   */
  initWatcher() {
    const watcher = vscode.workspace.createFileSystemWatcher(
      '{/**/*.json,/**/*.sql,/**/*.yml,**/.git/logs/HEAD}',
    );
    const ignoreRegex =
      /\.dbt\/|\.dj\/|\.vscode\/|\/_ext_\/|\/dbt_packages\/|\/target\/.+\//;
    watcher.onDidChange(async (uri) => {
      if (ignoreRegex.test(uri.fsPath)) {
        return;
      }
      return this.handleWatcherEvent({ type: 'change', uri });
    });
    watcher.onDidCreate(async (uri) => {
      if (ignoreRegex.test(uri.fsPath)) {
        return;
      }
      return this.handleWatcherEvent({ type: 'create', uri });
    });
    return watcher;
  }

  /**
   * Initialize file watchers for dbt_project.yml and manifest.json.
   * These detect when new projects are created or manifests become available.
   *
   * NOTE: This method only creates the watcher configuration.
   * Call activateDiscoveryWatchers() to actually start watching.
   */
  private initProjectWatchers(): void {
    // Watch for dbt_project.yml creation (new dbt project)
    this.projectWatcher = vscode.workspace.createFileSystemWatcher(
      '**/dbt_project.yml',
      false, // ignoreCreateEvents = false (we want to detect creation)
      true, // ignoreChangeEvents = true
      true, // ignoreDeleteEvents = true
    );

    // Watch for manifest.json creation (project parsed/compiled)
    this.manifestWatcher = vscode.workspace.createFileSystemWatcher(
      '**/target/manifest.json',
      false, // ignoreCreateEvents = false
      false, // ignoreChangeEvents = false (manifest updates are also relevant)
      true, // ignoreDeleteEvents = true
    );
  }

  /**
   * Activate discovery watchers for detecting new projects and manifests.
   * Should be called after schemas are created to avoid race conditions.
   */
  private activateDiscoveryWatchers(): void {
    if (!this.projectWatcher || !this.manifestWatcher) {
      this.initProjectWatchers();
    }

    // Attach handlers to project watcher
    this.projectWatcher!.onDidCreate((uri) => {
      this.log.info(`New dbt_project.yml detected: ${uri.fsPath}`);
      void this.handleDbtProjectCreated(uri);
    });
    this.context.subscriptions.push(this.projectWatcher!);

    // Attach handlers to manifest watcher
    this.manifestWatcher!.onDidCreate((uri) => {
      this.log.info(`New manifest.json detected: ${uri.fsPath}`);
      void this.handleManifestCreated(uri);
    });
    this.manifestWatcher!.onDidChange((uri) => {
      this.log.info(`Manifest.json changed: ${uri.fsPath}`);
      void this.handleManifestCreated(uri);
    });
    this.context.subscriptions.push(this.manifestWatcher!);

    this.log.info('Discovery watchers activated');
  }

  /**
   * Register the refresh projects command
   */
  private registerRefreshCommand(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.REFRESH_PROJECTS, async () => {
        await this.handleRefreshProjects();
      }),
    );
  }

  /**
   * Handle when a new dbt_project.yml is created.
   * This triggers project discovery and potentially full service activation.
   */
  private async handleDbtProjectCreated(uri: vscode.Uri): Promise<void> {
    try {
      // Check if this project is already known
      const projectPath = uri.fsPath.replace(/\/dbt_project.yml$/, '');
      for (const project of this.framework.dbt.projects.values()) {
        if (project.pathSystem === projectPath) {
          this.log.info(`Project already known: ${projectPath}`);
          return;
        }
      }

      // If this is the first project, activate services before initializing
      const isFirstProject =
        !this.servicesActivated && this.framework.dbt.projects.size === 0;

      if (isFirstProject) {
        this.log.info('First dbt project detected, activating services...');
        await this.activateServicesForFirstProject();
      }

      // Initialize the new project
      await this.framework.dbt.initProject(uri);

      // Update the views
      this.updateProjectViews();

      if (isFirstProject) {
        vscode.window.showInformationMessage(
          `DJ: First dbt project detected. Run 'dbt parse' to generate manifest.`,
        );
      } else if (this.servicesActivated) {
        vscode.window.showInformationMessage(
          `DJ: New dbt project detected. Run 'dbt parse' to generate manifest.`,
        );
      }
    } catch (error: unknown) {
      this.log.error('Error handling new dbt project:', error);
    }
  }

  /**
   * Handle when a manifest.json is created or updated.
   * This loads the manifest for the corresponding project.
   *
   * Note: This handler is only called by the dedicated manifestWatcher.
   * Services are guaranteed to be activated before this runs (either during initial
   * activation or via activateServicesForFirstProject).
   */
  private async handleManifestCreated(uri: vscode.Uri): Promise<void> {
    try {
      // Extract project path from manifest path: .../target/manifest.json -> ...
      const projectPath = uri.fsPath.replace(/\/target\/manifest\.json$/, '');

      // Find the matching project
      let matchingProject = null;
      for (const project of this.framework.dbt.projects.values()) {
        if (project.pathSystem === projectPath) {
          matchingProject = project;
          break;
        }
      }

      if (!matchingProject) {
        this.log.info(`No matching project found for manifest: ${uri.fsPath}`);
        // Try to discover the project first
        const projectYmlUri = vscode.Uri.file(
          path.join(projectPath, 'dbt_project.yml'),
        );
        if (await this.fileExists(projectYmlUri.fsPath)) {
          await this.framework.dbt.initProject(projectYmlUri);
          // Find the project again
          for (const project of this.framework.dbt.projects.values()) {
            if (project.pathSystem === projectPath) {
              matchingProject = project;
              break;
            }
          }
        }
      }

      if (!matchingProject) {
        this.log.warn(`Could not find project for manifest: ${uri.fsPath}`);
        return;
      }

      // Load and process the manifest
      const manifest = await this.framework.dbt.fetchManifest({
        project: matchingProject,
      });

      if (manifest) {
        await this.framework.dbt.handleManifest({
          manifest,
          project: matchingProject,
        });
        matchingProject.manifest = manifest;

        this.updateProjectViews();
      }
    } catch (error: unknown) {
      this.log.error('Error handling manifest creation:', error);
    }
  }

  /**
   * Handle manual refresh of projects.
   * Re-discovers all dbt projects and reloads their manifests.
   */
  async handleRefreshProjects(): Promise<void> {
    await vscode.window.withProgress(
      {
        title: 'DJ: Refreshing Projects',
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: 'Discovering dbt projects...' });

          // Find all dbt projects
          const projectYmlUris = await vscode.workspace.findFiles(
            '**/dbt_project.yml',
            getDbtProjectExcludePaths(),
          );

          // Re-initialize all projects to pick up dbt_project.yml changes (e.g. vars)
          const previousProjectCount = this.framework.dbt.projects.size;
          for (const uri of projectYmlUris) {
            await this.framework.dbt.initProject(uri);
          }
          const newProjectsFound =
            this.framework.dbt.projects.size - previousProjectCount;

          // If this was the first project discovery, run full activation
          if (!this.servicesActivated && this.framework.dbt.projects.size > 0) {
            progress.report({ message: 'Activating services...' });
            await this.activateServicesForFirstProject();
          }

          // Load manifests for all projects
          progress.report({ message: 'Loading manifests...' });
          for (const project of this.framework.dbt.projects.values()) {
            const manifest = await this.framework.dbt.fetchManifest({
              project,
            });
            if (manifest) {
              await this.framework.dbt.handleManifest({ manifest, project });
              project.manifest = manifest;
            }
          }

          // Regenerate extension-contributed files for all projects
          // This ensures settings changes (Airflow, macros, tests, agents) are reflected
          progress.report({ message: 'Updating extension files...' });
          await this.framework.dbt.writeAirflowDags();
          for (const project of this.framework.dbt.projects.values()) {
            await this.framework.dbt.writeMacroFiles(project);
            await this.framework.dbt.writeGenericTests(project);
          }
          await this.framework.dbt.writeAgentsMd();
          await this.framework.dbt.writeSkillFiles();

          this.updateProjectViews();

          const message =
            newProjectsFound > 0
              ? `Found ${newProjectsFound} new project(s). Total: ${this.framework.dbt.projects.size}`
              : `${this.framework.dbt.projects.size} project(s) loaded`;
          vscode.window.showInformationMessage(`DJ: ${message}`);
        } catch (error: unknown) {
          this.log.error('Error refreshing projects:', error);
          vscode.window.showErrorMessage('DJ: Error refreshing projects');
        }
      },
    );
  }

  /**
   * Activate services when the first dbt project is discovered after extension startup.
   * This handles the case where no projects existed during initial activation.
   */
  private async activateServicesForFirstProject(): Promise<void> {
    try {
      this.log.info('Activating services for first project...');

      // Activate framework (creates .dj/schemas, updates settings, registers commands)
      await this.framework.activate(this.context);

      // Activate other services
      this.trino.activate(this.context);
      this.lightdash.activate(this.context);
      this.lightdashContent.activate(this.context);
      this.dataExplorer.activate(this.context);
      this.columnLineage.activate(this.context);

      // Process target folders
      await this.framework.processTargetFolders();

      // Mark services as activated
      this.servicesActivated = true;

      // Now that schemas exist, activate watchers
      // Note: Discovery watchers are already active (from no-projects case)
      // but we may need to ensure they're initialized
      this.activateFileWatchers();

      this.log.info('Services activated for first project');
    } catch (error: unknown) {
      this.log.error('Error activating services for first project:', error);
      throw error;
    }
  }

  /**
   * Update project-related views with current data
   */
  private updateProjectViews(): void {
    if (this.framework.dbt.projects.size === 0) {
      this.framework.dbt.viewProjectNavigator.setData([
        { label: 'No dbt projects found' },
      ]);
      this.framework.dbt.viewModelActions.setData([
        { label: 'No dbt projects found' },
      ]);
    } else {
      // Rebuild navigator with current projects
      for (const project of this.framework.dbt.projects.values()) {
        this.framework.dbt.viewProjectNavigator.setData(
          this.framework.dbt.buildProjectNavigator({ project }),
        );
        // Just use the first project for now - could be enhanced for multi-project
        break;
      }
      // Reset model actions to default
      this.framework.dbt.viewModelActions.setData([
        this.framework.dbt.treeItemJsonSync,
        this.framework.dbt.treeItemProjectClean,
        this.framework.dbt.treeItemModelCreate,
        this.framework.dbt.treeItemSourceCreate,
        this.lightdash.treeItemLightdashPreview,
        this.lightdash.treeItemLightdashDashboardsAsCode,
        this.framework.dbt.treeItemModelRun,
        this.framework.dbt.treeItemModelCompile,
      ]);
    }
  }

  registerSubscriptions() {
    // Register Subscriptions
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        VIEW_ID.PROJECT_NAVIGATOR,
        this.framework.dbt.viewProjectNavigator,
      ),
    );
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        VIEW_ID.MODEL_ACTIONS,
        this.framework.dbt.viewModelActions,
      ),
    );
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        VIEW_ID.SELECTED_RESOURCE,
        this.framework.dbt.viewSelectedResource,
      ),
    );
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        VIEW_ID.QUERY_ENGINE,
        this.trino.viewQueryEngine,
      ),
    );
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        VIEW_ID.EDIT_DRAFTS,
        this.framework.dbt.viewEditDrafts,
      ),
    );

    // Register centralized configuration change handler with validation
    registerConfigurationChangeHandler(
      this.context,
      () => Array.from(this.framework.dbt.projects.keys()), // Available project names
    );

    this.log.info('All subscriptions and config listeners registered');
  }

  /**
   * Execute a dbt command in a properly configured terminal.
   * Handles virtual environment setup and provides consistent error handling.
   * @param command - The command to execute.
   * @param terminalName - The name of the terminal to create.
   * @param cwd - The current working directory to execute the command in.
   */
  executeDbtCommand(command: string, terminalName: string, cwd?: string): void {
    try {
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: cwd,
        env: getVenvEnvironment(),
      });
      terminal.show();
      terminal.sendText(command);
    } catch (err: unknown) {
      this.log.error(`ERROR EXECUTING DBT COMMAND: ${command}`, err);
      throw err;
    }
  }

  /**
   * Activate file watchers for monitoring changes to dbt files.
   * Should only be called after services are fully initialized to avoid race conditions.
   */
  private activateFileWatchers(): void {
    // Create and register general file watcher for model/source JSON, SQL, YML files
    this.watcher = this.initWatcher();
    this.context.subscriptions.push(this.watcher);

    this.log.info('File watchers activated');
  }

  deactivate() {
    // Clear all pending debounce timers to prevent callbacks after deactivation
    for (const timer of this.pendingModelSyncs.values()) {
      clearTimeout(timer);
    }
    this.pendingModelSyncs.clear();

    this.watcher?.dispose();
    this.projectWatcher?.dispose();
    this.manifestWatcher?.dispose();
    this.api.deactivate();
    this.framework.deactivate();
    this.lightdash.deactivate();
    this.lightdashContent.deactivate();
    this.trino.deactivate();
    this.columnLineage.deactivate();
  }
}
