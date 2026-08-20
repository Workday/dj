/**
 * `dj` — the thin CLI client for the DJ bridge.
 *
 * Deployed by the extension to `.dj/bin/dj` (a self-contained node bundle). It
 * discovers the running extension's bridge endpoint, authenticates with the
 * per-session token, sends one operation, and prints the JSON result.
 *
 * IMPORTANT: vscode-free. Only node builtins + `@shared/cli/types`. A `vscode`
 * import here must fail the CLI bundle — that is the guardrail.
 *
 * Usage:
 *   dj system.ping
 *   dj system.capabilities
 *   dj model.create --file req.json
 *   dj model.create --json '{"request":{...}}'
 *   echo '{"request":{...}}' | dj model.create
 *
 * Exit codes: 0 ok · 1 operation error · 2 usage/bad-input · 3 no live endpoint · 4 timeout
 */
import type {
  EndpointDescriptor,
  RpcRequest,
  RpcResponse,
} from '@shared/cli/types';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

const EXIT_OK = 0;
const EXIT_OP_ERROR = 1;
const EXIT_USAGE = 2;
const EXIT_NO_ENDPOINT = 3;
const EXIT_TIMEOUT = 4;

interface Args {
  operation?: string;
  file?: string;
  json?: string;
  workspace?: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') {
      args.file = argv[++i];
    } else if (a === '--json') {
      args.json = argv[++i];
    } else if (a === '--workspace') {
      args.workspace = argv[++i];
    } else if (a === '--timeout') {
      args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    } else if (!a.startsWith('-') && !args.operation) {
      args.operation = a;
    }
  }
  return args;
}

function fail(code: number, message: string): never {
  process.stderr.write(`dj: ${message}\n`);
  process.exit(code);
}

/** Walk up from `start` to find `.dj/state/cli-endpoints`. */
function findEndpointsDir(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.dj', 'state', 'cli-endpoints');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** Load descriptors newest-first. */
function loadDescriptors(dir: string): EndpointDescriptor[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const descriptors: EndpointDescriptor[] = [];
  for (const file of files) {
    try {
      descriptors.push(
        JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf8'),
        ) as EndpointDescriptor,
      );
    } catch {
      /* skip malformed */
    }
  }
  descriptors.sort((a, b) =>
    (b.startedAt || '').localeCompare(a.startedAt || ''),
  );
  return descriptors;
}

function readInput(args: Args): unknown {
  if (args.file !== undefined) {
    let raw: string;
    try {
      raw = fs.readFileSync(args.file, 'utf8');
    } catch {
      fail(EXIT_USAGE, `cannot read --file ${args.file}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      fail(EXIT_USAGE, `--file ${args.file} is not valid JSON`);
    }
  }
  if (args.json !== undefined) {
    try {
      return JSON.parse(args.json);
    } catch {
      fail(EXIT_USAGE, '--json is not valid JSON');
    }
  }
  // Piped stdin (only when not a TTY). A read failure (closed fd, /dev/null,
  // or EAGAIN on an empty non-blocking stdin) or empty content means "no input"
  // — not bad input — so read-only ops like system.ping still work with no
  // stdin. Only genuinely non-empty, unparseable stdin is a usage error.
  if (!process.stdin.isTTY) {
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8').trim();
    } catch {
      return undefined;
    }
    if (raw === '') {
      return undefined;
    }
    try {
      return JSON.parse(raw);
    } catch {
      fail(EXIT_USAGE, 'stdin is not valid JSON');
    }
  }
  return undefined;
}

interface SendError extends Error {
  code?: string;
}

function connectAndSend(
  descriptor: EndpointDescriptor,
  request: RpcRequest,
  timeoutMs: number,
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.socketPath);
    let buffer = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        socket.destroy();
        const err: SendError = new Error('timed out waiting for DJ');
        err.code = 'TIMEOUT';
        reject(err);
      });
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) {
        finish(() => {
          socket.end();
          try {
            resolve(JSON.parse(buffer.slice(0, newline)) as RpcResponse);
          } catch {
            const err: SendError = new Error('malformed reply from DJ');
            err.code = 'BADREPLY';
            reject(err);
          }
        });
      }
    });
    socket.on('error', (err: SendError) => {
      finish(() => {
        err.code = err.code || 'CONNECT';
        reject(err);
      });
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.operation) {
    fail(
      EXIT_USAGE,
      'usage: dj <operation> [--file req.json | --json <str>] [--workspace <dir>]',
    );
  }
  const input = readInput(args);

  const endpointsDir = findEndpointsDir(args.workspace || process.cwd());
  if (!endpointsDir) {
    fail(
      EXIT_NO_ENDPOINT,
      'no .dj/state/cli-endpoints found (open the workspace in VS Code with DJ active)',
    );
  }
  const descriptors = loadDescriptors(endpointsDir);
  if (descriptors.length === 0) {
    fail(EXIT_NO_ENDPOINT, 'no DJ bridge endpoint registered');
  }

  for (const descriptor of descriptors) {
    const request: RpcRequest = {
      id: 1,
      method: 'dispatch',
      params: {
        token: descriptor.token,
        operation: args.operation,
        input,
      },
    };
    try {
      const reply = await connectAndSend(descriptor, request, args.timeoutMs);
      if (reply.error) {
        process.stderr.write(`dj: ${reply.error.message}\n`);
        if (reply.error.details !== undefined) {
          process.stderr.write(JSON.stringify(reply.error.details) + '\n');
        }
        process.exit(EXIT_OP_ERROR);
      }
      process.stdout.write(JSON.stringify(reply.result, null, 2) + '\n');
      process.exit(EXIT_OK);
    } catch (err: unknown) {
      const code = (err as SendError).code;
      if (code === 'TIMEOUT') {
        fail(EXIT_TIMEOUT, (err as Error).message);
      }
      if (code === 'BADREPLY') {
        fail(EXIT_OP_ERROR, (err as Error).message);
      }
      // CONNECT / ECONNREFUSED / ENOENT → try the next (stale) descriptor.
    }
  }

  fail(
    EXIT_NO_ENDPOINT,
    'no live DJ endpoint responded (is VS Code open with DJ active?)',
  );
}

void main();
