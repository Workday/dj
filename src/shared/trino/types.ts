import type { FrameworkEtlSource } from '@shared/framework/types';

export type TrinoAuthMethod = 'none' | 'basic' | 'bearer' | 'password-file';

export type TrinoAuthSource =
  | 'secret-storage'
  | 'env-var'
  | 'password-file'
  | 'dbt-profile';

export type TrinoProfile = {
  name: string;
  coordinatorUrl: string;
  user: string;
  authMethod: TrinoAuthMethod;
  authSource: TrinoAuthSource;
  verifyTls?: boolean;
  // authSource-specific fields
  secretEnvVar?: string; // when authSource = 'env-var'
  passwordFilePath?: string; // when authSource = 'password-file'
  dbtProfile?: string; // when authSource = 'dbt-profile'
  dbtTarget?: string; // when authSource = 'dbt-profile'
};

export type TrinoCoordinatorPing = {
  ok: boolean;
  version?: string;
  environment?: string;
  error?: string;
};

/**
 * Compact summary derived from a full TrinoQueryInfo. The "headline" view that
 * fits in an LLM prompt without blowing the token budget.
 */
export type TrinoQuerySummary = {
  queryId: string;
  /**
   * Trino reports state as one of:
   *   QUEUED | PLANNING | STARTING | RUNNING | FINISHED | FAILED
   * Typed as `string` because connectors occasionally introduce new
   * states (e.g. `WAITING_FOR_PREREQUISITES`).
   */
  state: string;
  query?: string;
  user?: string;
  source?: string;
  catalog?: string;
  schema?: string;
  created?: string;
  started?: string;
  ended?: string;
  cpuTimeMs?: number;
  wallTimeMs?: number;
  queuedTimeMs?: number;
  analysisTimeMs?: number;
  planningTimeMs?: number;
  peakUserMemoryBytes?: number;
  peakTotalMemoryBytes?: number;
  processedRows?: number;
  processedBytes?: number;
  totalSplits?: number;
  completedSplits?: number;
  queuedSplits?: number;
  runningSplits?: number;
  blockedTimeMs?: number;
  dataSkewScore?: number;
  largestOperator?: string;
  joinDistributionTypes?: string[];
  connectorTypes?: string[];
  errorCode?: string;
  errorType?: string;
  failureMessage?: string;
};

/**
 * Envelope returned by `trino-fetch-active-queries`. The `source` and
 * `profileName` let the Query Control Center surface where the rows
 * came from (the configured profile's coordinator over REST, or the
 * local Trino CLI's `system.runtime.queries`), so the user never has
 * to guess which coordinator the Live tab is looking at.
 */
export type TrinoActiveQueriesResponse = {
  source: 'rest' | 'cli';
  profileName: string | null;
  rows: TrinoQuerySummary[];
};

/**
 * Sanitized form of /v1/query/{id}. Loosely typed because the Trino JSON
 * shape varies by version and connector — we keep only what we know we
 * care about and pass the rest through.
 */
export type TrinoQueryInfo = {
  summary: TrinoQuerySummary;
  queryStats?: Record<string, unknown>;
  failureInfo?: Record<string, unknown>;
  errorCode?: Record<string, unknown> | string;
  dynamicFiltersStats?: Record<string, unknown>;
  /** SQL text submitted to Trino — used by findModelForSql() */
  query: string;
  /** Top-level stage tree */
  rootStage?: TrinoStage;
  /** Flat operator summary list. */
  operatorSummary?: TrinoOperatorSummaryEntry[];
  /**
   * Resolved DJ model for this query, computed by the extension via
   * `findModelForSql()` against the manifest. `null` when no strategy
   * (`comment` / `fqn` / `cte`) resolves — the UI surfaces a disabled
   * "Jump to Model" button with an explanatory tooltip in that case.
   */
  modelMatch?: DjModelMatch | null;
  /**
   * Where this snapshot came from:
   * - `persisted` — read from `.dj/diagnostics/<queryId>.json` (free,
   *   may be stale).
   * - `rest` — fresh fetch from the coordinator (requires a profile).
   *
   * Set by the extension on every `trino-fetch-query-info` response so
   * the detail pane can label the source and offer a "Refresh from
   * coordinator" affordance when the local copy is stale.
   */
  loadedFrom?: 'persisted' | 'rest';
  /**
   * Absolute path to the sanitized diagnostics file backing this
   * snapshot (`<workspace>/.dj/diagnostics/<queryId>.json`). Set
   * whenever the file exists on disk — either because we just wrote
   * it (REST + sanitize-and-persist) or because we just read it
   * (persisted-first). The UI surfaces this so users can hand the
   * exact file path to their AI agent without guessing.
   */
  jsonPath?: string;
  /**
   * Absolute path to the raw `<queryId>.full.json` coordinator
   * snapshot saved beside the sanitized JSON. The full file is the
   * unfiltered `/v1/query/{id}` response (typically multi-MB) and is
   * useful when the sanitized summary isn't enough — e.g. when an AI
   * agent needs the full execution plan or per-driver task detail.
   * Set whenever both files exist on disk; the backend guards the
   * field with a `fs.existsSync` check before emitting it.
   */
  fullJsonPath?: string;
  /**
   * Profile + coordinator URL of the cluster this snapshot was
   * captured against. Always set for REST snapshots; set on persisted
   * snapshots when the on-disk JSON records them. Both fields may be
   * `undefined` when reading a diagnostic that has no profile metadata
   * — the History UI buckets those under "(none)".
   */
  profileName?: string;
  coordinatorUrl?: string;
};

export type TrinoStage = {
  stageId?: string;
  state?: string;
  rootStage?: boolean;
  stageStats?: Record<string, unknown>;
  tasks?: Array<Record<string, unknown>>;
  subStages?: TrinoStage[];
};

export type TrinoOperatorSummaryEntry = {
  operatorType?: string;
  pipelineId?: number | string;
  planNodeId?: string;
  inputPositions?: number;
  outputPositions?: number;
  inputDataSize?: number | string;
  outputDataSize?: number | string;
  cpuNanos?: number;
  blockedWallNanos?: number;
  peakMemoryReservation?: number | string;
  runtimeStats?: Record<string, unknown>;
};

/** Match result for findModelForSql(). */
export type DjModelMatch = {
  project: string;
  modelName: string;
  modelJsonPath?: string;
  /**
   * How the match was resolved.
   * - `comment` — extracted from the `dbt` query_comment JSON (`node_id`).
   *   This is the highest-confidence signal because it's authored by dbt
   *   itself and survives any wrapping (CREATE TABLE AS, INSERT INTO, …).
   * - `fqn` — extracted from the materialization target FQN
   *   (`catalog.schema.table`) in `CREATE TABLE/VIEW … AS …` or
   *   `INSERT INTO …`. Reliable for `dbt run` / incremental, may collide
   *   if two projects publish a model with the same name.
   * - `cte` — extracted from the trailing CTE name pattern in the
   *   compiled SQL (`), <name> AS (…) SELECT * FROM <name>`). Used as a
   *   last resort for `dbt compile` / `dbt show` outputs.
   */
  matchedBy: 'comment' | 'fqn' | 'cte';
};

/** Persisted analysis artifact written by trino-analyze-query. */
export type TrinoAnalysisResult = {
  queryId: string;
  jsonPath: string;
  fullJsonPath: string;
  modelMatch: DjModelMatch | null;
  promptSnippet: string;
};

export type TrinoPersistedQuery = {
  queryId: string;
  persistedAt: string;
  jsonPath: string;
  summary: TrinoQuerySummary;
  /**
   * Profile name + coordinator URL captured when the sanitized JSON
   * was first written. Used by the History tab to surface a per-row
   * profile pill and a profile filter dropdown. Optional — entries
   * without profile metadata leave both fields `undefined` and bucket
   * under "(none)" in the filter.
   */
  profileName?: string;
  coordinatorUrl?: string;
};

export type TrinoApi =
  | {
      type: 'trino-fetch-catalogs';
      service: 'trino';
      request: null;
      response: string[];
    }
  | {
      type: 'trino-fetch-columns';
      service: 'trino';
      request: { catalog: string; schema: string; table: string };
      response: TrinoTableColumn[];
    }
  | {
      type: 'trino-fetch-etl-sources';
      service: 'trino';
      request: { projectName: string; etlSchema?: string };
      response: FrameworkEtlSource[];
    }
  | {
      type: 'trino-fetch-schemas';
      service: 'trino';
      request: { catalog: string };
      response: string[];
    }
  | {
      type: 'trino-fetch-system-nodes';
      service: 'trino';
      request: null;
      response: TrinoSystemNode[];
    }
  | {
      type: 'trino-fetch-tables';
      service: 'trino';
      request: { catalog: string; schema: string };
      response: string[];
    }
  | {
      type: 'trino-fetch-query-info';
      service: 'trino';
      request: {
        queryId: string;
        /**
         * `persisted` (default) — try the local sanitized JSON first;
         * fall back to REST only if nothing is on disk yet. Free for
         * already-analyzed queries.
         * `rest` — always hit the coordinator and persist the fresh
         * sanitized copy. Used by the "Refresh from coordinator"
         * affordance and by the "Analyze with AI" flow.
         */
        prefer?: 'persisted' | 'rest';
      };
      response: TrinoQueryInfo;
    }
  | {
      type: 'trino-fetch-active-queries';
      service: 'trino';
      request: { filter?: 'all' | 'dbt-trino-only' };
      response: TrinoActiveQueriesResponse;
    }
  | {
      type: 'trino-fetch-persisted-queries';
      service: 'trino';
      request: null;
      response: TrinoPersistedQuery[];
    }
  | {
      type: 'trino-delete-persisted-query';
      service: 'trino';
      request: { queryId: string };
      response: { queryId: string; deleted: boolean };
    }
  | {
      type: 'trino-analyze-query';
      service: 'trino';
      request: { queryId: string };
      response: TrinoAnalysisResult;
    }
  | {
      type: 'trino-list-profiles';
      service: 'trino';
      request: null;
      response: { profiles: TrinoProfile[]; active: string | null };
    }
  | {
      type: 'trino-save-profile';
      service: 'trino';
      request: { profile: TrinoProfile; previousName?: string };
      response: { ok: true };
    }
  | {
      type: 'trino-delete-profile';
      service: 'trino';
      request: { name: string };
      response: { ok: true };
    }
  | {
      type: 'trino-set-active-profile';
      service: 'trino';
      request: { name: string };
      response: { ok: true };
    }
  | {
      type: 'trino-set-credentials';
      service: 'trino';
      request: {
        profile: string;
        kind: 'password' | 'bearerToken';
        secret: string;
      };
      response: { ok: true };
    }
  | {
      type: 'trino-ping-coordinator';
      service: 'trino';
      request: { profile?: string };
      response: TrinoCoordinatorPing;
    }
  | {
      type: 'trino-jump-to-model-from-query';
      service: 'trino';
      request: { queryId: string };
      response: { matched: boolean; modelMatch?: DjModelMatch };
    };

export type TrinoSystemNode = {
  http_uri: string;
  node_id: string;
  node_version: number;
  coordinator: boolean;
  state: string;
};

export type TrinoTable = {
  catalog: string;
  columns: TrinoTableColumn[];
  id: string;
  schema: string;
  table: string;
};

export type TrinoTableColumn = {
  column: string;
  comment: string;
  extra: string;
  type: string;
};
