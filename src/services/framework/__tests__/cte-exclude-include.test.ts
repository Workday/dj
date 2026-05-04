import { describe, expect, test } from '@jest/globals';
import {
  expandBulkSelectColumns,
  frameworkBuildColumns,
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
  frameworkGenerateModelOutput,
  frameworkInferCteColumns,
  sortColumnsWithPartitionsLast,
} from '@services/framework/utils';

import { createTestDJ, createTestProject } from './helpers';

const project = createTestProject();

describe('CTE exclude/include support', () => {
  const baseCtes: any[] = [
    {
      name: 'source_cte',
      from: { model: 'model_a' },
      select: [
        { name: 'dim_a', type: 'dim' },
        { name: 'dim_b', type: 'dim' },
        { name: 'dim_c', type: 'dim' },
        { name: 'fct_x', type: 'fct' },
        { name: 'fct_y', type: 'fct' },
      ],
    },
  ];

  function buildRegistryForBaseCtes() {
    return frameworkBuildCteColumnRegistry({
      ctes: baseCtes,
      project,
    });
  }

  describe('expandBulkSelectColumns helper', () => {
    test('returns null when no exclude/include (backward compat)', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: { type: 'all_from_cte', cte: 'source_cte' },
        cteRegistry: registry,
        project,
        hasJoins: false,
      });
      expect(result).toBeNull();
    });

    test('returns filtered columns with exclude', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_cte',
          cte: 'source_cte',
          exclude: ['dim_b', 'fct_x'],
        },
        cteRegistry: registry,
        project,
        hasJoins: false,
      });
      expect(result).toEqual(['dim_a', 'dim_c', 'fct_y']);
    });

    test('returns whitelisted columns with include', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_cte',
          cte: 'source_cte',
          include: ['dim_a', 'fct_y'],
        },
        cteRegistry: registry,
        project,
        hasJoins: false,
      });
      expect(result).toEqual(['dim_a', 'fct_y']);
    });

    test('dims_from_cte with exclude only returns dim columns minus excluded', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: {
          type: 'dims_from_cte',
          cte: 'source_cte',
          exclude: ['dim_b'],
        },
        cteRegistry: registry,
        project,
        hasJoins: false,
      });
      expect(result).toEqual(['dim_a', 'dim_c']);
    });

    test('fcts_from_cte with include only returns matching fct columns', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: {
          type: 'fcts_from_cte',
          cte: 'source_cte',
          include: ['fct_x'],
        },
        cteRegistry: registry,
        project,
        hasJoins: false,
      });
      expect(result).toEqual(['fct_x']);
    });

    test('prefixes columns with source alias when hasJoins is true', () => {
      const registry = buildRegistryForBaseCtes();
      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_cte',
          cte: 'source_cte',
          exclude: ['dim_b', 'dim_c', 'fct_x', 'fct_y'],
        },
        cteRegistry: registry,
        project,
        hasJoins: true,
      });
      expect(result).toEqual(['source_cte.dim_a']);
    });

    test('all_from_model with exclude reads from manifest', () => {
      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_model',
          model: 'model_a',
          exclude: ['col_b'],
        },
        cteRegistry: new Map(),
        project,
        hasJoins: false,
      });
      expect(result).toEqual(['col_a']);
    });
  });

  describe('CTE SQL generation with exclude/include', () => {
    test('all_from_cte with exclude produces explicit column list', () => {
      const ctes: any[] = [
        ...baseCtes,
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              exclude: ['dim_c', 'fct_y'],
            },
          ],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });
      expect(sql).toContain('dim_a');
      expect(sql).toContain('dim_b');
      expect(sql).toContain('fct_x');
      expect(sql).not.toContain('dim_c');
      expect(sql).not.toContain('fct_y');
      expect(sql).not.toContain('*');
    });

    test('all_from_cte with include produces only whitelisted columns', () => {
      const ctes: any[] = [
        ...baseCtes,
        {
          name: 'derived',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              include: ['dim_a', 'fct_x'],
            },
          ],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });
      expect(sql).toContain('dim_a');
      expect(sql).toContain('fct_x');
      expect(sql).not.toContain('dim_b');
      expect(sql).not.toContain('dim_c');
      expect(sql).not.toContain('fct_y');
      expect(sql).not.toContain('*');
    });

    test('bulk directive without exclude/include still produces *', () => {
      const ctes: any[] = [
        ...baseCtes,
        {
          name: 'passthrough',
          from: { cte: 'source_cte' },
          select: [{ type: 'all_from_cte', cte: 'source_cte' }],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });
      expect(sql).toContain('select *');
    });

    test('all_from_cte exclude with additional named columns', () => {
      const ctes: any[] = [
        ...baseCtes,
        {
          name: 'backfill',
          from: { cte: 'source_cte' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'source_cte',
              exclude: ['dim_c', 'fct_y'],
            },
            {
              name: 'dim_c',
              type: 'dim',
              expr: "CAST('2026-03-08' as date)",
            },
          ],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });
      expect(sql).toMatch(
        /dim_a,\s*dim_b,\s*CAST\('2026-03-08' as date\) as dim_c,\s*fct_x/,
      );
      expect(sql).not.toContain('*');
    });

    test('all_from_model exclude inside CTE expands correctly', () => {
      const ctes: any[] = [
        {
          name: 'from_model',
          from: { model: 'model_a' },
          select: [
            {
              type: 'all_from_model',
              model: 'model_a',
              exclude: ['col_b'],
            },
          ],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[0],
        cteRegistry: registry,
        project,
      });
      expect(sql).toContain('select col_a');
      expect(sql).not.toContain('col_b');
      expect(sql).not.toContain('*');
    });
  });

  describe('CTE column inference with exclude/include', () => {
    test('frameworkInferCteColumns applies exclude', () => {
      const registry = buildRegistryForBaseCtes();
      const cte: any = {
        name: 'derived',
        from: { cte: 'source_cte' },
        select: [
          {
            type: 'all_from_cte',
            cte: 'source_cte',
            exclude: ['dim_b', 'fct_y'],
          },
        ],
      };
      const cols = frameworkInferCteColumns({
        cte,
        cteRegistry: registry,
        project,
      });
      const names = cols.map((c: any) => c.name);
      expect(names).toEqual(['dim_a', 'dim_c', 'fct_x']);
    });

    test('frameworkInferCteColumns applies include', () => {
      const registry = buildRegistryForBaseCtes();
      const cte: any = {
        name: 'derived',
        from: { cte: 'source_cte' },
        select: [
          {
            type: 'all_from_cte',
            cte: 'source_cte',
            include: ['dim_a'],
          },
        ],
      };
      const cols = frameworkInferCteColumns({
        cte,
        cteRegistry: registry,
        project,
      });
      expect(cols.map((c: any) => c.name)).toEqual(['dim_a']);
    });
  });

  describe('Main model select with all_from_cte exclude/include', () => {
    test('frameworkBuildColumns applies exclude from CTE', () => {
      const modelJson: any = {
        group: 'test',
        topic: 'test',
        name: 'test_exclude',
        type: 'int_select_model',
        ctes: baseCtes,
        from: { cte: 'source_cte' },
        select: [
          {
            type: 'all_from_cte',
            cte: 'source_cte',
            exclude: ['dim_c', 'fct_y'],
          },
        ],
      };
      const cteColumnRegistry = frameworkBuildCteColumnRegistry({
        ctes: modelJson.ctes,
        project,
      });
      const { columns } = frameworkBuildColumns({
        dj: createTestDJ(),
        modelJson,
        project,
        cteColumnRegistry,
      });
      const names = columns.map((c: any) => c.name);
      expect(names).toContain('dim_a');
      expect(names).toContain('dim_b');
      expect(names).toContain('fct_x');
      expect(names).not.toContain('dim_c');
      expect(names).not.toContain('fct_y');
    });

    test('frameworkBuildColumns applies include from CTE', () => {
      const modelJson: any = {
        group: 'test',
        topic: 'test',
        name: 'test_include',
        type: 'int_select_model',
        ctes: baseCtes,
        from: { cte: 'source_cte' },
        select: [
          {
            type: 'all_from_cte',
            cte: 'source_cte',
            include: ['dim_a', 'fct_x'],
          },
        ],
      };
      const cteColumnRegistry = frameworkBuildCteColumnRegistry({
        ctes: modelJson.ctes,
        project,
      });
      const { columns } = frameworkBuildColumns({
        dj: createTestDJ(),
        modelJson,
        project,
        cteColumnRegistry,
      });
      const names = columns.map((c: any) => c.name);
      expect(names).toEqual(['dim_a', 'fct_x']);
    });
  });

  describe('dims/fcts filtering with plain-string CTE selects', () => {
    test('dims_from_cte excludes fct columns inherited from model', () => {
      const ctes: any[] = [
        {
          name: 'raw',
          from: { model: 'model_a' },
          select: ['col_a', 'col_b'],
        },
        {
          name: 'dims_only',
          from: { cte: 'raw' },
          select: [{ type: 'dims_from_cte', cte: 'raw' }],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const cols = registry.get('dims_only')!;
      expect(cols.map((c: any) => c.name)).toEqual(['col_a']);
    });

    test('fcts_from_cte only includes fct columns inherited from model', () => {
      const ctes: any[] = [
        {
          name: 'raw',
          from: { model: 'model_a' },
          select: ['col_a', 'col_b'],
        },
        {
          name: 'fcts_only',
          from: { cte: 'raw' },
          select: [{ type: 'fcts_from_cte', cte: 'raw' }],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const cols = registry.get('fcts_only')!;
      expect(cols.map((c: any) => c.name)).toEqual(['col_b']);
    });

    test('dims_from_cte with include on fct column yields empty', () => {
      const ctes: any[] = [
        {
          name: 'raw',
          from: { model: 'model_a' },
          select: ['col_a', 'col_b'],
        },
        {
          name: 'filtered',
          from: { cte: 'raw' },
          select: [{ type: 'dims_from_cte', cte: 'raw', include: ['col_b'] }],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const cols = registry.get('filtered')!;
      expect(cols).toEqual([]);
    });

    test('dims_from_cte with exclude generates correct SQL from inherited types', () => {
      const ctes: any[] = [
        {
          name: 'raw',
          from: { model: 'model_a' },
          select: ['col_a', 'col_b'],
        },
        {
          name: 'dims_only',
          from: { cte: 'raw' },
          select: [{ type: 'dims_from_cte', cte: 'raw', exclude: ['col_b'] }],
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({ ctes, project });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project,
      });
      expect(sql).toContain('col_a');
      expect(sql).not.toContain('col_b');
    });
  });

  describe('End-to-end model output with CTE exclude/include', () => {
    test('full model output generates correct SQL with CTE exclude', () => {
      const modelJson: any = {
        group: 'test',
        topic: 'test',
        name: 'e2e_exclude',
        type: 'int_select_model',
        ctes: [
          {
            name: 'raw_data',
            from: { model: 'model_a' },
            select: [
              { name: 'col_a', type: 'dim' },
              { name: 'col_b', type: 'fct' },
              { name: 'extra', type: 'dim', expr: "'fixed'" },
            ],
          },
          {
            name: 'filtered',
            from: { cte: 'raw_data' },
            select: [
              {
                type: 'all_from_cte',
                cte: 'raw_data',
                exclude: ['col_b'],
              },
            ],
          },
        ],
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte', cte: 'filtered' }],
      };

      const result = frameworkGenerateModelOutput({
        dj: createTestDJ(),
        modelJson,
        project,
      });

      expect(result.sql).toContain('filtered AS (');
      expect(result.sql).toMatch(
        /filtered\s+as\s*\(\s*select\s+col_a,\s*extra/i,
      );
      expect(result.sql).not.toMatch(/filtered\s+as\s*\(\s*select\s+\*/i);
    });
  });
});

// ========================================================================
// Column ordering tests
// ========================================================================

describe('sortColumnsWithPartitionsLast utility', () => {
  test('sorts columns alphabetically', () => {
    const cols = [{ name: 'col_z' }, { name: 'col_a' }, { name: 'col_m' }];
    const sorted = sortColumnsWithPartitionsLast(cols);
    expect(sorted.map((c) => c.name)).toEqual(['col_a', 'col_m', 'col_z']);
  });

  test('moves default partition columns to the end in monthly/daily/hourly order', () => {
    const cols = [
      { name: 'col_b' },
      { name: 'portal_partition_daily' },
      { name: 'col_c' },
      { name: 'portal_partition_monthly' },
      { name: 'col_a' },
    ];
    const sorted = sortColumnsWithPartitionsLast(cols);
    expect(sorted.map((c) => c.name)).toEqual([
      'col_a',
      'col_b',
      'col_c',
      'portal_partition_monthly',
      'portal_partition_daily',
    ]);
  });

  test('moves custom partition columns to the end', () => {
    const cols = [
      { name: 'col_z' },
      { name: 'custom_part' },
      { name: 'col_a' },
    ];
    const sorted = sortColumnsWithPartitionsLast(cols, ['custom_part']);
    expect(sorted.map((c) => c.name)).toEqual([
      'col_a',
      'col_z',
      'custom_part',
    ]);
  });

  test('preserves extra properties on column objects', () => {
    const cols = [
      { name: 'col_b', meta: { type: 'fct' } },
      { name: 'col_a', meta: { type: 'dim' } },
    ];
    const sorted = sortColumnsWithPartitionsLast(cols);
    expect(sorted).toEqual([
      { name: 'col_a', meta: { type: 'dim' } },
      { name: 'col_b', meta: { type: 'fct' } },
    ]);
  });

  test('returns empty array for empty input', () => {
    expect(sortColumnsWithPartitionsLast([])).toEqual([]);
  });
});

describe('CTE bulk select column ordering', () => {
  const projectWithPartitions = createTestProject({
    nodes: {
      ['model.project.wide_model']: {
        columns: {
          col_z: { name: 'col_z', data_type: 'varchar', meta: { type: 'dim' } },
          portal_partition_daily: {
            name: 'portal_partition_daily',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          col_a: { name: 'col_a', data_type: 'varchar', meta: { type: 'dim' } },
          portal_partition_monthly: {
            name: 'portal_partition_monthly',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          col_m_fct: {
            name: 'col_m_fct',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          col_b: { name: 'col_b', data_type: 'varchar', meta: { type: 'dim' } },
        },
      },
    },
  });

  describe('expandBulkSelectColumns ordering', () => {
    test('expanded columns are sorted alphabetically with partitions at end (monthly/daily order)', () => {
      const ctes: any[] = [
        {
          name: 'src',
          from: { model: 'wide_model' },
        },
      ];
      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });

      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_cte',
          cte: 'src',
          exclude: ['col_z'],
        },
        cteRegistry: registry,
        project: projectWithPartitions,
        hasJoins: false,
      });

      expect(result).toEqual([
        'col_a',
        'col_b',
        'col_m_fct',
        'portal_partition_monthly',
        'portal_partition_daily',
      ]);
    });

    test('all_from_model exclude produces sorted columns with partitions last', () => {
      const result = expandBulkSelectColumns({
        sel: {
          type: 'all_from_model',
          model: 'wide_model',
          exclude: ['col_m_fct'],
        },
        cteRegistry: new Map(),
        project: projectWithPartitions,
        hasJoins: false,
      });

      expect(result).toEqual([
        'col_a',
        'col_b',
        'col_z',
        'portal_partition_monthly',
        'portal_partition_daily',
      ]);
    });
  });

  describe('CTE registry ordering', () => {
    test('all_from_cte with exclude stores sorted columns in registry (monthly/daily order)', () => {
      const ctes: any[] = [
        {
          name: 'src',
          from: { model: 'wide_model' },
          select: [
            { name: 'col_z', type: 'dim' },
            { name: 'portal_partition_daily', type: 'dim' },
            { name: 'col_a', type: 'dim' },
            { name: 'col_m_fct', type: 'fct' },
            { name: 'col_b', type: 'dim' },
            { name: 'portal_partition_monthly', type: 'dim' },
          ],
        },
        {
          name: 'filtered',
          from: { cte: 'src' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'src',
              exclude: ['col_z'],
            },
          ],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });

      const names = registry.get('filtered')!.map((c: any) => c.name);
      expect(names).toEqual([
        'col_a',
        'col_b',
        'col_m_fct',
        'portal_partition_monthly',
        'portal_partition_daily',
      ]);
    });

    test('all_from_cte without exclude/include sorts columns with partitions last', () => {
      const ctes: any[] = [
        {
          name: 'src',
          from: { model: 'wide_model' },
          select: [
            { name: 'col_z', type: 'dim' },
            { name: 'portal_partition_daily', type: 'dim' },
            { name: 'col_a', type: 'dim' },
          ],
        },
        {
          name: 'passthrough',
          from: { cte: 'src' },
          select: [{ type: 'all_from_cte', cte: 'src' }],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });

      // `src` auto-inherits `portal_partition_monthly` from the upstream
      // `wide_model` (mirrors the main-model datetime + partition injection),
      // so the passthrough CTE now carries both partitions -- monthly/daily
      // in canonical order, dims sorted alphabetically before them.
      const names = registry.get('passthrough')!.map((c: any) => c.name);
      expect(names).toEqual([
        'col_a',
        'col_z',
        'portal_partition_monthly',
        'portal_partition_daily',
      ]);
    });

    test('all_from_model bulk select in CTE stores sorted columns (monthly/daily order)', () => {
      const ctes: any[] = [
        {
          name: 'from_model',
          from: { model: 'wide_model' },
          select: [
            {
              type: 'all_from_model',
              model: 'wide_model',
              exclude: ['col_m_fct'],
            },
          ],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });

      const names = registry.get('from_model')!.map((c: any) => c.name);
      expect(names).toEqual([
        'col_a',
        'col_b',
        'col_z',
        'portal_partition_monthly',
        'portal_partition_daily',
      ]);
    });
  });

  describe('CTE SQL generation ordering', () => {
    test('generated CTE SQL has columns in sorted order with partitions last', () => {
      const ctes: any[] = [
        {
          name: 'src',
          from: { model: 'wide_model' },
          select: [
            { name: 'col_z', type: 'dim' },
            { name: 'portal_partition_daily', type: 'dim' },
            { name: 'col_a', type: 'dim' },
            { name: 'col_m_fct', type: 'fct' },
            { name: 'col_b', type: 'dim' },
            { name: 'portal_partition_monthly', type: 'dim' },
          ],
        },
        {
          name: 'derived',
          from: { cte: 'src' },
          select: [
            {
              type: 'all_from_cte',
              cte: 'src',
              exclude: ['col_z'],
            },
          ],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });
      const sql = frameworkGenerateCteSql({
        cte: ctes[1],
        cteRegistry: registry,
        project: projectWithPartitions,
      });

      expect(sql).toMatch(
        /select\s+col_a,\s*col_b,\s*col_m_fct,\s*--\s*partition columns\s*portal_partition_monthly,\s*portal_partition_daily/,
      );
    });
  });

  describe('CTE union column consistency', () => {
    test('CTE union branches use same sorted column list', () => {
      const ctes: any[] = [
        {
          name: 'branch_a',
          from: { model: 'wide_model' },
          select: [
            { name: 'col_z', type: 'dim' },
            { name: 'col_a', type: 'dim' },
            { name: 'portal_partition_daily', type: 'dim' },
          ],
        },
        {
          name: 'branch_b',
          from: { model: 'wide_model' },
          select: [
            { name: 'col_z', type: 'dim' },
            { name: 'col_a', type: 'dim' },
            { name: 'portal_partition_daily', type: 'dim' },
          ],
        },
        {
          name: 'combined',
          from: {
            cte: 'branch_a',
            union: { ctes: ['branch_b'] },
          },
          select: [
            {
              type: 'all_from_cte',
              cte: 'branch_a',
              exclude: ['col_z'],
            },
          ],
        },
      ];

      const registry = frameworkBuildCteColumnRegistry({
        ctes,
        project: projectWithPartitions,
      });
      const sql = frameworkGenerateCteSql({
        cte: ctes[2],
        cteRegistry: registry,
        project: projectWithPartitions,
      });

      const branches = sql.split('union all');
      expect(branches).toHaveLength(2);

      const colPattern = /select\s+(.+)\s+from/;
      const branch1Cols = branches[0].match(colPattern)?.[1]?.trim();
      const branch2Cols = branches[1].match(colPattern)?.[1]?.trim();
      expect(branch1Cols).toBe(branch2Cols);
      // Both branches auto-inherit `portal_partition_monthly` from the
      // upstream `wide_model` (mirrors main-model datetime + partition
      // injection); `col_z` is excluded by the union's `all_from_cte`.
      expect(branch1Cols).toBe(
        'col_a, portal_partition_monthly, portal_partition_daily',
      );
    });
  });
});
