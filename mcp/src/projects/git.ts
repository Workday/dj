import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    stdout: typeof stdout === 'string' ? stdout : String(stdout),
    stderr: typeof stderr === 'string' ? stderr : String(stderr),
  };
}

export async function findGitRoot(startPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(startPath, [
      'rev-parse',
      '--show-toplevel',
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function ensureGitMirror(params: {
  id: string;
  url: string;
  ref: string;
  mirrorPath: string;
}): Promise<{ gitRoot: string; sha: string }> {
  const { url, ref, mirrorPath } = params;
  fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });

  if (!fs.existsSync(path.join(mirrorPath, '.git'))) {
    if (fs.existsSync(mirrorPath)) {
      fs.rmSync(mirrorPath, { recursive: true, force: true });
    }
    await runGit(path.dirname(mirrorPath), [
      'clone',
      '--branch',
      ref,
      '--single-branch',
      url,
      mirrorPath,
    ]);
  } else {
    await runGit(mirrorPath, ['fetch', 'origin', ref]);
    await runGit(mirrorPath, ['checkout', ref]);
    try {
      await runGit(mirrorPath, ['reset', '--hard', `origin/${ref}`]);
    } catch {
      await runGit(mirrorPath, ['reset', '--hard', 'FETCH_HEAD']);
    }
  }

  const { stdout } = await runGit(mirrorPath, ['rev-parse', 'HEAD']);
  return { gitRoot: mirrorPath, sha: stdout.trim() };
}

export async function createWorktree(params: {
  gitRoot: string;
  worktreePath: string;
  baseSha: string;
}): Promise<void> {
  const { gitRoot, worktreePath, baseSha } = params;
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await runGit(gitRoot, [
    'worktree',
    'add',
    '--detach',
    worktreePath,
    baseSha,
  ]);
}

export async function removeWorktree(params: {
  gitRoot: string;
  worktreePath: string;
}): Promise<void> {
  try {
    await runGit(params.gitRoot, [
      'worktree',
      'remove',
      '--force',
      params.worktreePath,
    ]);
  } catch {
    if (fs.existsSync(params.worktreePath)) {
      fs.rmSync(params.worktreePath, { recursive: true, force: true });
    }
  }
}

export async function currentSha(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

export async function defaultBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await runGit(cwd, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
    ]);
    const ref = stdout.trim();
    const parts = ref.split('/');
    return parts[parts.length - 1] || 'main';
  } catch {
    return 'main';
  }
}

export async function createBranchCommitPush(params: {
  worktreePath: string;
  branch: string;
  relativeFiles: string[];
  commitMessage: string;
  remote?: string;
}): Promise<{ commitSha: string }> {
  const remote = params.remote ?? 'origin';
  await runGit(params.worktreePath, ['checkout', '-B', params.branch]);
  if (params.relativeFiles.length) {
    await runGit(params.worktreePath, ['add', '--', ...params.relativeFiles]);
  }
  await runGit(params.worktreePath, ['commit', '-m', params.commitMessage]);
  const commitSha = await currentSha(params.worktreePath);
  await runGit(params.worktreePath, ['push', '-u', remote, params.branch]);
  return { commitSha };
}

export async function createPullRequest(params: {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}): Promise<string> {
  const env = {
    ...process.env,
    PATH: [
      process.env.PATH ?? '',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME ?? ''}/.local/bin`,
    ]
      .filter(Boolean)
      .join(':'),
  };
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'create',
        '--base',
        params.baseBranch,
        '--head',
        params.headBranch,
        '--title',
        params.title,
        '--body',
        params.body,
      ],
      { cwd: params.cwd, maxBuffer: 5 * 1024 * 1024, env },
    );
    return (typeof stdout === 'string' ? stdout : String(stdout)).trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new Error(
        `gh CLI not found on PATH. Branch ${params.headBranch} was pushed; create the PR manually or install GitHub CLI (gh).`,
      );
    }
    throw error;
  }
}

/** Unified diff for specific relative paths (or full worktree if empty). */
export async function gitDiff(
  cwd: string,
  relativeFiles: string[] = [],
): Promise<string> {
  const args = ['diff', '--no-color', 'HEAD', '--'];
  if (relativeFiles.length) {
    args.push(...relativeFiles);
  }
  try {
    const { stdout } = await runGit(cwd, args);
    // Also include untracked new files via diff against /dev/null style:
    // `git diff --no-index` is awkward; use `git add -N` simulation via status + diff cached.
    const untracked = await listUntracked(cwd, relativeFiles);
    let extra = '';
    for (const file of untracked) {
      try {
        const { stdout: patch } = await runGit(cwd, [
          'diff',
          '--no-color',
          '--no-index',
          '--',
          '/dev/null',
          file,
        ]);
        extra += (extra ? '\n' : '') + patch;
      } catch (error) {
        // git diff --no-index exits 1 when files differ — still has stdout
        const err = error as { stdout?: string };
        if (err.stdout) {
          extra += (extra ? '\n' : '') + err.stdout;
        }
      }
    }
    return [stdout.trim(), extra.trim()].filter(Boolean).join('\n\n');
  } catch (error) {
    const err = error as { stdout?: string; message?: string };
    if (err.stdout) {
      return String(err.stdout).trim();
    }
    throw error;
  }
}

async function listUntracked(
  cwd: string,
  relativeFiles: string[],
): Promise<string[]> {
  const { stdout } = await runGit(cwd, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  const all = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!relativeFiles.length) {
    return all;
  }
  const wanted = new Set(relativeFiles.map((f) => f.split(path.sep).join('/')));
  return all.filter((f) => wanted.has(f.split(path.sep).join('/')));
}

export async function gitStatusShort(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['status', '--short']);
  return stdout.trim();
}

