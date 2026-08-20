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

/** Narrow an unknown input to `{ request: Record<string, unknown> }`. */
function readRequest(input: unknown): Record<string, unknown> {
  const request =
    input && typeof input === 'object'
      ? (input as { request?: unknown }).request
      : undefined;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error(
      "model.create requires an object 'request' (see examples/model-create.request.json)",
    );
  }
  return { ...(request as Record<string, unknown>) };
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

  register({
    name: 'model.create',
    description:
      'Create a DJ model from a typed request (same payload the Create Model form posts). projectName is optional when the workspace has a single dbt project.',
    sideEffect: 'mutate',
    handler: async (input, ctx) => {
      const request = readRequest(input);
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
