import type {
  PythonModelConfig,
  PythonModelUpstreamSource,
} from '@shared/framework/types';

import {
  resolvePythonModelCatalogDefaults,
  type PythonModelCatalogDefaults,
} from './python-model-catalog-defaults';
import { normalizeUpstreamSources } from './python-upstream-sources';

export type { PythonModelCatalogDefaults } from './python-model-catalog-defaults';
export {
  DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS,
  resolvePythonModelCatalogDefaults,
} from './python-model-catalog-defaults';

/** Resolve catalog.schema.table for a python model output table. */
export function resolvePythonModelOutputFqn(
  config: Pick<
    PythonModelConfig,
    'name' | 'namespace' | 'table_name' | 'output'
  >,
  defaults: PythonModelCatalogDefaults,
): string {
  const output = config.output ?? {};
  const catalog = output.database ?? defaults.catalog;
  const schema = output.schema ?? config.namespace ?? defaults.namespace;
  const table = output.table ?? config.table_name ?? config.name;
  return `${catalog}.${schema}.${table}`;
}

function existingTrinoValueKeys(
  entries: PythonModelUpstreamSource[],
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'trino') {
      continue;
    }
    keys.add(entry.value);
    const parts = entry.value.split('.');
    if (parts.length >= 2) {
      keys.add(parts.slice(-2).join('.'));
    }
  }
  return keys;
}

/**
 * Infer trino upstream_sources entries from depends_on model names.
 * Does not overwrite author-declared entries; returns only new trino refs.
 */
export function inferTrinoUpstreamFromDependsOn(
  config: PythonModelConfig,
  siblingConfigs: Map<string, PythonModelConfig>,
  defaults: PythonModelCatalogDefaults,
): PythonModelUpstreamSource[] {
  const dependsOn = config.depends_on ?? [];
  if (dependsOn.length === 0) {
    return [];
  }

  const existingKeys = existingTrinoValueKeys(
    normalizeUpstreamSources(config.upstream_sources),
  );
  const inferred: PythonModelUpstreamSource[] = [];

  for (const depName of dependsOn) {
    const upstream = siblingConfigs.get(depName);
    if (!upstream) {
      continue;
    }
    const fqn = resolvePythonModelOutputFqn(upstream, defaults);
    const schemaTable = fqn.split('.').slice(-2).join('.');
    if (existingKeys.has(fqn) || existingKeys.has(schemaTable)) {
      continue;
    }
    inferred.push({ type: 'trino', value: fqn });
    existingKeys.add(fqn);
    existingKeys.add(schemaTable);
  }

  return inferred;
}

/** Apply depends_on inference and return a config with merged upstream_sources. */
export function enrichPythonModelUpstreamSources(
  config: PythonModelConfig,
  siblingConfigs: Map<string, PythonModelConfig>,
  defaults: PythonModelCatalogDefaults = resolvePythonModelCatalogDefaults(),
): PythonModelConfig {
  const inferred = inferTrinoUpstreamFromDependsOn(
    config,
    siblingConfigs,
    defaults,
  );
  if (inferred.length === 0) {
    return config;
  }
  return {
    ...config,
    upstream_sources: mergeInferredUpstreamSources(config, inferred),
  };
}

/** Merge inferred trino entries onto existing upstream_sources (inferred appended). */
export function mergeInferredUpstreamSources(
  config: PythonModelConfig,
  inferred: PythonModelUpstreamSource[],
): PythonModelUpstreamSource[] {
  const existing = normalizeUpstreamSources(config.upstream_sources);
  if (inferred.length === 0) {
    return existing;
  }
  return [...existing, ...inferred];
}
