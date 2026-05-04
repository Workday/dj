import { getDjConfig } from '@services/config';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import { DEFAULT_INCREMENTAL_STRATEGY } from '@shared/framework/constants';
import * as vscode from 'vscode';

import type { FrameworkContext } from '../context';

/**
 * PreferencesHandler - Centralized preference management for all features
 *
 * This handler manages user preferences across different features (column lineage, data explorer, etc.)
 * using a consistent API and VSCode workspace configuration.
 *
 * Supported contexts:
 * - 'column-lineage': Column lineage auto-refresh settings
 * - 'data-explorer': Data explorer auto-refresh settings
 * - 'default-incremental-strategy': Default incremental strategy (read-only)
 */
export class PreferencesHandler {
  constructor(private readonly ctx: FrameworkContext) {}

  /**
   * Main entry point for all preference operations
   */
  async handlePreferences(
    payload: Extract<
      ApiPayload<'framework'>,
      { type: 'framework-preferences' }
    >,
  ): Promise<ApiResponse> {
    const { action, context, value } = payload.request;
    this.ctx.log.info(
      `Handling preferences request: action=${action}, context=${context}, value=${value}`,
    );

    try {
      if (action === 'get') {
        if (!context) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'context is required for get action',
          });
        }
        return this.getPreference(context, payload);
      }

      if (action === 'set') {
        if (!context) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'context is required for set action',
          });
        }
        if (value === undefined || value === null) {
          return apiResponse<typeof payload.type>({
            success: false,
            error: 'value is required for set action',
          });
        }
        return this.setPreference(context, value, payload);
      }

      return apiResponse<typeof payload.type>({
        success: false,
        error: `Unknown action: ${String(action)}`,
      });
    } catch (error: unknown) {
      this.ctx.log.error('Error in preferences handler:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return apiResponse<typeof payload.type>({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Get a preference value for a specific context
   */
  private getPreference<
    T extends Extract<
      ApiPayload<'framework'>,
      { type: 'framework-preferences' }
    >,
  >(context: string, payload: T): ApiResponse<'framework-preferences'> {
    const {
      columnLineageAutoRefresh,
      dataExplorerAutoRefresh,
      materializationDefaultIncrementalStrategy,
    } = getDjConfig();

    switch (context) {
      case 'column-lineage': {
        return apiResponse<typeof payload.type>({
          success: true,
          value: columnLineageAutoRefresh,
        });
      }

      case 'data-explorer': {
        return apiResponse<typeof payload.type>({
          success: true,
          value: dataExplorerAutoRefresh,
        });
      }

      case 'default-incremental-strategy': {
        return apiResponse<typeof payload.type>({
          success: true,
          value:
            materializationDefaultIncrementalStrategy ??
            DEFAULT_INCREMENTAL_STRATEGY,
        });
      }

      default:
        return apiResponse<typeof payload.type>({
          success: false,
          error: `Unknown preference context: ${context}`,
        });
    }
  }

  /**
   * Set a preference value for a specific context
   */
  private async setPreference<
    T extends Extract<
      ApiPayload<'framework'>,
      { type: 'framework-preferences' }
    >,
  >(
    context: string,
    value: boolean | string,
    payload: T,
  ): Promise<ApiResponse<'framework-preferences'>> {
    const config = vscode.workspace.getConfiguration('dj');

    switch (context) {
      case 'column-lineage': {
        await config.update(
          'columnLineage.autoRefresh',
          value,
          vscode.ConfigurationTarget.Workspace,
        );
        return apiResponse<typeof payload.type>({ success: true, value });
      }

      case 'data-explorer': {
        await config.update(
          'dataExplorer.autoRefresh',
          value,
          vscode.ConfigurationTarget.Workspace,
        );
        return apiResponse<typeof payload.type>({ success: true, value });
      }

      case 'default-incremental-strategy': {
        return apiResponse<typeof payload.type>({
          success: false,
          error:
            'default-incremental-strategy is read-only. Configure it via VS Code settings (dj.materialization.defaultIncrementalStrategy).',
        });
      }

      default:
        return apiResponse<typeof payload.type>({
          success: false,
          error: `Unknown preference context: ${context}`,
        });
    }
  }
}
