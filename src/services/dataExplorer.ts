import type { Coder } from '@services/coder';
import { getDjConfig } from '@services/config';
import { COMMAND_ID, VIEW_ID } from '@services/constants';
import { ModelLineage } from '@services/modelLineage';
import type { ApiEnabledService } from '@services/types';
import { getHtml } from '@services/webview/utils';
import type { ApiMessage, ApiPayload, ApiResponse } from '@shared/api/types';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * WebviewViewProvider for Data Explorer panel
 */
class DataExplorerViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isReady = false;
  private _messageQueue: any[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _coder: Coder,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._isReady = false; // Reset ready state for new webview
    // Note: Don't clear message queue here - messages may have been queued before view was resolved

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getHtml({
      extensionUri: this._extensionUri,
      route: '/model/lineage',
      webview: webviewView.webview,
    });

    // Set webview reference in dbt service for log streaming
    this._coder.framework.dbt.setWebviewView(webviewView);

    // Note: We don't send data here because the React app isn't ready yet.
    // The webview will send a 'webview-ready' message when it's initialized,
    // which triggers message queue flush.

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: ApiMessage) => {
      try {
        // Handle webview-ready signal from React
        if ((message as any).type === 'webview-ready') {
          this._coder.log.info('Data Explorer webview is ready');
          this._isReady = true;
          // Flush queued messages
          this._flushMessageQueue();
          return;
        }

        // Handle execute-command message to run VSCode commands
        if ((message as any).type === 'execute-command') {
          const command = (message as any).command;
          this._coder.log.info('Executing command from webview:', command);
          await vscode.commands.executeCommand(command);
          return;
        }

        // Handle open-last-draft message to open the most recent .draft.sql file
        if ((message as any).type === 'open-last-draft') {
          await this._coder.queryDraft.openLatestDraft();
          return;
        }

        // Handle open-column-lineage message to navigate to Column Lineage panel
        if ((message as any).type === 'open-column-lineage') {
          const { filePath, modelName, columnName, columns, nodeType } =
            message as any;
          this._coder.log.info(
            'Opening Column Lineage for:',
            modelName,
            columnName,
            'type:',
            nodeType,
          );

          // Column Lineage is rendered inside the Data Explorer panel.
          // The webview switches to the Column view automatically when it
          // receives column-lineage-init / column-lineage-source-init.

          if (nodeType === 'source') {
            // For sources, normalize path to .source.json and use source init
            const sourceFilePath = filePath.replace(/\.yml$/, '.source.json');

            // Fetch source tables to populate the source init
            try {
              const tablesResult = await this._coder.api.handleApi({
                type: 'framework-column-lineage',
                request: {
                  action: 'get-source-tables',
                  filePath: sourceFilePath,
                },
              });

              if (tablesResult.success && tablesResult.tables) {
                this._coder.columnLineage.postSourceInit({
                  filePath: sourceFilePath,
                  sourceName: tablesResult.sourceName || modelName,
                  tables: tablesResult.tables,
                  selectedTable: modelName,
                });
              } else {
                this._coder.log.warn(
                  'Failed to get source tables for column lineage:',
                  tablesResult.error,
                );
                // Fall back to model init
                this._coder.columnLineage.postInit({
                  filePath: sourceFilePath,
                  modelName,
                  columns: columns ?? [],
                  selectedColumn: columnName,
                });
              }
            } catch (err) {
              this._coder.log.warn(
                'Error fetching source tables, falling back to model init:',
                err,
              );
              this._coder.columnLineage.postInit({
                filePath: sourceFilePath,
                modelName,
                columns: columns ?? [],
                selectedColumn: columnName,
              });
            }
          } else {
            this._coder.columnLineage.postInit({
              filePath,
              modelName,
              columns: columns ?? [],
              selectedColumn: columnName,
            });
          }
          return;
        }

        this._coder.log.debug?.(
          'Data Explorer view received message:',
          message.type,
        );

        // Handle API messages
        const response = await this._coder.api.handleApi(message as any);

        // Send response back to webview
        webviewView.webview.postMessage({
          _channelId: message._channelId,
          response,
        });
      } catch (err: unknown) {
        this._coder.log.error(
          'Error handling data explorer view message:',
          err,
        );
        webviewView.webview.postMessage({
          _channelId: message._channelId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this._coder.log.info('Data Explorer view resolved successfully');
  }

  public sendMessage(message: any) {
    if (this._view && this._isReady) {
      this._view.webview.postMessage(message);
    } else {
      // Queue messages until the webview is ready
      this._coder.log.info(
        'Queueing message (webview not ready):',
        message.type,
      );
      this._messageQueue.push(message);
    }
  }

  private _flushMessageQueue() {
    if (this._view && this._messageQueue.length > 0) {
      this._coder.log.info(
        `Flushing ${this._messageQueue.length} queued messages`,
      );
      for (const message of this._messageQueue) {
        this._view.webview.postMessage(message);
      }
      this._messageQueue = [];
    }
  }

  public getView(): vscode.WebviewView | undefined {
    return this._view;
  }

  public isReady(): boolean {
    return this._isReady && !!this._view;
  }

  public focus() {
    if (this._view) {
      this._view.show(true);
    }
  }
}

/**
 * DataExplorer service - main entry point for Data Explorer features
 * Routes API calls to appropriate sub-services (ModelLineage, etc.)
 */
export class DataExplorer
  implements ApiEnabledService<'data-explorer' | 'model-lineage'>
{
  private readonly coder: Coder;
  readonly modelLineage: ModelLineage;
  private viewProvider?: DataExplorerViewProvider;

  // Store last context so it can be restored when view reopens
  private lastContext?: {
    modelName: string;
    projectName: string;
  };

  // Debounced auto-refresh to prevent rapid-fire calls during file switching
  private readonly debouncedAutoRefresh = _.debounce(
    (editor: vscode.TextEditor | undefined) => {
      this.performAutoRefresh(editor);
    },
    300, // 300ms debounce delay
  );

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;
    this.modelLineage = new ModelLineage({ coder });
  }

  /**
   * Handle API requests by routing to appropriate sub-service
   */
  async handleApi(
    payload: ApiPayload<'data-explorer' | 'model-lineage'>,
  ): Promise<ApiResponse> {
    // Handle opening Data Explorer with a specific model prefilled
    if (payload.type === 'data-explorer-open-with-model') {
      try {
        await vscode.commands.executeCommand(
          COMMAND_ID.OPEN_DATA_EXPLORER_WITH_MODEL,
          payload.request?.modelName,
          payload.request?.projectName,
        );
        return { success: true };
      } catch (error: unknown) {
        this.coder.log.error('Error opening data explorer with model:', error);
        return { success: false };
      }
    }

    // Route to ModelLineage service
    switch (payload.type) {
      case 'data-explorer-ready':
      case 'data-explorer-get-model-lineage':
      case 'data-explorer-execute-query':
      case 'data-explorer-open-model-file':
      case 'data-explorer-get-compiled-sql':
      case 'data-explorer-detect-active-model':
      case 'data-explorer-get-project-overview':
      case 'data-explorer-open-lightdash-url':
      case 'data-explorer-set-lightdash-toggle':
      case 'data-explorer-open-dashboards-as-code':
      case 'data-explorer-open-lightdash-yaml':
        return await this.modelLineage.handleApi(payload);
    }
  }

  activate(context: vscode.ExtensionContext): void {
    this.modelLineage.activate(context);
    this.registerCommands(context);
    this.registerProviders(context);
    this.registerEventHandlers(context);
    this.coder.log.info('DataExplorer service activated');
  }

  registerCommands(context: vscode.ExtensionContext): void {
    // MODEL_LINEAGE - opens Data Explorer and shows model lineage
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.MODEL_LINEAGE,
        async (uri?: vscode.Uri) => {
          try {
            this.coder.log.info('Data Explorer command triggered');

            // Use URI if provided (from file explorer), otherwise use active editor
            const filePath = uri?.fsPath ?? this.coder.getCurrentPath();
            const info = filePath
              ? await this.coder.fetchFileInfoFromPath(filePath)
              : null;
            let modelName: string | null = null;
            let projectName: string | null = null;

            if (info && 'model' in info && info.model) {
              modelName = info.model.name;
              projectName = info.project.name;
              this.coder.log.info(
                `Data Explorer: detected model ${modelName} in ${projectName}`,
              );
            }

            // Show the data explorer view in the panel area
            await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);

            // Focus the view if provider exists
            if (this.viewProvider) {
              this.viewProvider.focus();

              // If we detected a model, store it in context
              // The webview will receive it when it sends the ready message
              if (modelName && projectName) {
                this.postInit({ modelName, projectName });
              }
            }
          } catch (error: unknown) {
            this.coder.log.error('Error showing Data Explorer view:', error);
            vscode.window.showErrorMessage('Failed to open Data Explorer view');
          }
        },
      ),
    );

    // MODEL_PREVIEW - opens Data Explorer and runs query
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.MODEL_PREVIEW,
        async (uri?: vscode.Uri) => {
          try {
            this.coder.log.info('Model Preview command triggered');

            // Use URI if provided (from file explorer), otherwise use active editor
            const filePath = uri?.fsPath ?? this.coder.getCurrentPath();
            const info = filePath
              ? await this.coder.fetchFileInfoFromPath(filePath)
              : null;
            if (!(info && 'model' in info && info.model)) {
              vscode.window.showWarningMessage(
                'No model found in current context. Please open a .sql, .model.json, or .yml model file.',
              );
              return;
            }

            const modelName = info.model.name;
            const projectName = info.project.name;

            this.coder.log.info(
              `Model Preview for: ${modelName} in ${projectName}`,
            );

            // Show the data explorer view in the panel area
            await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);

            // Send message to webview to trigger query execution (message will be queued if webview not ready)
            if (this.viewProvider) {
              this.viewProvider.sendMessage({
                type: 'trigger-run-query',
                modelName,
                projectName,
                maximized: true,
              });
            } else {
              this.coder.log.error('Data Explorer view provider not available');
              vscode.window.showErrorMessage(
                'Data Explorer view is not available',
              );
            }
          } catch (error: unknown) {
            this.coder.log.error('Error in Model Preview command:', error);
            vscode.window.showErrorMessage('Failed to preview model');
          }
        },
      ),
    );

    // OPEN_TARGET_COMPILED_SQL - opens compiled SQL file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.OPEN_TARGET_COMPILED_SQL,
        async (uri?: vscode.Uri) => {
          try {
            this.coder.log.info('Open Target Compiled SQL command triggered');

            // Use URI if provided (from file explorer), otherwise use active editor
            const filePath = uri?.fsPath ?? this.coder.getCurrentPath();
            const info = filePath
              ? await this.coder.fetchFileInfoFromPath(filePath)
              : null;
            if (!(info && 'model' in info && info.model)) {
              vscode.window.showWarningMessage(
                'No model found in current context. Please open a .sql, .model.json, or .yml model file.',
              );
              return;
            }

            const model = info.model;
            const project = info.project;

            // Get the model path relative to models directory
            let modelDir = model.pathRelativeDirectory ?? '';
            if (modelDir.startsWith('models/')) {
              modelDir = modelDir.substring('models/'.length);
            } else if (modelDir.startsWith('models\\')) {
              modelDir = modelDir.substring('models\\'.length);
            }

            // Build the compiled SQL path
            const compiledSqlPath = path.join(
              project.pathSystem,
              'target',
              'compiled',
              project.name,
              'models',
              modelDir,
              `${model.name}.sql`,
            );

            // Check if file exists
            if (!fs.existsSync(compiledSqlPath)) {
              vscode.window.showErrorMessage(
                `Compiled SQL file not found for model "${model.name}". Please run 'dbt compile' first.`,
              );
              return;
            }

            // Open the file in split editor (beside the current editor)
            await vscode.window.showTextDocument(
              vscode.Uri.file(compiledSqlPath),
              {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false,
              },
            );
          } catch (error: unknown) {
            this.coder.log.error('Error opening target compiled SQL:', error);
            vscode.window.showErrorMessage('Failed to open compiled SQL file');
          }
        },
      ),
    );

    // OPEN_TARGET_RUN_SQL - opens run SQL file
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.OPEN_TARGET_RUN_SQL,
        async (uri?: vscode.Uri) => {
          try {
            this.coder.log.info('Open Target Run SQL command triggered');

            // Use URI if provided (from file explorer), otherwise use active editor
            const filePath = uri?.fsPath ?? this.coder.getCurrentPath();
            const info = filePath
              ? await this.coder.fetchFileInfoFromPath(filePath)
              : null;
            if (!(info && 'model' in info && info.model)) {
              vscode.window.showWarningMessage(
                'No model found in current context. Please open a .sql, .model.json, or .yml model file.',
              );
              return;
            }

            const model = info.model;
            const project = info.project;

            // Get the model path relative to models directory
            let modelDir = model.pathRelativeDirectory ?? '';
            if (modelDir.startsWith('models/')) {
              modelDir = modelDir.substring('models/'.length);
            } else if (modelDir.startsWith('models\\')) {
              modelDir = modelDir.substring('models\\'.length);
            }

            // Build the run SQL path
            const runSqlPath = path.join(
              project.pathSystem,
              'target',
              'run',
              project.name,
              'models',
              modelDir,
              `${model.name}.sql`,
            );

            // Check if file exists
            if (!fs.existsSync(runSqlPath)) {
              vscode.window.showErrorMessage(
                `Run SQL file not found for model "${model.name}". Please run 'dbt run' first.`,
              );
              return;
            }

            // Open the file in split editor (beside the current editor)
            await vscode.window.showTextDocument(vscode.Uri.file(runSqlPath), {
              viewColumn: vscode.ViewColumn.Beside,
              preview: false,
            });
          } catch (error: unknown) {
            this.coder.log.error('Error opening target run SQL:', error);
            vscode.window.showErrorMessage('Failed to open run SQL file');
          }
        },
      ),
    );

    // OPEN_DATA_EXPLORER_WITH_MODEL - opens Data Explorer with a specific model
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.OPEN_DATA_EXPLORER_WITH_MODEL,
        async (modelName: string, projectName: string) => {
          try {
            this.coder.log.info(
              'Opening Data Explorer with model:',
              modelName,
              projectName,
            );

            // Focus the Data Explorer panel
            await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);

            // Send message to the webview to select the model
            if (this.viewProvider) {
              this.viewProvider.focus();
              this.viewProvider.sendMessage({
                type: 'select-model',
                modelName,
                projectName,
              });
            } else {
              this.coder.log.error('Data Explorer view provider not available');
              vscode.window.showErrorMessage(
                'Data Explorer view is not available',
              );
            }
          } catch (error: unknown) {
            this.coder.log.error(
              'Error opening Data Explorer with model:',
              error,
            );
            vscode.window.showErrorMessage(
              'Failed to open Data Explorer with model',
            );
          }
        },
      ),
    );
  }

  registerProviders(context: vscode.ExtensionContext): void {
    // Register Data Explorer webview view provider
    this.viewProvider = new DataExplorerViewProvider(
      context.extensionUri,
      this.coder,
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        VIEW_ID.MODEL_LINEAGE,
        this.viewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );
    this.coder.log.info('DataExplorer providers registered');
  }

  registerEventHandlers(context: vscode.ExtensionContext): void {
    // Listen for data explorer auto-refresh configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dj.dataExplorer.autoRefresh')) {
          const config = getDjConfig();
          this.coder.log.info(
            'Data Explorer auto-refresh setting changed to:',
            config.dataExplorerAutoRefresh,
          );
          if (config.dataExplorerAutoRefresh) {
            // When auto-refresh is turned on, immediately refresh
            void this.handleAutoRefresh(vscode.window.activeTextEditor);
          }
        }
      }),
    );

    this.coder.log.info('DataExplorer event handlers registered');
  }

  // Public methods for coder to interact with the view
  public getViewProvider(): DataExplorerViewProvider | undefined {
    return this.viewProvider;
  }

  public sendMessage(message: any): void {
    this.viewProvider?.sendMessage(message);
  }

  public isViewReady(): boolean {
    return this.viewProvider?.isReady() ?? false;
  }

  public focusView(): void {
    this.viewProvider?.focus();
  }

  /**
   * Called when the webview signals it's ready to receive data
   * Similar to Column Lineage's onWebviewReady pattern
   */
  public onWebviewReady(): void {
    this.coder.log.info('Data Explorer webview ready');

    // If we have stored context, restore it
    if (this.lastContext) {
      this.coder.log.info('Restoring last context:', this.lastContext);
      this.postInit(this.lastContext);
      return;
    }

    // Otherwise, try to detect active model from editor
    // Use retry option to handle case where models aren't loaded yet
    this.detectAndSendActiveModel({ retry: true });
  }

  /**
   * Store context and send to webview (if resolved)
   */
  public postInit(context: { modelName: string; projectName: string }): void {
    this.lastContext = context;
    if (!this.viewProvider) {
      return;
    }
    this.viewProvider.sendMessage({
      type: 'set-active-model',
      modelName: context.modelName,
      projectName: context.projectName,
      explicit: false,
    });
  }

  /**
   * Detect active model from editor and send to webview
   * Similar to Column Lineage's retry mechanism
   * @param options Retry options for handling delayed model loading
   */
  private detectAndSendActiveModel(options?: {
    retry?: boolean;
    retryCount?: number;
  }): void {
    const modelsCount = this.coder.framework.dbt.models.size;
    if (modelsCount === 0) {
      this.coder.log.info('Data Explorer ready but models not loaded yet');

      // Retry if enabled (e.g., dbt project not loaded yet)
      if (options?.retry) {
        const retryCount = options.retryCount ?? 0;
        const maxRetries = 5;
        if (retryCount < maxRetries) {
          this.coder.log.info(
            `Will retry model detection (${retryCount + 1}/${maxRetries}) in 2 seconds...`,
          );
          setTimeout(() => {
            this.detectAndSendActiveModel({
              retry: true,
              retryCount: retryCount + 1,
            });
          }, 2000);
        } else {
          this.coder.log.info('Max retries reached, models still not loaded');
        }
      }
      return;
    }

    const activeModel = this.modelLineage.getCurrentActiveModel(
      vscode.window.activeTextEditor,
    );

    if (activeModel) {
      this.coder.log.info(
        'Detected active model on webview ready:',
        activeModel,
      );
      this.postInit(activeModel);
    } else {
      this.coder.log.info('Data Explorer ready but no active model in editor');
    }
  }

  /**
   * Handle auto-refresh when active editor changes (debounced)
   */
  public handleAutoRefresh(editor: vscode.TextEditor | undefined): void {
    // Check if auto-refresh is enabled by the user first
    const { dataExplorerAutoRefresh } = getDjConfig();

    if (!dataExplorerAutoRefresh) {
      // Auto-refresh is disabled, skip the operation
      return;
    }

    // Advanced context awareness checks
    if (!this.shouldAutoRefresh(editor)) {
      return;
    }

    // Use debounced version to prevent rapid-fire calls
    this.debouncedAutoRefresh(editor);
  }

  /**
   * Determine if auto-refresh should be triggered based on context
   */
  private shouldAutoRefresh(editor: vscode.TextEditor | undefined): boolean {
    if (!editor) {
      return false;
    }

    const fileName = editor.document.fileName.toLowerCase();

    // Only auto-refresh for dbt model files
    // Given the framework structure: .sql, .model.json, and .yml files
    // share the same base name and are always dbt-related
    return (
      fileName.endsWith('.sql') ||
      fileName.endsWith('.model.json') ||
      fileName.endsWith('.yml')
    );
  }

  /**
   * Perform the actual auto-refresh operation (internal method)
   */
  private performAutoRefresh(editor: vscode.TextEditor | undefined): void {
    try {
      const viewProvider = this.getViewProvider();
      if (!viewProvider) {
        this.coder.log.debug?.(
          'Data Explorer auto-refresh: No view provider available',
        );
        return;
      }

      const activeModel = this.modelLineage.getCurrentActiveModel(editor);
      if (!activeModel) {
        this.coder.log.debug?.(
          'Data Explorer auto-refresh: No active model detected',
        );
        return;
      }

      this.coder.log.debug?.(
        'Data Explorer auto-refresh:',
        activeModel.modelName,
      );

      // Send message to webview - this is synchronous and should rarely fail
      viewProvider.sendMessage({
        type: 'set-active-model',
        modelName: activeModel.modelName,
        projectName: activeModel.projectName,
        explicit: false,
      });
    } catch (error) {
      // Log error but don't show disruptive notifications for auto-refresh failures
      // since this is meant to be a background operation
      this.coder.log.warn('Data Explorer auto-refresh failed:', error);
    }
  }

  deactivate(): void {
    this.modelLineage.deactivate();
    this.coder.log.info('DataExplorer service deactivated');
  }
}
