import type { DateIso } from '@shared';
import {
  dateAddDaysIso,
  dateDiffDays,
  dateToIso,
  jsonParse,
  yamlParse,
} from '@shared';
import type {
  DbtProject,
  DbtProjectCatalog,
  DbtProjectManifest,
  DbtProjectProperties,
  DbtProperties,
  DbtRunConfig,
} from '@shared/dbt/types';
import { assertSqlIdentifier } from '@shared/sql/identifier';
import * as _ from 'lodash';

export function dbtEventDates({ project }: { project: DbtProject }): {
  dates: string[];
  ranges: { end: string; start: string }[];
} {
  let dates: DateIso[] = [];
  const ranges: { end: string; start: string }[] = [];
  const varEventDates = project.variables?.event_dates;

  if (!varEventDates) {
    return { dates, ranges };
  }

  if (/d{4}-d{2}-d{2}~d{4}-d{2}-d{2}/.test(varEventDates)) {
    const [start, end] = varEventDates.split('~') as DateIso[];
    ranges.push({
      start,
      end: dateAddDaysIso(end, 1), // When doing a range, we'll exclude the end date
    });
    const days = dateDiffDays(start, end);
    for (let i = 0; i <= days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      dates.push(dateToIso(date));
    }
  } else {
    dates = _.chain(varEventDates)
      .split(',')
      .uniq()
      .sort()
      .value() as DateIso[];
    for (const start of dates) {
      ranges.push({
        start,
        end: dateAddDaysIso(start, 1),
      });
    }
  }

  return { dates, ranges };
}

export function dbtSourcePropertiesString({
  project,
  sourceId,
}: {
  project: DbtProject;
  sourceId: string;
}) {
  const source = project.manifest.sources[sourceId];
  const properties = JSON.stringify(source).replaceAll("'", "''");
  return properties;
}

export function dbtSourceRegisterSql({
  project,
  sourceId,
}: {
  project: DbtProject;
  sourceId: string;
}) {
  const properties = dbtSourcePropertiesString({ project, sourceId });

  const etlSchema = project.properties.vars?.etl_schema || 'source_etl';

  // project.name and etl_schema come from dbt_project.yml (untrusted); constrain
  // them to bare identifiers before interpolating into the query.
  assertSqlIdentifier(project.name, 'project name');
  assertSqlIdentifier(etlSchema, 'etl_schema');

  const sql = `
MERGE INTO ${project.name}.${etlSchema}.dbt_sources old
USING (VALUES ('${sourceId}', '${properties}', false)) new (source_id, properties, etl_active)
ON (old.source_id = new.source_id)
WHEN MATCHED
    THEN UPDATE SET properties = new.properties
WHEN NOT MATCHED
    THEN INSERT (source_id, properties, etl_active) VALUES (new.source_id, new.properties, new.etl_active)
`;

  return sql;
}

/**
 * Function to normalize the macro id to include the project/package name
 * @param name Current string name of macro
 * @param project Project containing macro
 * @returns Id for macro incorporating both namespace and macro name
 */
export function getDbtMacroId({
  name = '',
  project,
}: {
  name: string | undefined;
  project: Partial<DbtProject>;
}): string | null {
  const nameArray = name.split('.');
  return nameArray.length === 1
    ? `${project.name}.${name}`
    : nameArray.length === 2
      ? name
      : null;
}

/**
 * Function to normalize the model id to include the project/package name
 * @param name Current string name of model
 * @param project Project containing model
 * @returns Id for model incorporating both namespace and model name
 */
export function getDbtModelId({
  modelName,
  projectName,
}: {
  modelName: string;
  projectName: string;
}): string {
  const nameArray = modelName.split('.');
  return nameArray.length === 1
    ? `model.${projectName}.${modelName}`
    : nameArray.length === 2
      ? modelName
      : '';
}

export function getDbtProjectProperties(content: string) {
  return yamlParse(content) as Partial<DbtProjectProperties>;
}

export function getDbtProjectCatalog(content: string) {
  return jsonParse(content) as Partial<DbtProjectCatalog>;
}

export function getDbtProjectManifest(content: string) {
  return jsonParse(content) as Partial<DbtProjectManifest>;
}

export function getDbtProperties(content: string) {
  return yamlParse(content) as Partial<DbtProperties>;
}

/**
 * Build DBT run command string from configuration
 * @param config - The run configuration with flags and options (includes modelName and projectPath)
 * @returns Complete DBT command string
 */
export function buildDbtRunCommand(config: DbtRunConfig): string {
  const commandParts: string[] = [];

  // Initial commands
  if (config.cleanAndDeps) {
    commandParts.push('dbt clean');
    commandParts.push('dbt deps');
  }
  if (config.seed) {
    commandParts.push('dbt seed');
  }

  // Main command (run or build)
  const mainCommand = config.build ? 'dbt build' : 'dbt run';
  let selectClause = '';

  // Helper function to apply lineage to a model name
  const applyLineage = (model: string, lineage?: string): string => {
    switch (lineage) {
      case 'model-only':
        return model;
      case 'upstream':
        return `+${model}`;
      case 'downstream':
        return `${model}+`;
      case 'full-lineage':
        return `+${model}+`;
      default:
        return model;
    }
  };

  // Build select clause based on scope
  switch (config.scope) {
    case 'single':
      // Apply lineage configuration to the single model
      if (config.modelName) {
        selectClause = applyLineage(config.modelName, config.lineage);
      }
      break;
    case 'multi-model':
      // Build select clause with all selected models and their individual lineage
      if (config.selectedModels && config.selectedModels.length > 0) {
        selectClause = config.selectedModels
          .map((model) => applyLineage(model.modelName, model.lineage))
          .join(' ');
      } else {
        selectClause = ''; // No models to run
      }
      break;
    case 'full-project':
      selectClause = ''; // No select clause runs all models
      break;
    case 'modified':
      // Build select clause with selected modified models (with per-model lineage)
      if (
        config.selectedModifiedModels &&
        config.selectedModifiedModels.length > 0
      ) {
        selectClause = config.selectedModifiedModels
          .map((model) => applyLineage(model.modelName, model.lineage))
          .join(' ');
      } else if (config.modifiedModels && config.modifiedModels.length > 0) {
        // Fallback: all modified models with downstream lineage
        selectClause = config.modifiedModels
          .map((model) => `${model}+`)
          .join(' ');
      } else {
        selectClause = ''; // No models to run
      }
      break;
  }

  let finalCommand = mainCommand;
  if (selectClause) {
    finalCommand += ` --select "${selectClause}"`;
  }

  // Add advanced flags
  if (config.fullRefresh) {
    finalCommand += ' --full-refresh';
  }
  if (config.defer && config.statePath) {
    finalCommand += ` --defer --state ${config.statePath}`;
    if (config.favorState) {
      finalCommand += ' --favor-state';
    }
  }

  // Add date variables if provided
  const vars: Record<string, string> = {};

  // Format: { event_dates: '2025-01-01' } or { event_dates: '2025-01-01~2025-01-31' }
  if (config.startDate && config.endDate) {
    vars.event_dates = `${config.startDate}~${config.endDate}`;
  } else if (config.startDate) {
    vars.event_dates = config.startDate;
  }
  if (vars.event_dates) {
    finalCommand += ` --vars '${JSON.stringify(vars)}'`;
  }

  commandParts.push(finalCommand);

  // Add project path navigation if provided
  if (config.projectPath) {
    return `cd ${config.projectPath} && ${commandParts.join(' && ')}`;
  }

  // Join all command parts
  return commandParts.join(' && ');
}
