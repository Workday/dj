import { describe, expect, test } from '@jest/globals';
import { frameworkGenerateModelOutput } from '@services/framework/utils';
import type { FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

const project = createTestProject();

describe('CTE Integration / Full Model', () => {
  test('int_union_models with CTEs generates CTE-based UNION ALL SQL', () => {
    const unionProject = createTestProject({
      nodes: {
        ['model.project.model_a']: {
          columns: {
            col_a: {
              name: 'col_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            col_b: {
              name: 'col_b',
              data_type: 'bigint',
              meta: { type: 'fct' },
            },
          },
        },
        ['model.project.model_b']: {
          columns: {
            col_x: {
              name: 'col_x',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            col_y: {
              name: 'col_y',
              data_type: 'bigint',
              meta: { type: 'fct' },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'int_union_models',
      group: 'test',
      topic: 'cte',
      name: 'union_normalized',
      ctes: [
        {
          name: 'normalized_a',
          from: { model: 'model_a' },
          select: [
            { name: 'id', expr: 'col_a' },
            { name: 'value', expr: 'col_b' },
          ],
        },
        {
          name: 'normalized_b',
          from: { model: 'model_b' },
          select: [
            { name: 'id', expr: 'col_x' },
            { name: 'value', expr: 'col_y' },
          ],
        },
      ],
      from: {
        cte: 'normalized_a',
        union: { type: 'all', ctes: ['normalized_b'] },
      },
      select: [{ type: 'all_from_cte', cte: 'normalized_a' }],
    } as any;

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: unionProject,
    });

    expect(result.sql).toContain('normalized_a');
    expect(result.sql).toContain('normalized_b');
    expect(result.sql.toUpperCase()).toContain('UNION ALL');
    expect(result.sql).toContain("ref('model_a')");
    expect(result.sql).toContain("ref('model_b')");
    expect(result.sql).toContain('normalized_a');
    expect(result.sql).toContain('normalized_b');
    const mainCteSql =
      result.sql.split('int__test__cte__union_normalized')[1] || '';
    expect(mainCteSql).not.toContain("ref('normalized_a')");
    expect(mainCteSql).not.toContain("ref('normalized_b')");
  });

  test('int_union_models with CTEs produces correct YML columns', () => {
    const unionProject = createTestProject({
      nodes: {
        ['model.project.model_a']: {
          columns: {
            col_a: {
              name: 'col_a',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.model_b']: {
          columns: {
            col_x: {
              name: 'col_x',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'int_union_models',
      group: 'test',
      topic: 'cte',
      name: 'union_yml',
      ctes: [
        {
          name: 'norm_a',
          from: { model: 'model_a' },
          select: [{ name: 'id', expr: 'col_a' }],
        },
        {
          name: 'norm_b',
          from: { model: 'model_b' },
          select: [{ name: 'id', expr: 'col_x' }],
        },
      ],
      from: {
        cte: 'norm_a',
        union: { type: 'all', ctes: ['norm_b'] },
      },
      select: [{ type: 'all_from_cte', cte: 'norm_a' }],
    } as any;

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: unionProject,
    });

    expect(result.yml).toContain('id');
    expect(result.properties.columns.length).toBeGreaterThan(0);
    expect(result.properties.columns.some((c: any) => c.name === 'id')).toBe(
      true,
    );
  });

  test('int_union_models without CTEs still works (regression)', () => {
    const unionProject = createTestProject({
      nodes: {
        ['model.project.model_a']: {
          columns: {
            shared_col: {
              name: 'shared_col',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
        ['model.project.model_b']: {
          columns: {
            shared_col: {
              name: 'shared_col',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'int_union_models',
      group: 'test',
      topic: 'union',
      name: 'classic',
      from: {
        model: 'model_a',
        union: { models: ['model_b'] },
      },
    } as any;

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: unionProject,
    });

    expect(result.sql).toContain("ref('model_a')");
    expect(result.sql).toContain("ref('model_b')");
    expect(result.sql.toUpperCase()).toContain('UNION ALL');
    expect(result.sql).not.toContain('normalized_');
  });

  test('full model with CTE-to-CTE join generates correct SQL', () => {
    const joinProject = createTestProject({
      nodes: {
        ['model.project.ext_model_a']: {
          columns: {
            id: { name: 'id', data_type: 'varchar', meta: { type: 'dim' } },
            value: {
              name: 'value',
              data_type: 'bigint',
              meta: { type: 'fct' },
            },
          },
        },
        ['model.project.ext_model_b']: {
          columns: {
            id: { name: 'id', data_type: 'varchar', meta: { type: 'dim' } },
            label: {
              name: 'label',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'test',
      topic: 'cte',
      name: 'cte_join',
      tags: ['lightdash'],
      ctes: [
        {
          name: 'data_cte',
          from: { model: 'ext_model_a' },
          select: ['id', 'value'],
        },
        {
          name: 'lookup_cte',
          from: { model: 'ext_model_b' },
          select: ['id', 'label'],
        },
        {
          name: 'final_joined',
          from: {
            cte: 'data_cte',
            join: [{ cte: 'lookup_cte', on: { and: ['id'] }, type: 'left' }],
          },
          select: [
            { type: 'all_from_cte', cte: 'data_cte' },
            { cte: 'lookup_cte', name: 'label' },
          ],
        },
      ],
      from: { cte: 'final_joined' },
      select: [{ type: 'all_from_cte', cte: 'final_joined' }],
    } as any;

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: joinProject,
    });

    expect(result.sql).toContain('data_cte AS (');
    expect(result.sql).toContain('lookup_cte AS (');
    expect(result.sql).toContain('final_joined AS (');
    expect(result.sql.toUpperCase()).toContain('LEFT JOIN LOOKUP_CTE');
    expect(result.sql).toContain('data_cte.id = lookup_cte.id');
    expect(result.sql).not.toContain("ref('data_cte')");
    expect(result.sql).not.toContain("ref('lookup_cte')");
    expect(result.sql).toContain("ref('ext_model_a')");
    expect(result.sql).toContain("ref('ext_model_b')");
  });

  // Main model with `from: { cte }` inherits framework columns from the
  // upstream CTE registry the same way `from: { model }` consumers inherit
  // from the manifest. Mirrors the symmetric auto-inject contract documented
  // on `frameworkShouldAutoInjectCteFrameworkDims` / the main-model branch
  // in `frameworkBuildColumns`.
  describe('main model from: { cte } framework auto-inject', () => {
    function chainedProject() {
      return createTestProject({
        nodes: {
          ['model.project.upstream_facts']: {
            columns: {
              region: {
                name: 'region',
                data_type: 'varchar',
                meta: { type: 'dim' },
              },
              amount: {
                name: 'amount',
                data_type: 'bigint',
                meta: { type: 'fct' },
              },
              datetime: {
                name: 'datetime',
                data_type: 'timestamp(6)',
                meta: { type: 'dim', interval: 'day' },
              },
              portal_partition_monthly: {
                name: 'portal_partition_monthly',
                data_type: 'varchar',
                meta: { type: 'dim' },
              },
              portal_partition_daily: {
                name: 'portal_partition_daily',
                data_type: 'varchar',
                meta: { type: 'dim' },
              },
              portal_source_count: {
                name: 'portal_source_count',
                data_type: 'bigint',
                meta: {
                  type: 'fct',
                  dimension: { label: 'Portal Source Count', hidden: true },
                },
              },
            },
          },
        },
      });
    }

    test('inherits datetime, partitions, and portal_source_count from upstream CTE', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'cte_chain',
        name: 'rolled',
        ctes: [
          {
            name: 'rolled_up',
            from: { model: 'upstream_facts' },
            select: [
              { name: 'region', type: 'dim' },
              { name: 'amount', type: 'fct', agg: 'sum' },
            ],
            group_by: 'dims',
          },
        ],
        from: { cte: 'rolled_up' },
        select: [{ name: 'region', type: 'dim' }],
      } as any;

      const result = frameworkGenerateModelOutput({
        dj: createTestDJ(),
        modelJson,
        project: chainedProject(),
      });

      const ymlNames = (result.properties.columns as { name: string }[]).map(
        (c) => c.name,
      );
      expect(ymlNames).toContain('datetime');
      expect(ymlNames).toContain('portal_partition_monthly');
      expect(ymlNames).toContain('portal_partition_daily');
      expect(ymlNames).toContain('portal_source_count');
    });

    test('model-level exclude_portal_partition_columns strips inherited partitions', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'cte_chain',
        name: 'no_partitions',
        ctes: [
          {
            name: 'rolled_up',
            from: { model: 'upstream_facts' },
            select: [
              { name: 'region', type: 'dim' },
              { name: 'amount', type: 'fct', agg: 'sum' },
            ],
            group_by: 'dims',
          },
        ],
        from: { cte: 'rolled_up' },
        select: [{ name: 'region', type: 'dim' }],
        exclude_portal_partition_columns: true,
      } as any;

      const result = frameworkGenerateModelOutput({
        dj: createTestDJ(),
        modelJson,
        project: chainedProject(),
      });

      const ymlNames = (result.properties.columns as { name: string }[]).map(
        (c) => c.name,
      );
      // Datetime + portal_source_count still survive; partitions are stripped
      // by the model-level exclude flag.
      expect(ymlNames).toContain('datetime');
      expect(ymlNames).toContain('portal_source_count');
      expect(ymlNames).not.toContain('portal_partition_monthly');
      expect(ymlNames).not.toContain('portal_partition_daily');
    });
  });
});
