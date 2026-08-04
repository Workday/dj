import {
  listCatalogProjects,
  resolveActiveProject,
  toPublicProject,
} from '../projects/registry';
import { setCatalogSession } from '../projects/session';
import { failure, success } from '../response';

export async function useProject(args: { projectId: string }) {
  try {
    if (!args.projectId?.trim()) {
      return failure(['projectId is required']);
    }
    const catalog = listCatalogProjects();
    if (!catalog.find((p) => p.id === args.projectId)) {
      return failure([
        `Unknown projectId "${args.projectId}". Available: ${
          catalog.map((p) => p.id).join(', ') || '(none configured)'
        }`,
      ]);
    }
    const session = setCatalogSession(args.projectId);
    const ctx = await resolveActiveProject({ projectId: args.projectId });
    return success({
      session,
      project: toPublicProject(ctx),
      hint: 'Next: dj_describe_structure, then dj_create_e2e with your requirement.',
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
