// Framework API type definitions and handlers
import type { ApiRequest, ApiResponse } from '@shared/api/types';
import type {
  LightdashDimension,
  LightdashMetric,
  LightdashMetrics,
  LightdashTable,
} from '@shared/lightdash/types';
import type { SchemaColumnAgg } from '@shared/schema/types/column.agg.schema';
import type { SchemaColumnDataTests } from '@shared/schema/types/column.data_tests.schema';
import type { SchemaColumnDataType } from '@shared/schema/types/column.data_type.schema';
import type { SchemaLightdashMetric } from '@shared/schema/types/lightdash.metric.schema';
import type { SchemaModelCTE } from '@shared/schema/types/model.cte.schema';
import type { SchemaModelCTEs } from '@shared/schema/types/model.ctes.schema';
import type { SchemaModelHaving } from '@shared/schema/types/model.having.schema';
import type { SchemaModelLightdash } from '@shared/schema/types/model.lightdash.schema';
import type { SchemaModelMaterialized } from '@shared/schema/types/model.materialized.schema';
import type {
  IncrementalStrategy,
  SchemaModel,
  SchemaModelSelectInterval,
} from '@shared/schema/types/model.schema';
import type { SchemaModelSelectCol } from '@shared/schema/types/model.select.col.schema';
import type { SchemaModelSelectColWithAgg } from '@shared/schema/types/model.select.col.with.agg.schema';
import type { SchemaModelSelectCTE } from '@shared/schema/types/model.select.cte.schema';
import type { SchemaModelSelectExpr } from '@shared/schema/types/model.select.expr.schema';
import type { SchemaModelSelectExprWithAgg } from '@shared/schema/types/model.select.expr.with.agg.schema';
import type { SchemaModelSelectModel } from '@shared/schema/types/model.select.model.schema';
import type { SchemaModelSelectModelWithAgg } from '@shared/schema/types/model.select.model.with.agg.schema';
import type { SchemaModelSelectSource } from '@shared/schema/types/model.select.source.schema';
import type { SchemaModelWhere } from '@shared/schema/types/model.where.schema';
import type { SchemaSourcePartition } from '@shared/schema/types/source.schema';
import type { SchemaSource } from '@shared/schema/types/source.schema';

export type FrameworkApi =
  | {
      type: 'framework-model-create';
      service: 'framework';
      request: Pick<FrameworkModel, 'group' | 'name' | 'topic' | 'type'> & {
        group: string;
        name: string;
        topic: string;
        type: FrameworkModel['type'];
        projectName: string;
        materialized?: SchemaModelMaterialized;
        source?: string; // UI field, should be excluded from actual API request
        description?: string;
        tags?: string[];
        incremental_strategy?: IncrementalStrategy;
        sql_hooks?: {
          pre?: string | [string, ...string[]];
          post?: string | [string, ...string[]];
        };
        partitioned_by?: [string, ...string[]];
        exclude_daily_filter?: boolean;
        exclude_date_filter?: boolean;
        exclude_portal_partition_columns?: boolean;
        exclude_portal_source_count?: boolean;
        from?: {
          model?: string;
          rollup?: {
            interval: 'day' | 'hour' | 'month' | 'year';
          };
          join?: Array<{
            model: string;
            on: { and: Array<{ expr: string }> };
            type: string;
          }>;
        };
        select?: Array<{
          type: string;
          model: string;
          include?: string[];
        }>;
        group_by?: Array<string | { expr: string } | { type: 'dims' }>;
        where?:
          | string
          | {
              and?: Array<string | { expr: string }>;
              or?: Array<string | { expr: string }>;
            };
        lightdash?: {
          table?: {
            group_label?: string;
            label?: string;
            ai_hint?: string | string[];
            group_details?: any;
            required_attributes?: any;
            required_filters?: any;
            sql_filter?: string;
            sql_where?: string;
          };
          metrics?: Array<{
            id?: string;
            name: string;
            type: string;
            label?: string;
            group_label?: string;
          }>;
          metrics_exclude?: string[];
          metrics_include?: string[];
        };
      };
      response: string;
    }
  | {
      type: 'framework-model-update';
      service: 'framework';
      request: {
        originalModelPath: string; // Path to the current model.json file
        modelJson: FrameworkModel; // Complete updated model JSON
        projectName: string;
      };
      response: string;
    }
  | {
      type: 'framework-source-create';
      service: 'framework';
      request: {
        projectName: string;
        trinoCatalog: string;
        trinoSchema: string;
        trinoTable: string;
      };
      response: string;
    }
  | {
      type: 'framework-get-current-model-data';
      service: 'framework';
      request: null;
      response: { modelData: any; editFormType: string; isEditMode: boolean };
    }
  | {
      type: 'framework-get-model-data';
      service: 'framework';
      request: { modelName: string };
      response: FrameworkModel | null;
    }
  | {
      type: 'framework-close-panel';
      service: 'framework';
      request: { panelType: string };
      response: { success: boolean };
    }
  | {
      type: 'framework-show-message';
      service: 'framework';
      request: {
        message: string;
        type: 'info' | 'success' | 'warning' | 'error';
        closePanel?: boolean;
      };
      response: { success: boolean };
    }
  | {
      type: 'framework-open-external-url';
      service: 'framework';
      request: { url: string };
      response: { success: boolean };
    }
  | {
      type: 'framework-model-preview';
      service: 'framework';
      request: {
        projectName: string;
        modelJson: Record<string, any>;
      };
      response: {
        json: string;
        sql: string;
        yaml: string;
        columns: Array<{
          name: string;
          description: string;
          type: 'dim' | 'fct';
          dataType: string;
        }>;
      };
    }
  | {
      type: 'framework-get-original-model-files';
      service: 'framework';
      request: {
        originalModelPath: string;
      };
      response: {
        json: string;
        sql: string;
        yaml: string;
      };
    }
  | {
      type: 'framework-column-lineage';
      service: 'framework';
      request: {
        /** Action to perform */
        action:
          | 'validate'
          | 'get-columns'
          | 'compute'
          | 'webview-ready'
          | 'switch-to-model-column'
          | 'switch-to-source-column'
          | 'get-source-tables'
          | 'get-source-columns'
          | 'compute-source-lineage'
          | 'export-lineage'
          | 'export-source-lineage'
          | 'save-csv';
        /**
         * Path to model/source file (.model.json, .source.json, .sql, or .yml).
         * Required for validate/get-columns/compute/switch-to-model-column/switch-to-source-column/export-lineage/get-source-tables/get-source-columns/compute-source-lineage.
         * */
        filePath?: string;
        /**
         * Column name.
         * Required for 'compute', 'switch-to-model-column', 'switch-to-source-column', 'compute-source-lineage'.
         * Optional for 'export-lineage' (if omitted, exports all columns).
         * */
        columnName?: string;
        /** Table name within source. Required for 'get-source-columns' and 'compute-source-lineage'. */
        tableName?: string;
        /** Number of upstream levels to trace (-1 for unlimited, default: 2) */
        upstreamLevels?: number;
        /** Number of downstream levels to trace (-1 for unlimited, default: 2) */
        downstreamLevels?: number;
        /** CSV content to save (required for 'save-csv' action) */
        csvContent?: string;
        /** Suggested filename for save dialog (required for 'save-csv' action) */
        suggestedFilename?: string;
        /** Skip opening the file in editor (for UI-triggered lineage). Used by 'switch-to-model-column' and 'switch-to-source-column'. */
        skipOpenFile?: boolean;
      };
      response: {
        success: boolean;
        error?: string;
        /** Model name (returned by 'validate' action) */
        modelName?: string;
        /** Source name (returned by 'get-source-tables' action) */
        sourceName?: string;
        /** Column list with metadata (returned by 'get-columns' and 'get-source-columns' action) */
        columns?: FrameworkColumn[];
        /** Table list with column counts (returned by 'get-source-tables' action) */
        tables?: Array<{ name: string; columnCount: number }>;
        /** Lineage DAG (returned by 'compute' and 'compute-source-lineage' action) */
        dag?: {
          targetColumn: string;
          nodes: Array<{
            id: string;
            columnName: string;
            modelName: string;
            modelLayer: 'source' | 'staging' | 'intermediate' | 'mart';
            modelType: string;
            dataType?: string;
            description?: string;
            transformation: 'raw' | 'passthrough' | 'renamed' | 'derived';
            expression?: string;
            filePath?: string;
          }>;
          edges: Array<{
            source: string;
            target: string;
            transformation: 'raw' | 'passthrough' | 'renamed' | 'derived';
            expression?: string;
          }>;
          roots: string[];
          leaves: string[];
          /** Whether there are more upstream nodes beyond the current roots */
          hasMoreUpstream: boolean;
          /** Whether there are more downstream nodes beyond the current leaves */
          hasMoreDownstream: boolean;
        };
        /** CSV content (returned by 'export-lineage' action) */
        csvContent?: string;
        /** Suggested filename (returned by 'export-lineage' action) */
        suggestedFilename?: string;
      };
    }
  | {
      type: 'framework-preferences';
      service: 'framework';
      request: {
        /** Action to perform */
        action: 'get' | 'set';
        /** Context for the preference (e.g., 'column-lineage', 'data-explorer', 'default-incremental-strategy') */
        context: string;
        /** Value for set action */
        value?: boolean | string;
      };
      response: {
        success: boolean;
        error?: string;
        /** Preference value (returned by 'get' action) */
        value?: boolean | string;
      };
    }
  | {
      type: 'framework-check-model-exists';
      service: 'framework';
      request: {
        projectName: string;
        modelJson: Pick<FrameworkModel, 'group' | 'name' | 'topic' | 'type'>;
      };
      response: {
        exists: boolean;
        fileName: string;
        filePath: string;
      };
    };

async function apiHandler(p: {
  type: 'framework-model-create';
  request: ApiRequest<'framework-model-create'>;
}): Promise<ApiResponse<'framework-model-create'>>;
async function apiHandler(p: {
  type: 'framework-model-update';
  request: ApiRequest<'framework-model-update'>;
}): Promise<ApiResponse<'framework-model-update'>>;
async function apiHandler(p: {
  type: 'framework-source-create';
  request: ApiRequest<'framework-source-create'>;
}): Promise<ApiResponse<'framework-source-create'>>;
async function apiHandler(p: {
  type: 'framework-get-current-model-data';
  request: ApiRequest<'framework-get-current-model-data'>;
}): Promise<ApiResponse<'framework-get-current-model-data'>>;
async function apiHandler(p: {
  type: 'framework-get-model-data';
  request: ApiRequest<'framework-get-model-data'>;
}): Promise<ApiResponse<'framework-get-model-data'>>;
async function apiHandler(p: {
  type: 'framework-close-panel';
  request: ApiRequest<'framework-close-panel'>;
}): Promise<ApiResponse<'framework-close-panel'>>;
async function apiHandler(p: {
  type: 'framework-show-message';
  request: ApiRequest<'framework-show-message'>;
}): Promise<ApiResponse<'framework-show-message'>>;
async function apiHandler(p: {
  type: 'framework-open-external-url';
  request: ApiRequest<'framework-open-external-url'>;
}): Promise<ApiResponse<'framework-open-external-url'>>;
async function apiHandler(p: {
  type: 'framework-model-preview';
  request: ApiRequest<'framework-model-preview'>;
}): Promise<ApiResponse<'framework-model-preview'>>;
async function apiHandler(p: {
  type: 'framework-get-original-model-files';
  request: ApiRequest<'framework-get-original-model-files'>;
}): Promise<ApiResponse<'framework-get-original-model-files'>>;
async function apiHandler(p: {
  type: 'framework-column-lineage';
  request: ApiRequest<'framework-column-lineage'>;
}): Promise<ApiResponse<'framework-column-lineage'>>;
async function apiHandler(p: {
  type: 'framework-check-model-exists';
  request: ApiRequest<'framework-check-model-exists'>;
}): Promise<ApiResponse<'framework-check-model-exists'>>;
function apiHandler(
  _p: Omit<FrameworkApi, 'response' | 'service'>,
): Promise<unknown> {
  return Promise.resolve(null);
}
export type FrameworkApiHandler = typeof apiHandler;

export type FrameworkColumnAgg = SchemaColumnAgg;

export type FrameworkColumn = {
  name: string;
  data_tests?: FrameworkColumnDataTests;
  data_type?: FrameworkDataType;
  description?: string;
  tags?: string[];
  meta: FrameworkColumnMeta;
};
export type FrameworkColumnMeta = {
  type: 'dim' | 'fct';
  case_sensitive?: boolean;
  // Only used for datetime column
  interval?: 'day' | 'hour' | 'month' | 'year';
  // Should get stripped out when inherited
  agg?: FrameworkColumnAgg;
  aggs?: FrameworkColumnAgg[];
  exclude_from_group_by?: boolean;
  expr?: string;
  origin?: { id: string };
  override_suffix_agg?: boolean;
  prefix?: string;
  // Meta for Lightdash
  dimension?: LightdashDimension;
  metrics?: LightdashMetrics;
  metrics_merge?: LightdashMetric;
};

export type FrameworkColumnLightdashMetric = SchemaLightdashMetric;

export type FrameworkColumnName = FrameworkDims | FrameworkFcts;

export type FrameworkDims = FrameworkPartitionName | 'datetime';
export type FrameworkFcts = 'portal_source_count';

export type FrameworkColumnDataTests = SchemaColumnDataTests;

export type FrameworkMetrics = {
  [name: string]: Omit<FrameworkColumnLightdashMetric, 'name'>;
};

export type FrameworkDataType = SchemaColumnDataType;
// export type FrameworkDimension = SchemaModelSelectDim;
// export type FrameworkFact = SchemaModelSelectFct;

export type FrameworkInterval = 'hour' | 'day' | 'month' | 'year';

export type FrameworkEtlSource = {
  etl_active: boolean;
  properties: string;
  source_id: string;
};

export type FrameworkCTE = SchemaModelCTE;
export type FrameworkCTEs = SchemaModelCTEs;
export type FrameworkModel = SchemaModel;
export type FrameworkModelHaving = SchemaModelHaving;
export type FrameworkSelectCTE = SchemaModelSelectCTE;
export type FrameworkModelLightdash = SchemaModelLightdash;
export type FrameworkModelMeta = LightdashTable & {
  case_sensitive?: boolean;
  local_tags?: string[];
  metrics?: LightdashMetrics;
  portal_partition_columns?: string[];
};
export type FrameworkModelWhere = SchemaModelWhere;

export type FrameworkManifestModel = {
  description: string;
  dimensions: FrameworkColumn[];
  facts: FrameworkColumn[];
  name: string;
};

export type FrameworkMetricType =
  | 'average'
  | 'boolean'
  | 'count'
  | 'count_distinct'
  | 'date'
  | 'max'
  | 'median'
  | 'min'
  | 'number'
  | 'percentile'
  | 'string'
  | 'sum';

export type FrameworkPartitionName =
  | 'portal_partition_daily'
  | 'portal_partition_hourly'
  | 'portal_partition_monthly';

// Project names are dynamic based on user's dbt_project.yml configuration
export type FrameworkProjectName = string;

export type FrameworkSchemaBase = {
  $id?: string;
  $ref?: string;
  additionalProperties?: boolean;
  anyOf?: FrameworkSchemaBase[];
  const?: string;
  description?: string;
  enum?: string[];
  items?: FrameworkSchemaBase;
  minItems?: number;
  properties?: Record<string, FrameworkSchemaBase>;
  required?: string[];
  type?: 'array' | 'object' | 'string';
};

export type FrameworkSelected =
  | string
  | SchemaModelSelectCol
  | SchemaModelSelectColWithAgg
  | SchemaModelSelectCTE
  | SchemaModelSelectExpr
  | SchemaModelSelectExprWithAgg
  | SchemaModelSelectInterval
  | SchemaModelSelectModel
  | SchemaModelSelectModelWithAgg
  | SchemaModelSelectSource;

export type FrameworkSource = SchemaSource;

export type FrameworkSourcePartition = SchemaSourcePartition;

export type FrameworkSourceColumnMetaFilter =
  | 'event_date'
  | 'event_day'
  | 'event_month'
  | 'event_year';

export type FrameworkSourceMeta = {
  etl?: {
    lookback_days?: number;
    sql_event_date_updated_timestamps?: string;
    sql_retry?: string;
  };
  event_datetime?: {
    data_type?: FrameworkDataType;
    expr: string;
    interval?: FrameworkInterval;
    use_range?: boolean;
  };
  local_tags?: string[];
  partition_date?: {
    compile_dates?: boolean;
    data_type?: FrameworkDataType;
    expr: string;
    interval?: FrameworkInterval;
    use_event_dates?: boolean;
    use_range?: boolean;
  };
  partitions?: FrameworkSourcePartition[];
  portal_partition_columns?: string[];
  portal_source_count?: {
    exclude?: boolean;
    metric_label?: string;
  };
  table_function?: {
    // dbt seems to rename catalog to database in the manifest
    catalog?: string;
    database?: string;
    //
    arg: string;
    dialect: 'bigquery';
    name: string;
    schema: string;
  };
  where?: {
    expr?: string;
  };
};
export type FrameworkSourceTableMeta = FrameworkSourceMeta & {
  // If there are any meta keys specific to tables, we can add them here
};

export type FrameworkSourceColumnMeta = {
  type?: 'dim' | 'fct';
  lightdash?: {
    dimension?: LightdashDimension;
    // metrics?: LightdashMetrics;
  };
};

export type FrameworkSyncOp =
  | {
      type: 'delete';
      path: string;
    }
  | {
      type: 'rename';
      oldPath: string;
      newPath: string;
    }
  | {
      type: 'write';
      text: string;
      path: string;
    };

/**
 * Valid values for the default incremental strategy extension setting.
 * Shared across extension config, DJ context, and webview.
 */
export type DefaultIncrementalStrategy =
  | 'append'
  | 'delete+insert'
  | 'merge'
  | 'overwrite_existing_partitions';
