import { describe, expect, test } from '@jest/globals';
import { frameworkBuildColumns } from '@services/framework/utils';
import type { FrameworkModel } from '@shared/framework/types';

import { createTestDJ, createTestProject } from './helpers';

/**
 * Verifies that the main-model `exclude_datetime` flag strips the auto-injected
 * `datetime` column without affecting partition columns. The flag is orthogonal
 * to `exclude_portal_partition_columns`; users wanting a pure-dim / lookup
 * model set both flags.
 *
 * The flag's interaction with `from.rollup` is enforced as a validation error
 * in ValidationService (see ValidationService.test.ts), so this file focuses
 * on the column-output behavior on non-rollup model shapes.
 */

function projectWithDatetimeAndPartitions() {
  return createTestProject({
    nodes: {
      ['model.project.stg_events']: {
        columns: {
          region: {
            name: 'region',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          tenant_name: {
            name: 'tenant_name',
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
            meta: { type: 'dim', interval: 'hour' },
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
          portal_partition_hourly: {
            name: 'portal_partition_hourly',
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

describe('main-model exclude_datetime', () => {
  test('strips datetime from auto-injected output but keeps partition columns', () => {
    const project = projectWithDatetimeAndPartitions();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'enriched',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
      exclude_datetime: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).toContain('portal_partition_monthly');
    expect(names).toContain('portal_partition_daily');
    expect(names).toContain('portal_partition_hourly');
  });

  test('combined with exclude_portal_partition_columns produces a pure-dim shape', () => {
    const project = projectWithDatetimeAndPartitions();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'lookup',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'tenant_name', type: 'dim' },
      ],
      exclude_datetime: true,
      exclude_portal_partition_columns: true,
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).not.toContain('datetime');
    expect(names).not.toContain('portal_partition_monthly');
    expect(names).not.toContain('portal_partition_daily');
    expect(names).not.toContain('portal_partition_hourly');
  });

  test('default (flag absent) injects datetime as before', () => {
    const project = projectWithDatetimeAndPartitions();
    const modelJson: FrameworkModel = {
      type: 'int_select_model',
      group: 'analytics',
      topic: 'events',
      name: 'enriched',
      from: { model: 'stg_events' },
      select: [
        { name: 'region', type: 'dim' },
        { name: 'amount', type: 'fct', agg: 'sum' },
      ],
    } as any;

    const { columns } = frameworkBuildColumns({
      dj: createTestDJ(),
      modelJson,
      project,
    });
    const names = columns.map((c) => c.name);

    expect(names).toContain('datetime');
    expect(names).toContain('portal_partition_monthly');
  });
});
