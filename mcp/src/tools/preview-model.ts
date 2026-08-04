import {
  getManifestInfo,
  loadDbtProject,
  previewModel,
} from '@services/framework/headless';
import { jsonParse } from '@shared';
import * as fs from 'fs';
import * as path from 'path';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ModelRef, type ProjectSelector } from '../response';

export async function previewModelTool(
  args: ProjectSelector &
    ModelRef & {
      write?: boolean;
    },
) {
  try {
    const ctx = await resolveActiveProject(args);
    const project = loadDbtProject(ctx.projectPath, {
      workspaceRoot: ctx.workspaceRoot,
    });

    let modelInput: Record<string, unknown>;
    if (args.modelPath) {
      const modelPath = path.isAbsolute(args.modelPath)
        ? args.modelPath
        : path.join(ctx.projectPath, args.modelPath);
      modelInput = jsonParse(fs.readFileSync(modelPath, 'utf8'));
    } else if (args.modelJson) {
      modelInput = args.modelJson as Record<string, unknown>;
    } else {
      return failure(['modelPath or modelJson is required']);
    }

    const preview = previewModel(project, modelInput);
    const manifest = getManifestInfo(project);

    return success(
      {
        project: toPublicProject(ctx),
        modelJson: preview.modelJson,
        sql: preview.sql,
        yml: preview.yml,
        columns: preview.columns,
        manifest,
      },
      {
        warnings: manifest.exists
          ? undefined
          : [
              'manifest.json not found — join/CTE column inference may be limited. Run dbt compile/parse first.',
            ],
      },
    );
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
