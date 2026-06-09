import { generateAgentsMd } from '@services/agent/utils';
import type { Coder } from '@services/coder';
import type { CoderFileInfo } from '@services/coder/types';
import {
  getDbtProjectExcludePaths,
  getDjConfig,
  isDbtProjectNameConfigured,
} from '@services/config';
import {
  BASE_AIRFLOW_PATH,
  BASE_MACROS_PATH,
  BASE_SKILLS_PATH,
  BASE_TESTS_PATH,
  COMMAND_ID,
  DBT_MSG,
  DEFAULT_DBT_PATH,
  VIEW_ID,
} from '@services/constants';
import type { DJLogger } from '@services/djLogger';
import { PARTITION_DAILY } from '@services/framework/constants';
import type { FrameworkState } from '@services/framework/FrameworkState';
import {
  frameworkExtractModelName,
  frameworkGetMacro,
  frameworkGetNode,
  frameworkGetNodeColumns,
  frameworkMakeSourceId,
} from '@services/framework/utils';
import { ModelEditService } from '@services/modelEdit';
import { getManifestResources } from '@services/sync';
import type { ApiEnabledService } from '@services/types';
import {
  buildProcessEnv,
  getVenvEnvironment,
  runProcess,
} from '@services/utils/process';
import { sqlFormat } from '@services/utils/sql';
import { getHtml } from '@services/webview/utils';
import { assertExhaustive, jsonParse } from '@shared';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type {
  DbtModel,
  DbtProject,
  DbtProjectManifest,
  DbtProjectManifestMacro,
  DbtSeed,
  DbtSource,
} from '@shared/dbt/types';
import {
  buildDbtRunCommand,
  getDbtModelId,
  getDbtProjectProperties,
} from '@shared/dbt/utils';
import type { FrameworkSchemaBase } from '@shared/framework/types';
import type { TreeData, TreeItem } from 'admin';
import { DJ_SCHEMAS_PATH, TreeDataInstance, WORKSPACE_ROOT } from 'admin';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { applyEdits, modify } from 'jsonc-parser';
import * as _ from 'lodash';
import * as path from 'path';
import * as vscode from 'vscode';

export class Dbt implements ApiEnabledService<'dbt'> {
  coder: Coder;
  context: vscode.ExtensionContext;
  log: DJLogger;
  state: FrameworkState;
  modelEdit: ModelEditService;
  handleApi: (payload: ApiPayload<'dbt'>) => Promise<ApiResponse>;
  macros = new Map<string, DbtProjectManifestMacro>();
  models = new Map<string, DbtModel>();
  // Flag to prevent multiple parse commands from running at once
  parsing: boolean = false;
  // Track how many parse requests came in
  parsingCounter: number = 0;
  projects = new Map<string, DbtProject>();
  ready: boolean = false;
  seeds = new Map<string, DbtSeed>();
  sources = new Map<string, DbtSource>();
  // Webview reference for compilation log streaming
  private webviewView?: vscode.WebviewView;
  treeItemJsonSync: TreeItem = {
    command: {
      command: COMMAND_ID.JSON_SYNC,
      title: 'DJ: Sync to SQL and YML',
    },
    iconPath: new vscode.ThemeIcon('sync'),
    label: 'Sync to SQL and YML',
  };
  treeItemModelCreate: TreeItem = {
    command: {
      command: COMMAND_ID.MODEL_CREATE,
      title: 'Create Model',
    },
    iconPath: new vscode.ThemeIcon('add'),
    label: 'Create Model',
  };
  treeItemModelCompile: TreeItem = {
    command: {
      command: COMMAND_ID.MODEL_COMPILE,
      title: 'Compile Model',
    },
    iconPath: new vscode.ThemeIcon('beaker'),
    label: 'Compile Model',
  };
  treeItemModelRun: TreeItem = {
    command: {
      command: COMMAND_ID.MODEL_RUN,
      title: 'Run Model',
    },
    iconPath: new vscode.ThemeIcon('play'),
    label: 'Run Model',
  };
  treeItemModelTest: TreeItem = {
    command: {
      command: COMMAND_ID.MODEL_TEST,
      title: 'Run DBT Test',
    },
    iconPath: new vscode.ThemeIcon('beaker'),
    label: 'Run DBT Test',
  };
  treeItemProjectClean: TreeItem = {
    command: {
      command: COMMAND_ID.PROJECT_CLEAN,
      title: 'Clean Project',
    },
    iconPath: new vscode.ThemeIcon('debug-restart'),
    label: 'Clean Project',
  };
  treeItemSourceCreate: TreeItem = {
    command: {
      command: COMMAND_ID.SOURCE_CREATE,
      title: 'Create Source',
    },
    iconPath: new vscode.ThemeIcon('add'),
    label: 'Create Source',
  };
  treeItemQueryCreate: TreeItem = {
    command: {
      command: COMMAND_ID.QUERY_DRAFT_CREATE,
      title: 'Create New Query',
    },
    iconPath: new vscode.ThemeIcon('file-add'),
    label: 'Create New Query',
  };

  // Webview panels
  webviewPanelSourceCreate: vscode.WebviewPanel | undefined;
  webviewPanelModelCreate: vscode.WebviewPanel | undefined;
  webviewPanelModelTest: vscode.WebviewPanel | undefined;

  // Tree views
  viewModelActions: TreeDataInstance;
  viewProjectNavigator: TreeDataInstance;
  viewSelectedResource: TreeDataInstance;
  viewEditDrafts: TreeDataInstance;

  constructor({
    coder,
    context,
    log,
    state,
  }: {
    coder: Coder;
    context: vscode.ExtensionContext;
    log: DJLogger;
    state: FrameworkState;
  }) {
    this.coder = coder;
    this.context = context;
    this.log = log;
    this.state = state;
    this.modelEdit = new ModelEditService(coder);

    this.viewModelActions = new TreeDataInstance([
      { label: 'Extension loading...' },
    ]);
    this.viewProjectNavigator = new TreeDataInstance([
      { label: 'Extension loading...' },
    ]);
    this.viewSelectedResource = new TreeDataInstance([
      { label: 'Extension loading...' },
    ]);
    this.viewEditDrafts = new TreeDataInstance([
      { label: 'No models are being opened for edit' },
    ]);

    // Initialize edit drafts view
    void this.updateEditDraftsView();

    this.handleApi = async (payload) => {
      switch (payload.type) {
        case 'dbt-fetch-modified-models': {
          const { projectName } = payload.request;
          const project = this.projects.get(projectName);
          if (!project) {
            throw new Error('Project not found');
          }

          // Committed branch changes vs origin/master
          const diffMasterResult = await runProcess({
            command: 'git',
            args: ['--no-pager', 'diff', '--name-only', 'origin/master..'],
            cwd: WORKSPACE_ROOT,
          });

          // Local uncommitted + untracked changes via git status
          const gitStatusResult = await runProcess({
            command: 'git',
            args: ['status', '--porcelain'],
            cwd: WORKSPACE_ROOT,
          });

          const getSqlFilesFromDir = (dirPath: string): string[] => {
            const sqlFiles: string[] = [];
            try {
              const fullPath = path.join(WORKSPACE_ROOT, dirPath);
              if (!fs.existsSync(fullPath)) {
                return sqlFiles;
              }
              const entries = fs.readdirSync(fullPath, {
                withFileTypes: true,
              });
              for (const entry of entries) {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                  sqlFiles.push(...getSqlFilesFromDir(entryPath));
                } else if (entry.isFile() && entry.name.endsWith('.sql')) {
                  sqlFiles.push(entryPath);
                }
              }
            } catch (err) {
              this.log.warn(`Failed to read directory ${dirPath}:`, err);
            }
            return sqlFiles;
          };

          const allFilePaths: string[] = [];

          // Collect paths from git status (staged, unstaged, and untracked)
          const statusLines = gitStatusResult
            .toString()
            .split('\n')
            .filter(Boolean);
          for (const line of statusLines) {
            const filePath = line.substring(3).trim();
            if (filePath.endsWith('/')) {
              allFilePaths.push(...getSqlFilesFromDir(filePath.slice(0, -1)));
            } else {
              allFilePaths.push(filePath);
            }
          }

          // Collect paths from committed branch diff
          const diffPaths = diffMasterResult
            .toString()
            .split('\n')
            .filter(Boolean);
          allFilePaths.push(...diffPaths);

          const modelSet = new Set<string>();
          for (const filePath of allFilePaths) {
            if (!filePath.endsWith('.sql')) {
              continue;
            }
            for (const modelPath of project.modelPaths) {
              const checkPath = path.join(project.pathRelative, modelPath);
              if (filePath.startsWith(checkPath + '/')) {
                const modelName = path.basename(filePath, '.sql');
                if (modelName) {
                  modelSet.add(modelName);
                }
              }
            }
          }

          return apiResponse<typeof payload.type>(Array.from(modelSet));
        }
        case 'dbt-fetch-projects': {
          const projects: DbtProject[] = [];
          for (const project of this.projects.values()) {
            projects.push(project);
          }
          return apiResponse<typeof payload.type>(projects);
        }
        case 'dbt-run-model': {
          const { config } = payload.request;

          // Get project from config
          if (!config.projectName) {
            throw new Error('Project name is required in config');
          }

          const project = this.projects.get(config.projectName);
          if (!project) {
            throw new Error('Project not found');
          }

          // Build dbt command using shared utility
          const command = buildDbtRunCommand(config);

          // Execute command
          try {
            this.coder.executeDbtCommand(
              command,
              'Dbt Run Model',
              project.pathSystem,
            );
          } catch (error: unknown) {
            // runProcess rejects with error string, wrap it in Error object with proper message
            const errorMessage =
              typeof error === 'string' ? error : String(error);
            throw new Error(errorMessage);
          }

          return apiResponse<typeof payload.type>(null);
        }
        case 'dbt-fetch-sources': {
          const result = await runProcess({
            command: 'dbt',
            args: ['list', '--resource-type', 'source'],
            cwd: path.join(WORKSPACE_ROOT, 'dags/dbt'),
          });
          const resultArray = result.toString().split('\n');
          const resultStart =
            resultArray.findIndex((v) => / Found ([0-9]+) /.test(v)) + 1;
          const sources = resultArray.slice(resultStart, -1);
          return apiResponse<typeof payload.type>(sources);
        }
        case 'dbt-fetch-available-models': {
          const { projectName } = payload.request;
          const project = this.projects.get(projectName);
          if (!project) {
            throw new Error('Project not found');
          }
          const models: string[] = [];
          for (const model of this.models.values()) {
            // Filter models that belong to this project by checking if their path starts with the project path
            if (model.pathSystemDirectory.startsWith(project.pathSystem)) {
              models.push(model.name);
            }
          }
          return apiResponse<typeof payload.type>(models);
        }
        case 'dbt-get-model-info': {
          // Get information about the currently active model
          const activeEditor = vscode.window.activeTextEditor;

          if (!activeEditor) {
            // Return null when there is  no active editor
            return apiResponse<typeof payload.type>(null);
          }

          const document = activeEditor.document;
          const filePath = document.uri.fsPath;

          // Check if this is a dbt model file (ends with .model.json)
          if (!filePath.endsWith('.model.json')) {
            // Return null for non-model files
            return apiResponse<typeof payload.type>(null);
          }

          // Check if projects are loaded
          if (this.projects.size === 0) {
            throw new Error(
              'No DBT projects found in workspace. Please ensure dbt_project.yml files exist.',
            );
          }

          // Find the project this file belongs to
          let projectName = '';
          let projectPath = '';

          for (const [name, project] of this.projects.entries()) {
            if (filePath.startsWith(project.pathSystem)) {
              projectName = name;
              projectPath = project.pathSystem;
              break;
            }
          }

          if (!projectName) {
            const projectNames = Array.from(this.projects.keys()).join(', ');
            throw new Error(
              `Active file is not within a recognized dbt project. Available projects: ${projectNames}`,
            );
          }

          // Extract model name from file path (remove .model.json extension)
          const fileName = path.basename(filePath, '.model.json');
          const modelName = fileName;

          return apiResponse<typeof payload.type>({
            modelName,
            projectName,
            projectPath,
          });
        }
        case 'dbt-parse-project': {
          const { logger, project } = payload.request;
          await runProcess({
            command: 'dbt',
            args: ['parse'],
            cwd: path.join(WORKSPACE_ROOT, project.pathRelative),
            logger,
          });
          const manifest = await this.fetchManifest({ project });
          if (!manifest) {
            throw new Error('Manifest not found');
          }
          return apiResponse<typeof payload.type>(manifest);
        }
        case 'dbt-check-compiled-status': {
          try {
            const { modelName, projectName } = payload.request;
            const status = this.checkCompiledStatus(modelName, projectName);
            return apiResponse<typeof payload.type>(status);
          } catch (error: unknown) {
            this.log.error('Error checking compiled status:', error);
            throw error;
          }
        }
        case 'dbt-check-model-outdated': {
          try {
            const { modelName, projectName } = payload.request;
            const status = this.checkModelOutdated(modelName, projectName);
            return apiResponse<typeof payload.type>(status);
          } catch (error: unknown) {
            this.log.error('Error checking model outdated status:', error);
            throw error;
          }
        }
        case 'dbt-compile-with-logs': {
          try {
            const { modelName, projectName } = payload.request;
            await this.compileModelWithLogs(modelName, projectName);
            return apiResponse<typeof payload.type>({ success: true });
          } catch (error: unknown) {
            this.log.error('Error compiling model with logs:', error);
            throw error;
          }
        }
        case 'dbt-model-compile': {
          try {
            const { modelName, projectName } = payload.request;
            await this.compileModel(modelName, projectName);
            return apiResponse<typeof payload.type>({
              success: true,
              message: `Model ${modelName} compiled successfully`,
            });
          } catch (error: unknown) {
            this.log.error('Error compiling model:', error);
            throw error;
          }
        }
        case 'dbt-fetch-models-with-tests': {
          const { projectName } = payload.request;
          const project = this.projects.get(projectName);
          if (!project) {
            throw new Error('Project not found');
          }

          // Helper function to get test details for a model
          const getTestDetailsForModel = (
            modelName: string,
          ): {
            testCount: number;
            testDetails: {
              name: string;
              testType: string;
              columnName?: string;
            }[];
          } => {
            const manifest = project.manifest;
            if (!manifest) {
              return { testCount: 0, testDetails: [] };
            }

            const modelId = getDbtModelId({ modelName, projectName });
            if (!modelId) {
              return { testCount: 0, testDetails: [] };
            }

            const testDetails: {
              name: string;
              testType: string;
              columnName?: string;
            }[] = [];
            for (const node of Object.values(manifest.nodes || {})) {
              if (
                node?.resource_type === 'test' &&
                node.depends_on?.nodes?.includes(modelId)
              ) {
                const testType = node.test_metadata?.name || 'unknown';
                const columnName = node.column_name || undefined;
                testDetails.push({
                  name: node.name || 'unknown',
                  testType,
                  columnName,
                });
              }
            }
            return { testCount: testDetails.length, testDetails };
          };

          // Helper to get model capabilities and existing tests by reading model JSON
          const getModelCapabilities = (
            modelName: string,
          ): {
            hasJoins: boolean;
            hasAggregates: boolean;
            hasPortalPartitionDaily: boolean;
            modelType: string | null;
            existingDataTests: Array<{ type: string; [key: string]: any }>;
            fromModel: string | null;
            firstJoinType: string | null;
          } => {
            try {
              const modelId = getDbtModelId({ modelName, projectName });
              if (!modelId) {
                return {
                  hasJoins: false,
                  hasAggregates: false,
                  hasPortalPartitionDaily: false,
                  modelType: null,
                  existingDataTests: [],
                  fromModel: null,
                  firstJoinType: null,
                };
              }

              const model = this.models.get(modelId);
              if (!model) {
                return {
                  hasJoins: false,
                  hasAggregates: false,
                  hasPortalPartitionDaily: false,
                  modelType: null,
                  existingDataTests: [],
                  fromModel: null,
                  firstJoinType: null,
                };
              }

              const jsonPath = path.join(
                model.pathSystemDirectory,
                `${modelName}.model.json`,
              );

              if (!fs.existsSync(jsonPath)) {
                return {
                  hasJoins: false,
                  hasAggregates: false,
                  hasPortalPartitionDaily: false,
                  modelType: null,
                  existingDataTests: [],
                  fromModel: null,
                  firstJoinType: null,
                };
              }

              const modelJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
              const from = modelJson.from;

              const modelType: string | null = modelJson.type || null;

              const hasJoins =
                Array.isArray(from?.join) &&
                from.join.length > 0 &&
                typeof from?.model === 'string';

              const fromModel = hasJoins ? from.model : null;

              const firstJoinType =
                hasJoins && from.join[0]?.type ? from.join[0].type : null;

              const aggPattern = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i;
              const hasAggregates =
                Array.isArray(modelJson.select) &&
                modelJson.select.some(
                  (s: { expr?: string; expression?: string }) => {
                    const exprValue = s.expr || s.expression;
                    return exprValue && aggPattern.test(exprValue);
                  },
                );

              let hasPortalPartitionDaily = false;

              if (Array.isArray(modelJson.select)) {
                hasPortalPartitionDaily = modelJson.select.some(
                  (s: { name?: string }) => s.name === PARTITION_DAILY,
                );
              }

              if (!hasPortalPartitionDaily) {
                const manifest = project.manifest;
                if (manifest) {
                  const nodeId = `model.${project.name}.${modelName}`;
                  const node = manifest.nodes?.[nodeId];
                  if (node?.columns) {
                    hasPortalPartitionDaily = Object.keys(node.columns).some(
                      (colName) => colName.toLowerCase() === PARTITION_DAILY,
                    );
                  }
                }
              }

              const existingDataTests = Array.isArray(modelJson.data_tests)
                ? modelJson.data_tests
                : [];

              return {
                hasJoins,
                hasAggregates,
                hasPortalPartitionDaily,
                modelType,
                existingDataTests,
                fromModel,
                firstJoinType,
              };
            } catch {
              return {
                hasJoins: false,
                hasAggregates: false,
                hasPortalPartitionDaily: false,
                modelType: null,
                existingDataTests: [],
                fromModel: null,
                firstJoinType: null,
              };
            }
          };

          const isIntOrStgModel = (modelName: string): boolean => {
            const layer = modelName.split('__')[0];
            return layer === 'int' || layer === 'stg';
          };

          const modifiedModelNames: string[] = [];

          const getModelFilesFromDir = (dirPath: string): string[] => {
            const modelFiles: string[] = [];
            try {
              const fullPath = path.join(WORKSPACE_ROOT, dirPath);
              if (!fs.existsSync(fullPath)) {
                return modelFiles;
              }

              const entries = fs.readdirSync(fullPath, { withFileTypes: true });
              for (const entry of entries) {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                  modelFiles.push(...getModelFilesFromDir(entryPath));
                } else if (
                  entry.isFile() &&
                  (entry.name.endsWith('.sql') ||
                    entry.name.endsWith('.model.json') ||
                    entry.name.endsWith('.yml'))
                ) {
                  modelFiles.push(entryPath);
                }
              }
            } catch (err) {
              this.log.warn(`Failed to read directory ${dirPath}:`, err);
            }
            return modelFiles;
          };

          try {
            const gitStatusResult = await runProcess({
              command: 'git',
              args: ['status', '--porcelain'],
              cwd: WORKSPACE_ROOT,
            });

            const statusLines = gitStatusResult
              .toString()
              .split('\n')
              .filter(Boolean);

            this.log.info(
              `Git status found ${statusLines.length} changed entries`,
            );

            const allFilePaths: string[] = [];
            for (const line of statusLines) {
              const filePath = line.substring(3).trim();

              if (filePath.endsWith('/')) {
                const modelFiles = getModelFilesFromDir(filePath.slice(0, -1));
                allFilePaths.push(...modelFiles);
                this.log.info(
                  `Found ${modelFiles.length} model files in untracked directory: ${filePath}`,
                );
              } else {
                allFilePaths.push(filePath);
              }
            }

            this.log.info(`Total files to check: ${allFilePaths.length}`);

            const extractModelName = (filePath: string): string | null => {
              const fileName = path.basename(filePath);

              if (fileName.endsWith('.sql')) {
                return fileName.replace('.sql', '');
              }

              if (fileName.endsWith('.model.json')) {
                return fileName.replace('.model.json', '');
              }

              if (fileName.endsWith('.yml')) {
                const baseName = fileName.replace('.yml', '');
                if (
                  baseName.startsWith('int__') ||
                  baseName.startsWith('stg__')
                ) {
                  return baseName;
                }
              }

              return null;
            };

            for (const filePath of allFilePaths) {
              const isModelFile =
                filePath.endsWith('.sql') ||
                filePath.endsWith('.model.json') ||
                filePath.endsWith('.yml');

              if (!isModelFile) {
                continue;
              }

              for (const modelPath of project.modelPaths) {
                const checkPath = path.join(project.pathRelative, modelPath);
                if (filePath.startsWith(checkPath + '/')) {
                  const modelName = extractModelName(filePath);
                  if (
                    modelName &&
                    !modifiedModelNames.includes(modelName) &&
                    isIntOrStgModel(modelName)
                  ) {
                    modifiedModelNames.push(modelName);
                    this.log.info(
                      `Found modified model: ${modelName} from ${filePath}`,
                    );
                  }
                }
              }
            }
          } catch (error) {
            this.log.warn(
              'Failed to get modified models from git, returning empty list',
              error,
            );
          }

          const allProjectModels: string[] = [];
          for (const model of this.models.values()) {
            if (
              model.pathSystemDirectory.startsWith(project.pathSystem) &&
              isIntOrStgModel(model.name)
            ) {
              allProjectModels.push(model.name);
            }
          }

          const modifiedModels = modifiedModelNames.map((name) => {
            const {
              testCount: manifestTestCount,
              testDetails: manifestTestDetails,
            } = getTestDetailsForModel(name);
            const {
              hasJoins,
              hasAggregates,
              hasPortalPartitionDaily,
              modelType,
              existingDataTests,
              fromModel,
              firstJoinType,
            } = getModelCapabilities(name);

            const jsonTestDetails = existingDataTests.map((t) => ({
              name: `${t.type}${t.column_name ? `_${t.column_name}` : t.compare_model ? `_${t.compare_model}` : ''}`,
              testType: t.type,
              columnName: t.column_name,
            }));

            const combinedTestDetails = [
              ...manifestTestDetails,
              ...jsonTestDetails,
            ];
            const combinedTestCount =
              manifestTestCount + existingDataTests.length;

            return {
              name,
              testCount: combinedTestCount,
              testDetails: combinedTestDetails,
              hasJoins,
              hasAggregates,
              hasPortalPartitionDaily,
              modelType,
              existingDataTests,
              fromModel,
              firstJoinType,
            };
          });

          const availableModels = allProjectModels
            .filter((name) => !modifiedModelNames.includes(name))
            .map((name) => {
              const {
                testCount: manifestTestCount,
                testDetails: manifestTestDetails,
              } = getTestDetailsForModel(name);
              const {
                hasJoins,
                hasAggregates,
                hasPortalPartitionDaily,
                modelType,
                existingDataTests,
                fromModel,
                firstJoinType,
              } = getModelCapabilities(name);

              const jsonTestDetails = existingDataTests.map((t) => ({
                name: `${t.type}${t.column_name ? `_${t.column_name}` : t.compare_model ? `_${t.compare_model}` : ''}`,
                testType: t.type,
                columnName: t.column_name,
              }));

              const combinedTestDetails = [
                ...manifestTestDetails,
                ...jsonTestDetails,
              ];
              const combinedTestCount =
                manifestTestCount + existingDataTests.length;

              return {
                name,
                testCount: combinedTestCount,
                testDetails: combinedTestDetails,
                hasJoins,
                hasAggregates,
                hasPortalPartitionDaily,
                modelType,
                existingDataTests,
                fromModel,
                firstJoinType,
              };
            });

          return apiResponse<typeof payload.type>({
            modifiedModels,
            availableModels,
          });
        }
        case 'dbt-add-model-tests': {
          const { projectName, modelName, autoDetect, tests } = payload.request;
          const project = this.projects.get(projectName);
          if (!project) {
            throw new Error('Project not found');
          }

          const modelId = getDbtModelId({ modelName, projectName });
          if (!modelId) {
            throw new Error(`Model ${modelName} not found`);
          }

          const model = this.models.get(modelId);
          if (!model) {
            throw new Error(`Model ${modelName} not found in manifest`);
          }

          const jsonPath = path.join(
            model.pathSystemDirectory,
            `${modelName}.model.json`,
          );

          if (!fs.existsSync(jsonPath)) {
            throw new Error(`Model JSON file not found: ${jsonPath}`);
          }

          const modelJsonContent = fs.readFileSync(jsonPath, 'utf8');
          const modelJson = jsonParse(modelJsonContent);

          let testsToAdd: Array<{
            type: string;
            compare_model?: string;
            column_name?: string;
            join_type?: string;
          }> = [];

          if (autoDetect) {
            testsToAdd = this.detectApplicableTests(modelJson);
          } else if (tests) {
            testsToAdd = tests
              .map((test) => {
                if (
                  test.type === 'equal_row_count' ||
                  test.type === 'equal_or_lower_row_count'
                ) {
                  const compareModel =
                    test.compare_model ||
                    (modelJson.from?.model
                      ? `ref('${modelJson.from.model}')`
                      : null);

                  if (!compareModel || !modelJson.from?.join?.length) {
                    this.log.info(
                      `Skipping ${test.type} for ${modelName}: model doesn't have joins or compare_model`,
                    );
                    return null;
                  }

                  return {
                    ...test,
                    compare_model: compareModel,
                    join_type:
                      test.join_type ||
                      modelJson.from?.join?.[0]?.type ||
                      'left',
                  };
                }

                if (test.type === 'no_null_aggregates') {
                  if (!test.column_name || test.column_name.trim() === '') {
                    const aggregateCols = this.detectAggregateColumns(
                      modelJson.select,
                    );
                    if (aggregateCols.length === 0) {
                      this.log.info(
                        `Skipping no_null_aggregates for ${modelName}: no aggregate columns found`,
                      );
                      return null;
                    }
                    return aggregateCols.map((col) => ({
                      type: 'no_null_aggregates',
                      column_name: col,
                    }));
                  }
                }

                return test;
              })
              .flat()
              .filter(Boolean) as typeof testsToAdd;
          }

          const existingTests = modelJson.data_tests || [];
          const existingCount = existingTests.length;
          const mergedTests = this.mergeTests(existingTests, testsToAdd);

          const actuallyNewTests = mergedTests.length - existingCount;

          if (actuallyNewTests > 0) {
            const edits = modify(
              modelJsonContent,
              ['data_tests'],
              mergedTests,
              {
                formattingOptions: {
                  tabSize: 4,
                  insertSpaces: true,
                  eol: '\n',
                },
              },
            );
            const updatedContent = applyEdits(modelJsonContent, edits);

            fs.writeFileSync(jsonPath, updatedContent, 'utf8');

            this.log.info(
              `Added ${actuallyNewTests} new test(s) to ${modelName}`,
            );
          } else {
            this.log.info(
              `No new tests to add to ${modelName} (all tests already exist)`,
            );
          }

          const actuallyAddedTests = testsToAdd.filter((newTest) => {
            const wasDuplicate = existingTests.some((existing: any) => {
              if (existing.type !== newTest.type) {
                return false;
              }
              switch (newTest.type) {
                case 'equal_row_count':
                case 'equal_or_lower_row_count':
                  return existing.compare_model === newTest.compare_model;
                case 'no_null_aggregates':
                  return existing.column_name === newTest.column_name;
                default:
                  return false;
              }
            });
            return !wasDuplicate;
          });

          return apiResponse<typeof payload.type>({
            success: true,
            addedTests: actuallyAddedTests,
          });
        }
        case 'dbt-remove-model-tests': {
          const { projectName, modelNames } = payload.request;
          const project = this.projects.get(projectName);
          if (!project) {
            throw new Error('Project not found');
          }

          let modelsUpdated = 0;

          for (const modelName of modelNames) {
            try {
              const modelId = getDbtModelId({ modelName, projectName });
              if (!modelId) {
                this.log.warn(`Model ${modelName} not found, skipping...`);
                continue;
              }

              const model = this.models.get(modelId);
              if (!model) {
                this.log.warn(
                  `Model ${modelName} not in manifest, skipping...`,
                );
                continue;
              }

              const jsonPath = path.join(
                model.pathSystemDirectory,
                `${modelName}.model.json`,
              );

              if (!fs.existsSync(jsonPath)) {
                this.log.warn(
                  `Model JSON not found at ${jsonPath}, skipping...`,
                );
                continue;
              }

              const modelJsonContent = fs.readFileSync(jsonPath, 'utf8');
              const modelJson = jsonParse(modelJsonContent);

              if (modelJson.data_tests && modelJson.data_tests.length > 0) {
                const edits = modify(
                  modelJsonContent,
                  ['data_tests'],
                  undefined,
                  {
                    formattingOptions: {
                      tabSize: 4,
                      insertSpaces: true,
                      eol: '\n',
                    },
                  },
                );
                const updatedContent = applyEdits(modelJsonContent, edits);

                fs.writeFileSync(jsonPath, updatedContent, 'utf8');

                modelsUpdated++;
                this.log.info(`Removed all data_tests from ${modelName}`);
              }
            } catch (error) {
              this.log.warn(`Failed to remove tests from ${modelName}:`, error);
            }
          }

          return apiResponse<typeof payload.type>({
            success: true,
            modelsUpdated,
          });
        }
        case 'dbt-run-test': {
          return apiResponse<typeof payload.type>(null);
        }
        default:
          return assertExhaustive<ApiResponse>(payload);
      }
    };
  }

  async activate(context: vscode.ExtensionContext) {
    // Find all dbt projects in the workspace
    const projectYmlUris = await vscode.workspace.findFiles(
      '**/dbt_project.yml',
      getDbtProjectExcludePaths(),
    );
    // Initialize projects in parallel
    await Promise.all(
      projectYmlUris.map((projectYmlUri) => this.initProject(projectYmlUri)),
    );

    this.initHoverProvider(context);

    // Set up periodic refresh of edit drafts view
    setInterval(() => {
      void this.updateEditDraftsView();
    }, 5000); // Update every 5 seconds

    // Register dbt-specific commands
    this.registerCommands(context);

    // Activate model edit service
    this.modelEdit.activate(context);

    this.ready = true;
  }

  /**
   * Returns project navigator tree view data
   */
  buildProjectNavigator({ project }: { project: DbtProject }): TreeData {
    const { models, sources } = getManifestResources(project);

    const itemsSources: TreeItem[] = [];
    const itemsModelsStaging: TreeItem[] = [];
    const itemsModelsIntermediate: TreeItem[] = [];
    const itemsModelsMart: TreeItem[] = [];

    for (const [sourceId, source] of Object.entries(sources)) {
      const sourceName = sourceId.split('.').slice(2).join('.');
      itemsSources.push({
        id: sourceId,
        label: sourceName,
        // description: source.description,
        // tooltip: source.tooltip,
        children: [],
        command: {
          title: 'Open Source',
          command: COMMAND_ID.SOURCE_NAVIGATE,
          arguments: [source],
        },
      });
    }
    // Use a single sort comparator function
    const sortByLabel = (a: TreeItem, b: TreeItem) => {
      const aLabel = _.toLower(a.label as string);
      const bLabel = _.toLower(b.label as string);
      return aLabel.localeCompare(bLabel);
    };

    itemsSources.sort(sortByLabel);

    for (const [modelId, model] of Object.entries(models)) {
      const modelName = modelId.split('.').slice(2).join('.');
      const [modelLayer, ...modelLabelParts] = modelName.split('__');
      const modelLabel = modelLabelParts.join('__');
      const modelItem = {
        id: modelId,
        label: modelLabel,
        // description: modelName,
        // tooltip: modelName,
        children: [],
        command: {
          title: 'Open Model',
          command: COMMAND_ID.MODEL_NAVIGATE,
          arguments: [model],
        },
      };
      switch (modelLayer) {
        case 'stg':
          itemsModelsStaging.push(modelItem);
          break;
        case 'int':
          itemsModelsIntermediate.push(modelItem);
          break;
        case 'mart':
          itemsModelsMart.push(modelItem);
          break;
      }
    }
    itemsModelsStaging.sort(sortByLabel);
    itemsModelsIntermediate.sort(sortByLabel);
    itemsModelsMart.sort(sortByLabel);

    const treeData = [
      {
        label: 'Sources',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: itemsSources,
      },
      {
        label: 'Staging Models',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: itemsModelsStaging,
      },
      {
        label: 'Intermediate Models',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: itemsModelsIntermediate,
      },
      {
        label: 'Mart Models',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        children: itemsModelsMart,
      },
    ];

    return treeData;
  }

  /**
   * Returns selected resource tree view data
   */
  buildSelectedResource(info?: CoderFileInfo): TreeData {
    const treeData: TreeData = [];

    switch (info?.type) {
      case 'framework-model':
      case 'model': {
        const { model, project } = info;
        if (!model) {
          return treeData;
        }

        const { dimensions, facts } = frameworkGetNodeColumns({
          from: { model: model.name },
          project,
        });
        treeData.push({ label: 'Type', description: 'Model' });
        treeData.push({ label: 'Name', description: model.name });
        treeData.push({
          label: 'Dimensions',
          children:
            dimensions?.map((d) => ({
              label: d.name,
              command: {
                title: 'Column Origin',
                command: COMMAND_ID.COLUMN_ORIGIN,
                arguments: [d],
              },
            })) ?? [],
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          description: String(dimensions?.length || 0),
        });
        treeData.push({
          label: 'Facts',
          children:
            facts?.map((f) => ({
              label: f.name,
              command: {
                title: 'Column Origin',
                command: COMMAND_ID.COLUMN_ORIGIN,
                arguments: [f],
              },
            })) ?? [],
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          description: String(facts?.length || 0),
        });

        const nodeId = model.unique_id ?? '';
        const modelNameSelected = model.name ?? '';
        const modelLabelSelected = frameworkExtractModelName(modelNameSelected);

        const treeDataParents: TreeData = [];
        const modelIdsParents =
          info.project.manifest.parent_map?.[nodeId]?.filter((id) =>
            id.startsWith('model.'),
          ) ?? [];
        for (const modelIdParent of modelIdsParents) {
          const modelParent = this.models.get(modelIdParent);
          if (!modelParent) {
            continue;
          }
          const modelNameParent = modelIdParent.split('.').slice(2).join('.');
          const modelLabelParent = frameworkExtractModelName(modelNameParent);
          treeDataParents.push({
            id: modelIdParent,
            label: modelLabelParent,
            description: modelNameParent,
            tooltip: modelNameParent,
            children: [],
            command: {
              title: 'Open Model',
              command: COMMAND_ID.MODEL_NAVIGATE,
              arguments: [modelParent],
            },
          });
        }

        const treeDataChildren: TreeData = [];
        const modelIdsChildren =
          info.project.manifest.child_map?.[nodeId]?.filter((id) =>
            id.startsWith('model.'),
          ) ?? [];
        for (const modelIdChild of modelIdsChildren) {
          const modelNameChild = modelIdChild.split('.').slice(2).join('.');
          const modelChild = this.models.get(modelIdChild);
          if (!modelChild) {
            continue;
          }
          const modelLabelChild = frameworkExtractModelName(modelNameChild);
          treeDataChildren.push({
            id: modelIdChild,
            label: modelLabelChild,
            description: modelNameChild,
            tooltip: modelNameChild,
            children: [],
            command: {
              title: 'Open Model',
              command: COMMAND_ID.MODEL_NAVIGATE,
              arguments: [modelChild],
            },
          });

          treeData.push({
            children: [
              {
                children: [
                  {
                    children: treeDataParents,
                    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                    label: 'Parents',
                  },
                  {
                    children: treeDataChildren,
                    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                    label: 'Children',
                  },
                ],
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                description: modelNameSelected,
                label: modelLabelSelected,
                tooltip: modelNameSelected,
              },
            ],
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            label: 'Selected',
          });
        }
        break;
      }
      case 'framework-source':
      case 'yml': {
        const { filePath, project } = info;
        const sources: DbtSource[] = [];
        if (info?.type === 'framework-source') {
          for (const table of info.sourceJson.tables ?? []) {
            const sourceId = frameworkMakeSourceId({
              ...info.sourceJson,
              project,
              table: table.name,
            });
            const source = this.sources.get(sourceId);
            if (source) {
              sources.push(source);
            }
          }
        } else if (info?.type === 'yml') {
          if ('sources' in info.properties && info.properties.sources?.length) {
            for (const _source of info.properties.sources) {
              for (const table of _source.tables ?? []) {
                this.log.info('TABLE', table);
                const sourceId = frameworkMakeSourceId({
                  ..._source,
                  project,
                  table: table.name,
                });
                this.log.info('ID', sourceId);
                const source = this.sources.get(sourceId);
                if (source) {
                  sources.push(source);
                }
              }
            }
          }
        }
        if (!sources.length) {
          return treeData;
        }
        const sourcesByName = _.groupBy(sources, (s) => s.source_name);
        treeData.push({
          label: 'Sources',
          children: _.map(sourcesByName, (sourceTables, sourceName) => ({
            label: sourceName ?? '',
            children: [
              {
                label: 'Tables',
                children: sourceTables.map((table) => ({
                  label: table.name,
                  command: {
                    title: 'Find Source Origin',
                    command: COMMAND_ID.SOURCE_ORIGIN,
                    arguments: [
                      {
                        filePath,
                        projectName: project.name,
                        tableName: table.name,
                      },
                    ],
                  },
                })),
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                description: String(sourceTables?.length || 0),
              },
            ],
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          })),
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        });
        break;
      }
    }

    return treeData;
  }

  getModelNodeId({
    project,
    modelName,
  }: {
    project: DbtProject;
    modelName: string;
  }) {
    const nodeId = `model.${project.name}.${modelName}`;
    return nodeId;
  }

  getProjectFromPath(path: string): DbtProject | null {
    for (const [_projectName, project] of this.projects) {
      if (new RegExp(`^${project.pathSystem}`).test(path)) {
        return project;
      }
    }
    return null;
  }

  // Initialize the hover provider after the projects have been loaded
  initHoverProvider(context: vscode.ExtensionContext) {
    // Create hover provider to idenify macros within workspace
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { pattern: '**/*.sql' },
        {
          provideHover: (document, position, _token) => {
            const textLine = document.lineAt(position.line).text;
            const textLeading = textLine
              .slice(0, position.character)
              .replaceAll(/.+(\)|\s)/g, '');
            const text = textLeading + textLine.slice(position.character);
            const ref = text.match(/((?:[A-z]|[0-9]|\.)+)\(/)?.[1];
            if (!ref) {
              return;
            }

            const project = this.getProjectFromPath(document.fileName);
            if (!project) {
              return;
            }

            const refId =
              ref.split('.').length === 1 ? `${project.name}.${ref}` : ref;
            const macro = this.macros.get(refId);

            const hoverText = macro?.description || macro?.macro_sql;
            if (!hoverText) {
              return;
            }

            return new vscode.Hover(hoverText);
          },
        },
      ),
    );

    // Create hover provider to idenify model.json files within workspace
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { pattern: '**/*.model.json' },
        {
          provideHover: (document, position, _token) => {
            const textLine = document.lineAt(position.line).text;

            const macroName = textLine.match(
              /{{ ((?:[A-z]|[0-9]|_|-|\.)+)\((?:.*)\) }}/,
            )?.[1];

            const modelName = textLine.match(
              /"((?:dim__|fct__|int__|mart__|src__|stg__)(?:[A-z]|[0-9]|_)+)"/,
            )?.[1];

            const sourceId = textLine.match(
              /"((?:[A-z]|[0-9]|_)+\.(?:[A-z]|[0-9]|_)+)"/,
            )?.[1];

            if (!(macroName || modelName || sourceId)) {
              return;
            }

            const project = this.getProjectFromPath(document.fileName);
            if (!project) {
              return;
            }

            let hoverText = '';

            if (macroName) {
              const macro = frameworkGetMacro({ project, macro: macroName });
              if (!macro) {
                return;
              }
              hoverText = `
**Macro: ${macro.name}**

*SQL*

${macro.macro_sql}`;
              // ${macro.macro_sql.replaceAll('\n', '\n\n')}`;
            } else if (modelName) {
              const model = frameworkGetNode({
                project,
                model: modelName,
              });
              if (!model) {
                return;
              }
              hoverText = `
**Model: ${model.name}**

*Columns*`;
              for (const c of Object.values(model.columns ?? {})) {
                if (!c) {
                  continue;
                }
                hoverText += '\n\n' + c.name;
                if (c.meta.type) {
                  hoverText += ` - ${c.meta.type}`;
                }
                if (c.meta.data_type) {
                  hoverText += ` - ${c.meta.data_type}`;
                }
              }
            } else if (sourceId) {
              const source = frameworkGetNode({
                project,
                source: sourceId,
              });
              if (!source) {
                return;
              }
              hoverText = `
**Source: ${source.name}**

*Columns*
`;
              for (const c of Object.values(source.columns ?? {})) {
                if (!c) {
                  continue;
                }
                hoverText += '\n\n' + c.name;
                if (c.meta.type) {
                  hoverText += ` - ${c.meta.type}`;
                }
                if (c.meta.data_type) {
                  hoverText += ` - ${c.meta.data_type}`;
                }
              }
            }

            if (!hoverText) {
              return;
            }

            return new vscode.Hover(hoverText.trim());
          },
        },
      ),
    );
  }

  /**
   * Initialize a dbt project by parsing the dbt project file and
   * writing the airflow dags and macros files if they are configured.
   * This will be called recursively for each nested package.
   * @param projectYmlUri The URI of the dbt project file
   */
  async initProject(projectYmlUri: vscode.Uri) {
    /**
     * DBT Project File Content
     */
    const projectFile = await vscode.workspace.fs.readFile(projectYmlUri);

    /**
     * DBT Project Properties
     */
    const projectProperties = getDbtProjectProperties(projectFile.toString());

    // If the project name is not set, return
    if (!projectProperties.name) {
      return;
    }

    const { dbtProjectNames } = getDjConfig();
    this.log.info('PROJECT NAMES CONFIGURED: ', dbtProjectNames);

    // Check if this project can be initialized based on configuration
    const isProjectAllowed = isDbtProjectNameConfigured(projectProperties.name);
    if (!isProjectAllowed) {
      this.log.info(`SKIPPING PROJECT: ${projectProperties.name}`);
      return;
    }

    this.log.info(
      'INITIALIZING PROJECT: ',
      projectProperties.name,
      projectYmlUri.fsPath,
    );

    // Begin building the project object
    const pathSystem = projectYmlUri.fsPath.replace(/\/dbt_project.yml$/, '');
    const pathRelative = pathSystem.replace(
      new RegExp(`^${WORKSPACE_ROOT}/`),
      '',
    );
    const modelPaths = projectProperties['model-paths'] ?? ['models'];

    const project: DbtProject = {
      macroPaths: projectProperties['macro-paths'] ?? ['macros'],
      // macros: {},
      manifest: {
        child_map: {},
        disabled: {},
        docs: {},
        exposures: {},
        group_map: {},
        groups: {},
        macros: {},
        metadata: {},
        metrics: {},
        nodes: {},
        parent_map: {},
        saved_queries: {},
        selectors: {},
        semantic_models: {},
        sources: {},
      },
      modelPaths,
      // models: {},
      name: projectProperties.name,
      packagePath: projectProperties['packages-install-path'] ?? 'dbt_packages',
      // packages: [],
      pathRelative,
      pathSystem,
      properties: projectProperties,
      targetPath: projectProperties['target-path'] ?? 'target',
      variables: projectProperties.vars ?? {},
    };

    this.log.info('SETTING PROJECT');
    this.projects.set(project.name, project);

    // Write the dags contributed by the extension so they'll be available for airflow
    await this.writeAirflowDags();

    // Write the macros contributed by the extension before parsing so they'll get picked up in the next update
    await this.writeMacroFiles(project);

    // Write the generic tests contributed by the extension
    await this.writeGenericTests(project);

    // Write AGENTS.md and skill files to the workspace root's .agents/ directory.
    await this.writeAgentsMd();
    await this.writeSkillFiles();
  }

  /**
   * Write Airflow DAG files contributed by the extension
   * This method does nothing if the Airflow generate DAGs is not enabled.
   */
  async writeAirflowDags(): Promise<void> {
    const { airflowTargetVersion, airflowGenerateDags, airflowDagsPath } =
      getDjConfig();

    if (!airflowGenerateDags) {
      return;
    }

    if (!airflowDagsPath) {
      this.log.warn(
        'Airflow DAGs generation is enabled but no airflowDagsPath is configured. Skipping DAG file writing.',
      );
      return;
    }

    let airflowVersionFolder = 'v2_7';

    switch (airflowTargetVersion) {
      case '2.10':
        airflowVersionFolder = 'v2_10';
        break;
    }

    if (airflowVersionFolder) {
      this.log.info('WRITING AIRFLOW FILES');
      const AIRFLOW_FILES: string[] = [
        'services.py',
        'source_etl.py',
        'utils.py',
        'variables.py',
      ];

      // Use Promise.all for parallel file operations
      const writePromises = AIRFLOW_FILES.map(async (airflowFile) => {
        try {
          const pathRead = path.join(
            BASE_AIRFLOW_PATH,
            airflowVersionFolder,
            airflowFile,
          );
          const pathWrite = path.join(
            WORKSPACE_ROOT,
            airflowDagsPath,
            airflowFile,
          );
          // Use async file reading instead of sync
          const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(pathRead),
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(pathWrite),
            content,
          );
        } catch (err: unknown) {
          this.log.error(`Error writing ${airflowFile}:`, err);
        }
      });

      await Promise.all(writePromises);
    }
  }

  /**
   * Write macro files contributed by the extension
   * @param project The dbt project to write macros for if dbtMacroPath is set.
   */
  async writeMacroFiles(project: DbtProject): Promise<void> {
    const { dbtMacroPath } = getDjConfig();

    if (!dbtMacroPath) {
      return;
    }

    this.log.info('WRITING MACRO FILES');
    try {
      // Use async readdir
      const macroFileNames = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(BASE_MACROS_PATH),
      );

      // Process all macro files in parallel
      const writePromises = macroFileNames
        .filter(([_name, type]) => type === vscode.FileType.File)
        .map(async ([macroFileName]) => {
          try {
            const sourcePath = vscode.Uri.file(
              path.join(BASE_MACROS_PATH, macroFileName),
            );
            const targetPath = vscode.Uri.file(
              path.join(
                project.pathSystem,
                project.macroPaths[0],
                dbtMacroPath,
                macroFileName,
              ),
            );

            // Read and write using async operations
            const content = await vscode.workspace.fs.readFile(sourcePath);
            await vscode.workspace.fs.writeFile(targetPath, content);
          } catch (err: unknown) {
            this.log.error(`Error writing macro file ${macroFileName}:`, err);
          }
        });

      await Promise.all(writePromises);
    } catch (err: unknown) {
      this.log.error('Error writing macro files:', err);
    }
  }

  /**
   * Write generic test files contributed by the extension
   * @param project The dbt project to write tests for
   */
  async writeGenericTests(project: DbtProject): Promise<void> {
    const { dbtGenericTestsPath } = getDjConfig();

    if (!dbtGenericTestsPath) {
      return;
    }

    this.log.info('WRITING GENERIC TEST FILES');
    try {
      const genericTestsPath = path.join(BASE_TESTS_PATH, 'generic');
      const genericTestFileNames = fs.readdirSync(genericTestsPath);

      // Process all test files in parallel
      const writePromises = genericTestFileNames.map(async (testFileName) => {
        try {
          const testFilePath = path.join(genericTestsPath, testFileName);

          // Skip directories
          if (fs.statSync(testFilePath).isDirectory()) {
            return;
          }

          const testFileContent = fs.readFileSync(testFilePath, 'utf8');

          // Copy test file to project
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(
              path.join(
                project.pathSystem,
                'tests', // dbt project root tests directory
                dbtGenericTestsPath,
                testFileName,
              ),
            ),
            Buffer.from(testFileContent),
          );
        } catch (err: unknown) {
          this.log.error(`Error writing test file ${testFileName}:`, err);
        }
      });

      await Promise.all(writePromises);
    } catch (err: unknown) {
      this.log.error('Error writing generic test files:', err);
    }
  }

  /**
   * Write AGENTS.md to the workspace root's .agents/dj/ directory for AI coding agents.
   */
  async writeAgentsMd(): Promise<void> {
    const { codingAgent } = getDjConfig();
    if (!codingAgent) {
      return;
    }

    try {
      this.log.info('WRITING AGENTS.MD');
      const agentsMdContent = generateAgentsMd();
      const agentsMdPath = path.join(
        WORKSPACE_ROOT,
        '.agents',
        'dj',
        'AGENTS.md',
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(agentsMdPath),
        Buffer.from(agentsMdContent),
      );
    } catch (err) {
      this.log.error('Error writing AGENTS.md:', err);
    }
  }

  /**
   * Write skill files to the workspace root's .agents/skills/ directory.
   * Each skill is a directory containing a SKILL.md file, following the
   * Agent Skills open standard (https://agentskills.io).
   */
  async writeSkillFiles(): Promise<void> {
    const { codingAgent } = getDjConfig();
    if (!codingAgent) {
      return;
    }

    this.log.info('WRITING SKILL FILES');
    try {
      const skillEntries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(BASE_SKILLS_PATH),
      );

      const writePromises = skillEntries
        .filter(([, type]) => type === vscode.FileType.Directory)
        .map(async ([skillDirName]) => {
          try {
            const sourceDir = path.join(BASE_SKILLS_PATH, skillDirName);
            const targetDir = path.join(
              WORKSPACE_ROOT,
              '.agents',
              'skills',
              skillDirName,
            );

            await this.copySkillDirectoryRecursive(sourceDir, targetDir);
          } catch (err: unknown) {
            this.log.error(`Error writing skill ${skillDirName}:`, err);
          }
        });

      await Promise.all(writePromises);
    } catch (err: unknown) {
      this.log.error('Error writing skill files:', err);
    }
  }

  /**
   * Recursively copy a skill directory (files + subdirectories) into the
   * workspace target. Subdirectories like `references/`, `scripts/`, `assets/`
   * are part of the Agent Skills open standard (https://agentskills.io) for
   * progressive disclosure of skill content.
   *
   * Leading underscores on template filenames are stripped (e.g. `_SKILL.md`
   * → `SKILL.md`) so they aren't picked up as skills inside this repo's own
   * `templates/skills` directory. Subdirectory names are preserved verbatim.
   */
  private async copySkillDirectoryRecursive(
    sourceDir: string,
    targetDir: string,
  ): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(sourceDir),
    );

    for (const [entryName, entryType] of entries) {
      const sourceEntryPath = path.join(sourceDir, entryName);
      if (entryType === vscode.FileType.File) {
        const targetFileName = entryName.startsWith('_')
          ? entryName.slice(1)
          : entryName;
        const targetPath = vscode.Uri.file(
          path.join(targetDir, targetFileName),
        );
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.file(sourceEntryPath),
        );
        await vscode.workspace.fs.writeFile(targetPath, content);
      } else if (entryType === vscode.FileType.Directory) {
        const targetSubDir = path.join(targetDir, entryName);
        await this.copySkillDirectoryRecursive(sourceEntryPath, targetSubDir);
      }
    }
  }

  /**
   * Fetches the compiled sql for a model
   */
  async fetchSql({
    project,
    modelPath,
    modelName,
  }: {
    project: DbtProject;
    modelPath: string;
    modelName: string;
  }) {
    try {
      let compiledSql = '';
      const compiledSqlPath = `${project.pathSystem}/target/compiled/${project.name}/${modelPath}/${modelName}.sql`;

      if (fs.existsSync(compiledSqlPath)) {
        const compiledSqlFile = await vscode.workspace.fs.readFile(
          vscode.Uri.file(compiledSqlPath),
        );
        compiledSql = compiledSqlFile.toString();
        try {
          compiledSql = sqlFormat(compiledSql);
        } catch {
          // Fail silently when formatting sql
        }
        return compiledSql;
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Fetches a project's manifest file from the system path
   */
  async fetchManifest({ project }: { project: DbtProject }) {
    try {
      const manifestFile = await vscode.workspace.fs.readFile(
        vscode.Uri.file(
          `${project.pathSystem}/${project.targetPath}/manifest.json`,
        ),
      );
      const manifestString = manifestFile.toString();
      if (!manifestString) {
        return null;
      }
      return jsonParse(manifestString) as DbtProjectManifest;
    } catch {
      return null;
    }
  }

  async handleManifest({
    manifest,
    project,
  }: {
    manifest: DbtProjectManifest;
    project: DbtProject;
  }) {
    const isProjectAllowed = isDbtProjectNameConfigured(project.name);
    if (!isProjectAllowed) {
      this.log.info('Skipping manifest for', project.name);
      return null;
    }

    project = { ...project, manifest };

    // When we get a new dbt manifest, we'll use it to update the project info and json schemas
    this.projects.set(project.name, project);

    // Update project macros
    for (const [macroKey, macro] of Object.entries(manifest.macros)) {
      const macroId = macroKey.split('.').slice(1).join('.');
      this.macros.set(macroId, macro);
    }

    // Handle groups
    const groupEnum: string[] = [];
    for (const group of Object.values(manifest.groups ?? {})) {
      if (!group?.name) {
        continue;
      }
      this.state.groupNames.add(group.name);
    }
    for (const groupId of this.state.groupNames.values()) {
      groupEnum.push(groupId);
    }
    try {
      const modelGroupSchema = jsonParse(
        (
          await vscode.workspace.fs.readFile(
            vscode.Uri.file(
              path.join(DJ_SCHEMAS_PATH, 'model.group.schema.json'),
            ),
          )
        ).toString(),
      ) as FrameworkSchemaBase;
      modelGroupSchema.enum = groupEnum;
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(DJ_SCHEMAS_PATH, 'model.group.schema.json')),
        Buffer.from(JSON.stringify(modelGroupSchema)),
      );
    } catch (err: unknown) {
      this.log.error('Error setting group schema', err);
    }

    // Handle models & seeds
    const modelEnum = new Set<string>();

    // Process nodes in batches to reduce memory pressure
    const nodeEntries = Object.entries(manifest.nodes ?? {});
    const BATCH_SIZE = 100;

    for (let i = 0; i < nodeEntries.length; i += BATCH_SIZE) {
      const batch = nodeEntries.slice(i, i + BATCH_SIZE);

      for (const [manifestId, manifestNode] of batch) {
        if (
          !manifestNode?.name ||
          !manifestNode?.resource_type ||
          !['model', 'seed'].includes(manifestNode.resource_type)
        ) {
          // We only care about models and seeds here
          continue;
        }

        const childMap = manifest.child_map?.[manifestId] ?? [];
        const parentMap = manifest.parent_map?.[manifestId] ?? [];
        const pathRelativeFile = manifestNode?.original_file_path ?? '';
        const pathRelativeDirectory = path.dirname(pathRelativeFile);
        const pathSystemDirectory = path.join(
          project.pathSystem,
          pathRelativeDirectory,
        );
        const pathSystemFile = path.join(project.pathSystem, pathRelativeFile);

        switch (manifestNode.resource_type) {
          case 'model': {
            const modelRef = manifestNode.name;
            modelEnum.add(modelRef);
            const modelName = modelRef;
            const modelId = manifestId;
            if (!modelId) {
              continue;
            }

            const model: DbtModel = {
              ...manifestNode,
              childMap,
              description: manifestNode.description ?? '',
              name: manifestNode.name || '',
              parentMap,
              pathRelativeDirectory,
              pathSystemDirectory,
              pathSystemFile,
            };
            this.models.set(modelId, model);
            if (
              manifest.parent_map?.[modelId]?.some((p) =>
                p.startsWith('source.'),
              )
            ) {
              // TODO: Change the roots to sources instead of models
              const modelLabel = frameworkExtractModelName(modelName);
              this.state.modelTreeRoots.set(modelName, {
                id: modelId,
                label: modelLabel,
                description: modelName,
                tooltip: modelName,
                children: [],
                command: {
                  title: 'Open Model',
                  command: COMMAND_ID.MODEL_NAVIGATE,
                  arguments: [model],
                },
              });
            }
            break;
          }
          case 'seed': {
            const seedId = manifestId;
            const seedRef = manifestNode.name;
            // Treating seeds as models for now
            modelEnum.add(seedRef);
            const seed: DbtSeed = {
              ...manifestNode,
              childMap,
              parentMap: [],
              pathRelativeDirectory,
              pathSystemDirectory,
              pathSystemFile,
            };
            this.seeds.set(seedId, seed);
            break;
          }
        }
      }
    }

    // Convert Set to Array for the enum
    const modelEnumArray = Array.from(modelEnum);
    if (modelEnumArray.length) {
      // Don't overwrite if new model enums are empty, this likely means the manifest parsing failed
      try {
        const modelRefSchema = jsonParse(
          (
            await vscode.workspace.fs.readFile(
              vscode.Uri.file(
                path.join(DJ_SCHEMAS_PATH, 'model.ref.schema.json'),
              ),
            )
          ).toString(),
        ) as FrameworkSchemaBase;
        modelRefSchema.enum = modelEnumArray;
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(path.join(DJ_SCHEMAS_PATH, 'model.ref.schema.json')),
          Buffer.from(JSON.stringify(modelRefSchema)),
        );
      } catch {
        this.log.error('Error setting model schema');
      }
    }
    //

    // Handle sources
    for (const [manifestId, manifestSource] of Object.entries(
      project.manifest.sources || {},
    )) {
      if (!(manifestSource?.resource_type === 'source')) {
        continue;
      }
      const sourceId = manifestId;
      const sourceRef = sourceId.split('.').slice(2).join('.');
      this.state.sourceRefs.add(sourceRef);
      const childMap = manifest.child_map?.[sourceId] ?? [];
      const pathRelativeFile = manifestSource.original_file_path ?? '';
      const pathRelativeDirectory = path.dirname(pathRelativeFile);
      const pathSystemDirectory = path.join(
        project.pathSystem,
        pathRelativeDirectory,
      );
      const pathSystemFile = path.join(project.pathSystem, pathRelativeFile);
      const source: DbtSource = {
        ...manifestSource,
        childMap,
        parentMap: [],
        pathRelativeDirectory,
        pathSystemDirectory,
        pathSystemFile,
      };
      this.sources.set(sourceId, source);
    }
    const sourceEnum = [...this.state.sourceRefs.values()];
    if (sourceEnum.length) {
      // Don't overwrite if new source enums are empty, this likely means the manifest parsing failed
      try {
        const sourceRefSchema = jsonParse(
          (
            await vscode.workspace.fs.readFile(
              vscode.Uri.file(
                path.join(DJ_SCHEMAS_PATH, 'source.ref.schema.json'),
              ),
            )
          ).toString(),
        ) as FrameworkSchemaBase;
        sourceRefSchema.enum = sourceEnum;
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(path.join(DJ_SCHEMAS_PATH, 'source.ref.schema.json')),
          Buffer.from(JSON.stringify(sourceRefSchema)),
        );
      } catch (err: unknown) {
        this.log.error('Error setting source schema', err);
      }
    }
    //

    this.viewProjectNavigator.setData(this.buildProjectNavigator({ project }));

    this.log.info('HANDLED MANIFEST');
  }

  /**
   * Handles logic when user navigates to a model file
   */
  handleModelNavigate(info: CoderFileInfo): void {
    if (
      !(info?.type === 'framework-model' || info?.type === 'model') ||
      !info?.model
    ) {
      return;
    }

    this.viewModelActions.setData([
      this.treeItemJsonSync,
      this.treeItemProjectClean,
      this.treeItemModelCreate,
      this.treeItemSourceCreate,
      this.treeItemQueryCreate,
      this.coder.lightdash.treeItemLightdashPreview,
      this.coder.lightdash.treeItemLightdashDashboardsAsCode,
      this.treeItemModelRun,
      this.treeItemModelTest,
      this.treeItemModelCompile,
    ]);
    this.viewSelectedResource.setData(this.buildSelectedResource(info));
  }

  /**
   * Update the Edit Drafts view with current edit sessions
   */
  async updateEditDraftsView(): Promise<void> {
    try {
      // Guard: stateManager may not be initialized yet during construction
      if (!this.coder.stateManager) {
        this.log.info(
          'StateManager not initialized yet, skipping edit drafts update',
        );
        return;
      }

      const drafts = await this.coder.stateManager.getEditDrafts();

      if (drafts.length === 0) {
        this.viewEditDrafts.setData([
          { label: 'No models are being opened for edit' },
        ]);
      } else {
        const treeItems = drafts.map((draft) => ({
          id: draft.formType,
          label: `${draft.modelName}`,
          description: `Last modified: ${draft.lastModified.toLocaleTimeString()}`,
          iconPath: new vscode.ThemeIcon('edit'),
          contextValue: 'editDraft',
          command: {
            command: COMMAND_ID.OPEN_EDIT_DRAFT,
            title: 'Open Edit Draft',
            arguments: [draft.formType, draft.modelName],
          },
        }));

        this.viewEditDrafts.setData(treeItems);
      }
    } catch (error: unknown) {
      this.log.error('Error updating edit drafts view:', error);
      this.viewEditDrafts.setData([
        { label: 'No models are being opened for edit' },
      ]);
    }
  }

  /**
   * Set the webview view for log streaming
   */
  setWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
  }

  /**
   * Get the compiled SQL file path for a model
   */
  private getCompiledSqlPath(
    project: DbtProject,
    model: DbtModel,
    modelName: string,
  ): string {
    let modelDir = '';

    if (model.path) {
      modelDir = path.dirname(model.path);
      if (modelDir.startsWith('models/')) {
        modelDir = modelDir.substring('models/'.length);
      } else if (modelDir.startsWith('models\\')) {
        modelDir = modelDir.substring('models\\'.length);
      }
    } else if (model.pathRelativeDirectory) {
      modelDir = model.pathRelativeDirectory;
    }

    return path.join(
      project.pathSystem,
      'target',
      'compiled',
      project.name,
      'models',
      modelDir,
      `${modelName}.sql`,
    );
  }

  /**
   * Check if a model has been compiled
   */
  private checkCompiledStatus(
    modelName: string,
    projectName: string,
  ): {
    isCompiled: boolean;
    compiledPath?: string;
    lastCompiled?: string;
  } {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    const modelId = getDbtModelId({ modelName, projectName });
    const model = this.models.get(modelId);

    if (!model) {
      throw new Error(`Model ${modelName} not found in project ${projectName}`);
    }

    const modelData = model as any;
    const isEphemeral = modelData.config?.materialized === 'ephemeral';

    if (isEphemeral) {
      const isCompiled = !!(modelData.compiled && modelData.compiled_code);
      return {
        isCompiled,
        compiledPath: isCompiled ? 'manifest (ephemeral)' : undefined,
      };
    }

    const compiledPath = this.getCompiledSqlPath(project, model, modelName);
    const isCompiled = fs.existsSync(compiledPath);

    if (isCompiled) {
      const stats = fs.statSync(compiledPath);
      return {
        isCompiled: true,
        compiledPath,
        lastCompiled: stats.mtime.toISOString(),
      };
    }

    return { isCompiled: false };
  }

  /**
   * Check if a model's source has changed since last compilation
   * Compares current source file content with raw_code stored in manifest
   */
  private checkModelOutdated(
    modelName: string,
    projectName: string,
  ): {
    isOutdated: boolean;
    hasCompiledFile: boolean;
    reason?: string;
  } {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    const modelId = getDbtModelId({ modelName, projectName });
    const model = this.models.get(modelId);

    if (!model) {
      throw new Error(`Model ${modelName} not found in project ${projectName}`);
    }

    // Get the manifest node to access raw_code
    const manifest = project.manifest;
    const manifestNode = manifest?.nodes?.[model.unique_id ?? modelId];

    // Check if compiled file exists
    const modelData = model as any;
    const isEphemeral = modelData.config?.materialized === 'ephemeral';
    let hasCompiledFile = false;

    if (isEphemeral) {
      hasCompiledFile = !!(modelData.compiled && modelData.compiled_code);
    } else {
      const compiledPath = this.getCompiledSqlPath(project, model, modelName);
      hasCompiledFile = fs.existsSync(compiledPath);
    }

    // If no manifest node or no raw_code, consider it outdated
    if (!manifestNode?.raw_code) {
      return {
        isOutdated: true,
        hasCompiledFile,
        reason: 'No manifest data available for comparison',
      };
    }

    // Read current source file content
    const sourceFilePath = model.pathSystemFile;
    if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
      return {
        isOutdated: true,
        hasCompiledFile,
        reason: 'Source file not found',
      };
    }

    try {
      const currentSourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
      const manifestRawCode = manifestNode.raw_code;

      // Normalize whitespace for comparison (trim and collapse whitespace)
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      const normalizedCurrent = normalize(currentSourceContent);
      const normalizedManifest = normalize(manifestRawCode);

      const isOutdated = normalizedCurrent !== normalizedManifest;

      return {
        isOutdated,
        hasCompiledFile,
        reason: isOutdated
          ? 'Source file has changed since last compilation'
          : undefined,
      };
    } catch (error: unknown) {
      this.log.error('Error reading source file for comparison:', error);
      return {
        isOutdated: true,
        hasCompiledFile,
        reason: 'Error reading source file',
      };
    }
  }

  /**
   * Compile a specific model
   */
  private async compileModel(
    modelName: string,
    projectName: string,
  ): Promise<void> {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    return new Promise((resolve) => {
      const terminal = vscode.window.createTerminal({
        cwd: project.pathSystem,
        name: 'Compile Model',
        hideFromUser: false,
      });

      terminal.show();
      terminal.sendText(`dbt compile --select "${modelName}"`);

      setTimeout(() => {
        resolve();
      }, 1000);
    });
  }

  /**
   * Compile a model and stream logs to the webview
   */
  private async compileModelWithLogs(
    modelName: string,
    projectName: string,
  ): Promise<void> {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    if (!this.webviewView) {
      throw new Error('Webview not available for log streaming');
    }

    return new Promise((resolve, reject) => {
      const args = ['compile', '--select', modelName];

      this.log.info(`Executing: dbt ${args.join(' ')}`);

      // Build environment with Python venv support
      const env = buildProcessEnv();

      const childProcess = spawn('dbt', args, {
        cwd: project.pathSystem,
        env,
      });

      let errorOutput = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            type: 'compilation-log',
            log: {
              level: 'info',
              message: text.trim(),
              timestamp: new Date().toISOString(),
            },
          });
        }
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;

        let level: 'info' | 'success' | 'error' | 'warning' = 'info';
        if (text.includes('ERROR') || text.includes('FAIL')) {
          level = 'error';
        } else if (text.includes('WARN')) {
          level = 'warning';
        } else if (
          text.includes('Done') ||
          text.includes('Completed successfully')
        ) {
          level = 'success';
        }

        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            type: 'compilation-log',
            log: {
              level,
              message: text.trim(),
              timestamp: new Date().toISOString(),
            },
          });
        }
      });

      childProcess.on('close', (code) => {
        this.log.info(`dbt compile completed with code: ${code}`);
        const success = code === 0;

        // Refresh manifest after successful compilation so in-memory data is up-to-date
        // Run asynchronously without blocking the close event
        void (async () => {
          if (success) {
            try {
              const manifest = await this.fetchManifest({ project });
              if (manifest) {
                await this.handleManifest({ manifest, project });
                this.log.info('Manifest refreshed after compilation');
              }
            } catch (err: unknown) {
              this.log.warn(
                'Failed to refresh manifest after compilation:',
                err,
              );
            }
          }
        })();

        setTimeout(() => {
          if (this.webviewView) {
            this.webviewView.webview.postMessage({
              type: 'compilation-complete',
              success,
              modelName,
              projectName,
            });
          }

          if (success) {
            resolve();
          } else {
            reject(
              new Error(`Compilation failed with code ${code}: ${errorOutput}`),
            );
          }
        }, 500);
      });

      childProcess.on('error', (error) => {
        this.log.error('Error executing dbt compile:', error);

        // Send user-friendly error log
        const { pythonVenvPath } = getDjConfig();
        const errorMessage =
          (error as any).code === 'ENOENT'
            ? 'DBT executable not found. ' +
              (pythonVenvPath
                ? `Using Python venv: '${pythonVenvPath}'. `
                : 'If dbt is in a Python virtual environment, configure "dj.pythonVenvPath" in VS Code settings. ') +
              'Ensure dbt is installed and available in the environment.'
            : `Failed to execute dbt compile: ${error.message}`;

        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            type: 'compilation-log',
            log: {
              level: 'error',
              message: errorMessage,
              timestamp: new Date().toISOString(),
            },
          });

          this.webviewView.webview.postMessage({
            type: 'compilation-complete',
            success: false,
            modelName,
            projectName,
          });
        }

        reject(new Error(errorMessage));
      });
    });
  }

  /**
   * Register dbt-specific commands
   *
   * Commands in this service:
   * - MODEL_CREATE: Create new model with webview UI
   * - MODEL_RUN: Run model with webview UI
   * - SOURCE_CREATE: Create new source with webview UI
   * - PROJECT_CLEAN: Run dbt clean, deps, and seed in terminal
   *
   * Commands in other services:
   * - JSON_SYNC: In Framework (owns sync state and logic)
   * - CLEAR_SYNC_CACHE: In Framework (owns cache manager)
   * - MODEL_EDIT/MODEL_CLONE: In ModelEdit service
   * - MODEL_LINEAGE/DATA_EXPLORER_*: In DataExplorer service
   *
   * @param context VS Code extension context
   */
  registerCommands(context: vscode.ExtensionContext) {
    this.log.info('Dbt: Registering commands');
    this.registerModelCommands(context);
    this.registerSourceCommands(context);
    this.registerUtilityCommands(context);
    this.log.info('Dbt: Commands registered successfully');
  }

  /**
   * Register model-related commands
   * @param context VS Code extension context
   * @private
   */
  private registerModelCommands(context: vscode.ExtensionContext) {
    // Model Create Command
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.MODEL_CREATE, async () => {
        const existingDraft =
          await this.coder.stateManager.getFormState('model-create');

        if (existingDraft) {
          const choice = await vscode.window.showInformationMessage(
            'You have a saved model draft from a previous session.',
            {
              modal: true,
              detail: 'Would you like to resume it or start fresh?',
            },
            'Resume Draft',
            'Start Fresh',
          );

          if (!choice) {
            return;
          }
          if (choice === 'Start Fresh') {
            await this.coder.stateManager.clearFormState('model-create');
          }
        }

        const panel = vscode.window.createWebviewPanel(
          VIEW_ID.MODEL_CREATE,
          DBT_MSG.CREATE_MODEL,
          vscode.ViewColumn.Active,
          { enableScripts: true },
        );

        panel.onDidDispose(() => {
          this.webviewPanelModelCreate = undefined;
        });
        this.webviewPanelModelCreate = panel;

        const html = getHtml({
          extensionUri: this.context.extensionUri,
          route: '/model/create',
          webview: panel.webview,
        });
        panel.webview.html = html;

        // Handle webview messages including state management
        panel.webview.onDidReceiveMessage(
          this.coder.createWebviewMessageHandler(panel, 'model-create'),
        );
      }),
    );

    // Model Navigate Command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.MODEL_NAVIGATE,
        async (model: DbtModel) => {
          try {
            const uriModelJson = vscode.Uri.file(
              model.pathSystemFile.replace('.sql', '.model.json'),
            );
            const uriModelSql = vscode.Uri.file(model.pathSystemFile);
            if (fs.existsSync(uriModelJson.fsPath)) {
              await vscode.window.showTextDocument(uriModelJson);
            } else {
              await vscode.window.showTextDocument(uriModelSql);
            }
          } catch (err: unknown) {
            this.log.error('ERROR NAVIGATING TO MODEL', err);
          }
        },
      ),
    );

    // Model Test Command (with webview UI)
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.MODEL_TEST, async () => {
        try {
          this.log.info('Run DBT Test UI command triggered');

          const info = await this.coder.fetchCurrentInfo();
          let modelTestInfo: {
            modelName: string | null;
            projectName: string;
            projectPath: string;
          } | null;

          if (info && 'model' in info && info.model) {
            modelTestInfo = {
              modelName: info.model.name,
              projectName: info.project.name,
              projectPath: info.project.pathSystem,
            };
          } else {
            const projects = Array.from(this.projects.values());
            if (projects.length > 0) {
              const firstProject = projects[0];
              modelTestInfo = {
                modelName: null,
                projectName: firstProject.name,
                projectPath: firstProject.pathSystem,
              };
            } else {
              modelTestInfo = null;
            }
          }

          const panel = vscode.window.createWebviewPanel(
            VIEW_ID.MODEL_TEST,
            'Run DBT Test',
            vscode.ViewColumn.Active,
            { enableScripts: true },
          );

          panel.onDidDispose(() => {
            this.webviewPanelModelTest = undefined;
          });
          this.webviewPanelModelTest = panel;

          const html = getHtml({
            extensionUri: this.context.extensionUri,
            route: '/model/test',
            webview: panel.webview,
          });
          panel.webview.html = html;

          panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'dbt-get-model-info') {
              const _channelId = message._channelId;
              try {
                panel.webview.postMessage({
                  _channelId,
                  response: modelTestInfo,
                });
              } catch (err: unknown) {
                const errorMessage =
                  err instanceof Error
                    ? err.message
                    : 'Failed to get model info';
                panel.webview.postMessage({
                  _channelId,
                  err: {
                    message: errorMessage,
                  },
                });
              }
              return;
            }

            if (message.type === 'copy-to-clipboard') {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(
                'Command copied to clipboard',
              );
              return;
            }

            if (
              (message.type === 'api-request' &&
                message.apiType === 'dbt-run-test' &&
                message.request) ||
              (message.type === 'dbt-run-test' && message.request)
            ) {
              try {
                const req =
                  message.type === 'dbt-run-test'
                    ? (
                        message as {
                          request: { projectName: string; models: any[] };
                        }
                      ).request
                    : message.request;
                const { projectName, models } = req;
                const _channelId = (message as { _channelId?: string })
                  ._channelId;
                await this.runTestsWithStreaming(panel, projectName, models);
                if (_channelId) {
                  panel.webview.postMessage({
                    _channelId,
                    response: null,
                  });
                } else {
                  panel.webview.postMessage({
                    type: 'api-response',
                    success: true,
                    response: null,
                  });
                }
              } catch (err: unknown) {
                const errorMessage =
                  err instanceof Error ? err.message : 'Failed to run tests';
                this.log.error('Error running dbt tests:', err);
                const _channelId = (message as { _channelId?: string })
                  ._channelId;
                if (_channelId) {
                  panel.webview.postMessage({
                    _channelId,
                    err: { message: errorMessage },
                  });
                } else {
                  panel.webview.postMessage({
                    type: 'api-response',
                    success: false,
                    error: errorMessage,
                  });
                }
              }
              return;
            }

            await this.coder.createWebviewMessageHandler(
              panel,
              'model-test',
            )(message);
          });
        } catch (err: unknown) {
          this.log.error('ERROR OPENING RUN DBT TEST UI', err);
          vscode.window.showErrorMessage('Failed to open Run DBT Test UI');
        }
      }),
    );

    // Model Run Command (with webview UI)
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.MODEL_RUN, async () => {
        try {
          this.log.info('Run Model UI command triggered');

          // Store model info BEFORE opening the webview panel
          // because once the panel opens, the active editor changes
          const info = await this.coder.fetchCurrentInfo();
          let modelRunInfo;

          if (info && 'model' in info && info.model) {
            // Has active model
            modelRunInfo = {
              modelName: info.model.name,
              projectName: info.project.name,
              projectPath: info.project.pathSystem,
            };
          } else {
            // No active model - get first available project
            const projects = Array.from(this.projects.values());
            if (projects.length > 0) {
              const firstProject = projects[0];
              modelRunInfo = {
                modelName: null,
                projectName: firstProject.name,
                projectPath: firstProject.pathSystem,
              };
            } else {
              // No projects at all
              modelRunInfo = null;
            }
          }

          const panel = vscode.window.createWebviewPanel(
            VIEW_ID.MODEL_RUN,
            'Run Model',
            vscode.ViewColumn.Active,
            { enableScripts: true },
          );

          const html = getHtml({
            extensionUri: this.context.extensionUri,
            route: '/model/run',
            webview: panel.webview,
          });
          panel.webview.html = html;

          // Handle webview messages
          panel.webview.onDidReceiveMessage(async (message) => {
            // Intercept dbt-get-model-info to return stored info
            if (message.type === 'dbt-get-model-info') {
              const _channelId = message._channelId;
              try {
                panel.webview.postMessage({
                  _channelId,
                  response: modelRunInfo,
                });
              } catch (err: unknown) {
                const errorMessage =
                  err instanceof Error
                    ? err.message
                    : 'Failed to get model info';
                panel.webview.postMessage({
                  _channelId,
                  err: {
                    message: errorMessage,
                  },
                });
              }
              return;
            }

            // Handle copy to clipboard
            if (message.type === 'copy-to-clipboard') {
              await vscode.env.clipboard.writeText(message.text);
              vscode.window.showInformationMessage(
                'Command copied to clipboard',
              );
              return;
            }
            // Handle all other messages through the standard handler
            await this.coder.createWebviewMessageHandler(
              panel,
              'model-run',
            )(message);
          });
        } catch (err: unknown) {
          this.log.error('ERROR OPENING RUN MODEL UI', err);
          vscode.window.showErrorMessage('Failed to open Run Model UI');
        }
      }),
    );

    // Model Compile Command - triggers compilation in Data Explorer view
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.MODEL_COMPILE,
        async (uri?: vscode.Uri) => {
          try {
            // Use URI if provided (from file explorer), otherwise use active editor
            const filePath = uri?.fsPath ?? this.coder.getCurrentPath();
            if (!filePath) {
              return;
            }

            const info = await this.coder.fetchFileInfoFromPath(filePath);
            const model = info && 'model' in info && info?.model;
            const project = info && 'project' in info && info?.project;

            if (!model || !project) {
              this.log.warn(
                'Could not find model or project info for compilation',
              );
              return;
            }

            // Focus the Data Explorer view
            await vscode.commands.executeCommand(VIEW_ID.MODEL_LINEAGE_FOCUS);

            // Send message to webview to trigger compilation (message will be queued if webview not ready)
            const dataExplorerView = this.coder.dataExplorer.getViewProvider();
            if (dataExplorerView) {
              dataExplorerView.sendMessage({
                type: 'trigger-compilation',
                modelName: model.name,
                projectName: project.name,
              });
            } else {
              this.log.error('Data Explorer view provider not available');
              vscode.window.showErrorMessage(
                'Data Explorer view is not available',
              );
            }
          } catch (err: unknown) {
            this.log.error('ERROR COMPILING MODEL: ', err);
            vscode.window.showErrorMessage(
              'Failed to trigger model compilation',
            );
          }
        },
      ),
    );
  }

  /**
   * Register source-related commands
   * @param context VS Code extension context
   * @private
   */
  private registerSourceCommands(context: vscode.ExtensionContext) {
    // Source Navigate Command
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.SOURCE_NAVIGATE,
        async (source: DbtSource) => {
          try {
            const uriSourceYaml = vscode.Uri.file(source.pathSystemFile);
            await vscode.window.showTextDocument(uriSourceYaml);
          } catch (err: unknown) {
            this.log.error('ERROR NAVIGATING TO SOURCE', err);
          }
        },
      ),
    );

    // Source Create Command
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.SOURCE_CREATE, () => {
        if (this.webviewPanelSourceCreate) {
          this.webviewPanelSourceCreate.reveal();
        } else {
          const panel = vscode.window.createWebviewPanel(
            VIEW_ID.SOURCE_CREATE,
            DBT_MSG.CREATE_SOURCE,
            vscode.ViewColumn.One,
            { enableScripts: true },
          );
          panel.onDidDispose(() => {
            this.webviewPanelSourceCreate = undefined;
          });
          this.webviewPanelSourceCreate = panel;
          const html = getHtml({
            extensionUri: this.context.extensionUri,
            route: '/source/create',
            webview: panel.webview,
          });
          panel.webview.html = html;

          // Handle webview messages including state management
          panel.webview.onDidReceiveMessage(
            this.coder.createWebviewMessageHandler(panel, 'source-create'),
          );
        }
      }),
    );
  }

  /**
   * Register utility commands (sync, clean, etc.)
   * @param context VS Code extension context
   * @private
   */
  private registerUtilityCommands(context: vscode.ExtensionContext) {
    // Project Clean Command - runs dbt clean, deps, and seed
    context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_ID.PROJECT_CLEAN, async () => {
        try {
          this.log.info('CLEANING PROJECT');
          const info = await this.coder.fetchCurrentInfo();
          const project = (info && 'project' in info && info?.project) || null;

          const terminal = vscode.window.createTerminal({
            cwd:
              project?.pathSystem ||
              path.join(WORKSPACE_ROOT, DEFAULT_DBT_PATH), // Fallback if project is in an unparsable state
            name: 'Clean Project',
          });
          terminal.show();
          terminal.sendText(`dbt clean && dbt deps && dbt seed`);
          this.log.info('FINISHED CLEANING PROJECT');
        } catch (err: unknown) {
          this.log.info('ERROR CLEANING PROJECT', err);
        }
      }),
    );
  }

  // Dispose Source Create Webview Panel
  disposeWebviewPanelSourceCreate() {
    this.webviewPanelSourceCreate?.dispose();
  }

  // Dispose Model Create Webview Panel
  disposeWebviewPanelModelCreate() {
    this.webviewPanelModelCreate?.dispose();
  }

  // Dispose Model Test Webview Panel
  disposeWebviewPanelModelTest() {
    this.webviewPanelModelTest?.dispose();
  }

  /**
   * Detect applicable data tests for a model based on its structure
   * - Row count tests for models with joins
   * - No null aggregates tests for models with aggregate columns
   */
  private detectApplicableTests(modelJson: any): Array<{
    type: string;
    compare_model?: string;
    column_name?: string;
    join_type?: string;
  }> {
    const tests: Array<{
      type: string;
      compare_model?: string;
      column_name?: string;
      join_type?: string;
    }> = [];
    const from = modelJson.from;

    if (from?.join?.length > 0 && from?.model) {
      const hasLeftJoin = from.join.some(
        (j: { type?: string }) => j.type === 'left',
      );
      tests.push({
        type: hasLeftJoin ? 'equal_row_count' : 'equal_or_lower_row_count',
        compare_model: `ref('${from.model}')`,
        join_type: from.join[0]?.type || 'left',
      });
    }

    const aggregateCols = this.detectAggregateColumns(modelJson.select);
    for (const col of aggregateCols) {
      tests.push({
        type: 'no_null_aggregates',
        column_name: col,
      });
    }

    return tests;
  }

  /**
   * Detect aggregate columns from model select array
   * Looks for SUM, COUNT, AVG, MIN, MAX patterns in expressions
   * Only returns columns that have a valid name
   */
  private detectAggregateColumns(select: any[] | undefined): string[] {
    if (!select || !Array.isArray(select)) {
      return [];
    }

    const aggPattern = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i;
    return select
      .filter((s: { expression?: string; expr?: string; name?: string }) => {
        const expression = s.expression || s.expr;
        return expression && aggPattern.test(expression) && s.name;
      })
      .map((s: { name: string }) => s.name)
      .filter((name) => name && name.trim() !== '');
  }

  /**
   * Merge new tests with existing tests, avoiding duplicates
   * Duplicates are detected by comparing type and key properties
   */
  private mergeTests(existingTests: any[], newTests: any[]): any[] {
    const result = [...existingTests];

    for (const newTest of newTests) {
      const isDuplicate = result.some((existing) => {
        if (existing.type !== newTest.type) {
          return false;
        }

        switch (newTest.type) {
          case 'equal_row_count':
          case 'equal_or_lower_row_count':
            return existing.compare_model === newTest.compare_model;
          case 'no_null_aggregates':
            return existing.column_name === newTest.column_name;
          default:
            return false;
        }
      });

      if (!isDuplicate) {
        result.push(newTest);
      }
    }

    return result;
  }

  /**
   * Build dbt test selector string based on model config
   * - Full lineage: +<model_name>+
   * - With limits: <limit>+<model_name>+<limit>
   * - Individual model: <model_name>
   */
  private buildTestSelector(
    modelName: string,
    config: {
      upstream: boolean;
      downstream: boolean;
      fullLineage: boolean;
      upLimit: number;
      downLimit: number;
    },
  ): string {
    if (config.fullLineage) {
      return `+${modelName}+`;
    }

    let upstream = '';
    let downstream = '';

    if (config.upstream) {
      upstream = config.upLimit > 0 ? `${config.upLimit}+` : '+';
    }

    if (config.downstream) {
      downstream = config.downLimit > 0 ? `+${config.downLimit}` : '+';
    }

    return `${upstream}${modelName}${downstream}`;
  }

  /**
   * Run dbt tests for multiple models with streaming logs to a webview panel
   */
  async runTestsWithStreaming(
    panel: vscode.WebviewPanel,
    projectName: string,
    models: {
      name: string;
      config: {
        upstream: boolean;
        downstream: boolean;
        fullLineage: boolean;
        upLimit: number;
        downLimit: number;
      };
    }[],
  ): Promise<void> {
    const project = this.projects.get(projectName);
    if (!project) {
      throw new Error(`Project ${projectName} not found`);
    }

    this.log.info(
      `Running tests for ${models.length} models in project ${projectName}`,
    );

    panel.webview.postMessage({
      type: 'test-log',
      log: {
        level: 'info',
        message: `> Initializing dbt test on ${models.length} models...`,
        timestamp: new Date().toISOString(),
      },
    });

    for (const model of models) {
      panel.webview.postMessage({
        type: 'test-status',
        modelName: model.name,
        status: 'idle',
      });
    }

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const modelName = model.name;
      const selector = this.buildTestSelector(modelName, model.config);

      panel.webview.postMessage({
        type: 'test-status',
        modelName,
        status: 'progressing',
      });

      panel.webview.postMessage({
        type: 'test-log',
        log: {
          level: 'info',
          message: `[${new Date().toLocaleTimeString()}] Running tests for ${modelName}...`,
          timestamp: new Date().toISOString(),
        },
      });

      try {
        const result = await this.runSingleModelTest(panel, project, selector);

        const status = result.hasErrors
          ? 'error'
          : result.hasWarnings
            ? 'warning'
            : 'success';

        panel.webview.postMessage({
          type: 'test-status',
          modelName,
          status,
        });

        const statusText =
          status === 'success'
            ? 'OK'
            : status === 'warning'
              ? 'WARNING'
              : 'ERROR';

        panel.webview.postMessage({
          type: 'test-log',
          log: {
            level: status,
            message: `  - Tests completed ... ${statusText}`,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        panel.webview.postMessage({
          type: 'test-status',
          modelName,
          status: 'error',
        });

        panel.webview.postMessage({
          type: 'test-log',
          log: {
            level: 'error',
            message: `  - Test execution failed: ${error}`,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    panel.webview.postMessage({
      type: 'test-log',
      log: {
        level: 'info',
        message: `> Finished. Test cycle complete.`,
        timestamp: new Date().toISOString(),
      },
    });

    panel.webview.postMessage({
      type: 'test-complete',
    });
  }

  /**
   * Run dbt test for a single model/selector and stream output
   */
  private runSingleModelTest(
    panel: vscode.WebviewPanel,
    project: { pathSystem: string },
    selector: string,
  ): Promise<{ hasErrors: boolean; hasWarnings: boolean }> {
    return new Promise((resolve, reject) => {
      const args = ['test', '--select', selector];

      this.log.info(`Executing: dbt ${args.join(' ')}`);

      const env = {
        ...process.env,
        ...getVenvEnvironment(),
      };

      const childProcess = spawn('dbt', args, {
        cwd: project.pathSystem,
        env,
        shell: true,
      });

      let hasErrors = false;
      let hasWarnings = false;

      const checkForErrors = (text: string) => {
        if (
          text.includes('[ERROR]') ||
          text.includes('[FAIL]') ||
          /\bFAIL\s/.test(text) ||
          text.includes('Database Error') ||
          text.includes('Compilation Error')
        ) {
          hasErrors = true;
        }

        const summaryMatch = text.match(
          /Done\.\s+PASS=(\d+)\s+WARN=(\d+)\s+ERROR=(\d+)/,
        );
        if (summaryMatch) {
          const errorCount = parseInt(summaryMatch[3], 10);
          const warnCount = parseInt(summaryMatch[2], 10);
          if (errorCount > 0) {
            hasErrors = true;
          }
          if (warnCount > 0) {
            hasWarnings = true;
          }
        }
      };

      const checkForWarnings = (text: string) => {
        if (text.includes('[WARNING]') || text.includes('[WARN]')) {
          hasWarnings = true;
        }
      };

      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();

        checkForErrors(text);
        checkForWarnings(text);

        panel.webview.postMessage({
          type: 'test-log',
          log: {
            level: 'info',
            message: text.trim(),
            timestamp: new Date().toISOString(),
          },
        });
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();

        checkForErrors(text);
        checkForWarnings(text);

        panel.webview.postMessage({
          type: 'test-log',
          log: {
            level: 'info',
            message: text.trim(),
            timestamp: new Date().toISOString(),
          },
        });
      });

      childProcess.on('close', (code) => {
        this.log.info(`dbt test completed with code: ${code}`);

        if (code !== 0) {
          hasErrors = true;
        }

        resolve({ hasErrors, hasWarnings });
      });

      childProcess.on('error', (error) => {
        this.log.error('Error executing dbt test:', error);
        reject(new Error(`Failed to execute dbt test: ${error.message}`));
      });
    });
  }

  /**
   * Clear cached data to free up memory
   */
  clearCache() {
    // Clear all maps to free up memory
    this.macros.clear();
    this.models.clear();
    this.seeds.clear();
    this.sources.clear();

    // Clear project manifests to save memory
    for (const project of this.projects.values()) {
      project.manifest = {
        child_map: {},
        disabled: {},
        docs: {},
        exposures: {},
        group_map: {},
        groups: {},
        macros: {},
        metadata: {},
        metrics: {},
        nodes: {},
        parent_map: {},
        saved_queries: {},
        selectors: {},
        semantic_models: {},
        sources: {},
      };
    }
  }

  // Any cleanup that needs to happen when the extension is deactivated would go here
  deactivate() {
    this.disposeWebviewPanelSourceCreate();
    this.disposeWebviewPanelModelCreate();
    this.disposeWebviewPanelModelTest();
    this.clearCache();
    this.modelEdit.deactivate();
  }
}
