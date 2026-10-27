import { describe, expect, test } from '@jest/globals';

import { DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS } from '@shared/pymodel/python-model-catalog-defaults';
import {
  inferTrinoUpstreamFromDependsOn,
  mergeInferredUpstreamSources,
  resolvePythonModelOutputFqn,
} from '@shared/pymodel/python-upstream-inference';
import type { PythonModelConfig } from '@shared/framework/types';

const defaults = DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS;

describe('resolvePythonModelOutputFqn', () => {
  test('uses output block when present', () => {
    expect(
      resolvePythonModelOutputFqn(
        {
          name: 'my_model',
          output: {
            database: 'glue',
            schema: 'custom_schema',
            table: 'custom_table',
          },
        },
        defaults,
      ),
    ).toBe('glue.custom_schema.custom_table');
  });

  test('falls back to defaults and model name', () => {
    expect(
      resolvePythonModelOutputFqn({ name: 'customer_tenant_dc_tracker' }, defaults),
    ).toBe('glue.python_source.customer_tenant_dc_tracker');
  });
});

describe('inferTrinoUpstreamFromDependsOn', () => {
  const ingest: PythonModelConfig = {
    name: 'customer_tenant_dc_tracker_ingest',
    group: 'etl',
    topic: 'customer_tenant_migration',
    model_type: 'python',
    table_name: 'customer_tenant_dc_tracker',
  };

  const enrichment: PythonModelConfig = {
    name: 'customer_tenant_migration_enrichment',
    group: 'etl',
    topic: 'customer_tenant_migration',
    model_type: 'python',
    table_name: 'customer_tenant_migration_enrichment',
  };

  const siblings = new Map<string, PythonModelConfig>([
    [ingest.name, ingest],
    [enrichment.name, enrichment],
  ]);

  test('infers trino FQNs from depends_on', () => {
    const status: PythonModelConfig = {
      name: 'customer_tenant_migration_status',
      group: 'etl',
      topic: 'customer_tenant_migration',
      model_type: 'python',
      depends_on: [ingest.name, enrichment.name],
    };

    expect(
      inferTrinoUpstreamFromDependsOn(status, siblings, defaults),
    ).toEqual([
      {
        type: 'trino',
        value:
          'glue.python_source.customer_tenant_dc_tracker',
      },
      {
        type: 'trino',
        value:
          'glue.python_source.customer_tenant_migration_enrichment',
      },
    ]);
  });

  test('does not duplicate author-declared trino entries', () => {
    const status: PythonModelConfig = {
      name: 'customer_tenant_migration_status',
      group: 'etl',
      topic: 'customer_tenant_migration',
      model_type: 'python',
      depends_on: [ingest.name, enrichment.name],
      upstream_sources: [
        {
          type: 'trino',
          value:
            'glue.python_source.customer_tenant_dc_tracker',
        },
      ],
    };

    expect(
      inferTrinoUpstreamFromDependsOn(status, siblings, defaults),
    ).toEqual([
      {
        type: 'trino',
        value:
          'glue.python_source.customer_tenant_migration_enrichment',
      },
    ]);
  });

  test('mergeInferredUpstreamSources appends inferred entries', () => {
    const config: PythonModelConfig = {
      name: 'm',
      group: 'etl',
      topic: 't',
      model_type: 'python',
      upstream_sources: [{ type: 'external', value: 's3::file.csv' }],
    };
    const inferred = [{ type: 'trino' as const, value: 'glue.s.t' }];

    expect(mergeInferredUpstreamSources(config, inferred)).toEqual([
      { type: 'external', value: 's3::file.csv' },
      { type: 'trino', value: 'glue.s.t' },
    ]);
  });
});