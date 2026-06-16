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
import { BASE_SCHEMAS_PATH } from '@services/constants';
import type { Dbt } from '@services/dbt';
import type { DJLogger } from '@services/djLogger';
import type { StateManager } from '@services/statemanager';
import {
  buildOrderedResources,
  CacheManager,
  ERROR_MESSAGES,
  ManifestManager,
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
import { CteAnalysisHandlers } from './handlers/cte-analysis-handlers';
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
  webviewPanelSourceCreate: vscode.WebviewPanel | undefined;

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
  private cteAnalysisHandlers: CteAnalysisHandlers;

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
    this.cteAnalysisHandlers = new CteAnalysisHandlers(ctx);

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

      case 'framework-model-cte-analysis':
        return await this.cteAnalysisHandlers.handleCteAnalysis(payload);

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
      vscode.commands.registerCommand(
        COMMAND_ID.CLEAR_SYNC_CACHE,
        (options?: { silent?: boolean }) => {
          this.handleClearSyncCache(options);
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
   * Clears the entire sync cache. The next sync run will treat every JSON
   * file as changed and regenerate its SQL/YML output regardless of whether
   * the source content was modified. Useful for debugging, forcing a full
   * regeneration, or recovering when something outside the source files
   * (e.g. an extension setting) has altered the generated output.
   *
   * @param options.silent - When true, suppresses the user-facing toast.
   *   Intended for programmatic callers that surface their own UI.
   */
  handleClearSyncCache(options?: { silent?: boolean }) {
    this.cacheManager.clear();
    if (!options?.silent) {
      vscode.window.showInformationMessage('JSON sync cache cleared');
    }
    this.log.info(
      `Sync cache cleared${options?.silent ? ' (silent)' : ' (manual)'}`,
    );
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

      // Reserved-key lint warnings for model/column meta. Appended to any
      // diagnostics already posted for this URI (e.g. CTE warnings above)
      // so multiple lint categories coexist on the same file.
      onModelValidationLintWarnings: (uri, warnings, jsonContent) => {
        const existing = Array.from(this.diagnosticModelJson.get(uri) ?? []);
        const positioned = buildPositionedDiagnostics(
          warnings,
          jsonContent,
          vscode.DiagnosticSeverity.Warning,
        );
        this.diagnosticModelJson.set(uri, [...existing, ...positioned]);
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
  // Pass the channel default through so warning-channel callers
  // (`onModelValidationWarning`) render details without an explicit
  // `severity` override as Warning rather than Error. Per-detail
  // `severity: 'error'` overrides still win inside
  // `buildPositionedDiagnostics` so a warning batch can carry a hard error
  // (e.g. `validateDjIcebergPartitionOverwrite`) on the same URI.
  return buildPositionedDiagnostics(errors, jsonContent, severity);
}

/**
 * Build `vscode.Diagnostic[]` from structured `ValidationErrorDetail[]` with
 * JSON-pointer positions resolved against the provided source text.
 *
 * Shared by the error path (`resolveValidationDiagnostics`) and the lint
 * warning path (`onModelValidationLintWarnings`) so positioning behaves
 * identically for both.
 */
function buildPositionedDiagnostics(
  details: ValidationErrorDetail[],
  jsonContent: string,
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic[] {
  const tree = parseTree(jsonContent, undefined, {
    allowTrailingComma: true,
  });

  return details.map((detail) => {
    let range = new vscode.Range(0, 0, 0, 0);

    if (tree) {
      const segments = instancePathToSegments(detail.instancePath);
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
      detail.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : detail.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : severity;
    return new vscode.Diagnostic(range, detail.message, resolvedSeverity);
  });
}
