/**
 * Cross-platform, shell-free process spawning.
 *
 * `safeSpawn` is a drop-in for `child_process.spawn` that never runs a shell, so
 * an argument -- including SQL text or identifiers derived from an untrusted
 * `dbt_project.yml` -- can never be reinterpreted as a command. On POSIX it
 * delegates straight to Node, which resolves the executable via `PATH` and
 * honors shebangs. On Windows it resolves the executable through `PATH` +
 * `PATHEXT` itself and, for `.cmd` / `.bat` batch files (which Node refuses to
 * run without a shell), routes through `cmd.exe /d /s /c` with cmd.exe-specific
 * escaping applied to the command and every argument, so metacharacters stay
 * inert.
 *
 * The Windows resolution and escaping are adapted from moxystudio/node-cross-spawn
 * (MIT) and npm/node-which (ISC).
 */
import type { ChildProcess, SpawnOptions } from 'child_process';
import { spawn as nodeSpawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const isWindows = process.platform === 'win32';

/** Extensions that require a shell (cmd.exe) to execute on Windows. */
const BATCH_FILE_PATTERN = /\.(?:bat|cmd)$/i;

/**
 * cmd.exe metacharacters that must be caret-escaped so they are treated as
 * literal data rather than shell syntax. See
 * http://www.robvanderwoude.com/escapechars.php
 */
const META_CHARS_PATTERN = /([()\][%!^"`<>&|;, *?])/g;

/** Fallback when `PATHEXT` is absent from the environment. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

/**
 * Spawn a child process without ever invoking a shell to interpret arguments.
 */
export function safeSpawn(
  command: string,
  args: readonly string[] = [],
  options: SpawnOptions = {},
): ChildProcess {
  const spawnOptions: SpawnOptions = { ...options, shell: false };

  if (!isWindows) {
    return nodeSpawn(command, args, spawnOptions);
  }

  const resolved = resolveWindowsCommand(command, spawnOptions);

  if (resolved && isBatchFile(resolved)) {
    const comspec = process.env.comspec || 'cmd.exe';
    // windowsVerbatimArguments: Node must not re-quote a command line we have
    // already escaped for cmd.exe.
    return nodeSpawn(comspec, buildBatchCmdArgs(resolved, args), {
      ...spawnOptions,
      windowsVerbatimArguments: true,
    });
  }

  // .exe / .com (or unresolved): spawn directly. Node/libuv performs standard
  // Windows argument quoting (arg-splitting only, no shell), so nothing here can
  // inject a command. If resolution failed, fall back to the bare command so
  // Node emits a native ENOENT.
  return nodeSpawn(resolved ?? command, args, spawnOptions);
}

/** True when `filePath` is a Windows batch file that needs a shell to run. */
export function isBatchFile(filePath: string): boolean {
  return BATCH_FILE_PATTERN.test(filePath);
}

/**
 * Caret-escape cmd.exe metacharacters in an executable path/name.
 */
export function escapeCommand(command: string): string {
  return command.replace(META_CHARS_PATTERN, '^$1');
}

/**
 * Escape a single argument for a `cmd.exe /c` command line. The value is quoted
 * (with backslashes and double quotes normalized) and its metacharacters are
 * caret-escaped twice, because cmd.exe parses a batch invocation's line in two
 * passes.
 */
export function escapeArgument(arg: string): string {
  const quoted = `"${String(arg)
    // Double up backslashes that precede a double quote, then escape the quote.
    .replace(/(\\*)"/g, '$1$1\\"')
    // Double up trailing backslashes so they don't escape the closing quote.
    .replace(/(\\*)$/, '$1$1')}"`;

  return quoted
    .replace(META_CHARS_PATTERN, '^$1')
    .replace(META_CHARS_PATTERN, '^$1');
}

/**
 * Build the `cmd.exe` argument vector that runs a resolved batch file with the
 * given arguments, with everything escaped so metacharacters cannot inject
 * commands.
 */
export function buildBatchCmdArgs(
  resolvedCommand: string,
  args: readonly string[],
): string[] {
  const commandLine = [
    escapeCommand(resolvedCommand),
    ...args.map((arg) => escapeArgument(arg)),
  ].join(' ');

  return ['/d', '/s', '/c', `"${commandLine}"`];
}

/** Case-insensitive lookup for an environment variable (Windows uses `Path`). */
function getEnvValue(
  env: NodeJS.ProcessEnv | undefined,
  key: string,
): string | undefined {
  if (!env) {
    return undefined;
  }
  const lowerKey = key.toLowerCase();
  for (const envKey of Object.keys(env)) {
    if (envKey.toLowerCase() === lowerKey) {
      return env[envKey];
    }
  }
  return undefined;
}

/** True when `filePath` exists as a regular file. */
function isExecutableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a command to a full executable path on Windows using `PATH` and
 * `PATHEXT`, honoring absolute/relative paths and the current directory (which
 * Windows searches before `PATH`). Returns `undefined` when nothing matches.
 */
function resolveWindowsCommand(
  command: string,
  options: SpawnOptions,
): string | undefined {
  const env = options.env ?? process.env;
  const pathExt = (getEnvValue(env, 'PATHEXT') ?? DEFAULT_PATHEXT)
    .split(path.delimiter)
    .filter(Boolean);
  const cwd = options.cwd ? String(options.cwd) : process.cwd();

  const hasPathSeparator = /[\\/]/.test(command);
  const baseName = hasPathSeparator ? path.basename(command) : command;
  const searchDirs = hasPathSeparator
    ? [path.resolve(cwd, path.dirname(command))]
    : [cwd, ...(getEnvValue(env, 'PATH') ?? '').split(path.delimiter)].filter(
        Boolean,
      );

  const lowerName = baseName.toLowerCase();
  const alreadyHasKnownExt = pathExt.some((ext) =>
    lowerName.endsWith(ext.toLowerCase()),
  );

  for (const dir of searchDirs) {
    const base = path.join(dir, baseName);

    if (alreadyHasKnownExt && isExecutableFile(base)) {
      return base;
    }
    for (const ext of pathExt) {
      const candidate = base + ext;
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}
