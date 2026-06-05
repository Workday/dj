import type { Coder } from '@services/coder';
import { assertExhaustive } from '@shared';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type {
  DbtModel,
  DbtProject,
  DbtProjectManifestNode,
  DbtProjectManifestSource,
} from '@shared/dbt/types';
import { getDbtModelId } from '@shared/dbt/utils';
import type { LineageData, LineageNode } from '@shared/modellineage/types';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class ModelLineage {
  private readonly coder: Coder;
  readonly handleApi: (
    payload: ApiPayload<'model-lineage'>,
  ) => Promise<ApiResponse>;

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;

    this.handleApi = async (payload) => {
      switch (payload.type) {
        case 'data-explorer-get-model-lineage': {
          try {
            const { modelName, projectName } = payload.request;
            this.coder.log.info(
              `Fetching lineage for model: ${modelName} in project: ${projectName}`,
            );

            const lineageData = await this.getModelLineage(
              modelName,
              projectName,
            );

            return apiResponse<typeof payload.type>(lineageData);
          } catch (error: unknown) {
            this.coder.log.error('Error fetching model lineage:', error);
            throw error;
          }
        }

        case 'data-explorer-execute-query': {
          try {
            const { modelName, projectName, limit = 100 } = payload.request;

            const startTime = Date.now();
            const results = await this.executeModelQuery(
              modelName,
              projectName,
              limit,
            );
            const executionTime = Date.now() - startTime;

            return apiResponse<typeof payload.type>({
              ...results,
              executionTime,
            });
          } catch (error: unknown) {
            this.coder.log.error('Error executing query:', error);
            throw error;
          }
        }

        case 'data-explorer-ready': {
          try {
            this.coder.log.info('Data Explorer webview ready message received');
            // Notify DataExplorer service that webview is ready
            this.coder.dataExplorer.onWebviewReady();
            return apiResponse<typeof payload.type>(undefined);
          } catch (error: unknown) {
            this.coder.log.error('Error handling data explorer ready:', error);
            throw error;
          }
        }

        case 'data-explorer-detect-active-model': {
          try {
            this.coder.log.info('Detecting active model manually');
            const activeModel = this.getCurrentActiveModel(
              vscode.window.activeTextEditor,
            );
            this.coder.log.info('Detected active model:', activeModel);
            return apiResponse<typeof payload.type>(activeModel);
          } catch (error: unknown) {
            this.coder.log.error('Error detecting active model:', error);
            throw error;
          }
        }

        case 'data-explorer-open-model-file': {
          try {
            const { modelName, projectName } = payload.request;
            await this.openModelFile(modelName, projectName);
            return apiResponse<typeof payload.type>({ success: true });
          } catch (error: unknown) {
            this.coder.log.error('Error opening model file:', error);
            throw error;
          }
        }

        case 'data-explorer-get-compiled-sql': {
          try {
            const { modelName, projectName } = payload.request;
            this.coder.log.info(
              `Fetching compiled SQL for model: ${modelName} in project: ${projectName}`,
            );

            const modelId = getDbtModelId({ modelName, projectName });
            const model = this.coder.framework.dbt.models.get(modelId);
            const project = this.coder.framework.dbt.projects.get(projectName);

            if (!model || !project) {
              this.coder.log.warn(
                `Model or project not found: ${modelName} in ${projectName}`,
              );
              return apiResponse<typeof payload.type>({
                sql: null,
                compiledPath: undefined,
              });
            }

            const compiledPath = this.getCompiledSqlPath(
              project,
              model,
              modelName,
            );

            if (!fs.existsSync(compiledPath)) {
              this.coder.log.info(
                `Compiled SQL file not found at: ${compiledPath}`,
              );
              return apiResponse<typeof payload.type>({
                sql: null,
                compiledPath: undefined,
                lastModified: undefined,
              });
            }

            const sql = fs.readFileSync(compiledPath, 'utf-8');
            const stats = fs.statSync(compiledPath);
            const lastModified = stats.mtime.getTime();
            this.coder.log.info(
              `Successfully read compiled SQL from: ${compiledPath} (modified: ${new Date(lastModified).toISOString()})`,
            );

            return apiResponse<typeof payload.type>({
              sql,
              compiledPath,
              lastModified,
            });
          } catch (error: unknown) {
            this.coder.log.error('Error fetching compiled SQL:', error);
            return apiResponse<typeof payload.type>({
              sql: null,
              compiledPath: undefined,
            });
          }
        }

        default:
          return assertExhaustive<any>(payload);
      }
    };
  }

  /**
   * Get the lineage (upstream and downstream) for a specific model.
   * For upstream source nodes, queries Trino $properties to discover python model lineage.
   */
  private async getModelLineage(
    modelName: string,
    projectName: string,
  ): Promise<LineageData> {
    const project = this.coder.framework.dbt.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    const manifest = project.manifest;
    if (!manifest) {
      throw new Error(`Manifest not found for project ${projectName}`);
    }

    const modelId = getDbtModelId({ modelName, projectName });
    const model = this.coder.framework.dbt.models.get(modelId);

    if (!model) {
      throw new Error(`Model ${modelName} not found in project ${projectName}`);
    }

    // Get current node
    const currentNode = this.manifestNodeToLineageNode(
      model.unique_id ?? modelId,
      manifest.nodes[model.unique_id ?? modelId],
      project,
    );

    // Get upstream (parents) - filter out test nodes
    const parentIds = manifest.parent_map?.[model.unique_id ?? modelId] ?? [];
    const upstream: LineageNode[] = [];

    for (const parentId of parentIds) {
      if (parentId.startsWith('test.')) {
        continue;
      }
      const node = manifest.nodes[parentId] ?? manifest.sources[parentId];
      if (node) {
        upstream.push(this.manifestNodeToLineageNode(parentId, node, project));
      }
    }

    // Get downstream (children) - filter out test nodes
    const childIds = manifest.child_map?.[model.unique_id ?? modelId] ?? [];
    const downstream: LineageNode[] = [];

    for (const childId of childIds) {
      if (childId.startsWith('test.')) {
        continue;
      }
      const node = manifest.nodes[childId];
      if (node) {
        downstream.push(this.manifestNodeToLineageNode(childId, node, project));
      }
    }

    // For upstream source nodes, check Trino $properties for python model metadata
    const { nodes: pythonModelNodes, edges: pythonModelEdges } =
      await this.discoverPythonModelUpstream(upstream);
    if (pythonModelNodes.length > 0) {
      upstream.unshift(...pythonModelNodes);
    }

    return {
      current: currentNode,
      upstream,
      downstream,
      pythonModelEdges:
        pythonModelEdges.length > 0 ? pythonModelEdges : undefined,
    };
  }

  /**
   * For each source node in the upstream list, query the Trino $properties
   * virtual table to check for python.model.* metadata. If found, synthesize
   * a python LineageNode that sits upstream of the source.
   *
   * The catalog is read from the source's `database` field (e.g. "iceberg"),
   * NOT hardcoded.
   */
  private async discoverPythonModelUpstream(
    upstreamNodes: LineageNode[],
  ): Promise<{
    nodes: LineageNode[];
    edges: { pythonModelNodeId: string; sourceNodeId: string }[];
  }> {
    const pythonModelNodes: LineageNode[] = [];
    const pythonModelEdges: {
      pythonModelNodeId: string;
      sourceNodeId: string;
    }[] = [];
    const sourceNodes = upstreamNodes.filter((n) => n.type === 'source');

    if (sourceNodes.length === 0) {
      return { nodes: pythonModelNodes, edges: pythonModelEdges };
    }

    const queries = sourceNodes.map(async (sourceNode) => {
      const catalog = sourceNode.database;
      const schema = sourceNode.schema;
      const tableName = sourceNode.name;

      if (!catalog || !schema || !tableName) {
        return null;
      }

      try {
        const sql = `SELECT key, value FROM ${catalog}.${schema}."${tableName}$properties" WHERE key LIKE 'python_model_%'`;
        this.coder.log.info(
          `[Lineage] Querying python model properties: ${sql}`,
        );

        const rows = await this.coder.trino.handleQuery(sql, {
          filename: 'data-explorer-query.sql',
        });

        if (!rows || rows.length === 0) {
          return null;
        }

        const props: Record<string, string> = {};
        for (const row of rows) {
          props[row['key']] = row['value'];
        }

        const pythonModelName = props['python_model_name'];
        if (!pythonModelName) {
          return null;
        }

        const upstreamSourcesStr = props['python_model_upstream_sources'];
        const upstreamSources = upstreamSourcesStr
          ? upstreamSourcesStr
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

        const pythonModelTable = props['python_model_table'] ?? pythonModelName;
        const pythonModelId = `python.${pythonModelTable}`;
        const pythonModelNode: LineageNode = {
          id: pythonModelId,
          name: pythonModelTable,
          type: 'python',
          description:
            props['python_model_description'] ??
            `Python model: ${pythonModelName}`,
          tags: ['python'],
          path: '',
          schema,
          database: catalog,
          pythonModelMetadata: {
            modelName: pythonModelName,
            modelType: props['python_model_type'] ?? 'python',
            namespace: props['python_model_namespace'],
            tableName: props['python_model_table'],
            description: props['python_model_description'],
            upstreamSources,
          },
          hasOwnUpstream: upstreamSources.length > 0,
          hasOwnDownstream: true,
        };

        // Create source nodes for each upstream source
        const upstreamSourceNodes: LineageNode[] = [];
        for (const sourceId of upstreamSources) {
          const parts = sourceId.split('.');
          if (parts.length >= 2) {
            const sourceSchema = parts[0];
            const sourceTable = parts[1];
            upstreamSourceNodes.push({
              id: `python.${sourceId}`,
              name: sourceTable,
              type: 'python',
              description: sourceId,
              tags: ['python'],
              path: '',
              schema: sourceSchema,
              database: catalog,
              hasOwnUpstream: false,
              hasOwnDownstream: true,
            });
          }
        }

        return {
          pythonModelNode,
          sourceNodeId: sourceNode.id,
          upstreamSourceNodes,
        };
      } catch (error) {
        this.coder.log.info(
          `[Lineage] No python model properties for ${catalog}.${schema}.${tableName}: ${error}`,
        );
        return null;
      }
    });

    const results = await Promise.all(queries);

    for (const result of results) {
      if (result) {
        pythonModelNodes.push(result.pythonModelNode);
        pythonModelEdges.push({
          pythonModelNodeId: result.pythonModelNode.id,
          sourceNodeId: result.sourceNodeId,
        });

        // Add upstream source nodes and edges connecting them to the python model
        for (const upstreamNode of result.upstreamSourceNodes) {
          pythonModelNodes.push(upstreamNode);
          pythonModelEdges.push({
            pythonModelNodeId: upstreamNode.id,
            sourceNodeId: result.pythonModelNode.id,
          });
        }
      }
    }

    return { nodes: pythonModelNodes, edges: pythonModelEdges };
  }

  /**
   * Convert manifest node to LineageNode
   */
  private manifestNodeToLineageNode(
    id: string,
    node:
      | Partial<DbtProjectManifestNode | DbtProjectManifestSource>
      | undefined,
    project: DbtProject,
  ): LineageNode {
    if (!node) {
      return {
        id,
        name: id.split('.').pop() ?? id,
        type: 'model',
        path: '',
      };
    }

    const resourceType = node.resource_type ?? 'model';
    let type: 'model' | 'source' | 'seed' = 'model';

    if (resourceType === 'source') {
      type = 'source';
    } else if (resourceType === 'seed') {
      type = 'seed';
    }

    // Extract materialized type from config
    // @ts-expect-error - config may have materialized field
    const rawMaterialized = node.config?.materialized;
    let materialized:
      | 'ephemeral'
      | 'incremental'
      | 'view'
      | 'table'
      | undefined;

    if (rawMaterialized === 'ephemeral' || rawMaterialized === 'incremental') {
      materialized = rawMaterialized;
    } else if (rawMaterialized === 'materialized view') {
      materialized = 'view';
    }

    // Count tests for this model
    const testCount = this.countTestsForNode(id, project);

    // Check if this node has its own upstream/downstream models
    const manifest = project.manifest;
    const parentIds = manifest?.parent_map?.[id] ?? [];
    const childIds = manifest?.child_map?.[id] ?? [];

    // Filter out tests from child count (tests are not expandable)
    const hasOwnUpstream =
      type === 'model' &&
      parentIds.filter((pid) => !pid.startsWith('test.')).length > 0;
    const hasOwnDownstream =
      type === 'model' &&
      childIds.filter((cid) => !cid.startsWith('test.')).length > 0;

    // Construct full system path
    const relativePath = node.original_file_path ?? '';
    const pathSystem = relativePath
      ? path.join(project.pathSystem, relativePath)
      : undefined;

    return {
      id,
      name: node.name ?? id.split('.').pop() ?? id,
      type,
      description: node.description ?? '',
      tags: node.tags ?? [],
      path: relativePath,
      pathSystem,
      schema: node.schema,
      database: node.database,
      materialized,
      testCount,
      hasOwnUpstream,
      hasOwnDownstream,
    };
  }

  /**
   * Count the number of tests for a given node
   */
  private countTestsForNode(nodeId: string, project: DbtProject): number {
    const manifest = project.manifest;
    if (!manifest) {
      return 0;
    }

    let count = 0;
    for (const [_id, node] of Object.entries(manifest.nodes || {})) {
      if (
        node?.resource_type === 'test' &&
        node.depends_on?.nodes?.includes(nodeId)
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * Execute query for a model and return results
   *
   * For materialized models (tables, views, incremental), we query the actual table/view directly.
   * This avoids issues with complex nested CTEs in compiled SQL.
   * For ephemeral models, we must run the compiled SQL since they don't create physical objects.
   */
  private async executeModelQuery(
    modelName: string,
    projectName: string,
    limit: number,
  ): Promise<{
    columns: string[];
    rows: any[][];
    rowCount: number;
  }> {
    const project = this.coder.framework.dbt.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    const modelId = getDbtModelId({ modelName, projectName });
    const model = this.coder.framework.dbt.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelName} not found in project ${projectName}`);
    }

    // Get compiled SQL path
    const compiledPath = this.getCompiledSqlPath(project, model, modelName);

    this.coder.log.info(
      `[executeModelQuery] Model: ${modelName}, Compiled path: ${compiledPath}`,
    );

    // Check if compiled file exists - if not, require compilation
    if (!fs.existsSync(compiledPath)) {
      this.coder.log.info(
        `[executeModelQuery] Compiled SQL not found, compilation required`,
      );
      throw new Error(
        `COMPILE_REQUIRED:Model ${modelName} is not compiled. Please compile the model first.`,
      );
    }

    // Read compiled SQL from file
    const compiledSql = fs.readFileSync(compiledPath, 'utf-8');
    this.coder.log.info(
      `[executeModelQuery] Using compiled SQL from: ${compiledPath}`,
    );

    // Add LIMIT if not present
    let queryWithLimit = compiledSql.trim();
    if (!queryWithLimit.toLowerCase().includes('limit')) {
      queryWithLimit = `${queryWithLimit}\nLIMIT ${limit}`;
    }

    // Log the SQL being executed (truncated for readability)
    const sqlPreview =
      queryWithLimit.length > 200
        ? queryWithLimit.substring(0, 200) + '...'
        : queryWithLimit;
    this.coder.log.info(`[executeModelQuery] SQL to execute: ${sqlPreview}`);

    // Execute query via Trino using file-based execution to avoid shell escaping issues
    const rawResults = await this.coder.trino.handleQuery(queryWithLimit, {
      filename: 'data-explorer-query.sql',
    });

    if (!rawResults || rawResults.length === 0) {
      return { columns: [], rows: [], rowCount: 0 };
    }

    const columns = Object.keys(rawResults[0]);
    const rows = rawResults.map((row) => columns.map((col) => row[col]));
    return { columns, rows, rowCount: rows.length };
  }

  /**
   * Get the compiled SQL file path for a model
   */
  private getCompiledSqlPath(
    project: DbtProject,
    model: DbtModel,
    modelName: string,
  ): string {
    let modelDir = '';

    if (model.path) {
      modelDir = path.dirname(model.path);
      if (modelDir.startsWith('models/')) {
        modelDir = modelDir.substring('models/'.length);
      } else if (modelDir.startsWith('models\\')) {
        modelDir = modelDir.substring('models\\'.length);
      }
    } else if (model.pathRelativeDirectory) {
      modelDir = model.pathRelativeDirectory;
    }

    return path.join(
      project.pathSystem,
      'target',
      'compiled',
      project.name,
      'models',
      modelDir,
      `${modelName}.sql`,
    );
  }

  /**
   * Get currently active model from the editor
   * Supports .sql, .model.json, and .yml files
   */
  public getCurrentActiveModel(editor?: vscode.TextEditor): {
    modelName: string;
    projectName: string;
  } | null {
    const activeEditor = editor ?? vscode.window.activeTextEditor;
    if (!activeEditor) {
      return null;
    }

    const document = activeEditor.document;
    const filePath = document.uri.fsPath;

    // Determine the model name based on file type
    let modelName: string | null = null;

    if (filePath.endsWith('.sql')) {
      modelName = path.basename(filePath, '.sql');
    } else if (filePath.endsWith('.model.json')) {
      modelName = path.basename(filePath, '.model.json');
    } else if (filePath.endsWith('.yml')) {
      // For .yml files, try to extract model name from the file name
      // The yml file name often matches the model name (e.g., model_name.yml)
      modelName = path.basename(filePath, '.yml');
    } else {
      return null;
    }

    // Find the project this file belongs to
    for (const [
      projectName,
      project,
    ] of this.coder.framework.dbt.projects.entries()) {
      if (filePath.startsWith(project.pathSystem)) {
        const modelId = getDbtModelId({ modelName, projectName });
        const model = this.coder.framework.dbt.models.get(modelId);

        if (model) {
          return { modelName, projectName };
        }
      }
    }

    return null;
  }

  /**
   * Open the model or source file in the editor
   */
  private async openModelFile(
    modelName: string,
    projectName: string,
  ): Promise<void> {
    // Try models first
    const modelId = getDbtModelId({ modelName, projectName });
    const model = this.coder.framework.dbt.models.get(modelId);

    if (model) {
      const sqlFilePath = model.pathSystemFile;
      if (!sqlFilePath) {
        throw new Error(`File path not found for model ${modelName}`);
      }
      const jsonFilePath = sqlFilePath.replace(/\.sql$/, '.model.json');
      const targetPath = fs.existsSync(jsonFilePath)
        ? jsonFilePath
        : sqlFilePath;
      await vscode.window.showTextDocument(vscode.Uri.file(targetPath));
      return;
    }

    // Try sources: search by table name match
    for (const [, source] of this.coder.framework.dbt.sources) {
      if (source.name === modelName) {
        const ymlPath = source.pathSystemFile;
        if (ymlPath) {
          const sourceJsonPath = ymlPath.replace(/\.yml$/, '.source.json');
          const targetPath = fs.existsSync(sourceJsonPath)
            ? sourceJsonPath
            : ymlPath;
          await vscode.window.showTextDocument(vscode.Uri.file(targetPath));
          return;
        }
      }
    }

    throw new Error(
      `Model or source ${modelName} not found in project ${projectName}`,
    );
  }

  activate(_context: vscode.ExtensionContext): void {
    this.coder.log.info('ModelLineage service activated');
  }

  deactivate() {
    this.coder.log.info('ModelLineage service deactivated');
  }
}
