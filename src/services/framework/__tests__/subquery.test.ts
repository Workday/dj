import { describe, expect, test } from '@jest/globals';
import {
  buildConditionsSql,
  buildSubquerySql,
  frameworkGenerateModelOutput,
} from '@services/framework/utils';
import { validateSubqueries } from '@services/modelValidation';
import type { FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

const project = createTestProject({
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
  },
});

describe('buildConditionsSql - group recursion', () => {
  test('string input is returned as-is', () => {
    expect(buildConditionsSql('col_a > 0')).toBe('col_a > 0');
  });

  test('flat AND conditions', () => {
    expect(
      buildConditionsSql({
        and: [{ expr: 'col_a > 0' }, { expr: "col_b = 'x'" }],
      }),
    ).toBe("col_a > 0 and col_b = 'x'");
  });

  test('flat OR conditions', () => {
    expect(
      buildConditionsSql({
        or: [{ expr: 'col_a > 0' }, { expr: "col_b = 'x'" }],
      }),
    ).toBe("col_a > 0 or col_b = 'x'");
  });

  test('AND with nested OR group', () => {
    expect(
      buildConditionsSql({
        and: [
          { expr: 'col_a > 0' },
          {
            group: {
              or: [{ expr: "col_b = 'x'" }, { expr: "col_c = 'y'" }],
            },
          },
        ],
      }),
    ).toBe("col_a > 0 and (col_b = 'x' or col_c = 'y')");
  });

  test('OR with nested AND group', () => {
    expect(
      buildConditionsSql({
        or: [
          { expr: 'col_a > 0' },
          {
            group: {
              and: [{ expr: "col_b = 'x'" }, { expr: "col_c = 'y'" }],
            },
          },
        ],
      }),
    ).toBe("col_a > 0 or (col_b = 'x' and col_c = 'y')");
  });

  test('mixed AND and OR at the same level', () => {
    expect(
      buildConditionsSql({
        and: [{ expr: 'a = 1' }],
        or: [{ expr: 'b = 2' }, { expr: 'c = 3' }],
      }),
    ).toBe('a = 1 and (b = 2 or c = 3)');
  });

  test('deeply nested groups', () => {
    expect(
      buildConditionsSql({
        and: [
          { expr: 'top_level = 1' },
          {
            group: {
              or: [
                { expr: 'mid_a = 1' },
                {
                  group: {
                    and: [{ expr: 'deep_x = 1' }, { expr: 'deep_y = 1' }],
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toBe('top_level = 1 and (mid_a = 1 or (deep_x = 1 and deep_y = 1))');
  });

  test('empty conditions return empty string', () => {
    expect(buildConditionsSql({ and: [] })).toBe('');
    expect(buildConditionsSql({ or: [] })).toBe('');
    expect(buildConditionsSql({})).toBe('');
  });

  test('items with neither expr nor group are skipped', () => {
    expect(buildConditionsSql({ and: [{ expr: 'col_a > 0' }, {}] })).toBe(
      'col_a > 0',
    );
  });
});

describe('buildSubquerySql', () => {
  test('IN subquery with model ref', () => {
    expect(
      buildSubquerySql({
        operator: 'in',
        column: 'account_id',
        select: ['account_project_id'],
        from: { model: 'access_control_bridge' },
      }),
    ).toBe(
      "account_id IN (SELECT account_project_id FROM {{ ref('access_control_bridge') }})",
    );
  });

  test('IN subquery with CTE and WHERE', () => {
    expect(
      buildSubquerySql({
        operator: 'in',
        column: 'account_id',
        select: ['account_project_id'],
        from: { cte: 'access_control_bridge' },
        where: "login_user = REPLACE('user@example.com', '@example.com')",
      }),
    ).toBe(
      "account_id IN (SELECT account_project_id FROM access_control_bridge WHERE login_user = REPLACE('user@example.com', '@example.com'))",
    );
  });

  test('NOT IN subquery', () => {
    expect(
      buildSubquerySql({
        operator: 'not_in',
        column: 'id',
        select: ['excluded_id'],
        from: { cte: 'excluded_list' },
      }),
    ).toBe('id NOT IN (SELECT excluded_id FROM excluded_list)');
  });

  test('EXISTS subquery', () => {
    expect(
      buildSubquerySql({
        operator: 'exists',
        select: ['1'],
        from: { model: 'related_table' },
        where: 'related_table.id = main_table.id',
      }),
    ).toBe(
      "EXISTS (SELECT 1 FROM {{ ref('related_table') }} WHERE related_table.id = main_table.id)",
    );
  });

  test('NOT EXISTS subquery', () => {
    expect(
      buildSubquerySql({
        operator: 'not_exists',
        select: ['1'],
        from: { cte: 'excluded_records' },
      }),
    ).toBe('NOT EXISTS (SELECT 1 FROM excluded_records)');
  });

  test('scalar comparison subquery (eq)', () => {
    expect(
      buildSubquerySql({
        operator: 'eq',
        column: 'max_date',
        select: ['MAX(created_at)'],
        from: { model: 'events' },
      }),
    ).toBe("max_date = (SELECT MAX(created_at) FROM {{ ref('events') }})");
  });

  test('source ref in subquery', () => {
    expect(
      buildSubquerySql({
        operator: 'in',
        column: 'id',
        select: ['id'],
        from: { source: 'raw_data.users' },
      }),
    ).toBe("id IN (SELECT id FROM {{ source('raw_data','users') }})");
  });

  test('multiple select columns', () => {
    expect(
      buildSubquerySql({
        operator: 'in',
        column: 'id',
        select: ['col_a', 'col_b'],
        from: { cte: 'cte_a' },
      }),
    ).toBe('id IN (SELECT col_a, col_b FROM cte_a)');
  });
});

describe('Subquery integration', () => {
  test('WHERE with IN subquery generates correct SQL', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'subquery',
      name: 'with_subquery_where',
      from: { model: 'model_a' },
      select: [{ type: 'dims_from_model', model: 'model_a' }],
      where: {
        and: [
          {
            subquery: {
              operator: 'in',
              column: 'dim_a',
              select: ['dim_a'],
              from: { model: 'model_b' },
            },
          },
        ],
      },
    };

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const normalized = result.sql.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      "dim_a IN ( SELECT dim_a FROM {{ ref('model_b') }} )",
    );
  });

  test('JOIN ON with subquery generates correct SQL', () => {
    const modelJson: FrameworkModel = {
      type: 'int_join_models',
      group: 'test',
      topic: 'subquery',
      name: 'join_with_subquery_on',
      from: {
        model: 'model_a',
        join: [
          {
            model: 'model_b',
            on: {
              and: [
                'dim_a',
                {
                  subquery: {
                    operator: 'in',
                    column: 'dim_b',
                    select: ['dim_b'],
                    from: { model: 'model_b' },
                  },
                },
              ],
            },
          },
        ],
      },
      select: [
        { type: 'dims_from_model', model: 'model_a' },
        { type: 'dims_from_model', model: 'model_b' },
      ],
    };

    const result = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    const normalized = result.sql.replace(/\s+/g, ' ');
    expect(normalized).toContain('dim_a');
    expect(normalized).toContain(
      "dim_b IN ( SELECT dim_b FROM {{ ref('model_b') }} )",
    );
  });

  test('buildConditionsSql with subquery in AND', () => {
    expect(
      buildConditionsSql({
        and: [
          { expr: 'col_a > 0' },
          {
            subquery: {
              operator: 'in',
              column: 'col_b',
              select: ['id'],
              from: { model: 'ref_table' },
            },
          },
        ],
      }),
    ).toBe("col_a > 0 and col_b IN (SELECT id FROM {{ ref('ref_table') }})");
  });
});

describe('validateSubqueries', () => {
  test('exists with column present returns error', () => {
    const errors = validateSubqueries({
      where: {
        and: [
          {
            subquery: {
              operator: 'exists',
              column: 'task_id',
              select: ['1'],
              from: { model: 'other_model' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"column" is not applicable');
    expect(errors[0]).toContain('"exists"');
  });

  test('not_exists with column present returns error', () => {
    const errors = validateSubqueries({
      where: {
        or: [
          {
            subquery: {
              operator: 'not_exists',
              column: 'id',
              select: ['1'],
              from: { cte: 'my_cte' },
            },
          },
        ],
      },
      ctes: [{ name: 'my_cte' }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"not_exists"');
  });

  test('exists without column returns no error', () => {
    const errors = validateSubqueries({
      where: {
        and: [
          {
            subquery: {
              operator: 'exists',
              select: ['1'],
              from: { model: 'other_model' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(0);
  });

  test('in with column returns no error', () => {
    const errors = validateSubqueries({
      where: {
        and: [
          {
            subquery: {
              operator: 'in',
              column: 'id',
              select: ['id'],
              from: { model: 'ref_table' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(0);
  });

  test('subquery referencing undefined CTE returns error', () => {
    const errors = validateSubqueries({
      ctes: [{ name: 'valid_cte' }],
      where: {
        and: [
          {
            subquery: {
              operator: 'in',
              column: 'id',
              select: ['id'],
              from: { cte: 'nonexistent_cte' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"nonexistent_cte"');
    expect(errors[0]).toContain('not defined');
  });

  test('subquery referencing valid CTE returns no error', () => {
    const errors = validateSubqueries({
      ctes: [{ name: 'my_cte' }],
      where: {
        and: [
          {
            subquery: {
              operator: 'in',
              column: 'id',
              select: ['id'],
              from: { cte: 'my_cte' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(0);
  });

  test('having subquery with exists and column returns error', () => {
    const errors = validateSubqueries({
      having: {
        and: [
          {
            subquery: {
              operator: 'exists',
              column: 'x',
              select: ['1'],
              from: { model: 'm' },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('having.and[0].subquery');
  });

  test('join ON subquery with exists and column returns error', () => {
    const errors = validateSubqueries({
      from: {
        model: 'base',
        join: [
          {
            model: 'other',
            on: {
              and: [
                {
                  subquery: {
                    operator: 'exists',
                    column: 'id',
                    select: ['1'],
                    from: { model: 'ref' },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('from.join[0].on.and[0].subquery');
  });

  test('CTE-level where subquery validation', () => {
    const errors = validateSubqueries({
      ctes: [
        {
          name: 'cte_a',
          where: {
            and: [
              {
                subquery: {
                  operator: 'not_exists',
                  column: 'bad',
                  select: ['1'],
                  from: { model: 'm' },
                },
              },
            ],
          },
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ctes[0].where.and[0].subquery');
  });

  test('nested subquery inside subquery where returns error with correct path', () => {
    const errors = validateSubqueries({
      where: {
        and: [
          {
            subquery: {
              operator: 'in',
              column: 'id',
              select: ['id'],
              from: { model: 'outer_model' },
              where: {
                and: [
                  {
                    subquery: {
                      operator: 'exists',
                      column: 'should_not_be_here',
                      select: ['1'],
                      from: { model: 'inner_model' },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('where.and[0].subquery.where.and[0].subquery');
    expect(errors[0]).toContain('"exists"');
  });

  test('model with no subqueries returns no errors', () => {
    const errors = validateSubqueries({
      type: 'int_select_model',
      from: { model: 'some_model' },
      select: ['col_a'],
      where: { and: [{ expr: 'col_a > 0' }] },
    });
    expect(errors).toHaveLength(0);
  });

  test('model with no where/having/join returns no errors', () => {
    const errors = validateSubqueries({
      type: 'stg_select_source',
      from: { source: 'raw.table' },
      select: ['col_a'],
    });
    expect(errors).toHaveLength(0);
  });
});
