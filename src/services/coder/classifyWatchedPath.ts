/**
 * Path classification for the file watcher.
 *
 * Pure helper extracted from `Coder.fetchFileInfoFromPath` so it can be tested
 * in isolation. Decides whether a watched path is one of the workspace-root
 * system files we treat specially (currently `.git/logs/HEAD`), a regular
 * model/source/sql/yml/json file, or something we should ignore.
 *
 * Important: this MUST detect `.git/logs/HEAD` before applying the extension
 * regex, because `HEAD` has no extension and an extension-based regex will
 * otherwise reject it. Missing this case means git checkout/pull events are
 * never recognized, `gitPending` is never set, and a branch switch ends up
 * syncing individual files against a stale dbt manifest.
 */

const SUPPORTED_EXTENSIONS = [
  'json',
  'model.json',
  'source.json',
  'sql',
  'yml',
] as const;

const FILE_EXTENSION_REGEX = /^(?:\/[^/]+)*\/([^/]+?)\.((?:[^/]+\.)?[^/]+)$/;

const GIT_LOG_HEAD_RELATIVE = '/.git/logs/HEAD';

export type ClassifiedWatchedPath =
  | { kind: 'git-log' }
  | { kind: 'regular'; name: string; extension: string; workspacePath: string }
  | { kind: 'unsupported' };

/**
 * Classify a watched filesystem path.
 *
 * @param filePath - Absolute path the watcher fired on.
 * @param workspaceRoot - Absolute workspace root (used only to derive the
 *   workspace-relative path for system-file detection).
 */
export function classifyWatchedPath(
  filePath: string,
  workspaceRoot: string,
): ClassifiedWatchedPath {
  if (!filePath) {
    return { kind: 'unsupported' };
  }

  const workspacePath = filePath.startsWith(workspaceRoot)
    ? filePath.slice(workspaceRoot.length)
    : filePath;

  // Workspace-root system files first, because some (HEAD) have no extension
  // and would be rejected by the extension regex below.
  if (workspacePath === GIT_LOG_HEAD_RELATIVE) {
    return { kind: 'git-log' };
  }

  const match = FILE_EXTENSION_REGEX.exec(filePath);
  if (!match) {
    return { kind: 'unsupported' };
  }

  const [, name, extension] = match;
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { kind: 'unsupported' };
  }

  return { kind: 'regular', name, extension, workspacePath };
}
