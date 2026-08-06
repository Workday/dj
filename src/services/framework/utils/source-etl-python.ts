/**
 * Template selection for DJ-generated source_etl DAG files.
 * Workspace discovery lives in source-etl-python-workspace.ts.
 *
 * Internal templates (extension repo only) are copied to the workspace as
 * source_etl.py with dag_id="source_etl" — never as separate DAG files.
 */

import * as path from 'path';

export const SOURCE_ETL_OUTPUT_FILE = 'source_etl.py';
export const SOURCE_ETL_NO_PYTHON_TEMPLATE = 'source_etl.py';
export const SOURCE_ETL_WITH_PYTHON_TEMPLATE = 'source_etl_py_template.py';

/**
 * Return true when a path is a user Python model metadata file.
 */
export function isPythonModelJsonPath(fsPath: string): boolean {
  if (!fsPath.endsWith('.python.json')) {
    return false;
  }
  const parts = fsPath.split(path.sep);
  const pythonModelsIdx = parts.indexOf('python_models');
  if (pythonModelsIdx === -1) {
    return false;
  }
  const relParts = parts.slice(pythonModelsIdx + 1);
  return relParts.length >= 2 && !relParts.some((p) => p.startsWith('_'));
}

/**
 * Internal template filename to read for source_etl generation.
 * Destination is always SOURCE_ETL_OUTPUT_FILE.
 */
export function sourceEtlTemplateFileName(
  hasPythonModels: boolean,
):
  | typeof SOURCE_ETL_WITH_PYTHON_TEMPLATE
  | typeof SOURCE_ETL_NO_PYTHON_TEMPLATE {
  return hasPythonModels
    ? SOURCE_ETL_WITH_PYTHON_TEMPLATE
    : SOURCE_ETL_NO_PYTHON_TEMPLATE;
}
