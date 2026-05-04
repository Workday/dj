import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
  frameworkGenerateModelOutput,
} from '@services/framework/utils';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

const project = createTestProject();

describe('CTE SQL Generation', () => {
  test('CTE SQL generation produces correct SELECT/FROM/WHERE', () => {
    const cte = {
      name: 'filtered',
      from: { model: 'model_a' },
      select: [
        { name: 'col_a', type: 'dim' as const },
        { name: 'total', type: 'fct' as const, expr: 'SUM(col_b)' },
      ],
      where: { and: [{ expr: 'col_a > 0' }] },
    };

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte as any],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte: cte as any,
      cteRegistry: registry,
      project,
    });

    expect(sql).toMatch(/select\s+col_a,\s*SUM\(col_b\) as total/);
    expect(sql).toContain("from {{ ref('model_a') }}");
    expect(sql).toContain('where col_a > 0');
  });

  test('CTE SQL generation for CTE-to-CTE reference', () => {
    const cte = {
      name: 'aggregated',
      from: { cte: 'filtered' },
      select: [{ name: 'col_a', type: 'dim' as const }],
    };

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte as any],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte: cte as any,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('select col_a');
    expect(sql).toContain('from filtered');
    expect(sql).not.toContain("ref('");
  });

  test('CTE SQL generation for UNION between CTEs', () => {
    const ctes = [
      {
        name: 'aws_raw',
        from: { model: 'model_a' },
        select: [{ name: 'cost', type: 'fct' as const }],
      },
      {
        name: 'gcp_raw',
        from: { model: 'model_a' },
        select: [{ name: 'cost', type: 'fct' as const }],
      },
      {
        name: 'combined',
        from: {
          cte: 'aws_raw',
          union: { type: 'all' as const, ctes: ['gcp_raw'] },
        },
      },
    ];

    const registry = frameworkBuildCteColumnRegistry({
      ctes: ctes as any,
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte: ctes[2] as any,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('select * from aws_raw');
    expect(sql).toContain('union all');
    expect(sql).toContain('select * from gcp_raw');
  });

  test('CTE SQL generation with CTE-to-CTE join uses bare name (no ref)', () => {
    const cteA: FrameworkCTE = {
      name: 'base_data',
      from: { model: 'model_a' },
      select: ['col_a', 'col_b'],
    } as any;
    const cteB: FrameworkCTE = {
      name: 'lookup',
      from: { model: 'model_b' },
      select: ['col_b', 'col_c'],
    } as any;
    const cteJoined: FrameworkCTE = {
      name: 'joined',
      from: {
        cte: 'base_data',
        join: [{ cte: 'lookup', on: { and: ['col_b'] }, type: 'left' }],
      },
      select: ['col_a', 'col_c'],
    } as any;

    const registry: Map<string, any[]> = new Map();
    registry.set('base_data', [
      { name: 'col_a', meta: { type: 'dim' } },
      { name: 'col_b', meta: { type: 'dim' } },
    ]);
    registry.set('lookup', [
      { name: 'col_b', meta: { type: 'dim' } },
      { name: 'col_c', meta: { type: 'dim' } },
    ]);

    const sql = frameworkGenerateCteSql({
      cte: cteJoined,
      project,
      cteRegistry: registry,
    });
    expect(sql).toContain('from base_data');
    expect(sql).toContain('left join lookup');
    expect(sql).toContain('base_data.col_b=lookup.col_b');
    expect(sql).not.toContain("ref('base_data')");
    expect(sql).not.toContain("ref('lookup')");
  });

  test('CTE-to-CTE join with subquery in ON clause', () => {
    const cteBase: FrameworkCTE = {
      name: 'base_data',
      from: { model: 'model_a' },
      select: ['col_a', 'col_b'],
    } as any;
    const cteLookup: FrameworkCTE = {
      name: 'lookup',
      from: { model: 'model_a' },
      select: ['col_b'],
    } as any;
    const cteJoined: FrameworkCTE = {
      name: 'joined',
      from: {
        cte: 'base_data',
        join: [
          {
            cte: 'lookup',
            on: {
              and: [
                'col_b',
                {
                  subquery: {
                    operator: 'in',
                    column: 'col_a',
                    select: ['col_a'],
                    from: { cte: 'base_data' },
                    where: "col_b = 'active'",
                  },
                },
              ],
            },
            type: 'left',
          },
        ],
      },
      select: ['col_a', 'col_b'],
    } as any;

    const registry: Map<string, any[]> = new Map();
    registry.set('base_data', [
      { name: 'col_a', meta: { type: 'dim' } },
      { name: 'col_b', meta: { type: 'dim' } },
    ]);
    registry.set('lookup', [{ name: 'col_b', meta: { type: 'dim' } }]);

    const sql = frameworkGenerateCteSql({
      cte: cteJoined,
      project,
      cteRegistry: registry,
    });

    expect(sql).toContain('from base_data');
    expect(sql).toContain('left join lookup');
    expect(sql).toContain('base_data.col_b=lookup.col_b');
    expect(sql).toContain(
      "col_a IN (SELECT col_a FROM base_data WHERE col_b = 'active')",
    );
    expect(sql).not.toContain("ref('base_data')");
    expect(sql).not.toContain("ref('lookup')");
  });

  test('model with CTEs generates SQL with WITH clause prepended', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'cte',
      name: 'result',
      ctes: [
        {
          name: 'filtered',
          from: { model: 'model_a' },
          select: [{ name: 'col_a', type: 'dim' as const }],
        },
      ],
      from: { cte: 'filtered' },
      select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    expect(sql).toContain('filtered AS (');
    expect(sql).toContain("{{ ref('model_a') }}");
    expect(sql).toContain('int__test__cte__result AS (');
    expect(sql).toContain('filtered');
  });

  test('main model from.cte + join[{ cte }] generates correct SQL', () => {
    const joinProject = createTestProject({
      nodes: {
        ['model.project.model_x']: {
          columns: {
            key: {
              name: 'key',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            val: {
              name: 'val',
              data_type: 'bigint',
              meta: { type: 'fct' },
            },
          },
        },
        ['model.project.model_y']: {
          columns: {
            key: {
              name: 'key',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            info: {
              name: 'info',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
    });

    const modelJson: FrameworkModel = {
      type: 'mart_join_models',
      group: 'test',
      topic: 'cte',
      name: 'main_cte_join',
      ctes: [
        {
          name: 'cte_base',
          from: { model: 'model_x' },
          select: ['key', 'val'],
        },
        {
          name: 'cte_ref',
          from: { model: 'model_y' },
          select: ['key', 'info'],
        },
      ],
      from: {
        cte: 'cte_base',
        join: [{ cte: 'cte_ref', on: { and: ['key'] }, type: 'left' }],
      },
      select: [
        { type: 'all_from_cte', cte: 'cte_base' },
        { cte: 'cte_ref', name: 'info' },
      ],
    } as any;

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project: joinProject,
    });

    expect(result.sql.toUpperCase()).toContain('LEFT JOIN CTE_REF');
    expect(result.sql).toContain('cte_base.key = cte_ref.key');
    expect(result.sql).not.toContain("ref('cte_base')");
    expect(result.sql).not.toContain("ref('cte_ref')");
  });
});
