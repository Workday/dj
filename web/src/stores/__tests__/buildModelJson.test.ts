import { beforeEach, describe, expect, jest, test } from '@jest/globals';

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
