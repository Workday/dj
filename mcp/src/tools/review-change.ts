import { currentSha, gitDiff, gitStatusShort } from '../projects/git';
import { readChangeSet } from '../projects/changes';
import { failure, success } from '../response';

/**
 * Review an isolated change set: status, files, unified diff, base freshness.
 * Agent should call this before dj_ship when the user asks to create a PR.
 */
export async function reviewChange(args: { changeSetId: string }) {
  try {
    if (!args.changeSetId?.trim()) {
      return failure(['changeSetId is required']);
    }
    const manifest = readChangeSet(args.changeSetId.trim());
    let headSha: string | undefined;
    let baseMoved = false;
    try {
      headSha = await currentSha(manifest.gitRoot);
      baseMoved = headSha !== manifest.baseSha;
    } catch {
      headSha = undefined;
    }

    let diff = '';
    let status = '';
    if (
      manifest.status === 'awaiting_approval' ||
      manifest.status === 'failed'
    ) {
      try {
        status = await gitStatusShort(manifest.worktreePath);
        diff = await gitDiff(
          manifest.worktreePath,
          manifest.relativeChangedFiles,
        );
      } catch (error) {
        diff = `(diff unavailable: ${(error as Error).message})`;
      }
    }

    return success({
      changeSetId: manifest.changeSetId,
      status: manifest.status,
      project: {
        id: manifest.projectId,
        label: manifest.label,
        projectName: manifest.projectName,
        mode: manifest.mode,
      },
      baseSha: manifest.baseSha,
      baseBranch: manifest.baseBranch,
      headSha,
      baseMoved,
      changedFiles: manifest.relativeChangedFiles,
      statusShort: status || undefined,
      diff: diff || undefined,
      branch: manifest.branch,
      commitSha: manifest.commitSha,
      prUrl: manifest.prUrl,
      error: manifest.error,
      next:
        manifest.status === 'awaiting_approval'
          ? baseMoved
            ? 'Base branch moved — discard and recreate the change set before shipping.'
            : `Show the diff to the user, then dj_ship({ changeSetId: "${manifest.changeSetId}", approval: true, commitMessage: "..." })`
          : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
