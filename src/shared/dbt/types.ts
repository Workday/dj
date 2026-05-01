import type {
  FrameworkColumnAgg,
  FrameworkColumnDataTests,
  FrameworkDataType,
  FrameworkMetricType,
  FrameworkModelMeta,
  FrameworkSourceColumnMeta,
  FrameworkSourceMeta,
  FrameworkSourceTableMeta,
} from '@shared/framework/types';
import type {
  LightdashDimension,
  LightdashMetrics,
} from '@shared/lightdash/types';

export type DbtApi =
  | {
      type: 'dbt-fetch-modified-models';
      service: 'dbt';
      request: {
        projectName: string;
      };
      response: string[];
    }
  | {
      type: 'dbt-fetch-projects';
      service: 'dbt';
      request: null;
      response: DbtProject[];
    }
  | {
      type: 'dbt-fetch-sources';
      service: 'dbt';
      request: null;
      response: string[];
    }
  | {
      type: 'dbt-fetch-available-models';
      service: 'dbt';
      request: {
        projectName: string;
      };
      response: string[];
    }
  | {
      type: 'dbt-get-model-info';
      service: 'dbt';
      request: null;
      response: {
        modelName: string | null;
        projectName: string;
        projectPath: string;
      } | null;
    }
  | {
      type: 'dbt-parse-project';
      service: 'dbt';
      request: {
        logger?: {
          error?: (text: string) => void;
          info?: (text: string) => void;
        };
        project: DbtProject;
      };
      response: DbtProjectManifest;
    }
  | {
      type: 'dbt-run-model';
      service: 'dbt';
      request: {
        config: DbtRunConfig;
      };
      response: null;
    }
  | {
      type: 'dbt-fetch-models-with-tests';
      service: 'dbt';
      request: { projectName: string };
      response: {
        modifiedModels: Array<{
          name: string;
          testCount: number;
          testDetails: Array<{
            name: string;
            testType: string;
            columnName?: string;
          }>;
          hasJoins: boolean;
          hasAggregates: boolean;
          hasPortalPartitionDaily: boolean;
          modelType: string | null;
          existingDataTests: Array<{ type: string; [key: string]: any }>;
          fromModel: string | null;
          firstJoinType: string | null;
        }>;
        availableModels: Array<{
          name: string;
          testCount: number;
          testDetails: Array<{
            name: string;
            testType: string;
            columnName?: string;
          }>;
          hasJoins: boolean;
          hasAggregates: boolean;
          hasPortalPartitionDaily: boolean;
          modelType: string | null;
          existingDataTests: Array<{ type: string; [key: string]: any }>;
          fromModel: string | null;
          firstJoinType: string | null;
        }>;
      };
    }
  | {
      type: 'dbt-add-model-tests';
      service: 'dbt';
      request: {
        projectName: string;
        modelName: string;
        autoDetect?: boolean;
        tests?: Array<{
          type: string;
          compare_model?: string;
          column_name?: string;
          join_type?: string;
        }>;
      };
      response: {
        success: boolean;
        addedTests: Array<{ type: string; [key: string]: any }>;
      };
    }
  | {
      type: 'dbt-remove-model-tests';
      service: 'dbt';
      request: {
        projectName: string;
        modelNames: string[];
      };
      response: {
        success: boolean;
        modelsUpdated: number;
      };
    }
  | {
      type: 'dbt-run-test';
      service: 'dbt';
      request: {
        projectName: string;
        models: Array<{
          name: string;
          config: {
            upstream: boolean;
            downstream: boolean;
            fullLineage: boolean;
            upLimit: number;
            downLimit: number;
          };
        }>;
      };
      response: null;
    };

export type DbtArgument = { name: string; type: DbtArgumentType };

export type DbtArgumentType = 'string' | 'number' | 'boolean' | 'list' | 'dict';

export type DbtProperties = {
  version: '2';
  macros: DbtMacroProperties[];
  models: DbtModelProperties[];
  semantic_models: DbtSemanticModelProperties[];
  sources: DbtSourceProperties[];
};

// Note: dbt groups are dynamic strings based on project structure, not a fixed type

export type DbtMacroProperties = {
  arguments: { description: string; name: string; type: DbtArgumentType }[];
  description: string;
  docs: { show: boolean };
  name: string;
};

export type DbtModel = Partial<DbtProjectManifestNode> & {
  childMap: string[];
  description: string;
  name: string;
  parentMap: string[];
  pathRelativeDirectory: string; // This is the relative path the the model, not the model file location itself
  pathSystemDirectory: string;
  pathSystemFile: string;
};

export type DbtModelConfig = {
  alias?: string;
  // contract: {};
  database?: string;
  enabled?: boolean;
  // grants: {};
  incremental_strategy?:
    | 'append'
    | 'delete+insert'
    | 'dj_iceberg_partition_overwrite'
    | 'merge'
    | 'overwrite_existing_partitions';
  materialized?:
    | 'ephemeral'
    | 'incremental'
    | 'materialized view'
    | 'table'
    | 'view';
  // meta: {};
  merge_exclude_columns?: string[];
  merge_update_columns?: string[];
  // persist_docs: {};
  post_hook?: string | string[];
  pre_hook?: string | string[];
  properties?: {
    partitioned_by?: string;
    partitioning?: string;
    partitions?: string;
  };
  schema?: string;
  sql_header?: string;
  tags?: string[];
  unique_key?: string[] | string;
};

export type DbtModelProperties = {
  columns: DbtModelPropertiesColumn[];
  config?: { tags?: string[] };
  contract: { enforced?: boolean };
  description: string;
  docs: { node_color?: string; show?: boolean };
  group: string;
  meta?: FrameworkModelMeta;
  name: string;
  private: boolean;
  tests?: { unique: { column_name: string } }[];
};

export type DbtModelPropertiesColumn = {
  name: string;
  data_type?: FrameworkDataType;
  description?: string;
  meta?: DbtModelPropertiesColumnMeta;
  tags?: string[];
  // Switch to data_tests once dbt updated to >=1.8
  // data_tests?: FrameworkColumnDataTests;
  tests?: FrameworkColumnDataTests;
};

export type DbtModelPropertiesColumnMeta = {
  // type: FrameworkDataType;
  // Meta for framework
  type?: 'dim' | 'fct';
  name?: string;
  agg?: FrameworkColumnAgg;
  interval?: 'day' | 'hour' | 'month' | 'year';
  label?: string;
  origin?: { id: string };
  prefix?: string;
  // Meta for Lightdash
  dimension?: LightdashDimension;
  metrics?: LightdashMetrics;
};

export type DbtModelPropertiesColumnMetaMetric = {
  type: FrameworkMetricType;
  name?: string;
  label?: string;
  description?: string;
  sql?: string;
  group_label?: string;
  format?: 'eur' | 'gbp' | 'id' | 'km' | 'mi' | 'percent' | 'usd';
  round?: number;
};

export type DbtDocBlock = {
  body: string;
  line: number;
  name: string;
};

export type DbtMacroBlock = {
  body: string;
  line: number;
  name: string;
  references: string[];
};

export type DbtModels = Map<string, DbtModel>;

export type DbtProject = {
  catalog?: Partial<DbtProjectCatalog>;
  properties: Partial<DbtProjectProperties>;
  macroPaths: string[];
  // macros: { [name: string]: DbtMacro | undefined };
  manifest: DbtProjectManifest;
  modelPaths: string[];
  // models: { [name: string]: DbtModel | undefined };
  name: string;
  packagePath?: string; // Install path for dependencies
  // packages: DbtProject[];
  pathRelative: string; // Relative workspace path to project
  pathSystem: string; // File system path to project
  targetPath: string; // Path to dbt artifacts
  variables?: { [name: string]: string | undefined }; // Currently used to save docs syntax variables
};

export type DbtProjectCatalog = {
  nodes: { [name: string]: DbtProjectCatalogNode };
};

export type DbtProjectCatalogNode = {
  columns: { [name: string]: DbtProjectCatalogNodeColumn };
};

export type DbtProjectCatalogNodeColumn = Record<string, unknown>;

export type DbtProjectManifest = {
  child_map: { [id: string]: string[] | undefined };
  disabled: Record<string, unknown>;
  docs: Record<string, unknown>;
  exposures: Record<string, unknown>;
  group_map: Record<string, unknown>;
  groups: { [id: string]: DbtProjectManifestGroup | undefined };
  macros: { [id: string]: DbtProjectManifestMacro };
  metadata: Partial<DbtProjectManifestMetadata>;
  metrics: Record<string, unknown>;
  nodes: { [id: string]: Partial<DbtProjectManifestNode> | undefined };
  parent_map: { [id: string]: string[] | undefined };
  saved_queries: Record<string, unknown>;
  selectors: Record<string, unknown>;
  semantic_models: Record<string, unknown>;
  sources: { [id: string]: Partial<DbtProjectManifestSource> | undefined };
};

export type DbtProjectManifestGroup = {
  name: string;
  resource_type: 'group';
  package_name: string;
  path: string;
  original_file_path: string;
  unique_id: string;
  owner: {
    email: string | null;
    name: string | null;
    slack: string | null;
  };
};

export type DbtProjectManifestMetadata = {
  dbt_schema_version: string;
  dbt_version: string;
  generated_at: string;
  invocation_id: string;
  // env: {};
  project_name: string;
  project_id: string;
  user_id: string;
  send_anonymous_usage_stats: boolean;
  adapter_type: 'trino';
};

export type DbtProjectManifestMacro = {
  name: string;
  resource_type: string;
  package_name: string;
  path: string;
  original_file_path: string;
  unique_id: string;
  macro_sql: string;
  depends_on: { macros: string[] };
  description: string;
  meta: Record<string, unknown>;
  docs: { show: boolean; node_color: null };
  patch_path: string | null;
  arguments: DbtArgument[];
  created_at: number;
  supported_languages: null;
};

export type DbtProjectManifestNode = {
  alias: string;
  attached_node: string;
  build_path: null;
  // checksum: {name: 'none', checksum: ''}
  column_name: string;
  columns: {
    [name: string]: Partial<DbtModelPropertiesColumn> | undefined;
  };
  compiled_path: null;
  config: Partial<DbtProjectManifestNodeConfig>;
  contract: { enforced: false; alias_types: true; checksum: null };
  created_at: number;
  database: string;
  deferred: boolean;
  depends_on: { macros: string[]; nodes: string[] };
  description: string;
  docs: { show: boolean; node_color: null };
  file_key_name: string;
  fqn: string[];
  group: string | null;
  language: 'sql';
  meta: FrameworkModelMeta;
  metrics: [];
  name: string;
  original_file_path: string;
  package_name: string;
  patch_path: null;
  path: string;
  raw_code: string;
  refs: [];
  relation_name: null;
  resource_type: 'model' | 'seed' | 'test';
  schema: string;
  sources: [];
  tags: string[];
  test_metadata: {
    name: string;
    kwargs: Record<string, unknown>;
    namespace: string;
  };
  unique_id: string;
  unrendered_config: { alias: string };
};

export type DbtProjectManifestNodeColumn = {
  name: string;
  description: string;
  meta?: DbtModelPropertiesColumn;
  data_type: FrameworkDataType;
  constraints: [];
  tags: string[];
};

export type DbtProjectManifestNodeConfig = {
  enabled: boolean;
  alias: string;
  schema: string;
  database: null;
  meta: FrameworkModelMeta;
  tags: string[];
};

export type DbtProjectManifestSource = {
  database: string;
  schema: string;
  name: string;
  resource_type: 'source';
  package_name: string;
  path: string;
  original_file_path: string;
  unique_id: string;
  fqn: string[];
  source_name: string;
  source_description: string;
  loader: string;
  identifier: string;
  quoting: {
    database: null;
    schema: null;
    identifier: null;
    column: null;
  };
  loaded_at_field: null;
  freshness: {
    warn_after: { count: null; period: null };
    error_after: { count: null; period: null };
    filter: null;
  };
  external: null;
  description: string;
  columns: DbtProjectManifestSourceColumns;
  meta: FrameworkSourceTableMeta;
  source_meta: FrameworkSourceMeta;
  tags: string[];
  config: { enabled: boolean };
  patch_path: null;
  unrendered_config: Record<string, unknown>;
  relation_name: string;
  created_at: number;
};

export type DbtProjectManifestSourceColumns = {
  [name: string]: DbtProjectManifestSourceColumn | undefined;
};

export type DbtProjectManifestSourceColumn = {
  constraints: [];
  data_type: FrameworkDataType;
  description: string;
  meta: FrameworkSourceColumnMeta;
  name: string;
  tags: string[];
  quote: null;
};

export type DbtProjectProperties = {
  name: string;
  // 'config-version': 2;
  'analysis-paths': string[];
  'asset-paths': string[];
  'docs-paths': string[];
  'macro-paths': string[];
  'model-paths': string[];
  'packages-install-path': string;
  'seed-paths': string[];
  'snapshot-paths': string[];
  'target-path': string;
  'test-paths': string[];
  //
  models: { [name: string]: { description?: string } };
  vars: {
    project_catalog?: string;
    etl_schema?: string;
    event_dates?: string;
    storage_type?: 'delta_lake' | 'iceberg';
  };
};

export type DbtResourceType = 'model' | 'seed' | 'source' | 'snapshot' | 'test';

export type DbtSeed = Partial<DbtProjectManifestNode> & {
  childMap: string[];
  parentMap: string[]; // Parent map for a seed should always be empty
  pathRelativeDirectory: string; // This is the relative path to the source, not the source file location itself
  pathSystemDirectory: string;
  pathSystemFile: string;
};

export type DbtSemanticModelProperties = {
  model: string;
  name: string;
  description: string;
  entities: {
    expr: string;
    name: string;
    type: 'foreign' | 'primary';
  }[];
  dimensions: {
    expr?: string;
    name: string;
    type: 'categorical' | 'time';
    type_params?: { time_granularity?: 'day' };
  }[];
  measures: {
    agg:
      | 'avg'
      | 'count_distinct'
      | 'max'
      | 'median'
      | 'min'
      | 'percentile'
      | 'sum'
      | 'sum_boolean';
    description: string;
    expr?: string;
    name: string;
  }[];
};

export type DbtSource = Partial<DbtProjectManifestSource> & {
  childMap: string[];
  parentMap: string[]; // Parent map for a source should always be empty
  pathRelativeDirectory: string; // This is the relative path to the source, not the source file location itself
  pathSystemDirectory: string;
  pathSystemFile: string;
};

export type DbtSourceFreshness = {
  error_after?: {
    count: number;
    period: 'day' | 'hour' | 'minute';
  };
  filter?: string;
  warn_after?: {
    count: number;
    period: 'day' | 'hour' | 'minute';
  };
};

export type DbtSourceProperties = {
  name: string;
  database: string;
  schema: string;
  description?: string;
  freshness?: DbtSourceFreshness | null;
  loaded_at_field?: string;
  meta?: FrameworkSourceMeta;
  tables: DbtSourceTable[];
  tags?: string[];
};

export type DbtSourceTable = {
  name: string;
  description?: string;
  freshness?: DbtSourceFreshness | null;
  loaded_at_field?: string;
  columns: DbtSourceTableColumn[];
  meta?: FrameworkSourceTableMeta;
};

export type DbtSourceTableColumn = {
  name: string;
  description?: string;
  // data_type: FrameworkDataType;
  data_type: string;
  meta?: FrameworkSourceColumnMeta;
};

export type DbtRunScope =
  | 'single'
  | 'multi-model'
  | 'full-project'
  | 'modified';

export type DbtRunLineage =
  | 'model-only'
  | 'upstream'
  | 'downstream'
  | 'full-lineage';

export type SelectedModel = {
  modelName: string;
  lineage: DbtRunLineage;
};

export type DbtRunConfig = {
  // Initial Commands
  cleanAndDeps: boolean;
  seed: boolean;
  // Advanced Flags
  build: boolean;
  defer: boolean;
  fullRefresh: boolean;
  // Run Scope
  scope: DbtRunScope;
  // Project and model context (for single scope)
  projectName?: string;
  projectPath?: string;
  modelName?: string | null;
  lineage?: DbtRunLineage;
  // Selected models (for multi-model scope)
  selectedModels?: SelectedModel[];
  // Dates
  startDate?: string;
  endDate?: string;
  // State Path (for defer)
  statePath?: string;
  // Modified models list (for modified scope)
  modifiedModels?: string[];
  // Selected modified models with lineage (for modified scope with user selection)
  selectedModifiedModels?: SelectedModel[];
};
