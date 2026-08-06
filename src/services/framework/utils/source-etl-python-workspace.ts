import { getDbtProjectExcludePaths } from '@services/config';
import * as vscode from 'vscode';

const PYTHON_MODEL_JSON_PATTERN = '**/dags/python_models/**/*.python.json';

/**
 * Return true when the workspace contains at least one user Python model
 * (a `.python.json` sidecar under `dags/python_models/`).
 */
export async function workspaceHasPythonModels(): Promise<boolean> {
  const uris = await vscode.workspace.findFiles(
    PYTHON_MODEL_JSON_PATTERN,
    getDbtProjectExcludePaths(),
    1,
  );
  return uris.length > 0;
}
