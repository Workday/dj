import type { DbtRunLineage, DbtRunScope } from '@shared/dbt/types';

export const TOOLTIPS = {
  cleanAndDeps:
    'Runs dbt clean (removes artifacts) and dbt deps (installs dependencies) before the main operation.',
  seed: 'Loads CSV files into the data warehouse as tables before running models.',
  build:
    'Uses dbt build instead of dbt run, which can handle different model types (tables, views, incremental models) in a single command.',
  defer:
    'Uses the manifest from a previous run to determine which models to skip. Requires a production manifest file in the state path.',
  favorState:
    'When a model exists in both the current project and the deferred state, prefer the deferred (state) version. Only applies with Defer.',
  statePath:
    'Path to the directory containing production manifest (manifest.json). Required when using defer.',
  fullRefresh:
    'Forces dbt to rebuild the entire model from scratch, ignoring any existing data. This will drop and recreate the table/view.',
  scope: 'Select which models to run based on the current model selection.',
  dates:
    'Set start and end dates for the dbt run execution. Enter only start date if you want to process a single day.',
} as const;

interface ScopeOption {
  value: DbtRunScope;
  label: string;
  description: string;
}

export const SCOPE_OPTIONS: readonly ScopeOption[] = [
  {
    value: 'single',
    label: 'Single Model Selection',
    description: 'Run the current model with lineage',
  },
  {
    value: 'multi-model',
    label: 'Multi-Model Selection',
    description: 'Select multiple models and their lineage',
  },
  {
    value: 'modified',
    label: 'Modified Models',
    description: 'Run all models changed from master',
  },
  {
    value: 'full-project',
    label: 'Full Project',
    description: 'Run all models',
  },
] as const;

interface LineageOption {
  value: DbtRunLineage;
  label: string;
  description: string;
}

export const LINEAGE_OPTIONS: readonly LineageOption[] = [
  {
    value: 'model-only',
    label: 'Model Only',
    description: 'Run only the selected model',
  },
  {
    value: 'upstream',
    label: 'Upstream',
    description: 'Model & ancestors',
  },
  {
    value: 'downstream',
    label: 'Downstream',
    description: 'Model & descendants',
  },
  {
    value: 'full-lineage',
    label: 'Full Lineage',
    description: 'Ancestors & descendants',
  },
] as const;

export const DEFAULT_DEFER_STATE_PATH = 'prod_state';
