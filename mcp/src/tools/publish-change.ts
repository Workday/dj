import { publishChangeSet } from '../projects/changes';
import { failure, success } from '../response';

/**
 * Approval-gated commit + push + PR for an isolated change set.
 */
export async function publishChange(args: {
  changeSetId: string;
  approval: boolean;
  commitMessage: string;
  prTitle?: string;
  prBody?: string;
}) {
  try {
    if (!args.changeSetId) {
      return failure(['changeSetId is required']);
    }
    if (args.approval !== true) {
      return failure(['Set approval: true after reviewing the preview']);
    }
    if (!args.commitMessage?.trim()) {
      return failure(['commitMessage is required']);
    }

    const manifest = await publishChangeSet({
      changeSetId: args.changeSetId,
      approval: true,
      commitMessage: args.commitMessage.trim(),
      prTitle: args.prTitle,
      prBody: args.prBody,
    });

    return success({
      changeSetId: manifest.changeSetId,
      status: manifest.status,
      branch: manifest.branch,
      commitSha: manifest.commitSha,
      prUrl: manifest.prUrl,
      changedFiles: manifest.relativeChangedFiles,
      project: {
        id: manifest.projectId,
        label: manifest.label,
        projectName: manifest.projectName,
      },
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
