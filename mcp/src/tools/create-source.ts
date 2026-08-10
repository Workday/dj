import {
  generateSourceArtifacts,
  loadDbtProject,
  validateSourceJson,
  writeTextFile,
} from '@services/framework/headless';
import { frameworkMakeSourcePrefix } from '@services/framework/utils';
import type { FrameworkSource } from '@shared/framework/types';
import * as fs from 'fs';
import { getSchemaBundle } from '../context';
import {
  finalizeChangeSetFiles,
  openChangeSet,
} from '../projects/changes';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';

export async function createSource(
  args: ProjectSelector & {
    source: FrameworkSource;
    overwrite?: boolean;
    generateYml?: boolean;
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

    const sourceJson = args.source;
    const validation = validateSourceJson(bundle, sourceJson);
    if (!validation.valid) {
      return failure(validation.errors.map((e) => e.message));
    }

    const prefix = frameworkMakeSourcePrefix({
      database: sourceJson.database,
      schema: sourceJson.schema,
      project,
    });
    if (!prefix) {
      return failure(['Unable to resolve source file path']);
    }
    const sourcePath = `${prefix}.source.json`;

    if (fs.existsSync(sourcePath) && !args.overwrite) {
      return failure([`Source already exists at ${sourcePath}`]);
    }

    writeTextFile(sourcePath, JSON.stringify(sourceJson, null, 4));

    let yml: string | undefined;
    const ymlPath = `${prefix}.yml`;
    const absoluteFiles = [sourcePath];
    if (args.generateYml !== false) {
      const generated = generateSourceArtifacts(project, sourceJson);
      yml = generated.yml;
      writeTextFile(ymlPath, yml);
      absoluteFiles.push(ymlPath);
    }

    if (previewOnly && manifest && changeSetId) {
      manifest = finalizeChangeSetFiles({
        manifest,
        worktreeProjectPath,
        absoluteFiles,
      });
    }

    return success({
      status: previewOnly ? 'awaiting_approval' : 'written',
      changeSetId,
      project: toPublicProject(ctx),
      sourceJson,
      yml,
      changedFiles: manifest?.relativeChangedFiles,
      next:
        previewOnly && changeSetId
          ? `Review, then dj_review_change → dj_ship({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
          : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
