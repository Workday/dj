import { getDjConfig } from '@services/config';
import type { PythonModelConfig } from '@shared/framework/types';
import {
  DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS,
  enrichPythonModelUpstreamSources,
  type PythonModelCatalogDefaults,
  resolvePythonModelCatalogDefaults,
} from '@shared/pymodel/python-upstream-inference';
import * as fs from 'fs';
import * as path from 'path';

export { DEFAULT_PYTHON_MODEL_CATALOG_DEFAULTS };

/** Catalog/namespace defaults for upstream inference (workspace settings, env, fallbacks). */
export function getPythonModelCatalogDefaultsForWorkspace(): PythonModelCatalogDefaults {
  const dj = getDjConfig();
  return resolvePythonModelCatalogDefaults({
    catalog: dj.pythonModelCatalogName,
    namespace: dj.pythonModelDatabaseName,
  });
}

/** Load all python model configs in a topic directory keyed by model name. */
export function loadTopicPythonModelConfigs(
  topicDir: string,
): Map<string, PythonModelConfig> {
  const configs = new Map<string, PythonModelConfig>();
  if (!fs.existsSync(topicDir)) {
    return configs;
  }

  for (const entry of fs.readdirSync(topicDir)) {
    if (!entry.endsWith('.python.json')) {
      continue;
    }
    const jsonPath = path.join(topicDir, entry);
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const config = JSON.parse(raw) as PythonModelConfig;
      if (config.name) {
        configs.set(config.name, config);
      }
    } catch {
      // skip invalid files
    }
  }

  return configs;
}

/** Merge auto-inferred trino upstream_sources from depends_on when missing. */
export function applyUpstreamInference(
  config: PythonModelConfig,
  topicDir: string,
  defaults: PythonModelCatalogDefaults = getPythonModelCatalogDefaultsForWorkspace(),
): PythonModelConfig {
  const siblings = loadTopicPythonModelConfigs(topicDir);
  siblings.set(config.name, config);
  return enrichPythonModelUpstreamSources(config, siblings, defaults);
}
