import type { DataExplorer } from '@services/dataExplorer';
import type { Dbt } from '@services/dbt';
import type { Framework } from '@services/framework';
import type { StateManager } from '@services/statemanager';
import type { Trino } from '@services/trino';
import { assertExhaustive } from '@shared';
import type { ApiPayload, ApiResponse, ApiType } from '@shared/api/types';

/**
 * Handler function for Lightdash API calls.
 * This is a lazy getter to break the circular dependency with Lightdash.
 */
type LightdashHandler = (
  payload: ApiPayload<'lightdash'>,
) => Promise<ApiResponse>;

/**
 * Handler function for QueryDraft API calls.
 * This is a lazy getter to break the circular dependency with QueryDraftService.
 */
type QueryDraftHandler = (
  payload: ApiPayload<'query-draft'>,
) => Promise<ApiResponse>;

export class Api {
  constructor(
    private readonly dbt: Dbt,
    private readonly framework: Framework,
    private readonly dataExplorer: DataExplorer,
    private readonly trino: Trino,
    private readonly stateManager: StateManager,
    /**
     * Lazy getter for Lightdash handler to break circular dependency.
     * This is called only when a lightdash-* message needs to be routed.
     */
    private readonly getLightdashHandler: () => LightdashHandler,
    /**
     * Lazy getter for QueryDraft handler to break circular dependency.
     * This is called only when a query-draft-* message needs to be routed.
     */
    private readonly getQueryDraftHandler: () => QueryDraftHandler,
  ) {}

  /**
   * Main API router that delegates requests to appropriate service handlers.
   *
   * Uses TypeScript generic to automatically narrow the return type based on
   * the `type` discriminant in the payload, eliminating the need for type
   * assertions at call sites.
   *
   * @example
   * const result = await api.handleApi({
   *   type: 'framework-column-lineage',
   *   request: { action: 'compute', filePath: '...', columnName: '...' }
   * });
   * // result is automatically typed as ApiResponse<'framework-column-lineage'>
   */
  async handleApi<T extends ApiType>(
    payload: Extract<ApiPayload, { type: T }>,
  ): Promise<ApiResponse<T>> {
    switch (payload.type) {
      case 'dbt-fetch-modified-models':
      case 'dbt-fetch-projects':
      case 'dbt-fetch-sources':
      case 'dbt-fetch-available-models':
      case 'dbt-get-model-info':
      case 'dbt-parse-project':
      case 'dbt-run-model':
      case 'dbt-fetch-models-with-tests':
      case 'dbt-add-model-tests':
      case 'dbt-remove-model-tests':
      case 'dbt-run-test':
      case 'dbt-check-compiled-status':
      case 'dbt-check-model-outdated':
      case 'dbt-compile-with-logs':
      case 'dbt-model-compile':
        return (await this.dbt.handleApi(payload as any)) as ApiResponse<T>;
      case 'framework-model-create':
      case 'framework-model-update':
      case 'framework-source-create':
      case 'framework-get-current-model-data':
      case 'framework-get-model-data':
      case 'framework-close-panel':
      case 'framework-show-message':
      case 'framework-open-external-url':
      case 'framework-get-model-settings':
      case 'framework-set-model-settings':
      case 'framework-model-preview':
      case 'framework-get-original-model-files':
      case 'framework-column-lineage':
      case 'framework-check-model-exists':
      case 'framework-preferences':
        return (await this.framework.handleApi(
          payload as any,
        )) as ApiResponse<T>;
      case 'lightdash-fetch-models':
      case 'lightdash-start-preview':
      case 'lightdash-stop-preview':
      case 'lightdash-fetch-previews':
      case 'lightdash-get-preview-name':
      case 'lightdash-add-log':
      case 'lightdash-yaml-list-files':
      case 'lightdash-yaml-read-file':
      case 'lightdash-yaml-edit-file':
      case 'lightdash-yaml-download':
      case 'lightdash-yaml-upload':
      case 'lightdash-yaml-delete-files':
      case 'lightdash-yaml-get-default-path':
      case 'lightdash-yaml-set-default-path':
        // Lazy resolution - gets handler only when needed
        return (await this.getLightdashHandler()(
          payload as any,
        )) as ApiResponse<T>;
      case 'data-explorer-get-model-lineage':
      case 'data-explorer-execute-query':
      case 'data-explorer-get-compiled-sql':
      case 'data-explorer-open-model-file':
      case 'data-explorer-open-with-model':
      case 'data-explorer-ready':
      case 'data-explorer-detect-active-model':
      case 'data-explorer-get-project-overview':
        return (await this.dataExplorer.handleApi(
          payload as any,
        )) as ApiResponse<T>;
      case 'trino-fetch-catalogs':
      case 'trino-fetch-columns':
      case 'trino-fetch-current-schema':
      case 'trino-fetch-etl-sources':
      case 'trino-fetch-schemas':
      case 'trino-fetch-system-nodes':
      case 'trino-fetch-system-queries':
      case 'trino-fetch-system-query-with-task':
      case 'trino-fetch-system-query-sql':
      case 'trino-fetch-tables':
        return (await this.trino.handleApi(payload as any)) as ApiResponse<T>;
      case 'state-load':
      case 'state-save':
      case 'state-clear':
        return (await this.stateManager.handleApi(
          payload as any,
        )) as ApiResponse<T>;
      case 'query-draft-create':
      case 'query-draft-execute':
        return (await this.getQueryDraftHandler()(
          payload as any,
        )) as ApiResponse<T>;
      default:
        // TypeScript exhaustiveness check - this should never be reached
        // @ts-expect-error: exhaustive check on discriminated union
        return assertExhaustive(payload);
    }
  }

  deactivate() {}
}
