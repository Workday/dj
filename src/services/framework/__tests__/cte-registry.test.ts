import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkInferCteColumns,
} from '@services/framework/utils';
import type { FrameworkCTE } from '@shared/framework/types';

import { createTestProject } from './helpers';

const project = createTestProject();

describe('CTE Column Registry', () => {
  test('CTE column registry infers columns from select items', () => {
    const ctes = [
      {
        name: 'filtered',
        from: { model: 'model_a' },
        select: [
          { name: 'col_a', type: 'dim' as const },
          { name: 'total', type: 'fct' as const, expr: 'SUM(col_b)' },
        ],
      },
      {
        name: 'final',
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
      },
    ];

    const registry = frameworkBuildCteColumnRegistry({
      ctes: ctes as any,
      project,
    });

    // `col_a` is a named-select that resolves to an upstream column on
    // `model_a`; its data_type, description, and tags now inherit through
    // (mergeDeep parity with the main-model selected-column builder).
    // `total` has no upstream counterpart -- it's a pure expr column -- so
    // nothing to inherit beyond the selected meta.
    expect(registry.get('filtered')).toEqual([
      {
        name: 'col_a',
        data_type: 'varchar',
        description: undefined,
        tags: [],
        meta: { type: 'dim' },
      },
      { name: 'total', meta: { type: 'fct', expr: 'SUM(col_b)' } },
    ]);

    const finalCols = registry.get('final');
    expect(finalCols?.length).toBe(2);
    expect(finalCols?.[0].name).toBe('col_a');
    expect(finalCols?.[1].name).toBe('total');
  });

  test('CTE column inference includes joined CTE columns', () => {
    const registry: Map<string, any[]> = new Map();
    registry.set('data_cte', [
      { name: 'id', meta: { type: 'dim' } },
      { name: 'value', meta: { type: 'fct' } },
    ]);
    registry.set('lookup_cte', [
      { name: 'id', meta: { type: 'dim' } },
      { name: 'label', meta: { type: 'dim' } },
    ]);

    const cte: FrameworkCTE = {
      name: 'joined',
      from: {
        cte: 'data_cte',
        join: [{ cte: 'lookup_cte', on: { and: ['id'] }, type: 'left' }],
      },
    } as any;

    const columns = frameworkInferCteColumns({
      cte,
      cteRegistry: registry,
      project,
    });
    const colNames = columns.map((c: any) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('value');
    expect(colNames).toContain('label');
  });
});

describe('CTE column type inheritance', () => {
  test('plain string columns inherit types from source model', () => {
    const ctes: any[] = [
      {
        name: 'raw',
        from: { model: 'model_a' },
        select: ['col_a', 'col_b'],
      },
    ];
    const registry = frameworkBuildCteColumnRegistry({ ctes, project });
    const cols = registry.get('raw')!;
    expect(cols[0].name).toBe('col_a');
    expect(cols[0].meta.type).toBe('dim');
    expect(cols[1].name).toBe('col_b');
    expect(cols[1].meta.type).toBe('fct');
    expect(cols[1].data_type).toBe('bigint');
  });

  test('plain string columns inherit types from source CTE', () => {
    const ctes: any[] = [
      {
        name: 'step1',
        from: { model: 'model_a' },
        select: [
          { name: 'col_a', type: 'dim' },
          { name: 'col_b', type: 'fct' },
        ],
      },
      {
        name: 'step2',
        from: { cte: 'step1' },
        select: ['col_a', 'col_b'],
      },
    ];
    const registry = frameworkBuildCteColumnRegistry({ ctes, project });
    const cols = registry.get('step2')!;
    // step1's named-selects now inherit upstream (model_a) data_type,
    // description, and tags; step2's plain-string selects spread those
    // columns verbatim, so the inherited fields flow through.
    expect(cols).toEqual([
      {
        name: 'col_a',
        data_type: 'varchar',
        description: undefined,
        tags: [],
        meta: { type: 'dim' },
      },
      {
        name: 'col_b',
        data_type: 'bigint',
        description: undefined,
        tags: [],
        meta: { type: 'fct' },
      },
    ]);
  });

  test('plain string columns from joined sources inherit correct types', () => {
    const joinProject = createTestProject({
      nodes: {
        ['model.project.model_a']: {
          columns: {
            id: { name: 'id', meta: { type: 'dim' } },
            amount: { name: 'amount', meta: { type: 'fct' } },
          },
        },
        ['model.project.model_b']: {
          columns: {
            id: { name: 'id', meta: { type: 'dim' } },
            label: { name: 'label', meta: { type: 'dim' } },
          },
        },
      },
    });

    const ctes: any[] = [
      {
        name: 'joined',
        from: {
          model: 'model_a',
          join: [{ model: 'model_b', on: { and: ['id'] }, type: 'left' }],
        },
        select: ['id', 'amount', 'label'],
      },
    ];
    const registry = frameworkBuildCteColumnRegistry({
      ctes,
      project: joinProject,
    });
    const cols = registry.get('joined')!;
    expect(cols.find((c: any) => c.name === 'amount')?.meta.type).toBe('fct');
    expect(cols.find((c: any) => c.name === 'label')?.meta.type).toBe('dim');
  });

  test('unknown columns default to dim when not found in source', () => {
    const ctes: any[] = [
      {
        name: 'raw',
        from: { model: 'model_a' },
        select: ['col_a', 'unknown_col'],
      },
    ];
    const registry = frameworkBuildCteColumnRegistry({ ctes, project });
    const cols = registry.get('raw')!;
    expect(cols.find((c: any) => c.name === 'unknown_col')?.meta.type).toBe(
      'dim',
    );
  });
});
