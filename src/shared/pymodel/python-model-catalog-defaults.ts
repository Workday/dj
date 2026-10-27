export interface PythonModelCatalogDefaults {
  catalog: string;
  namespace: string;
}

/** Airflow Variable for Trino/Glue catalog (see generated `python_models/_config.py`). */
export const PYTHON_MODEL_CATALOG_AIRFLOW_VAR = 'dj_python_model_catalog_name';

/** Airflow Variable for output schema/namespace. */
export const PYTHON_MODEL_DATABASE_AIRFLOW_VAR = 'dj_python_model_database_name';

/** KPO pod env key set from {@link PYTHON_MODEL_CATALOG_AIRFLOW_VAR} in etl_helper. */
export const PYTHON_MODEL_CATALOG_ENV = 'DJ_PYTHON_MODEL_CATALOG_NAME';

/** Optional pod env mirror for {@link PYTHON_MODEL_DATABASE_AIRFLOW_VAR}. */
export const PYTHON_MODEL_DATABASE_ENV = 'DJ_PYTHON_MODEL_DATABASE_NAME';

/** Matches `build_kpo_env_vars_from_context` default in etl_helper.py. */
export const PYTHON_MODEL_CATALOG_FALLBACK = 'glue';

export const PYTHON_MODEL_DATABASE_FALLBACK = 'python_source';

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== 'None' ? trimmed : undefined;
}

/**
 * Resolve catalog/namespace defaults for upstream FQN inference.
 * Precedence: explicit overrides → KPO env vars → fallbacks.
 */
export function resolvePythonModelCatalogDefaults(
  overrides?: Partial<PythonModelCatalogDefaults>,
): PythonModelCatalogDefaults {
  const catalog =
    nonEmpty(overrides?.catalog) ??
    nonEmpty(process.env[PYTHON_MODEL_CATALOG_ENV]) ??
    PYTHON_MODEL_CATALOG_FALLBACK;

  const namespace =
    nonEmpty(overrides?.namespace) ??
    nonEmpty(process.env[PYTHON_MODEL_DATABASE_ENV]) ??
    PYTHON_MODEL_DATABASE_FALLBACK;

  return { catalog, namespace };
}

/** Static fallbacks only (stable for tests); prefer {@link resolvePythonModelCatalogDefaults}. */
export const DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS: PythonModelCatalogDefaults = {
  catalog: PYTHON_MODEL_CATALOG_FALLBACK,
  namespace: PYTHON_MODEL_DATABASE_FALLBACK,
};
