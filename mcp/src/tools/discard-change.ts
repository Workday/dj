import { discardChangeSet } from '../projects/changes';
import { failure, success } from '../response';

export async function discardChange(args: { changeSetId: string }) {
  try {
    if (!args.changeSetId) {
      return failure(['changeSetId is required']);
    }
    const manifest = await discardChangeSet(args.changeSetId);
    return success({
      changeSetId: manifest.changeSetId,
      status: manifest.status,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
