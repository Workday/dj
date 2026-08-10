import { publishChangeSet, readChangeSet } from '../projects/changes';
import { failure, success } from '../response';

/**
 * User-facing “create PR” tool: approval-gated commit + push + gh pr create.
 * Prefer this over dj_publish_change in agent recipes.
 */
export async function shipChange(args: {
  changeSetId: string;
  approval?: boolean;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}) {
  try {
    if (!args.changeSetId?.trim()) {
      return failure(['changeSetId is required']);
    }

    const manifest = readChangeSet(args.changeSetId.trim());
    const defaultTitle =
      args.prTitle?.trim() ||
      (manifest.relativeChangedFiles[0]
        ? `DJ: ${manifest.relativeChangedFiles[0]
            .split('/')
            .pop()
            ?.replace(/\.model\.json$/i, '')}`
        : `DJ change for ${manifest.label}`);

    if (args.approval !== true) {
      return success({
        needsApproval: true,
        changeSetId: manifest.changeSetId,
        status: manifest.status,
        changedFiles: manifest.relativeChangedFiles,
        suggestedCommitMessage:
          args.commitMessage?.trim() ||
          `Add ${manifest.relativeChangedFiles
            .filter((f) => f.endsWith('.model.json'))
            .map((f) => f.split('/').pop()?.replace(/\.model\.json$/i, ''))
            .filter(Boolean)
            .join(', ') || 'DJ models'}`,
        suggestedPrTitle: defaultTitle,
        question:
          'Review the change (dj_review_change), then call dj_ship again with approval: true and commitMessage.',
        project: {
          id: manifest.projectId,
          label: manifest.label,
          projectName: manifest.projectName,
        },
      });
    }

    if (!args.commitMessage?.trim()) {
      return failure([
        'commitMessage is required when approval is true. Suggested: ' +
          (defaultTitle || 'Add DJ model changes'),
      ]);
    }

    const published = await publishChangeSet({
      changeSetId: args.changeSetId.trim(),
      approval: true,
      commitMessage: args.commitMessage.trim(),
      prTitle: defaultTitle,
      prBody: args.prBody,
    });

    return success({
      changeSetId: published.changeSetId,
      status: published.status,
      branch: published.branch,
      commitSha: published.commitSha,
      prUrl: published.prUrl,
      changedFiles: published.relativeChangedFiles,
      project: {
        id: published.projectId,
        label: published.label,
        projectName: published.projectName,
      },
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
