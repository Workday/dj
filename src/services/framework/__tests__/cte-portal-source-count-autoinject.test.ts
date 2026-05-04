import { describe, expect, test } from '@jest/globals';
import {
  frameworkBuildCteColumnRegistry,
  frameworkGenerateCteSql,
} from '@services/framework/utils';
import type { FrameworkCTE } from '@shared/framework/types';

import { createTestProject } from './helpers';

/**
 * Verifies the Gap 3 fix: a CTE whose `from` is a plain model reference must
 * pick up `portal_source_count` automatically if the upstream model has it
 * and the CTE did not already declare it. This mirrors the main-model
 * `portal_source_count` auto-injection (see `frameworkModelColumns`
 * L746-763) so that downstream `all_from_cte` / `dims_from_cte` passthroughs
 * never silently drop the audit column.
 *
 * The registry (`frameworkInferCteColumns`) and the SQL emitter
 * (`frameworkGenerateCteSql`) both go through
 * `frameworkShouldAutoInjectCtePortalSourceCount`, so this file asserts both
 * sides stay in lock-step.
 */

function projectWithPortalSourceCount() {
  return createTestProject({
    nodes: {
      ['model.project.stg_events']: {
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

describe('CTE portal_source_count auto-injection (Gap 3)', () => {
  test('registry injects portal_source_count when CTE aggregates and does not declare it', () => {
    const project = projectWithPortalSourceCount();
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
    const cols = registry.get('pre_agg')!;
    const names = cols.map((c) => c.name);

    // Suffix-collision rule applies: name ends in `_count`, `agg: count`
    // keeps the bare name rather than `portal_source_count_count`.
    expect(names).toContain('portal_source_count');
    const psc = cols.find((c) => c.name === 'portal_source_count')!;
    expect(psc.meta.type).toBe('fct');
    // Upstream dimension block flows through the merge, so Lightdash can
    // still expose the audit column on the downstream model's YAML.
    expect(psc.meta.dimension?.label).toBe('Portal Source Count');
    expect(psc.meta.dimension?.hidden).toBe(true);
  });

  test('registry passes portal_source_count through when CTE has no group_by', () => {
    const project = projectWithPortalSourceCount();
    const cte: FrameworkCTE = {
      name: 'passthrough',
      from: { model: 'stg_events' },
      select: [{ name: 'region', type: 'dim' }],
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const cols = registry.get('passthrough')!;
    const psc = cols.find((c) => c.name === 'portal_source_count');
    expect(psc).toBeDefined();
    // No aggregation applied -> no `agg` meta on the injected column.
    expect(psc?.meta.agg).toBeUndefined();
  });

  test('registry does NOT inject when user already declared portal_source_count under its default name', () => {
    const project = projectWithPortalSourceCount();
    const cte: FrameworkCTE = {
      name: 'pre_agg',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        // User declares the default-name variant explicitly (collision-rule
        // keeps the bare name) -- framework must respect this and not layer
        // a second auto-injected copy on top.
        { name: 'portal_source_count', type: 'fct', agg: 'count' },
      ],
      group_by: 'dims',
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [cte],
      project,
    });
    const cols = registry.get('pre_agg')!;
    const pscCount = cols.filter(
      (c) => c.name === 'portal_source_count',
    ).length;
    expect(pscCount).toBe(1);
  });

  test('registry does NOT inject for union CTEs', () => {
    const project = createTestProject({
      nodes: {
        ['model.project.stg_a']: {
          columns: {
            region: { name: 'region', meta: { type: 'dim' } },
            portal_source_count: {
              name: 'portal_source_count',
              meta: { type: 'fct' },
            },
          },
        },
        ['model.project.stg_b']: {
          columns: {
            region: { name: 'region', meta: { type: 'dim' } },
            portal_source_count: {
              name: 'portal_source_count',
              meta: { type: 'fct' },
            },
          },
        },
      },
    });

    const leftCte: FrameworkCTE = {
      name: 'a',
      from: { model: 'stg_a' },
      select: ['region', 'portal_source_count'],
    } as any;
    const rightCte: FrameworkCTE = {
      name: 'b',
      from: { model: 'stg_b' },
      select: ['region', 'portal_source_count'],
    } as any;
    const unionCte: FrameworkCTE = {
      name: 'combined',
      from: { cte: 'a', union: { type: 'all', ctes: ['b'] } },
    } as any;

    const registry = frameworkBuildCteColumnRegistry({
      ctes: [leftCte, rightCte, unionCte],
      project,
    });
    // Union CTE has no `from.model` -> guard trips, nothing injected.
    // `a` and `b` already declared the column so they don't re-inject either.
    const combined = registry.get('combined')!;
    expect(
      combined.filter((c) => c.name === 'portal_source_count'),
    ).toHaveLength(1);
  });

  // SQL assertion for the distinctive sum-kernel-after-collision rule. This
  // isn't a generic "registry drives SQL" test -- it's locking in the
  // intentional `count(portal_source_count) -> sum(portal_source_count)`
  // rewrite that keeps the bare name instead of collapsing to
  // `portal_source_count_count`. The registry tests above already cover the
  // no-agg passthrough branch on the SQL side indirectly (SQL emitter is
  // driven by the registry).
  test('SQL emitter injects portal_source_count in aggregating CTE (sum-kernel after collision)', () => {
    const project = projectWithPortalSourceCount();
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
    const sql = frameworkGenerateCteSql({
      cte,
      cteRegistry: registry,
      project,
    });

    expect(sql).toContain('sum(portal_source_count) as portal_source_count');
    expect(sql).not.toMatch(/portal_source_count_count/);
  });
});
