/**
 * CliBridgeServer — the in-editor doorman for terminal clients.
 *
 * Owns a per-session Unix domain socket inside the extension host, authenticates
 * callers with a random token, and dispatches allowlisted operations through the
 * shared registry into the extension's existing typed API. Runs on macOS/Linux;
 * no-ops on win32 (named-pipe transport is a later task).
 */
import {
  createOperationRegistry,
  dispatch,
} from '@services/cliBridge/operationRegistry';
import type {
  EndpointDescriptor,
  OperationContext,
  OperationRegistry,
  RpcRequest,
  RpcResponse,
} from '@shared/cli/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

interface BridgeLogger {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

export interface CliBridgeServerOptions {
  /** Thin view of the extension's typed API dispatcher. */
  api: { handleApi: (payload: unknown) => Promise<unknown> };
  /** Names of the dbt projects currently loaded. */
  projectNames: () => string[];
  /** Resolve a loaded dbt project object by name (for dbt.parse). */
  getProject: (name: string) => unknown;
  /** Extension version (surfaced by system.ping). */
  version: string;
  /** Directory for endpoint descriptors, e.g. `.dj/state/cli-endpoints`. */
  endpointsDir: string;
  log: BridgeLogger;
}

/** True if a pid is alive (EPERM still means the process exists). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class CliBridgeServer {
  private readonly opts: CliBridgeServerOptions;
  private readonly registry: OperationRegistry;
  private server?: net.Server;
  private token = '';
  private socketPath = '';
  private descriptorPath = '';
  private started = false;

  constructor(opts: CliBridgeServerOptions) {
    this.opts = opts;
    this.registry = createOperationRegistry();
  }

  /** Idempotent. Starts the socket + writes the endpoint descriptor. */
  start(): void {
    if (this.started) {
      return;
    }
    if (process.platform === 'win32') {
      this.opts.log.info(
        '[dj-bridge] Windows is not supported yet; CLI bridge disabled.',
      );
      return;
    }
    try {
      fs.mkdirSync(this.opts.endpointsDir, { recursive: true });
      this.reapStaleDescriptors();

      const sessionId = crypto.randomBytes(6).toString('hex');
      this.token = crypto.randomBytes(32).toString('hex');
      this.socketPath = path.join(os.tmpdir(), `dj-${sessionId}.sock`);
      this.descriptorPath = path.join(
        this.opts.endpointsDir,
        `${sessionId}.json`,
      );

      // Clear any leftover socket file at this path.
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* not present — fine */
      }

      this.server = net.createServer((socket) =>
        this.handleConnection(socket),
      );
      this.server.on('error', (err) =>
        this.opts.log.error('[dj-bridge] server error:', err),
      );
      this.server.listen(this.socketPath, () => {
        this.writeDescriptor();
        this.started = true;
        this.opts.log.info(
          `[dj-bridge] listening on ${this.socketPath} (session ${sessionId})`,
        );
      });
    } catch (err: unknown) {
      this.opts.log.error('[dj-bridge] failed to start:', err);
    }
  }

  /** Idempotent. Closes the socket and removes socket + descriptor files. */
  stop(): void {
    if (!this.started && !this.server) {
      return;
    }
    try {
      this.server?.close();
    } catch (err: unknown) {
      this.opts.log.error('[dj-bridge] error closing server:', err);
    }
    this.server = undefined;
    this.safeUnlink(this.socketPath);
    this.safeUnlink(this.descriptorPath);
    this.started = false;
  }

  private writeDescriptor(): void {
    const descriptor: EndpointDescriptor = {
      socketPath: this.socketPath,
      token: this.token,
      pid: process.pid,
      version: this.opts.version,
      startedAt: new Date().toISOString(),
    };
    // Write then tighten perms (token must stay user-only).
    fs.writeFileSync(this.descriptorPath, JSON.stringify(descriptor), {
      mode: 0o600,
    });
    try {
      fs.chmodSync(this.descriptorPath, 0o600);
    } catch {
      /* best effort */
    }
  }

  /** Remove descriptors whose owning process is gone (crash cleanup). */
  private reapStaleDescriptors(): void {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.opts.endpointsDir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      const full = path.join(this.opts.endpointsDir, file);
      try {
        const desc = JSON.parse(
          fs.readFileSync(full, 'utf8'),
        ) as EndpointDescriptor;
        if (!desc.pid || !pidAlive(desc.pid)) {
          this.safeUnlink(full);
          this.safeUnlink(desc.socketPath);
        }
      } catch {
        // Malformed — drop it.
        this.safeUnlink(full);
      }
    }
  }

  private handleConnection(socket: net.Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== '') {
          void this.handleLine(line, socket);
        }
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', (err) =>
      this.opts.log.error('[dj-bridge] socket error:', err),
    );
  }

  private async handleLine(line: string, socket: net.Socket): Promise<void> {
    let req: RpcRequest | undefined;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      this.reply(socket, { id: null, error: { message: 'Invalid JSON' } });
      return;
    }

    const id = req.id ?? null;
    const params = req.params;
    if (params?.token !== this.token) {
      this.reply(socket, { id, error: { message: 'Unauthorized' } });
      return;
    }

    const ctx: OperationContext = {
      api: this.opts.api,
      projectNames: this.opts.projectNames,
      getProject: this.opts.getProject,
      version: this.opts.version,
      log: this.opts.log,
    };

    try {
      const result = await dispatch(
        this.registry,
        params.operation,
        params.input,
        ctx,
      );
      this.reply(socket, { id, result });
    } catch (err: unknown) {
      this.reply(socket, { id, error: this.normalizeError(err) });
    }
  }

  private normalizeError(err: unknown): { message: string; details?: unknown } {
    if (err instanceof Error) {
      const details = (err as { details?: unknown }).details;
      return details === undefined
        ? { message: err.message }
        : { message: err.message, details };
    }
    if (typeof err === 'string') {
      return { message: err };
    }
    return { message: 'Unknown error' };
  }

  private reply(socket: net.Socket, response: RpcResponse): void {
    try {
      socket.write(JSON.stringify(response) + '\n');
    } catch (err: unknown) {
      this.opts.log.error('[dj-bridge] failed to write reply:', err);
    }
  }

  private safeUnlink(target: string): void {
    if (!target) {
      return;
    }
    try {
      fs.unlinkSync(target);
    } catch {
      /* already gone */
    }
  }
}
