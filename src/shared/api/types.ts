import type { DistributiveOmit } from '@shared';
import type {
  DataExplorerUiApi,
  DbtCompilationApi,
} from '@shared/dataexplorer/types';
import type { DbtApi } from '@shared/dbt/types';
import type { FrameworkApi } from '@shared/framework/types';
import type { LightdashApi } from '@shared/lightdash/types';
import type { ModelLineageApi } from '@shared/modellineage/types';
import type { QueryDraftApi } from '@shared/querydraft/types';
import type { TrinoApi } from '@shared/trino/types';

// State API types
export type StateApi =
  | {
      type: 'state-load';
      service: 'state';
      request: { formType: string };
      response: { data: Record<string, any> | null };
    }
  | {
      type: 'state-save';
      service: 'state';
      request: { formType: string; data: Record<string, any> };
      response: { success: boolean };
    }
  | {
      type: 'state-clear';
      service: 'state';
      request: { formType: string };
      response: { success: boolean };
    };

// Model Settings API types
export type ModelSettingsApi =
  | {
      type: 'framework-get-model-settings';
      service: 'framework';
      request: null;
      response: { loadedSteps?: string[] };
    }
  | {
      type: 'framework-set-model-settings';
      service: 'framework';
      request: { loadedSteps?: string[] };
      response: { success: boolean };
    };

// Union of all API types including new framework model settings APIs
export type Apis =
  | DbtApi
  | DbtCompilationApi
  | DataExplorerUiApi
  | FrameworkApi
  | LightdashApi
  | ModelLineageApi
  | QueryDraftApi
  | TrinoApi
  | StateApi
  | ModelSettingsApi;

export type Api<T extends Apis['type'] = Apis['type']> = Extract<
  Apis,
  { type: T }
>;
export type ApiError =
  | {
      details?: Record<string, boolean | number | string> | string;
      message: string;
    }
  | Error
  | { response: { data: Record<string, string>; message?: string } };
export type ApiMessage = ApiHandlerPayload & { _channelId: string };
export type ApiPayload<T extends ApiService = ApiService> = DistributiveOmit<
  Extract<Api, { service: T }>,
  'response' | 'service'
>;
export type ApiRequest<T extends ApiType = ApiType> = Extract<
  Api,
  { type: T }
>['request'];
export type ApiResponse<T extends ApiType = ApiType> = Extract<
  Api,
  { type: T }
>['response'];
export type ApiService = Api['service'];
export type ApiType = Api['type'];

/**
 * Type-safe API router using discriminated union pattern.
 *
 * @example
 * const handler = createApiHandler({
 *   'dbt-fetch-projects': async (payload) => {
 *     // payload.request is typed as ApiRequest<'dbt-fetch-projects'>
 *     return [createMockProject()];
 *   },
 * });
 */
export type ApiRouter = {
  [K in ApiType]: (payload: {
    type: K;
    request: ApiRequest<K>;
  }) => Promise<ApiResponse<K>>;
};

/**
 * Creates a type-safe API handler from a router configuration.
 *
 * The returned handler automatically narrows types based on the 'type' discriminant,
 * providing the same developer experience as manual overloads without duplication.
 *
 * @param router - Partial map of API types to their handlers
 * @returns Type-safe API handler function
 */
export function createApiHandler(router: Partial<ApiRouter>) {
  return async <T extends ApiType>(payload: {
    type: T;
    request: ApiRequest<T>;
  }): Promise<ApiResponse<T>> => {
    const handler = router[payload.type];
    if (!handler) {
      throw new Error(`No API handler registered for type: ${payload.type}`);
    }
    // Type assertion needed here due to TypeScript's limitations with mapped types
    // The router ensures type safety at the configuration level
    return (handler as any)(payload);
  };
}

/**
 * Type-safe API handler function.
 *
 * This type is equivalent to 50+ manual overload signatures, but generated
 * automatically from the ApiRouter mapped type. It provides full autocomplete
 * and type checking without manual maintenance.
 */
export type ApiHandler = ReturnType<typeof createApiHandler>;

/**
 * Utility types for working with API handlers.
 */
export type ApiHandlerPayload = Parameters<ApiHandler>[0];
export type ApiHandlerReturn = ReturnType<ApiHandler>;
