import { describe, expect, it } from '@jest/globals';
import {
  QueryInfoFirewallError,
  readPersistedSanitizedQuery,
  sanitize,
  sanitizeAndPersist,
  summarizeQueryInfo,
  toolFirewall,
} from '@services/trino/queryJsonSanitizer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeRawQueryInfo(overrides: Record<string, unknown> = {}) {
  return {
    queryId: '20250511_120000_00000_test',
    state: 'FINISHED',
    session: {
      user: 'tester',
      source: 'dbt-trino-1.7.17',
      catalog: 'hive',
      schema: 'analytics',
    },
    queryStats: {
      createTime: '2025-05-11T12:00:00Z',
      executionStartTime: '2025-05-11T12:00:01Z',
      endTime: '2025-05-11T12:00:55Z',
      totalCpuTime: '40.20s',
      elapsedTime: '54.00s',
      queuedTime: '0.50s',
      analysisTime: '0.20s',
      totalPlanningTime: '0.30s',
      totalBlockedTime: '4.00s',
      peakUserMemoryReservation: '800MB',
      peakTotalMemoryReservation: '900MB',
      processedInputPositions: 1_200_000,
      processedInputDataSize: '120MB',
      totalSplits: 180,
      completedSplits: 180,
      queuedSplits: 0,
      runningSplits: 0,
      stageGcStatistics: { large: 'blob' },
      operatorSummaries: [{ operatorType: 'LookupJoinOperator' }],
    },
    query:
      '/* {"app": "dbt", "node_id": "model.my_project.int__finance__daily"} */\nselect 1',
    outputStage: {
      stageId: 'stage_0',
      state: 'FINISHED',
      stageStats: {
        totalCpuTime: '20s',
        operatorSummaries: [
          {
            operatorType: 'LookupJoinOperator',
            pipelineId: 1,
            planNodeId: 'pl1',
            inputPositions: 1_200_000,
            outputPositions: 1_180_000,
            totalCpuTime: '18s',
            peakUserMemoryReservation: '600MB',
            inputDataSizeDistribution: { max: '50MB', avg: '5MB' },
          },
          {
            operatorType: 'TableScanOperator',
            pipelineId: 0,
            planNodeId: 'pl0',
            inputPositions: 1_200_000,
            outputPositions: 1_200_000,
            totalCpuTime: '8s',
            peakUserMemoryReservation: '120MB',
            info: { connectorName: 'hive', catalog: 'hive' },
          },
        ],
      },
      tasks: [
        {
          taskId: 't1',
          stats: { foo: 'bar', pipelines: ['drop-me'] },
          outputBuffers: { drop: 'me' },
        },
      ],
      subStages: [],
    },
    ...overrides,
  };
}

describe('toolFirewall', () => {
  it('rejects payloads with top-level result key', () => {
    expect(() => toolFirewall({ result: { data: [[1]] } })).toThrow(
      QueryInfoFirewallError,
    );
  });

  it('rejects payloads with top-level data key', () => {
    expect(() => toolFirewall({ data: [[1]] })).toThrow(QueryInfoFirewallError);
  });

  it('rejects queryStats.rows row data', () => {
    expect(() => toolFirewall({ queryStats: { rows: [[1, 2]] } })).toThrow(
      QueryInfoFirewallError,
    );
  });

  it('accepts well-formed QueryInfo payloads', () => {
    expect(() => toolFirewall(makeRawQueryInfo())).not.toThrow();
  });
});

describe('summarizeQueryInfo', () => {
  it('extracts headline stats from queryStats and session', () => {
    const s = summarizeQueryInfo(makeRawQueryInfo());
    expect(s.queryId).toBe('20250511_120000_00000_test');
    expect(s.state).toBe('FINISHED');
    expect(s.user).toBe('tester');
    expect(s.source).toBe('dbt-trino-1.7.17');
    expect(s.catalog).toBe('hive');
    expect(s.schema).toBe('analytics');
    expect(s.wallTimeMs).toBeGreaterThan(0);
    expect(s.cpuTimeMs).toBeGreaterThan(0);
    expect(s.peakUserMemoryBytes).toBeGreaterThan(0);
    expect(s.totalSplits).toBe(180);
  });

  it('reports the largest operator and its peak memory', () => {
    const s = summarizeQueryInfo(makeRawQueryInfo());
    expect(s.largestOperator).toBe('LookupJoinOperator');
  });

  it('computes data-skew score from inputDataSizeDistribution', () => {
    const s = summarizeQueryInfo(makeRawQueryInfo());
    // 50MB max / 5MB avg = 10
    expect(s.dataSkewScore).toBeCloseTo(10, 1);
  });

  it('parses planning time from the legacy totalPlanningTime key', () => {
    const s = summarizeQueryInfo(makeRawQueryInfo());
    expect(s.planningTimeMs).toBe(300);
  });

  it('surfaces connector types from TableScanOperator info', () => {
    const s = summarizeQueryInfo(makeRawQueryInfo());
    expect(s.connectorTypes).toContain('hive');
  });

  it('surfaces error code and failure message on failed queries', () => {
    const raw = makeRawQueryInfo({
      state: 'FAILED',
      errorCode: {
        name: 'EXCEEDED_LOCAL_MEMORY_LIMIT',
        type: 'INSUFFICIENT_RESOURCES',
      },
      failureInfo: { message: 'Per-node memory limit exceeded' },
    });
    const s = summarizeQueryInfo(raw);
    expect(s.state).toBe('FAILED');
    expect(s.errorCode).toBe('EXCEEDED_LOCAL_MEMORY_LIMIT');
    expect(s.errorType).toBe('INSUFFICIENT_RESOURCES');
    expect(s.failureMessage).toBe('Per-node memory limit exceeded');
  });
});

/**
 * Build a fixture matching the newer Trino stage shape: no
 * `outputStage` / `rootStage`, instead a `stages` envelope with the
 * root identified by `outputStageId` and children in a `stages` array.
 * Also exercises the `totalDrivers` / `completedDrivers` counters and a
 * flat `queryStats.operatorSummaries` list (instead of per-stage).
 */
function makeNewShapeQueryInfo(overrides: Record<string, unknown> = {}) {
  return {
    queryId: '20260515_182811_09678_vd3zk',
    state: 'FINISHED',
    session: { user: 'tester', source: 'trino-js-client' },
    queryStats: {
      createTime: '2026-05-15T18:28:11Z',
      executionStartTime: '2026-05-15T18:28:11Z',
      endTime: '2026-05-15T18:33:11Z',
      totalCpuTime: '1.04h',
      elapsedTime: '5.01m',
      queuedTime: '0.50s',
      totalBlockedTime: '4.28d',
      peakUserMemoryReservation: '19755869049B',
      processedInputPositions: 1_683_119_817,
      processedInputDataSize: '1920805930523B',
      totalDrivers: 8441,
      completedDrivers: 8441,
      queuedDrivers: 0,
      runningDrivers: 0,
      operatorSummaries: [
        {
          operatorType: 'ExchangeOperator',
          peakUserMemoryReservation: '72B',
        },
        {
          operatorType: 'LookupJoinOperator',
          peakUserMemoryReservation: '600MB',
        },
      ],
    },
    query: 'select 1',
    stages: {
      outputStageId: 'stage_0',
      stages: [
        {
          stageId: 'stage_0',
          state: 'FINISHED',
          stageStats: { totalCpuTime: '20s' },
          subStages: [
            {
              stageId: 'stage_1',
              state: 'FINISHED',
              stageStats: { totalCpuTime: '10s' },
            },
          ],
        },
        {
          stageId: 'stage_1',
          state: 'FINISHED',
          stageStats: { totalCpuTime: '10s' },
        },
      ],
    },
    ...overrides,
  };
}

describe('summarizeQueryInfo (newer Trino shape)', () => {
  it('falls back to totalDrivers / completedDrivers when totalSplits is absent', () => {
    const s = summarizeQueryInfo(makeNewShapeQueryInfo());
    expect(s.totalSplits).toBe(8441);
    expect(s.completedSplits).toBe(8441);
    expect(s.queuedSplits).toBe(0);
    expect(s.runningSplits).toBe(0);
  });

  it('reports largestOperator from the flat queryStats.operatorSummaries when per-stage list is empty', () => {
    const s = summarizeQueryInfo(makeNewShapeQueryInfo());
    expect(s.largestOperator).toBe('LookupJoinOperator');
  });

  it('parses planning time from the current planningTime key', () => {
    const raw = makeNewShapeQueryInfo();
    (raw.queryStats as Record<string, unknown>).planningTime = '0.30s';
    const s = summarizeQueryInfo(raw);
    expect(s.planningTimeMs).toBe(300);
  });

  it('falls back to per-task input skew when operator distributions are absent', () => {
    const raw = makeNewShapeQueryInfo({
      stages: {
        outputStageId: 'stage_0',
        stages: [
          {
            stageId: 'stage_0',
            state: 'FINISHED',
            stageStats: { totalCpuTime: '20s' },
            subStages: ['stage_1'],
          },
          {
            stageId: 'stage_1',
            state: 'FINISHED',
            stageStats: { totalCpuTime: '10s' },
            // One hot task vs three light siblings:
            // avg = (100 + 10 + 10 + 10) / 4 = 32.5MB → 100 / 32.5 ≈ 3.08
            tasks: [
              { stats: { processedInputDataSize: '100MB' } },
              { stats: { processedInputDataSize: '10MB' } },
              { stats: { processedInputDataSize: '10MB' } },
              { stats: { processedInputDataSize: '10MB' } },
            ],
            subStages: [],
          },
        ],
      },
    });
    const s = summarizeQueryInfo(raw);
    expect(s.dataSkewScore).toBeCloseTo(3.08, 2);
  });

  it('surfaces connector types from splitOperatorInfo catalogName', () => {
    const raw = makeNewShapeQueryInfo();
    (raw.queryStats as Record<string, unknown>).operatorSummaries = [
      {
        operatorType: 'TableScanOperator',
        info: { catalogName: 'iceberg', splitInfo: {} },
      },
    ];
    const s = summarizeQueryInfo(raw);
    expect(s.connectorTypes).toContain('iceberg');
  });
});

describe('sanitize (newer Trino shape)', () => {
  it('picks the root stage from the new stages envelope', () => {
    const s = sanitize(makeNewShapeQueryInfo());
    expect(s.rootStage).toBeDefined();
    expect(s.rootStage?.stageId).toBe('stage_0');
    expect(s.rootStage?.subStages?.length).toBe(1);
    expect(s.rootStage?.subStages?.[0].stageId).toBe('stage_1');
  });

  it('falls back to stages[0] when outputStageId is missing', () => {
    const raw = makeNewShapeQueryInfo({
      stages: {
        stages: [
          { stageId: 'stage_alpha', state: 'FINISHED' },
          { stageId: 'stage_beta', state: 'FINISHED' },
        ],
      },
    });
    const s = sanitize(raw);
    expect(s.rootStage?.stageId).toBe('stage_alpha');
  });

  it('emits operatorSummary from queryStats.operatorSummaries when per-stage list is empty', () => {
    const s = sanitize(makeNewShapeQueryInfo());
    expect(s.operatorSummary?.length).toBe(2);
    expect(s.operatorSummary?.[0].operatorType).toBe('ExchangeOperator');
  });

  it('sums addInputCpu + getOutputCpu + finishCpu when totalCpuTime is absent', () => {
    // Newer Trino operator summaries split CPU across the three
    // pipeline phases — there's no single `totalCpuTime` to read.
    const raw = makeNewShapeQueryInfo({
      queryStats: {
        ...(makeNewShapeQueryInfo().queryStats as Record<string, unknown>),
        operatorSummaries: [
          {
            operatorType: 'LookupJoinOperator',
            addInputCpu: '2.00s',
            getOutputCpu: '500ms',
            finishCpu: '500ms',
            blockedWall: '1.00s',
            peakUserMemoryReservation: '600MB',
          },
          {
            operatorType: 'TableScanOperator',
            // Missing per-phase fields entirely — should yield
            // undefined (placeholder rendered).
            peakUserMemoryReservation: '120MB',
          },
        ],
      },
    });
    const s = sanitize(raw);
    expect(s.operatorSummary?.[0].cpuNanos).toBe(3_000_000_000);
    expect(s.operatorSummary?.[0].blockedWallNanos).toBe(1_000_000_000);
    expect(s.operatorSummary?.[1].cpuNanos).toBeUndefined();
  });

  it('resolves string-id subStages references against the flat stages array', () => {
    // Most newer Trino builds emit `subStages` as an array of stage
    // IDs (strings) and store every stage flat under
    // `raw.stages.stages`. The tree has to be reconstructed by
    // resolving each id against the flat list.
    const raw = makeNewShapeQueryInfo({
      stages: {
        outputStageId: 'stage_0',
        stages: [
          {
            stageId: 'stage_0',
            state: 'FINISHED',
            stageStats: {
              totalCpuTime: '20s',
              operatorSummaries: [{ operatorType: 'OutputOperator' }],
            },
            subStages: ['stage_1', 'stage_2'],
          },
          {
            stageId: 'stage_1',
            state: 'FINISHED',
            stageStats: {
              totalCpuTime: '10s',
              operatorSummaries: [{ operatorType: 'ScanFilterOperator' }],
            },
            subStages: ['stage_3'],
          },
          {
            stageId: 'stage_2',
            state: 'FINISHED',
            stageStats: { totalCpuTime: '5s' },
            subStages: [],
          },
          {
            stageId: 'stage_3',
            state: 'FINISHED',
            stageStats: { totalCpuTime: '2s' },
            subStages: [],
          },
        ],
      },
    });
    const s = sanitize(raw);
    expect(s.rootStage?.stageId).toBe('stage_0');
    expect(s.rootStage?.subStages?.map((c) => c.stageId)).toEqual([
      'stage_1',
      'stage_2',
    ]);
    expect(s.rootStage?.subStages?.[0].subStages?.[0].stageId).toBe('stage_3');
    // collectOperators should now find the per-stage operators along
    // the resolved tree; the largestOperator metric is computed from
    // them in summarizeQueryInfo.
    expect(
      s.operatorSummary?.some((o) => o.operatorType === 'ScanFilterOperator'),
    ).toBe(true);
  });
});

describe('sanitize', () => {
  it('drops stageGcStatistics and per-driver task detail', () => {
    const s = sanitize(makeRawQueryInfo());
    expect(s.queryStats.stageGcStatistics).toBeUndefined();
    expect(s.queryStats.operatorSummaries).toBeUndefined();
    // tasks[].outputBuffers and tasks[].stats.pipelines stripped
    const task = (s.rootStage?.tasks ?? [])[0];
    expect(task?.outputBuffers).toBeUndefined();
    const stats = task?.stats as Record<string, unknown> | undefined;
    expect(stats?.pipelines).toBeUndefined();
    expect(stats?.foo).toBe('bar');
  });

  it('reproduces the operator summary at top level with trimmed fields', () => {
    const s = sanitize(makeRawQueryInfo());
    expect(s.operatorSummary).toBeDefined();
    expect(s.operatorSummary!.length).toBe(2);
    const first = s.operatorSummary![0];
    expect(first.operatorType).toBe('LookupJoinOperator');
    expect(first.cpuNanos).toBeGreaterThan(0);
  });

  it('keeps the query_comment verbatim so findModelForSql can read the node_id', () => {
    const s = sanitize(makeRawQueryInfo());
    expect(s.query).toContain(
      '"node_id": "model.my_project.int__finance__daily"',
    );
  });
});

describe('sanitizeAndPersist', () => {
  it('writes <queryId>.json and <queryId>.full.json to the workspace .dj/diagnostics dir', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const raw = makeRawQueryInfo();
      const res = await sanitizeAndPersist(raw, { workspaceRoot: tmp });
      expect(res.queryId).toBe('20250511_120000_00000_test');
      expect(fs.existsSync(res.jsonPath)).toBe(true);
      expect(fs.existsSync(res.fullJsonPath)).toBe(true);
      const sanitizedOnDisk = JSON.parse(
        await fs.promises.readFile(res.jsonPath, 'utf8'),
      );
      expect(sanitizedOnDisk.summary.queryId).toBe(
        '20250511_120000_00000_test',
      );
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('reuses cached sanitized output when called twice in quick succession', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const raw = makeRawQueryInfo();
      const first = await sanitizeAndPersist(raw, { workspaceRoot: tmp });
      const firstMtime = (await fs.promises.stat(first.jsonPath)).mtimeMs;
      await sanitizeAndPersist(raw, { workspaceRoot: tmp });
      const secondMtime = (await fs.promises.stat(first.jsonPath)).mtimeMs;
      expect(secondMtime).toBe(firstMtime);
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses to sanitize a payload that smells like row data', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const raw = makeRawQueryInfo({ result: { data: [[1, 2, 3]] } });
      await expect(
        sanitizeAndPersist(raw, { workspaceRoot: tmp }),
      ).rejects.toThrow(QueryInfoFirewallError);
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('readPersistedSanitizedQuery', () => {
  it('returns null when there is no diagnostics dir', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const out = await readPersistedSanitizedQuery(
        '20250511_120000_00000_test',
        tmp,
      );
      expect(out).toBeNull();
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('round-trips a previously-persisted sanitized payload', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const raw = makeRawQueryInfo();
      await sanitizeAndPersist(raw, { workspaceRoot: tmp });
      const out = await readPersistedSanitizedQuery(
        '20250511_120000_00000_test',
        tmp,
      );
      expect(out).not.toBeNull();
      expect(out!.summary.queryId).toBe('20250511_120000_00000_test');
      expect(out!.summary.state).toBe('FINISHED');
      expect(out!.query).toContain('node_id');
      expect(out!.operatorSummary?.length).toBeGreaterThan(0);
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns null for an empty queryId', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const out = await readPersistedSanitizedQuery('', tmp);
      expect(out).toBeNull();
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when the persisted file is corrupt JSON', async () => {
    const tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'dj-trino-test-'),
    );
    try {
      const dir = path.join(tmp, '.dj', 'diagnostics');
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dir, 'bad_query.json'),
        '{not json',
        'utf8',
      );
      const out = await readPersistedSanitizedQuery('bad_query', tmp);
      expect(out).toBeNull();
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });
});
