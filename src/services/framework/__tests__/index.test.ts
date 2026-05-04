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
          agg: 'sum',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          expr: 'csp_ondemand_cost',
          type: 'fct',
          agg: 'sum',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          expr: 'csp_ondemand_cost',
          type: 'fct',
          agg: 'min',
        },
      },
      {
        name: 'csp_ondemand_cost',
        description:
          'On Demand Cost if resource were purchased without any discounts',
        data_type: 'number',
        meta: {
          expr: 'csp_ondemand_cost',
          type: 'fct',
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

  test('strategy: overwrite_existing_partitions auto-derives unique_key from partitions', () => {
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
    expect(config.unique_key).toBe('portal_partition_daily');
  });

  test('strategy: overwrite_existing_partitions without partitions omits unique_key', () => {
    // Mirrors delete+insert behavior: if the model has no partition columns,
    // unique_key is left unset so dbt / the custom macro surfaces its own
    // error rather than us emitting a phantom column.
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

  test('strategy: overwrite_existing_partitions honors explicit unique_key', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'sales',
      topic: 'orders',
      name: 'enriched',
      materialization: {
        type: 'incremental',
        strategy: {
          type: 'overwrite_existing_partitions',
          unique_key: 'dim_a',
        },
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
    expect(config.unique_key).toBe('dim_a');
  });

  test('default fallback overwrite_existing_partitions auto-derives unique_key from partitions', () => {
    // When the extension default kicks in (no explicit strategy) and the
    // model has partition columns, the partition-based unique_key should
    // also fire for the overwrite_existing_partitions default path.
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
    expect(config.unique_key).toBe('portal_partition_daily');
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
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_iceberg_override',
      materialization: {
        type: 'incremental',
        format: 'iceberg',
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

    const properties = config.properties as Record<string, string> | undefined;
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBe('portal_partition_daily');
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
              'wd_env_type',
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
            wd_env_type: {
              name: 'wd_env_type',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.parent_unpartitioned']: {
          // No meta.portal_partition_columns and no partition columns - mirrors
          // the int__capeng__* case where there is no partition config at all.
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.parent_with_partial_meta']: {
          // Mirrors `int__capeng__pca_metrics__oms_job`: inherits
          // meta.portal_partition_columns including `wd_env_type` from upstream
          // but does NOT itself produce a `wd_env_type` column. Downstream join
          // models pick up `wd_env_type` from a different join target, so the
          // meta must continue to advertise it for them.
          meta: {
            portal_partition_columns: [
              'portal_partition_monthly',
              'wd_env_type',
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
          // Mirrors `int__capeng__tenant__env_daily`: a sibling joined into the
          // pca_metrics join models that supplies `wd_env_type`.
          columns: {
            dim_a: {
              name: 'dim_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            wd_env_type: {
              name: 'wd_env_type',
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
    // `createTestDJ()` leaves `materializationDefaultIncrementalStrategy`
    // unset so the default (`overwrite_existing_partitions`) applies — the
    // partition-based unique_key resolution fires for that strategy as well.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'monthly_rollup',
      materialization: 'incremental',
      select: [{ name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily', rollup: { interval: 'month' } },
    } as unknown as FrameworkModel;

    const { config, properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBe('portal_partition_monthly');
    // Inherited meta is propagated as-is. The local intersection inside
    // `frameworkGenerateModelOutput` is what guarantees `unique_key` is
    // correct; filtering the meta here would cascade trim through join models
    // that legitimately re-introduce these columns.
    expect(properties.meta?.portal_partition_columns).toEqual([
      'portal_partition_monthly',
      'wd_env_type',
      'portal_partition_daily',
    ]);
  });

  test('unpartitioned incremental model omits unique_key entirely', () => {
    // No parent meta, no partition columns on the model - getDefaultUniqueKey
    // previously fell back to the hardcoded default list and chose
    // portal_partition_daily, producing a phantom unique_key that Trino then
    // fails to resolve at runtime. After the fix, unique_key is simply omitted
    // so dbt (or the consumer's `overwrite_existing_partitions` macro) raises
    // its own clear error instead.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'capeng',
      topic: 'tenant',
      name: 'account',
      materialization: 'incremental',
      select: [{ name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_unpartitioned' },
    } as unknown as FrameworkModel;

    const { config, properties } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBeUndefined();
    expect(properties.meta?.portal_partition_columns).toBeUndefined();
  });

  test('daily model with portal_partition_daily column keeps daily unique_key', () => {
    // Regression guard: the common "daily model inherits daily meta and
    // actually has the daily column" case must still resolve to daily.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'swh',
      topic: 'misc',
      name: 'daily_model',
      materialization: 'incremental',
      select: ['portal_partition_daily', { name: 'dim_a', type: 'dim' }],
      from: { model: 'parent_daily' },
    } as unknown as FrameworkModel;

    const { config } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(config.materialized).toBe('incremental');
    expect(config.incremental_strategy).toBe('overwrite_existing_partitions');
    expect(config.unique_key).toBe('portal_partition_daily');
  });

  test('explicit strategy.unique_key is honored even when no matching column exists', () => {
    // User-supplied unique_key takes precedence over defaulting - even if the
    // column isn't in the model (the user owns that decision). This preserves
    // existing behavior of the delete+insert branch.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'capeng',
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
    // `parent_with_partial_meta` advertises `wd_env_type` in its meta but does
    // not itself have a `wd_env_type` column. The join model produces
    // `wd_env_type` via the joined `join_target_with_env`. The child must
    // inherit the FULL parent meta list so downstream consumers (and SQL
    // ordering) continue to see `wd_env_type` as a partition column.
    const modelJson: FrameworkModel = {
      type: 'int_join_models',
      group: 'capeng',
      topic: 'pca_metrics',
      name: 'oms_join',
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
      'wd_env_type',
      'portal_partition_daily',
    ]);
  });
});
