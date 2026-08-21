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
 * Build the registry. `system.capabilities` enumerates the same object, so it
 * always reflects exactly what is registered.
 */
export function createOperationRegistry(): OperationRegistry {
  const registry: OperationRegistry = {};

  const register = (op: OperationDef): void => {
    registry[op.name] = op;
  };

  /**
   * Register a read (side-effect-free) op that forwards to a single API type.
   *   - `nullable`: the API ignores its request; forward `request: null`.
   *   - `project`:  the API needs a `projectName`; infer it when omitted.
   * Everything else forwards the caller's flat payload verbatim.
   */
  const registerRead = (
    name: string,
    apiType: string,
    description: string,
    opts: { nullable?: boolean; project?: boolean } = {},
  ): void =>
    register({
      name,
      description,
      sideEffect: 'read',
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

  registerRead(
    'dbt.projects',
    'dbt-fetch-projects',
    'List dbt projects in the workspace (includes the parsed manifest).',
    { nullable: true },
  );
  registerRead(
    'dbt.models',
    'dbt-fetch-available-models',
    'List available model names in a project (use to populate a model `from`). projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerRead(
    'dbt.sources',
    'dbt-fetch-sources',
    'List declared dbt source names (use to populate a model `from`).',
    { nullable: true },
  );
  registerRead(
    'dbt.modified-models',
    'dbt-fetch-modified-models',
    'List models changed versus the base ref (build/run scope). projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerRead(
    'dbt.compiled-status',
    'dbt-check-compiled-status',
    'Report whether a model is compiled (path/time). Requires { modelName }; projectName optional when a single dbt project exists.',
    { project: true },
  );
  registerRead(
    'dbt.model-outdated',
    'dbt-check-model-outdated',
    "Report whether a model's compiled output is stale. Requires { modelName }; projectName optional when a single dbt project exists.",
    { project: true },
  );

  registerRead('trino.catalogs', 'trino-fetch-catalogs', 'List Trino catalogs.', {
    nullable: true,
  });
  registerRead(
    'trino.schemas',
    'trino-fetch-schemas',
    'List schemas in a catalog. Requires { catalog }.',
  );
  registerRead(
    'trino.tables',
    'trino-fetch-tables',
    'List tables in a schema. Requires { catalog, schema }.',
  );
  registerRead(
    'trino.columns',
    'trino-fetch-columns',
    'List a table’s columns. Requires { catalog, schema, table }.',
  );

  register({
    name: 'model.create',
    description:
      'Create a DJ model from a typed request (same payload the Create Model form posts). projectName is optional when the workspace has a single dbt project.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input);
      if (!request) {
        throw new Error(
          "model.create requires an object payload (see examples/model-create.request.json)",
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
