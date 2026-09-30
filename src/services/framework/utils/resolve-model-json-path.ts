import type { Dbt } from '@services/dbt';
import type { DbtProject } from '@shared/dbt/types';
import { getDbtModelId } from '@shared/dbt/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Resolve the absolute path to a model's `.model.json` within a dbt project.
 * Uses the in-memory manifest when available, otherwise searches the project tree.
 */
export async function resolveModelJsonPath({
  modelName,
  project,
  dbt,
}: {
  modelName: string;
  project: DbtProject;
  dbt: Dbt;
}): Promise<string | null> {
  const modelId = getDbtModelId({
    modelName,
    projectName: project.name,
  });
  if (modelId) {
    const model = dbt.models.get(modelId);
    if (model?.pathSystemFile) {
      const fromManifest = model.pathSystemFile.replace(/\.sql$/, '.model.json');
      if (fs.existsSync(fromManifest)) {
        return fromManifest;
      }
    }
  }

  const pattern = new vscode.RelativePattern(
    project.pathSystem,
    `**/${modelName}.model.json`,
  );
  const matches = await vscode.workspace.findFiles(
    pattern,
    '{**/node_modules/**,**/.git/**,**/target/**}',
    2,
  );
  if (matches.length === 1) {
    return matches[0].fsPath;
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple .model.json files named ${modelName}.model.json under ${project.pathSystem}; pass an explicit path via model.update originalModelPath`,
    );
  }

  const flatCandidate = path.join(project.pathSystem, `${modelName}.model.json`);
  if (fs.existsSync(flatCandidate)) {
    return flatCandidate;
  }

  return null;
}
