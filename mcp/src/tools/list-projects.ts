import {
  listCatalogProjects,
  resolveActiveProject,
  toPublicProject,
} from '../projects/registry';
import { getRegistryConfig } from '../projects/registry';
import { getSession } from '../projects/session';
import { failure, success, type ProjectSelector } from '../response';
import { listModels } from './list-models';

/**
 * List configured production catalog projects, or discover under local/env root.
 */
export async function listProjects(args: ProjectSelector = {}) {
  try {
    const file = getRegistryConfig();
    const catalog = listCatalogProjects();
    const session = getSession();

    if (catalog.length > 0 && !args.localPath && !args.workspaceRoot) {
      const projects = [];
      for (const entry of catalog) {
        let modelCount: number | undefined;
        try {
          const ctx = await resolveActiveProject({ projectId: entry.id });
          const modelsResult = await listModels({
            projectPath: ctx.projectPath,
            workspaceRoot: ctx.workspaceRoot,
            projectName: ctx.projectName,
          });
          if (modelsResult.ok && modelsResult.data) {
            modelCount = (
              modelsResult.data as { models?: unknown[] }
            ).models?.length;
          }
        } catch {
          modelCount = undefined;
        }
        projects.push({
          id: entry.id,
          label: entry.label,
          type: entry.type,
          projectName: entry.projectName,
          modelCount,
          selected: session.activeProjectId === entry.id,
        });
      }
      return success({
        mode: 'catalog',
        projects,
        session,
        hint: 'Pick a project with dj_use_project({ projectId }), then describe requirements.',
      });
    }

    // Independent / legacy discovery
    if (file.allowLocalProjectMode === false && file.productionMode) {
      return failure([
        'No catalog projects configured. Contact the MCP operator.',
      ]);
    }

    const { findDbtProjectDirs, loadDbtProject } = await import(
      '@services/framework/headless'
    );
    const root =
      args.localPath ??
      args.workspaceRoot ??
      session.activeLocalPath ??
      process.env.DJ_WORKSPACE_ROOT ??
      process.cwd();
    const dirs = findDbtProjectDirs(root);
    const projects = dirs.map((dir) => {
      const project = loadDbtProject(dir, { workspaceRoot: root });
      return {
        name: project.name,
        path: project.pathSystem,
        modelPaths: project.modelPaths,
        targetPath: project.targetPath,
      };
    });
    return success({
      mode: 'local',
      projects,
      workspaceRoot: root,
      session,
      hint: 'Use dj_use_local_project({ localPath }) to select your checkout.',
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
