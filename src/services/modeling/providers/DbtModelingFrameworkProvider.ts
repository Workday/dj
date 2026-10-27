import { yamlParse } from '@shared';
import * as fs from 'fs';
import * as path from 'path';

import type {
  ModelingFrameworkConfig,
  ModelingFrameworkProvider,
} from '../types';

export class DbtModelingFrameworkProvider implements ModelingFrameworkProvider {
  readonly name = 'dbt';
  private readonly logger?: {
    warn: (...args: unknown[]) => void;
  };

  constructor(options?: { logger?: { warn: (...args: unknown[]) => void } }) {
    this.logger = options?.logger;
  }

  private static readonly CONFIG_FILES = [
    'lightdash.config.yml',
    'lightdash.config.yaml',
  ];

  getConfigFiles(): string[] {
    return [...DbtModelingFrameworkProvider.CONFIG_FILES];
  }

  getWatchGlobs(): string[] {
    return ['**/lightdash.config.yml', '**/lightdash.config.yaml'];
  }

  async loadConfig(projectRoot: string): Promise<ModelingFrameworkConfig> {
    for (const filename of DbtModelingFrameworkProvider.CONFIG_FILES) {
      const fullPath = path.join(projectRoot, filename);
      if (fs.existsSync(fullPath)) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf8');
          const parsed = yamlParse(content) as Record<string, unknown> | null;
          if (parsed && typeof parsed === 'object') {
            return this.parseLightdashConfig(parsed);
          }
        } catch (err: unknown) {
          this.logger?.warn(`[dj] Failed to parse ${fullPath}:`, err);
        }
      }
    }
    return {};
  }

  private parseLightdashConfig(
    config: Record<string, unknown>,
  ): ModelingFrameworkConfig {
    const customGranularities: string[] = [];
    if (
      config.custom_granularities &&
      typeof config.custom_granularities === 'object' &&
      !Array.isArray(config.custom_granularities)
    ) {
      for (const key of Object.keys(config.custom_granularities)) {
        const trimmed = key.trim();
        if (trimmed) {
          customGranularities.push(trimmed);
        }
      }
    }

    return {
      customGranularities:
        customGranularities.length > 0 ? customGranularities : undefined,
    };
  }
}
