import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildColumns,
  frameworkGenerateModelOutput,
  frameworkGetModelName,
} from '@services/framework/utils';
import { sqlFormat } from '@services/utils/sql';
import type { DJ } from '@shared';
import { jsonParse } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type { FrameworkModel } from '@shared/framework/types';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';

import { createTestDJ } from './helpers';

describe('framework fixtures', () => {
  test('test that all .sql & .yml match when generated from .model.json', () => {
    const pathRelative = '../../../../tests/fixtures';
    const pathSystem = path.join(__dirname, pathRelative);
    const pathManifest = path.join(pathSystem, 'manifest.json');
    const projectManifest = jsonParse(fs.readFileSync(pathManifest, 'utf8'));

    const project: DbtProject = {
      macroPaths: ['macros'],
      manifest: projectManifest,
      modelPaths: ['models'],
      name: projectManifest.metadata.project_name,
      pathRelative,
      pathSystem,
      properties: { vars: { event_dates: '2024-01-01' } },
      targetPath: 'target',
    };

    const pathsModelJson = glob.sync(`${pathSystem}/*.model.json`);
    for (const pathModelJson of pathsModelJson) {
      const pathSql = pathModelJson.replace(/\.model\.json$/, '.sql');
      const pathYml = pathModelJson.replace(/\.model\.json$/, '.yml');

      const fileModelJson = jsonParse(fs.readFileSync(pathModelJson, 'utf8'));
      const fileSql = fs.readFileSync(pathSql, 'utf8');
      const fileYml = fs.readFileSync(pathYml, 'utf8');

      const { sql: generatedSql, yml: generatedYml } =
        frameworkGenerateModelOutput({
          dj: createTestDJ(),
          modelJson: fileModelJson,
          project,
        });

      expect(generatedSql).toBe(fileSql);
      expect(generatedYml).toBe(fileYml);
    }
  });
});

describe('framework unit tests', () => {
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: {
        project_name: 'project',
      },
      metrics: {},
      nodes: {
        ['model.project.model_a']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            dim_b: {
              name: 'dim_b',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.model_b']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            dim_b: {
              name: 'dim_b',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            amount: {
              name: 'amount',
              data_type: 'double',
              meta: { type: 'fct' },
            },
          },
        },
        ['model.project.model_with_aggs']: {
          columns: {
            datetime: {
              name: 'datetime',
              data_type: 'timestamp',
              meta: { type: 'dim' },
            },
            store_id: {
              name: 'store_id',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            store_name: {
              name: 'store_name',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            revenue_sum: {
              name: 'revenue_sum',
              data_type: 'double',
              meta: { type: 'fct' },
            },
            events_count: {
              name: 'events_count',
              data_type: 'bigint',
              meta: { type: 'fct' },
            },
            price_min: {
              name: 'price_min',
              data_type: 'double',
              meta: { type: 'fct' },
            },
            price_max: {
              name: 'price_max',
              data_type: 'double',
              meta: { type: 'fct' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {
        source_a: {
          name: 'source_a',
        },
      },
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };
  test('staging model sql and yml files are generated correctly', () => {
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'ml',
      topic: 'test',
      name: 'model_memory_requested',
      select: ['column_a'],
      from: { source: 'source_a.table_a' },
    };
    const modelName = frameworkGetModelName(modelJson);

    expect(
      frameworkGenerateModelOutput({ dj: createTestDJ(), modelJson, project })
        .sql,
    ).toBe(
      `
{{
  config(
    materialized="ephemeral"
  )
}}
`.trim() +
        '\n\n' +
        sqlFormat(`
with ${modelName} as (
  select
    column_a,
    1 as portal_source_count
  from
    {{ source('source_a','table_a') }}
)

select * from ${modelName}
`).trim(),
    );

    expect(
      frameworkGenerateModelOutput({ dj: createTestDJ(), modelJson, project })
        .yml,
    ).toBe(
      `version: "2"
models:
  - name: ${modelName}
    group: ${modelJson.group}
    description: ""
    docs:
      node_color: "#B6AB33"
      show: true
    private: false
    contract:
      enforced: false
    config:
      tags:
        - json
        - staging
    columns:
      - name: column_a
        data_type: varchar
        description: Column A
        meta:
          type: dim
      - name: portal_source_count
        data_type: bigint
        description: Portal Source Count
        meta:
          type: fct
          dimension:
            label: Portal Source Count
            hidden: true
          metrics:
            metric_portal_source_count:
              type: sum
              label: Portal Source Count
`,
    );
  });

  test('join model sql is generated correctly', () => {
    const modelJson: FrameworkModel = {
      type: 'int_join_models',
      group: 'ml',
      name: 'model_c',
      select: [
        { type: 'dims_from_model', model: 'model_a' },
        { type: 'dims_from_model', model: 'model_b' },
      ],
      from: {
        model: 'model_a',
        join: [
          {
            model: 'model_b',
            on: { and: ['dim_a', 'dim_b'] },
          },
        ],
      },
    };
    const modelName = frameworkGetModelName(modelJson);

    expect(
      frameworkGenerateModelOutput({
        dj: createTestDJ(),
        modelJson,
        project,
      }).sql,
    ).toBe(
      `
{{
  config(
    materialized="ephemeral"
  )
}}
`.trim() +
        '\n\n' +
        sqlFormat(`
with ${modelName} as (
  select
      model_a.dim_a,
      model_a.dim_b
  from
      {{ ref('model_a') }} model_a
  inner join
      {{ ref('model_b') }} model_b
  on model_a.dim_a = model_b.dim_a and model_a.dim_b = model_b.dim_b
)
select * from ${modelName}
        `),
    );
  });

  test('join model with aggregation generates correct sql', () => {
    const modelJson: FrameworkModel = {
      type: 'int_join_models',
      group: 'ml',
      name: 'model_c_agg',
      select: [
        { type: 'dims_from_model', model: 'model_a' },
        { model: 'model_b', name: 'amount', type: 'fct', agg: 'sum' },
      ],
      from: {
        model: 'model_a',
        join: [
          {
            model: 'model_b',
            on: { and: ['dim_a'] },
          },
        ],
      },
    };
    const modelName = frameworkGetModelName(modelJson);

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(result.sql).toBe(
      `
{{
  config(
    materialized="ephemeral"
  )
}}
`.trim() +
        '\n\n' +
        sqlFormat(`
with ${modelName} as (
  select
      sum(model_b.amount) as amount_sum,
      model_a.dim_a,
      model_a.dim_b
  from
      {{ ref('model_a') }} model_a
  inner join
      {{ ref('model_b') }} model_b
  on model_a.dim_a = model_b.dim_a
  group by
      model_a.dim_a,
      model_a.dim_b
)
select * from ${modelName}
        `),
    );
  });

  test('builds columns correctly', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'billing',
      name: 'cost_aggregated',
      from: {
        model: 'stg__analytics__billing__raw_data',
      },
      select: [
        {
          name: 'count_star',
          type: 'fct',
          agg: 'sum',
        },
        {
          name: 'csp_ondemand_cost',
          expr: 'csp_ondemand_cost',
          type: 'fct',
          aggs: ['sum', 'min', 'max'],
          description:
            'On Demand Cost if resource were purchased without any discounts',
        },
      ],
    };
    expect(
      frameworkBuildColumns({ dj: createTestDJ(), modelJson, project }).columns,
    ).toEqual([
      {
        name: 'count_star',
        data_type: 'number',
        meta: {
          type: 'fct',
          origin: {
            id: 'model.project.int__analytics__billing__cost_aggregated',
          },
        },
        internal: {
          agg: 'sum',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          type: 'fct',
        },
        internal: {
          expr: 'csp_ondemand_cost',
          agg: 'sum',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          type: 'fct',
        },
        internal: {
          expr: 'csp_ondemand_cost',
          agg: 'min',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          type: 'fct',
        },
        internal: {
          expr: 'csp_ondemand_cost',
          agg: 'max',
        },
      },
    ]);
  });

  test('int_select_model with group_by does not re-aggregate without from.rollup', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'reporting',
      name: 'store_summary',
      from: {
        model: 'model_with_aggs',
      },
      select: [
        'store_id',
        'store_name',
        { name: 'revenue_sum', type: 'fct' },
        { name: 'events_count', type: 'fct' },
        { name: 'price_min', type: 'fct' },
        { name: 'price_max', type: 'fct' },
        {
          name: 'total_days',
          expr: 'COUNT(DISTINCT event_date)',
          type: 'fct',
        },
      ],
      group_by: [{ type: 'dims' }],
    };
    const modelName = frameworkGetModelName(modelJson);

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(result.sql).toBe(
      `
{{
  config(
    materialized="ephemeral"
  )
}}
`.trim() +
        '\n\n' +
        sqlFormat(`
with ${modelName} as (
  select
      datetime,
      events_count,
      price_max,
      price_min,
      revenue_sum,
      store_id,
      store_name,
      COUNT(DISTINCT event_date) as total_days
  from
      {{ ref('model_with_aggs') }}
  group by
      datetime,
      store_id,
      store_name
)
select * from ${modelName}
        `),
    );
  });

  test('int_select_model with from.rollup + explicit select generates rollup SQL', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'reporting',
      name: 'store_daily',
      from: {
        model: 'model_with_aggs',
        rollup: { interval: 'day' },
      },
      select: [
        'store_id',
        { name: 'revenue_sum', type: 'fct' },
        { name: 'events_count', type: 'fct' },
        {
          name: 'custom_metric',
          expr: 'COUNT(DISTINCT store_name)',
          type: 'fct',
        },
      ],
    };
    const modelName = frameworkGetModelName(modelJson);

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(result.sql).toBe(
      `
{{
  config(
    materialized="ephemeral"
  )
}}
`.trim() +
        '\n\n' +
        sqlFormat(`
with ${modelName} as (
  select
      COUNT(DISTINCT store_name) as custom_metric,
      date_trunc('day', datetime) as datetime,
      sum(events_count) as events_count,
      sum(revenue_sum) as revenue_sum,
      store_id
  from
      {{ ref('model_with_aggs') }}
  group by
      date_trunc('day', datetime),
      store_id
)
select * from ${modelName}
        `),
    );
  });
});

describe('materialization shorthand', () => {
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.model_a']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  test('"materialization": "incremental" uses default strategy from config', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: 'incremental',
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy: 'delete+insert',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
  });

  test('"materialization": "incremental" respects config override to merge', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: 'incremental',
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy: 'merge',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('merge');
  });

  test('"materialization": "ephemeral" string shorthand generates ephemeral config', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: 'ephemeral',
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('ephemeral');
    expect(config.incremental_strategy).toBeUndefined();
  });

  test('materialization object with explicit strategy takes precedence over config', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert', unique_key: 'dim_a' },
      },
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy: 'merge',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBe('dim_a');
  });

  test('"materialized" string without incremental_strategy uses config default', () => {
    const modelJson: FrameworkModel = {
      type: 'stg_select_source',
      group: 'sales',
      topic: 'orders',
      name: 'raw',
      materialized: 'incremental',
      select: ['dim_a'],
      from: { source: 'source_a.table_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy: 'delete+insert',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
  });

  test('defaults to overwrite_existing_partitions when config is unset', () => {
    // Fallback must match the DEFAULT_INCREMENTAL_STRATEGY shared constant
    // (src/shared/framework/constants.ts) and the `default` in package.json,
    // so the extension behaves consistently when the user never touches the
    // setting. Changing the factory default only requires updating that
    // constant plus the package.json entry.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: 'incremental',
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = { config: {} };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
  });

  test('materialization object without strategy uses config default', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: { type: 'incremental' },
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy: 'merge',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('merge');
  });

  test('overwrite_existing_partitions from config is applied', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: 'incremental',
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        materializationDefaultIncrementalStrategy:
          'overwrite_existing_partitions',
      },
    };

    const { config } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
  });
});

// Tests for the new `append` and `overwrite_existing_partitions` per-model
// strategies, plus storage-format-aware partitioning. Use a fresh describe
// block with its own fixture so the partition-column assertions stay clear.
describe('incremental strategy variants', () => {
  const unpartitionedProject: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.model_a']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  const partitionedProject: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.parent_daily']: {
          meta: {
            portal_partition_columns: ['portal_partition_daily'],
          },
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            portal_partition_daily: {
              name: 'portal_partition_daily',
              data_type: 'date',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  test('strategy: append emits incremental_strategy=append with no unique_key', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: {
        type: 'incremental',
        strategy: { type: 'append' },
      },
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: unpartitionedProject,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('append');
    expect(config.unique_key).toBeUndefined();
    expect(config.merge_update_columns).toBeUndefined();
    expect(config.merge_exclude_columns).toBeUndefined();
  });

  test('strategy: append on a partitioned model still omits unique_key', () => {
    // append never needs a unique_key regardless of whether the model has a
    // partition column. Confirms the switch arm does not fall through to the
    // partition-based defaulting branch.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_append',
      materialization: {
        type: 'incremental',
        strategy: { type: 'append' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: partitionedProject,
    });

    expect(config.incremental_strategy).toBe('append');
    expect(config.unique_key).toBeUndefined();
  });

  test('strategy: overwrite_existing_partitions omits unique_key on partitioned models', () => {
    // unique_key is dead config for overwrite_existing_partitions: the
    // consumer macro derives the partition list from the new slice itself.
    // Even when the model has partition columns, we intentionally never emit
    // unique_key (and the JSON schema rejects it on this strategy).
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_overwrite',
      materialization: {
        type: 'incremental',
        strategy: { type: 'overwrite_existing_partitions' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: partitionedProject,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBeUndefined();
  });

  test('strategy: overwrite_existing_partitions omits unique_key on unpartitioned models', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: {
        type: 'incremental',
        strategy: { type: 'overwrite_existing_partitions' },
      },
      select: [{ model: 'model_a', columns: ['dim_a'] }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: unpartitionedProject,
    });

    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBeUndefined();
  });

  test('default fallback overwrite_existing_partitions omits unique_key', () => {
    // When the extension default kicks in (no explicit strategy) and resolves
    // to overwrite_existing_partitions, unique_key must NOT be emitted -- the
    // consumer macro derives partitions from the new slice.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_default',
      materialization: 'incremental',
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: { config: {} } as DJ,
      modelJson,
      project: partitionedProject,
    });

    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBeUndefined();
  });

  test('Delta Lake / Hive partitioning uses properties.partitioned_by', () => {
    // Without model-level format or project storage_type set, we default to
    // delta_lake/hive which uses `partitioned_by` in SQL properties.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_delta',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: partitionedProject,
    });

    const properties = config.properties as Record<string, string> | undefined;
    expect(properties).toBeDefined();
    expect(properties?.partitioned_by).toBe("ARRAY['portal_partition_daily']");
    expect(properties?.partitioning).toBeUndefined();
  });

  test('Iceberg (via project storage_type) uses properties.partitioning', () => {
    const icebergProject: DbtProject = {
      ...partitionedProject,
      variables: { storage_type: 'iceberg' },
    };

    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_iceberg',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: icebergProject,
    });

    const properties = config.properties as Record<string, string> | undefined;
    expect(properties).toBeDefined();
    expect(properties?.partitioning).toBe("ARRAY['portal_partition_daily']");
    expect(properties?.partitioned_by).toBeUndefined();
  });

  test('Iceberg (via model-level format override) uses properties.partitioning', () => {
    // Use delete+insert so we can assert unique_key defaulting alongside the
    // Iceberg `partitioning` keyword. overwrite_existing_partitions never
    // emits unique_key, so the partitioning assertion still works either way,
    // but delete+insert gives us coverage of both behaviors at once.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_iceberg_override',
      materialization: {
        type: 'incremental',
        format: 'iceberg',
        strategy: { type: 'delete+insert' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: partitionedProject,
    });

    const properties = config.properties as Record<string, string> | undefined;
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBe('portal_partition_daily');
    expect(properties?.partitioning).toBe("ARRAY['portal_partition_daily']");
    expect(properties?.partitioned_by).toBeUndefined();
  });

  test('strategy: dj_iceberg_partition_overwrite emits Iceberg partitioning + omits unique_key', () => {
    // dj_iceberg_partition_overwrite is the DJ-shipped variant of
    // overwrite_existing_partitions. Like its consumer-supplied cousin it
    // never emits unique_key (the macro derives partitions from the new
    // slice itself), but it requires Iceberg format -- so the partition
    // keyword must be `partitioning` (not `partitioned_by`).
    const icebergProject: DbtProject = {
      ...partitionedProject,
      variables: { storage_type: 'iceberg' },
    };

    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_dj_iceberg',
      materialization: {
        type: 'incremental',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: icebergProject,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('dj_iceberg_partition_overwrite');
    expect(config.unique_key).toBeUndefined();
    const properties = config.properties as Record<string, string> | undefined;
    expect(properties?.partitioning).toBe("ARRAY['portal_partition_daily']");
    expect(properties?.partitioned_by).toBeUndefined();
  });

  test('strategy: dj_iceberg_partition_overwrite honors model-level format override', () => {
    // No project-level storage_type, but the model overrides format to
    // iceberg -- the SQL generator must still emit `partitioning` and the
    // strategy must still be wired through cleanly.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_dj_iceberg_override',
      materialization: {
        type: 'incremental',
        format: 'iceberg',
        strategy: { type: 'dj_iceberg_partition_overwrite' },
      },
      select: [
        'portal_partition_daily',
        { type: 'dim', name: 'dim_a' } as never,
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: partitionedProject,
    });

    expect(config.incremental_strategy).toBe('dj_iceberg_partition_overwrite');
    expect(config.unique_key).toBeUndefined();
    const properties = config.properties as Record<string, string> | undefined;
    expect(properties?.partitioning).toBe("ARRAY['portal_partition_daily']");
    expect(properties?.partitioned_by).toBeUndefined();
  });
});

describe('incremental unique_key defaulting', () => {
  // Parent model carries BOTH monthly and daily partition columns and
  // declares meta.portal_partition_columns that includes daily. This is
  // the shape we see in real projects where a daily-grain model feeds a
  // monthly rollup.
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.parent_daily']: {
          meta: {
            portal_partition_columns: [
              'portal_partition_monthly',
              'env_type',
              'portal_partition_daily',
            ],
          },
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            portal_partition_monthly: {
              name: 'portal_partition_monthly',
              data_type: 'date',
              meta: { type: 'dim' },
            },
            portal_partition_daily: {
              name: 'portal_partition_daily',
              data_type: 'date',
              meta: { type: 'dim' },
            },
            env_type: {
              name: 'env_type',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.parent_unpartitioned']: {
          // No meta.portal_partition_columns and no partition columns - mirrors
          // the int__analytics__* case where there is no partition config at all.
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.parent_with_partial_meta']: {
          // Mirrors `int__analytics__metrics__daily_job`: inherits
          // meta.portal_partition_columns including `env_type` from upstream
          // but does NOT itself produce a `env_type` column. Downstream join
          // models pick up `env_type` from a different join target, so the
          // meta must continue to advertise it for them.
          meta: {
            portal_partition_columns: [
              'portal_partition_monthly',
              'env_type',
              'portal_partition_daily',
            ],
          },
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            portal_partition_monthly: {
              name: 'portal_partition_monthly',
              data_type: 'date',
              meta: { type: 'dim' },
            },
            portal_partition_daily: {
              name: 'portal_partition_daily',
              data_type: 'date',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.join_target_with_env']: {
          // Mirrors `int__analytics__tenant__env_daily`: a sibling joined into the
          // metrics join models that supplies `env_type`.
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            env_type: {
              name: 'env_type',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  test('monthly rollup inheriting daily parent meta resolves unique_key to monthly', () => {
    // `from.rollup: month` causes column-utils to exclude the daily partition
    // column from the child model's `columns`, matching the real monthly-
    // rollup shape in production. Without the fix, getDefaultUniqueKey would
    // still pick 'daily' from the inherited meta and emit a phantom unique_key.
    // Use explicit `delete+insert` so this test directly exercises the
    // partition-based unique_key resolution (overwrite_existing_partitions
    // never emits unique_key).
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'monthly_rollup',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert' },
      },
      select: [{ name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily', rollup: { interval: 'month' } },
    } as unknown as FrameworkModel;

    const { config, properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBe('portal_partition_monthly');
    // Inherited meta is propagated as-is. The local intersection inside
    // `frameworkGenerateModelOutput` is what guarantees `unique_key` is
    // correct; filtering the meta here would cascade trim through join models
    // that legitimately re-introduce these columns.
    expect(properties.meta?.portal_partition_columns).toEqual([
      'portal_partition_monthly',
      'env_type',
      'portal_partition_daily',
    ]);
  });

  test('unpartitioned incremental delete+insert model omits unique_key entirely', () => {
    // No parent meta, no partition columns on the model - getDefaultUniqueKey
    // previously fell back to the hardcoded default list and chose
    // portal_partition_daily, producing a phantom unique_key that Trino then
    // fails to resolve at runtime. After the fix, unique_key is simply omitted
    // so dbt raises its own clear "delete+insert requires unique_key" error.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'tenant',
      name: 'account',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert' },
      },
      select: [{ name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_unpartitioned' },
    } as unknown as FrameworkModel;

    const { config, properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBeUndefined();
    expect(properties.meta?.portal_partition_columns).toBeUndefined();
  });

  test('daily delete+insert model with portal_partition_daily column keeps daily unique_key', () => {
    // Regression guard: the common "daily model inherits daily meta and
    // actually has the daily column" case must still resolve to daily.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_model',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert' },
      },
      select: ['portal_partition_daily', { name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBe('portal_partition_daily');
  });

  test('explicit strategy.unique_key is honored even when no matching column exists', () => {
    // User-supplied unique_key takes precedence over defaulting - even if the
    // column isn't in the model (the user owns that decision). This preserves
    // existing behavior of the delete+insert branch.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'tenant',
      name: 'account_explicit',
      materialization: {
        type: 'incremental',
        strategy: { type: 'delete+insert', unique_key: 'dim_a' },
      },
      select: [{ name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_unpartitioned' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('delete+insert');
    expect(config.unique_key).toBe('dim_a');
  });

  test('join model re-introducing a partition column inherits parent meta intact', () => {
    // Regression guard for the cascading-loss bug. The base parent
    // `parent_with_partial_meta` advertises `env_type` in its meta but does
    // not itself have a `env_type` column. The join model produces
    // `env_type` via the joined `join_target_with_env`. The child must
    // inherit the FULL parent meta list so downstream consumers (and SQL
    // ordering) continue to see `env_type` as a partition column.
    const modelJson: FrameworkModel = {
      type: 'int_join_models',
      group: 'analytics',
      topic: 'metrics',
      name: 'daily_join',
      materialization: 'incremental',
      select: [
        { type: 'dims_from_model', model: 'parent_with_partial_meta' },
        { type: 'dims_from_model', model: 'join_target_with_env' },
      ],
      from: {
        model: 'parent_with_partial_meta',
        join: [
          {
            model: 'join_target_with_env',
            on: { and: ['dim_a'] },
          },
        ],
      },
    } as unknown as FrameworkModel;

    const { properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(properties.meta?.portal_partition_columns).toEqual([
      'portal_partition_monthly',
      'env_type',
      'portal_partition_daily',
    ]);
  });
});

describe('lightdash global sql_filter default', () => {
  // Reuse the same project fixture shape used by the other lightdash-adjacent
  // tests above. Columns on `model_a` are `dim_a` + `dim_b`, on `model_b` they
  // are `dim_a`, `dim_b`, `amount`.
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.model_a']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            dim_b: {
              name: 'dim_b',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  const GLOBAL_FILTER =
    '(account_project_id in (select id from catalog.finops.account_rollup))';

  // Builds a DJ object with optional lightdash global-default config.
  function makeDj(opts?: {
    defaultFilter?: string;
    requiredColumns?: string[];
  }): DJ {
    return {
      config: {
        aiHintTag: 'ai',
        lightdashDefaultSqlFilter: opts?.defaultFilter,
        lightdashDefaultSqlFilterRequiredColumns: opts?.requiredColumns,
      },
    };
  }

  // Common model that has `dim_a`/`dim_b` (matches required cols `dim_a`).
  // We use a select-from-model so the generated columns match `model_a`'s set.
  const baseModel = (
    lightdash: FrameworkModel extends infer T
      ? T extends { lightdash?: infer L }
        ? L
        : never
      : never,
  ): FrameworkModel =>
    ({
      type: 'int_select_model',
      group: 'ml',
      topic: 'lf',
      name: 'lightdash_global_filter_target',
      select: [{ type: 'dims_from_model', model: 'model_a' }],
      from: { model: 'model_a' },
      lightdash,
    }) as unknown as FrameworkModel;

  test('no lightdash block: global default is never applied', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'ml',
      topic: 'lf',
      name: 'no_lightdash',
      select: [{ type: 'dims_from_model', model: 'model_a' }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({ defaultFilter: GLOBAL_FILTER, requiredColumns: ['dim_a'] }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('lightdash block, no sql_filter, no global config: nothing applied', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj(),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
    expect(properties.meta?.label).toBe('My Table');
  });

  test('lightdash block, no sql_filter, global config + required columns present: default injected', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(GLOBAL_FILTER);
  });

  test('lightdash block, no sql_filter, global config + missing required column: default skipped', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        // `account_project_id` is not on `model_a`, so the global filter
        // must NOT be applied to this model.
        requiredColumns: ['dim_a', 'account_project_id'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('lightdash block with explicit sql_filter string: per-model override wins', () => {
    const overrideFilter = 'dim_a in (1, 2, 3)';
    const modelJson = baseModel({
      table: { label: 'My Table', sql_filter: overrideFilter },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(overrideFilter);
  });

  test('lightdash block with sql_filter: null: explicit disable, even with global config set', () => {
    const modelJson = baseModel({
      table: { label: 'My Table', sql_filter: null },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('empty requiredColumns means "always apply" when default filter is set', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({ defaultFilter: GLOBAL_FILTER, requiredColumns: [] }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(GLOBAL_FILTER);
  });
});

describe('partition column case_sensitive', () => {
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.parent_daily']: {
          meta: {
            portal_partition_columns: ['portal_partition_daily'],
          },
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            portal_partition_daily: {
              name: 'portal_partition_daily',
              data_type: 'date',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  test('partition columns automatically get case_sensitive: true when setting enabled', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'daily_model',
      materialization: 'incremental',
      select: ['portal_partition_daily', { name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        ...createTestDJ().config,
        lightdashDefaultPartitionColumnCaseSensitive: true,
      },
    };

    const { properties } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    const partitionCol = properties.columns?.find(
      (c) => c.name === 'portal_partition_daily',
    );
    expect(partitionCol?.meta?.dimension?.case_sensitive).toBe(true);

    // Non-partition columns should not get case_sensitive auto-set
    const dimCol = properties.columns?.find((c) => c.name === 'dim_a');
    expect(dimCol?.meta?.dimension?.case_sensitive).toBeUndefined();
  });

  test('partition columns do NOT get case_sensitive when setting is disabled', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'daily_model_disabled',
      materialization: 'incremental',
      select: ['portal_partition_daily', { name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const partitionCol = properties.columns?.find(
      (c) => c.name === 'portal_partition_daily',
    );
    expect(partitionCol?.meta?.dimension?.case_sensitive).toBeUndefined();
  });

  test('explicit case_sensitive: false on partition column is preserved', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'daily_model_override',
      materialization: 'incremental',
      select: [
        {
          name: 'portal_partition_daily',
          type: 'dim',
          lightdash: { dimension: { case_sensitive: false } },
        },
        { name: 'dim_a', type: 'dim' },
      ],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const dj: DJ = {
      config: {
        ...createTestDJ().config,
        lightdashDefaultPartitionColumnCaseSensitive: true,
      },
    };

    const { properties } = frameworkGenerateModelOutput({
      dj,
      modelJson,
      project,
    });

    const partitionCol = properties.columns?.find(
      (c) => c.name === 'portal_partition_daily',
    );
    // Explicit false overrides the auto-set behavior
    expect(partitionCol?.meta?.dimension?.case_sensitive).toBe(false);
  });
});

describe('lightdash global sql_filter default', () => {
  // Reuse the same project fixture shape used by the other lightdash-adjacent
  // tests above. Columns on `model_a` are `dim_a` + `dim_b`, on `model_b` they
  // are `dim_a`, `dim_b`, `amount`.
  const project: DbtProject = {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes: {
        ['model.project.model_a']: {
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            dim_b: {
              name: 'dim_b',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources: {},
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
  };

  const GLOBAL_FILTER =
    '(account_project_id in (select id from catalog.finops.account_rollup))';

  // Builds a DJ object with optional lightdash global-default config.
  function makeDj(opts?: {
    defaultFilter?: string;
    requiredColumns?: string[];
  }): DJ {
    return {
      config: {
        aiHintTag: 'ai',
        lightdashDefaultSqlFilter: opts?.defaultFilter,
        lightdashDefaultSqlFilterRequiredColumns: opts?.requiredColumns,
      },
    };
  }

  // Common model that has `dim_a`/`dim_b` (matches required cols `dim_a`).
  // We use a select-from-model so the generated columns match `model_a`'s set.
  const baseModel = (
    lightdash: FrameworkModel extends infer T
      ? T extends { lightdash?: infer L }
        ? L
        : never
      : never,
  ): FrameworkModel =>
    ({
      type: 'int_select_model',
      group: 'ml',
      topic: 'lf',
      name: 'lightdash_global_filter_target',
      select: [{ type: 'dims_from_model', model: 'model_a' }],
      from: { model: 'model_a' },
      lightdash,
    }) as unknown as FrameworkModel;

  test('no lightdash block: global default is never applied', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'ml',
      topic: 'lf',
      name: 'no_lightdash',
      select: [{ type: 'dims_from_model', model: 'model_a' }],
      from: { model: 'model_a' },
    } as unknown as FrameworkModel;

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({ defaultFilter: GLOBAL_FILTER, requiredColumns: ['dim_a'] }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('lightdash block, no sql_filter, no global config: nothing applied', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj(),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
    expect(properties.meta?.label).toBe('My Table');
  });

  test('lightdash block, no sql_filter, global config + required columns present: default injected', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(GLOBAL_FILTER);
  });

  test('lightdash block, no sql_filter, global config + missing required column: default skipped', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        // `account_project_id` is not on `model_a`, so the global filter
        // must NOT be applied to this model.
        requiredColumns: ['dim_a', 'account_project_id'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('lightdash block with explicit sql_filter string: per-model override wins', () => {
    const overrideFilter = 'dim_a in (1, 2, 3)';
    const modelJson = baseModel({
      table: { label: 'My Table', sql_filter: overrideFilter },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(overrideFilter);
  });

  test('lightdash block with sql_filter: null: explicit disable, even with global config set', () => {
    const modelJson = baseModel({
      table: { label: 'My Table', sql_filter: null },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({
        defaultFilter: GLOBAL_FILTER,
        requiredColumns: ['dim_a'],
      }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBeUndefined();
  });

  test('empty requiredColumns means "always apply" when default filter is set', () => {
    const modelJson = baseModel({
      table: { label: 'My Table' },
    });

    const { properties } = frameworkGenerateModelOutput({
      dj: makeDj({ defaultFilter: GLOBAL_FILTER, requiredColumns: [] }),
      modelJson,
      project,
    });

    expect(properties.meta?.sql_filter).toBe(GLOBAL_FILTER);
  });
});
