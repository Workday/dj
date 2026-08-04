import { readChangeSet } from '../projects/changes';
import { failure, success } from '../response';

export async function getChange(args: { changeSetId: string }) {
  try {
    if (!args.changeSetId) {
      return failure(['changeSetId is required']);
    }
    const manifest = readChangeSet(args.changeSetId);
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
      changedFiles: manifest.relativeChangedFiles,
      branch: manifest.branch,
      commitSha: manifest.commitSha,
      prUrl: manifest.prUrl,
      error: manifest.error,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
