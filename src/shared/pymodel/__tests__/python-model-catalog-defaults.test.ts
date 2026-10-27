import { afterEach, describe, expect, test } from '@jest/globals';
import {
  PYTHON_MODEL_CATALOG_ENV,
  PYTHON_MODEL_CATALOG_FALLBACK,
  PYTHON_MODEL_DATABASE_ENV,
  PYTHON_MODEL_DATABASE_FALLBACK,
  resolvePythonModelCatalogDefaults,
} from '@shared/pymodel/python-model-catalog-defaults';

describe('resolvePythonModelCatalogDefaults', () => {
  const savedCatalog = process.env[PYTHON_MODEL_CATALOG_ENV];
  const savedDatabase = process.env[PYTHON_MODEL_DATABASE_ENV];

  afterEach(() => {
    if (savedCatalog === undefined) {
      delete process.env[PYTHON_MODEL_CATALOG_ENV];
    } else {
      process.env[PYTHON_MODEL_CATALOG_ENV] = savedCatalog;
    }
    if (savedDatabase === undefined) {
      delete process.env[PYTHON_MODEL_DATABASE_ENV];
    } else {
      process.env[PYTHON_MODEL_DATABASE_ENV] = savedDatabase;
    }
  });

  test('uses fallbacks when env and overrides are absent', () => {
    delete process.env[PYTHON_MODEL_CATALOG_ENV];
    delete process.env[PYTHON_MODEL_DATABASE_ENV];
    expect(resolvePythonModelCatalogDefaults()).toEqual({
      catalog: PYTHON_MODEL_CATALOG_FALLBACK,
      namespace: PYTHON_MODEL_DATABASE_FALLBACK,
    });
  });

  test('prefers explicit overrides over env', () => {
    process.env[PYTHON_MODEL_CATALOG_ENV] = 'from_env';
    process.env[PYTHON_MODEL_DATABASE_ENV] = 'from_env_db';
    expect(
      resolvePythonModelCatalogDefaults({
        catalog: 'custom_cat',
        namespace: 'custom_ns',
      }),
    ).toEqual({ catalog: 'custom_cat', namespace: 'custom_ns' });
  });

  test('reads KPO env vars when overrides omitted', () => {
    process.env[PYTHON_MODEL_CATALOG_ENV] = 'prod_glue';
    process.env[PYTHON_MODEL_DATABASE_ENV] = 'my_schema';
    expect(resolvePythonModelCatalogDefaults()).toEqual({
      catalog: 'prod_glue',
      namespace: 'my_schema',
    });
  });

  test('ignores empty or None env values', () => {
    process.env[PYTHON_MODEL_CATALOG_ENV] = 'None';
    process.env[PYTHON_MODEL_DATABASE_ENV] = '   ';
    expect(resolvePythonModelCatalogDefaults()).toEqual({
      catalog: PYTHON_MODEL_CATALOG_FALLBACK,
      namespace: PYTHON_MODEL_DATABASE_FALLBACK,
    });
  });
});
