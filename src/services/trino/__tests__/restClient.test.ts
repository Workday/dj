import { describe, expect, it } from '@jest/globals';
import {
  parseDataSize,
  parseDurationMs,
  shapeQueryInfo,
  shapeQuerySummary,
  TrinoCoordinatorError,
} from '@services/trino/restClient';

describe('parseDurationMs', () => {
  it('handles numeric inputs as raw milliseconds', () => {
    expect(parseDurationMs(1234)).toBe(1234);
  });

  it('handles standard Trino duration strings', () => {
    expect(parseDurationMs('12.5s')).toBe(12_500);
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('1m')).toBe(60_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
  });

  it('returns undefined for nonsense', () => {
    expect(parseDurationMs(null)).toBeUndefined();
    expect(parseDurationMs(undefined)).toBeUndefined();
    expect(parseDurationMs('not-a-duration')).toBeUndefined();
  });
});

describe('parseDataSize', () => {
  it('handles numeric inputs as raw bytes', () => {
    expect(parseDataSize(2048)).toBe(2048);
  });

  it('handles standard Trino data-size strings', () => {
    expect(parseDataSize('512B')).toBe(512);
    expect(parseDataSize('1KB')).toBe(1024);
    expect(parseDataSize('2MB')).toBe(2 * 1024 ** 2);
    expect(parseDataSize('1.5GB')).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it('returns undefined for nonsense', () => {
    expect(parseDataSize(null)).toBeUndefined();
    expect(parseDataSize('weird')).toBeUndefined();
  });
});

describe('shapeQuerySummary', () => {
  it('extracts the queryId from the self URL when not given inline', () => {
    const s = shapeQuerySummary({
      self: 'https://trino.example.com/v1/query/20250511_120000_00000_abc',
      state: 'RUNNING',
    });
    expect(s.queryId).toBe('20250511_120000_00000_abc');
    expect(s.state).toBe('RUNNING');
  });

  it('prefers explicit queryId over self', () => {
    const s = shapeQuerySummary({
      queryId: 'explicit_id',
      self: 'https://trino.example.com/v1/query/from_self',
      state: 'FINISHED',
    });
    expect(s.queryId).toBe('explicit_id');
  });

  it('surfaces error code + failure message on failed queries', () => {
    const s = shapeQuerySummary({
      queryId: 'q1',
      state: 'FAILED',
      errorCode: { name: 'EXCEEDED_TIME_LIMIT', type: 'USER_ERROR' },
      failureInfo: { message: 'Query exceeded time limit' },
    });
    expect(s.errorCode).toBe('EXCEEDED_TIME_LIMIT');
    expect(s.errorType).toBe('USER_ERROR');
    expect(s.failureMessage).toBe('Query exceeded time limit');
  });
});

describe('shapeQueryInfo', () => {
  it('preserves the SQL text so findModelForSql can read the dbt query_comment', () => {
    const info = shapeQueryInfo({
      queryId: 'q1',
      state: 'FINISHED',
      query: '/* {"node_id": "model.foo.bar"} */\nselect 1',
      queryStats: {},
      outputStage: {
        stageId: 'stage_0',
        stageStats: {
          operatorSummaries: [
            {
              operatorType: 'TableScanOperator',
              pipelineId: 0,
              totalCpuTime: '1s',
              peakUserMemoryReservation: '10MB',
            },
          ],
        },
      },
    });
    expect(info.query).toContain('"node_id": "model.foo.bar"');
    expect(info.operatorSummary?.[0]?.operatorType).toBe('TableScanOperator');
    expect(info.operatorSummary?.[0]?.cpuNanos).toBeGreaterThan(0);
  });
});

describe('TrinoCoordinatorError', () => {
  it('carries the code, status, and retry-after for inspection', () => {
    const err = new TrinoCoordinatorError(
      'rate limited',
      'RATE_LIMITED',
      429,
      30,
    );
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.retryAfterSec).toBe(30);
    expect(err.message).toBe('rate limited');
  });
});
