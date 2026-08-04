import { frameworkGetModelName } from '@services/framework/utils';
import { resolveProject } from '@services/framework/headless';
import { jsonParse } from '@shared';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';

export async function listModels(
  args: ProjectSelector & { pattern?: string } = {},
) {
  try {
    let projectPath: string;
    let workspaceRoot: string;
    let projectName: string | undefined;
    let publicProject: Record<string, unknown> | undefined;

    if (args.projectPath) {
      workspaceRoot = args.workspaceRoot ?? args.projectPath;
      const project = resolveProject(
        workspaceRoot,
        args.projectPath,
        args.projectName,
      );
      projectPath = project.pathSystem;
      projectName = project.name;
    } else {
      const ctx = await resolveActiveProject(args);
      projectPath = ctx.projectPath;
      workspaceRoot = ctx.workspaceRoot;
      projectName = ctx.projectName;
      publicProject = toPublicProject(ctx);
    }

    const project = resolveProject(workspaceRoot, projectPath, projectName);
    const modelRoot = path.join(
      project.pathSystem,
      project.modelPaths[0] ?? 'models',
    );
    const files = await glob('**/*.model.json', {
      cwd: modelRoot,
      absolute: true,
      nodir: true,
    });
    const pattern = args.pattern?.toLowerCase();
    const models = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (pattern && !file.toLowerCase().includes(pattern)) {
        continue;
      }
      try {
        const modelJson = jsonParse(fs.readFileSync(file, 'utf8'));
        models.push({
          path: publicProject && !args.projectPath
            ? path.relative(project.pathSystem, file).split(path.sep).join('/')
            : file,
          name: frameworkGetModelName(modelJson),
          type: modelJson.type,
          group: modelJson.group,
          topic: modelJson.topic,
        });
      } catch {
        skipped.push(file);
      }
    }

    return success({
      project: publicProject ?? {
        name: project.name,
        path: project.pathSystem,
      },
      models,
      skippedInvalidJson: skipped.length ? skipped : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
