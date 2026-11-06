import * as fs from 'fs';
import * as path from 'path';

/** Markers git leaves in the git dir while a multi-step operation is paused. */
const GIT_OPERATION_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
];

/**
 * Locate the git directory for `startDir` by walking up to the nearest `.git`.
 * Handles worktrees and submodules, where `.git` is a file containing
 * `gitdir: <path>`.
 */
export function findGitDir(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
      if (stat.isFile()) {
        const match = /^gitdir:\s*(.+)$/m.exec(
          fs.readFileSync(candidate, 'utf8'),
        );
        if (match) {
          return path.resolve(dir, match[1].trim());
        }
      }
    } catch {
      /* no .git at this level */
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** True while a merge, rebase, cherry-pick, or revert is in progress. */
export function isGitOperationInProgress(startDir: string): boolean {
  const gitDir = findGitDir(startDir);
  if (!gitDir) {
    return false;
  }
  return GIT_OPERATION_MARKERS.some((marker) =>
    fs.existsSync(path.join(gitDir, marker)),
  );
}
