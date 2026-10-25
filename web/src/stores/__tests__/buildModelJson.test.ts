import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  DEFAULT_INCREMENTAL_PRE_HOOK,
  DEFAULT_INCREMENTAL_STRATEGY,
} from '@shared/framework/constants';

jest.mock('../../utils/stateSync', () => ({
  stateSync: {
    onMessage: () => () => {},
    sendMessage: () => {},
    sendApiRequest: () => Promise.resolve(undefined),
    registerHandler: () => {},
  },
}));

let uuidCounter = 0;
jest.mock('uuid', () => ({
  v4: () => {
    uuidCounter += 1;
    return `00000000-0000-0000-0000-${uuidCounter.toString(16).padStart(12, '0')}`;
  },
}));

import { useModelStore } from '../useModelStore';

/**
 * Pins the on-disk shape of the model JSON across the load -> save cycle the
 * visual editor uses. Each test exercises one invariant that is otherwise
 * only observable by reopening a saved file: empty-array field omission,
 * bulk select positioning, CTE `include[]` survival, and the documented
 * `group_by` shorthand collapse.
 */
describe('useModelStore round-trip (loadInitialData -> buildModelJson)', () => {
  beforeEach(() => {
    useModelStore.getState().reset();
    // Disable auto-save so the debounced timer cannot reach into the mocked
    // stateSync after the test has finished and produce orphan warnings.
    useModelStore.getState().setAutoSaveEnabled(false);
  });

  test('does not add tags: [] when source had no tags field', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    });

    const out = useModelStore.getState().buildModelJson();
    expect(Object.prototype.hasOwnProperty.call(out, 'tags')).toBe(false);
  });

  test('preserves bulk select position when no UI mutation occurs', () => {
    const onDisk = [
      {
        type: 'dims_from_model',
        model: 'stg__capeng__swh__oms_task_stats',
        exclude: ['internal_only_col'],
      },
      { name: 'task_count', type: 'fct', expr: 'count(*)', agg: 'count' },
    ];

    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      from: { model: 'stg__capeng__swh__oms_task_stats' },
      select: onDisk as never,
    });

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    const select = (out.select ?? []) as Record<string, unknown>[];
    expect(select[0]).toMatchObject({
      type: 'dims_from_model',
      model: 'stg__capeng__swh__oms_task_stats',
      exclude: ['internal_only_col'],
    });
  });

  test('preserves CTE bulk dims_from_model with include[]', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      from: { cte: 'pre_agg' },
      ctes: [
        {
          name: 'pre_agg',
          from: { model: 'stg__capeng__swh__oms_task_stats' },
          select: [
            {
              type: 'dims_from_model',
              model: 'stg__capeng__swh__oms_task_stats',
              include: ['region', 'status'],
            },
            { name: 'task_count', type: 'fct', expr: 'count(*)', agg: 'count' },
          ],
        },
      ],
      select: [
        { type: 'dims_from_cte', cte: 'pre_agg' },
        {
          name: 'task_count_total',
          type: 'fct',
          expr: 'sum(task_count)',
          agg: 'sum',
        },
      ],
    } as never);

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    const ctes = out.ctes as Array<Record<string, unknown>> | undefined;
    expect(ctes).toBeDefined();
    const cteSelect = ctes![0].select as Array<Record<string, unknown>>;
    const bulkInCte = cteSelect.find(
      (it) =>
        typeof it === 'object' &&
        it !== null &&
        'type' in it &&
        it.type === 'dims_from_model',
    );
    expect(bulkInCte).toMatchObject({
      type: 'dims_from_model',
      model: 'stg__capeng__swh__oms_task_stats',
      include: ['region', 'status'],
    });
  });

  test('emits materialization instead of deprecated materialized', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      materialization: 'ephemeral',
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    } as never);

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(out.materialization).toBe('ephemeral');
    expect(out).not.toHaveProperty('materialized');
  });

  test('legacy incremental without a strategy does not gain defaults', () => {
    useModelStore.getState().setMode('edit');
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      materialized: 'incremental',
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    } as never);

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(out.materialization).toBe('incremental');
    expect(out).not.toHaveProperty('sql_hooks');
    expect(out).not.toHaveProperty('incremental_strategy');
  });

  test('omits the generated session pre-hook and keeps an explicit opt-out', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      materialization: 'incremental',
      sql_hooks: { pre: DEFAULT_INCREMENTAL_PRE_HOOK },
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    } as never);

    const withDefault = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(withDefault).not.toHaveProperty('sql_hooks');

    useModelStore.getState().setAdditionalField('sql_hooks', { pre: null });
    const optedOut = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(optedOut.sql_hooks).toEqual({ pre: null });
  });

  test('create mode preselects the default incremental strategy', () => {
    useModelStore.getState().setMode('create');
    useModelStore.getState().setBasicField('materialization', 'incremental');
    expect(
      useModelStore.getState().additionalFields.incremental_strategy,
    ).toEqual({ type: DEFAULT_INCREMENTAL_STRATEGY });
  });

  test('edit mode does not preselect a strategy when materialization changes', () => {
    useModelStore.getState().setMode('edit');
    useModelStore.getState().setBasicField('materialization', 'incremental');
    expect(
      useModelStore.getState().additionalFields.incremental_strategy,
    ).toBeUndefined();
    expect(useModelStore.getState().additionalFields.sql_hooks).toBeUndefined();
  });

  test('migrates legacy flat fields into materialization object', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      materialized: 'incremental',
      incremental_strategy: { type: 'delete+insert' },
      partitioned_by: ['portal_partition_daily'],
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    } as never);

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(out.materialization).toEqual({
      type: 'incremental',
      strategy: { type: 'delete+insert' },
      partitions: ['portal_partition_daily'],
    });
    expect(out).not.toHaveProperty('incremental_strategy');
    expect(out).not.toHaveProperty('partitioned_by');
  });

  test('preserves materialization extras when rebuilding', () => {
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      materialization: {
        type: 'incremental',
        format: 'iceberg',
        strategy: { type: 'append' },
      },
      from: { model: 'stg__capeng__swh__oms_task_stats' },
    } as never);

    useModelStore.getState().setAdditionalField('incremental_strategy', {
      type: 'delete+insert',
    });

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(out.materialization).toMatchObject({
      type: 'incremental',
      format: 'iceberg',
      strategy: { type: 'delete+insert' },
    });
  });

  test('collapses group_by: [{ type: "dims" }] to the "dims" shorthand', () => {
    // The shorthand collapse is documented in docs/models/README.md.
    useModelStore.getState().loadInitialData({
      name: 'oms_task_stats',
      group: 'capeng',
      topic: 'swh',
      projectName: 'capeng',
      type: 'int_select_model',
      from: { model: 'stg__capeng__swh__oms_task_stats' },
      group_by: [{ type: 'dims' }],
    } as never);

    const out = useModelStore.getState().buildModelJson() as Record<
      string,
      unknown
    >;
    expect(out.group_by).toBe('dims');
  });
});
