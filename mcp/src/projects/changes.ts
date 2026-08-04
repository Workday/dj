import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  createBranchCommitPush,
  createPullRequest,
  createWorktree,
  currentSha,
  removeWorktree,
} from './git';
import { getBaseSha } from './registry';
import {
  changesDir,
  ensureDjMcpDirs,
  type ChangeSetManifest,
  type ResolvedProjectContext,
} from './types';

function manifestPath(changeSetId: string): string {
  return path.join(changesDir(), `${changeSetId}.json`);
}

export function readChangeSet(changeSetId: string): ChangeSetManifest {
  const file = manifestPath(changeSetId);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown changeSetId: ${changeSetId}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ChangeSetManifest;
}

export function writeChangeSet(manifest: ChangeSetManifest): void {
  ensureDjMcpDirs();
  fs.writeFileSync(
    manifestPath(manifest.changeSetId),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Map a path written inside a worktree back to the corresponding path under
 * the base project (for relative path reporting).
 */
export function mapWorktreePathToBase(
  worktreeProjectPath: string,
  baseProjectPath: string,
  absoluteWorktreeFile: string,
): { absoluteBase: string; relative: string } {
  const rel = path.relative(worktreeProjectPath, absoluteWorktreeFile);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Changed file outside worktree project: ${absoluteWorktreeFile}`);
  }
  return {
    absoluteBase: path.join(baseProjectPath, rel),
    relative: rel.split(path.sep).join('/'),
  };
}

export async function openChangeSet(
  ctx: ResolvedProjectContext,
): Promise<{
  changeSetId: string;
  worktreeProjectPath: string;
  manifest: ChangeSetManifest;
}> {
  const { gitRoot, sha, baseBranch } = await getBaseSha(ctx);
  ensureDjMcpDirs();
  const changeSetId = `chg_${crypto.randomBytes(6).toString('hex')}`;
  const worktreePath = path.join(changesDir(), changeSetId);
  await createWorktree({ gitRoot, worktreePath, baseSha: sha });

  // Project path relative to git root, remapped into worktree
  const relProject = path.relative(gitRoot, ctx.projectPath);
  const worktreeProjectPath = path.isAbsolute(relProject)
    ? worktreePath
    : path.join(worktreePath, relProject);

  const now = Date.now();
  const manifest: ChangeSetManifest = {
    changeSetId,
    status: 'awaiting_approval',
    mode: ctx.mode,
    projectId: ctx.projectId,
    label: ctx.label,
    projectName: ctx.projectName,
    baseRoot: ctx.projectPath,
    worktreePath,
    gitRoot,
    baseSha: sha,
    baseBranch,
    changedFiles: [],
    relativeChangedFiles: [],
    createdAt: now,
    updatedAt: now,
  };
  writeChangeSet(manifest);

  return { changeSetId, worktreeProjectPath, manifest };
}

export function finalizeChangeSetFiles(params: {
  manifest: ChangeSetManifest;
  worktreeProjectPath: string;
  absoluteFiles: string[];
}): ChangeSetManifest {
  const relativeChangedFiles: string[] = [];
  const changedFiles: string[] = [];
  for (const file of params.absoluteFiles) {
    const mapped = mapWorktreePathToBase(
      params.worktreeProjectPath,
      params.manifest.baseRoot,
      file,
    );
    changedFiles.push(mapped.absoluteBase);

    // Paths must be relative to the git worktree root for `git add` (dbt
    // projects nested under the repo, e.g. dags/dbt/models/...).
    const gitRel = path.relative(params.manifest.worktreePath, file);
    if (gitRel.startsWith('..') || path.isAbsolute(gitRel)) {
      throw new Error(`Changed file outside worktree: ${file}`);
    }
    relativeChangedFiles.push(gitRel.split(path.sep).join('/'));
  }
  const updated: ChangeSetManifest = {
    ...params.manifest,
    changedFiles,
    relativeChangedFiles,
    updatedAt: Date.now(),
    status: 'awaiting_approval',
  };
  writeChangeSet(updated);
  return updated;
}

/** Resolve commit paths relative to the worktree/git root. */
function toGitRelativeFiles(manifest: ChangeSetManifest): string[] {
  const projectRel = path
    .relative(manifest.gitRoot, manifest.baseRoot)
    .split(path.sep)
    .join('/');
  return manifest.relativeChangedFiles.map((file) => {
    const direct = path.join(manifest.worktreePath, file);
    if (fs.existsSync(direct)) {
      return file.split(path.sep).join('/');
    }
    if (projectRel && projectRel !== '.') {
      const nested = path.join(projectRel, file).split(path.sep).join('/');
      if (fs.existsSync(path.join(manifest.worktreePath, nested))) {
        return nested;
      }
    }
    return file.split(path.sep).join('/');
  });
}

export async function discardChangeSet(changeSetId: string): Promise<ChangeSetManifest> {
  const manifest = readChangeSet(changeSetId);
  await removeWorktree({
    gitRoot: manifest.gitRoot,
    worktreePath: manifest.worktreePath,
  });
  const updated: ChangeSetManifest = {
    ...manifest,
    status: 'discarded',
    updatedAt: Date.now(),
  };
  writeChangeSet(updated);
  return updated;
}

export async function publishChangeSet(params: {
  changeSetId: string;
  approval: boolean;
  commitMessage: string;
  prTitle?: string;
  prBody?: string;
  remote?: string;
}): Promise<ChangeSetManifest> {
  if (params.approval !== true) {
    throw new Error('approval must be true to publish');
  }
  const manifest = readChangeSet(params.changeSetId);
  if (manifest.status !== 'awaiting_approval') {
    throw new Error(
      `Change set is ${manifest.status}; only awaiting_approval can be published`,
    );
  }
  if (!manifest.relativeChangedFiles.length) {
    throw new Error('Change set has no files to publish');
  }

  const headSha = await currentSha(manifest.gitRoot);
  if (headSha !== manifest.baseSha) {
    const updated: ChangeSetManifest = {
      ...manifest,
      status: 'failed',
      error: `Base branch moved (expected ${manifest.baseSha}, now ${headSha}). Discard and recreate the change.`,
      updatedAt: Date.now(),
    };
    writeChangeSet(updated);
    throw new Error(updated.error!);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug =
    manifest.projectId ??
    manifest.projectName ??
    'local';
  const branch = `dj/${slug}/${stamp}`;

  try {
    const gitRelativeFiles = toGitRelativeFiles(manifest);
    const { commitSha } = await createBranchCommitPush({
      worktreePath: manifest.worktreePath,
      branch,
      relativeFiles: gitRelativeFiles,
      commitMessage: params.commitMessage,
      remote: params.remote,
    });

    const prUrl = await createPullRequest({
      cwd: manifest.worktreePath,
      baseBranch: manifest.baseBranch,
      headBranch: branch,
      title: params.prTitle ?? params.commitMessage,
      body:
        params.prBody ??
        `Automated DJ MCP change for ${manifest.label} (${manifest.projectName ?? ''})`,
    });

    await removeWorktree({
      gitRoot: manifest.gitRoot,
      worktreePath: manifest.worktreePath,
    });

    const published: ChangeSetManifest = {
      ...manifest,
      status: 'published',
      branch,
      commitSha,
      prUrl,
      updatedAt: Date.now(),
    };
    writeChangeSet(published);
    return published;
  } catch (error) {
    const failed: ChangeSetManifest = {
      ...manifest,
      status: 'failed',
      branch,
      error: (error as Error).message,
      updatedAt: Date.now(),
    };
    writeChangeSet(failed);
    throw error;
  }
}
