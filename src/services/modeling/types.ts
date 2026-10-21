/**
 * Types for the extensible Modeling Framework configuration system.
 */

export interface ModelingFrameworkConfig {
  /**
   * Custom time granularities (e.g. from lightdash.config.yml `custom_granularities`).
   */
  customGranularities?: string[];

  /**
   * Additional time intervals declared globally (e.g. from lightdash.config.yml `defaults.additional_time_intervals`).
   */
  additionalTimeIntervals?: {
    date?: string[];
    timestamp?: string[];
  };
}

export interface ModelingFrameworkProvider {
  /**
   * Unique identifier of the framework (e.g. 'dbt').
   */
  readonly name: string;

  /**
   * Load modeling framework configuration for a given project directory.
   */
  loadConfig(projectRoot: string): Promise<ModelingFrameworkConfig>;

  /**
   * Relative config file names associated with this framework (e.g. ['lightdash.config.yml', 'lightdash.config.yaml']).
   */
  getConfigFiles(): string[];

  /**
   * File watch patterns to monitor for configuration changes.
   */
  getWatchGlobs?(): string[];
}
