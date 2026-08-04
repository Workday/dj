import {
  loadDbtProject,
  validateModelJson,
  validateSourceJson,
} from '@services/framework/headless';
import type { FrameworkModel, FrameworkSource } from '@shared/framework/types';
import { jsonParse } from '@shared';
import * as fs from 'fs';
import * as path from 'path';
import { getSchemaBundle } from '../context';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ModelRef, type ProjectSelector } from '../response';

export async function validateModel(
  args: ProjectSelector &
    ModelRef & {
      kind?: 'model' | 'source';
    },
) {
  try {
    const bundle = getSchemaBundle();
    let modelJson: FrameworkModel | FrameworkSource;
    let modelPath = args.modelPath;

    if (modelPath && !path.isAbsolute(modelPath)) {
      try {
        const ctx = await resolveActiveProject(args);
        modelPath = path.join(ctx.projectPath, modelPath);
      } catch {
        // keep relative path; may fail on read below
      }
    }

    if (modelPath) {
      modelJson = jsonParse(fs.readFileSync(modelPath, 'utf8'));
    } else if (args.modelJson) {
      modelJson = args.modelJson as FrameworkModel;
    } else {
      return failure(['modelPath or modelJson is required']);
    }

    const kind =
      args.kind ??
      (modelPath?.endsWith('.source.json') ? 'source' : 'model');
    const result =
      kind === 'source'
        ? validateSourceJson(bundle, modelJson as FrameworkSource)
        : validateModelJson(bundle, modelJson as FrameworkModel, modelPath);

    if (!result.valid) {
      return failure(
        result.errors.map((e) => e.details?.join('\n') ?? e.message),
        { warnings: result.warnings.map((w) => w.message) },
      );
    }

    let manifestInfo;
    let projectPublic;
    try {
      const ctx = await resolveActiveProject(args);
      const project = loadDbtProject(ctx.projectPath, {
        workspaceRoot: ctx.workspaceRoot,
      });
      projectPublic = toPublicProject(ctx);
      manifestInfo = {
        project: project.name,
        manifestLoaded: Object.keys(project.manifest.nodes).length > 0,
      };
    } catch {
      // optional when validating free-floating JSON
    }

    return success({
      valid: true,
      kind,
      project: projectPublic,
      manifestInfo,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
