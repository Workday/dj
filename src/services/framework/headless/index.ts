import {
  frameworkBuildColumns,
  frameworkGenerateModelOutput,
  frameworkGenerateSourceOutput,
  frameworkGetModelPrefix,
  frameworkMakeModelTemplate,
  type AutoGenerateTestsConfig,
} from '@services/framework/utils';
import { preserveColumnMetaOnUpdate } from '@services/framework/utils/update-helpers';
import {
  formatValidationErrorDetails,
  getValidatorForType,
} from '@services/modelValidation';
import { ValidationService } from '@services/sync/ValidationService';
import type { DJ } from '@shared';
import { jsonParse, removeEmpty } from '@shared';
import type { DbtProject } from '@shared/dbt/types';
import type {
  FrameworkModel,
  FrameworkSource,
} from '@shared/framework/types';
import type { Ajv } from 'ajv';
import { applyEdits, modify } from 'jsonc-parser';
import * as fs from 'fs';
import * as path from 'path';

import { createSchemaAjv, type SchemaAjvBundle } from './createSchemaAjv';
import {
  findDbtProjectDirs,
  getManifestInfo,
  loadDbtProject,
  type LoadDbtProjectOptions,
} from './loadDbtProject';

export {
  createSchemaAjv,
  resetSchemaAjvCache,
  type SchemaAjvBundle,
} from './createSchemaAjv';
export {
  findDbtProjectDirs,
  getManifestInfo,
  loadDbtProject,
  type LoadDbtProjectOptions,
} from './loadDbtProject';

const JSONC_FORMAT_OPTIONS = {
  tabSize: 4,
  insertSpaces: true,
  eol: '\n',
};

export interface HeadlessDjConfig {
  aiHintTag?: string;
  lightdashDefaultSqlFilter?: string;
  lightdashDefaultSqlFilterRequiredColumns?: string[];
  lightdashDefaultPartitionColumnCaseSensitive?: boolean;
  lightdashDefaultSortedByColumnCaseSensitive?: boolean;
  materializationDefaultIncrementalStrategy?: DJ['config']['materializationDefaultIncrementalStrategy'];
  autoGenerateTests?: AutoGenerateTestsConfig;
}

const DEFAULT_AUTO_GENERATE_TESTS: AutoGenerateTestsConfig = {
  tests: { equalRowCount: { enabled: true, applyTo: ['left'] } },
};

export function createDefaultDjConfig(
  overrides: Partial<HeadlessDjConfig> = {},
): HeadlessDjConfig {
  return {
    aiHintTag: process.env.DJ_AI_HINT_TAG ?? 'ai',
    lightdashDefaultSqlFilter: process.env.DJ_LIGHTDASH_DEFAULT_SQL_FILTER ?? '',
    materializationDefaultIncrementalStrategy:
      (process.env.DJ_DEFAULT_INCREMENTAL_STRATEGY as DJ['config']['materializationDefaultIncrementalStrategy']) ??
      'append',
    autoGenerateTests: DEFAULT_AUTO_GENERATE_TESTS,
    ...overrides,
  };
}

export function createDj(config: HeadlessDjConfig = createDefaultDjConfig()): DJ {
  return {
    config: {
      aiHintTag: config.aiHintTag,
      lightdashDefaultSqlFilter: config.lightdashDefaultSqlFilter,
      lightdashDefaultSqlFilterRequiredColumns:
        config.lightdashDefaultSqlFilterRequiredColumns,
      lightdashDefaultPartitionColumnCaseSensitive:
        config.lightdashDefaultPartitionColumnCaseSensitive,
      lightdashDefaultSortedByColumnCaseSensitive:
        config.lightdashDefaultSortedByColumnCaseSensitive,
      materializationDefaultIncrementalStrategy:
        config.materializationDefaultIncrementalStrategy,
    },
  };
}

export interface ModelPaths {
  prefix: string;
  modelJson: string;
  sql: string;
  yml: string;
}

export function resolveModelPaths(
  project: DbtProject,
  modelJson: Pick<FrameworkModel, 'group' | 'name' | 'topic' | 'type'>,
): ModelPaths {
  const prefix = frameworkGetModelPrefix({ project, modelJson });
  if (!prefix) {
    throw new Error('Unable to resolve model path from model JSON');
  }
  return {
    prefix,
    modelJson: `${prefix}.model.json`,
    sql: `${prefix}.sql`,
    yml: `${prefix}.yml`,
  };
}

export interface ValidationIssue {
  message: string;
  details?: string[];
}

export interface ValidateModelResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateModelJson(
  bundle: SchemaAjvBundle,
  modelJson: FrameworkModel,
  modelJsonPath?: string,
  config: HeadlessDjConfig = createDefaultDjConfig(),
): ValidateModelResult {
  const logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
  };
  const validationService = new ValidationService(
    bundle.ajv,
    bundle.sourceValidator,
    logger,
  );
  const result = validationService.validateModel({
    modelJson,
    pathJson: modelJsonPath ?? 'model.json',
    config: config.autoGenerateTests ?? DEFAULT_AUTO_GENERATE_TESTS,
  });

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!result.valid) {
    if (result.errors?.length) {
      errors.push({
        message: result.error ?? 'Schema validation failed',
        details: result.errors.map((e) => e.message),
      });
    } else if (result.error) {
      errors.push({ message: result.error });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateSourceJson(
  bundle: SchemaAjvBundle,
  sourceJson: FrameworkSource,
): ValidateModelResult {
  const logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
  };
  const validationService = new ValidationService(
    bundle.ajv,
    bundle.sourceValidator,
    logger,
  );
  const result = validationService.validateSource({
    sourceJson,
    pathJson: 'source.json',
  });
  const errors: ValidationIssue[] = [];
  if (!result.valid) {
    if (result.errors?.length) {
      errors.push({
        message: result.error ?? 'Source schema validation failed',
        details: result.errors.map((e) => e.message),
      });
    } else if (result.error) {
      errors.push({ message: result.error });
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export interface PreviewModelResult {
  modelJson: FrameworkModel;
  sql: string;
  yml: string;
  columns: Array<{
    name: string;
    description: string;
    type: 'dim' | 'fct';
    dataType: string;
  }>;
}

export function previewModel(
  project: DbtProject,
  modelInput: Record<string, unknown>,
  config: HeadlessDjConfig = createDefaultDjConfig(),
): PreviewModelResult {
  const dj = createDj(config);
  let formattedModelJson: FrameworkModel;
  try {
    formattedModelJson = frameworkMakeModelTemplate(
      modelInput as Parameters<typeof frameworkMakeModelTemplate>[0],
      config.autoGenerateTests ?? DEFAULT_AUTO_GENERATE_TESTS,
    );
  } catch {
    formattedModelJson = modelInput as FrameworkModel;
  }

  const generated = frameworkGenerateModelOutput({
    dj,
    project,
    modelJson: formattedModelJson,
  });

  const { columns } = frameworkBuildColumns({
    dj,
    modelJson: formattedModelJson,
    project,
  });

  const columnMetadata = columns.map((col) => ({
    name: col.name,
    description: col.description || '',
    type: col.meta?.type === 'fct' ? ('fct' as const) : ('dim' as const),
    dataType: col.data_type || 'string',
  }));

  return {
    modelJson: removeEmpty(formattedModelJson),
    sql: generated.sql,
    yml: generated.yml,
    columns: columnMetadata,
  };
}

export interface GenerateArtifactsResult {
  sql: string;
  yml: string;
  project: DbtProject;
}

export function generateModelArtifacts(
  project: DbtProject,
  modelJson: FrameworkModel,
  config: HeadlessDjConfig = createDefaultDjConfig(),
): GenerateArtifactsResult {
  const generated = frameworkGenerateModelOutput({
    dj: createDj(config),
    project,
    modelJson,
  });
  return {
    sql: generated.sql,
    yml: generated.yml,
    project: generated.project,
  };
}

export function generateSourceArtifacts(
  project: DbtProject,
  sourceJson: FrameworkSource,
): { yml: string; project: DbtProject } {
  const generated = frameworkGenerateSourceOutput({ project, sourceJson });
  return { yml: generated.yml, project: generated.project };
}

export function buildModelFromCreateRequest(
  request: Parameters<typeof frameworkMakeModelTemplate>[0],
  config: HeadlessDjConfig = createDefaultDjConfig(),
): FrameworkModel {
  return removeEmpty(
    frameworkMakeModelTemplate(
      request,
      config.autoGenerateTests ?? DEFAULT_AUTO_GENERATE_TESTS,
    ),
  );
}

export function mergeModelUpdate(
  existingContent: string,
  incomingModelJson: FrameworkModel,
): FrameworkModel {
  const existingModelJson = jsonParse(existingContent) as Record<string, unknown>;
  const incomingBase = { ...incomingModelJson } as Record<string, unknown>;
  preserveColumnMetaOnUpdate(existingModelJson, incomingBase);
  return incomingBase as FrameworkModel;
}

export function applyJsonPatch(
  existingContent: string,
  patch: Record<string, unknown>,
): string {
  const edits = modify(existingContent, patch, JSONC_FORMAT_OPTIONS);
  return applyEdits(existingContent, edits, JSONC_FORMAT_OPTIONS);
}

export function formatModelJson(modelJson: FrameworkModel): string {
  return JSON.stringify(modelJson, null, 4);
}

export function readTextFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function deleteFileIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function resolveProject(
  workspaceRoot: string,
  projectPath?: string,
  projectName?: string,
): DbtProject {
  if (projectPath) {
    return loadDbtProject(projectPath, { workspaceRoot });
  }

  const dirs = findDbtProjectDirs(workspaceRoot);
  if (dirs.length === 0) {
    throw new Error(`No dbt_project.yml found under ${workspaceRoot}`);
  }

  if (projectName) {
    for (const dir of dirs) {
      const project = loadDbtProject(dir, { workspaceRoot });
      if (project.name === projectName) {
        return project;
      }
    }
    throw new Error(`No dbt project named "${projectName}" found`);
  }

  if (dirs.length > 1) {
    throw new Error(
      `Multiple dbt projects found. Specify projectPath or projectName. Found: ${dirs.join(', ')}`,
    );
  }

  return loadDbtProject(dirs[0], { workspaceRoot });
}

export function getTypeValidator(ajv: Ajv, type: FrameworkModel['type']) {
  return getValidatorForType(ajv, type);
}

export function formatAjvDetails(
  errors: Parameters<typeof formatValidationErrorDetails>[0],
): string[] {
  return formatValidationErrorDetails(errors).map((e) => e.message);
}
