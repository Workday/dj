import type { Coder } from '@services/coder';
import { COMMAND_ID, VIEW_ID } from '@services/constants';
import {
  filterBulkSelectColumns,
  frameworkBuildCteColumnRegistry,
  frameworkGetNodeColumns,
  frameworkGetSourceMeta,
} from '@services/framework/utils';
import type { DJService } from '@services/types';
import { jsonParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import { getDbtModelId } from '@shared/dbt/utils';
import {
  BULK_CTE_TYPES,
  BULK_MODEL_TYPES,
  BULK_SELECT_TYPES,
  type BulkSelectType,
} from '@shared/framework/constants';
import type { FrameworkColumn } from '@shared/framework/types';
import type { FrameworkModel } from '@shared/framework/types';
import {
  AGG_TYPES,
  type ColumnLineageDAG,
  type ColumnLineageResult,
  type ColumnNodeId,
  type ColumnTransformationType,
  FUNCTION_CALL_PATTERN,
  getModelLayer,
  IDENTIFIER_PATTERN,
  JINJA_KEYWORDS,
  MACRO_PATTERN,
  QUALIFIED_COLUMN_PATTERN,
  SIMPLE_COLUMN_PATTERN,
  SQL_KEYWORDS,
  STRING_LITERAL_PATTERN,
} from '@shared/lineage';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// Re-export types for external consumers
export type {
  ColumnLineageDAG,
  ColumnLineageEdge,
  ColumnLineageNode,
  ColumnLineageResult,
  ColumnNodeId,
  ColumnTransformationType,
  ModelLayerType,
} from '@shared/lineage';

/** File validation result */
interface FileValidationResult {
  valid: boolean;
  error?: string;
  basePath?: string;
  modelName?: string;
  projectName?: string;
}

/** Lightweight CTE shape for lineage resolution */
interface CteDefinition {
  name: string;
  from: Record<string, unknown>;
  select?: unknown[];
}

/** Bulk select directive types (all_from_model, dims_from_model, etc.) */
interface SelectDirective {
  type: BulkSelectType;
  model?: string;
  source?: string;
  cte?: string;
  include?: string[];
  exclude?: string[];
}

/** Expression analysis result */
interface ExpressionAnalysis {
  type: 'passthrough' | 'renamed' | 'derived';
  sourceColumns: string[];
  sourceModels?: string[]; // For qualified references like "model.column"
}

export class ColumnLineageService implements DJService {
  private coder: Coder;
  private autoRefreshEnabled: boolean;
  private lastContext?: {
    filePath: string;
    modelName: string;
    columns: FrameworkColumn[];
    selectedColumn?: string;
  };
  private lastSourceContext?: {
    filePath: string;
    sourceName: string;
    tables: Array<{ name: string; columnCount: number }>;
    selectedTable?: string;
  };
  private lastStatus?: {
    message: string;
    variant: 'info' | 'warning' | 'error';
  };

  constructor(coder: Coder) {
    this.coder = coder;
    this.autoRefreshEnabled = vscode.workspace
      .getConfiguration('dj')
      .get('columnLineage.autoRefresh', true);
  }

  activate(context: vscode.ExtensionContext): void {
    this.registerCommands(context);
    this.registerProviders(context);
    this.registerEventHandlers(context);
    this.coder.log.info('Column Lineage Service activated');
  }

  registerCommands(context: vscode.ExtensionContext): void {
    // Register column origin navigation command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.COLUMN_ORIGIN,
        async (column: FrameworkColumn) => {
          try {
            const originId = column?.meta?.origin?.id;
            if (!originId) {
              throw new Error('No id provided');
            }

            const projectName = originId.split('.')[1];
            const project = this.coder.framework.dbt.projects.get(projectName);
            if (!project) {
              throw new Error('No project found');
            }

            const model = this.coder.framework.dbt.models.get(originId);
            if (!model) {
              throw new Error('No model found');
            }

            const uriModelJson = vscode.Uri.file(
              model.pathSystemFile.replace('.sql', '.model.json'),
            );
            const uriModelSql = vscode.Uri.file(model.pathSystemFile);
            if (fs.existsSync(uriModelJson.fsPath)) {
              const editor = await vscode.window.showTextDocument(uriModelJson);
              const regex = new RegExp(`"name": "${column.name}"`);
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
            } else {
              await vscode.window.showTextDocument(uriModelSql);
            }
          } catch (err: unknown) {
            this.coder.log.error('ERROR NAVIGATING TO COLUMN ORIGIN', err);
          }
        },
      ),
    );

    // Register column lineage command
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.COLUMN_LINEAGE, async () => {
        try {
          this.coder.log.info('Column Lineage command triggered');

          const currentPath = this.coder.getCurrentPath();
          if (!currentPath) {
            vscode.window.showWarningMessage('No file is currently open');
            return;
          }

          await this.loadForFile(currentPath, {
            focusPanel: true,
            showErrors: true,
          });

          this.coder.log.info('Column lineage panel updated');
        } catch (err: unknown) {
          this.coder.log.error('ERROR OPENING COLUMN LINEAGE PANEL', err);
          vscode.window.showErrorMessage('Failed to open column lineage panel');
        }
      }),
    );
  }

  registerProviders(_context: vscode.ExtensionContext): void {
    // Column Lineage now renders inside the Data Explorer panel; no standalone
    // webview provider is registered here. Messages are routed through
    // `this.coder.dataExplorer.sendMessage(...)`.
    this.coder.log.info(
      'Column Lineage routes through Data Explorer panel (no standalone provider)',
    );
  }

  registerEventHandlers(context: vscode.ExtensionContext): void {
    // Listen for column lineage auto-refresh configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dj.columnLineage.autoRefresh')) {
          this.autoRefreshEnabled = vscode.workspace
            .getConfiguration('dj')
            .get('columnLineage.autoRefresh', true);
          this.sendConfig();
          if (this.autoRefreshEnabled) {
            void this.handleAutoRefresh(vscode.window.activeTextEditor);
          }
        }
      }),
    );

    this.coder.log.info('Column Lineage event handlers registered');
  }

  // Public methods for coder to interact with the view
  public sendMessage(message: any): void {
    this.coder.dataExplorer.sendMessage(message);
  }

  public onWebviewReady(): void {
    this.sendConfig();
    if (this.lastContext) {
      this.postInit(this.lastContext);
    }
    if (this.lastSourceContext) {
      this.postSourceInit(this.lastSourceContext);
    }
    if (this.lastStatus) {
      this.sendStatus(this.lastStatus.message, this.lastStatus.variant);
    }
    void this.handleAutoRefresh(vscode.window.activeTextEditor, {
      retry: true,
    });
  }

  public sendConfig(): void {
    this.coder.dataExplorer.sendMessage({
      type: 'column-lineage-config',
      autoRefresh: Boolean(this.autoRefreshEnabled),
    });
  }

  public sendStatus(
    message: string,
    variant: 'info' | 'warning' | 'error' = 'info',
  ): void {
    this.lastStatus = message ? { message, variant } : undefined;
    this.coder.dataExplorer.sendMessage({
      type: 'column-lineage-status',
      message,
      variant,
    });
  }

  public postInit(context: {
    filePath: string;
    modelName: string;
    columns: FrameworkColumn[];
    selectedColumn?: string;
  }): void {
    this.lastContext = context;
    this.lastSourceContext = undefined; // Clear source context when model is loaded
    this.coder.dataExplorer.sendMessage({
      type: 'column-lineage-init',
      ...context,
    });
  }

  public postSourceInit(context: {
    filePath: string;
    sourceName: string;
    tables: Array<{ name: string; columnCount: number }>;
    selectedTable?: string;
  }): void {
    this.lastSourceContext = context;
    this.lastContext = undefined; // Clear model context when source is loaded
    this.coder.dataExplorer.sendMessage({
      type: 'column-lineage-source-init',
      ...Object.fromEntries(
        Object.entries(context).map(([key, value]) => [
          key,
          value === null || value === undefined
            ? value
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value),
        ]),
      ),
    });
  }

  public postResult(result: {
    columnName: string;
    dag: ColumnLineageDAG;
    isSource: boolean;
  }): void {
    this.coder.dataExplorer.sendMessage({
      type: 'column-lineage-result',
      ...result,
    });
  }

  /**
   * Determine the file type for column lineage purposes
   */
  private getFileType(filePath: string): 'model' | 'source' | null {
    if (filePath.endsWith('.model.json')) {
      return 'model';
    }
    if (filePath.endsWith('.source.json')) {
      return 'source';
    }
    if (filePath.endsWith('.sql')) {
      // Check if corresponding .model.json exists
      const modelJsonPath = filePath.replace(/\.sql$/, '.model.json');
      if (fs.existsSync(modelJsonPath)) {
        return 'model';
      }
      return null;
    }
    if (filePath.endsWith('.yml')) {
      // Parse yml to check if it's a source or model yml
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('sources:')) {
          // Check for corresponding .source.json
          const sourceJsonPath = filePath.replace(/\.yml$/, '.source.json');
          if (fs.existsSync(sourceJsonPath)) {
            return 'source';
          }
        }
        if (content.includes('models:')) {
          // Check for corresponding .model.json
          const modelJsonPath = filePath.replace(/\.yml$/, '.model.json');
          if (fs.existsSync(modelJsonPath)) {
            return 'model';
          }
        }
      } catch {
        // Ignore parse errors
      }
      return null;
    }
    return null;
  }

  /**
   * Check if a file is supported for column lineage
   */
  public isSupportedFile(filePath: string): boolean {
    return (
      filePath.endsWith('.sql') ||
      filePath.endsWith('.model.json') ||
      filePath.endsWith('.source.json') ||
      filePath.endsWith('.yml')
    );
  }

  /**
   * Open a model file in the editor and compute lineage for a specific column.
   * Called when user clicks a node in the lineage graph.
   * @param filePath Path to the model file
   * @param columnName Column to compute lineage for
   * @param options Lineage depth options and skipOpenFile flag
   */
  async openModelAndComputeLineage(
    filePath: string,
    columnName: string,
    options?: {
      upstreamLevels?: number;
      downstreamLevels?: number;
      skipOpenFile?: boolean;
    },
  ): Promise<void> {
    try {
      // Open the file in editor (unless skipOpenFile is true, e.g., when triggered from UI)
      if (!options?.skipOpenFile) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri, { preview: false });
      }

      // Load the column lineage for this file (this updates the panel with columns and pre-selects the column)
      const success = await this.loadForFile(filePath, {
        focusPanel: true,
        showErrors: true,
        selectedColumn: columnName,
      });

      if (success) {
        // Compute lineage for the specific column with provided depth options
        const lineageResult = await this.coder.api.handleApi({
          type: 'framework-column-lineage',
          request: {
            action: 'compute',
            filePath,
            columnName,
            upstreamLevels: options?.upstreamLevels,
            downstreamLevels: options?.downstreamLevels,
          },
        });

        if (lineageResult.success && lineageResult.dag) {
          // Send the computed lineage to the webview
          this.postResult({
            columnName,
            dag: lineageResult.dag as any,
            isSource: false,
          });
        } else {
          this.sendStatus(
            lineageResult.error ?? 'Failed to compute lineage',
            'error',
          );
        }
      }
    } catch (err: unknown) {
      this.coder.log.error('Error opening model and computing lineage:', err);
      this.sendStatus('Failed to open model and compute lineage', 'error');
    }
  }

  /**
   * Open a source file in the editor and compute forward lineage for a specific column.
   * Called when user clicks a source node in the lineage graph.
   * @param filePath Path to the source file (.source.json)
   * @param tableName Table name within the source
   * @param columnName Column to compute lineage for
   * @param options Lineage depth options and skipOpenFile flag
   */
  async openSourceAndComputeLineage(
    filePath: string,
    tableName: string,
    columnName: string,
    options?: { downstreamLevels?: number; skipOpenFile?: boolean },
  ): Promise<void> {
    try {
      // Open the source file in editor (unless skipOpenFile is true, e.g., when triggered from UI)
      if (!options?.skipOpenFile) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri, { preview: false });
      }

      // Load the source file for the column lineage panel (this updates the panel with tables and selected table)
      const success = await this.loadForFile(filePath, {
        focusPanel: true,
        showErrors: true,
        tableName, // Pass tableName to pre-select it in the dropdown
      });

      if (success) {
        // Compute forward lineage for the specific source column
        const lineageResult = await this.coder.api.handleApi({
          type: 'framework-column-lineage',
          request: {
            action: 'compute-source-lineage',
            filePath,
            tableName,
            columnName,
            downstreamLevels: options?.downstreamLevels,
          },
        });

        if (lineageResult.success && lineageResult.dag) {
          // Send the computed lineage to the webview
          this.postResult({
            columnName,
            dag: lineageResult.dag as any,
            isSource: true,
          });
        } else {
          this.sendStatus(
            lineageResult.error || 'Failed to compute source lineage',
            'error',
          );
        }
      }
    } catch (err: unknown) {
      this.coder.log.error('Error opening source and computing lineage:', err);

      // Check if the error is due to file not found
      const isFileNotFound =
        err instanceof Error &&
        (('code' in err && err.code === 'ENOENT') ||
          ('name' in err && err.name === 'CodeExpectedError') ||
          err.message?.includes('ENOENT') ||
          err.message?.includes('no such file') ||
          err.message?.includes('Unable to resolve nonexistent file'));

      this.sendStatus(
        isFileNotFound
          ? 'No source.json file available for this source'
          : 'Failed to open source and compute lineage',
        'error',
      );
    }
  }

  /**
   * Load column lineage data for a file and update the panel
   * @param filePath Path to the file
   * @param options Options for loading (focus panel, show errors, etc.)
   * @returns true if successful, false otherwise
   */
  async loadForFile(
    filePath: string,
    options?: {
      focusPanel?: boolean;
      showErrors?: boolean;
      tableName?: string;
      selectedColumn?: string;
    },
  ): Promise<boolean> {
    const {
      focusPanel = false,
      showErrors = false,
      tableName,
      selectedColumn,
    } = options ?? {};
    try {
      const fileType = this.getFileType(filePath);

      if (fileType === 'source') {
        // Handle source file - get tables first
        const tablesResult = await this.coder.api.handleApi({
          type: 'framework-column-lineage',
          request: { action: 'get-source-tables', filePath },
        });

        if (!tablesResult.success || !tablesResult.tables) {
          if (showErrors) {
            vscode.window.showErrorMessage(
              tablesResult.error || 'Failed to fetch source tables',
            );
          } else if (tablesResult.error) {
            this.coder.log.warn(
              'Auto column lineage failed:',
              tablesResult.error,
            );
            this.sendStatus(tablesResult.error, 'info');
          }
          return false;
        }

        if (focusPanel) {
          await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);
        }

        // Send source init message with tables
        this.postSourceInit({
          filePath,
          sourceName: tablesResult.sourceName!,
          tables: tablesResult.tables ?? [],
          selectedTable: tableName,
        });
        this.sendStatus('');
        return true;
      }

      // Handle model file (existing logic)
      const columnsResult = await this.coder.api.handleApi({
        type: 'framework-column-lineage',
        request: { action: 'get-columns', filePath },
      });

      if (!columnsResult.success || !columnsResult.columns) {
        if (showErrors) {
          vscode.window.showErrorMessage(
            columnsResult.error || 'Failed to fetch columns',
          );
        } else if (columnsResult.error) {
          this.coder.log.warn(
            'Auto column lineage failed:',
            columnsResult.error,
          );
          // Send status to webview so user knows what happened
          this.sendStatus(columnsResult.error, 'info');
        }
        return false;
      }

      const { modelName, columns } = columnsResult;

      if (focusPanel) {
        await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);
      }

      this.postInit({
        filePath,
        modelName: modelName!,
        columns,
        selectedColumn,
      });
      this.sendStatus('');
      return true;
    } catch (err: unknown) {
      this.coder.log.error('Error loading column lineage context:', err);
      if (options?.showErrors) {
        vscode.window.showErrorMessage('Failed to load column lineage context');
      }
      return false;
    }
  }

  /**
   * Handle auto-refresh when active editor changes or when explicitly triggered
   */
  async handleAutoRefresh(
    editor: vscode.TextEditor | undefined,
    options?: { retry?: boolean; retryCount?: number },
  ): Promise<void> {
    if (!this.autoRefreshEnabled) {
      return;
    }
    if (!this.coder.dataExplorer.isViewReady()) {
      return;
    }
    const filePath = editor?.document.uri.fsPath;
    if (!filePath || !this.isSupportedFile(filePath)) {
      this.sendStatus(
        'Open a .model.json, .source.json, .sql, or .yml file to refresh lineage',
        'info',
      );
      return;
    }

    const success = await this.loadForFile(filePath);

    // Retry if failed and retry is enabled (e.g., dbt project not loaded yet)
    if (!success && options?.retry) {
      const retryCount = options.retryCount ?? 0;
      const maxRetries = 5;
      if (retryCount < maxRetries) {
        setTimeout(() => {
          void this.handleAutoRefresh(vscode.window.activeTextEditor, {
            retry: true,
            retryCount: retryCount + 1,
          });
        }, 2000);
      }
    }
  }

  deactivate(): void {
    this.coder.log.info('Column Lineage Service deactivated');
  }

  /**
   * Main entry point for computing column lineage
   * @param filePath Path to the model file
   * @param columnName Column to trace
   * @param options Lineage depth options
   * @param options.upstreamLevels Number of upstream levels to trace (-1 for unlimited, default: -1)
   * @param options.downstreamLevels Number of downstream levels to trace (-1 for unlimited, default: 0)
   */
  async getColumnLineage(
    filePath: string,
    columnName: string,
    options?: { upstreamLevels?: number; downstreamLevels?: number },
  ): Promise<ColumnLineageResult> {
    try {
      // Validate model files
      const validation = await this.validateModelFiles(filePath);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
        };
      }

      // Get project
      const project = this.coder.framework.dbt.getProjectFromPath(filePath);
      if (!project) {
        return {
          success: false,
          error: 'Could not find dbt project for this file',
        };
      }

      // Build lineage DAG with depth options
      const dag = await this.buildLineageDAG(
        columnName,
        validation.modelName!,
        project,
        options,
      );

      return {
        success: true,
        dag,
      };
    } catch (error: unknown) {
      this.coder.log.error('Error computing column lineage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate that all required model files exist
   */
  async validateModelFiles(filePath: string): Promise<FileValidationResult> {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, ext);

    // Derive base path (remove .model or .source extensions)
    let baseName = basename;
    if (baseName.endsWith('.model')) {
      baseName = baseName.replace(/\.model$/, '');
    } else if (baseName.endsWith('.source')) {
      baseName = baseName.replace(/\.source$/, '');
    }

    const basePath = path.join(dir, baseName);
    const modelJsonPath = `${basePath}.model.json`;
    const sqlPath = `${basePath}.sql`;
    const ymlPath = `${basePath}.yml`;

    // Check if all three files exist
    const modelJsonExists = await this.coder.fileExists(modelJsonPath);
    const sqlExists = await this.coder.fileExists(sqlPath);
    const ymlExists = await this.coder.fileExists(ymlPath);

    if (!modelJsonExists) {
      return {
        valid: false,
        error: 'Model JSON file not found. Expected: ' + modelJsonPath,
      };
    }

    if (!sqlExists) {
      return {
        valid: false,
        error:
          'SQL file not found. Please run DJ Sync to generate model files first.',
      };
    }

    if (!ymlExists) {
      return {
        valid: false,
        error:
          'YAML file not found. Please run DJ Sync to generate model files first.',
      };
    }

    return {
      valid: true,
      basePath,
      modelName: baseName,
    };
  }

  /**
   * Build the column lineage DAG with configurable depth
   * @param columnName Column to trace
   * @param modelName Starting model name
   * @param project dbt project
   * @param options Depth options
   * @param options.upstreamLevels Number of upstream levels (-1 for unlimited)
   * @param options.downstreamLevels Number of downstream levels (-1 for unlimited)
   */
  async buildLineageDAG(
    columnName: string,
    modelName: string,
    project: DbtProject,
    options?: { upstreamLevels?: number; downstreamLevels?: number },
  ): Promise<ColumnLineageDAG> {
    const upstreamLevels = options?.upstreamLevels ?? -1;
    const downstreamLevels = options?.downstreamLevels ?? 0;

    const dag: ColumnLineageDAG = {
      targetColumn: `${modelName}.${columnName}`,
      nodes: new Map(),
      edges: [],
      roots: [],
      leaves: [],
      hasMoreUpstream: false,
      hasMoreDownstream: false,
    };

    // Track visited nodes to avoid infinite loops
    const visited = new Set<ColumnNodeId>();

    // Trace upstream (ancestors)
    if (upstreamLevels !== 0) {
      await this.traceColumnRecursive(
        columnName,
        modelName,
        project,
        dag,
        visited,
        0,
        upstreamLevels,
      );
    } else {
      // Just add the target node without tracing
      await this.addNodeToDag(columnName, modelName, project, dag);
    }

    // Track leaves that were stopped due to depth limit
    const depthLimitedLeaves = new Set<ColumnNodeId>();

    // Trace downstream (descendants)
    if (downstreamLevels !== 0) {
      await this.traceColumnDescendants(
        columnName,
        modelName,
        project,
        dag,
        visited,
        0,
        downstreamLevels,
        depthLimitedLeaves,
      );
    }

    // Identify roots (nodes with no incoming edges)
    const nodesWithIncoming = new Set(dag.edges.map((e) => e.target));
    for (const nodeId of dag.nodes.keys()) {
      if (!nodesWithIncoming.has(nodeId)) {
        dag.roots.push(nodeId);
      }
    }

    // Identify leaves (nodes with no outgoing edges)
    const nodesWithOutgoing = new Set(dag.edges.map((e) => e.source));
    for (const nodeId of dag.nodes.keys()) {
      if (!nodesWithOutgoing.has(nodeId)) {
        dag.leaves.push(nodeId);
      }
    }

    // Check if there are more upstream nodes by analyzing column transformations
    dag.hasMoreUpstream = await this.checkHasMoreUpstream(dag, project);

    // Check if there are more downstream nodes
    // If some leaves hit depth limit, check if they have children (model-level check)
    // If no leaves hit depth limit, all lineage is exhausted
    if (depthLimitedLeaves.size > 0) {
      dag.hasMoreDownstream = this.checkHasMoreDownstream(dag, project);
    } else {
      dag.hasMoreDownstream = false;
    }

    return dag;
  }

  /**
   * Add a single node to the DAG without tracing further
   */
  private async addNodeToDag(
    columnName: string,
    modelName: string,
    project: DbtProject,
    dag: ColumnLineageDAG,
  ): Promise<void> {
    const nodeId = `${modelName}.${columnName}`;
    if (dag.nodes.has(nodeId)) {
      return;
    }

    // Check if this is a source
    const sourceId = this.findSourceId(modelName, project);
    if (sourceId) {
      const source = project.manifest.sources?.[sourceId];
      if (source) {
        const column = source.columns?.[columnName];

        // Only add source node if column actually exists in the source
        // Framework-generated columns like portal_source_count don't exist in sources
        if (!column) {
          this.coder.log.debug(
            `Column '${columnName}' not found in source '${modelName}', skipping source node creation`,
          );
          return;
        }

        dag.nodes.set(nodeId, {
          id: nodeId,
          columnName,
          modelName,
          modelLayer: 'source',
          modelType: 'source',
          dataType: column.data_type,
          description: column.description,
          transformation: 'raw',
          filePath: this.getSourceFilePath(sourceId, project) ?? undefined,
        });
      }
      return;
    }

    // Get model from manifest
    const modelId = getDbtModelId({ modelName, projectName: project.name });
    if (!modelId) {
      return;
    }

    const manifestNode = project.manifest.nodes?.[modelId];
    if (!manifestNode) {
      return;
    }

    const column = manifestNode.columns?.[columnName];
    const modelLayer = getModelLayer(modelName);
    const modelJsonPath = this.getModelJsonPath(modelName, project);

    if (!modelJsonPath) {
      this.coder.log.debug(
        `No model.json path found for ${modelName} in project ${project.name}`,
      );
      return;
    }

    const modelJson = await this.loadModelJson(modelJsonPath);

    if (!modelJson) {
      return;
    }

    const analysis = this.analyzeColumnTransformation(
      columnName,
      modelJson,
      modelId,
      project,
    );

    dag.nodes.set(nodeId, {
      id: nodeId,
      columnName,
      modelName,
      modelLayer,
      modelType: modelJson.type,
      dataType: column?.data_type,
      description: column?.description,
      transformation: analysis.type,
      expression: analysis.expression,
      filePath: modelJsonPath || undefined,
    });
  }

  /**
   * Recursively trace a column through the lineage (upstream/ancestors)
   * @param columnName Column to trace
   * @param modelName Current model name
   * @param project dbt project
   * @param dag DAG to populate
   * @param visited Set of visited node IDs
   * @param currentDepth Current recursion depth
   * @param maxDepth Maximum depth to trace (-1 for unlimited)
   */
  private async traceColumnRecursive(
    columnName: string,
    modelName: string,
    project: DbtProject,
    dag: ColumnLineageDAG,
    visited: Set<ColumnNodeId>,
    currentDepth: number = 0,
    maxDepth: number = -1,
  ): Promise<void> {
    const nodeId = `${modelName}.${columnName}`;

    this.coder.log.debug(
      `traceColumnRecursive: modelName="${modelName}", columnName="${columnName}", depth=${currentDepth}/${maxDepth}`,
    );

    // Skip if already visited
    if (visited.has(nodeId)) {
      this.coder.log.debug(
        `traceColumnRecursive: skipping already visited node ${nodeId}`,
      );
      return;
    }
    visited.add(nodeId);

    // Check if this is a source
    const sourceId = this.findSourceId(modelName, project);
    this.coder.log.debug(
      `traceColumnRecursive: findSourceId returned: ${sourceId ?? 'null'}`,
    );
    if (sourceId) {
      // This is a source column - add it only if the column actually exists
      const source = project.manifest.sources?.[sourceId];
      if (source) {
        const column = source.columns?.[columnName];

        // Only add source node if column exists in the source
        // Framework-generated columns like portal_source_count don't exist in sources
        if (!column) {
          this.coder.log.debug(
            `Column '${columnName}' not found in source '${modelName}', stopping trace here`,
          );
          return;
        }

        dag.nodes.set(nodeId, {
          id: nodeId,
          columnName,
          modelName,
          modelLayer: 'source',
          modelType: 'source',
          dataType: column.data_type,
          description: column.description,
          transformation: 'raw',
          filePath: this.getSourceFilePath(sourceId, project) ?? undefined,
        });
      } else {
        this.coder.log.warn(
          `Source ID '${sourceId}' found but source object is null in manifest`,
        );
      }
      return;
    }

    // Get model from manifest
    const modelId = getDbtModelId({ modelName, projectName: project.name });
    if (!modelId) {
      // Check if this might be a source that we couldn't find
      const availableSources = Object.keys(project.manifest.sources ?? {});
      this.coder.log.warn(
        `Model not found in manifest: ${modelName}. ` +
          `Available sources: ${availableSources.slice(0, 3).join(', ')}...`,
      );
      return;
    }

    const manifestNode = project.manifest.nodes?.[modelId];
    if (!manifestNode) {
      this.coder.log.warn(`Model node not found: ${modelId}`);
      return;
    }

    // Get column metadata
    const column = manifestNode.columns?.[columnName];
    const modelLayer = getModelLayer(modelName);

    // Load model.json to analyze transformation
    const modelJsonPath = this.getModelJsonPath(modelName, project);

    if (!modelJsonPath) {
      this.coder.log.debug(
        `No model.json path found for ${modelName} in project ${project.name}`,
      );
      return;
    }

    const modelJson = await this.loadModelJson(modelJsonPath);

    if (!modelJson) {
      this.coder.log.warn(`Could not load model.json for: ${modelName}`);
      return;
    }

    // Analyze how this column was created
    const analysis = this.analyzeColumnTransformation(
      columnName,
      modelJson,
      modelId,
      project,
    );

    // Add node to DAG
    dag.nodes.set(nodeId, {
      id: nodeId,
      columnName,
      modelName,
      modelLayer,
      modelType: modelJson.type,
      dataType: column?.data_type,
      description: column?.description,
      transformation: analysis.type,
      expression: analysis.expression,
      filePath: modelJsonPath || undefined,
    });

    // Check if we've reached the depth limit
    if (maxDepth !== -1 && currentDepth >= maxDepth) {
      return;
    }

    // Recursively trace source columns
    for (let i = 0; i < analysis.sourceColumns.length; i++) {
      const srcCol = analysis.sourceColumns[i];
      // Use || instead of ?? to handle empty strings from unqualified column references
      // Empty string is falsy, so || will fallback to getDefaultParentModel
      const srcModel =
        analysis.sourceModels?.[i] || this.getDefaultParentModel(modelJson);

      if (srcModel) {
        const srcNodeId = `${srcModel}.${srcCol}`;
        this.addEdgeToDag(
          dag,
          srcNodeId,
          nodeId,
          analysis.type,
          analysis.expression,
        );

        // Recursively trace the source column
        await this.traceColumnRecursive(
          srcCol,
          srcModel,
          project,
          dag,
          visited,
          currentDepth + 1,
          maxDepth,
        );
      }
    }
  }

  /**
   * Analyze how a column was transformed in a model
   */
  private analyzeColumnTransformation(
    columnName: string,
    modelJson: FrameworkModel,
    currentModelId: string,
    project: DbtProject,
  ): {
    type: ColumnTransformationType;
    expression?: string;
    sourceColumns: string[];
    sourceModels?: string[];
  } {
    // Check if model has select property (not all model types have it, e.g., int_rollup_model)
    if (!('select' in modelJson) || !modelJson.select) {
      // For models without select (like rollup models), all columns are passthrough from parent
      const parentModel = this.getDefaultParentModel(modelJson);
      if (parentModel) {
        return {
          type: 'passthrough',
          sourceColumns: [columnName],
          sourceModels: [parentModel],
        };
      }
      return { type: 'derived', sourceColumns: [] };
    }

    // Find the select statement for this column
    for (const selected of modelJson.select) {
      // Handle string column name
      if (typeof selected === 'string') {
        if (selected === columnName) {
          return {
            type: 'passthrough',
            sourceColumns: [columnName],
          };
        }
        continue;
      }

      // CTE bulk directives: trace through CTE definitions directly rather than
      // relying on resolveSelectDirective (which may fail if manifest is incomplete).
      if (
        'type' in selected &&
        'cte' in selected &&
        BULK_CTE_TYPES.has(selected.type as string)
      ) {
        const ctes = (
          'ctes' in modelJson && modelJson.ctes ? modelJson.ctes : []
        ) as CteDefinition[];
        const cteName = (selected as { cte: string }).cte;
        const include =
          'include' in selected && Array.isArray(selected.include)
            ? (selected.include as string[])
            : undefined;
        const exclude =
          'exclude' in selected && Array.isArray(selected.exclude)
            ? (selected.exclude as string[])
            : undefined;

        // Build CTE registry to check type + include/exclude filters
        const registry = frameworkBuildCteColumnRegistry({
          ctes: ctes as Parameters<
            typeof frameworkBuildCteColumnRegistry
          >[0]['ctes'],
          modelJson: modelJson as Parameters<
            typeof frameworkBuildCteColumnRegistry
          >[0]['modelJson'],
          project,
        });
        const cteCols = registry.get(cteName) || [];
        const resolvedNames = filterBulkSelectColumns(
          cteCols,
          selected.type as string,
          { include, exclude },
        ).map((c) => c.name);

        if (!resolvedNames.includes(columnName)) {
          continue;
        }

        const cteLineage = this.traceCteColumnLineage(
          columnName,
          cteName,
          ctes,
        );
        if (cteLineage) {
          return cteLineage;
        }
        continue;
      }

      // Handle bulk directives (model, source variants)
      if (
        'type' in selected &&
        (BULK_MODEL_TYPES.has(selected.type as string) ||
          selected.type === BULK_SELECT_TYPES.ALL_FROM_SOURCE)
      ) {
        const expandedCols = this.resolveSelectDirective(
          selected as SelectDirective,
          project,
          modelJson,
        );
        if (expandedCols.includes(columnName)) {
          let sourceModel: string | null = null;
          if ('model' in selected) {
            sourceModel = (selected as { model: string }).model;
          } else if ('source' in selected) {
            sourceModel = (selected as { source: string }).source;
          }

          return {
            type: 'passthrough',
            sourceColumns: [columnName],
            sourceModels: sourceModel ? [sourceModel] : undefined,
          };
        }
        continue;
      }

      // Handle column with name
      if ('name' in selected && selected.name === columnName) {
        // Check for aggregations
        if ('agg' in selected && selected.agg) {
          return {
            type: 'derived',
            expression: `agg: ${selected.agg}`,
            sourceColumns: [columnName],
          };
        }

        if (
          'aggs' in selected &&
          selected.aggs &&
          Array.isArray(selected.aggs)
        ) {
          // This handles the base column that generates multiple agg columns
          // The actual agg columns will have suffixes
          const aggSuffix = this.extractAggSuffix(columnName);
          if (aggSuffix) {
            const baseColName = columnName.replace(`_${aggSuffix}`, '');
            return {
              type: 'derived',
              expression: `agg: ${aggSuffix}`,
              sourceColumns: [baseColName],
            };
          }
        }

        // Check for expression
        if ('expr' in selected && selected.expr) {
          const analysis = this.analyzeExpression(
            selected.expr,
            columnName,
            currentModelId,
            modelJson,
            project,
          );
          return {
            type: analysis.type,
            expression: selected.expr,
            sourceColumns: analysis.sourceColumns,
            sourceModels: analysis.sourceModels,
          };
        }

        // No expression, just a name - passthrough from parent model, source, or CTE
        let sourceModel: string | undefined;
        if ('model' in selected) {
          sourceModel = (selected as { model: string }).model;
        } else if ('source' in selected) {
          sourceModel = (selected as { source: string }).source;
        } else if ('cte' in selected) {
          const ctes = (
            'ctes' in modelJson && modelJson.ctes ? modelJson.ctes : []
          ) as CteDefinition[];
          const cteLineage = this.traceCteColumnLineage(
            columnName,
            (selected as { cte: string }).cte,
            ctes,
          );
          if (cteLineage) {
            return cteLineage;
          }
          sourceModel =
            this.resolveCteToExternalRef(
              (selected as { cte: string }).cte,
              ctes,
            ) ?? undefined;
        }
        return {
          type: 'passthrough',
          sourceColumns: [columnName],
          sourceModels: sourceModel ? [sourceModel] : undefined,
        };
      }
    }

    // Column not found in select - might be auto-generated or from a bulk directive
    // Use findParentModelForColumn for proper parent resolution in join scenarios
    try {
      const parentModel = this.findParentModelForColumn(
        columnName,
        modelJson,
        project,
      );
      if (parentModel) {
        return {
          type: 'passthrough',
          sourceColumns: [columnName],
          sourceModels: [parentModel],
        };
      }
    } catch (error: unknown) {
      this.coder.log.warn(
        `Error finding parent model for column '${columnName}': ${String(error)}`,
      );
    }

    // Check for framework-generated columns from source meta (datetime, portal_partition_*, portal_source_count)
    const frameworkGenerated = this.analyzeFrameworkGeneratedColumn(
      columnName,
      modelJson,
      project,
    );
    if (frameworkGenerated) {
      return frameworkGenerated;
    }

    // Column doesn't exist in any parent - truly derived with no upstream
    return {
      type: 'derived',
      sourceColumns: [],
    };
  }

  /**
   * Analyze framework-generated columns from source meta
   *
   * Framework auto-generates columns based on source meta configuration:
   * - datetime: from event_datetime.expr
   * - portal_partition_daily/hourly/monthly: from event_datetime.expr
   * - portal_source_count: literal 1 (no upstream)
   *
   * @param columnName Column to analyze
   * @param modelJson Model definition
   * @param project dbt project
   * @returns Transformation analysis or null if not a framework-generated column
   */
  private analyzeFrameworkGeneratedColumn(
    columnName: string,
    modelJson: FrameworkModel,
    project: DbtProject,
  ): {
    type: ColumnTransformationType;
    expression?: string;
    sourceColumns: string[];
    sourceModels?: string[];
  } | null {
    // Only applies to models selecting from sources
    if (!('source' in modelJson.from)) {
      return null;
    }

    const sourceMeta = frameworkGetSourceMeta({
      project,
      source: modelJson.from.source,
    });

    if (!sourceMeta) {
      return null;
    }

    const eventDatetimeExpr = sourceMeta.event_datetime?.expr;

    // Check for datetime column
    if (columnName === 'datetime' && eventDatetimeExpr) {
      return {
        type: 'derived',
        expression: `cast(${eventDatetimeExpr} as timestamp(6))`,
        sourceColumns: [eventDatetimeExpr],
        sourceModels: [modelJson.from.source],
      };
    }

    // Check for portal_partition_* columns
    if (columnName.startsWith('portal_partition_') && eventDatetimeExpr) {
      const partitionType = columnName.replace('portal_partition_', '');
      let expr: string;
      switch (partitionType) {
        case 'daily':
          expr = `date_trunc('day', cast(${eventDatetimeExpr} as date))`;
          break;
        case 'hourly':
          expr = `date_trunc('hour', cast(${eventDatetimeExpr} as timestamp(6)))`;
          break;
        case 'monthly':
          expr = `date_trunc('month', cast(${eventDatetimeExpr} as date))`;
          break;
        default:
          return null;
      }
      return {
        type: 'derived',
        expression: expr,
        sourceColumns: [eventDatetimeExpr],
        sourceModels: [modelJson.from.source],
      };
    }

    // Check for portal_source_count (literal 1, no upstream)
    if (columnName === 'portal_source_count') {
      return {
        type: 'derived',
        expression: '1',
        sourceColumns: [],
      };
    }

    return null;
  }

  /**
   * Analyze an expression to determine transformation type and source columns
   */
  private analyzeExpression(
    expr: string,
    columnName: string,
    currentModelId: string,
    currentModelJson: FrameworkModel,
    project: DbtProject,
  ): ExpressionAnalysis {
    const trimmedExpr = expr.trim();

    // Check if expression equals column name (passthrough)
    if (trimmedExpr === columnName) {
      return {
        type: 'passthrough',
        sourceColumns: [columnName],
      };
    }

    // Check if it's a simple column reference (renamed)
    if (SIMPLE_COLUMN_PATTERN.test(trimmedExpr)) {
      return {
        type: 'renamed',
        sourceColumns: [trimmedExpr],
      };
    }

    // Check for qualified column reference
    const qualifiedMatch = QUALIFIED_COLUMN_PATTERN.exec(trimmedExpr);
    if (qualifiedMatch) {
      return {
        type: 'renamed',
        sourceColumns: [qualifiedMatch[2]],
        sourceModels: [qualifiedMatch[1]],
      };
    }

    // Check for literals (numbers, strings)
    if (
      /^[0-9]+$/.test(trimmedExpr) ||
      /^'[^']*'$/.test(trimmedExpr) ||
      /^"[^"]*"$/.test(trimmedExpr)
    ) {
      return {
        type: 'derived',
        sourceColumns: [],
      };
    }

    // Check for macros and try to parse them
    if (trimmedExpr.includes('{{') && trimmedExpr.includes('}}')) {
      const macroResult = this.extractColumnsFromMacro(
        trimmedExpr,
        currentModelJson,
        project,
      );
      // Macro columns can come from:
      // 1. An explicitly passed model parameter (e.g., def_nec('model_name'))
      // 2. Qualified column references in the macro SQL (e.g., model.column)
      // 3. Unqualified columns resolved by checking all parent models (handles joins)
      return {
        type: 'derived',
        sourceColumns: macroResult.columns,
        sourceModels:
          macroResult.models.length > 0 ? macroResult.models : undefined,
      };
    }

    // For complex expressions, try to extract column references with their models
    const { columns, models } = this.extractColumnRefsFromExpr(trimmedExpr);
    return {
      type: 'derived',
      sourceColumns: columns,
      sourceModels: models.length > 0 ? models : undefined,
    };
  }

  /**
   * Extract column references from SQL expressions
   *
   * Parses SQL expressions to identify column and table references, filtering out:
   * - SQL keywords and functions
   * - String literals in quotes
   * - Function call names
   *
   * @param expr - SQL expression to parse
   * @returns Object with arrays of column names and their associated model/table names (empty string if unqualified)
   */
  private extractColumnRefsFromExpr(expr: string): {
    columns: string[];
    models: string[];
  } {
    const columns: string[] = [];
    const models: string[] = [];

    // Remove string literals and SQL function calls before parsing
    const cleanedExpr = expr
      .replace(STRING_LITERAL_PATTERN, '')
      .replace(FUNCTION_CALL_PATTERN, '');

    // Match identifiers: simple (column_name) or qualified (table.column_name)
    const identifierPattern = new RegExp(IDENTIFIER_PATTERN.source, 'g');
    let match;

    while ((match = identifierPattern.exec(cleanedExpr)) !== null) {
      if (match[1] && match[2]) {
        // Qualified reference: table.column
        const tableName = match[1];
        const columnName = match[2];

        if (
          !SQL_KEYWORDS.has(columnName.toLowerCase()) &&
          columnName.length > 0
        ) {
          columns.push(columnName);
          models.push(tableName);
        }
      } else if (match[3]) {
        // Simple identifier: column_name
        const identifier = match[3];

        if (
          !SQL_KEYWORDS.has(identifier.toLowerCase()) &&
          identifier.length > 0
        ) {
          columns.push(identifier);
          models.push('');
        }
      }
    }

    return { columns, models };
  }

  /**
   * Extract column references from a macro expression
   * Looks up the macro in the manifest and parses its SQL
   * Returns both columns and their associated models (if qualified)
   */
  private extractColumnsFromMacro(
    expr: string,
    currentModelJson: FrameworkModel,
    project: DbtProject,
  ): { columns: string[]; models: string[] } {
    // Extract macro name and parameters
    const macroMatch = expr.match(MACRO_PATTERN);
    if (!macroMatch) {
      this.coder.log.warn(
        `Could not extract macro name from expression: ${expr}`,
      );
      return { columns: [], models: [] };
    }

    const macroName = macroMatch[1];
    const macroParams = macroMatch[2];
    this.coder.log.debug(
      `Parsing macro: ${macroName} with params: ${macroParams}`,
    );

    // Extract explicit model parameter if present
    const modelParamMatch = macroParams.match(/['"]([a-zA-Z0-9_]+)['"]/);
    const explicitModelParam = modelParamMatch ? modelParamMatch[1] : null;

    if (explicitModelParam) {
      this.coder.log.debug(
        `Macro ${macroName} explicitly references model: ${explicitModelParam}`,
      );
    }

    // Find the macro in the manifest
    const projectName = project.manifest.metadata?.project_name;
    if (!projectName) {
      this.coder.log.warn('Could not determine project name from manifest');
      return { columns: [], models: [] };
    }

    const macroId = `macro.${projectName}.${macroName}`;
    const macroEntry = project.manifest.macros?.[macroId];

    if (!macroEntry) {
      this.coder.log.warn(
        `Macro not found in manifest: ${macroId}. Available macros: ${Object.keys(
          project.manifest.macros || {},
        )
          .filter((k) => k.includes(macroName))
          .join(', ')}`,
      );
      return { columns: [], models: [] };
    }

    this.coder.log.debug(
      `Found macro in manifest: ${macroId} at ${macroEntry.path}`,
    );

    const macroSql = macroEntry.macro_sql || '';
    if (!macroSql) {
      this.coder.log.warn(`Macro ${macroId} has no SQL body`);
      return { columns: [], models: [] };
    }

    // Clean macro SQL: remove Jinja/SQL comments, nested macros, and string literals
    const cleanedMacroSql = macroSql
      .replace(/\{#[\s\S]*?#\}/g, '') // Jinja comments
      .replace(/\{%[\s\S]*?%\}/g, '') // Jinja blocks
      .replace(/\{\{[\s\S]*?\}\}/g, '') // Nested macro calls
      .replace(/--[^\n\r]*/g, '') // SQL line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // SQL block comments
      .replace(STRING_LITERAL_PATTERN, '');

    this.coder.log.debug(
      `Cleaned macro SQL (${cleanedMacroSql.length} chars after removing comments/Jinja/literals)`,
    );

    // Extract column references from cleaned SQL
    const { columns, models } = this.extractColumnRefsFromExpr(cleanedMacroSql);

    const filteredResults: { columns: string[]; models: string[] } = {
      columns: [],
      models: [],
    };

    // Track seen column+model pairs to avoid duplicates
    const seen = new Set<string>();

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const model = models[i];

      // Skip Jinja keywords
      if (JINJA_KEYWORDS.has(col.toLowerCase())) {
        continue;
      }

      // Determine parent model:
      // explicit param (def_macro_name('model_name')) > qualified (model.column) > find in parents (including joins)
      let resolvedModel: string | null;
      if (explicitModelParam) {
        resolvedModel = explicitModelParam;
      } else if (model) {
        resolvedModel = model;
      } else {
        resolvedModel = this.findParentModelForColumn(
          col,
          currentModelJson,
          project,
        );
      }

      const modelKey = resolvedModel ?? '';
      const key = `${col}:${modelKey}`;

      // Skip duplicates
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      filteredResults.columns.push(col);
      filteredResults.models.push(modelKey);
    }

    this.coder.log.debug(
      `Extracted ${filteredResults.columns.length} columns from macro ${macroName}:`,
    );
    for (let i = 0; i < filteredResults.columns.length; i++) {
      const col = filteredResults.columns[i];
      const model = filteredResults.models[i];
      this.coder.log.debug(
        `  - ${col}${model ? ` from ${model}` : ' (from default parent)'}`,
      );
    }

    if (filteredResults.columns.length === 0) {
      this.coder.log.warn(
        `Macro ${macroName} did not reference any columns (might be a pure transformation or use runtime values)`,
      );
    }

    return filteredResults;
  }

  /**
   * Resolve bulk select directives like all_from_model
   */
  private resolveSelectDirective(
    selected: SelectDirective,
    project: DbtProject,
    modelJson?: FrameworkModel,
  ): string[] {
    // CTE directives: resolve from CTE column registry
    if ('cte' in selected && selected.cte) {
      if (!modelJson || !('ctes' in modelJson) || !modelJson.ctes) {
        return [];
      }
      try {
        const registry = frameworkBuildCteColumnRegistry({
          ctes: modelJson.ctes as Parameters<
            typeof frameworkBuildCteColumnRegistry
          >[0]['ctes'],
          modelJson: modelJson as Parameters<
            typeof frameworkBuildCteColumnRegistry
          >[0]['modelJson'],
          project,
        });
        const cteCols = registry.get(selected.cte) || [];
        return filterBulkSelectColumns(cteCols, selected.type, {
          include: selected.include,
          exclude: selected.exclude,
        }).map((c) => c.name);
      } catch {
        return [];
      }
    }

    // Model / source directives
    if (!('model' in selected || 'source' in selected)) {
      return [];
    }

    const from: { model: string } | { source: string } =
      'model' in selected && selected.model
        ? { model: selected.model }
        : { source: selected.source! };

    const nodeColumns = frameworkGetNodeColumns({
      from,
      project,
      include: selected.include,
      exclude: selected.exclude,
    });

    switch (selected.type) {
      case BULK_SELECT_TYPES.ALL_FROM_MODEL:
      case BULK_SELECT_TYPES.ALL_FROM_SOURCE:
      case BULK_SELECT_TYPES.ALL_FROM_CTE:
        return nodeColumns.columns.map((c) => c.name);

      case BULK_SELECT_TYPES.DIMS_FROM_MODEL:
      case BULK_SELECT_TYPES.DIMS_FROM_CTE:
        return nodeColumns.dimensions.map((c) => c.name);

      case BULK_SELECT_TYPES.FCTS_FROM_MODEL:
      case BULK_SELECT_TYPES.FCTS_FROM_CTE:
        return nodeColumns.facts.map((c) => c.name);

      default:
        return [];
    }
  }

  /**
   * Extract aggregation suffix from a column name (e.g., "amount_sum" -> "sum")
   */
  private extractAggSuffix(columnName: string): string | null {
    for (const agg of AGG_TYPES) {
      if (columnName.endsWith(`_${agg}`)) {
        return agg;
      }
    }

    return null;
  }

  /**
   * Get the default parent model from model.json.
   * If the main from is a CTE, resolves through the CTE chain to find the
   * ultimate external model/source.
   */
  private getDefaultParentModel(modelJson: FrameworkModel): string | null {
    const from = modelJson.from as {
      model?: string;
      source?: string;
      cte?: string;
    };
    if (from.cte && 'ctes' in modelJson && modelJson.ctes) {
      return this.resolveCteToExternalRef(
        from.cte,
        modelJson.ctes as CteDefinition[],
      );
    }
    // source fallback is for main model from (staging types), not CTEs
    return from.model ?? from.source ?? null;
  }

  /**
   * Extract model or source name from an object
   */
  private getModelOrSource(item: {
    model?: string;
    source?: string;
  }): string | null {
    return item.model ?? item.source ?? null;
  }

  /**
   * Traces a column through CTE definitions to determine its actual transformation.
   * Unlike resolveCteToExternalRef (which only finds the external model), this
   * inspects each CTE's select items to detect expr/agg transformations and
   * resolves the true source column name (which may differ from the output name).
   */
  private traceCteColumnLineage(
    columnName: string,
    cteName: string,
    ctes: CteDefinition[],
    visited: Set<string> = new Set(),
  ): {
    type: ColumnTransformationType;
    expression?: string;
    sourceColumns: string[];
    sourceModels?: string[];
  } | null {
    if (visited.has(cteName)) {
      return null;
    }
    visited.add(cteName);

    const cte = ctes.find((c) => c.name === cteName);
    if (!cte) {
      return null;
    }

    const from = cte.from as { model?: string; cte?: string };

    if (!cte.select || !Array.isArray(cte.select)) {
      if (from.cte) {
        return this.traceCteColumnLineage(columnName, from.cte, ctes, visited);
      }
      const sourceModel = from.model || null;
      return {
        type: 'passthrough',
        sourceColumns: [columnName],
        sourceModels: sourceModel ? [sourceModel] : undefined,
      };
    }

    for (const sel of cte.select) {
      if (typeof sel === 'string') {
        if (sel === columnName) {
          if (from.cte) {
            return this.traceCteColumnLineage(
              columnName,
              from.cte,
              ctes,
              visited,
            );
          }
          return {
            type: 'passthrough',
            sourceColumns: [columnName],
            sourceModels: from.model ? [from.model] : undefined,
          };
        }
        continue;
      }
      if (typeof sel !== 'object' || sel === null) {
        continue;
      }

      if ('name' in sel) {
        const selName = sel.name as string;
        const agg = 'agg' in sel ? (sel.agg as string) : undefined;
        const outputName = agg ? `${selName}_${agg}` : selName;

        // Check aggs (multiple aggregations producing suffixed columns)
        if ('aggs' in sel && Array.isArray(sel.aggs)) {
          for (const a of sel.aggs as string[]) {
            if (`${selName}_${a}` === columnName) {
              const sourceModel = this.resolveCteToExternalRef(cteName, ctes);
              return {
                type: 'derived',
                expression: `agg: ${a}`,
                sourceColumns: [selName],
                sourceModels: sourceModel ? [sourceModel] : undefined,
              };
            }
          }
        }

        if (outputName !== columnName) {
          continue;
        }

        if ('expr' in sel && sel.expr) {
          const exprStr = sel.expr as string;
          const sourceModel = this.resolveCteToExternalRef(cteName, ctes);
          // Resolve actual source columns from the CTE's parent that appear in the expr
          const parentCols = this.inferCteParentColumnNames(cteName, ctes);
          const referencedCols = parentCols.filter((col) =>
            exprStr.includes(col),
          );
          return {
            type: 'derived',
            expression: exprStr,
            sourceColumns:
              referencedCols.length > 0 ? referencedCols : [selName],
            sourceModels: sourceModel ? [sourceModel] : undefined,
          };
        }

        if (agg) {
          const sourceModel = this.resolveCteToExternalRef(cteName, ctes);
          return {
            type: 'derived',
            expression: `agg: ${agg}`,
            sourceColumns: [selName],
            sourceModels: sourceModel ? [sourceModel] : undefined,
          };
        }

        // Simple passthrough -- trace further back
        if (from.cte) {
          return this.traceCteColumnLineage(
            columnName,
            from.cte,
            ctes,
            visited,
          );
        }
        return {
          type: 'passthrough',
          sourceColumns: [columnName],
          sourceModels: from.model ? [from.model] : undefined,
        };
      }

      // Bulk CTE directives (all_from_cte, dims_from_cte, fcts_from_cte)
      if ('type' in sel && 'cte' in sel) {
        if (BULK_CTE_TYPES.has(sel.type as string)) {
          const result = this.traceCteColumnLineage(
            columnName,
            (sel as { cte: string }).cte,
            ctes,
            visited,
          );
          if (result) {
            return result;
          }
        }
      }

      // Bulk model directives
      if ('type' in sel && 'model' in sel) {
        if (BULK_MODEL_TYPES.has(sel.type as string)) {
          return {
            type: 'passthrough',
            sourceColumns: [columnName],
            sourceModels: [(sel as { model: string }).model],
          };
        }
      }
    }

    return null;
  }

  /**
   * Infers the output column names of a CTE's parent (the CTE's FROM source).
   * Used to determine which columns an expression references.
   */
  private inferCteParentColumnNames(
    cteName: string,
    ctes: CteDefinition[],
  ): string[] {
    const cte = ctes.find((c) => c.name === cteName);
    if (!cte) {
      return [];
    }

    const from = cte.from as { cte?: string };
    if (!from.cte) {
      return [];
    }

    const parentCte = ctes.find((c) => c.name === from.cte);
    if (!parentCte?.select || !Array.isArray(parentCte.select)) {
      return [];
    }

    const cols: string[] = [];
    for (const s of parentCte.select) {
      if (typeof s === 'string') {
        cols.push(s);
      } else if (typeof s === 'object' && s && 'name' in s) {
        const name = (s as { name: string }).name;
        const agg = 'agg' in s ? (s as { agg: string }).agg : undefined;
        cols.push(agg ? `${name}_${agg}` : name);
      }
    }
    return cols;
  }

  /**
   * Resolve a CTE reference through the ctes array to find the ultimate
   * external model or source name. Follows CTE-to-CTE chains.
   */
  private resolveCteToExternalRef(
    cteName: string,
    ctes: CteDefinition[],
    visited: Set<string> = new Set(), // cycle guard for CTE-to-CTE chains
  ): string | null {
    if (visited.has(cteName)) {
      return null;
    }
    visited.add(cteName);

    const cte = ctes.find((c) => c.name === cteName);
    if (!cte) {
      return null;
    }

    const from = cte.from as { model?: string; cte?: string };
    if (from.model) {
      return from.model;
    }
    if (from.cte) {
      return this.resolveCteToExternalRef(from.cte, ctes, visited);
    }
    return null;
  }

  /**
   * Collect all external model/source refs that a CTE depends on
   * (including through joins and unions).
   */
  private collectCteExternalRefs(
    cteName: string,
    ctes: CteDefinition[],
  ): string[] {
    const refs: string[] = [];
    const cte = ctes.find((c) => c.name === cteName);
    if (!cte) {
      return refs;
    }

    const from = cte.from;
    if ('model' in from && from.model) {
      refs.push(from.model as string);
    }
    if ('cte' in from && from.cte) {
      const resolved = this.resolveCteToExternalRef(from.cte as string, ctes);
      if (resolved) {
        refs.push(resolved);
      }
    }
    if ('join' in from && Array.isArray(from.join)) {
      for (const j of from.join) {
        if (j.model) {
          refs.push(j.model);
        } else if (j.cte) {
          const resolved = this.resolveCteToExternalRef(j.cte, ctes);
          if (resolved) {
            refs.push(resolved);
          }
        }
      }
    }
    if ('union' in from && typeof from.union === 'object' && from.union) {
      const union = from.union as Record<string, unknown>;
      if ('models' in union && Array.isArray(union.models)) {
        refs.push(...(union.models as string[]));
      }
      if ('ctes' in union && Array.isArray(union.ctes)) {
        for (const c of union.ctes as string[]) {
          const resolved = this.resolveCteToExternalRef(c, ctes);
          if (resolved) {
            refs.push(resolved);
          }
        }
      }
    }
    return refs;
  }

  /**
   * Get all parent models including main from, joins, unions, and CTE-resolved refs.
   */
  private getAllParentModels(modelJson: FrameworkModel): string[] {
    const parents: string[] = [];
    const from = modelJson.from as {
      model?: string;
      source?: string;
      cte?: string;
    };
    const ctes = (
      'ctes' in modelJson && modelJson.ctes ? modelJson.ctes : []
    ) as CteDefinition[];

    if (from.cte) {
      const resolved = this.resolveCteToExternalRef(from.cte, ctes);
      if (resolved) {
        parents.push(resolved);
      }
    } else {
      const mainParent = from.model ?? from.source ?? null;
      if (mainParent) {
        parents.push(mainParent);
      }
    }

    if ('join' in modelJson.from && Array.isArray(modelJson.from.join)) {
      for (const join of modelJson.from.join) {
        const joinObj = join as {
          model?: string;
          source?: string;
          cte?: string;
        };
        if ('cte' in joinObj && joinObj.cte) {
          const resolved = this.resolveCteToExternalRef(joinObj.cte, ctes);
          if (resolved && !parents.includes(resolved)) {
            parents.push(resolved);
          }
        } else {
          const joinParent = this.getModelOrSource(joinObj);
          if (joinParent) {
            parents.push(joinParent);
          }
        }
      }
    }

    if ('union' in modelJson.from) {
      const union = (modelJson.from as Record<string, unknown>).union as
        | Record<string, unknown>
        | undefined;
      if (union) {
        if ('models' in union && Array.isArray(union.models)) {
          parents.push(...(union.models as string[]));
        }
        if ('sources' in union && Array.isArray(union.sources)) {
          parents.push(...(union.sources as string[]));
        }
        // CTE-based unions: resolve each CTE to its external model dependency
        if ('ctes' in union && Array.isArray(union.ctes)) {
          for (const cteName of union.ctes as string[]) {
            const resolved = this.resolveCteToExternalRef(cteName, ctes);
            if (resolved && !parents.includes(resolved)) {
              parents.push(resolved);
            }
          }
        }
      }
    }

    // Add external refs from all CTEs
    for (const cte of ctes) {
      const refs = this.collectCteExternalRefs(cte.name, ctes);
      for (const ref of refs) {
        if (!parents.includes(ref)) {
          parents.push(ref);
        }
      }
    }

    return parents;
  }

  /**
   * Find which parent model contains a given column
   *
   * Resolution strategy:
   * 1. If single parent: return it
   * 2. If multiple parents (joins/unions): check each for the column
   * 3. Fallback to default parent if not found
   *
   * @param columnName - Column to find
   * @param modelJson - Current model definition
   * @param project - dbt project
   * @returns Parent model name or null
   */
  private findParentModelForColumn(
    columnName: string,
    modelJson: FrameworkModel,
    project: DbtProject,
  ): string | null {
    const allParents = this.getAllParentModels(modelJson);

    // If only one parent, use it
    if (allParents.length === 1) {
      return allParents[0];
    }

    // If multiple parents (joins/unions), check which one has the column
    for (const parentModel of allParents) {
      try {
        const from = parentModel.includes('.')
          ? { source: parentModel }
          : { model: parentModel };

        const parentColumns = frameworkGetNodeColumns({
          from,
          project,
        }).columns.map((c) => c.name);

        if (parentColumns.includes(columnName)) {
          this.coder.log.debug(
            `Column '${columnName}' found in parent model: ${parentModel}`,
          );
          return parentModel;
        }
      } catch (error: unknown) {
        this.coder.log.warn(
          `Error checking columns for parent model ${parentModel}: ${String(error)}`,
        );
      }
    }

    // If not found in any parent, use the default (main from)
    this.coder.log.warn(
      `Column '${columnName}' not found in any parent model. Using default parent.`,
    );
    return this.getDefaultParentModel(modelJson);
  }

  /**
   * Check if a column exists in a model or source
   *
   * @param columnName - Column to check
   * @param modelOrSourceName - Model or source name to check
   * @param project - dbt project
   * @returns true if column exists
   */
  private columnExistsInModel(
    columnName: string,
    modelOrSourceName: string,
    project: DbtProject,
  ): boolean {
    try {
      const from = modelOrSourceName.includes('.')
        ? { source: modelOrSourceName }
        : { model: modelOrSourceName };

      const columns = frameworkGetNodeColumns({
        from,
        project,
      }).columns.map((c) => c.name);

      return columns.includes(columnName);
    } catch {
      return false;
    }
  }

  /**
   * Find source ID from source name/reference
   *
   * In the manifest, sources are stored with keys like:
   *   "source.project_name.source_name.table_name"
   *
   * And each source object has these properties:
   *   - source_name (format: "database__schema" - example: "development__jaffle_shop_lightdash_dev_seeds")
   *   - name (Table name)
   *   - schema
   *   - database
   *
   * This method tries to match the sourceName against the framework's source ID format.
   * The sourceName can be in various formats from model.json:
   * - "source_name" (just the source name)
   * - "schema.table" (schema and table)
   * - "source_name.table" (source name and table)
   */
  private findSourceId(sourceName: string, project: DbtProject): string | null {
    this.coder.log.debug(
      `findSourceId: sourceName="${sourceName}", project.name="${project.name}", manifest.project_name="${project.manifest.metadata?.project_name}"`,
    );

    // Use manifest project name if available, fallback to project.name
    // This ensures consistency with how source IDs are stored in the manifest
    const projectName = project.manifest.metadata?.project_name ?? project.name;

    // First, try to use the framework's source ID resolution
    // This handles the case where sourceName is in "schema.table" format
    const frameworkSourceId = `source.${projectName}.${sourceName}`;
    this.coder.log.debug(
      `findSourceId: trying frameworkSourceId="${frameworkSourceId}"`,
    );

    if (project.manifest.sources?.[frameworkSourceId]) {
      this.coder.log.debug(
        `findSourceId: found source with framework resolution`,
      );
      return frameworkSourceId;
    }

    this.coder.log.debug(
      `findSourceId: framework resolution failed, trying fallback...`,
    );

    // Fallback to manual matching for backward compatibility
    for (const [sourceId, source] of Object.entries(
      project.manifest.sources || {},
    )) {
      if (!source) {
        continue;
      }

      // Direct table name match
      if (source.name === sourceName) {
        this.coder.log.debug(
          `findSourceId: matched by direct table name: ${sourceId}`,
        );
        return sourceId;
      }

      // source_name.table format (most common)
      if (source.source_name) {
        const sourceNameTable = `${source.source_name}.${source.name}`;
        if (sourceNameTable === sourceName) {
          this.coder.log.debug(
            `findSourceId: matched by source_name.table: ${sourceId}`,
          );
          return sourceId;
        }
      }

      // schema.table format
      const schemaTable = `${source.schema}.${source.name}`;
      if (schemaTable === sourceName) {
        this.coder.log.debug(
          `findSourceId: matched by schema.table: ${sourceId}`,
        );
        return sourceId;
      }

      // database.schema.table format (full qualified name)
      const fullQualified = `${source.database}.${source.schema}.${source.name}`;
      if (fullQualified === sourceName) {
        this.coder.log.debug(
          `findSourceId: matched by database.schema.table: ${sourceId}`,
        );
        return sourceId;
      }

      // Also try matching just the source name part
      const parts = sourceName.split('.');
      if (parts.length === 2) {
        const [schemaOrSource, table] = parts;
        // Check if schema.table matches
        if (source.schema === schemaOrSource && source.name === table) {
          this.coder.log.debug(
            `findSourceId: matched by schema+table parts: ${sourceId}`,
          );
          return sourceId;
        }
        // Check if source_name (converted to schema format) matches
        if (source.source_name) {
          const sourceSchema = source.source_name
            .replace('__', '.')
            .split('.')
            .pop();
          if (sourceSchema === schemaOrSource && source.name === table) {
            this.coder.log.debug(
              `findSourceId: matched by source_name schema conversion: ${sourceId}`,
            );
            return sourceId;
          }
        }
      }
    }

    this.coder.log.debug(`findSourceId: no match found, returning null`);
    return null;
  }

  /**
   * Get model.json path for a model
   */
  private getModelJsonPath(modelName: string, project: DbtProject): string {
    const modelId = getDbtModelId({ modelName, projectName: project.name });
    if (!modelId) {
      return '';
    }

    const model = this.coder.framework.dbt.models.get(modelId);
    if (!model) {
      return '';
    }

    return model.pathSystemFile.replace('.sql', '.model.json');
  }

  /**
   * Get source.json path for a source from its manifest ID
   */
  private getSourceFilePath(
    sourceId: string,
    project: DbtProject,
  ): string | null {
    const source = project.manifest.sources?.[sourceId];
    if (!source?.original_file_path) {
      return null;
    }

    const ymlPath = path.join(project.pathSystem, source.original_file_path);
    return ymlPath.replace(/\.yml$/, '.source.json');
  }

  /**
   * Load model.json file using the same parser as the framework service
   */
  private async loadModelJson(
    filePath: string,
  ): Promise<FrameworkModel | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      // Use jsonc-parser which handles comments and trailing commas automatically
      return jsonParse(content) as FrameworkModel;
    } catch (error: unknown) {
      const errorInfo =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : String(error);
      this.coder.log.error(`Error loading model.json: ${filePath}`, errorInfo);
      return null;
    }
  }

  /**
   * Resolve the source.json path from any source file path (.yml, .source.json, etc.)
   */
  private resolveSourceJsonPath(filePath: string): string {
    const basename = path.basename(filePath);
    if (basename.endsWith('.source.json')) {
      return filePath;
    }
    if (basename.endsWith('.yml')) {
      return filePath.replace(/\.yml$/, '.source.json');
    }
    const dir = path.dirname(filePath);
    return path.join(dir, basename.replace(/\.[^.]+$/, '.source.json'));
  }

  /**
   * Load and parse a source JSON file
   * @returns Parsed source JSON with computed sourceName and file path, or null on error
   */
  private loadSourceJsonSync(filePath: string): {
    sourceJson: any;
    sourceName: string;
    sourceJsonPath: string;
  } | null {
    try {
      const sourceJsonPath = this.resolveSourceJsonPath(filePath);
      const content = fs.readFileSync(sourceJsonPath, 'utf-8');
      const sourceJson = jsonParse(content);
      if (!sourceJson) {
        return null;
      }
      const sourceName = `${sourceJson.database}__${sourceJson.schema}`;
      return { sourceJson, sourceName, sourceJsonPath };
    } catch {
      return null;
    }
  }

  /**
   * Add an edge to the DAG if it doesn't already exist
   * @returns true if edge was added, false if it already existed
   */
  private addEdgeToDag(
    dag: ColumnLineageDAG,
    source: ColumnNodeId,
    target: ColumnNodeId,
    transformation: ColumnTransformationType,
    expression?: string,
  ): boolean {
    const exists = dag.edges.some(
      (e) => e.source === source && e.target === target,
    );
    if (!exists) {
      dag.edges.push({ source, target, transformation, expression });
      return true;
    }
    return false;
  }

  /**
   * Check if leaf nodes have more downstream children in the manifest
   */
  private checkHasMoreDownstream(
    dag: ColumnLineageDAG,
    project: DbtProject,
    fallbackSourceId?: string,
  ): boolean {
    return dag.leaves.some((leafId) => {
      const node = dag.nodes.get(leafId);
      if (!node) {
        return false;
      }

      const modelId = getDbtModelId({
        modelName: node.modelName,
        projectName: project.name,
      });

      let childIds: string[] = [];
      if (modelId) {
        childIds = project.manifest.child_map?.[modelId] ?? [];
      } else if (node.modelLayer === 'source' && fallbackSourceId) {
        childIds = project.manifest.child_map?.[fallbackSourceId] ?? [];
      } else {
        const sourceId = this.findSourceId(node.modelName, project);
        if (sourceId) {
          childIds = project.manifest.child_map?.[sourceId] ?? [];
        }
      }

      return childIds.some((id) => id.startsWith('model.'));
    });
  }

  /**
   * Check if root nodes have more upstream ancestors by analyzing column transformations
   */
  private async checkHasMoreUpstream(
    dag: ColumnLineageDAG,
    project: DbtProject,
  ): Promise<boolean> {
    this.coder.log.debug(
      `checkHasMoreUpstream: Checking ${dag.roots.length} root nodes`,
    );

    // Check each root node
    for (const rootId of dag.roots) {
      const node = dag.nodes.get(rootId);
      if (!node) {
        this.coder.log.debug(
          `checkHasMoreUpstream: Node not found for ${rootId}`,
        );
        continue;
      }

      // Source nodes have no upstream
      if (node.modelLayer === 'source') {
        this.coder.log.debug(
          `checkHasMoreUpstream: Skipping source node ${rootId}`,
        );
        continue;
      }

      // Load model JSON and analyze the column
      const modelId = getDbtModelId({
        modelName: node.modelName,
        projectName: project.name,
      });
      if (!modelId) {
        this.coder.log.debug(
          `checkHasMoreUpstream: No model ID for ${node.modelName}`,
        );
        continue;
      }

      // Pass modelName (not modelId) to getModelJsonPath
      const modelJsonPath = this.getModelJsonPath(node.modelName, project);
      if (!modelJsonPath) {
        this.coder.log.debug(
          `checkHasMoreUpstream: No JSON path for ${node.modelName}`,
        );
        continue;
      }

      const modelJson = await this.loadModelJson(modelJsonPath);
      if (!modelJson) {
        this.coder.log.debug(
          `checkHasMoreUpstream: Failed to load JSON for ${node.modelName}`,
        );
        continue;
      }

      // Analyze if column can be traced upstream
      const analysis = this.analyzeColumnTransformation(
        node.columnName,
        modelJson,
        modelId,
        project,
      );

      this.coder.log.debug(
        `checkHasMoreUpstream: Analysis for ${rootId}: sourceColumns=${analysis.sourceColumns.length}, type=${analysis.type}`,
      );

      // If column has source columns, it can be traced further
      if (analysis.sourceColumns.length > 0) {
        this.coder.log.debug(
          `checkHasMoreUpstream: Found upstream for ${rootId}, returning true`,
        );
        return true;
      }
    }

    this.coder.log.debug(
      `checkHasMoreUpstream: No upstream found, returning false`,
    );
    return false;
  }

  /**
   * Recursively trace column descendants (downstream models that use this column)
   * @param columnName Column to trace
   * @param modelName Current model name
   * @param project dbt project
   * @param dag DAG to populate
   * @param visited Set of visited node IDs
   * @param currentDepth Current recursion depth
   * @param maxDepth Maximum depth to trace (-1 for unlimited)
   * @param depthLimitedLeaves Set to track leaves stopped by depth limit
   */
  private async traceColumnDescendants(
    columnName: string,
    modelName: string,
    project: DbtProject,
    dag: ColumnLineageDAG,
    visited: Set<ColumnNodeId>,
    currentDepth: number = 0,
    maxDepth: number = -1,
    depthLimitedLeaves?: Set<ColumnNodeId>,
  ): Promise<void> {
    const nodeId = `${modelName}.${columnName}`;

    // Check if we've reached the depth limit
    if (maxDepth !== -1 && currentDepth >= maxDepth) {
      // Mark this node as stopped due to depth limit
      if (depthLimitedLeaves) {
        depthLimitedLeaves.add(nodeId);
      }
      return;
    }

    // Get the model ID for looking up children
    const modelId = getDbtModelId({ modelName, projectName: project.name });
    if (!modelId) {
      // Could be a source - get source ID
      const sourceId = this.findSourceId(modelName, project);
      if (sourceId) {
        // Get children of this source
        const childIds = project.manifest.child_map?.[sourceId] ?? [];
        for (const childId of childIds) {
          await this.traceDescendantModel(
            columnName,
            modelName,
            childId,
            project,
            dag,
            visited,
            currentDepth,
            maxDepth,
            depthLimitedLeaves,
          );
        }
      }
      return;
    }

    // Get child models from manifest
    const childIds = project.manifest.child_map?.[modelId] ?? [];

    for (const childId of childIds) {
      await this.traceDescendantModel(
        columnName,
        modelName,
        childId,
        project,
        dag,
        visited,
        currentDepth,
        maxDepth,
        depthLimitedLeaves,
      );
    }
  }

  /**
   * Trace a specific descendant model to find columns that derive from the source column
   */
  private async traceDescendantModel(
    sourceColumnName: string,
    sourceModelName: string,
    childModelId: string,
    project: DbtProject,
    dag: ColumnLineageDAG,
    visited: Set<ColumnNodeId>,
    currentDepth: number,
    maxDepth: number,
    depthLimitedLeaves?: Set<ColumnNodeId>,
  ): Promise<void> {
    // Extract model name from ID (e.g., "model.project.model_name" -> "model_name")
    const parts = childModelId.split('.');
    const childModelName = parts[parts.length - 1];

    // Load the child model's .model.json
    const modelJsonPath = this.getModelJsonPath(childModelName, project);

    if (!modelJsonPath) {
      this.coder.log.debug(
        `No model.json path found for ${childModelName} in project ${project.name}`,
      );
      return;
    }

    const modelJson = await this.loadModelJson(modelJsonPath);

    if (!modelJson) {
      return;
    }

    // Get columns from manifest for this child model
    const manifestNode = project.manifest.nodes?.[childModelId];
    if (!manifestNode?.columns) {
      return;
    }

    // Check each column in the child model to see if it derives from our source column
    for (const childColumnName of Object.keys(manifestNode.columns)) {
      const childNodeId = `${childModelName}.${childColumnName}`;

      // Skip if already visited
      if (visited.has(childNodeId)) {
        continue;
      }

      // Analyze how this column was created
      const analysis = this.analyzeColumnTransformation(
        childColumnName,
        modelJson,
        childModelId,
        project,
      );

      // Check if this column derives from our source column
      const derivesFromSource = analysis.sourceColumns.some((srcCol) => {
        // Use || instead of ?? to handle empty strings from unqualified column references
        // Empty string is falsy, so || will fallback to getDefaultParentModel
        const srcModel =
          analysis.sourceModels?.[analysis.sourceColumns.indexOf(srcCol)] ||
          this.getDefaultParentModel(modelJson);
        return srcModel === sourceModelName && srcCol === sourceColumnName;
      });

      if (derivesFromSource) {
        visited.add(childNodeId);

        const column = manifestNode.columns[childColumnName];
        const modelLayer = getModelLayer(childModelName);

        // Add node
        dag.nodes.set(childNodeId, {
          id: childNodeId,
          columnName: childColumnName,
          modelName: childModelName,
          modelLayer,
          modelType: modelJson.type,
          dataType: column?.data_type,
          description: column?.description,
          transformation: analysis.type,
          expression: analysis.expression,
          filePath: modelJsonPath || undefined,
        });

        // Add edge from source to this column
        const sourceNodeId = `${sourceModelName}.${sourceColumnName}`;
        this.addEdgeToDag(
          dag,
          sourceNodeId,
          childNodeId,
          analysis.type,
          analysis.expression,
        );

        // Recursively trace this column's descendants
        await this.traceColumnDescendants(
          childColumnName,
          childModelName,
          project,
          dag,
          visited,
          currentDepth + 1,
          maxDepth,
          depthLimitedLeaves,
        );
      }
    }
  }

  // ========== SOURCE FILE METHODS ==========

  /**
   * Validate that source files exist
   */
  async validateSourceFiles(filePath: string): Promise<{
    valid: boolean;
    error?: string;
    basePath?: string;
    sourceName?: string;
  }> {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, ext);

    // Derive base path (remove .source extension)
    let baseName = basename;
    if (baseName.endsWith('.source')) {
      baseName = baseName.replace(/\.source$/, '');
    }

    const basePath = path.join(dir, baseName);
    const sourceJsonPath = `${basePath}.source.json`;
    const ymlPath = `${basePath}.yml`;

    // Check if source files exist
    const sourceJsonExists = await this.coder.fileExists(sourceJsonPath);
    const ymlExists = await this.coder.fileExists(ymlPath);

    if (!sourceJsonExists) {
      return {
        valid: false,
        error: 'Source JSON file not found. Expected: ' + sourceJsonPath,
      };
    }

    if (!ymlExists) {
      return {
        valid: false,
        error:
          'YAML file not found. Please run DJ Sync to generate source files first.',
      };
    }

    return {
      valid: true,
      basePath,
      sourceName: baseName,
    };
  }

  /**
   * Get tables from a source file.
   * Tries .source.json first (DJ-enhanced metadata), then falls back to manifest.
   */
  async getSourceTables(filePath: string): Promise<{
    success: boolean;
    error?: string;
    sourceName?: string;
    tables?: Array<{ name: string; columnCount: number }>;
  }> {
    try {
      // Try .source.json first (has DJ-enhanced metadata)
      const loaded = this.loadSourceJsonSync(filePath);
      if (loaded?.sourceJson.tables) {
        const tables = loaded.sourceJson.tables.map(
          (table: { name: string; columns?: any[] }) => ({
            name: table.name,
            columnCount: table.columns?.length ?? 0,
          }),
        );
        return { success: true, sourceName: loaded.sourceName, tables };
      }

      // Fallback: read from dbt manifest
      return this.getSourceTablesFromManifest(filePath);
    } catch (error: unknown) {
      this.coder.log.error('Error getting source tables:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get source tables from the dbt manifest (fallback when .source.json doesn't exist)
   */
  private getSourceTablesFromManifest(filePath: string): {
    success: boolean;
    error?: string;
    sourceName?: string;
    tables?: Array<{ name: string; columnCount: number }>;
  } {
    // Find the project containing this file
    const project = this.coder.framework.dbt.getProjectFromPath(filePath);
    if (!project?.manifest) {
      return {
        success: false,
        error: 'Could not find dbt project for this file',
      };
    }

    // Normalize file path for comparison
    const normalizedFilePath = filePath
      ?.replace(/\.source\.json$/, '.yml')
      .replace(/\\/g, '/');

    // Find all sources that match this file path
    const sources = project.manifest.sources ?? {};
    const matchingSources: Array<{
      name: string;
      sourceName: string;
      columnCount: number;
    }> = [];

    let derivedSourceName: string | undefined;

    for (const source of Object.values(sources)) {
      if (!source) {
        continue;
      }

      // Check if this source's file path matches
      if (source.original_file_path) {
        const fullSourcePath = path
          .join(project.pathSystem, source.original_file_path)
          .replace(/\\/g, '/');

        if (
          normalizedFilePath === fullSourcePath ||
          normalizedFilePath?.endsWith(source.original_file_path)
        ) {
          // Derive source name from first matching source
          if (!derivedSourceName) {
            derivedSourceName =
              `${source.database ?? ''}__${source.schema ?? ''}`
                .replace(/^__/, '')
                .replace(/__$/, '') || source.source_name;
          }

          matchingSources.push({
            name: source.name ?? '',
            sourceName: source.source_name ?? '',
            columnCount: Object.keys(source.columns ?? {}).length,
          });
        }
      }
    }

    if (matchingSources.length === 0) {
      return {
        success: false,
        error: 'No sources found in manifest for this file',
      };
    }

    const tables = matchingSources.map((s) => ({
      name: s.name,
      columnCount: s.columnCount,
    }));

    return { success: true, sourceName: derivedSourceName, tables };
  }

  /**
   * Get columns from a specific table in a source file.
   * Tries .source.json first (DJ-enhanced metadata), then falls back to manifest.
   */
  async getSourceColumns(
    filePath: string,
    tableName: string,
  ): Promise<{
    success: boolean;
    error?: string;
    sourceName?: string;
    columns?: Array<{
      name: string;
      data_type?: string;
      description?: string;
      type?: 'dim' | 'fct';
    }>;
  }> {
    try {
      // Try .source.json first (has DJ-enhanced metadata like dim/fct types)
      const loaded = this.loadSourceJsonSync(filePath);
      if (loaded?.sourceJson.tables) {
        const table = loaded.sourceJson.tables.find(
          (t: { name: string }) => t.name === tableName,
        );
        if (table) {
          const columns = (table.columns ?? []).map(
            (col: {
              name: string;
              data_type?: string;
              description?: string;
              type?: 'dim' | 'fct';
            }) => ({
              name: col.name,
              data_type: col.data_type,
              description: col.description,
              type: col.type,
            }),
          );
          return { success: true, sourceName: loaded.sourceName, columns };
        }
      }

      // Fallback: read from dbt manifest
      return this.getSourceColumnsFromManifest(filePath, tableName);
    } catch (error: unknown) {
      this.coder.log.error('Error getting source columns:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get source columns from the dbt manifest (fallback when .source.json doesn't exist)
   */
  private getSourceColumnsFromManifest(
    filePath: string,
    tableName: string,
  ): {
    success: boolean;
    error?: string;
    sourceName?: string;
    columns?: Array<{
      name: string;
      data_type?: string;
      description?: string;
      type?: 'dim' | 'fct';
    }>;
  } {
    // Find the project containing this file
    const project = this.coder.framework.dbt.getProjectFromPath(filePath);
    if (!project?.manifest) {
      return {
        success: false,
        error: 'Could not find dbt project for this file',
      };
    }

    // Find the source in manifest by matching tableName
    const source = this.findSourceInManifest(project, tableName, filePath);
    if (!source) {
      return {
        success: false,
        error: `Source table '${tableName}' not found in manifest`,
      };
    }

    // Extract columns from manifest source
    const manifestColumns = source.columns ?? {};
    const columns = Object.values(manifestColumns)
      .filter((col): col is NonNullable<typeof col> => col !== undefined)
      .map((col) => ({
        name: col.name,
        data_type: col.data_type,
        description: col.description,
        type: (col.meta?.type as 'dim' | 'fct') ?? undefined,
      }));

    // Build sourceName from database and schema
    const sourceName =
      `${source.database ?? ''}__${source.schema ?? ''}`
        .replace(/^__/, '')
        .replace(/__$/, '') || source.source_name;

    return { success: true, sourceName, columns };
  }

  /**
   * Find a source in the manifest by table name and optionally file path
   */
  private findSourceInManifest(
    project: DbtProject,
    tableName: string,
    filePath?: string,
  ): Partial<import('@shared/dbt/types').DbtProjectManifestSource> | undefined {
    const sources = project.manifest?.sources ?? {};

    // Normalize file path for comparison
    const normalizedFilePath = filePath
      ?.replace(/\.source\.json$/, '.yml')
      .replace(/\\/g, '/');

    for (const source of Object.values(sources)) {
      if (!source) {
        continue;
      }

      // Match by table name (source.name is the table name)
      if (source.name === tableName) {
        // If filePath provided, also verify it matches
        if (normalizedFilePath && source.original_file_path) {
          const fullSourcePath = path
            .join(project.pathSystem, source.original_file_path)
            .replace(/\\/g, '/');
          if (
            normalizedFilePath === fullSourcePath ||
            normalizedFilePath.endsWith(source.original_file_path)
          ) {
            return source;
          }
        } else {
          return source;
        }
      }
    }

    return undefined;
  }

  /**
   * Get columns from a seed file using the dbt manifest
   */
  async getSeedColumns(
    filePath: string,
    seedName: string,
  ): Promise<{
    success: boolean;
    error?: string;
    seedName?: string;
    columns?: Array<{
      name: string;
      data_type?: string;
      description?: string;
      type?: 'dim' | 'fct';
    }>;
  }> {
    try {
      // Find the project containing this file
      const project = this.coder.framework.dbt.getProjectFromPath(filePath);
      if (!project?.manifest) {
        return {
          success: false,
          error: 'Could not find dbt project for this file',
        };
      }

      // Find the seed in manifest
      const seed = this.findSeedInManifest(project, seedName, filePath);
      if (!seed) {
        return {
          success: false,
          error: `Seed '${seedName}' not found in manifest`,
        };
      }

      // Extract columns from manifest node
      const manifestColumns = seed.columns ?? {};
      const columns = Object.values(manifestColumns)
        .filter(
          (col): col is NonNullable<typeof col> & { name: string } =>
            col !== undefined && typeof col.name === 'string',
        )
        .map((col) => ({
          name: col.name,
          data_type: col.data_type,
          description: col.description,
          type: (col.meta?.type as 'dim' | 'fct') ?? undefined,
        }));

      return { success: true, seedName: seed.name ?? seedName, columns };
    } catch (error: unknown) {
      this.coder.log.error('Error getting seed columns:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Find a seed in the manifest by name and optionally file path
   */
  private findSeedInManifest(
    project: DbtProject,
    seedName: string,
    filePath?: string,
  ): Partial<import('@shared/dbt/types').DbtProjectManifestNode> | undefined {
    const nodes = project.manifest?.nodes ?? {};

    // Normalize file path for comparison
    const normalizedFilePath = filePath?.replace(/\\/g, '/');

    for (const node of Object.values(nodes)) {
      if (node?.resource_type !== 'seed') {
        continue;
      }

      // Match by seed name
      if (node.name === seedName) {
        // If filePath provided, also verify it matches
        if (normalizedFilePath && node.original_file_path) {
          const fullSeedPath = path
            .join(project.pathSystem, node.original_file_path)
            .replace(/\\/g, '/');
          if (
            normalizedFilePath === fullSeedPath ||
            normalizedFilePath.endsWith(node.original_file_path)
          ) {
            return node;
          }
        } else {
          return node;
        }
      }
    }

    return undefined;
  }

  /**
   * Compute forward lineage from a source column
   */
  async computeSourceLineage(
    filePath: string,
    tableName: string,
    columnName: string,
    options?: { downstreamLevels?: number },
  ): Promise<ColumnLineageResult> {
    try {
      const validation = await this.validateSourceFiles(filePath);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const project = this.coder.framework.dbt.getProjectFromPath(filePath);
      if (!project) {
        return {
          success: false,
          error: 'Could not find dbt project for this file',
        };
      }

      const loaded = this.loadSourceJsonSync(filePath);
      if (!loaded) {
        return { success: false, error: 'Invalid source JSON' };
      }

      const { sourceJson, sourceName, sourceJsonPath } = loaded;
      const sourceId = `source.${project.name}.${sourceName}.${tableName}`;

      const table = sourceJson.tables?.find(
        (t: { name: string }) => t.name === tableName,
      );
      const column = table?.columns?.find(
        (c: { name: string }) => c.name === columnName,
      );

      if (!column) {
        return {
          success: false,
          error: `Column '${columnName}' not found in table '${tableName}'`,
        };
      }

      const downstreamLevels = options?.downstreamLevels ?? -1;
      const sourceNodeId = `${sourceId}.${columnName}`;

      const dag: ColumnLineageDAG = {
        targetColumn: sourceNodeId,
        nodes: new Map(),
        edges: [],
        roots: [sourceNodeId],
        leaves: [],
        hasMoreUpstream: false,
        hasMoreDownstream: false,
      };

      dag.nodes.set(sourceNodeId, {
        id: sourceNodeId,
        columnName,
        modelName: `${sourceName}.${tableName}`,
        modelLayer: 'source',
        modelType: 'source',
        dataType: column.data_type,
        description: column.description,
        transformation: 'raw',
        filePath: sourceJsonPath,
      });

      const visited = new Set<ColumnNodeId>([sourceNodeId]);

      // Track leaves that were stopped due to depth limit
      const depthLimitedLeaves = new Set<ColumnNodeId>();

      if (downstreamLevels !== 0) {
        await this.traceSourceColumnDescendants(
          columnName,
          sourceId,
          sourceName,
          tableName,
          project,
          dag,
          visited,
          0,
          downstreamLevels,
          depthLimitedLeaves,
        );
      }

      // Find leaves (nodes with no outgoing edges)
      const nodesWithOutgoing = new Set(dag.edges.map((e) => e.source));
      for (const nodeId of dag.nodes.keys()) {
        if (!nodesWithOutgoing.has(nodeId)) {
          dag.leaves.push(nodeId);
        }
      }

      // Check if there are more downstream nodes
      // If some leaves hit depth limit, check if they have children (model-level check)
      // If no leaves hit depth limit, all lineage is exhausted
      if (depthLimitedLeaves.size > 0) {
        dag.hasMoreDownstream = this.checkHasMoreDownstream(
          dag,
          project,
          sourceId,
        );
      } else {
        dag.hasMoreDownstream = false;
      }

      return { success: true, dag };
    } catch (error: unknown) {
      this.coder.log.error('Error computing source column lineage:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Trace descendants of a source column through downstream models
   */
  private async traceSourceColumnDescendants(
    sourceColumnName: string,
    sourceId: string,
    sourceName: string,
    tableName: string,
    project: DbtProject,
    dag: ColumnLineageDAG,
    visited: Set<ColumnNodeId>,
    currentDepth: number,
    maxDepth: number,
    depthLimitedLeaves?: Set<ColumnNodeId>,
  ): Promise<void> {
    const nodeId = `${sourceId}.${sourceColumnName}`;

    // Check depth limit
    if (maxDepth !== -1 && currentDepth >= maxDepth) {
      // Mark this node as stopped due to depth limit
      if (depthLimitedLeaves) {
        depthLimitedLeaves.add(nodeId);
      }
      return;
    }

    // Get child models from manifest
    const childModelIds = project.manifest.child_map?.[sourceId] ?? [];

    for (const childModelId of childModelIds) {
      // Skip non-model children (e.g., tests)
      if (!childModelId.startsWith('model.')) {
        continue;
      }

      const manifestNode = project.manifest.nodes?.[childModelId];
      if (!manifestNode) {
        continue;
      }

      const childModelName = manifestNode.name;
      if (!childModelName) {
        continue;
      }

      // Try to load model JSON
      const modelJsonPath = manifestNode.original_file_path
        ? path.join(
            project.pathSystem,
            manifestNode.original_file_path.replace(/\.sql$/, '.model.json'),
          )
        : null;

      let modelJson: FrameworkModel | null = null;
      if (modelJsonPath && fs.existsSync(modelJsonPath)) {
        try {
          const content = fs.readFileSync(modelJsonPath, 'utf-8');
          modelJson = jsonParse(content);
        } catch {
          // Ignore parse errors
        }
      }

      if (!modelJson) {
        continue;
      }

      // Check if this model selects from our source
      const fromSource = this.getModelFromSource(modelJson);
      if (!fromSource?.includes(tableName)) {
        continue;
      }

      // Check each column in the child model
      const manifestColumns = manifestNode.columns ?? {};
      const childColumns = Object.keys(manifestColumns);

      for (const childColumnName of childColumns) {
        // Use model name (not full model ID) for consistency with traceColumnDescendants
        const childNodeId = `${childModelName}.${childColumnName}`;

        // Skip already visited
        if (visited.has(childNodeId)) {
          continue;
        }

        // Analyze how this column was created
        const analysis = this.analyzeColumnTransformation(
          childColumnName,
          modelJson,
          childModelId,
          project,
        );

        // Check if this column derives from our source column
        // For source lineage, we need to check if the column references the source column
        // by name. Since we already filtered to only models that select from this source table,
        // any matching column name should be from our source.
        const derivesFromSource = analysis.sourceColumns.some((srcCol) => {
          return srcCol === sourceColumnName;
        });

        if (derivesFromSource) {
          visited.add(childNodeId);

          const column = manifestColumns[childColumnName];
          const modelLayer = getModelLayer(childModelName);

          // Add node
          dag.nodes.set(childNodeId, {
            id: childNodeId,
            columnName: childColumnName,
            modelName: childModelName,
            modelLayer,
            modelType: modelJson.type,
            dataType: column?.data_type,
            description: column?.description,
            transformation: analysis.type,
            expression: analysis.expression,
            filePath: modelJsonPath || undefined,
          });

          // Add edge from source to this column
          const sourceNodeId = `${sourceId}.${sourceColumnName}`;
          this.addEdgeToDag(
            dag,
            sourceNodeId,
            childNodeId,
            analysis.type,
            analysis.expression,
          );

          // Recursively trace this column's descendants using existing method
          // This will trace further downstream models that use this column
          await this.traceColumnDescendants(
            childColumnName,
            childModelName,
            project,
            dag,
            visited,
            currentDepth + 1,
            maxDepth,
            depthLimitedLeaves,
          );
        }
      }
    }
  }

  /**
   * Get the source reference from a model's from clause
   */
  private getModelFromSource(modelJson: FrameworkModel): string | null {
    if (!modelJson.from) {
      return null;
    }

    if ('source' in modelJson.from) {
      return modelJson.from.source;
    }

    return null;
  }
}
