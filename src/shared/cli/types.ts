/**
 * Transport-agnostic contracts for the DJ CLI bridge.
 *
 * IMPORTANT: this module MUST stay vscode-free. It is imported by both the
 * extension-host bridge server AND the standalone CLI bundle (`dist/cli/dj.js`),
 * and the CLI must never pull in the `vscode` module. Keep it to plain types +
 * tiny constants only.
 */

/** JSON-RPC-ish request sent by a CLI client to the bridge server. */
export interface RpcRequest {
  id: number | string;
  method: 'dispatch';
  params: {
    /** Per-session token proving the caller read the endpoint descriptor. */
    token: string;
    /** Registry operation name, e.g. `model.create`. */
    operation: string;
    /** Operation-specific input payload. */
    input?: unknown;
  };
}

/** Reply from the bridge server. Exactly one of `result` / `error` is set. */
export interface RpcResponse {
  id: number | string | null;
  result?: unknown;
  error?: RpcError;
}

export interface RpcError {
  message: string;
  /** Optional structured detail forwarded from the underlying handler. */
  details?: unknown;
}

/**
 * Descriptor written by the running extension to
 * `.dj/state/cli-endpoints/<sessionId>.json` (mode 0600) so a CLI can find and
 * authenticate to the live bridge. `.dj` is gitignored, so the token is safe.
 */
export interface EndpointDescriptor {
  /** Absolute path of the Unix domain socket (kept in os.tmpdir()). */
  socketPath: string;
  /** Per-session auth token. */
  token: string;
  /** Extension-host process id (used to reap stale descriptors). */
  pid: number;
  /** Extension version, surfaced by `system.ping`. */
  version: string;
  /** ISO timestamp; newest live endpoint wins when several exist. */
  startedAt: string;
}

/** Side-effect class of an operation; surfaced via `system.capabilities`. */
export type SideEffect = 'read' | 'mutate';

/**
 * Context handed to every operation handler. Deliberately structural (no Api /
 * Dbt / vscode imports) so the registry stays decoupled and unit-testable.
 */
export interface OperationContext {
  /** Thin view of the extension's typed API dispatcher. */
  api: { handleApi: (payload: unknown) => Promise<unknown> };
  /** Names of the dbt projects currently loaded (for projectName resolution). */
  projectNames: () => string[];
  /** Extension version. */
  version: string;
  log?: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface OperationDef {
  name: string;
  description: string;
  sideEffect: SideEffect;
  handler: (input: unknown, ctx: OperationContext) => Promise<unknown>;
}

export type OperationRegistry = Record<string, OperationDef>;

/** Directory (relative to workspace root) holding endpoint descriptors. */
export const CLI_ENDPOINTS_DIRNAME = 'cli-endpoints';
