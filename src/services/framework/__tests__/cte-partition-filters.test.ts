import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
  frameworkGenerateModelOutput,
} from '@services/framework/utils';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Project with upstream models that have portal_partition columns, which is
 * the trigger for frameworkBuildFilters to emit _ext_event_date_filter macros.
 */
const partitionedProject = createTestProject({
  nodes: {
    ['model.project.partitioned_model']: {
      columns: {
        col_a: {
          name: 'col_a',
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
    ['model.project.partitioned_model_b']: {
      columns: {
        col_b: {
          name: 'col_b',
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
  },
});

const dj = createTestDJ();

const intModelJson: FrameworkModel = {
  type: 'int_select_model',
  group: 'test',
  topic: 'partition',
  name: 'result',
  from: { model: 'partitioned_model' },
  select: [{ name: 'col_a', type: 'dim' }],
} as any;

const martModelJson: FrameworkModel = {
  type: 'mart_select_model',
  group: 'test',
  topic: 'partition',
  name: 'mart_result',
  from: { model: 'partitioned_model' },
  select: [{ name: 'col_a', type: 'dim' }],
} as any;

describe('CTE Partition Filters', () => {
  describe('CTE from.model (single)', () => {
    test('adds partition filters when CTE reads from a partitioned model', () => {
      const cte: FrameworkCTE = {
        name: 'filtered',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).toContain('_ext_event_date_filter');
      expect(sql).toContain('portal_partition_monthly');
      expect(sql).toContain('portal_partition_daily');
    });

    test('combines framework filters with user WHERE using AND', () => {
      const cte: FrameworkCTE = {
        name: 'filtered',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        where: { and: [{ expr: 'col_a > 0' }] },
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).toContain('_ext_event_date_filter');
      expect(sql).toContain('col_a > 0');
      expect(sql).toMatch(
        /where \(.*_ext_event_date_filter.*\) and \(.*col_a > 0.*\)/s,
      );
    });
  });

  describe('CTE from.model with join', () => {
    test('adds partition filters with prefix when CTE has joins', () => {
      const cte: FrameworkCTE = {
        name: 'joined',
        from: {
          model: 'partitioned_model',
          join: [
            {
              model: 'partitioned_model_b',
              on: { and: ['portal_partition_daily'] },
              type: 'left',
            },
          ],
        },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).toContain('_ext_event_date_filter');
      expect(sql).toContain('partitioned_model.portal_partition_monthly');
      expect(sql).toContain('partitioned_model.portal_partition_daily');
    });
  });

  describe('CTE UNION with models', () => {
    test('adds per-branch partition filters for model-based UNION', () => {
      const cte: FrameworkCTE = {
        name: 'combined',
        from: {
          model: 'partitioned_model',
          union: { type: 'all', models: ['partitioned_model_b'] },
        },
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).toContain("ref('partitioned_model')");
      expect(sql).toContain("ref('partitioned_model_b')");
      expect(sql).toContain('union all');
      const branches = sql.split('union all');
      for (const branch of branches) {
        expect(branch).toContain('_ext_event_date_filter');
      }
    });
  });

  describe('CTE from.cte (no filters)', () => {
    test('does NOT add partition filters for CTE-to-CTE reference', () => {
      const cte: FrameworkCTE = {
        name: 'aggregated',
        from: { cte: 'filtered' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).not.toContain('_ext_event_date_filter');
      expect(sql).toContain('from filtered');
    });

    test('does NOT add partition filters for CTE-to-CTE UNION', () => {
      const cte: FrameworkCTE = {
        name: 'combined',
        from: {
          cte: 'filtered_a',
          union: { type: 'all', ctes: ['filtered_b'] },
        },
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).not.toContain('_ext_event_date_filter');
      expect(sql).toContain('from filtered_a');
      expect(sql).toContain('from filtered_b');
    });
  });

  describe('Mart layer (no filters)', () => {
    test('does NOT add partition filters when parent model is a mart', () => {
      const cte: FrameworkCTE = {
        name: 'filtered',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: martModelJson,
        project: partitionedProject,
      });

      expect(sql).not.toContain('_ext_event_date_filter');
    });
  });

  describe('CTE-level exclude_date_filter', () => {
    test('CTE exclude_date_filter=true suppresses partition filters', () => {
      const cte: FrameworkCTE = {
        name: 'filtered',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        exclude_date_filter: true,
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).not.toContain('_ext_event_date_filter');
    });

    test('model-level exclude_date_filter=true also suppresses CTE filters', () => {
      const excludeModelJson: FrameworkModel = {
        ...intModelJson,
        exclude_date_filter: true,
      } as any;

      const cte: FrameworkCTE = {
        name: 'filtered',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: excludeModelJson,
        project: partitionedProject,
      });

      expect(sql).not.toContain('_ext_event_date_filter');
    });

    test('CTE exclude_date_filter only affects that CTE, not siblings', () => {
      const cteExcluded: FrameworkCTE = {
        name: 'no_filter',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        exclude_date_filter: true,
      } as any;

      const cteFiltered: FrameworkCTE = {
        name: 'with_filter',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cteExcluded, cteFiltered],
        project: partitionedProject,
      });

      const sqlExcluded = frameworkGenerateCteSql({
        cte: cteExcluded,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      const sqlFiltered = frameworkGenerateCteSql({
        cte: cteFiltered,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sqlExcluded).not.toContain('_ext_event_date_filter');
      expect(sqlFiltered).toContain('_ext_event_date_filter');
    });
  });

  // CTE-level `exclude_daily_filter` and `include_full_month` mirror the
  // main-model flags with the same names. Both suppress just the daily-grain
  // _ext_event_date_filter while leaving the monthly-grain filter in place.
  // CTE values take precedence over model values via `??` in
  // `frameworkBuildFilters`.
  describe('CTE-level exclude_daily_filter / include_full_month', () => {
    test('CTE exclude_daily_filter=true drops daily filter, keeps monthly', () => {
      const cte: FrameworkCTE = {
        name: 'no_daily',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        exclude_daily_filter: true,
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      // Monthly filter still emitted with `interval="month"`; daily filter
      // (no interval arg) is suppressed.
      expect(sql).toMatch(/_ext_event_date_filter\([^)]*interval="month"/);
      expect(sql).not.toMatch(
        /_ext_event_date_filter\("portal_partition_daily"[^)]*\)/,
      );
    });

    test('CTE include_full_month=true drops daily filter, keeps monthly', () => {
      const cte: FrameworkCTE = {
        name: 'full_month',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        include_full_month: true,
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: intModelJson,
        project: partitionedProject,
      });

      expect(sql).toMatch(/_ext_event_date_filter\([^)]*interval="month"/);
      expect(sql).not.toMatch(
        /_ext_event_date_filter\("portal_partition_daily"[^)]*\)/,
      );
    });

    test('CTE flag overrides the model-level value', () => {
      // Model says exclude daily; CTE explicitly opts back in (`false`).
      const modelOptOut: FrameworkModel = {
        ...intModelJson,
        exclude_daily_filter: true,
      } as any;
      const cte: FrameworkCTE = {
        name: 'opt_back_in',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
        exclude_daily_filter: false,
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: modelOptOut,
        project: partitionedProject,
      });

      // Daily filter should appear because the CTE override (`false`) wins
      // over the model-level `true`.
      expect(sql).toMatch(
        /_ext_event_date_filter\("portal_partition_daily"[^)]*\)/,
      );
    });

    test('omitting CTE override falls through to model-level value', () => {
      const modelOptOut: FrameworkModel = {
        ...intModelJson,
        exclude_daily_filter: true,
      } as any;
      const cte: FrameworkCTE = {
        name: 'inherits',
        from: { model: 'partitioned_model' },
        select: [{ name: 'col_a', type: 'dim' as const }],
      } as any;

      const registry = frameworkBuildCteColumnRegistry({
        ctes: [cte],
        project: partitionedProject,
      });

      const sql = frameworkGenerateCteSql({
        cte,
        cteRegistry: registry,
        datetimeInterval: null,
        dj,
        modelJson: modelOptOut,
        project: partitionedProject,
      });

      // No CTE override -> falls through to model value (true) -> no daily.
      expect(sql).not.toMatch(
        /_ext_event_date_filter\("portal_partition_daily"[^)]*\)/,
      );
    });
  });

  describe('Full model integration', () => {
    test('model with CTEs generates partition filters in CTE SQL', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'partition',
        name: 'integrated',
        ctes: [
          {
            name: 'filtered',
            from: { model: 'partitioned_model' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
        ],
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      expect(sql).toContain('filtered AS (');
      const ctePart = sql.split('int__test__partition__integrated')[0];
      expect(ctePart).toContain('_ext_event_date_filter');
      expect(ctePart).toContain('portal_partition_monthly');
      expect(ctePart).toContain('portal_partition_daily');
    });
  });

  describe('Main model from.cte filter propagation', () => {
    test('main model from.cte gets partition filters via root resolution', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'partition',
        name: 'propagated',
        ctes: [
          {
            name: 'filtered',
            from: { model: 'partitioned_model' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
        ],
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      const mainModelPart =
        sql.split('int__test__partition__propagated AS (')[1] || '';
      expect(mainModelPart).toContain('_ext_event_date_filter');
      expect(mainModelPart).toContain('portal_partition_monthly');
      expect(mainModelPart).toContain('portal_partition_daily');
    });

    test('main model from.cte+join gets prefixed partition filters', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'partition',
        name: 'cte_join',
        ctes: [
          {
            name: 'cte_base',
            from: { model: 'partitioned_model' },
            select: [
              { name: 'col_a', type: 'dim' as const },
              { name: 'portal_partition_daily', type: 'dim' as const },
              { name: 'portal_partition_monthly', type: 'dim' as const },
            ],
          },
          {
            name: 'cte_ref',
            from: { model: 'partitioned_model_b' },
            select: [{ name: 'col_b', type: 'dim' as const }],
          },
        ],
        from: {
          cte: 'cte_base',
          join: [{ cte: 'cte_ref', on: { and: ['col_a'] }, type: 'left' }],
        },
        select: [{ type: 'all_from_cte' as any, cte: 'cte_base' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      const mainModelPart =
        sql.split('int__test__partition__cte_join AS (')[1] || '';
      expect(mainModelPart).toContain('_ext_event_date_filter');
      expect(mainModelPart).toContain('cte_base.portal_partition_monthly');
      expect(mainModelPart).toContain('cte_base.portal_partition_daily');
    });

    test('CTE chain resolution: from.cte -> cte -> model gets filters on main', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'partition',
        name: 'chained',
        ctes: [
          {
            name: 'step_one',
            from: { model: 'partitioned_model' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
          {
            name: 'step_two',
            from: { cte: 'step_one' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
        ],
        from: { cte: 'step_two' },
        select: [{ type: 'all_from_cte' as any, cte: 'step_two' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      const mainModelPart =
        sql.split('int__test__partition__chained AS (')[1] || '';
      expect(mainModelPart).toContain('_ext_event_date_filter');
      expect(mainModelPart).toContain('portal_partition_monthly');
    });

    test('model-level exclude_date_filter suppresses main model from.cte filters', () => {
      const modelJson: FrameworkModel = {
        type: 'int_select_model',
        group: 'test',
        topic: 'partition',
        name: 'excluded',
        exclude_date_filter: true,
        ctes: [
          {
            name: 'filtered',
            from: { model: 'partitioned_model' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
        ],
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      const mainModelPart =
        sql.split('int__test__partition__excluded AS (')[1] || '';
      expect(mainModelPart).not.toContain('_ext_event_date_filter');
    });

    test('mart layer from.cte does NOT get partition filters on main model', () => {
      const modelJson: FrameworkModel = {
        type: 'mart_select_model',
        group: 'test',
        topic: 'partition',
        name: 'mart_cte',
        ctes: [
          {
            name: 'filtered',
            from: { model: 'partitioned_model' },
            select: [{ name: 'col_a', type: 'dim' as const }],
          },
        ],
        from: { cte: 'filtered' },
        select: [{ type: 'all_from_cte' as any, cte: 'filtered' }],
      } as any;

      const { sql } = frameworkGenerateModelOutput({
        dj,
        modelJson,
        project: partitionedProject,
      });

      const mainModelPart =
        sql.split('mart__test__partition__mart_cte AS (')[1] || '';
      expect(mainModelPart).not.toContain('_ext_event_date_filter');
    });
  });
});
