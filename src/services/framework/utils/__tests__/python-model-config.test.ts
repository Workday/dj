import { describe, expect, test } from '@jest/globals';

import { generatePythonModelConfigPy, generateTrinoIoPy } from '@services/framework/utils/python-model-utils';

describe('generatePythonModelConfigPy', () => {
  test('includes build_context_from_env for __main__ script execution', () => {
    const py = generatePythonModelConfigPy();
    expect(py).toContain('def build_context_from_env()');
    expect(py).toContain('PYMODEL_DS');
    expect(py).toContain('PYMODEL_DATES');
    expect(py).toContain('logging.basicConfig');
    expect(py).toContain('stream=sys.stdout');
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

describe('generateTrinoIoPy', () => {
  test('includes pandas helpers for python-path models', () => {
    const py = generateTrinoIoPy();
    expect(py).toContain('def read_partition_to_dataframe');
    expect(py).toContain('def overwrite_partition_from_dataframe');
    expect(py).toContain('Pandas I/O (python-path models only)');
  });

  test('resolves Trino connection from dj_etl_trino_* variables', () => {
    const py = generateTrinoIoPy();
    expect(py).toContain('_var("dj_etl_trino_host")');
    expect(py).toContain('_var("dj_etl_trino_user")');
    expect(py).toContain('_var("dj_etl_trino_password")');
    expect(py).not.toContain('opus-etl-cluster-host');
  });

  test('exports stable public _trino_io API surface', () => {
    const py = generateTrinoIoPy();
    const publicDefs = [
      ...py.matchAll(/^def ([a-z][a-z0-9_]*)\(/gm),
    ].map((m) => m[1]);

    expect(publicDefs).toEqual([
      'get_trino_connection',
      'execute_sql',
      'fetch_value',
      'append',
      'overwrite',
      'overwrite_partition',
      'merge',
      'create_schema',
      'create_hive_csv_external_table',
      'create_iceberg_table',
      'set_extra_properties',
      'flush_hive_metadata_cache',
      'update',
      'read_partition_to_dataframe',
      'overwrite_partition_from_dataframe',
    ]);
  });
});
