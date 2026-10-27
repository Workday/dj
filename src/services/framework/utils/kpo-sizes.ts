import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';

import { BASE_AIRFLOW_PATH } from '@services/constants';
import { getDjConfig } from '@services/config';
import type { KpoSizeSpec } from '@shared/framework/types';

/**
 * Read KPO pod size presets from the extension's airflow template YAML.
 */
export async function readKpoSizesTemplate(): Promise<
  Record<string, KpoSizeSpec>
> {
  const { airflowTargetVersion } = getDjConfig();
  const versionFolder = airflowTargetVersion === '2.10' ? 'v2_10' : 'v2_7';
  const templatePath = path.join(
    BASE_AIRFLOW_PATH,
    versionFolder,
    'kpo_sizes.yml',
  );

  const content = await fs.readFile(templatePath, 'utf8');
  const raw = parseYaml(content) as {
    sizes?: Record<string, Partial<KpoSizeSpec>>;
  };
  const sizes = raw?.sizes ?? {};
  const result: Record<string, KpoSizeSpec> = {};

  for (const [name, spec] of Object.entries(sizes)) {
    if (!spec?.cpu || !spec?.memory) {
      continue;
    }
    result[name] = {
      cpu: String(spec.cpu),
      memory: String(spec.memory),
      guidance: spec.guidance ? String(spec.guidance) : '',
    };
  }

  return result;
}

export const ETL_HELPER_BUNDLE_FILES = [
  'etl_helper.py',
  'kpo_factory.py',
  'kpo_sizes.yml',
] as const;
