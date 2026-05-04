/**
 * Extension-only configuration types.
 */

import type { AutoGenerateTestsConfig } from '@services/framework/utils';
import type { DefaultIncrementalStrategy } from '@shared/framework/types';
import type { LogLevel } from '@shared/types/common';

/**
 * Configuration object from VSCode for the DJ (Data JSON) Framework.
 * Matches all settings defined in package.json.
 * This is extension-only - the web doesn't need the full config.
 */
export type CoderConfig = {
  airflowTargetVersion?: '2.7' | '2.8' | '2.9' | '2.10';
  airflowGenerateDags?: boolean;
  airflowDagsPath?: string;
  aiHintTag?: string;
  codingAgent?: boolean | 'github-copilot' | 'claude-code' | 'cline';
  dbtProjectNames?: string[];
  dbtGenericTestsPath?: string;
  dbtMacroPath?: string;
  pythonVenvPath?: string;
  trinoPath?: string;
  lightdashProjectPath?: string;
  lightdashProfilesPath?: string;
  lightdashDefaultPartitionColumnCaseSensitive?: boolean;
  materializationDefaultIncrementalStrategy?: DefaultIncrementalStrategy;
  // Settings with defaults from package.json
  columnLineageAutoRefresh?: boolean;
  dataExplorerAutoRefresh?: boolean;
  logLevel: LogLevel;
  autoGenerateTests: AutoGenerateTestsConfig;
};
