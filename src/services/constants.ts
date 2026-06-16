/**
 * Constants and configuration values for the DJ (Data JSON) Framework
 * Centralized to avoid hardcoded values throughout the codebase
 */

import * as path from 'path';

// Base paths relative to the project root
export const BASE_AIRFLOW_PATH = path.join(__dirname, '../../airflow');
export const BASE_MACROS_PATH = path.join(__dirname, '../../macros');
export const BASE_TESTS_PATH = path.join(__dirname, '../../macros/tests');
export const BASE_SCHEMAS_PATH = path.join(__dirname, '../../schemas');
export const BASE_SKILLS_PATH = path.join(__dirname, '../../templates/skills');

// Extension constants
export const OUTPUT_CHANNEL_NAME = 'DJ';

// File patterns and regex
export const FILE_WATCHER_PATTERN =
  '{/**/*.json,/**/*.sql,/**/*.yml,**/.git/logs/HEAD}';

export const IGNORE_PATHS_REGEX =
  /\.dbt\/|\.dj\/|\.vscode\/|\/_ext_\/|\/dbt_packages\/|\/target\/.+\//;

export const FILE_REGEX =
  '(?:\\/(?:\\w|\\d|-)+)*\\/((?:\\w|\\d|-)+)+(?:\\.((?:\\w|\\d|\\.|-)+))?$';

// Supported file extensions
export const SUPPORTED_EXTENSIONS = [
  'json',
  'model.json',
  'source.json',
  'sql',
  'yml',
];

// Git paths
export const GIT_LOG_PATH = '.git/logs/HEAD';

// Default paths
export const DEFAULT_DBT_PATH = 'dags/dbt';
export const DEFAULT_DBT_MACRO_PATH = '_ext_';

export const GITIGNORE = '.gitignore';
export const DJ_IGNORE_ENTRY = '.dj/';
export const IGNORE_PROMPT_KEY = 'dj.ignoreGitignorePrompt';

// Command IDs
export const COMMAND_ID = {
  COLUMN_ORIGIN: 'dj.command.columnOrigin',
  COLUMN_LINEAGE: 'dj.command.columnLineage',
  CLEAR_SYNC_CACHE: 'dj.command.clearSyncCache',
  CONVERT_DRAFT_TO_MODEL: 'dj.command.convertDraftToModel',
  CONVERT_DRAFT_TO_MODEL_COPILOT: 'dj.command.convertDraftToModelCopilot',
  CONVERT_DRAFT_TO_MODEL_CURSOR: 'dj.command.convertDraftToModelCursor',
  CONVERT_DRAFT_TO_MODEL_CLAUDE: 'dj.command.convertDraftToModelClaude',
  DEFER_RUN: 'dj.command.deferRun',
  DISCARD_EDIT_DRAFT: 'dj.command.discardEditDraft',
  LIGHTDASH_DASHBOARDS_AS_CODE: 'dj.command.lightdashDashboardsAsCode',
  LIGHTDASH_PREVIEW: 'dj.command.lightdashPreview',
  MODEL_CLONE: 'dj.command.modelClone',
  MODEL_COMPILE: 'dj.command.modelCompile',
  MODEL_CREATE: 'dj.command.modelCreate',
  MODEL_EDIT: 'dj.command.modelEdit',
  MODEL_LINEAGE: 'dj.command.modelLineage',
  MODEL_NAVIGATE: 'dj.command.modelNavigate',
  MODEL_PREVIEW: 'dj.command.modelPreview',
  MODEL_RUN: 'dj.command.modelRun',
  MODEL_RUN_LINEAGE: 'dj.command.modelRunLineage',
  MODEL_TEST: 'dj.command.modelTest',
  OPEN_DATA_EXPLORER_WITH_MODEL: 'dj.command.openDataExplorerWithModel',
  OPEN_EDIT_DRAFT: 'dj.command.openEditDraft',
  OPEN_TARGET_COMPILED_SQL: 'dj.command.openTargetCompiledSql',
  OPEN_TARGET_RUN_SQL: 'dj.command.openTargetRunSql',
  PROJECT_CLEAN: 'dj.command.projectClean',
  QUERY_DRAFT_CREATE: 'dj.command.queryDraftCreate',
  QUERY_DRAFT_RUN: 'dj.command.queryDraftRun',
  QUERY_VIEW: 'dj.command.queryView',
  REFRESH_PROJECTS: 'dj.command.refreshProjects',
  SOURCE_CREATE: 'dj.command.sourceCreate',
  SOURCE_NAVIGATE: 'dj.command.sourceNavigate',
  SOURCE_ORIGIN: 'dj.command.sourceOrigin',
  SOURCE_REFRESH: 'dj.command.sourceRefresh',
  FRAMEWORK_JUMP_JSON: 'dj.command.frameworkJumpJson',
  FRAMEWORK_JUMP_MODEL: 'dj.command.frameworkJumpModel',
  FRAMEWORK_JUMP_YAML: 'dj.command.frameworkYaml',
  JSON_SYNC: 'dj.command.jsonSync',
  QUERY_CONTROL_CENTER: 'dj.command.queryControlCenter',
  ANALYZE_QUERY: 'dj.command.analyzeQuery',
  SET_TRINO_CREDENTIALS: 'dj.command.setTrinoCredentials',
  SELECT_TRINO_PROFILE: 'dj.command.selectTrinoProfile',
  JUMP_TO_MODEL_FROM_QUERY: 'dj.command.jumpToModelFromQuery',
  TEST_TRINO_CONNECTION: 'dj.command.testTrinoConnection',
} as const;

// View IDs
export const VIEW_ID = {
  PROJECT_NAVIGATOR: 'dj.view.projectNavigator',
  MODEL_ACTIONS: 'dj.view.modelActions',
  SELECTED_RESOURCE: 'dj.view.selectedResource',
  QUERY_ENGINE: 'dj.view.queryEngine',
  QUERY_PREVIEW: 'dj.view.queryPreview',
  QUERY_PREVIEW_FOCUS: 'dj.view.queryPreview.focus',
  EDIT_DRAFTS: 'dj.view.editDrafts',
  MODEL_CREATE: 'dj.view.modelCreate',
  MODEL_EDIT: 'dj.view.modelEdit',
  MODEL_RUN: 'dj.view.modelRun',
  MODEL_LINEAGE: 'dj.view.modelLineage',
  MODEL_LINEAGE_FOCUS: 'dj.view.modelLineage.focus',
  MODEL_TEST: 'dj.view.modelTest',
  SOURCE_CREATE: 'dj.view.sourceCreate',
  LIGHTDASH_DASHBOARDS_AS_CODE: 'dj.view.lightdashDashboardsAsCode',
  LIGHTDASH_PREVIEW_MANAGER: 'dj.view.lightdashPreviewManager',
} as const;

// Lightdash Dashboards-as-Code JSON schema URLs (used by the
// auto-installed `yaml.schemas` workspace settings binding)
export const LIGHTDASH_CHART_SCHEMA_URL =
  'https://raw.githubusercontent.com/lightdash/lightdash/refs/heads/main/packages/common/src/schemas/json/chart-as-code-1.0.json';
export const LIGHTDASH_DASHBOARD_SCHEMA_URL =
  'https://raw.githubusercontent.com/lightdash/lightdash/refs/heads/main/packages/common/src/schemas/json/dashboard-as-code-1.0.json';

export const DBT_MSG = {
  CREATE_SOURCE: 'Create Source',
  CREATE_MODEL: 'Create Model',
  COMPILE_MODEL: 'Compile Model',
  CLEAN_AND_DEPS: 'Clean and Deps',
  CLEAN_PROJECT: 'Clean Project',
  RUN_DEFER: 'Run Defer',
  RUN_MODEL: 'Run Model',
  RUN_MODEL_LINEAGE: 'Run Model Lineage',
  SYNC_JSON_MODELS: 'Sync to SQL and YML',
} as const;
