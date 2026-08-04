import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { getRegistryConfig } from '../projects/registry';
import { setLocalSession } from '../projects/session';
import { failure, success } from '../response';

export async function useLocalProject(args: {
  localPath: string;
  projectName?: string;
}) {
  try {
    const file = getRegistryConfig();
    if (file.allowLocalProjectMode === false) {
      return failure([
        'Local project mode is disabled on this MCP server. Use dj_use_project with a catalog projectId.',
      ]);
    }
    if (!args.localPath?.trim()) {
      return failure(['localPath is required']);
    }
    const session = setLocalSession(args.localPath);
    const ctx = await resolveActiveProject({
      localPath: args.localPath,
      projectName: args.projectName,
    });
    return success({
      session,
      project: toPublicProject(ctx),
      hint: 'Next: dj_describe_structure, then dj_create_e2e with your requirement.',
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
