import { jsonParse } from '@shared';
import * as fs from 'fs';
import * as path from 'path';
import { getRegistryConfig } from '../projects/registry';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ModelRef, type ProjectSelector } from '../response';

export async function getModel(
  args: ProjectSelector &
    ModelRef & {
      includeArtifacts?: boolean;
    },
) {
  try {
    if (!args.modelPath) {
      return failure(['modelPath is required']);
    }

    let modelPath = args.modelPath;
    let ctx;
    try {
      ctx = await resolveActiveProject(args);
      if (!path.isAbsolute(modelPath)) {
        modelPath = path.join(ctx.projectPath, modelPath);
      }
    } catch {
      modelPath = path.resolve(args.modelPath);
    }

    if (!fs.existsSync(modelPath)) {
      return failure([`Model file not found: ${args.modelPath}`]);
    }

    const content = fs.readFileSync(modelPath, 'utf8');
    const modelJson = jsonParse(content);
    const prefix = modelPath.replace(/\.model\.json$/, '');
    const exposePaths =
      getRegistryConfig().exposeFilesystemPaths ??
      !(getRegistryConfig().productionMode ?? false);

    const relativePath = ctx
      ? path.relative(ctx.projectPath, modelPath).split(path.sep).join('/')
      : modelPath;

    const data: Record<string, unknown> = {
      path: exposePaths ? modelPath : relativePath,
      relativePath,
      modelJson,
      project: ctx ? toPublicProject(ctx) : undefined,
    };

    if (args.includeArtifacts) {
      const sqlPath = `${prefix}.sql`;
      const ymlPath = `${prefix}.yml`;
      data.sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : null;
      data.yml = fs.existsSync(ymlPath) ? fs.readFileSync(ymlPath, 'utf8') : null;
      if (exposePaths) {
        data.paths = { modelJson: modelPath, sql: sqlPath, yml: ymlPath };
      }
    }
    return success(data);
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
