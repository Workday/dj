import {
  buildModelFromCreateRequest,
  formatModelJson,
  generateModelArtifacts,
  loadDbtProject,
  resolveModelPaths,
  validateModelJson,
  writeTextFile,
} from '@services/framework/headless';
import type { FrameworkModel } from '@shared/framework/types';
import * as fs from 'fs';
import { getSchemaBundle } from '../context';
import {
  finalizeChangeSetFiles,
  openChangeSet,
} from '../projects/changes';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';
import { listModels } from './list-models';

/**
 * Create a DJ `.model.json` + SQL/YML inside an isolated change-set worktree
 * (previewOnly default true). Ship with dj_review_change → dj_ship after approval.
 */
export async function createModel(
  args: ProjectSelector & {
    model: Record<string, unknown> & {
      type: FrameworkModel['type'];
      group: string;
      name: string;
      topic: string;
    };
    overwrite?: boolean;
  },
) {
  try {
    const previewOnly = args.previewOnly !== false;
    const ctx = await resolveActiveProject(args);
    const bundle = getSchemaBundle();

    let project = loadDbtProject(ctx.projectPath, {
      workspaceRoot: ctx.workspaceRoot,
    });
    let worktreeProjectPath = ctx.projectPath;
    let changeSetId: string | undefined;
    let manifest;

    if (previewOnly) {
      const opened = await openChangeSet(ctx);
      changeSetId = opened.changeSetId;
      worktreeProjectPath = opened.worktreeProjectPath;
      manifest = opened.manifest;
      project = loadDbtProject(worktreeProjectPath, {
        workspaceRoot: opened.manifest.worktreePath,
      });
    }

    const modelJson = buildModelFromCreateRequest({
      ...args.model,
      projectName: project.name,
    } as Parameters<typeof buildModelFromCreateRequest>[0]);

    const validation = validateModelJson(bundle, modelJson);
    if (!validation.valid) {
      return failure(validation.errors.map((e) => e.message));
    }

    const paths = resolveModelPaths(project, modelJson);
    if (fs.existsSync(paths.modelJson) && !args.overwrite) {
      return failure([`Model already exists at ${paths.modelJson}`]);
    }

    writeTextFile(paths.modelJson, formatModelJson(modelJson));
    const generated = generateModelArtifacts(project, modelJson);
    writeTextFile(paths.sql, generated.sql);
    writeTextFile(paths.yml, generated.yml);

    const absoluteFiles = [paths.modelJson, paths.sql, paths.yml];
    if (previewOnly && manifest && changeSetId) {
      manifest = finalizeChangeSetFiles({
        manifest,
        worktreeProjectPath,
        absoluteFiles,
      });
    }

    const modelsResult = await listModels({
      projectPath: worktreeProjectPath,
      workspaceRoot: previewOnly ? manifest!.worktreePath : ctx.workspaceRoot,
    });

    const relativeChanged = (manifest?.relativeChangedFiles ?? absoluteFiles.map(
      (f) => f.replace(worktreeProjectPath + '/', ''),
    )).map((p) => p.split('\\').join('/'));

    return success({
      status: previewOnly ? 'awaiting_approval' : 'written',
      changeSetId,
      project: toPublicProject(ctx),
      modelJson,
      artifacts: { sql: generated.sql, yml: generated.yml },
      validation: { valid: true },
      changedFiles: relativeChanged,
      models: modelsResult.ok
        ? (modelsResult.data as { models?: unknown }).models
        : undefined,
      next:
        previewOnly && changeSetId
          ? `Review preview, then dj_review_change → dj_ship({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
          : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
