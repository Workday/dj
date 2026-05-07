import { ColumnLineageService } from '@services/columnLineage';
import { frameworkGetNodeColumns } from '@services/framework/utils';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { FrameworkColumn } from '@shared/framework/types';
import {
  type ColumnLineageDAG,
  generateAllColumnsCSV,
  generateLineageCSV,
} from '@shared/lineage';
import * as vscode from 'vscode';

import type { FrameworkContext } from '../context';

/**
 * Handles API requests for column lineage operations.
 *
 * This is the largest and most complex handler, supporting:
 * - Model column lineage (upstream/downstream tracking)
 * - Source column lineage (forward tracking from source tables)
 * - Lineage export to CSV (single column or all columns)
 * - Column switching and navigation
 *
 * The handler coordinates between Framework, ColumnLineageService, and DBT
 * to provide comprehensive column-level data lineage visualization.
 */
export class ColumnLineageHandler {
  constructor(private readonly ctx: FrameworkContext) {}

  /**
   * Main entry point for all column lineage operations.
   *
   * Supported actions:
   * - webview-ready: Notify service that webview is loaded
   * - save-csv: Export CSV content via save dialog
   * - switch-to-model-column: Navigate to model column and compute lineage
   * - switch-to-source-column: Navigate to source column and compute lineage
   * - get-source-tables: List all tables in a source file
   * - get-source-columns: Get columns for a specific source table
   * - compute-source-lineage: Compute forward lineage from a source column
   * - export-source-lineage: Export source lineage to CSV
   * - validate: Validate model files exist
   * - get-columns: Get all columns in a model
   * - compute: Compute lineage for a model column (with depth limits)
   * - export-lineage: Export model lineage to CSV
   */
  async handleColumnLineage(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-column-lineage' }
    >,
  ): Promise<ApiResponse> {
    const { action, filePath, columnName, upstreamLevels, downstreamLevels } =
      payload.request;

    try {
      // Handle webview-ready action - triggers initial auto-refresh
      if (action === 'webview-ready') {
        // Notify columnLineage service that webview is ready
        this.ctx.coder.columnLineage.onWebviewReady();
        return apiResponse<typeof payload.type>({
          success: true,
        });
      }

      // Handle save-csv action - save CSV content to file via save dialog
      if (action === 'save-csv') {
        const { csvContent, suggestedFilename } = payload.request;
        if (!csvContent || !suggestedFilename) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'csvContent and suggestedFilename are required for save-csv',
          });
        }

        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(suggestedFilename),
          filters: { 'CSV Files': ['csv'] },
          saveLabel: 'Export Lineage',
        });

        if (!uri) {
          // User cancelled
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'Export cancelled',
          });
        }

        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(csvContent, 'utf-8'),
        );
        vscode.window.showInformationMessage(
          `Lineage exported to ${uri.fsPath}`,
        );

        return apiResponse<typeof payload.type>({
          success: true,
        });
      }

      // Handle switch-to-model-column action - opens file and computes lineage for that column
      if (action === 'switch-to-model-column') {
        if (!filePath || !columnName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error:
              'filePath and columnName are required for switch-to-model-column',
          });
        }
        const { skipOpenFile } = payload.request;
        // Delegate to columnLineage service to open file and trigger lineage computation
        // Pass lineage depth options to preserve current mode (full vs custom levels)
        await this.ctx.coder.columnLineage.openModelAndComputeLineage(
          filePath,
          columnName,
          {
            upstreamLevels,
            downstreamLevels,
            skipOpenFile,
          },
        );
        return apiResponse<typeof payload.type>({
          success: true,
        });
      }

      // Handle switch-to-source-column action - opens source file and computes forward lineage
      if (action === 'switch-to-source-column') {
        const { tableName, skipOpenFile } = payload.request;
        if (!filePath || !columnName || !tableName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error:
              'filePath, columnName, and tableName are required for switch-to-source-column',
          });
        }
        // Delegate to columnLineage service to open source file and trigger lineage computation
        await this.ctx.coder.columnLineage.openSourceAndComputeLineage(
          filePath,
          tableName,
          columnName,
          {
            downstreamLevels,
            skipOpenFile,
          },
        );
        return apiResponse<typeof payload.type>({
          success: true,
        });
      }

      if (!filePath) {
        return apiResponse<typeof payload.type>({
          success: false,
          error: 'filePath is required for this action',
        });
      }

      const lineageService = new ColumnLineageService(this.ctx.coder);

      // Handle source-specific actions
      if (action === 'get-source-tables') {
        const result = await lineageService.getSourceTables(filePath);
        return apiResponse<typeof payload.type>({
          success: result.success,
          error: result.error,
          sourceName: result.sourceName,
          tables: result.tables,
        });
      }

      if (action === 'get-source-columns') {
        const { tableName } = payload.request;
        if (!tableName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'tableName is required for get-source-columns',
          });
        }
        const result = await lineageService.getSourceColumns(
          filePath,
          tableName,
        );
        if (!result.success) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: result.error,
          });
        }
        const columns: FrameworkColumn[] = (result.columns ?? []).map(
          (col) => ({
            name: col.name,
            data_type: col.data_type as FrameworkColumn['data_type'],
            description: col.description || '',
            meta: { type: col.type ?? 'dim' },
            internal: {},
          }),
        );
        return apiResponse<typeof payload.type>({
          success: true,
          modelName: `${result.sourceName}.${tableName}`,
          columns,
        });
      }

      if (action === 'compute-source-lineage') {
        const { tableName } = payload.request;
        if (!tableName || !columnName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error:
              'tableName and columnName are required for compute-source-lineage',
          });
        }
        const result = await lineageService.computeSourceLineage(
          filePath,
          tableName,
          columnName,
          { downstreamLevels: downstreamLevels ?? -1 },
        );
        if (!result.success || !result.dag) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: result.error,
          });
        }
        // Serialize DAG for response
        const dag = result.dag;
        return apiResponse<typeof payload.type>({
          success: true,
          dag: {
            targetColumn: dag.targetColumn,
            nodes: Array.from(dag.nodes.values()),
            edges: dag.edges,
            roots: dag.roots,
            leaves: dag.leaves,
            hasMoreUpstream: dag.hasMoreUpstream,
            hasMoreDownstream: dag.hasMoreDownstream,
          },
        });
      }

      // Handle 'export-source-lineage' action - generate CSV for source columns
      if (action === 'export-source-lineage') {
        const { tableName } = payload.request;
        if (!tableName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'tableName is required for export-source-lineage',
          });
        }

        // Get source info
        const sourceResult = await lineageService.getSourceColumns(
          filePath,
          tableName,
        );
        if (!sourceResult.success || !sourceResult.columns) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: sourceResult.error ?? 'Failed to get source columns',
          });
        }

        const sourceName = sourceResult.sourceName ?? 'source';

        // If columnName provided, export single column; otherwise export all
        if (columnName) {
          // Compute full lineage for this column
          const result = await lineageService.computeSourceLineage(
            filePath,
            tableName,
            columnName,
            { downstreamLevels: -1 },
          );

          if (!result.success || !result.dag) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: result.error ?? 'Failed to compute lineage',
            });
          }

          // Extract the target node ID from DAG to pass correct model name to CSV generator
          // For source lineage, nodes are stored with ID like: "source.project.schema.table.columnName"
          // But the modelName field in the node is just "schema.table"
          // We need to use the sourceId (without column name) as the model name for CSV lookup
          const sourceTableResult = await lineageService.getSourceColumns(
            filePath,
            tableName,
          );

          // Get project to construct the source ID
          const project = this.ctx.dbt.getProjectFromPath(filePath);
          if (!project || !sourceTableResult.success) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: sourceTableResult.error ?? 'Failed to get source info',
            });
          }

          // Reconstruct the sourceId the same way it's built in computeSourceLineage
          const sourceId = `source.${project.name}.${sourceName}.${tableName}`;

          const csvContent = generateLineageCSV(
            result.dag,
            columnName,
            sourceId, // Use the full source ID as model name
          );
          const suggestedFilename = `${sourceName}_${tableName}_${columnName}_lineage.csv`;

          return apiResponse<typeof payload.type>({
            success: true,
            csvContent,
            suggestedFilename,
          });
        } else {
          // Export all columns
          // Get project to construct the source ID
          const project = this.ctx.dbt.getProjectFromPath(filePath);
          if (!project) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: 'Could not find dbt project for this file',
            });
          }

          // Reconstruct the sourceId the same way it's built in computeSourceLineage
          const sourceId = `source.${project.name}.${sourceName}.${tableName}`;

          const results: Array<{
            column: string;
            dag: ColumnLineageDAG;
            modelName: string;
            dataType?: string;
          }> = [];

          for (const col of sourceResult.columns) {
            try {
              const result = await lineageService.computeSourceLineage(
                filePath,
                tableName,
                col.name,
                { downstreamLevels: -1 },
              );

              if (result.success && result.dag) {
                results.push({
                  column: col.name,
                  dag: result.dag,
                  modelName: sourceId, // Use the full source ID
                  dataType: col.data_type,
                });
              }
            } catch (err: unknown) {
              // Log but continue with other columns
              this.ctx.log.warn(
                `Failed to compute lineage for source column ${col.name}:`,
                err,
              );
            }
          }

          if (results.length === 0) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: 'Failed to compute lineage for any columns',
            });
          }

          const csvContent = generateAllColumnsCSV(results);
          const suggestedFilename = `${sourceName}_${tableName}_all_columns_lineage.csv`;

          return apiResponse<typeof payload.type>({
            success: true,
            csvContent,
            suggestedFilename,
          });
        }
      }

      // Always validate first for model actions
      const validation = await lineageService.validateModelFiles(filePath);
      if (!validation.valid) {
        return apiResponse<typeof payload.type>({
          success: false,
          error: validation.error ?? 'Invalid model files',
        });
      }

      const modelName = validation.modelName!;

      // Handle 'validate' action - just return validation result
      if (action === 'validate') {
        return apiResponse<typeof payload.type>({
          success: true,
          modelName,
        });
      }

      // For 'get-columns' and 'compute', we need the project
      const project = this.ctx.dbt.getProjectFromPath(filePath);
      if (!project) {
        return apiResponse<typeof payload.type>({
          success: false,
          error: 'Could not find dbt project for this file',
        });
      }

      // Get columns (needed for both 'get-columns' and 'compute')
      const { columns } = frameworkGetNodeColumns({
        from: { model: modelName },
        project,
      });

      if (columns.length === 0) {
        return apiResponse<typeof payload.type>({
          success: false,
          error:
            'No columns found in this model. Please ensure the model has been compiled.',
        });
      }

      // Handle 'get-columns' action
      if (action === 'get-columns') {
        return apiResponse<typeof payload.type>({
          success: true,
          modelName,
          columns,
        });
      }

      // Handle 'compute' action - compute lineage with configurable depth
      if (action === 'compute') {
        if (!columnName) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: "Column name is required for 'compute' action",
          });
        }

        // Verify column exists
        const columnNames = columns.map((c) => c.name);
        if (!columnNames.includes(columnName)) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: `Column '${columnName}' not found in model`,
          });
        }

        // Get depth options (default: 2 levels each direction)
        const upLevels = upstreamLevels ?? 2;
        const downLevels = downstreamLevels ?? 2;

        // Compute lineage with depth options
        const result = await lineageService.getColumnLineage(
          filePath,
          columnName,
          { upstreamLevels: upLevels, downstreamLevels: downLevels },
        );

        if (!result.success || !result.dag) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: result.error,
          });
        }

        // Serialize DAG for response
        const dag = result.dag;
        return apiResponse<typeof payload.type>({
          success: true,
          modelName,
          dag: {
            targetColumn: dag.targetColumn,
            nodes: Array.from(dag.nodes.values()),
            edges: dag.edges,
            roots: dag.roots,
            leaves: dag.leaves,
            hasMoreUpstream: dag.hasMoreUpstream,
            hasMoreDownstream: dag.hasMoreDownstream,
          },
        });
      }

      // Handle 'export-lineage' action - generate CSV for single or all columns
      if (action === 'export-lineage') {
        // If columnName provided, export single column; otherwise export all
        if (columnName) {
          // Verify column exists
          const columnNames = columns.map((c) => c.name);
          if (!columnNames.includes(columnName)) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: `Column '${columnName}' not found in model`,
            });
          }

          // Compute full lineage for this column
          const result = await lineageService.getColumnLineage(
            String(filePath),
            columnName,
            { upstreamLevels: -1, downstreamLevels: -1 },
          );

          if (!result.success || !result.dag) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: result.error ?? 'Failed to compute lineage',
            });
          }

          const csvContent = generateLineageCSV(
            result.dag,
            columnName,
            modelName,
          );
          const suggestedFilename = `${modelName}_${columnName}_lineage.csv`;

          return apiResponse<typeof payload.type>({
            success: true,
            csvContent,
            suggestedFilename,
          });
        } else {
          // Export all columns
          const results: Array<{
            column: string;
            dag: ColumnLineageDAG;
            modelName: string;
            dataType?: string;
          }> = [];

          for (const col of columns) {
            try {
              const result = await lineageService.getColumnLineage(
                filePath,
                col.name,
                { upstreamLevels: -1, downstreamLevels: -1 },
              );

              if (result.success && result.dag) {
                results.push({
                  column: col.name,
                  dag: result.dag,
                  modelName,
                  dataType: col.data_type,
                });
              }
            } catch (err: unknown) {
              // Log but continue with other columns
              this.ctx.log.warn(
                `Failed to compute lineage for column ${col.name}:`,
                err,
              );
            }
          }

          if (results.length === 0) {
            return apiResponse<typeof payload.type>({
              success: false,
              error: 'Failed to compute lineage for any columns',
            });
          }

          const csvContent = generateAllColumnsCSV(results);
          const suggestedFilename = `${modelName}_all_columns_lineage.csv`;

          return apiResponse<typeof payload.type>({
            success: true,
            csvContent,
            suggestedFilename,
          });
        }
      }

      // Unknown action
      return apiResponse<typeof payload.type>({
        success: false,
        error: `Unknown action: ${String(action)}`,
      });
    } catch (error: unknown) {
      this.ctx.log.error('Error in column lineage:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return apiResponse<typeof payload.type>({
        success: false,
        error: errorMessage,
      });
    }
  }
}
