import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
  frameworkGenerateModelOutput,
} from '@services/framework/utils';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';
import { Ajv } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';

import { createTestDJ, createTestProject } from './helpers';

describe('CTE aggregation SQL', () => {
  const project = createTestProject({
    nodes: {
      ['model.project.src_events']: {
        columns: {
          user_id: {
            name: 'user_id',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
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
          duration_ms: {
            name: 'duration_ms',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          latency_ms: {
            name: 'latency_ms',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
        },
      },
    },
  });

  test('agg: "hll" in CTE uses cast(approx_set(...) as varbinary)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'user_id', type: 'fct', agg: 'hll' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain(
      'cast(approx_set(user_id) as varbinary) as user_id_hll',
    );
    expect(sql).not.toMatch(/\bhll\(/);
  });

  test('agg: "tdigest" in CTE uses cast(tdigest_agg(...) as varbinary)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'latency_ms', type: 'fct', agg: 'tdigest' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain(
      'cast(tdigest_agg(latency_ms) as varbinary) as latency_ms_tdigest',
    );
    expect(sql).not.toMatch(/\btdigest\(/);
  });

  test('agg: "count" in CTE uses count(...)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'user_id', type: 'fct', agg: 'count' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('count(user_id) as user_id_count');
  });

  test('agg: "sum" in CTE uses sum(...) (default branch unchanged)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('sum(amount) as amount_sum');
  });

  test('aggs: ["sum", "hll"] in CTE emits both agg forms correctly', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'user_id', type: 'fct', aggs: ['sum', 'hll'] },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('sum(user_id) as user_id_sum');
    expect(sql).toContain(
      'cast(approx_set(user_id) as varbinary) as user_id_hll',
    );
  });

  test('agg: "hll" with expr wraps the expression in approx_set', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'active_user',
          type: 'fct',
          expr: 'case when amount > 0 then user_id end',
          agg: 'hll',
        },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain(
      'cast(approx_set(case when amount > 0 then user_id end) as varbinary) as active_user_hll',
    );
  });
});

describe('CTE expr leak regression', () => {
  const project = createTestProject({
    nodes: {
      ['model.project.src_stats']: {
        columns: {
          region: {
            name: 'region',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          thread_cpu_time: {
            name: 'thread_cpu_time',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          thread_memory_allocation: {
            name: 'thread_memory_allocation',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          amount: {
            name: 'amount',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          user_id: {
            name: 'user_id',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
        },
      },
    },
  });

  test('int_select_model re-aggregating a derived *_sum column does not re-apply the CTE expr', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'expr_leak',
      name: 'gb_hours_rollup',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'src_stats' },
          select: [
            { name: 'region', type: 'dim' },
            {
              name: 'thread_gb_hours',
              type: 'fct',
              expr: 'thread_cpu_time * thread_memory_allocation / 1000',
              agg: 'sum',
            },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { name: 'thread_gb_hours_sum', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const lower = sql.toLowerCase();

    expect(lower).toContain(
      'sum(thread_cpu_time * thread_memory_allocation / 1000) as thread_gb_hours_sum',
    );
    expect(lower).toContain('sum(thread_gb_hours_sum) as thread_gb_hours_sum');
    const rawExprOccurrences = (
      lower.match(/thread_cpu_time \* thread_memory_allocation/g) || []
    ).length;
    expect(rawExprOccurrences).toBe(1);
  });

  test('int_select_model re-aggregating a *_hll column uses merge(cast(... as hyperloglog))', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'expr_leak',
      name: 'hll_rollup',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'src_stats' },
          select: [
            { name: 'region', type: 'dim' },
            { name: 'user_id', type: 'fct', agg: 'hll' },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { name: 'user_id_hll', type: 'fct', agg: 'hll' },
      ],
      group_by: 'dims',
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    // Collapse whitespace and tighten parentheses (sqlFormat may wrap the
    // nested cast across lines and add padding inside cast(...)).
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')');
    const normalized = normalize(sql);

    expect(normalized).toContain(
      normalize('cast(approx_set(user_id) as varbinary) as user_id_hll'),
    );
    expect(normalized).toContain(
      normalize(
        'cast(merge(cast(user_id_hll as hyperloglog)) as varbinary) as user_id_hll',
      ),
    );
  });

  test('mart_select_model re-aggregating a *_sum column from a CTE does not leak the CTE expr', () => {
    const modelJson: FrameworkModel = {
      type: 'mart_select_model',
      group: 'test',
      topic: 'expr_leak',
      name: 'gb_hours_rollup_mart',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'src_stats' },
          select: [
            { name: 'region', type: 'dim' },
            {
              name: 'thread_gb_hours',
              type: 'fct',
              expr: 'thread_cpu_time * thread_memory_allocation / 1000',
              agg: 'sum',
            },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { name: 'thread_gb_hours_sum', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const lower = sql.toLowerCase();

    expect(lower).toContain('sum(thread_gb_hours_sum) as thread_gb_hours_sum');
    const rawExprOccurrences = (
      lower.match(/thread_cpu_time \* thread_memory_allocation/g) || []
    ).length;
    expect(rawExprOccurrences).toBe(1);
  });

  test('CTE column with only expr (no agg) still exposes its expr to downstream consumers', () => {
    // Negative/safety test: the leak-fix only clears meta.expr when agg/aggs
    // is applied. A plain expression column must keep its expr so downstream
    // references render correctly.
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'expr_leak',
      name: 'plain_expr_passthrough',
      ctes: [
        {
          name: 'enriched',
          from: { model: 'src_stats' },
          select: [
            { name: 'region', type: 'dim' },
            {
              name: 'double_amount',
              type: 'fct',
              expr: 'amount * 2',
            },
          ],
        },
      ],
      from: { cte: 'enriched' },
      select: [{ cte: 'enriched', type: 'all_from_cte' }],
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const lower = sql.toLowerCase();

    expect(lower).toContain('amount * 2 as double_amount');
    expect(lower).toMatch(/double_amount/);
  });
});

describe('CTE datetime + interval parity with main-model', () => {
  const project = createTestProject({
    nodes: {
      ['model.project.src_events_hourly']: {
        columns: {
          datetime: {
            name: 'datetime',
            data_type: 'timestamp',
            meta: { type: 'dim', interval: 'hour' },
          },
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
        },
      },
      ['model.project.src_events_raw']: {
        columns: {
          datetime: {
            name: 'datetime',
            data_type: 'timestamp',
            meta: { type: 'dim' },
          },
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
        },
      },
    },
  });

  test('{name:"datetime", interval:"hour"} in a CTE emits date_trunc when upstream is raw', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events_raw' },
      select: [
        { name: 'datetime', interval: 'hour', type: 'dim' },
        { name: 'region', type: 'dim' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain("date_trunc('hour', datetime) as datetime");
    const dtCol = registry.get('pre_agg')!.find((c) => c.name === 'datetime')!;
    expect(dtCol.meta.interval).toBe('hour');
    expect(dtCol.meta.dimension?.time_intervals).toEqual([
      'DAY',
      'DAY_OF_WEEK_NAME',
      'HOUR',
      'MONTH',
      'WEEK',
      'YEAR',
    ]);
  });

  test('{name:"datetime", interval:"hour"} emits bare datetime when upstream is already hourly', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events_hourly' },
      select: [
        { name: 'datetime', interval: 'hour', type: 'dim' },
        { name: 'region', type: 'dim' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).not.toMatch(/date_trunc/);
    expect(sql).toMatch(/select\s+datetime\b/);
  });

  test('CTE group_by: "dims" emits date_trunc(...) (not bare alias) for datetime+interval', () => {
    // Trino resolves GROUP BY identifiers against input columns, not SELECT
    // aliases (trino#16533). Emitting the bare alias `datetime` would group
    // at the raw upstream granularity; the group_by must emit the truncation
    // expression to match the SELECT alias.
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events_raw' },
      select: [
        { name: 'datetime', interval: 'hour', type: 'dim' },
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toMatch(
      /group by[^;]*date_trunc\('hour',\s*datetime\)[^;]*region/i,
    );
    // The bare `datetime` identifier must NOT appear standalone in group by.
    expect(sql).not.toMatch(/group by\s+datetime\b/i);
    expect(sql).not.toMatch(/group by[^;]*,\s*datetime\s*(,|$)/i);
  });

  test('CTE group_by: "dims" emits meta.expr for derived dim columns (coalesce, CASE)', () => {
    // Any dim column with a derived expression (coalesce, CASE, arithmetic,
    // etc.) must appear in GROUP BY as its expression, not its alias, for
    // the same Trino alias-shadowing reason.
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_events_raw' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'region_label',
          type: 'dim',
          expr: "coalesce(region, 'unknown')",
        },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toMatch(/group by[^;]*coalesce\(region,\s*'unknown'\)/i);
    // The alias `region_label` must NOT leak into GROUP BY.
    expect(sql).not.toMatch(/group by[^;]*\bregion_label\b/i);
  });

  test('downstream int_select_model inherits meta.interval from CTE via dims_from_cte', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'dt_parity',
      name: 'events_hourly',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'src_events_raw' },
          select: [
            { name: 'datetime', interval: 'hour', type: 'dim' },
            { name: 'region', type: 'dim' },
            { name: 'amount', type: 'fct', agg: 'sum' },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { name: 'amount_sum', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const { sql } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const lower = sql.toLowerCase();
    // Exactly TWO date_trunc occurrences, both inside the CTE: one in the
    // SELECT list (`date_trunc('hour', datetime) as datetime`) and one in
    // the GROUP BY (so Trino groups by the truncated expression, not the
    // raw alias-shadowed input column -- see trino#16533). Downstream must
    // emit bare datetime because its upstream (the CTE) is already hourly.
    const truncOccurrences = (lower.match(/date_trunc\(/g) || []).length;
    expect(truncOccurrences).toBe(2);
  });
});

describe('CTE aggregation suffix-collision parity with main-model', () => {
  const project = createTestProject({
    nodes: {
      ['model.project.src_counts']: {
        columns: {
          region: {
            name: 'region',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          portal_source_count: {
            name: 'portal_source_count',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          full_gc_count_sum: {
            name: 'full_gc_count_sum',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          system_user_id_hll: {
            name: 'system_user_id_hll',
            data_type: 'varbinary',
            meta: { type: 'fct' },
          },
        },
      },
    },
  });

  test('count-over-already-counted column keeps bare name and uses sum kernel', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_counts' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'portal_source_count', type: 'fct', agg: 'count' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('sum(portal_source_count) as portal_source_count');
    expect(sql).not.toMatch(/portal_source_count_count/);
  });

  test('sum-over-already-summed column keeps bare name and uses sum kernel', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_counts' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'full_gc_count_sum', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('sum(full_gc_count_sum) as full_gc_count_sum');
    expect(sql).not.toMatch(/full_gc_count_sum_sum/);
  });

  test('hll-over-already-hll column uses merge(cast(... as hyperloglog)) kernel', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_counts' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'system_user_id_hll', type: 'fct', agg: 'hll' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')');

    expect(normalize(sql)).toContain(
      normalize(
        'cast(merge(cast(system_user_id_hll as hyperloglog)) as varbinary) as system_user_id_hll',
      ),
    );
  });

  test('override_suffix_agg forces fresh count kernel and double-suffix', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_counts' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'portal_source_count',
          type: 'fct',
          agg: 'count',
          override_suffix_agg: true,
        },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain(
      'count(portal_source_count) as portal_source_count_count',
    );
  });
});

describe('CTE scalar-meta forwarding parity with main-model', () => {
  const project = createTestProject({
    nodes: {
      ['model.project.src_meta']: {
        columns: {
          region: {
            name: 'region',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          description_text: {
            name: 'description_text',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          amount: {
            name: 'amount',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
        },
      },
    },
  });

  test('exclude_from_group_by on a CTE dim select excludes it from group_by "dims"', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_meta' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'description_text',
          type: 'dim',
          exclude_from_group_by: true,
        },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toMatch(/group by region\b/);
    expect(sql).not.toMatch(/group by[^;]*description_text/);
    // Registry must carry the flag so downstream `dims_from_cte` doesn't
    // re-pick the column into a group_by either.
    const descCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'description_text')!;
    expect(descCol.meta.exclude_from_group_by).toBe(true);
  });

  test('override_suffix_agg and lightdash.case_sensitive are forwarded to the registered CTE column', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_meta' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'description_text',
          type: 'dim',
          override_suffix_agg: true,
          lightdash: { case_sensitive: true },
        },
      ],
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const descCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'description_text')!;
    expect(descCol.meta.override_suffix_agg).toBe(true);
    expect(descCol.meta.case_sensitive).toBe(true);
  });

  test('scalar meta forwarded onto aggs-generated CTE columns', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'src_meta' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'amount',
          type: 'fct',
          aggs: ['sum', 'hll'],
          lightdash: {
            dimension: { label: 'Amount', hidden: true },
            case_sensitive: false,
          },
        },
      ],
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const cols = registry.get('pre_agg')!;
    const sumCol = cols.find((c) => c.name === 'amount_sum')!;
    const hllCol = cols.find((c) => c.name === 'amount_hll')!;
    expect(sumCol.meta.dimension).toEqual({ label: 'Amount', hidden: true });
    expect(sumCol.meta.case_sensitive).toBe(false);
    expect(hllCol.meta.dimension).toEqual({ label: 'Amount', hidden: true });
    expect(hllCol.meta.case_sensitive).toBe(false);
  });
});

describe('CTE dead-code removal (schema validation)', () => {
  test('bare {interval: "hour"} (no name) fails schema validation', () => {
    const ajv = new Ajv({ allErrors: true, strictSchema: false });
    const schemaDir = path.join(__dirname, '..', '..', '..', '..', 'schemas');
    for (const filename of fs.readdirSync(schemaDir)) {
      if (!filename.endsWith('.json')) {
        continue;
      }
      try {
        const schema = JSON.parse(
          fs.readFileSync(path.join(schemaDir, filename), 'utf8'),
        );
        if (schema.$id) {
          ajv.addSchema(schema);
        }
      } catch {
        // skip malformed fixtures
      }
    }
    const validate = ajv.getSchema('model.cte.schema.json')!;
    const valid = validate({
      name: 'pre_agg',
      from: { model: 'src_events' },
      select: [
        // intentionally missing `name: "datetime"` -- the dead branches we
        // removed used to handle this, but no schema permits it.
        { interval: 'hour' },
      ],
    });
    expect(valid).toBe(false);
  });
});

describe('CTE column sort parity', () => {
  const projectWithPartitions = createTestProject({
    nodes: {
      ['model.project.wide_src']: {
        columns: {
          zeta: { name: 'zeta', data_type: 'varchar', meta: { type: 'dim' } },
          alpha: { name: 'alpha', data_type: 'varchar', meta: { type: 'dim' } },
          mid_fct: {
            name: 'mid_fct',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
          portal_partition_daily: {
            name: 'portal_partition_daily',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          portal_partition_monthly: {
            name: 'portal_partition_monthly',
            data_type: 'date',
            meta: { type: 'dim' },
          },
          beta: { name: 'beta', data_type: 'varchar', meta: { type: 'dim' } },
        },
      },
    },
  });

  test('CTE SELECT emits columns alphabetically with partitions last and a "-- partition columns" comment', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'wide_src' },
      select: [
        { name: 'zeta', type: 'dim' },
        { name: 'portal_partition_daily', type: 'dim' },
        { name: 'alpha', type: 'dim' },
        { name: 'mid_fct', type: 'fct' },
        { name: 'portal_partition_monthly', type: 'dim' },
        { name: 'beta', type: 'dim' },
      ],
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project: projectWithPartitions,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project: projectWithPartitions,
    });

    // Alphabetical dims/fct columns first, then a partition-comment marker,
    // then monthly before daily (the convention used by the helper).
    expect(sql).toMatch(
      /select\s+alpha,\s*beta,\s*mid_fct,\s*zeta,\s*--\s*partition columns\s*portal_partition_monthly,\s*portal_partition_daily/,
    );
  });

  test('CTE registry exposes columns in sorted order for downstream dims_from_cte', () => {
    const ctes: FrameworkCTE[] = [
      {
        name: 'src',
        from: { model: 'wide_src' },
        select: [
          { name: 'zeta', type: 'dim' },
          { name: 'portal_partition_daily', type: 'dim' },
          { name: 'alpha', type: 'dim' },
          { name: 'beta', type: 'dim' },
          { name: 'mid_fct', type: 'fct' },
          { name: 'portal_partition_monthly', type: 'dim' },
        ],
      },
      {
        name: 'derived',
        from: { cte: 'src' },
        select: [{ type: 'dims_from_cte', cte: 'src' } as any],
      },
    ] as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes,
      project: projectWithPartitions,
    });

    // Registry for the source CTE is sorted with partitions last.
    const srcNames = registry.get('src')!.map((c: any) => c.name);
    expect(srcNames).toEqual([
      'alpha',
      'beta',
      'mid_fct',
      'zeta',
      'portal_partition_monthly',
      'portal_partition_daily',
    ]);

    // dims_from_cte expansion inherits the sorted order (dims only, partitions
    // are classified as dims here, so they still land at the end).
    const derivedNames = registry.get('derived')!.map((c: any) => c.name);
    expect(derivedNames).toEqual([
      'alpha',
      'beta',
      'zeta',
      'portal_partition_monthly',
      'portal_partition_daily',
    ]);
  });

  test('CTE group_by: "dims" emits dims in sorted order with partitions last', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'wide_src' },
      select: [
        { name: 'zeta', type: 'dim' },
        { name: 'portal_partition_daily', type: 'dim' },
        { name: 'alpha', type: 'dim' },
        { name: 'portal_partition_monthly', type: 'dim' },
        { name: 'beta', type: 'dim' },
        { name: 'mid_fct', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project: projectWithPartitions,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project: projectWithPartitions,
    });

    // group by lists dims alphabetically then partition columns (monthly,
    // daily). The fct column mid_fct is excluded from group by.
    expect(sql).toMatch(
      /group\s+by\s+alpha,\s*beta,\s*zeta,\s*portal_partition_monthly,\s*portal_partition_daily/i,
    );
    expect(sql).not.toMatch(/group\s+by[^;]*\bmid_fct\b/i);
  });

  test('CTE SELECT without any partition columns does not emit the partition comment', () => {
    // Use an upstream model that has no partition columns so the framework
    // datetime + partition auto-injection (main-model parity) has nothing to
    // add. This isolates the partition-comment suppression behavior from the
    // auto-injection covered in `cte-framework-dims-autoinject.test.ts`.
    const projectNoPartitions = createTestProject({
      nodes: {
        ['model.project.narrow_src']: {
          columns: {
            alpha: {
              name: 'alpha',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            beta: {
              name: 'beta',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
            zeta: {
              name: 'zeta',
              data_type: 'varchar',
              meta: { type: 'dim' },
            },
          },
        },
      },
    });

    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'narrow_src' },
      select: [
        { name: 'zeta', type: 'dim' },
        { name: 'alpha', type: 'dim' },
        { name: 'beta', type: 'dim' },
      ],
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project: projectNoPartitions,
    });
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project: projectNoPartitions,
    });

    expect(sql).not.toContain('-- partition columns');
    expect(sql).toMatch(/select\s+alpha,\s*beta,\s*zeta/);
  });
});

describe('CTE named-select metadata inheritance', () => {
  // Upstream source with richly annotated columns -- mirrors a realistic
  // staging-model manifest where data_type, description, and meta.dimension.*
  // fields are populated. CTE named-selects should carry these through to the
  // CTE registry (and, transitively, to downstream main-model YAML) instead of
  // dropping them and falling back to `data_type: varchar` + title-cased
  // descriptions + missing `dimension.type`.
  const project = createTestProject({
    nodes: {
      ['model.project.stg_events']: {
        columns: {
          datetime: {
            name: 'datetime',
            data_type: 'timestamp(6)',
            description: 'Event Datetime Column',
            meta: {
              type: 'dim',
              dimension: { type: 'timestamp' },
            },
          },
          region: {
            name: 'region',
            data_type: 'varchar',
            description: 'Customer Region',
            meta: {
              type: 'dim',
              dimension: { type: 'string', label: 'Region' },
            },
          },
          amount: {
            name: 'amount',
            data_type: 'bigint',
            description: 'Order Amount',
            meta: { type: 'fct' },
          },
          // Mirrors the framework-auto-synthesized `portal_source_count`
          // audit column: an upstream fct that carries a deliberate
          // `dimension: { label, hidden: true }` block so Lightdash can
          // expose the underlying column as a hidden dimension backing a
          // `sum` metric. Used below to verify this dimension flows through
          // CTE `agg` / `aggs` select items unchanged.
          audit_count: {
            name: 'audit_count',
            data_type: 'bigint',
            description: 'Audit Count',
            meta: {
              type: 'fct',
              dimension: { label: 'Audit Count', hidden: true },
            },
          },
        },
      },
    },
  });

  test('datetime+interval named-select inherits upstream data_type, description, and meta.dimension.type', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'datetime', interval: 'hour', type: 'dim' }],
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const dt = registry.get('pre_agg')!.find((c) => c.name === 'datetime')!;

    expect(dt.data_type).toBe('timestamp(6)');
    expect(dt.description).toBe('Event Datetime Column');
    expect(dt.meta.dimension?.type).toBe('timestamp');
    expect(dt.meta.dimension?.time_intervals).toEqual([
      'DAY',
      'DAY_OF_WEEK_NAME',
      'HOUR',
      'MONTH',
      'WEEK',
      'YEAR',
    ]);
    expect(dt.meta.interval).toBe('hour');
    expect(dt.meta.expr).toBe("date_trunc('hour', datetime)");
  });

  test('generic named-select inherits upstream data_type, description, and full meta.dimension', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const region = registry.get('pre_agg')!.find((c) => c.name === 'region')!;

    expect(region.data_type).toBe('varchar');
    expect(region.description).toBe('Customer Region');
    expect(region.meta.dimension).toEqual({ type: 'string', label: 'Region' });
    expect(region.meta.type).toBe('dim');
  });

  test('agg named-select inherits description from upstream but NOT data_type (kernel-owned)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sumCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'amount_sum')!;

    // Description inherited from upstream `amount` column.
    expect(sumCol.description).toBe('Order Amount');
    // data_type is kernel-determined, not inherited -- the upstream bigint is
    // irrelevant once we sum it (and hll/tdigest would produce varbinary).
    expect(sumCol.data_type).toBeUndefined();
    // Upstream `amount` has no `meta.dimension`, so the output doesn't pick
    // one up either. (See the portal_source_count parity test below for an
    // upstream that DOES carry a dimension -- those flow through by design,
    // matching the main-model `mergeDeep(fromColumn, selectedColumn)` path.)
    expect(sumCol.meta.dimension).toBeUndefined();
    expect(sumCol.meta.agg).toBe('sum');
    expect(sumCol.meta.type).toBe('fct');
  });

  test('aggs named-select with sel-provided dimension preserves sel overrides (kernel still owns data_type)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        {
          name: 'amount',
          type: 'fct',
          aggs: ['sum', 'hll'],
          lightdash: { dimension: { label: 'Amount', hidden: true } },
        },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sumCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'amount_sum')!;
    const hllCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'amount_hll')!;

    // sel-provided dimension flows through mergeDeep onto every aggs-
    // generated output column. Upstream `amount` has no dimension to
    // contribute, so the sel block wins unchanged.
    expect(sumCol.meta.dimension).toEqual({ label: 'Amount', hidden: true });
    expect(hllCol.meta.dimension).toEqual({ label: 'Amount', hidden: true });
    // Description still inherited from upstream on both aggs.
    expect(sumCol.description).toBe('Order Amount');
    expect(hllCol.description).toBe('Order Amount');
    // data_type remains kernel-owned on both.
    expect(sumCol.data_type).toBeUndefined();
    expect(hllCol.data_type).toBeUndefined();
  });

  test('agg named-select inherits auto-synthesized upstream dimension (portal_source_count parity)', () => {
    // Upstream `audit_count` carries `meta.dimension: { label, hidden: true }`
    // exactly like the framework's auto-synthesized `portal_source_count`
    // audit column. A CTE select that aggregates it with `{ agg: "count" }`
    // must preserve that dimension so downstream main-model YAML can still
    // emit the Lightdash `dimension:` block (with `hidden: true`) used to
    // back the `metric_portal_source_count` sum metric.
    //
    // `audit_count` + `agg: count` triggers the suffix-collision rule in
    // `frameworkResolveAgg` (see `cte aggregation suffix-collision keeps bare
    // name` tests in cte-registry.test.ts): the CTE's output column name is
    // kept as `audit_count` (not `audit_count_count`), treating the upstream
    // as pre-counted.
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'audit_count', type: 'fct', agg: 'count' },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const cntCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'audit_count')!;

    // The auto-synthesized dimension survives mergeDeep unchanged.
    expect(cntCol.meta.dimension).toEqual({
      label: 'Audit Count',
      hidden: true,
    });
    // Description inherits; data_type remains kernel-owned.
    expect(cntCol.description).toBe('Audit Count');
    expect(cntCol.data_type).toBeUndefined();
    expect(cntCol.meta.type).toBe('fct');
    expect(cntCol.meta.agg).toBe('count');
  });

  test('aggs named-select inherits auto-synthesized upstream dimension onto every output column', () => {
    // Same portal_source_count-style upstream; verify `aggs: ["sum", "hll"]`
    // preserves the upstream dimension on each generated output (sum + hll).
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'audit_count', type: 'fct', aggs: ['sum', 'hll'] },
      ],
      group_by: 'dims',
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const sumCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'audit_count_sum')!;
    const hllCol = registry
      .get('pre_agg')!
      .find((c) => c.name === 'audit_count_hll')!;
    expect(sumCol.meta.dimension).toEqual({
      label: 'Audit Count',
      hidden: true,
    });
    expect(hllCol.meta.dimension).toEqual({
      label: 'Audit Count',
      hidden: true,
    });
  });

  test('sel-provided data_type, description, and dimension.label override upstream (dimension.type still inherits)', () => {
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        {
          name: 'datetime',
          interval: 'hour',
          type: 'dim',
          data_type: 'timestamp(3)',
          description: 'Custom Hour Bucket',
          lightdash: { dimension: { label: 'Custom Label' } },
        },
      ],
    } as any;
    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const dt = registry.get('pre_agg')!.find((c) => c.name === 'datetime')!;

    // sel scalars win over upstream scalars.
    expect(dt.data_type).toBe('timestamp(3)');
    expect(dt.description).toBe('Custom Hour Bucket');
    // sel.lightdash.dimension.label wins; upstream dimension.type merges
    // through because mergeDeep is a deep merge on meta.dimension.
    expect(dt.meta.dimension?.label).toBe('Custom Label');
    expect(dt.meta.dimension?.type).toBe('timestamp');
    // built time_intervals still come through.
    expect(dt.meta.dimension?.time_intervals).toContain('HOUR');
  });

  test('downstream dims_from_cte carries inherited metadata onto main-model YAML', () => {
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'test',
      topic: 'meta_inh',
      name: 'events_hourly',
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'stg_events' },
          select: [
            { name: 'datetime', interval: 'hour', type: 'dim' },
            { name: 'region', type: 'dim' },
            { name: 'amount', type: 'fct', agg: 'sum' },
            // portal_source_count-style audit column whose upstream carries
            // `dimension: { label, hidden: true }`. The CTE re-aggregates it
            // with `agg: "count"`; the main-model then re-aggregates the
            // CTE's output. The auto-synthesized dimension must survive
            // both hops and surface in the final YAML.
            { name: 'audit_count', type: 'fct', agg: 'count' },
          ],
          group_by: 'dims',
        },
      ],
      from: { cte: 'pre_agg' },
      select: [
        { cte: 'pre_agg', type: 'dims_from_cte' },
        { name: 'amount_sum', type: 'fct', agg: 'sum' },
        // Mirrors the real portal_source_count main-model select: the name
        // matches the CTE's suffix-collision output (`audit_count`), and
        // `agg: count` triggers suffix-collision again in the main model so
        // the output column is also `audit_count`. The upstream dimension
        // must flow through this second hop into the main-model YAML.
        { name: 'audit_count', type: 'fct', agg: 'count' },
      ],
      group_by: 'dims',
    } as any;

    const { yml } = frameworkGenerateModelOutput({
      dj: createTestDJ(),
      modelJson,
      project,
    });

    // `datetime` surfaces with inherited data_type + description + dimension.type.
    expect(yml).toMatch(
      /- name: datetime[\s\S]*?data_type: timestamp\(6\)[\s\S]*?description: Event Datetime Column[\s\S]*?dimension:[\s\S]*?type: timestamp/,
    );
    // `region` surfaces with inherited data_type + description.
    expect(yml).toMatch(
      /- name: region[\s\S]*?data_type: varchar[\s\S]*?description: Customer Region/,
    );
    // No regression to fallback text for these columns.
    expect(yml).not.toMatch(/- name: datetime[\s\S]*?description: Datetime/);
    expect(yml).not.toMatch(/- name: region[\s\S]*?description: Region\b/);
    // The auto-synthesized upstream dimension (`{ label, hidden: true }`)
    // flows through both the CTE agg and the main-model re-agg -- this is
    // the end-to-end portal_source_count parity assertion.
    expect(yml).toMatch(
      /- name: audit_count[\s\S]*?dimension:[\s\S]*?label: Audit Count[\s\S]*?hidden: true/,
    );
  });
});
