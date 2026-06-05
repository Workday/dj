import type { Api } from '@services/api';
import type { Coder } from '@services/coder';
import type { CoderFileInfo } from '@services/coder/types';
import { getDjConfig, updateVSCodeJsonSchemas } from '@services/config';
import {
  COMMAND_ID,
  DJ_IGNORE_ENTRY,
  GITIGNORE,
  IGNORE_PROMPT_KEY,
} from '@services/constants';
import { BASE_AIRFLOW_PATH, BASE_SCHEMAS_PATH } from '@services/constants';
import type { Dbt } from '@services/dbt';
import type { DJLogger } from '@services/djLogger';
import type { StateManager } from '@services/statemanager';
import {
  buildOrderedResources,
  CacheManager,
  ERROR_MESSAGES,
  ManifestManager,
  PythonModelSyncService,
  SYNC_BATCH_SIZES,
  type SyncCallbacks,
  SyncEngine,
  SyncQueue,
  type SyncResult,
  type SyncRoot,
  type ValidationErrorDetail,
} from '@services/sync';
import type { ApiEnabledService } from '@services/types';
import { showOrOpenFile } from '@services/utils/fileNavigation';
import { assertExhaustive, jsonParse } from '@shared';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import type { DbtProject, DbtResourceType } from '@shared/dbt/types';
import type {
  FrameworkDataType,
  FrameworkModel,
  FrameworkSource,
  PythonModelConfig,
} from '@shared/framework/types';
import { DJ_SCHEMAS_PATH, WORKSPACE_ROOT } from 'admin';
import type { ValidateFunction } from 'ajv';
import { Ajv } from 'ajv';
import * as fs from 'fs';
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
} from 'jsonc-parser';
import * as path from 'path';
import * as vscode from 'vscode';

import { FRAMEWORK_JSON_SYNC_EXCLUDE_PATHS } from './constants';
import { FrameworkContext } from './context';
import type { FrameworkState } from './FrameworkState';
import { ColumnLineageHandler } from './handlers/column-lineage-handler';
import { ModelCrudHandlers } from './handlers/model-crud-handlers';
import { ModelDataHandlers } from './handlers/model-data-handlers';
import { PreferencesHandler } from './handlers/preferences-handler';
import { SourceHandler } from './handlers/source-handler';
import { UIHandlers } from './handlers/ui-handlers';
import {
  frameworkGetModelId,
  frameworkGetSourceIds,
  frameworkMakeSourcePrefix,
  generateAutoTests,
  generatePythonModel,
  generatePythonModelCells,
  generatePythonModelConfigPy,
} from './utils';

/**
 * Dependencies required by the Framework service.
 */
interface FrameworkDependencies {
  /** Lazy getter to avoid circular dependency with Api */
  getApi: () => Api;
  coder: Coder;
  dbt: Dbt;
  log: DJLogger;
  state: FrameworkState;
  stateManager: StateManager;
}

export class Framework implements ApiEnabledService<'framework'> {
  // Private implementation dependencies (readonly after construction)
  private readonly ajv: Ajv;
  /** Lazy getter for Api to avoid circular dependency */
  private readonly getApi: () => Api;
  private readonly coder: Coder;
  private readonly log: DJLogger;
  private readonly state: FrameworkState;
  private readonly stateManager: StateManager;

  // Public readonly access (legacy - framework.dbt used by other services)
  readonly dbt: Dbt;

  // Private VS Code resources
  private readonly diagnosticModelJson: vscode.DiagnosticCollection;
  private readonly diagnosticSourceJson: vscode.DiagnosticCollection;

  // State-driven sync queue (replaces syncsPending/syncsRunning/setInterval)
  syncQueue!: SyncQueue;
  private statusBarItem!: vscode.StatusBarItem;
  validateSourceJson: ValidateFunction | undefined;
  webviewPanelModelCreate: vscode.WebviewPanel | undefined;
  webviewPanelQueryView: vscode.WebviewPanel | undefined;
  webviewPanelSourceCreate: vscode.WebviewPanel | undefined;
  webviewPanelPythonModelCreate: vscode.WebviewPanel | undefined;
  webviewPanelDagCreate: vscode.WebviewPanel | undefined;

  // Track files that are locked during DJ Sync operations
  private lockedModelFiles: Set<string> = new Set();

  // When true, the next sync will force a manifest reparse at the start.
  // Set after a sync that contained renames, to ensure the manifest is fresh
  // for dependency resolution and rename propagation in subsequent syncs.
  private lastSyncHadRenames = false;

  // Handler instances
  private uiHandlers: UIHandlers;
  private modelDataHandlers: ModelDataHandlers;
  private modelCrudHandlers: ModelCrudHandlers;
  private sourceHandler: SourceHandler;
  private columnLineageHandler: ColumnLineageHandler;
  private preferencesHandler: PreferencesHandler;

  // Content hash cache for change detection - skips regenerating unchanged files
  private cacheManager = new CacheManager();

  // Manifest manager for manifest-related decisions
  private manifestManager = new ManifestManager();

  // Whether to enable change detection (skip unchanged files)
  private enableChangeDetection = true;

  // File watchers for automatic cache invalidation
  private jsonFileWatcher?: vscode.FileSystemWatcher;
  private sqlFileWatcher?: vscode.FileSystemWatcher;
  private ymlFileWatcher?: vscode.FileSystemWatcher;

  // Python model sync service for keeping .python.json, .py, and .ipynb in sync
  private pythonModelSyncService?: PythonModelSyncService;

  constructor({
    getApi,
    coder,
    dbt,
    log,
    state,
    stateManager,
  }: FrameworkDependencies) {
    // 1. Assign dependencies
    this.getApi = getApi;
    this.coder = coder;
    this.dbt = dbt;
    this.log = log;
    this.state = state;
    this.stateManager = stateManager;

    // 2. Initialize local resources (pure)
    this.ajv = new Ajv({
      allErrors: true,
      logger: this.log,
      strictSchema: 'log',
    });
    this.diagnosticModelJson =
      vscode.languages.createDiagnosticCollection('modelJson');
    this.diagnosticSourceJson =
      vscode.languages.createDiagnosticCollection('sourceJson');

    // 3. Initialize handlers with context
    const ctx = new FrameworkContext(this);
    this.uiHandlers = new UIHandlers(ctx);
    this.modelDataHandlers = new ModelDataHandlers(ctx);
    this.modelCrudHandlers = new ModelCrudHandlers(ctx);
    this.sourceHandler = new SourceHandler(ctx);
    this.columnLineageHandler = new ColumnLineageHandler(ctx);
    this.preferencesHandler = new PreferencesHandler(ctx);

    // 4. Initialize file watchers
    this.initializeFileWatchers();

    // 4. Setup state-driven sync queue (replaces setInterval polling)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.name = 'DJ Sync';
    this.statusBarItem.command = COMMAND_ID.JSON_SYNC;
    this.statusBarItem.text = '$(sync) DJ Sync: Idle';
    this.statusBarItem.show();

    this.syncQueue = new SyncQueue(
      (roots) => this.runSyncWithProgress(roots),
      (text, spinning) => {
        this.statusBarItem.text = spinning
          ? `$(sync~spin) ${text}`
          : `$(sync) ${text}`;
      },
      this.log,
      this.coder.getSyncDebounceMs(),
      async (renames) => {
        // Post-sync cleanup: handle old files that the editor may have
        // re-created (Coder tab re-creation bug where renameFile() doesn't
        // redirect tabs). For each rename, if the old file still exists:
        // - For .model.json: move content to new path (preserves user edits),
        //   delete old, close old tab, open new, trigger follow-up sync
        // - For .sql/.yml: just delete old file and close tab
        for (const rename of renames) {
          if (!rename.newPathJson) {
            continue;
          }
          const oldPaths = [
            rename.pathJson,
            rename.pathJson.replace('.model.json', '.sql'),
            rename.pathJson.replace('.model.json', '.yml'),
          ];
          const newPaths = [
            rename.newPathJson,
            rename.newPathJson.replace('.model.json', '.sql'),
            rename.newPathJson.replace('.model.json', '.yml'),
          ];
          for (let i = 0; i < oldPaths.length; i++) {
            const oldPath = oldPaths[i];
            const newPath = newPaths[i];
            const isModelJson = oldPath.endsWith('.model.json');
            try {
              const oldUri = vscode.Uri.file(oldPath);
              // Check if old file still exists (editor re-created it)
              await vscode.workspace.fs.stat(oldUri);

              if (isModelJson) {
                // Move user's content to new path (overwrites sync-generated)
                const content = await vscode.workspace.fs.readFile(oldUri);
                const newUri = vscode.Uri.file(newPath);
                await vscode.workspace.fs.writeFile(newUri, content);
                await vscode.workspace.fs.delete(oldUri);
                this.log.info(
                  `Post-sync cleanup: moved model.json content ${oldPath} -> ${newPath}`,
                );
                // Close old tab and open new file
                await this.closeTabsForPath(oldPath);
                await vscode.window.showTextDocument(newUri);
                // Trigger follow-up sync (user may have changed name again)
                this.coder.debounceFrameworkSync(newPath);
              } else {
                // Generated file (.sql/.yml) — just delete and close tab
                await vscode.workspace.fs.delete(oldUri);
                await this.closeTabsForPath(oldPath);
                this.log.info(
                  `Post-sync cleanup: deleted generated file ${oldPath}`,
                );
              }
            } catch {
              // File doesn't exist — normal case, nothing to clean up
            }
          }
        }
      },
    );

    // 5. Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup VS Code event handlers.
   * Separated from constructor to keep it focused on dependency injection.
   */
  private setupEventHandlers(): void {
    // Prevent editing of locked model files during DJ Sync
    vscode.workspace.onWillSaveTextDocument((event) => {
      const filePath = event.document.fileName;
      if (this.lockedModelFiles.has(filePath)) {
        event.waitUntil(
          Promise.reject(
            new Error('Model file is locked during DJ Sync operation'),
          ),
        );
        vscode.window.showWarningMessage(
          'Cannot edit model file during DJ Sync operation. Please wait for sync to complete.',
        );
      }
    });
  }

  /**
   * Check if any sync is currently running.
   * Delegates to the SyncQueue state machine.
   */
  isSyncing(): boolean {
    return this.syncQueue.isSyncing();
  }

  /**
   * Main API handler for framework-related operations.
   * Routes requests to appropriate handlers based on payload type.
   */
  async handleApi(payload: ApiPayload<'framework'>): Promise<ApiResponse> {
    switch (payload.type) {
      case 'framework-model-create':
        return await this.modelCrudHandlers.handleModelCreate(payload);

      case 'framework-model-update':
        return await this.modelCrudHandlers.handleModelUpdate(payload);

      case 'framework-model-preview':
        return this.modelCrudHandlers.handleModelPreview(payload);

      case 'framework-source-create':
        return await this.sourceHandler.handleSourceCreate(payload);

      case 'framework-python-model-create': {
        const {
          projectName,
          name,
          group,
          topic,
          description,
          model_type,
          dags,
          enable_notebook,
          tags,
          namespace: reqNamespace,
          table_name: reqTableName,
          create_dag: createDag,
          dag_config: dagConfig,
        } = payload.request;

        const project = this.dbt.projects.get(projectName);
        if (!project) {
          throw new Error('Project not found');
        }

        // Create directory structure: dags/python_models/<group>/<topic>/
        const pythonModelDir = path.join(
          WORKSPACE_ROOT,
          'dags',
          'python_models',
          group,
          topic,
        );
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.file(pythonModelDir),
        );

        // Ensure __init__.py files exist for Python package structure
        await this.ensurePythonModelsInitFiles(group, topic);

        // Check if python model file already exists
        const pythonJsonFileName = `${name}.python.json`;
        const pythonJsonPath = path.join(pythonModelDir, pythonJsonFileName);
        const pythonJsonUri = vscode.Uri.file(pythonJsonPath);
        try {
          await vscode.workspace.fs.stat(pythonJsonUri);
          throw new Error(
            `Python model '${name}' already exists in ${group}/${topic}`,
          );
        } catch (err) {
          // File doesn't exist, which is expected - continue with creation
          if (err instanceof Error && err.message.includes('already exists')) {
            throw err;
          }
        }

        const pythonModelConfig: PythonModelConfig = {
          name,
          group,
          topic,
          ...(description && { description }),
          model_type,
          dags,
          ...(enable_notebook && { enable_notebook }),
          tags: tags && tags.length > 0 ? tags : ['python-model', group],
          ...(reqNamespace && { namespace: reqNamespace }),
          ...(reqTableName && { table_name: reqTableName }),
          variables: {},
        };

        // Generate cells and include them in the JSON
        pythonModelConfig.cells = generatePythonModelCells(pythonModelConfig);

        await vscode.workspace.fs.writeFile(
          pythonJsonUri,
          Buffer.from(JSON.stringify(pythonModelConfig, null, '    ')),
        );

        // Derive .python.py from cells
        const modelContent = generatePythonModel(pythonModelConfig);
        const modelFileName = `${name}.python.py`;
        const modelUri = vscode.Uri.file(
          path.join(pythonModelDir, modelFileName),
        );
        await vscode.workspace.fs.writeFile(
          modelUri,
          Buffer.from(modelContent),
        );

        // Ensure shared _config.py, etl_helper.py, and .airflowignore exist
        await this.ensurePythonModelConfigPy();
        await this.ensureEtlHelperFile();
        await this.ensureAirflowIgnoreFile();

        // Generate new DAG file if requested
        if (createDag && dagConfig?.name) {
          await this.generateDagFile(project, dagConfig);
        }

        // Auto-modify selected DAGs to add fetch/run_python_models tasks
        if (dags && dags.length > 0) {
          for (const dagName of dags) {
            await this.injectPythonModelTasksIntoDag(project, dagName);
          }
        }

        // Clear form state
        try {
          await this.getApi().handleApi({
            type: 'state-clear',
            request: { formType: 'python-model-create' },
          });
        } catch (error) {
          this.log.warn(
            'Failed to clear python model create form state:',
            error,
          );
        }

        // Open the created file
        vscode.window.showTextDocument(pythonJsonUri);

        return 'Python model created' as ApiResponse<'framework-python-model-create'>;
      }

      case 'framework-dag-create': {
        const { projectName, name, schedule, tags, description } =
          payload.request;

        const project = this.dbt.projects.get(projectName);
        if (!project) {
          throw new Error('Project not found');
        }

        const dagFilePath = await this.generateEmptyDagFile({
          name,
          schedule,
          tags,
          description,
        });

        // Clear form state
        try {
          await this.getApi().handleApi({
            type: 'state-clear',
            request: { formType: 'dag-create' },
          });
        } catch (error) {
          this.log.warn('Failed to clear dag create form state:', error);
        }

        // Open the generated DAG file
        await vscode.window.showTextDocument(vscode.Uri.file(dagFilePath));

        return `DAG '${name}' created at dags/${name}.py`;
      }

      case 'framework-get-current-model-data':
        return await this.modelDataHandlers.handleGetCurrentModelData(payload);

      case 'framework-get-model-data':
        return await this.modelDataHandlers.handleGetModelData(payload);

      case 'framework-check-model-exists':
        return await this.modelDataHandlers.handleCheckModelExists(payload);

      case 'framework-close-panel':
        return await this.uiHandlers.handleClosePanel(payload);

      case 'framework-show-message':
        return await this.uiHandlers.handleShowMessage(payload);

      case 'framework-open-external-url':
        return await this.uiHandlers.handleOpenExternalUrl(payload);

      case 'framework-get-model-settings':
        return await this.uiHandlers.handleGetModelSettings(payload);

      case 'framework-set-model-settings':
        return await this.uiHandlers.handleSetModelSettings(payload);

      case 'framework-get-original-model-files':
        return await this.modelDataHandlers.handleGetOriginalModelFiles(
          payload,
        );

      case 'framework-column-lineage':
        return await this.columnLineageHandler.handleColumnLineage(payload);

      case 'framework-preferences':
        return await this.preferencesHandler.handlePreferences(payload);

      case 'framework-get-available-dags':
        return await this.handleGetAvailableDags(payload);

      default:
        return assertExhaustive<ApiResponse>(payload);
    }
  }

  async activate(context: vscode.ExtensionContext) {
    await vscode.workspace.fs.delete(vscode.Uri.file(DJ_SCHEMAS_PATH), {
      recursive: true,
    });

    const loadSchemasFiles = new Promise<void>((resolve, reject) => {
      const startTime = Date.now();
      fs.readdir(BASE_SCHEMAS_PATH, (err, files) => {
        if (err) {
          reject(err);
        } else if (files) {
          this.log.info(`Loading ${files.length} schema files...`);
          // Handle async operations in IIFE
          void (async () => {
            try {
              // Read all schema files asynchronously in parallel
              const fileReadPromises = files.map(async (file) => {
                const filePath = path.join(BASE_SCHEMAS_PATH, file);
                const content = await fs.promises.readFile(filePath, 'utf8');
                return { file, content };
              });

              const fileContents = await Promise.all(fileReadPromises);

              // Write all schema files in parallel
              const writePromises = fileContents.map(({ file, content }) =>
                vscode.workspace.fs.writeFile(
                  vscode.Uri.file(path.join(DJ_SCHEMAS_PATH, file)),
                  Buffer.from(content),
                ),
              );

              await Promise.all(writePromises);

              // Add all schemas to AJV using the already-read content
              for (const { file, content } of fileContents) {
                try {
                  const schema = JSON.parse(content);
                  this.ajv.addSchema(schema, file);
                } catch (parseErr) {
                  this.log.warn(`Failed to parse schema ${file}:`, parseErr);
                }
              }

              const duration = Date.now() - startTime;
              this.log.info(`Schema loading completed in ${duration}ms`);
              resolve();
            } catch (err: unknown) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          })();
        }
      });
    });

    try {
      await loadSchemasFiles;
    } catch (err: unknown) {
      this.log.error('Error loading schema files', err);
    }

    // Load main schemas to ajv
    // Note: Model validation now uses type-specific schemas via getValidatorForType()
    // We only need to load the source schema here
    try {
      this.validateSourceJson = this.ajv.getSchema('source.schema.json');
    } catch (err: unknown) {
      this.log.error('Error loading source.json schema', err);
    }

    // Setting json schemas locally because we can't specify workspace paths from the extension
    this.log.info('Updating Schemas');
    updateVSCodeJsonSchemas([
      {
        fileMatch: ['*.model.json'],
        url: '.dj/schemas/model.schema.json',
      },
      {
        fileMatch: ['*.source.json'],
        url: '.dj/schemas/source.schema.json',
      },
      {
        fileMatch: ['*.python.json'],
        url: '.dj/schemas/python-model.schema.json',
      },
    ]);

    this.registerCommands(context);
    this.registerProviders(context);
    this.registerEventHandlers(context);

    // Check if .dj folder should be added to .gitignore
    void this.checkAndPromptForGitignore(context);
  }

  /**
   * Checks if .dj folder is in .gitignore and prompts user to add it if missing
   */
  private async checkAndPromptForGitignore(context: vscode.ExtensionContext) {
    // 1. Check if user silenced this prompt
    if (context.globalState.get(IGNORE_PROMPT_KEY)) {
      return;
    }

    const gitignorePath = path.join(WORKSPACE_ROOT, GITIGNORE);

    // 2. Check if .gitignore exists
    if (!fs.existsSync(gitignorePath)) {
      return; // No .gitignore, user might not be using git or hasn't set it up
    }

    // 3. Check if .dj is already ignored
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (content.includes('.dj') || content.includes('/.dj')) {
        return; // Already ignored
      }

      // 4. Show prompt
      const answer = await vscode.window.showInformationMessage(
        'The DJ (Data JSON) Framework extension uses a .dj folder for local state. Would you like to add it to .gitignore?',
        'Yes',
        'No',
        "Don't ask again",
      );

      if (answer === 'Yes') {
        const newLine = content.endsWith('\n') ? '\n' : '\n\n';
        const newContent = `${content}${newLine}# DJ (Data JSON) Framework\n${DJ_IGNORE_ENTRY}\n`;

        fs.writeFileSync(gitignorePath, newContent, 'utf8');
        vscode.window.showInformationMessage('Added .dj/ to .gitignore');
      } else if (answer === "Don't ask again") {
        await context.globalState.update(IGNORE_PROMPT_KEY, true);
      }
    } catch (err) {
      console.error('Error handling .gitignore:', err);
    }
  }

  registerCommands(context: vscode.ExtensionContext): void {
    this.log.info('Framework: Registering commands');
    this.registerNavigationCommands(context);
    this.registerFrameworkJumpCommands(context);
    this.registerUtilityCommands(context);
    this.log.info('Framework: Commands registered successfully');
  }

  /**
   * Register navigation commands - Source Origin, Source Refresh
   * @param context VS Code extension context
   */
  private registerNavigationCommands(context: vscode.ExtensionContext): void {
    // SOURCE_ORIGIN - navigate to source definition
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.SOURCE_ORIGIN,
        async ({
          filePath,
          projectName,
          tableName,
        }: {
          filePath: string;
          projectName: string;
          tableName: string;
        }) => {
          try {
            const project = this.dbt.projects.get(projectName);
            if (!project) {
              throw new Error('No project found');
            }

            const ext = path.extname(filePath);
            const pattern =
              ext === '.json' ? `"name": "${tableName}"` : `name: ${tableName}`;
            const fileUri = vscode.Uri.file(filePath);
            const editor = await vscode.window.showTextDocument(fileUri);
            const regex = new RegExp(pattern);
            const matches = regex.exec(editor.document.getText());
            if (!matches) {
              return;
            }

            const line = editor.document.lineAt(
              editor.document.positionAt(matches.index).line,
            );
            const indexOf = line.text.indexOf(matches[0]);
            const position = new vscode.Position(line.lineNumber, indexOf);
            const range = editor.document.getWordRangeAtPosition(
              position,
              new RegExp(regex),
            );
            if (range) {
              editor.revealRange(range);
              editor.selection = new vscode.Selection(range.start, range.end);
            }
          } catch (err: unknown) {
            this.log.error('ERROR NAVIGATING TO SOURCE ORIGIN', err);
          }
        },
      ),
    );

    // SOURCE_REFRESH - refresh source columns from Trino
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.SOURCE_REFRESH,
        async ({ sourceId }: { sourceId: string }) => {
          await vscode.window.withProgress(
            {
              title: 'DJ Loading',
              location: vscode.ProgressLocation.Notification,
              cancellable: false,
            },
            async (progress, _token) => {
              try {
                progress.report({
                  increment: 20,
                  message: 'Checking source table columns',
                });

                const sourceJson = await this.fetchSourceJson(
                  vscode.Uri.file(
                    this.coder.getCurrentDocument()?.uri.fsPath ?? '',
                  ),
                );

                if (!sourceJson?.tables) {
                  return;
                }

                const tableName = sourceId.split('.')[3];

                const trinoColumnsResponse = await this.getApi().handleApi({
                  type: 'trino-fetch-columns',
                  request: {
                    catalog: sourceJson.database,
                    schema: sourceJson.schema,
                    table: tableName,
                  },
                });

                // Type guard: ensure we have columns array
                if (
                  !trinoColumnsResponse ||
                  !Array.isArray(trinoColumnsResponse) ||
                  trinoColumnsResponse.length === 0
                ) {
                  vscode.window.showWarningMessage('No columns found');
                  return;
                }

                progress.report({
                  increment: 40,
                  message: 'Syncing columns',
                });

                const table = sourceJson.tables.find(
                  (t) => t.name === tableName,
                );

                if (!table) {
                  return;
                }

                table.columns = trinoColumnsResponse.map((c: any) => ({
                  name: c.column,
                  data_type: c.type as FrameworkDataType,
                  description: c.comment || '',
                }));

                const currentPath = this.coder.getCurrentPath();
                if (!currentPath) {
                  return;
                }

                await vscode.workspace.fs.writeFile(
                  vscode.Uri.file(currentPath),
                  Buffer.from(JSON.stringify(sourceJson, null, 4)),
                );

                progress.report({
                  increment: 40,
                  message: 'Columns synced',
                });
              } catch (err: unknown) {
                this.log.error('ERROR REFRESHING SOURCE', err);
                vscode.window.showErrorMessage('Error refreshing source');
              }
            },
          );
        },
      ),
    );
  }

  /**
   * Register framework jump commands - navigate between SQL, JSON, and YAML files
   * @param context VS Code extension context
   */
  private registerFrameworkJumpCommands(
    context: vscode.ExtensionContext,
  ): void {
    // FRAMEWORK_JUMP_JSON - jump to .model.json or .source.json file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.FRAMEWORK_JUMP_JSON,
        async () => {
          try {
            const currentPath = this.coder.getCurrentPath();
            if (!currentPath) {
              return;
            }
            const info = await this.coder.fetchFileInfoFromPath(currentPath);
            switch (info?.type) {
              case 'model': {
                await showOrOpenFile(
                  currentPath.replace(/\.sql$/, '.model.json'),
                  { viewColumn: vscode.ViewColumn.Beside },
                );
                break;
              }
              case 'yml': {
                if (info.properties?.sources) {
                  await showOrOpenFile(
                    currentPath.replace(/\.yml$/, '.source.json'),
                    { viewColumn: vscode.ViewColumn.Beside },
                  );
                } else {
                  await showOrOpenFile(
                    currentPath.replace(/\.yml$/, '.model.json'),
                    { viewColumn: vscode.ViewColumn.Beside },
                  );
                }
                break;
              }
            }
          } catch (err: unknown) {
            this.log.error('ERROR JUMPING FRAMEWORK: ', err);
          }
        },
      ),
    );

    // FRAMEWORK_JUMP_MODEL - jump to .sql model file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.FRAMEWORK_JUMP_MODEL,
        async () => {
          try {
            const currentPath = this.coder.getCurrentPath();
            if (!currentPath) {
              return;
            }
            await showOrOpenFile(
              currentPath.replace(/\.(model\.json|yml)$/, '.sql'),
              { viewColumn: vscode.ViewColumn.Beside },
            );
          } catch (err: unknown) {
            this.log.error('ERROR JUMPING FRAMEWORK: ', err);
          }
        },
      ),
    );

    // FRAMEWORK_JUMP_YAML - jump to .yml file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.FRAMEWORK_JUMP_YAML,
        async () => {
          try {
            const currentPath = this.coder.getCurrentPath();
            if (!currentPath) {
              return;
            }
            await showOrOpenFile(
              currentPath.replace(/\.(model\.json|source\.json|sql)$/, '.yml'),
              { viewColumn: vscode.ViewColumn.Beside },
            );
          } catch (err: unknown) {
            this.log.error('ERROR JUMPING FRAMEWORK: ', err);
          }
        },
      ),
    );
  }

  /**
   * Register utility commands - Sync, Clear Cache
   * @param context VS Code extension context
   */
  private registerUtilityCommands(context: vscode.ExtensionContext): void {
    // JSON_SYNC - sync all framework models and sources
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.JSON_SYNC, () => {
        this.log.info('Starting new json sync via queue');
        this.syncQueue.enqueueFullSync();
      }),
    );

    // CLEAR_SYNC_CACHE - clear framework sync cache
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.CLEAR_SYNC_CACHE, () => {
        this.handleClearSyncCache();
      }),
    );

    // PYTHON_MODEL_OPEN_NOTEBOOK - open ephemeral notebook for a .python.json / .python.py file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.PYTHON_MODEL_OPEN_NOTEBOOK,
        async (uri?: vscode.Uri) => {
          const filePath =
            uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
          if (!filePath) {
            return;
          }
          const jsonPath = filePath.replace(
            /\.python\.(json|py)$/,
            '.python.json',
          );
          await this.pythonModelSyncService?.openNotebook(jsonPath);
        },
      ),
    );
  }

  /**
   * Register code lens and definition providers
   * @param context VS Code extension context
   */
  registerProviders(context: vscode.ExtensionContext): void {
    this.log.info('Framework: Registering providers');

    // Code lens provider for *.source.json files
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        { pattern: '**/*.source.json' },
        {
          provideCodeLenses: (document, _token) => {
            const project = this.dbt.getProjectFromPath(document.uri.fsPath);
            if (!project) {
              return [];
            }

            const etlSources = this.state.etlSources;

            const documentText = document.getText();
            const sourceJson: FrameworkSource = jsonParse(documentText);
            const sourceDatabase = sourceJson.database;
            const sourceSchema = sourceJson.schema;

            const codeLenses: vscode.CodeLens[] = [];

            for (const sourceTable of sourceJson.tables || []) {
              const regex = new RegExp(`"name": "${sourceTable.name}"`);

              const matches = regex.exec(documentText);
              if (!matches) {
                continue;
              }
              const line = document.lineAt(
                document.positionAt(matches.index).line,
              );
              const indexOf = line.text.indexOf(matches[0]);
              const position = new vscode.Position(line.lineNumber, indexOf);
              const range = document.getWordRangeAtPosition(
                position,
                new RegExp(regex),
              );
              if (range) {
                const sourceId =
                  frameworkMakeSourcePrefix({
                    database: sourceDatabase,
                    schema: sourceSchema,
                    project,
                  }) +
                  '.' +
                  sourceTable.name;

                // Add refresh source as first code lens
                codeLenses.push(
                  new vscode.CodeLens(range, {
                    title: 'Refresh Source $(refresh)',
                    command: COMMAND_ID.SOURCE_REFRESH,
                    arguments: [{ sourceId }],
                  }),
                );

                const etlSource = etlSources.get(sourceId);
                if (etlSource) {
                  if (etlSource.etl_active) {
                    codeLenses.push(
                      new vscode.CodeLens(range, {
                        title: 'ETL Active $(pass-filled)',
                        command: '',
                      }),
                    );
                  } else {
                    // Use dbtSourcePropertiesString helper
                    const currentProperties = `${sourceDatabase}.${sourceSchema}.${sourceTable.name}`;
                    const registeredProperties = etlSource.properties;
                    const propertiesEqual =
                      currentProperties === registeredProperties;
                    if (propertiesEqual) {
                      codeLenses.push(
                        new vscode.CodeLens(range, {
                          title: 'Source Registered $(pass-filled)',
                          command: '',
                        }),
                      );
                    }
                  }
                }
              }
            }
            return codeLenses;
          },
        },
      ),
    );

    // Definition provider for *.model.json files
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(
        { pattern: '**/*.model.json' },
        {
          provideDefinition: (document, position, _token) => {
            const textLine = document.lineAt(position.line).text;

            const macroName = textLine.match(
              /{{ ((?:[A-z]|[0-9]|_|-|\.)+)\((?:.*)\) }}/,
            )?.[1];

            const modelName = textLine.match(
              /"((?:dim__|fct__|int__|mart__|src__|stg__)(?:[A-z]|[0-9]|_)+)"/,
            )?.[1];

            const sourceId = textLine.match(
              /"((?:[A-z]|[0-9]|_)+\.(?:[A-z]|[0-9]|_)+)"/,
            )?.[1];

            if (!(macroName || modelName || sourceId)) {
              return;
            }

            const project = this.dbt.getProjectFromPath(document.fileName);
            if (!project) {
              return;
            }

            if (macroName) {
              const macro =
                project.manifest?.macros?.[
                  `macro.${project.name}.${macroName}`
                ];
              if (!macro?.original_file_path) {
                return;
              }
              const macroPath = path.join(
                project.pathSystem,
                macro.original_file_path,
              );

              const fileLines = fs.readFileSync(macroPath, 'utf-8').split('\n');
              const macroLine = fileLines.findIndex((l) =>
                l.includes(`{% macro ${macroName}(`),
              );
              return new vscode.Location(
                vscode.Uri.file(macroPath),
                new vscode.Position(macroLine, 0),
              );
            } else if (modelName) {
              const modelId = `model.${project.name}.${modelName}`;
              const model = project.manifest?.nodes?.[modelId];
              if (!model?.original_file_path) {
                return;
              }
              const modelPath = path.join(
                project.pathSystem,
                model.original_file_path,
              );
              const jsonPath = modelPath.replace(/\.sql$/, '.model.json');
              return new vscode.Location(
                vscode.Uri.file(jsonPath),
                new vscode.Position(0, 0),
              );
            } else if (sourceId) {
              const sourceKey = `source.${project.name}.${sourceId}`;
              const source = project.manifest?.sources?.[sourceKey];
              if (!source?.original_file_path) {
                return;
              }
              const sourcePath = path.join(
                project.pathSystem,
                source.original_file_path,
              );

              let sourceLine = 0;
              const schemaName = sourceId.split('.')[0];
              const fileLines = fs
                .readFileSync(sourcePath, 'utf-8')
                .split('\n');
              const schemaStart = fileLines.findIndex((l) =>
                l.includes(`name: ${schemaName}`),
              );
              if (schemaStart >= 0) {
                const tableName = sourceId.split('.')[1];
                const tableStart = fileLines
                  .splice(schemaStart)
                  .findIndex((l) => l.includes(`name: ${tableName}`));
                if (tableStart >= 0) {
                  sourceLine = schemaStart + tableStart;
                }
              }
              return new vscode.Location(
                vscode.Uri.file(sourcePath),
                new vscode.Position(sourceLine, 0),
              );
            }
          },
        },
      ),
    );

    this.log.info('Framework: Providers registered successfully');
  }

  /**
   * Register event handlers
   * @param context VS Code extension context
   */
  registerEventHandlers(context: vscode.ExtensionContext): void {
    this.log.info('Framework: Registering event handlers');

    // Update view when document changes
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        const document = editor?.document;
        if (!document) {
          return;
        }
        try {
          await this.coder.handleTextDocument(document);
        } catch (err: unknown) {
          this.log.error('ERROR HANDLING DOCUMENT: ', err);
        }
      }),
    );

    this.log.info('Framework: Event handlers registered successfully');
  }

  /**
   * Builds a topologically sorted list of resources respecting dependencies.
   * Delegates to buildOrderedResources from @services/sync.
   *
   * @param project - The dbt project with manifest
   * @param rootIds - Optional specific resource IDs to start from
   * @returns Array of resources in topological order
   */
  getOrderedResources({
    project,
    rootIds,
  }: {
    project: DbtProject;
    rootIds?: string[];
  }): {
    id: string;
    pathJson: string;
    pathResource: string;
    type: DbtResourceType;
  }[] {
    // Delegate to the consolidated buildOrderedResources from sync module
    const syncResources = buildOrderedResources({ project, rootIds });

    // Map to the simpler return type (without depth and parentIds)
    return syncResources.map((r) => ({
      id: r.id,
      pathJson: r.pathJson,
      pathResource: r.pathResource,
      type: r.type,
    }));
  }

  async fetchModelJson(uri: vscode.Uri): Promise<FrameworkModel | null> {
    try {
      const match = /((?:[0-9]|[A-z]|-|_)+)\.model\.json$/.exec(uri.fsPath);
      if (!match) {
        return null;
      }
      return jsonParse(
        (await vscode.workspace.fs.readFile(uri)).toString(),
      ) as FrameworkModel;
    } catch {
      return null;
    }
  }

  async fetchSourceJson(uri: vscode.Uri): Promise<FrameworkSource | null> {
    try {
      const match = /((?:[0-9]|[A-z]|-|_)+)\.source\.json$/.exec(uri.fsPath);
      if (!match) {
        return null;
      }
      return jsonParse(
        (await vscode.workspace.fs.readFile(uri)).toString(),
      ) as FrameworkSource;
    } catch {
      return null;
    }
  }

  async handleGenerateModelFiles(info: CoderFileInfo): Promise<void> {
    this.log.debug('🏗️ HANDLE GENERATE MODEL FILES STARTED');

    if (info?.type !== 'framework-model') {
      this.log.error(
        `❌ INVALID INFO TYPE: ${info?.type}, expected 'framework-model'`,
      );
      return;
    }

    const { filePath, modelJson, project } = info;
    const uri = vscode.Uri.file(filePath);

    // Get model ID
    const modelId = frameworkGetModelId({ modelJson, project });
    if (!modelId) {
      this.log.error('❌ MODEL ID NOT FOUND:', modelJson.name);
      vscode.window.showErrorMessage('Model Not Found');
      this.log.error('❌ MODEL NOT FOUND:', modelJson.name);
      this.log.show(true);
      return;
    }

    // Enqueue sync via state-driven queue
    this.syncQueue.enqueue(modelId);
  }

  /**
   * Processes target folders specified in config and adds tests to all qualifying models
   * Called on workspace activation
   */
  async processTargetFolders(): Promise<void> {
    this.log.info('🚀 Starting processTargetFolders...');

    const autoGenerateTestsConfig = getDjConfig().autoGenerateTests;

    this.log.info(`📋 Config read: ${JSON.stringify(autoGenerateTestsConfig)}`);

    // Check if the feature is disabled
    if (autoGenerateTestsConfig.enabled === false) {
      this.log.info(
        '⏭️  Auto-generate tests feature is disabled. Skipping processTargetFolders.',
      );
      return;
    }

    // Collect all target folders from enabled tests
    const allTargetFolders = new Set<string>();

    // Add folders from equalRowCount test
    if (autoGenerateTestsConfig?.tests?.equalRowCount?.enabled) {
      const folders =
        autoGenerateTestsConfig.tests.equalRowCount.targetFolders ?? [];
      folders.forEach((f) => allTargetFolders.add(f));
    }

    // Add folders from equalOrLowerRowCount test
    if (autoGenerateTestsConfig.tests?.equalOrLowerRowCount?.enabled) {
      const folders =
        autoGenerateTestsConfig.tests.equalOrLowerRowCount.targetFolders ?? [];
      folders.forEach((f) => allTargetFolders.add(f));
    }

    if (allTargetFolders.size === 0) {
      this.log.info(
        '⏭️  No target folders configured for bulk test generation',
      );
      return;
    }

    this.log.info(
      `🔍 Processing ${allTargetFolders.size} target folder(s) for bulk test generation...`,
    );

    // Process target folders for each dbt project
    for (const [projectName, project] of this.dbt.projects) {
      this.log.info(
        `📦 Checking project: ${projectName} (${project.pathSystem})`,
      );

      for (const relativeFolder of allTargetFolders) {
        // Resolve path relative to the dbt project, not workspace root
        const folderPath = path.join(project.pathSystem, relativeFolder);

        if (!fs.existsSync(folderPath)) {
          this.log.info(
            `  ⏭️  Folder not found in this project: ${relativeFolder}`,
          );
          continue;
        }

        this.log.info(
          `  📁 Processing folder: ${relativeFolder} (${folderPath})`,
        );
        await this.addTestsToFolder(folderPath, relativeFolder);
      }
    }

    this.log.info('✅ Finished processing all target folders');
  }

  /**
   * Adds equal_row_count tests to all models in a specific folder
   * Only affects int_join_models and mart_join_models with LEFT joins
   */
  private async addTestsToFolder(
    folderPath: string,
    displayPath: string,
  ): Promise<void> {
    // Find all .model.json files in the folder
    const pattern = new vscode.RelativePattern(folderPath, '**/*.model.json');
    this.log.info(
      `  🔎 Searching with pattern: ${pattern.pattern} in ${pattern.baseUri.fsPath}`,
    );
    const modelFiles = await vscode.workspace.findFiles(pattern);

    this.log.info(`  📊 Found ${modelFiles.length} model files`);

    if (modelFiles.length === 0) {
      this.log.info(`  ℹ️  No model files found in ${displayPath}`);
      return;
    }

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const autoGenerateTestsConfig = getDjConfig().autoGenerateTests;

    for (const fileUri of modelFiles) {
      try {
        const content = await fs.promises.readFile(fileUri.fsPath, 'utf8');
        const modelJson = jsonParse(content) as FrameworkModel;

        this.log.info(
          `  📝 Processing ${modelJson.name} (type: ${modelJson.type})`,
        );

        // Only process join models
        if (
          modelJson.type !== 'int_join_models' &&
          modelJson.type !== 'mart_join_models'
        ) {
          this.log.info(`    ⏭️  Skipped - not a join model`);
          skippedCount++;
          continue;
        }

        // Skip if tests already exist
        if (
          (modelJson as any).data_tests &&
          (modelJson as any).data_tests.length > 0
        ) {
          this.log.info(
            `    ⏭️  Skipped - already has ${(modelJson as any).data_tests.length} test(s)`,
          );
          skippedCount++;
          continue;
        }

        // Generate tests
        const autoTests = generateAutoTests(
          modelJson.from,
          autoGenerateTestsConfig,
        );

        this.log.info(`    🧪 Generated ${autoTests.length} test(s)`);

        if (autoTests.length > 0) {
          const edits = modify(content, ['data_tests'], autoTests, {
            formattingOptions: { tabSize: 4, insertSpaces: true, eol: '\n' },
          });
          const updatedContent = applyEdits(content, edits);
          await fs.promises.writeFile(fileUri.fsPath, updatedContent, 'utf8');

          this.log.info(`    ✅ Added test(s) to ${modelJson.name}`);
          processedCount++;
        } else {
          this.log.info(`    ⏭️  Skipped - no LEFT joins found`);
          skippedCount++;
        }
      } catch (err: unknown) {
        this.log.error(`  ❌ Error processing ${fileUri.fsPath}:`, err);
        errorCount++;
      }
    }

    this.log.info(
      `  📊 ${displayPath}: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors`,
    );
  }

  async handleGenerateSourceFiles(info: CoderFileInfo): Promise<void> {
    if (info?.type !== 'framework-source') {
      return;
    }
    const { filePath, project, sourceJson } = info;
    const uri = vscode.Uri.file(filePath);

    // Get source IDs
    const sourceIds = frameworkGetSourceIds({ project, sourceJson });
    if (!sourceIds?.length) {
      vscode.window.showWarningMessage('Source has no tables');
      this.log.error('NO SOURCE TABLES');
      return;
    }

    // Enqueue syncs via state-driven queue
    for (const id of sourceIds) {
      this.syncQueue.enqueue(id);
    }
  }

  /**
   * Handles JSON sync operation with optimized parallel processing.
   *
   * Key optimizations:
   * 1. Uses Map for O(1) URI lookups instead of array.find()
   * 2. Uses async file reads instead of sync fs.readFileSync()
   * 3. Groups resources by dependency level for parallel processing
   * 4. Batches file writes using Promise.all()
   *
   * @param roots - Optional specific resources to sync (IDs only, pathJson resolved from manifest)
   */
  async handleJsonSync({ roots }: { roots?: SyncRoot[] }): Promise<SyncResult> {
    const timestamp = new Date().toISOString();
    this.log.info(`DJ SYNC STARTED - Timestamp: ${timestamp}`);
    this.log.info(`SYNC ROOTS: ${roots ? JSON.stringify(roots) : 'ALL FILES'}`);

    // Lock model files if syncing specific roots
    if (roots) {
      for (const root of roots) {
        if (root.pathJson) {
          this.lockedModelFiles.add(root.pathJson);
        }
      }
    }

    let syncResult: SyncResult | undefined;

    await vscode.window.withProgress(
      {
        title: 'DJ Sync',
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
      },
      async (progress) => {
        const lastReportedPercent = { current: 0 };

        // Find all JSON files
        progress.report({
          increment: 0,
          message: 'Finding models and sources...',
        });
        const jsonUris = await vscode.workspace.findFiles(
          '**/*.{model,source}.json',
        );

        try {
          // Process each dbt project
          for (const _project of this.dbt.projects.values()) {
            // Read auto-test generation config
            const autoGenerateTestsConfig = getDjConfig().autoGenerateTests;

            // Create the SyncEngine
            const engine = new SyncEngine(
              {
                extensionConfig: getDjConfig(),
                logger: this.log,
                enableChangeDetection: this.enableChangeDetection,
                parallelBatchSize: SYNC_BATCH_SIZES.RESOURCE_PROCESSING,
                enableValidation: true,
              },
              this.createSyncCallbacks(progress, lastReportedPercent),
              {
                ajv: this.ajv,
                sourceValidator: this.validateSourceJson,
                autoGenerateTestsConfig,
              },
            );

            // Execute the sync engine
            const result = await engine.execute({
              project: _project,
              jsonUris,
              cacheManager: this.cacheManager,
              roots,
              lastFileChange: this.coder.lastFileChange,
              forceReparse: this.lastSyncHadRenames,
              autoGenerateTestsConfig,
              parseManifest: async (project) => {
                const manifest = await this.getApi().handleApi({
                  type: 'dbt-parse-project',
                  request: {
                    logger: this.log,
                    project,
                  },
                });
                // Type assertion: parseManifest should return DbtProjectManifest
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return manifest as any;
              },
              fetchManifest: async (project) => {
                const manifest = await this.dbt.fetchManifest({ project });
                // Type assertion: fetchManifest should return DbtProjectManifest
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return manifest as any;
              },
            });

            // Log sync results
            this.log.info(
              'Sync result: ' +
                result.stats.processedResources +
                ' processed, ' +
                result.stats.skippedResources +
                ' skipped in ' +
                result.stats.totalTimeMs +
                'ms',
            );

            // Show validation errors to user
            if (result.errors.length > 0) {
              const validationErrors = result.errors.filter(
                (e) => e.message && !e.message.includes('Error processing'),
              );

              if (validationErrors.length > 0) {
                // Show warning with option to open Problems panel if any occurred
                vscode.window
                  .showWarningMessage(
                    `DJ Sync: ${validationErrors.length} validation error(s) found`,
                    'Show Problems',
                    'Dismiss',
                  )
                  .then((selection) => {
                    if (selection === 'Show Problems') {
                      // Open the Problems panel
                      vscode.commands.executeCommand(
                        'workbench.action.problems.focus',
                      );
                    }
                  });

                // Log to output for reference
                this.log.warn(
                  `Validation errors (${validationErrors.length}):`,
                );
                validationErrors.forEach((e) => {
                  this.log.warn(`  - ${e.resourceId}: ${e.message}`);
                });
              }
            }

            // Handle post-sync manifest refresh
            await this.handlePostSyncManifestRefresh(
              result,
              _project,
              progress,
            );

            // Old tab closing and file cleanup for renames is now handled by
            // the onCleanupRenamedFiles callback in SyncQueue.processNext(),
            // which runs after the sync completes at a deterministic point.

            syncResult = result;

            // Track whether this sync had renames so the next sync
            // forces a manifest reparse for fresh dependency data.
            // The flag is set when renames occur, and cleared once the
            // next sync has had a chance to run (consumed the flag).
            // The disk-based conflict check in RenameHandler handles
            // correctness even if the forced reparse fails.
            if (result.renames.length > 0) {
              this.lastSyncHadRenames = true;
            } else if (!result.aborted) {
              this.lastSyncHadRenames = false;
            }
          }

          const completionTimestamp = new Date().toISOString();
          this.log.info(
            `DJ SYNC COMPLETE - Started: ${timestamp}, Completed: ${completionTimestamp}`,
          );
        } catch (err: unknown) {
          const errorTimestamp = new Date().toISOString();
          this.log.error(
            `DJ SYNC ERROR - Started: ${timestamp}, Failed: ${errorTimestamp}`,
            err,
          );
          this.log.show(true);
        } finally {
          this.lockedModelFiles.clear();

          const finishTimestamp = new Date().toISOString();
          this.log.info(
            `DJ SYNC PROCESS FINISHED - Started: ${timestamp}, Finished: ${finishTimestamp}`,
          );
        }
      },
    );

    return (
      syncResult ?? {
        success: false,
        stats: {
          processedResources: 0,
          skippedResources: 0,
          totalResources: 0,
          dependencyLevels: 0,
          maxParallelism: 0,
        },
        renames: [],
        errors: [],
      }
    );
  }

  async handleLoadEtlSources({ project }: { project: DbtProject }) {
    const etlSourcesResponse = await this.getApi().handleApi({
      type: 'trino-fetch-etl-sources',
      request: {
        projectName: project.name,
        etlSchema: project.properties.vars?.etl_schema,
      },
    });

    // Type guard: ensure we have an array of FrameworkEtlSource
    if (Array.isArray(etlSourcesResponse)) {
      for (const etlSource of etlSourcesResponse) {
        // Type assertion for union type narrowing
        const source = etlSource as any;
        if (source && typeof source === 'object' && 'source_id' in source) {
          this.state.etlSources.set(source.source_id, source);
        }
      }
    }
  }

  /**
   * Initializes file watchers for automatic cache invalidation.
   * Watches JSON, SQL and YML files to invalidate cache when they're modified or deleted.
   */
  private initializeFileWatchers() {
    // Watch JSON files
    this.jsonFileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{model.json,source.json}',
    );
    this.jsonFileWatcher.onDidChange(this.handleJsonChange.bind(this));
    this.jsonFileWatcher.onDidDelete(this.handleJsonChange.bind(this));

    // Watch SQL files (excluding dbt_packages, node_modules, etc.)
    this.sqlFileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.sql',
      false,
      false,
      false,
    );
    this.sqlFileWatcher.onDidChange((uri) => {
      if (!this.shouldExcludePath(uri.fsPath)) {
        this.handleSqlChange(uri);
      }
    });
    this.sqlFileWatcher.onDidDelete((uri) => {
      if (!this.shouldExcludePath(uri.fsPath)) {
        this.handleSqlChange(uri);
      }
    });

    // Watch YML files (excluding dbt_packages, node_modules, etc.)
    this.ymlFileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.yml',
      false,
      false,
      false,
    );
    this.ymlFileWatcher.onDidChange((uri) => {
      if (!this.shouldExcludePath(uri.fsPath)) {
        this.handleYmlChange(uri);
      }
    });
    this.ymlFileWatcher.onDidDelete((uri) => {
      if (!this.shouldExcludePath(uri.fsPath)) {
        this.handleYmlChange(uri);
      }
    });

    // Initialize Python model sync service
    this.pythonModelSyncService = new PythonModelSyncService({
      info: (msg, ...args) => this.log.info(msg, ...args),
      error: (msg, ...args) => this.log.error(msg, ...args),
      warn: (msg, ...args) => this.log.warn(msg, ...args),
    });
    this.pythonModelSyncService.initialize();

    this.log.info('File watchers initialized for cache invalidation');
  }

  /**
   * Checks if a file path should be excluded from cache invalidation.
   * Uses FRAMEWORK_JSON_SYNC_EXCLUDE_PATHS patterns.
   */
  private shouldExcludePath(filePath: string): boolean {
    return FRAMEWORK_JSON_SYNC_EXCLUDE_PATHS.some((pattern) => {
      // Convert glob pattern to regex
      // **/ at start means match anywhere in path
      // /** at end means match this directory and all subdirectories
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\//g, '\\/');
      const regex = new RegExp(regexPattern);
      return regex.test(filePath);
    });
  }

  /**
   * Handles JSON file changes or deletions.
   * Invalidates the cache for the JSON file itself to force regeneration.
   */
  private handleJsonChange(uri: vscode.Uri) {
    this.cacheManager.invalidate(uri.fsPath);
    this.log.debug(`Cache invalidated for ${uri.fsPath} (JSON changed)`);
  }

  /**
   * Handles SQL file changes or deletions.
   * Invalidates the cache for the corresponding model.json file.
   */
  private handleSqlChange(uri: vscode.Uri) {
    // Convert foo/bar/model_name.sql -> foo/bar/model_name.model.json
    const jsonPath = uri.fsPath.replace(/\.sql$/, '.model.json');
    this.cacheManager.invalidate(jsonPath);
    this.log.debug(`Cache invalidated for ${jsonPath} (SQL changed)`);
  }

  /**
   * Handles YML file changes or deletions.
   * Invalidates the cache for corresponding model.json or source.json files.
   */
  private handleYmlChange(uri: vscode.Uri) {
    // Could be model.yml or source.yml
    const modelJsonPath = uri.fsPath.replace(/\.yml$/, '.model.json');
    const sourceJsonPath = uri.fsPath.replace(/\.yml$/, '.source.json');

    // Try both - invalidate() is safe if entry doesn't exist
    this.cacheManager.invalidate(modelJsonPath);
    this.cacheManager.invalidate(sourceJsonPath);
    this.log.debug(`Cache invalidated for ${uri.fsPath} (YML changed)`);
  }

  /**
   * Clears the entire sync cache.
   * Useful for debugging or forcing a full regeneration.
   */
  handleClearSyncCache() {
    this.cacheManager.clear();
    vscode.window.showInformationMessage('JSON sync cache cleared');
    this.log.info('Sync cache manually cleared');
  }

  /**
   * Creates SyncEngine callbacks for VS Code integration.
   *
   * Extracted from handleJsonSync to improve readability and testability.
   *
   * @param progress - VS Code progress reporter for UI updates
   * @param lastReportedPercent - Closure variable to track progress reporting
   * @returns SyncCallbacks object with handlers for sync lifecycle events
   */
  private createSyncCallbacks(
    progress: vscode.Progress<{ increment?: number; message?: string }>,
    lastReportedPercent: { current: number },
  ): SyncCallbacks {
    return {
      // Report progress updates
      onProgress: (msg) => {
        // Parse percentage from message like "94/692 resources processed (14%)"
        const percentMatch = msg.match(/\((\d+)%\)/);
        if (percentMatch) {
          const currentPercent = parseInt(percentMatch[1], 10);
          const increment = currentPercent - lastReportedPercent.current;

          if (increment > 0) {
            progress.report({
              increment,
              message: msg,
            });
            lastReportedPercent.current = currentPercent;
          }
        } else {
          // No percentage in message, just update message
          progress.report({ increment: 0, message: msg });
        }
      },

      // Handle model/source validation errors with per-error diagnostics
      onModelValidationError: (uri, message, errors, jsonContent) => {
        const diagnostics = resolveValidationDiagnostics(
          message,
          errors,
          jsonContent,
        );
        this.diagnosticModelJson.set(uri, diagnostics);
      },

      onModelValidationWarning: (uri, message, errors, jsonContent) => {
        const diagnostics = resolveValidationDiagnostics(
          message,
          errors,
          jsonContent,
          vscode.DiagnosticSeverity.Warning,
        );
        this.diagnosticModelJson.set(uri, diagnostics);
      },

      // Handle generation errors
      onGenerationError: (uri, modelName, error) => {
        const message = ERROR_MESSAGES.INVALID_MODEL_SQL(error.message);
        this.diagnosticModelJson.set(uri, [
          new vscode.Diagnostic(new vscode.Range(0, 0, 100, 0), message),
        ]);
        vscode.window.showErrorMessage(message);
      },

      // Clear diagnostics on success
      onDiagnosticsClear: (uri) => {
        this.diagnosticModelJson.delete(uri);
      },

      // Handle rename conflicts
      onRenameConflict: (oldName, newName) => {
        const errorMessage =
          "A model named '" +
          newName +
          "' already exists, please update name inputs.";
        vscode.window.showErrorMessage(errorMessage);
        return false; // Abort sync
      },

      // Set up watcher suppression BEFORE file operations execute.
      // Also clear any pending debounce timers for paths being touched,
      // preventing stale timers from firing after a rename.
      onBeforeFileOps: (operations) => {
        this.syncQueue.recordOpsForSuppression(operations);
        this.coder.clearPendingTimersForPaths(this.syncQueue.getManagedPaths());
      },
    };
  }

  /**
   * Wrapper that runs handleJsonSync within vscode.window.withProgress.
   * This is the callback provided to SyncQueue.
   */
  private async runSyncWithProgress(roots?: SyncRoot[]): Promise<SyncResult> {
    try {
      return await this.handleJsonSync({ roots });
    } catch (err: unknown) {
      this.log.error('Error during sync', err);
      return {
        success: false,
        stats: {
          processedResources: 0,
          skippedResources: 0,
          totalResources: 0,
          dependencyLevels: 0,
          maxParallelism: 0,
        },
        renames: [],
        errors: [],
      };
    }
  }

  /**
   * Handles post-sync manifest refresh logic.
   *
   * After processing resources, we need to refresh the manifest to reflect changes.
   * The strategy depends on what changed:
   * - If renames occurred: await manifest reparse (blocks to ensure consistency)
   * - If resources processed: background reparse (non-blocking optimization)
   * - If nothing changed: skip reparse
   *
   * @param result - Result from SyncEngine.execute()
   * @param project - The dbt project that was synced
   * @param progress - VS Code progress reporter for UI updates
   */
  /**
   * Get list of available DAG files from the dags/ directory.
   * Recursively scans all subdirectories for Python files.
   * Checks both workspace root and dbt project-relative paths.
   */
  private async handleGetAvailableDags(
    payload: ApiPayload<'framework'> & { type: 'framework-get-available-dags' },
  ): Promise<ApiResponse<'framework-get-available-dags'>> {
    const { projectName } = payload.request;

    const project = this.dbt.projects.get(projectName);
    if (!project) {
      this.log.warn(`Project not found: ${projectName}`);
      return { dags: [] };
    }

    this.log.info(
      `[DAG Discovery] project="${projectName}", projectPath="${project.pathSystem}"`,
    );

    const dags: string[] = [];
    const seenDags = new Set<string>();

    const scanForDags = async (dirPath: string) => {
      this.log.info(`[DAG Discovery] Scanning: ${dirPath}`);
      try {
        const entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(dirPath),
        );
        const pyFiles = entries.filter(
          ([fn, ft]) =>
            ft === vscode.FileType.File &&
            fn.endsWith('.py') &&
            !fn.startsWith('__'),
        );
        this.log.info(
          `[DAG Discovery]   Found ${pyFiles.length} .py files in ${dirPath}`,
        );

        for (const [fileName] of pyFiles) {
          const dagName = fileName.replace('.py', '');
          if (seenDags.has(dagName)) {
            this.log.info(`[DAG Discovery]   Skip duplicate: ${dagName}`);
            continue;
          }

          try {
            const content = await vscode.workspace.fs.readFile(
              vscode.Uri.file(path.join(dirPath, fileName)),
            );
            const text = Buffer.from(content).toString();
            const hasDag = text.includes('@dag') || text.includes('DAG(');
            if (hasDag) {
              dags.push(dagName);
              seenDags.add(dagName);
              this.log.info(`[DAG Discovery]   + ${dagName} (DAG detected)`);
            } else {
              this.log.info(`[DAG Discovery]   - ${dagName} (no DAG marker)`);
            }
          } catch (readErr) {
            this.log.warn(
              `[DAG Discovery]   ! ${dagName} (read error: ${readErr})`,
            );
          }
        }
      } catch {
        this.log.info(`[DAG Discovery]   Directory not found: ${dirPath}`);
      }
    };

    // 1. Workspace root dags/ folder and its _ext_ subfolder
    const workspaceDagsPath = path.join(WORKSPACE_ROOT, 'dags');
    await scanForDags(workspaceDagsPath);
    await scanForDags(path.join(workspaceDagsPath, '_ext_'));

    // 2. If dbt project is in a subfolder, also check parent dags/ folder
    const projectParentDags = path.resolve(project.pathSystem, '..');
    if (
      projectParentDags !== workspaceDagsPath &&
      projectParentDags.endsWith('dags')
    ) {
      await scanForDags(projectParentDags);
      await scanForDags(path.join(projectParentDags, '_ext_'));
    }

    // 3. Also check project-relative dags/ folder
    const projectDagsPath = path.join(project.pathSystem, 'dags');
    if (
      projectDagsPath !== workspaceDagsPath &&
      projectDagsPath !== projectParentDags
    ) {
      await scanForDags(projectDagsPath);
      await scanForDags(path.join(projectDagsPath, '_ext_'));
    }

    this.log.info(
      `[DAG Discovery] Result: ${dags.length} DAGs [${dags.join(', ')}]`,
    );
    return { dags };
  }

  /**
   * Ensure python_models/_config.py exists in dags/python_models/.
   * Creates the shared PythonModelConfig module if missing.
   */
  private async ensurePythonModelConfigPy(): Promise<void> {
    const configDir = path.join(WORKSPACE_ROOT, 'dags', 'python_models');
    const configPath = path.join(configDir, '_config.py');

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(configPath));
      return; // already exists
    } catch {
      // does not exist, create it
    }

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(configDir));

      // Also create __init__.py so python_models is importable as a package
      const initPath = path.join(configDir, '__init__.py');
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(initPath));
      } catch {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(initPath),
          Buffer.from(''),
        );
      }

      const content = generatePythonModelConfigPy();
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(configPath),
        Buffer.from(content),
      );
      this.log.info(`Generated python_models/_config.py at: ${configPath}`);
    } catch (err) {
      this.log.warn(
        `Could not generate python_models/_config.py: ${String(err)}`,
      );
    }
  }

  /**
   * Ensure etl_helper.py exists in the DAGs _ext_ directory.
   * Copies from the extension's airflow template if missing.
   * This runs independently of dj.airflowGenerateDags setting.
   */
  private async ensureEtlHelperFile(): Promise<void> {
    const { airflowDagsPath, airflowTargetVersion } = getDjConfig();

    // Check possible locations for etl_helper.py
    const possibleTargets: string[] = [];

    if (airflowDagsPath) {
      possibleTargets.push(
        path.join(WORKSPACE_ROOT, airflowDagsPath, 'etl_helper.py'),
      );
    }
    possibleTargets.push(
      path.join(WORKSPACE_ROOT, 'dags', '_ext_', 'etl_helper.py'),
    );

    // Check if etl_helper.py already exists in any location
    for (const target of possibleTargets) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(target));
        this.log.info(`etl_helper.py already exists at: ${target}`);
        return;
      } catch {
        // Not found, continue
      }
    }

    // Determine source template
    const versionFolder = airflowTargetVersion === '2.10' ? 'v2_10' : 'v2_7';
    const templatePath = path.join(
      BASE_AIRFLOW_PATH,
      versionFolder,
      'etl_helper.py',
    );

    // Determine best target: prefer airflowDagsPath, then workspace dags/_ext_/
    let targetPath = possibleTargets[0];
    if (airflowDagsPath) {
      targetPath = path.join(WORKSPACE_ROOT, airflowDagsPath, 'etl_helper.py');
    }

    try {
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(templatePath),
      );
      // Ensure target directory exists
      const targetDir = path.dirname(targetPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), content);
      this.log.info(`Generated etl_helper.py at: ${targetPath}`);
    } catch (err) {
      this.log.warn(`Could not generate etl_helper.py: ${String(err)}`);
    }
  }

  /**
   * Ensure __init__.py files exist in python_models/ and its subdirectories.
   * This makes python_models a proper Python package for absolute imports.
   */
  private async ensurePythonModelsInitFiles(
    group: string,
    topic: string,
  ): Promise<void> {
    const pythonModelsDir = path.join(WORKSPACE_ROOT, 'dags', 'python_models');
    const groupDir = path.join(pythonModelsDir, group);
    const topicDir = path.join(groupDir, topic);

    const dirsToCheck = [pythonModelsDir, groupDir, topicDir];

    for (const dir of dirsToCheck) {
      const initPath = path.join(dir, '__init__.py');
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(initPath));
      } catch {
        try {
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(initPath),
            Buffer.from(''),
          );
          this.log.info(`Created __init__.py at: ${initPath}`);
        } catch (err) {
          this.log.warn(
            `Could not create __init__.py at ${initPath}: ${String(err)}`,
          );
        }
      }
    }
  }

  /**
   * Ensure dags/.airflowignore exists with patterns to exclude Python model files.
   * This prevents Airflow from treating .python.py files as DAGs.
   */
  private async ensureAirflowIgnoreFile(): Promise<void> {
    const airflowIgnorePath = path.join(
      WORKSPACE_ROOT,
      'dags',
      '.airflowignore',
    );

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(airflowIgnorePath));
      // File exists, check if it has our patterns
      const content = Buffer.from(
        await vscode.workspace.fs.readFile(vscode.Uri.file(airflowIgnorePath)),
      ).toString();

      const requiredPatterns = [
        '.*\\.python\\.py$',
        'python_models/_config\\.py$',
        'python_models/.*/_helpers\\.py$',
        'python_models/.*/__init__\\.py$',
      ];

      const missingPatterns = requiredPatterns.filter(
        (pattern) => !content.includes(pattern),
      );

      if (missingPatterns.length > 0) {
        const updatedContent =
          content.trimEnd() + '\n' + missingPatterns.join('\n') + '\n';
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(airflowIgnorePath),
          Buffer.from(updatedContent),
        );
        this.log.info(`Updated .airflowignore with missing patterns`);
      }
      return;
    } catch {
      // File doesn't exist, create it
    }

    const airflowIgnoreContent = `# Auto-generated by DJ Framework
# Patterns to exclude Python model files from Airflow DAG discovery

.*\\.python\\.py$
python_models/_config\\.py$
python_models/.*/_helpers\\.py$
python_models/.*/__init__\\.py$
`;

    try {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(airflowIgnorePath),
        Buffer.from(airflowIgnoreContent),
      );
      this.log.info(`Generated .airflowignore at: ${airflowIgnorePath}`);
    } catch (err) {
      this.log.warn(`Could not generate .airflowignore: ${String(err)}`);
    }
  }

  /**
   * Generate a clean, empty Airflow DAG file (start_etl -> end_etl skeleton).
   * Used by the standalone "Create DAG" form.
   */
  private async generateEmptyDagFile(dagConfig: {
    name: string;
    schedule?: string;
    tags?: string[];
    description?: string;
  }): Promise<string> {
    const dagName = dagConfig.name;
    const schedule = dagConfig.schedule || '@daily';
    const tagsList =
      dagConfig.tags && dagConfig.tags.length > 0 ? dagConfig.tags : ['etl'];
    const tagsLiteral = JSON.stringify(tagsList);
    const fnName = dagName.replace(/[^a-zA-Z0-9_]/g, '_') + '_dag';
    const desc = dagConfig.description ? `\n# ${dagConfig.description}\n` : '';

    const dagFilePath = path.join(WORKSPACE_ROOT, 'dags', `${dagName}.py`);

    // Check if DAG file already exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(dagFilePath));
      throw new Error(`DAG '${dagName}' already exists at dags/${dagName}.py`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw err;
      }
    }

    const dagContent = `from airflow.decorators import dag, task
from airflow.utils.trigger_rule import TriggerRule
from datetime import datetime, timedelta, timezone
${desc}

@dag(
    catchup=False,
    dag_id="${dagName}",
    default_args={
        "owner": "airflow",
        "retries": 0,
        "retry_delay": timedelta(minutes=1),
        "start_date": datetime(2021, 1, 1, tzinfo=timezone.utc),
    },
    max_active_runs=1,
    schedule="${schedule}",
    start_date=datetime(1970, 1, 1),
    tags=${tagsLiteral},
)
def ${fnName}():

    @task(task_id="start_etl")
    def start_etl(**context):
        print(f"Starting ${dagName} ETL: {context['ds']}")

    @task(task_id="end_etl", trigger_rule=TriggerRule.ALL_DONE)
    def end_etl(**context):
        print(f"Completed ${dagName} ETL: {context['ds']}")

    # Sequence tasks
    _start = start_etl()
    _end = end_etl()

    _start >> _end


etl = ${fnName}()
`;

    const dagsDir = path.dirname(dagFilePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dagsDir));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(dagFilePath),
      Buffer.from(dagContent),
    );

    this.log.info(`Generated empty DAG file: ${dagFilePath}`);
    return dagFilePath;
  }

  /**
   * Generate a new minimal Airflow DAG file with Python model tasks via
   * register_python_model_tasks (start_etl -> python models -> end_etl).
   */
  private async generateDagFile(
    project: DbtProject,
    dagConfig: { name: string; schedule?: string; tags?: string[] },
  ): Promise<void> {
    const dagName = dagConfig.name;
    const schedule = dagConfig.schedule || '@daily';
    const tagsList =
      dagConfig.tags && dagConfig.tags.length > 0
        ? dagConfig.tags
        : ['python-model'];
    const tagsLiteral = JSON.stringify(tagsList);

    const dagFilePath = path.join(WORKSPACE_ROOT, 'dags', `${dagName}.py`);

    // Check if DAG file already exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(dagFilePath));
      this.log.info(
        `DAG file already exists at ${dagFilePath}, skipping generation`,
      );
      return;
    } catch {
      // File doesn't exist -- proceed
    }

    // Also check project-relative dags/
    const projectDagPath = path.join(project.pathSystem, '..', `${dagName}.py`);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(projectDagPath));
      this.log.info(
        `DAG file already exists at ${projectDagPath}, skipping generation`,
      );
      return;
    } catch {
      // proceed
    }

    const dagContent = `from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.utils.trigger_rule import TriggerRule
from datetime import datetime, timedelta, timezone
from _ext_.etl_helper import register_python_model_tasks

default_args = {
    "owner": "airflow",
    "retries": 0,
    "retry_delay": timedelta(minutes=1),
    "start_date": datetime(2021, 1, 1, tzinfo=timezone.utc),
}

with DAG(
    catchup=False,
    dag_id="${dagName}",
    default_args=default_args,
    max_active_runs=1,
    schedule="${schedule}",
    start_date=datetime(1970, 1, 1),
    tags=${tagsLiteral},
) as dag:

    def _start_etl(**context):
        print(f"Starting ${dagName} ETL: {context['ds']}")

    def _end_etl(**context):
        print(f"Completed ${dagName} ETL: {context['ds']}")

    start_etl = PythonOperator(
        task_id="start_etl",
        python_callable=_start_etl,
        dag=dag,
    )
    end_etl = PythonOperator(
        task_id="end_etl",
        python_callable=_end_etl,
        trigger_rule=TriggerRule.ALL_DONE,
        dag=dag,
    )

    entry_tasks, exit_tasks = register_python_model_tasks("${dagName}", dag)

    if entry_tasks and exit_tasks:
        start_etl >> entry_tasks
        exit_tasks >> end_etl
    else:
        start_etl >> end_etl
`;

    // Ensure dags/ directory exists
    const dagsDir = path.dirname(dagFilePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dagsDir));

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(dagFilePath),
      Buffer.from(dagContent),
    );

    this.log.info(`Generated new DAG file: ${dagFilePath}`);
  }

  /**
   * Inject register_python_model_tasks wiring into an existing DAG file.
   * This is called when a Python model is created and mapped to a DAG.
   * The method checks if the wiring already exists and only adds it if not present.
   * @param dagName - Can be a simple name (e.g., "source_etl") or a relative path (e.g., "_ext_/source_etl")
   */
  private async injectPythonModelTasksIntoDag(
    project: DbtProject,
    dagName: string,
  ): Promise<void> {
    // Build list of possible DAG file locations
    // dagName may contain path separators if from subdirectory (e.g., "_ext_/source_etl")
    const possiblePaths: string[] = [
      // Direct path under workspace dags/
      path.join(WORKSPACE_ROOT, 'dags', `${dagName}.py`),
      // Direct path under project dags/
      path.join(project.pathSystem, 'dags', `${dagName}.py`),
    ];

    // If dagName doesn't contain path separator, also check _ext_ and root
    if (!dagName.includes('/') && !dagName.includes(path.sep)) {
      possiblePaths.push(
        path.join(WORKSPACE_ROOT, 'dags', '_ext_', `${dagName}.py`),
        path.join(project.pathSystem, 'dags', '_ext_', `${dagName}.py`),
      );
    }

    this.log.info(
      `Looking for DAG file "${dagName}.py" in: ${possiblePaths.join(', ')}`,
    );

    let dagFilePath: string | null = null;
    for (const p of possiblePaths) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(p));
        dagFilePath = p;
        this.log.info(`Found DAG file at: ${p}`);
        break;
      } catch {
        // File doesn't exist, try next path
      }
    }

    if (!dagFilePath) {
      this.log.warn(
        `Could not find DAG file for: ${dagName}. Searched paths: ${possiblePaths.join(', ')}. ` +
          `Configure dj.airflowDagsPath setting if your DAGs are in a custom location.`,
      );
      vscode.window.showWarningMessage(
        `DAG file "${dagName}.py" not found. Configure dj.airflowDagsPath if needed.`,
      );
      return;
    }

    // Read the DAG file
    const dagContent = await vscode.workspace.fs.readFile(
      vscode.Uri.file(dagFilePath),
    );
    let dagCode = Buffer.from(dagContent).toString();

    // Check if python_models wiring already exists
    if (dagCode.includes('register_python_model_tasks(')) {
      this.log.info(
        `DAG ${dagName} already has register_python_model_tasks wiring`,
      );
      return;
    }

    // Find import section and add etl_helper import if not present
    if (
      !dagCode.includes('from _ext_.etl_helper import') &&
      !dagCode.includes('from python_models import') &&
      !dagCode.includes('from _ext_.python_models import')
    ) {
      const etlHelperImport =
        'from _ext_.etl_helper import register_python_model_tasks\n';

      // Try inserting after other _ext_ imports
      const extImportMatch = dagCode.match(/from _ext_\.\w+ import[^;]+\n/g);
      if (extImportMatch && extImportMatch.length > 0) {
        const lastExtImport = extImportMatch[extImportMatch.length - 1];
        const insertPos = dagCode.indexOf(lastExtImport) + lastExtImport.length;
        dagCode =
          dagCode.slice(0, insertPos) +
          etlHelperImport +
          dagCode.slice(insertPos);
      } else {
        // Fallback: insert after last import line
        const importLines = dagCode.match(/^(?:from |import ).+$/gm);
        if (importLines && importLines.length > 0) {
          const lastImport = importLines[importLines.length - 1];
          const insertPos = dagCode.indexOf(lastImport) + lastImport.length;
          dagCode =
            dagCode.slice(0, insertPos) +
            '\n' +
            etlHelperImport +
            dagCode.slice(insertPos);
        }
      }
    }

    // Detect DAG style
    const isDecoratorStyle = dagCode.includes('@dag');
    const isContextManagerStyle = /with\s+DAG\s*\(/.test(dagCode);

    if (isDecoratorStyle) {
      dagCode = this.injectTasksDecoratorStyle(dagCode);
      this.log.info(`[DAG Injection] Used @dag decorator path for: ${dagName}`);
    } else if (isContextManagerStyle) {
      dagCode = this.injectTasksContextManagerStyle(dagCode);
      this.log.info(
        `[DAG Injection] Used 'with DAG(...)' path for: ${dagName}`,
      );
    } else {
      this.log.warn(
        `[DAG Injection] Unrecognised DAG style in ${dagName}. Imports added but tasks not injected.`,
      );
    }

    // Write the modified DAG file
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(dagFilePath),
      Buffer.from(dagCode),
    );

    this.log.info(`Injected python_models tasks into DAG: ${dagName}`);
  }

  /**
   * Inject tasks into a @dag decorator-style DAG file.
   */
  private injectTasksDecoratorStyle(dagCode: string): string {
    const dagIdMatch = dagCode.match(/dag_id\s*=\s*["']([^"']+)["']/);
    const dagId = dagIdMatch?.[1] ?? 'unknown';

    const taskDefinitions = `
    # ── PYTHON MODELS (auto-generated by DJ Framework) ──

    entry_tasks, exit_tasks = register_python_model_tasks("${dagId}")

`;

    const sequenceMarker = dagCode.indexOf('# Sequence tasks');
    const taskInstantiationMarker = dagCode.match(
      /_start_etl\s*=\s*start_etl\(\)/,
    );

    if (sequenceMarker !== -1) {
      dagCode =
        dagCode.slice(0, sequenceMarker) +
        taskDefinitions +
        dagCode.slice(sequenceMarker);
    } else if (taskInstantiationMarker) {
      const insertPos = taskInstantiationMarker.index!;
      dagCode =
        dagCode.slice(0, insertPos) +
        taskDefinitions +
        dagCode.slice(insertPos);
    }

    dagCode = dagCode.replace(
      /\s*_models = fetch_python_models\(\)\s*\n\s*_run = run_python_models\.expand\(model=_models\)\s*\n/g,
      '\n',
    );

    dagCode = dagCode.replace(
      /(\s*)_start >> _models >> _run >> _end/g,
      '$1_start >> entry_tasks\n$1exit_tasks >> _end',
    );

    const createSourceTablesMatch = dagCode.match(
      /_create_source_tables\s*=\s*create_source_tables\(\)\n/,
    );
    if (createSourceTablesMatch?.index !== undefined) {
      const insertPos =
        createSourceTablesMatch.index + createSourceTablesMatch[0].length;
      const taskInstantiation = `    entry_tasks, exit_tasks = register_python_model_tasks("${dagId}")
`;
      dagCode =
        dagCode.slice(0, insertPos) +
        taskInstantiation +
        dagCode.slice(insertPos);
    }

    const fetchSourcesPattern = />> _fetch_sources\n/;
    if (fetchSourcesPattern.test(dagCode)) {
      dagCode = dagCode.replace(
        fetchSourcesPattern,
        '>> entry_tasks >> exit_tasks\n        >> _fetch_sources\n',
      );
    }

    return dagCode;
  }

  /**
   * Inject tasks into a `with DAG(...)` context-manager-style DAG file.
   */
  private injectTasksContextManagerStyle(dagCode: string): string {
    const dagIdMatch = dagCode.match(/dag_id\s*=\s*["']([^"']+)["']/);
    const dagId = dagIdMatch?.[1] ?? 'unknown';

    // Ensure PythonOperator import (optional when using explicit dag=)
    if (!dagCode.includes('from airflow.operators.python')) {
      const importLine =
        'from airflow.operators.python import PythonOperator\n';
      const importLines = dagCode.match(/^(?:from |import ).+$/gm);
      if (importLines && importLines.length > 0) {
        const lastImport = importLines[importLines.length - 1];
        const insertPos = dagCode.indexOf(lastImport) + lastImport.length;
        dagCode =
          dagCode.slice(0, insertPos) +
          '\n' +
          importLine +
          dagCode.slice(insertPos);
      }
    }

    // Detect indentation from the with block body
    const withBodyMatch = dagCode.match(
      /with\s+DAG\s*\([^)]*\)[^:]*:\s*\n(\s+)/s,
    );
    const indent = withBodyMatch ? withBodyMatch[1] : '    ';

    const taskDefs = [
      '',
      `${indent}# ── PYTHON MODELS (auto-generated by DJ Framework) ──`,
      `${indent}_python_models, _python_run = register_python_model_tasks("${dagId}", dag)`,
      '',
    ].join('\n');

    // Find the last >> chain (dependency chain) in the file
    const chainPattern = /^(\s*\S+\s*(?:>>\s*\S+\s*)+)$/gm;
    let lastChainMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = chainPattern.exec(dagCode)) !== null) {
      lastChainMatch = match;
    }

    if (lastChainMatch) {
      const chainLine = lastChainMatch[0];
      const chainPos = lastChainMatch.index;

      // Insert task definitions before the chain line
      dagCode =
        dagCode.slice(0, chainPos) + taskDefs + '\n' + dagCode.slice(chainPos);

      // Split entry/exit: upstream operators >> python entry roots; python exits >> last operator
      const parts = chainLine.trim().split(/\s*>>\s*/);
      if (parts.length >= 2) {
        const lastOp = parts[parts.length - 1];
        const beforeLast = parts.slice(0, -1).join(' >> ');
        const chainIndent = chainLine.match(/^\s*/)?.[0] ?? indent;
        const bridge = `${chainIndent}${beforeLast} >> _python_models\n${chainIndent}_python_run >> ${lastOp}`;
        dagCode = dagCode.replace(chainLine, bridge);
      }
    } else {
      // No chain found -- just append task definitions before last line of the with block
      const withBlockEnd = dagCode.lastIndexOf('\n');
      if (withBlockEnd !== -1) {
        dagCode =
          dagCode.slice(0, withBlockEnd) +
          taskDefs +
          dagCode.slice(withBlockEnd);
      }
    }

    return dagCode;
  }

  /** Close all editor tabs open at the given file path. */
  private async closeTabsForPath(fsPath: string): Promise<void> {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.fsPath === fsPath
        ) {
          try {
            await vscode.window.tabGroups.close(tab);
          } catch {
            // Tab may already be closed
          }
        }
      }
    }
  }

  private async handlePostSyncManifestRefresh(
    result: Awaited<ReturnType<SyncEngine['execute']>>,
    project: DbtProject,
    progress: vscode.Progress<{ increment?: number; message?: string }>,
  ): Promise<void> {
    // Use ManifestManager to determine refresh strategy
    const decision = this.manifestManager.shouldReparseAfterSync(result);

    if (!decision.shouldReparse) {
      this.log.info('No manifest reparse needed: ' + decision.reason);
      return;
    }

    this.log.info(
      'Manifest reparse ' +
        (decision.blocking ? '(blocking)' : '(background)') +
        ': ' +
        decision.reason,
    );

    if (decision.blocking) {
      // Await the manifest reparse for consistency
      progress.report({
        increment: 0,
        message: 'Reparsing ' + project.name + ' manifest...',
      });

      try {
        const manifestResponse = await this.getApi().handleApi({
          type: 'dbt-parse-project',
          request: { project },
        });
        // Type assertion: dbt-parse-project returns DbtProjectManifest
        await this.dbt.handleManifest({
          manifest: manifestResponse as any,
          project,
        });
      } catch (err: unknown) {
        this.log.error('Error syncing manifest', err);
      }
    } else {
      // Request a new manifest in background (non-blocking)
      this.getApi()
        .handleApi({
          type: 'dbt-parse-project',
          request: { project },
        })
        .catch((err: unknown) => this.log.error('Error syncing manifest', err));
    }
  }

  deactivate() {
    // Clean up file watchers
    this.jsonFileWatcher?.dispose();
    this.sqlFileWatcher?.dispose();
    this.ymlFileWatcher?.dispose();
    this.pythonModelSyncService?.dispose();
    this.syncQueue.dispose();
    this.statusBarItem.dispose();
    this.dbt.deactivate();
  }
}

/**
 * Convert a JSON pointer (e.g. "/tables/0/freshness") to path segments
 * compatible with jsonc-parser's `findNodeAtLocation`.
 * Numeric segments become numbers so array indices resolve correctly.
 */
function instancePathToSegments(instancePath: string): (string | number)[] {
  if (!instancePath || instancePath === '/') {
    return [];
  }
  return instancePath
    .replace(/^\//, '')
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

/**
 * Convert a character offset in `text` to a zero-based { line, col } position.
 */
function offsetToPosition(
  text: string,
  offset: number,
): { line: number; col: number } {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Build per-error `vscode.Diagnostic[]` with positions resolved from JSON source.
 * Falls back to a single diagnostic at line 0 when structured errors are unavailable.
 */
function resolveValidationDiagnostics(
  fallbackMessage: string,
  errors?: ValidationErrorDetail[],
  jsonContent?: string,
  severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error,
): vscode.Diagnostic[] {
  if (!errors?.length || !jsonContent) {
    return [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        fallbackMessage,
        severity,
      ),
    ];
  }

  const tree = parseTree(jsonContent, undefined, {
    allowTrailingComma: true,
  });

  return errors.map((err) => {
    let range = new vscode.Range(0, 0, 0, 0);

    if (tree) {
      const segments = instancePathToSegments(err.instancePath);
      const node = findNodeAtLocation(tree, segments);

      if (node) {
        const start = offsetToPosition(jsonContent, node.offset);
        const end = offsetToPosition(jsonContent, node.offset + node.length);
        range = new vscode.Range(start.line, start.col, end.line, end.col);
      } else if (segments.length > 0) {
        // Property doesn't exist (e.g. missing required field) — point to parent
        const parentNode = findNodeAtLocation(tree, segments.slice(0, -1));
        if (parentNode) {
          const start = offsetToPosition(jsonContent, parentNode.offset);
          range = new vscode.Range(
            start.line,
            start.col,
            start.line,
            start.col,
          );
        }
      }
    }

    // Per-detail severity wins so a single batched callback can carry a
    // mix of errors and warnings (e.g. validateDjIcebergPartitionOverwrite
    // emits an Error alongside other post-generation warnings).
    const resolvedSeverity =
      err.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : err.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : severity;
    return new vscode.Diagnostic(range, err.message, resolvedSeverity);
  });
}
