/**
 * Trino REST API client.
 *
 * Wraps the coordinator's metadata-plane endpoints:
 *   GET /v1/info               → version + environment, drives the status pill
 *   GET /v1/query              → live + recently-finished query summaries
 *   GET /v1/query/{queryId}    → full QueryInfo JSON (used by sanitizer)
 *
 * Auth tier resolved via {@link resolveProfileSecret} so credentials never
 * leak into settings.json. 401s surface a one-click "refresh credential"
 * notification. 429 / 503 surface as actionable errors with the suggested
 * retry delay parsed from `Retry-After` when present.
 */

import type { DJLogger } from '@services/djLogger';
import { resolveProfileSecret } from '@services/trino/profiles';
import { summarizeQueryInfo } from '@services/trino/queryJsonSanitizer';
import {
  parseDataSize,
  parseDurationMs,
  parseDurationNanos,
} from '@shared/trino/parse';
import type {
  TrinoCoordinatorPing,
  TrinoOperatorSummaryEntry,
  TrinoProfile,
  TrinoQueryInfo,
  TrinoQuerySummary,
  TrinoStage,
} from '@shared/trino/types';

// Re-export the shared parsers so the existing `restClient.test.ts`
// imports stay valid. New code should reach for `@shared/trino/parse`
// directly.
export { parseDataSize, parseDurationMs };
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type * as vscode from 'vscode';

const DEFAULT_TIMEOUT_MS = 10000;

export class TrinoCoordinatorError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NETWORK'
      | 'TIMEOUT'
      | 'UNAUTHORIZED'
      | 'RATE_LIMITED'
      | 'UNAVAILABLE'
      | 'BAD_RESPONSE'
      | 'HTTP_ERROR'
      | 'PROFILE_ERROR',
    public readonly status?: number,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'TrinoCoordinatorError';
  }
}

export class TrinoRestClient {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profile: TrinoProfile,
    private readonly log: DJLogger,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * GET /v1/query/{queryId} — full QueryInfo JSON.
   */
  async getQueryInfo(queryId: string): Promise<TrinoQueryInfo> {
    const raw = await this.request<Record<string, unknown>>(
      `/v1/query/${encodeURIComponent(queryId)}`,
    );
    return shapeQueryInfo(raw);
  }

  /**
   * GET /v1/query/{queryId} — raw, unshaped JSON. Used by the sanitizer
   * which needs the full original payload to persist alongside the
   * trimmed-down one.
   */
  async getRawQueryInfo(queryId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/v1/query/${encodeURIComponent(queryId)}`,
    );
  }

  /**
   * GET /v1/query — short, recent query summaries from the coordinator
   * this profile is bound to. Used by the Query Control Center's Live
   * tab when a profile is active, so the rows always match the
   * coordinator the rest of the panel (per-query JSON, status pill,
   * Analyze-with-AI) is talking to.
   */
  async listActiveQueries(): Promise<TrinoQuerySummary[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(`/v1/query`);
    return Array.isArray(raw) ? raw.map(shapeQuerySummary) : [];
  }

  /**
   * GET /v1/info — coordinator version + environment.
   */
  async pingCoordinator(): Promise<TrinoCoordinatorPing> {
    try {
      const raw = await this.request<{
        nodeVersion?: { version?: string };
        environment?: string;
      }>(`/v1/info`, this.timeoutMs);
      return {
        ok: true,
        version: raw?.nodeVersion?.version ?? undefined,
        environment: raw?.environment ?? undefined,
      };
    } catch (err: unknown) {
      const message =
        err instanceof TrinoCoordinatorError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Low-level HTTP request. Resolves the JSON body or throws a typed
   * TrinoCoordinatorError. Adds X-Trino-User and Authorization headers.
   */
  private async request<T>(
    pathName: string,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    let url: URL;
    try {
      url = new URL(pathName, this.profile.coordinatorUrl);
    } catch {
      throw new TrinoCoordinatorError(
        `Invalid coordinator URL "${this.profile.coordinatorUrl}".`,
        'PROFILE_ERROR',
      );
    }

    const headers: Record<string, string> = {
      'X-Trino-User': this.profile.user,
      Accept: 'application/json',
      'User-Agent': 'dj-extension',
    };

    // Resolve secret via profile tier (never reads settings.json).
    let secret: string | null = null;
    try {
      secret = await resolveProfileSecret(this.context, this.profile);
    } catch (err: unknown) {
      throw new TrinoCoordinatorError(
        err instanceof Error ? err.message : String(err),
        'PROFILE_ERROR',
      );
    }
    if (secret) {
      switch (this.profile.authMethod) {
        case 'basic': {
          const token = Buffer.from(
            `${this.profile.user}:${secret}`,
            'utf8',
          ).toString('base64');
          headers.Authorization = `Basic ${token}`;
          break;
        }
        case 'bearer':
        case 'password-file': {
          headers.Authorization = `Bearer ${secret}`;
          break;
        }
      }
    }

    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options: https.RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      // Respect profile.verifyTls (defaults to verifying). The
      // `rejectUnauthorized: false` path is opt-in for self-signed certs
      // common in on-prem / private deployments.
      ...(isHttps && this.profile.verifyTls === false
        ? { rejectUnauthorized: false }
        : {}),
    };

    this.log.info(
      `[trino-rest] ${url.pathname} (profile=${this.profile.name}, host=${url.host})`,
    );

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        reject(
          new TrinoCoordinatorError(
            `Trino coordinator request timed out after ${timeoutMs}ms (${url.pathname}).`,
            'TIMEOUT',
          ),
        );
      }, timeoutMs);

      const req = transport.request(
        { ...options, signal: controller.signal as unknown as AbortSignal },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timer);
            const body = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;

            if (status === 401) {
              return reject(
                new TrinoCoordinatorError(
                  `Trino coordinator rejected credentials for profile "${this.profile.name}".`,
                  'UNAUTHORIZED',
                  401,
                ),
              );
            }
            if (status === 429 || status === 503) {
              const retryAfter = parseRetryAfter(res.headers['retry-after']);
              return reject(
                new TrinoCoordinatorError(
                  status === 429
                    ? `Trino coordinator is rate-limiting requests (429).`
                    : `Trino coordinator is unavailable (503).`,
                  status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
                  status,
                  retryAfter,
                ),
              );
            }
            if (status < 200 || status >= 300) {
              return reject(
                new TrinoCoordinatorError(
                  `Trino coordinator returned HTTP ${status} for ${url.pathname}: ${body.slice(0, 500)}`,
                  'HTTP_ERROR',
                  status,
                ),
              );
            }
            try {
              const parsed = body.length ? (JSON.parse(body) as T) : ({} as T);
              resolve(parsed);
            } catch (err: unknown) {
              reject(
                new TrinoCoordinatorError(
                  `Trino coordinator returned invalid JSON for ${url.pathname}: ${err instanceof Error ? err.message : String(err)}`,
                  'BAD_RESPONSE',
                  status,
                ),
              );
            }
          });
          res.on('error', (err) => {
            clearTimeout(timer);
            reject(
              new TrinoCoordinatorError(
                `Trino coordinator read error: ${err.message}`,
                'NETWORK',
              ),
            );
          });
        },
      );

      req.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          return;
        } // already rejected via timeout
        reject(
          new TrinoCoordinatorError(
            `Trino coordinator request failed: ${err.message}`,
            'NETWORK',
          ),
        );
      });

      req.end();
    });
  }
}

function parseRetryAfter(
  raw: string | string[] | undefined,
): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  const asInt = parseInt(value, 10);
  if (!Number.isNaN(asInt)) {
    return asInt;
  }
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const delta = Math.round((asDate - Date.now()) / 1000);
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

/**
 * Shape an entry from `GET /v1/query` (or any QueryInfo-like blob) into our
 * compact summary type.
 */
export function shapeQuerySummary(
  raw: Record<string, unknown>,
): TrinoQuerySummary {
  const stats = (raw.queryStats as Record<string, unknown>) || {};
  const session = (raw.session as Record<string, unknown>) || {};
  const errorCode = raw.errorCode as Record<string, unknown> | undefined;
  const failureInfo = raw.failureInfo as Record<string, unknown> | undefined;
  const self = (raw.self as string) || '';
  const queryId =
    (raw.queryId as string) ||
    (typeof raw.id === 'string' ? raw.id : '') ||
    extractQueryIdFromSelf(self);

  return {
    queryId,
    state: (raw.state as string) ?? 'UNKNOWN',
    query: typeof raw.query === 'string' ? raw.query : undefined,
    user: (session.user as string) ?? (raw.user as string) ?? undefined,
    source: (session.source as string) ?? (raw.source as string) ?? undefined,
    catalog: (session.catalog as string) ?? undefined,
    schema: (session.schema as string) ?? undefined,
    created: (stats.createTime as string) ?? undefined,
    started: (stats.executionStartTime as string) ?? undefined,
    ended: (stats.endTime as string) ?? undefined,
    cpuTimeMs: parseDurationMs(stats.totalCpuTime),
    wallTimeMs: parseDurationMs(stats.elapsedTime),
    queuedTimeMs: parseDurationMs(stats.queuedTime),
    analysisTimeMs: parseDurationMs(stats.analysisTime),
    planningTimeMs: parseDurationMs(stats.totalPlanningTime),
    peakUserMemoryBytes: parseDataSize(stats.peakUserMemoryReservation),
    peakTotalMemoryBytes: parseDataSize(stats.peakTotalMemoryReservation),
    processedRows: numberOrUndefined(stats.processedInputPositions),
    processedBytes: parseDataSize(stats.processedInputDataSize),
    totalSplits: numberOrUndefined(stats.totalSplits),
    completedSplits: numberOrUndefined(stats.completedSplits),
    queuedSplits: numberOrUndefined(stats.queuedSplits),
    runningSplits: numberOrUndefined(stats.runningSplits),
    blockedTimeMs: parseDurationMs(stats.totalBlockedTime),
    errorCode: asScalarString(errorCode?.name),
    errorType: asScalarString(errorCode?.type),
    failureMessage: asScalarString(failureInfo?.message),
  };
}

function asScalarString(v: unknown): string | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return undefined;
}

/**
 * Shape a raw /v1/query/{id} body into a TrinoQueryInfo. Computes the
 * summary, preserves stages + operator summary, and keeps the SQL text.
 *
 * NOTE: This does NOT sanitize the result. Use queryJsonSanitizer for the
 * sanitized + persisted artifact.
 */
export function shapeQueryInfo(raw: Record<string, unknown>): TrinoQueryInfo {
  const summary = summarizeQueryInfo(raw);
  return {
    summary,
    queryStats: raw.queryStats as Record<string, unknown> | undefined,
    failureInfo: raw.failureInfo as Record<string, unknown> | undefined,
    errorCode: raw.errorCode as Record<string, unknown> | string | undefined,
    dynamicFiltersStats: raw.dynamicFiltersStats as
      | Record<string, unknown>
      | undefined,
    query: typeof raw.query === 'string' ? raw.query : '',
    rootStage: shapeStage(raw.outputStage ?? raw.rootStage),
    operatorSummary: flattenOperatorSummary(raw),
  };
}

function shapeStage(raw: unknown): TrinoStage | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const subStages = Array.isArray(obj.subStages)
    ? (obj.subStages as unknown[])
        .map((s) => shapeStage(s))
        .filter((s): s is TrinoStage => Boolean(s))
    : undefined;
  return {
    stageId: typeof obj.stageId === 'string' ? obj.stageId : undefined,
    state: typeof obj.state === 'string' ? obj.state : undefined,
    rootStage: typeof obj.rootStage === 'boolean' ? obj.rootStage : undefined,
    stageStats: obj.stageStats as Record<string, unknown> | undefined,
    tasks: Array.isArray(obj.tasks)
      ? (obj.tasks as Array<Record<string, unknown>>)
      : undefined,
    subStages,
  };
}

function flattenOperatorSummary(
  raw: Record<string, unknown>,
): TrinoOperatorSummaryEntry[] {
  const out: TrinoOperatorSummaryEntry[] = [];
  function visit(stage: unknown) {
    if (!stage || typeof stage !== 'object') {
      return;
    }
    const obj = stage as Record<string, unknown>;
    const stats = obj.stageStats as Record<string, unknown> | undefined;
    const ops = Array.isArray(stats?.operatorSummaries)
      ? (stats.operatorSummaries as Array<Record<string, unknown>>)
      : [];
    for (const op of ops) {
      out.push({
        operatorType: op.operatorType as string | undefined,
        pipelineId: op.pipelineId as number | string | undefined,
        planNodeId: op.planNodeId as string | undefined,
        inputPositions: numberOrUndefined(op.inputPositions),
        outputPositions: numberOrUndefined(op.outputPositions),
        inputDataSize: op.inputDataSize as number | string | undefined,
        outputDataSize: op.outputDataSize as number | string | undefined,
        cpuNanos: parseDurationNanos(op.totalCpuTime ?? op.cpuTime),
        blockedWallNanos: parseDurationNanos(op.blockedWall),
        peakMemoryReservation: op.peakUserMemoryReservation as
          | number
          | string
          | undefined,
        runtimeStats: op.runtimeStats as Record<string, unknown> | undefined,
      });
    }
    const subStages = obj.subStages as unknown[] | undefined;
    if (Array.isArray(subStages)) {
      for (const sub of subStages) {
        visit(sub);
      }
    }
  }
  visit(raw.outputStage ?? raw.rootStage);
  return out;
}

function numberOrUndefined(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return raw;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function extractQueryIdFromSelf(self: string): string {
  // .../v1/query/<id>
  const m = self.match(/\/v1\/query\/([^/?#]+)/);
  return m ? m[1] : '';
}
