/**
 * The DJ bridge operation registry: the allowlist of things a terminal client
 * (CLI today, MCP later) is permitted to invoke, plus the thin handlers that
 * forward to the extension's existing typed API.
 *
 * Handlers never touch sockets and never invoke raw `dj.command.*` — they only
 * call `ctx.api.handleApi(...)`, the same entry point the webview uses. This
 * module is vscode-free and unit-testable with a mocked context.
 */
import {
  assertModelExistsPayload,
  assertModelUpdatePayload,
  assertNonEmptyModelName,
  assertQueryExecutePayload,
  assertWrappedModelJsonPayload,
  normalizeDbtCompileRequest,
  normalizeWrappedModelRequest,
} from '@services/cliBridge/requestShape';
import type {
  OperationContext,
  OperationDef,
  OperationRegistry,
  SideEffect,
} from '@shared/cli/types';
import {
  formatGlobalHelp,
  formatOperationHelpSummary,
  listOperationHelp,
} from '@shared/cli/operationHelp';

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

  const registerModelNameOp = (
    name: string,
    apiType: string,
    description: string,
    exampleFile: string,
  ): void =>
    register({
      name,
      description,
      sideEffect: 'read',
      handler: async (input, ctx) => {
        const request = readRequest(input, { allowEmpty: true }) as Record<
          string,
          unknown
        >;
        assertNonEmptyModelName(name, request, exampleFile);
        resolveProjectName(request, ctx);
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
    'dbt.models.search',
    'dbt-search-models',
    'Search models with filters: pattern (*wildcards*), topic, group, tags[], fromModel, requireLightdashExploreTag. Returns name, path, labels, materialization. projectName optional when a single dbt project exists.',
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

  registerForward(
    'model.get',
    'framework-get-model-data',
    'Read an existing model’s .model.json (template for update or extend). Requires { modelName }.',
  );
  registerModelNameOp(
    'model.columns',
    'framework-model-columns',
    'Resolved column list (name, dim/fct, types) from manifest/synced YAML. Requires { modelName }; projectName optional when a single dbt project exists.',
    'examples/model-columns.request.json',
  );
  registerForward(
    'model.similar',
    'framework-model-similar',
    'Find peer models (same from.model, group, topic, tags). Pass modelName or explicit anchors. projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerForward(
    'lightdash.assets',
    'data-explorer-list-lightdash-assets',
    'List Lightdash dashboards/charts with linked dbt model names. Optional { query } filters by name/slug/model; { force: true } rescans disk.',
    { nullable: true },
  );
  registerForward(
    'workflow.scaffold-explore',
    'framework-workflow-scaffold-explore',
    'Suggest int/mart names and similar explores for a new Lightdash explore from an upstream model. Requires { upstreamModelName }; projectName optional when a single dbt project exists.',
    { project: true },
  );

  // ---- Authoring tier: create and refine models/sources, driven by JSON —
  // the same flow the visual editor posts. ----

  register({
    name: 'model.sync',
    description:
      'Generate or refresh workspace models/**/*.sql and *.yml from .model.json / .source.json (DJ JSON sync). Optional modelName scopes to one model; omit for full sync. Does not run dbt compile (use dbt.compile for target/compiled SQL only). projectName optional when a single dbt project exists.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input, { allowEmpty: true }) as Record<
        string,
        unknown
      >;
      resolveProjectName(request, ctx);
      return ctx.api.handleApi({
        type: 'framework-model-sync',
        request,
      });
    },
  });

  register({
    name: 'model.create-batch',
    description:
      'Create multiple models in one request; enqueues a single JSON sync at the end (syncOnce defaults true). Requires { models: [ … ] }; projectName optional when a single dbt project exists.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input);
      if (!request) {
        throw new Error('model.create-batch requires a JSON payload');
      }
      resolveProjectName(request, ctx);
      return ctx.api.handleApi({
        type: 'framework-model-create-batch',
        request,
      });
    },
  });

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
  const registerWrappedModelOp = (
    name: string,
    apiType: string,
    description: string,
    validate: (request: Record<string, unknown>) => void,
    sideEffect: SideEffect = 'read',
    autoWrapFlat = false,
  ): void =>
    register({
      name,
      description,
      sideEffect,
      handler: async (input, ctx) => {
        let request = readRequest(input, { allowEmpty: true });
        if (!request) {
          throw new Error(`${name} requires a JSON payload (object)`);
        }
        if (autoWrapFlat) {
          request = normalizeWrappedModelRequest(request);
        }
        resolveProjectName(request, ctx);
        validate(request);
        return ctx.api.handleApi({ type: apiType, request });
      },
    });

  registerWrappedModelOp(
    'model.update',
    'framework-model-update',
    'Update an existing model (merge, validate, relocate on rename). Requires originalModelPath + modelJson. projectName optional when a single dbt project exists.',
    assertModelUpdatePayload,
    'mutate',
  );
  registerWrappedModelOp(
    'model.preview',
    'framework-model-preview',
    'Dry-run a model: return the generated SQL / YAML / columns without writing. Requires modelJson (flat create JSON is auto-wrapped). projectName optional when a single dbt project exists.',
    (req) => assertWrappedModelJsonPayload('model.preview', req),
    'read',
    true,
  );
  registerWrappedModelOp(
    'model.exists',
    'framework-check-model-exists',
    'Check whether a model already exists (pre-flight dedup guard). Requires modelJson with type, group, topic, name. projectName optional when a single dbt project exists.',
    assertModelExistsPayload,
  );
  registerWrappedModelOp(
    'model.cte-analysis',
    'framework-model-cte-analysis',
    'Return per-CTE inferred columns + diagnostics. Requires modelJson (flat create JSON is auto-wrapped). projectName optional when a single dbt project exists.',
    (req) => assertWrappedModelJsonPayload('model.cte-analysis', req),
    'read',
    true,
  );

  // ---- Mutate tier: compile / parse / run to validate authored models. ----

  const registerDbtCompileOp = (
    name: string,
    apiType: 'dbt-model-compile' | 'dbt-compile-with-logs',
    description: string,
  ): void =>
    register({
      name,
      description,
      sideEffect: 'mutate',
      handler: async (input, ctx) => {
        const raw = readRequest(input, { allowEmpty: true }) as Record<
          string,
          unknown
        >;
        const normalized = normalizeDbtCompileRequest(name, raw);
        const request: Record<string, unknown> = { ...normalized };
        resolveProjectName(request, ctx);
        return ctx.api.handleApi({ type: apiType, request });
      },
    });

  registerDbtCompileOp(
    'dbt.compile',
    'dbt-model-compile',
    'Run dbt compile (writes target/compiled SQL only — not workspace models/**/*.sql). Requires { modelName } or { select } (raw dbt selector); projectName optional when a single dbt project exists. To emit disk .sql/.yml from .model.json use model.sync.',
  );
  registerDbtCompileOp(
    'dbt.compile-logs',
    'dbt-compile-with-logs',
    'Same as dbt.compile with log streaming to the Model Run webview. Requires { modelName } or { select }; projectName optional when a single dbt project exists.',
  );

  register({
    name: 'dbt.compile-select',
    description:
      'Run dbt compile for a dbt selector string (same as dbt.compile with { select }). projectName optional when a single dbt project exists.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const raw = readRequest(input, { allowEmpty: true }) as Record<
        string,
        unknown
      >;
      if (typeof raw.select !== 'string' || raw.select.trim() === '') {
        throw new Error(
          'dbt.compile-select: requires non-empty "select" (dbt selector string).',
        );
      }
      const normalized = normalizeDbtCompileRequest('dbt.compile-select', raw);
      const request: Record<string, unknown> = { ...normalized };
      resolveProjectName(request, ctx);
      return ctx.api.handleApi({ type: 'dbt-model-compile', request });
    },
  });

  register({
    name: 'dbt.parse',
    description:
      'Parse the project and refresh the manifest (can take minutes on large projects — use dj --timeout 600000). projectName optional when a single dbt project exists.',
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
      'Run a model via dbt (output streams to the VS Code terminal). Accepts { config } or flat fields: modelName, scope, lineage (upstream→+model, full-lineage→+model+), select (raw dbt selector override), startDate/endDate→event_dates vars. Warehouse write — confirm with user. projectName optional when a single dbt project exists.',
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

  register({
    name: 'model.lineage',
    description:
      "Get upstream/downstream lineage. CLI defaults depth to -1 (walk to sources) unless overridden. Optional maxNodes (default 50). Requires { modelName }; projectName optional when a single dbt project exists.",
    sideEffect: 'read',
    handler: async (input, ctx) => {
      const request = readRequest(input, { allowEmpty: true }) as Record<
        string,
        unknown
      >;
      assertNonEmptyModelName(
        'model.lineage',
        request,
        'examples/model-lineage.request.json',
      );
      resolveProjectName(request, ctx);
      if (request.depth === undefined) {
        request.depth = -1;
      }
      return ctx.api.handleApi({
        type: 'data-explorer-get-model-lineage',
        request,
      });
    },
  });
  registerModelNameOp(
    'model.compiled-sql',
    'data-explorer-get-compiled-sql',
    "Read a model's compiled SQL. Requires { modelName }; projectName optional when a single dbt project exists.",
    'examples/model-lineage.request.json',
  );
  registerModelNameOp(
    'model.query',
    'data-explorer-execute-query',
    "Run a model's compiled SQL via Trino (not the deployed warehouse relation). Optional schemaColumns, includeHiddenDims, aggregations { groupBy, metrics }. Requires { modelName }; projectName optional when a single dbt project exists.",
    'examples/model-query.request.json',
  );
  register({
    name: 'model.data-check',
    description:
      'Return read-only sanity-check SQL from a template (stranded_capacity, utilization_band, recent_partition_window). Requires { modelName, template }; projectName optional when a single dbt project exists.',
    sideEffect: 'read',
    handler: async (input, ctx) => {
      const request = readRequest(input, { allowEmpty: true }) as Record<
        string,
        unknown
      >;
      assertNonEmptyModelName(
        'model.data-check',
        request,
        'examples/model-lineage.request.json',
      );
      resolveProjectName(request, ctx);
      return ctx.api.handleApi({
        type: 'framework-model-data-check',
        request,
      });
    },
  });
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
      const request = readRequest(input, {
        allowEmpty: true,
      }) as Record<string, unknown> | null;
      assertQueryExecutePayload(request);
      const sql = request!.sql as string;
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

  register({
    name: 'system.help',
    description:
      'Invoke help for one operation (JSON) or list all operations when input is omitted.',
    sideEffect: 'read',
    handler: (input) => {
      const request =
        input === null || input === undefined
          ? null
          : readRequest(input, { allowEmpty: true });
      const opName =
        request && typeof request.operation === 'string'
          ? request.operation.trim()
          : '';
      if (!opName) {
        return Promise.resolve({
          ...formatGlobalHelp(),
          operations: listOperationHelp().map((h) => ({
            operation: h.operation,
            description: h.description,
            exampleCommand: h.exampleCommand,
          })),
        });
      }
      return Promise.resolve(formatOperationHelpSummary(opName));
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
