/**
 * The DJ bridge operation registry: the allowlist of things a terminal client
 * (CLI today, MCP later) is permitted to invoke, plus the thin handlers that
 * forward to the extension's existing typed API.
 *
 * Handlers never touch sockets and never invoke raw `dj.command.*` — they only
 * call `ctx.api.handleApi(...)`, the same entry point the webview uses. This
 * module is vscode-free and unit-testable with a mocked context.
 */
import type {
  OperationContext,
  OperationDef,
  OperationRegistry,
  SideEffect,
} from '@shared/cli/types';

/**
 * Normalize a CLI input payload into the `request` object `handleApi` expects.
 *
 * The CLI surface is flat: callers pass the model/query fields directly, not a
 * `{ request: {...} }` envelope. This accepts three shapes:
 *   - a flat payload `{ ...fields }` — the object *is* the request;
 *   - an explicit envelope `{ request: {...} }` — back-compat escape hatch;
 *   - nothing — for ops that take no request (`nullable`) or only an inferred
 *     `projectName` (`allowEmpty`, which yields an empty request to fill in).
 */
function readRequest(
  input: unknown,
  opts: { nullable?: boolean; allowEmpty?: boolean } = {},
): Record<string, unknown> | null {
  const emptyOrThrow = (message: string): Record<string, unknown> | null => {
    if (opts.nullable) {
      return null;
    }
    if (opts.allowEmpty) {
      return {};
    }
    throw new Error(message);
  };

  if (input === null || input === undefined) {
    return emptyOrThrow('This operation requires a JSON payload (object)');
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload must be a JSON object');
  }

  const obj = input as Record<string, unknown>;
  if ('request' in obj) {
    const inner = obj.request;
    if (inner === null || inner === undefined) {
      return emptyOrThrow("'request' may not be null for this operation");
    }
    if (typeof inner !== 'object' || Array.isArray(inner)) {
      throw new Error("'request' must be a JSON object");
    }
    return { ...(inner as Record<string, unknown>) };
  }
  return { ...obj };
}

/**
 * Resolve `projectName`: use the caller's value, else default to the sole dbt
 * project. With zero or multiple projects and no explicit name, error clearly.
 */
function resolveProjectName(
  request: Record<string, unknown>,
  ctx: OperationContext,
): void {
  const given = request.projectName;
  if (typeof given === 'string' && given.trim() !== '') {
    return;
  }
  const names = ctx.projectNames();
  if (names.length === 1) {
    request.projectName = names[0];
    return;
  }
  if (names.length === 0) {
    throw new Error('No dbt projects found in workspace');
  }
  throw new Error(
    `Multiple dbt projects found; set request.projectName to one of: ${names.join(', ')}`,
  );
}

/**
 * Guard `query.execute` to a single read-only statement. The bridge runs SQL
 * against the warehouse with no interactive confirmation, so we allow only
 * introspective/read statements and reject anything that could mutate.
 *
 * Strips SQL comments, rejects empty input and multiple statements, and
 * requires the leading keyword to be in a read-only allowlist.
 */
function assertReadOnlySelect(sql: string): void {
  // Strip block comments, then line comments, so keywords inside comments
  // cannot smuggle a statement past the leading-token check.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();

  if (stripped === '') {
    throw new Error('query.execute: SQL is empty after removing comments');
  }

  // Reject multiple statements: a semicolon followed by more non-empty SQL.
  const withoutTrailingSemis = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemis.includes(';')) {
    throw new Error(
      'query.execute: only a single read-only statement is allowed (no ";")',
    );
  }

  // Leading token, ignoring any wrapping parentheses (e.g. "(select ...)").
  const leading = withoutTrailingSemis.replace(/^[(\s]+/, '').split(/\s+/)[0];
  const token = (leading ?? '').toLowerCase();
  const allowed = new Set([
    'select',
    'with',
    'show',
    'describe',
    'desc',
    'explain',
  ]);
  if (!allowed.has(token)) {
    throw new Error(
      `query.execute: only read-only SELECT queries are permitted (got '${token || 'empty'}')`,
    );
  }
}

/**
 * Build the registry. `system.capabilities` enumerates the same object, so it
 * always reflects exactly what is registered.
 */
export function createOperationRegistry(): OperationRegistry {
  const registry: OperationRegistry = {};

  const register = (op: OperationDef): void => {
    registry[op.name] = op;
  };

  /**
   * Register an op that forwards to a single API type with no bespoke logic.
   *   - `nullable`:   the API ignores its request; forward `request: null`.
   *   - `project`:    the API needs a `projectName`; infer it when omitted.
   *   - `sideEffect`: defaults to `'read'`; set `'mutate'` for writes/runs.
   * Everything else forwards the caller's flat payload verbatim.
   */
  const registerForward = (
    name: string,
    apiType: string,
    description: string,
    opts: {
      nullable?: boolean;
      project?: boolean;
      sideEffect?: SideEffect;
    } = {},
  ): void =>
    register({
      name,
      description,
      sideEffect: opts.sideEffect ?? 'read',
      handler: async (input, ctx) => {
        const request = readRequest(input, {
          nullable: opts.nullable,
          allowEmpty: opts.project,
        });
        if (opts.project && request) {
          resolveProjectName(request, ctx);
        }
        return ctx.api.handleApi({ type: apiType, request });
      },
    });

  register({
    name: 'system.ping',
    description: 'Liveness/version check for the DJ bridge.',
    sideEffect: 'read',
    handler: (_input, ctx) =>
      Promise.resolve({
        ok: true,
        version: ctx.version,
        pid: process.pid,
      }),
  });

  register({
    name: 'system.capabilities',
    description: 'List the operations this bridge exposes.',
    sideEffect: 'read',
    handler: () =>
      Promise.resolve({
        operations: Object.values(registry).map((op) => ({
          name: op.name,
          description: op.description,
          sideEffect: op.sideEffect,
        })),
      }),
  });

  // ---- Read tier: introspect the workspace so an agent can ground its
  // `from` / `select` choices instead of guessing. ----

  registerForward(
    'dbt.projects',
    'dbt-fetch-projects',
    'List dbt projects in the workspace (includes the parsed manifest).',
    { nullable: true },
  );
  registerForward(
    'dbt.models',
    'dbt-fetch-available-models',
    'List available model names in a project (use to populate a model `from`). projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'dbt.sources',
    'dbt-fetch-sources',
    'List declared dbt source names (use to populate a model `from`).',
    { nullable: true },
  );
  registerForward(
    'dbt.modified-models',
    'dbt-fetch-modified-models',
    'List models changed versus the base ref (build/run scope). projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'dbt.compiled-status',
    'dbt-check-compiled-status',
    'Report whether a model is compiled (path/time). Requires { modelName }; projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'dbt.model-outdated',
    'dbt-check-model-outdated',
    "Report whether a model's compiled output is stale. Requires { modelName }; projectName optional when a single dbt project exists.",
    { project: true },
  );

  registerForward(
    'trino.catalogs',
    'trino-fetch-catalogs',
    'List Trino catalogs.',
    { nullable: true },
  );
  registerForward(
    'trino.schemas',
    'trino-fetch-schemas',
    'List schemas in a catalog. Requires { catalog }.',
  );
  registerForward(
    'trino.tables',
    'trino-fetch-tables',
    'List tables in a schema. Requires { catalog, schema }.',
  );
  registerForward(
    'trino.columns',
    'trino-fetch-columns',
    'List a table’s columns. Requires { catalog, schema, table }.',
  );

  // ---- Authoring tier: create and refine models/sources, driven by JSON —
  // the same flow the visual editor posts. ----

  register({
    name: 'model.create',
    description:
      'Create a DJ model from a typed request (same payload the Create Model form posts). projectName is optional when the workspace has a single dbt project.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input);
      if (!request) {
        throw new Error(
          'model.create requires an object payload (see examples/model-create.request.json)',
        );
      }
      resolveProjectName(request, ctx);
      const response = await ctx.api.handleApi({
        type: 'framework-model-create',
        request,
      });
      return { ok: true, response };
    },
  });

  registerForward(
    'source.create',
    'framework-source-create',
    'Create a source definition from a Trino table (columns auto-introspected). projectName optional when a single dbt project exists.',
    { project: true, sideEffect: 'mutate' },
  );
  registerForward(
    'model.update',
    'framework-model-update',
    'Update an existing model (merge, validate, relocate on rename). projectName optional when a single dbt project exists.',
    { project: true, sideEffect: 'mutate' },
  );
  registerForward(
    'model.preview',
    'framework-model-preview',
    'Dry-run a model: return the generated SQL / YAML / columns without writing. projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'model.exists',
    'framework-check-model-exists',
    'Check whether a model already exists (pre-flight dedup guard). projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'model.cte-analysis',
    'framework-model-cte-analysis',
    'Return per-CTE inferred columns + diagnostics. projectName optional when a single dbt project exists.',
    { project: true },
  );

  // ---- Mutate tier: compile / parse / run to validate authored models. ----

  registerForward(
    'dbt.compile',
    'dbt-model-compile',
    'Compile a single model. Requires { modelName }; projectName optional when a single dbt project exists.',
    { project: true, sideEffect: 'mutate' },
  );
  registerForward(
    'dbt.compile-logs',
    'dbt-compile-with-logs',
    'Compile a model (log-emitting variant). Requires { modelName }; projectName optional when a single dbt project exists.',
    { project: true, sideEffect: 'mutate' },
  );

  register({
    name: 'dbt.parse',
    description:
      'Parse the project and refresh the manifest. projectName optional when a single dbt project exists.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input, { allowEmpty: true });
      // `allowEmpty` guarantees a non-null object here.
      resolveProjectName(request as Record<string, unknown>, ctx);
      const name = (request as Record<string, unknown>).projectName as string;
      const project = ctx.getProject?.(name);
      if (!project) {
        throw new Error(`dbt.parse: project '${name}' is not loaded`);
      }
      return ctx.api.handleApi({
        type: 'dbt-parse-project',
        request: { project },
      });
    },
  });

  register({
    name: 'dbt.run',
    description:
      'Run a model via dbt (output streams to the VS Code terminal). Accepts a { config } object or flat config fields; projectName optional when a single dbt project exists.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input, { allowEmpty: true }) as Record<
        string,
        unknown
      >;
      // Accept either an explicit { config: {...} } or flat config fields.
      const config =
        request.config &&
        typeof request.config === 'object' &&
        !Array.isArray(request.config)
          ? (request.config as Record<string, unknown>)
          : request;
      resolveProjectName(config, ctx);
      await ctx.api.handleApi({
        type: 'dbt-run-model',
        request: { config },
      });
      return {
        ok: true,
        note: 'dbt run started; output streams to the VS Code terminal.',
      };
    },
  });

  // ---- Query & data read tier: read compiled SQL, preview data, trace
  // lineage — all read-only. ----

  registerForward(
    'model.compiled-sql',
    'data-explorer-get-compiled-sql',
    "Read a model's compiled SQL. Requires { modelName }; projectName optional when a single dbt project exists.",
    { project: true },
  );
  registerForward(
    'model.query',
    'data-explorer-execute-query',
    "Run a model's compiled query (data preview). Requires { modelName }; projectName optional when a single dbt project exists.",
    { project: true },
  );
  registerForward(
    'model.lineage',
    'data-explorer-get-model-lineage',
    "Get a model's upstream / downstream lineage. Requires { modelName }; projectName optional when a single dbt project exists.",
    { project: true },
  );
  registerForward(
    'model.reverse-lineage',
    'data-explorer-get-reverse-lineage',
    'Trace lineage from a dashboard / chart back to models. Requires { kind, slug }.',
  );

  register({
    name: 'query.execute',
    description:
      'Run an arbitrary read-only SELECT against the warehouse. Requires { sql }; optional { limit }.',
    sideEffect: 'read',
    handler: async (input, ctx) => {
      const request = readRequest(input);
      const sql = request?.sql;
      if (typeof sql !== 'string' || sql.trim() === '') {
        throw new Error("query.execute requires a non-empty 'sql' string");
      }
      assertReadOnlySelect(sql);
      const forwarded: Record<string, unknown> = { sql };
      if (request && 'limit' in request) {
        forwarded.limit = request.limit;
      }
      return ctx.api.handleApi({
        type: 'query-draft-execute',
        request: forwarded,
      });
    },
  });

  return registry;
}

/**
 * Dispatch one operation. Transport-agnostic: the socket server and any future
 * adapter both funnel through here. Throws on unknown operation; handler errors
 * propagate to the caller for normalization.
 */
export async function dispatch(
  registry: OperationRegistry,
  operation: string,
  input: unknown,
  ctx: OperationContext,
): Promise<unknown> {
  const op = registry[operation];
  if (!op) {
    throw new Error(`Unknown operation: ${operation}`);
  }
  return op.handler(input, ctx);
}
