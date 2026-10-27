import type { DJ } from '@shared';
import type { DbtProject } from '@shared/dbt/types';

export const mockConfig: any = {
  airflowGenerateDags: false,
  dbtMacroPath: '_ext_',
  airflowDagsPath: 'dags/_ext_',
};

export const createTestDJ = (): DJ => ({
  config: mockConfig,
});

/**
 * Creates a minimal DbtProject for testing. Accepts optional manifest node
 * overrides so each test file can customize the models/sources available.
 */
export function createTestProject(
  overrides?: Partial<DbtProject> & {
    nodes?: Record<string, any>;
    sources?: Record<string, any>;
  },
): DbtProject {
  const {
    nodes = {
      ['model.project.model_a']: {
        columns: {
          col_a: {
            name: 'col_a',
            data_type: 'varchar',
            meta: { type: 'dim' },
          },
          col_b: {
            name: 'col_b',
            data_type: 'bigint',
            meta: { type: 'fct' },
          },
        },
      },
    },
    sources = {},
    ...rest
  } = overrides || {};

  return {
    name: 'project',
    macroPaths: ['macros'],
    manifest: {
      child_map: {},
      disabled: {},
      docs: {},
      exposures: {},
      group_map: {},
      groups: {},
      macros: {},
      metadata: { project_name: 'project' },
      metrics: {},
      nodes,
      parent_map: {},
      saved_queries: {},
      selectors: {},
      semantic_models: {},
      sources,
    },
    modelPaths: ['models'],
    packagePath: '',
    pathRelative: '',
    pathSystem: '',
    properties: { vars: { event_dates: '2024-07-01' } },
    targetPath: 'target',
    variables: {},
    ...rest,
  };
}
