import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { SyncQueue } from '../SyncQueue';
import type { SyncResult } from '../types';

function makeSyncResult(overrides?: Partial<SyncResult>): SyncResult {
  return {
    success: true,
    renames: [],
    errors: [],
    stats: {
      totalResources: 0,
      processedResources: 0,
      skippedResources: 0,
      dependencyLevels: 0,
      maxParallelism: 0,
    },
    ...overrides,
  };
}

describe('SyncQueue coalescing', () => {
  let onRunSync: jest.Mock<(roots?: any[]) => Promise<SyncResult>>;
  let onStatusChange: jest.Mock;
  let log: any;
  let queue: SyncQueue;

  beforeEach(() => {
    jest.useFakeTimers();
    onRunSync = jest
      .fn<(roots?: any[]) => Promise<SyncResult>>()
      .mockResolvedValue(makeSyncResult());
    onStatusChange = jest.fn();
    log = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    queue = new SyncQueue(onRunSync, onStatusChange, log);
  });

  afterEach(() => {
    queue.dispose();
    jest.useRealTimers();
  });

  test('single enqueue starts sync after coalescing delay, not immediately', () => {
    queue.enqueue('model.proj.a', '/a.model.json');

    // Sync should NOT start immediately
    expect(onRunSync).not.toHaveBeenCalled();

    // After coalescing delay (500ms)
    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);
    expect(onRunSync).toHaveBeenCalledWith([
      { id: 'model.proj.a', pathJson: '/a.model.json' },
    ]);
  });

  test('rapid enqueues coalesce into a single sync run', () => {
    queue.enqueue('model.proj.a', '/a.model.json');
    jest.advanceTimersByTime(200);
    queue.enqueue('model.proj.b', '/b.model.json');
    jest.advanceTimersByTime(200);
    queue.enqueue('model.proj.c', '/c.model.json');

    // Still within coalescing window — no sync yet
    expect(onRunSync).not.toHaveBeenCalled();

    // 500ms after the LAST enqueue
    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);

    const roots = onRunSync.mock.calls[0][0];
    expect(roots).toHaveLength(3);
    const ids = roots!.map((r: any) => r.id).sort();
    expect(ids).toEqual(['model.proj.a', 'model.proj.b', 'model.proj.c']);
  });

  test('coalescing respects MAX_COALESCING_MS hard cap', () => {
    // Enqueue items every 400ms (under 500ms reset), stretching past MAX of 3s
    for (let i = 0; i < 10; i++) {
      queue.enqueue(`model.proj.m${i}`, `/m${i}.model.json`);
      jest.advanceTimersByTime(400);
    }

    // By now 4000ms have passed — exceeds MAX_COALESCING_MS (3000ms)
    // so the sync should have started at some point
    expect(onRunSync).toHaveBeenCalled();
  });

  test('deduplication: same ID enqueued multiple times produces one root', () => {
    queue.enqueue('model.proj.a', '/old.model.json');
    queue.enqueue('model.proj.a', '/new.model.json');

    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);

    const roots = onRunSync.mock.calls[0][0];
    expect(roots).toHaveLength(1);
    expect(roots![0].pathJson).toBe('/new.model.json');
  });

  test('enqueueFullSync clears individual roots', () => {
    queue.enqueue('model.proj.a');
    queue.enqueue('model.proj.b');
    queue.enqueueFullSync();

    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);
    // Full sync passes undefined roots
    expect(onRunSync).toHaveBeenCalledWith(undefined);
  });

  test('escalation to full sync when threshold exceeded', () => {
    for (let i = 0; i < 25; i++) {
      queue.enqueue(`model.proj.m${i}`);
    }

    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);
    // Escalated to full sync — roots should be undefined
    expect(onRunSync).toHaveBeenCalledWith(undefined);
  });

  test('items enqueued during a running sync are picked up in the next run', async () => {
    let resolveSync: (v: SyncResult) => void;
    onRunSync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    queue.enqueue('model.proj.a');
    jest.advanceTimersByTime(500);
    expect(onRunSync).toHaveBeenCalledTimes(1);

    // While sync is running, enqueue more
    queue.enqueue('model.proj.b');
    queue.enqueue('model.proj.c');

    // Resolve the first sync
    resolveSync!(makeSyncResult());
    await Promise.resolve(); // let microtask settle

    // The second batch should run (processNext calls itself in finally)
    jest.advanceTimersByTime(0);
    await Promise.resolve();

    expect(onRunSync).toHaveBeenCalledTimes(2);
    const secondRoots = onRunSync.mock.calls[1][0];
    expect(secondRoots).toHaveLength(2);
  });
});

describe('SyncQueue shouldProcessEvent', () => {
  let queue: SyncQueue;

  beforeEach(() => {
    queue = new SyncQueue(
      jest.fn<() => Promise<SyncResult>>().mockResolvedValue(makeSyncResult()),
      jest.fn(),
      { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    );
  });

  afterEach(() => queue.dispose());

  test('framework JSON change returns debounce', () => {
    expect(queue.shouldProcessEvent('/a.model.json', 'change')).toBe(
      'debounce',
    );
    expect(queue.shouldProcessEvent('/b.source.json', 'create')).toBe(
      'debounce',
    );
  });

  test('non-framework files return pass', () => {
    expect(queue.shouldProcessEvent('/a.sql', 'change')).toBe('pass');
    expect(queue.shouldProcessEvent('/a.yml', 'change')).toBe('pass');
  });

  test('paths within suppression window return suppress', () => {
    queue.recordOpsForSuppression([
      { type: 'write', path: '/a.model.json', text: '' },
    ]);
    expect(queue.shouldProcessEvent('/a.model.json', 'change')).toBe(
      'suppress',
    );
  });
});
