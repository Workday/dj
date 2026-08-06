import * as fs from 'fs';
import * as path from 'path';

import {
  isPythonModelJsonPath,
  SOURCE_ETL_NO_PYTHON_TEMPLATE,
  SOURCE_ETL_OUTPUT_FILE,
  SOURCE_ETL_WITH_PYTHON_TEMPLATE,
  sourceEtlTemplateFileName,
} from '@services/framework/utils/source-etl-python';

const AIRFLOW_ROOT = path.join(process.cwd(), 'airflow');

function readTemplate(version: 'v2_7' | 'v2_10', name: string): string {
  return fs.readFileSync(path.join(AIRFLOW_ROOT, version, name), 'utf8');
}

describe('source-etl-python', () => {
  describe('sourceEtlTemplateFileName', () => {
    it('selects source_etl_py_template.py when models exist', () => {
      expect(sourceEtlTemplateFileName(true)).toBe(
        SOURCE_ETL_WITH_PYTHON_TEMPLATE,
      );
      expect(SOURCE_ETL_WITH_PYTHON_TEMPLATE).toBe('source_etl_py_template.py');
    });

    it('selects source_etl.py when models do not exist', () => {
      expect(sourceEtlTemplateFileName(false)).toBe(
        SOURCE_ETL_NO_PYTHON_TEMPLATE,
      );
      expect(SOURCE_ETL_NO_PYTHON_TEMPLATE).toBe('source_etl.py');
    });

    it('always uses source_etl.py as the workspace output file', () => {
      expect(SOURCE_ETL_OUTPUT_FILE).toBe('source_etl.py');
      expect(sourceEtlTemplateFileName(true)).not.toBe(SOURCE_ETL_OUTPUT_FILE);
    });
  });

  describe.each(['v2_7', 'v2_10'] as const)('templates (%s)', (version) => {
    const withPython = readTemplate(version, SOURCE_ETL_WITH_PYTHON_TEMPLATE);
    const noPython = readTemplate(version, SOURCE_ETL_NO_PYTHON_TEMPLATE);

    it('both variants use dag_id="source_etl"', () => {
      expect(withPython).toContain('dag_id="source_etl"');
      expect(noPython).toContain('dag_id="source_etl"');
    });

    it('source_etl_py_template includes Python model wiring', () => {
      expect(withPython).toContain('TriggerDagRunOperator');
      expect(withPython).toContain(
        'from _ext_.etl_helper import get_python_source_config',
      );
      expect(withPython).toContain('trigger_python_source');
    });

    it('source_etl.py has no Python model wiring', () => {
      expect(noPython).not.toContain('TriggerDagRunOperator');
      expect(noPython).not.toContain('etl_helper');
      expect(noPython).not.toContain('trigger_python_source');
      expect(noPython).not.toContain('_source_chain');
      expect(noPython).toContain('_start_etl');
      expect(noPython).toContain('>> _end_etl');
    });
  });

  describe('isPythonModelJsonPath', () => {
    it('accepts user model paths under python_models', () => {
      expect(
        isPythonModelJsonPath(
          '/workspace/dags/python_models/finance/sales/my_model.python.json',
        ),
      ).toBe(true);
    });

    it('rejects generated scaffolding paths', () => {
      expect(
        isPythonModelJsonPath(
          '/workspace/dags/python_models/_config.python.json',
        ),
      ).toBe(false);
    });

    it('rejects paths outside python_models', () => {
      expect(isPythonModelJsonPath('/workspace/models/foo.python.json')).toBe(
        false,
      );
    });
  });
});
