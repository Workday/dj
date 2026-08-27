import { describe, expect, test } from '@jest/globals';

import { generatePythonModelConfigPy } from '@services/framework/utils/python-model-utils';

describe('generatePythonModelConfigPy', () => {
  test('includes build_context_from_env for __main__ script execution', () => {
    const py = generatePythonModelConfigPy();
    expect(py).toContain('def build_context_from_env()');
    expect(py).toContain('PYMODEL_DS');
    expect(py).toContain('PYMODEL_DATES');
  });

  test('includes table property helpers for post-run lineage metadata', () => {
    const py = generatePythonModelConfigPy();
    expect(py).toContain('def table_properties_from_json');
    expect(py).toContain('def resolve_output_table_fqn');
    expect(py).toContain('def apply_table_properties_from_json');
    expect(py).toContain('python_model_upstream_sources');
    expect(py).toContain('python_model_name');
  });
});
