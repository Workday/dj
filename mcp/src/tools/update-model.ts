import {
  deleteFileIfExists,
  formatModelJson,
  generateModelArtifacts,
  loadDbtProject,
  mergeModelUpdate,
  resolveModelPaths,
  validateModelJson,
  writeTextFile,
} from '@services/framework/headless';
import type { FrameworkModel } from '@shared/framework/types';
import * as fs from 'fs';
import * as path from 'path';
import { getSchemaBundle } from '../context';
import {
  finalizeChangeSetFiles,
  openChangeSet,
} from '../projects/changes';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';
import { listModels } from './list-models';

/**
 * Resolve a model path against the active project (relative or absolute).
 */
function resolveModelFile(
  projectPath: string,
  modelPath: string,
): string {
  if (path.isAbsolute(modelPath)) {
    return modelPath;
  }
  return path.join(projectPath, modelPath);
}

/**
 * Update a DJ `.model.json` inside an isolated change-set worktree (default).
 * Publish with dj_publish_change after approval.
 */
export async function updateModel(
  args: ProjectSelector & {
    modelPath: string;
    modelJson: FrameworkModel | Record<string, unknown>;
  },
) {
  try {
    if (!args.modelPath) {
      return failure(['modelPath is required']);
    }

    const previewOnly = args.previewOnly !== false;
    const ctx = await resolveActiveProject(args);
    const baseModelPath = resolveModelFile(ctx.projectPath, args.modelPath);

    if (!fs.existsSync(baseModelPath)) {
      return failure([`Model file not found: ${args.modelPath}`]);
    }

    const relFromProject = path.relative(ctx.projectPath, baseModelPath);
    if (relFromProject.startsWith('..') || path.isAbsolute(relFromProject)) {
      return failure(['modelPath is outside the selected project']);
    }

    let project = loadDbtProject(ctx.projectPath, {
      workspaceRoot: ctx.workspaceRoot,
    });
    let worktreeProjectPath = ctx.projectPath;
    let changeSetId: string | undefined;
    let manifest;
    let modelPath = baseModelPath;

    if (previewOnly) {
      const opened = await openChangeSet(ctx);
      changeSetId = opened.changeSetId;
      worktreeProjectPath = opened.worktreeProjectPath;
      manifest = opened.manifest;
      project = loadDbtProject(worktreeProjectPath, {
        workspaceRoot: opened.manifest.worktreePath,
      });
      modelPath = path.join(worktreeProjectPath, relFromProject);
      if (!fs.existsSync(modelPath)) {
        // Worktrees only contain committed files; copy from base if present
        // (covers uncommitted / local-only models).
        if (fs.existsSync(baseModelPath)) {
          fs.mkdirSync(path.dirname(modelPath), { recursive: true });
          fs.copyFileSync(baseModelPath, modelPath);
          const basePrefix = baseModelPath.replace(/\.model\.json$/, '');
          const wtPrefix = modelPath.replace(/\.model\.json$/, '');
          for (const ext of ['.sql', '.yml']) {
            if (fs.existsSync(`${basePrefix}${ext}`)) {
              fs.copyFileSync(`${basePrefix}${ext}`, `${wtPrefix}${ext}`);
            }
          }
        } else {
          return failure([
            `Model not found in change-set worktree: ${relFromProject}`,
          ]);
        }
      }
    }

    const bundle = getSchemaBundle();
    const existingContent = fs.readFileSync(modelPath, 'utf8');
    const existing = JSON.parse(existingContent) as Record<string, unknown>;
    // Allow partial patches; mergeModelUpdate expects a full model body.
    const incoming = {
      ...existing,
      ...(args.modelJson as Record<string, unknown>),
    } as FrameworkModel;
    const merged = mergeModelUpdate(existingContent, incoming);

    const validation = validateModelJson(bundle, merged, modelPath);
    if (!validation.valid) {
      return failure(validation.errors.map((e) => e.message));
    }

    const oldPrefix = modelPath.replace(/\.model\.json$/, '');
    const newPaths = resolveModelPaths(project, merged);
    const renamed = newPaths.modelJson !== modelPath;

    writeTextFile(newPaths.modelJson, formatModelJson(merged));

    if (renamed) {
      deleteFileIfExists(modelPath);
      deleteFileIfExists(`${oldPrefix}.sql`);
      deleteFileIfExists(`${oldPrefix}.yml`);
    }

    const generated = generateModelArtifacts(project, merged);
    writeTextFile(newPaths.sql, generated.sql);
    writeTextFile(newPaths.yml, generated.yml);

    const absoluteFiles = [newPaths.modelJson, newPaths.sql, newPaths.yml];
    if (renamed) {
      // deleted files still count as changes for git; relative paths of deletes
      // are handled by git status on publish via add of new files + worktree diff.
    }

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

    const relativeChanged = (
      manifest?.relativeChangedFiles ??
      absoluteFiles.map((f) =>
        path.relative(worktreeProjectPath, f).split(path.sep).join('/'),
      )
    );

    return success({
      status: previewOnly ? 'awaiting_approval' : 'written',
      changeSetId,
      project: toPublicProject(ctx),
      modelJson: merged,
      renamed,
      artifacts: { sql: generated.sql, yml: generated.yml },
      validation: { valid: true },
      changedFiles: relativeChanged,
      models: modelsResult.ok
        ? (modelsResult.data as { models?: unknown }).models
        : undefined,
      next:
        previewOnly && changeSetId
          ? `Review preview, then dj_publish_change({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
          : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
