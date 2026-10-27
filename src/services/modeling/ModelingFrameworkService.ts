import { DJ_SCHEMAS_PATH } from 'admin';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { STANDARD_LIGHTDASH_TIME_INTERVALS } from './constants';
import { DbtModelingFrameworkProvider } from './providers/DbtModelingFrameworkProvider';
import type {
  ModelingFrameworkConfig,
  ModelingFrameworkProvider,
} from './types';

export class ModelingFrameworkService {
  private readonly providers = new Map<string, ModelingFrameworkProvider>();
  private readonly projectConfigs = new Map<string, ModelingFrameworkConfig>();
  private readonly logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  constructor(options?: {
    logger?: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };
  }) {
    this.logger = options?.logger;
    // Register default dbt provider
    this.registerProvider(
      new DbtModelingFrameworkProvider({ logger: this.logger }),
    );
  }

  registerProvider(provider: ModelingFrameworkProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): ModelingFrameworkProvider | undefined {
    return this.providers.get(name);
  }

  getAllProviders(): ModelingFrameworkProvider[] {
    return Array.from(this.providers.values());
  }

  async loadProjectConfig(
    projectRoot: string,
    frameworkName = 'dbt',
  ): Promise<ModelingFrameworkConfig> {
    const provider = this.getProvider(frameworkName);
    if (!provider) {
      this.logger?.warn(
        `[dj] No modeling framework provider registered for: ${frameworkName}`,
      );
      return {};
    }

    const config = await provider.loadConfig(projectRoot);
    this.projectConfigs.set(projectRoot, config);
    if (config.customGranularities?.length) {
      this.logger?.info(
        `[dj] Loaded ${config.customGranularities.length} custom granularities for ${projectRoot}: ${config.customGranularities.join(', ')}`,
      );
    }
    return config;
  }

  removeProjectConfig(projectRoot: string): void {
    this.projectConfigs.delete(projectRoot);
  }

  getProjectConfig(projectRoot: string): ModelingFrameworkConfig | undefined {
    return this.projectConfigs.get(projectRoot);
  }

  getCustomGranularities(): string[] {
    const set = new Set<string>();
    for (const config of this.projectConfigs.values()) {
      for (const grain of config.customGranularities ?? []) {
        set.add(grain);
      }
    }
    return Array.from(set).sort();
  }

  getAllTimeIntervals(): string[] {
    const set = new Set<string>(STANDARD_LIGHTDASH_TIME_INTERVALS);
    for (const grain of this.getCustomGranularities()) {
      set.add(grain);
    }
    return Array.from(set).sort();
  }

  buildTimeIntervalsSchema(): {
    $id: string;
    title: string;
    description: string;
    type: string;
    enum: string[];
  } {
    return {
      $id: 'lightdash.time_interval.schema.json',
      title: 'Schema Lightdash Time Interval',
      description: 'Valid time interval for Lightdash dimension',
      type: 'string',
      enum: this.getAllTimeIntervals(),
    };
  }

  async applyTimeIntervalsSchema(
    schemasDir = DJ_SCHEMAS_PATH,
    onUpdated?: (intervals: string[]) => void | Promise<void>,
  ): Promise<void> {
    const intervals = this.getAllTimeIntervals();
    const schemaObj = this.buildTimeIntervalsSchema();
    const content = Buffer.from(JSON.stringify(schemaObj, null, 2));
    const schemaFilePath = path.join(
      schemasDir,
      'lightdash.time_interval.schema.json',
    );

    try {
      await fs.promises.mkdir(schemasDir, { recursive: true });
      await fs.promises.writeFile(schemaFilePath, content);
      try {
        if (vscode?.workspace?.fs) {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(schemaFilePath),
            content,
          );
        }
      } catch {
        // Ignored if VS Code fs notification fails
      }
      this.logger?.info(
        `[dj] Updated ${schemaFilePath} with ${intervals.length} intervals`,
      );
    } catch (err: unknown) {
      this.logger?.warn(
        `[dj] Failed to write updated time intervals schema to ${schemaFilePath}:`,
        err,
      );
    }

    if (onUpdated) {
      await onUpdated(intervals);
    }
  }
}
