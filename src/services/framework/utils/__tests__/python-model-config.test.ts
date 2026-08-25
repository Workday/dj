import { describe, expect, test } from '@jest/globals';

import { generatePythonModelConfigPy } from '@services/framework/utils/python-model-utils';

describe('generatePythonModelConfigPy', () => {
  test('includes build_context_from_env for __main__ script execution', () => {
    const py = generatePythonModelConfigPy();
    expect(py).toContain('def build_context_from_env()');
    expect(py).toContain('PYMODEL_DS');
    expect(py).toContain('PYMODEL_DATES');
  });
});
