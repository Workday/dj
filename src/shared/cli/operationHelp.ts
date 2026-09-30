/**
 * Per-operation invoke help for the DJ CLI (vscode-free; used by dj-cli --help and system.help).
 */

export type PayloadRequired = 'none' | 'optional' | 'required';

export type PreferredInvoke =
  | 'fileAndFlags'
  | 'fileFlatBody'
  | 'fileWrappedModelJson';

export type OperationHelp = {
  operation: string;
  description: string;
  sideEffect: 'read' | 'mutate';
  payloadRequired: PayloadRequired;
  preferredInvoke: PreferredInvoke;
  allowedFlags: string[];
  exampleFile?: string;
  exampleCommand: string;
  payloadNotes?: string;
  defaultTimeoutMs?: number;
};

const COMMON_FLAGS = [
  '--file',
  '--json',
  '--workspace',
  '--timeout',
] as const;

const PROJECT_FLAGS = [...COMMON_FLAGS, '--projectName'] as const;

const MODEL_NAME_FLAGS = [
  ...PROJECT_FLAGS,
  '--modelName',
  '--depth',
] as const;

function help(entry: OperationHelp): OperationHelp {
  return entry;
}

/** Every CLI operation registered on the bridge (excludes system.help meta-op). */
export const CLI_OPERATION_NAMES: readonly string[] = [
  'dbt.compile',
  'dbt.compile-logs',
  'dbt.compile-select',
  'dbt.model-outdated',
  'dbt.compiled-status',
  'dbt.modified-models',
  'dbt.models.search',
  'dbt.models',
  'dbt.parse',
  'dbt.projects',
  'dbt.run',
  'dbt.sources',
  'lightdash.assets',
  'model.columns',
  'model.compiled-sql',
  'model.create-batch',
  'model.create',
  'model.cte-analysis',
  'model.data-check',
  'model.exists',
  'model.get',
  'model.lineage',
  'model.preview',
  'model.query',
  'model.reverse-lineage',
  'model.similar',
  'model.sync',
  'model.update',
  'query.execute',
  'source.create',
  'system.capabilities',
  'system.ping',
  'trino.catalogs',
  'trino.columns',
  'trino.schemas',
  'trino.tables',
  'workflow.scaffold-explore',
];

const DJ = '.dj/bin/dj';

const HELP_BY_NAME: Record<string, OperationHelp> = {
  'system.ping': help({
    operation: 'system.ping',
    description: 'Liveness/version check for the DJ bridge.',
    sideEffect: 'read',
    payloadRequired: 'none',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleCommand: `${DJ} system.ping`,
  }),
  'system.capabilities': help({
    operation: 'system.capabilities',
    description: 'List operations this bridge exposes (authoritative op list).',
    sideEffect: 'read',
    payloadRequired: 'none',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleCommand: `${DJ} system.capabilities`,
  }),
  'dbt.projects': help({
    operation: 'dbt.projects',
    description: 'List dbt projects in the workspace.',
    sideEffect: 'read',
    payloadRequired: 'none',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS],
    exampleFile: 'examples/dbt-project.request.json',
    exampleCommand: `${DJ} dbt.projects --file examples/dbt-project.request.json`,
  }),
  'dbt.models': help({
    operation: 'dbt.models',
    description: 'List model names in a project.',
    sideEffect: 'read',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS],
    exampleFile: 'examples/dbt-project.request.json',
    exampleCommand: `${DJ} dbt.models --file examples/dbt-project.request.json`,
    payloadNotes:
      'Omit payload or set projectName when multiple dbt projects exist.',
  }),
  'dbt.models.search': help({
    operation: 'dbt.models.search',
    description: 'Search models by pattern, topic, group, tags, fromModel, etc.',
    sideEffect: 'read',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS],
    exampleFile: 'examples/dbt-models-search.request.json',
    exampleCommand: `${DJ} dbt.models.search --file examples/dbt-models-search.request.json`,
  }),
  'dbt.sources': help({
    operation: 'dbt.sources',
    description: 'List declared dbt source names.',
    sideEffect: 'read',
    payloadRequired: 'none',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleCommand: `${DJ} dbt.sources`,
  }),
  'dbt.modified-models': help({
    operation: 'dbt.modified-models',
    description: 'List models changed versus the base ref.',
    sideEffect: 'read',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS],
    exampleFile: 'examples/dbt-modified-models.request.json',
    exampleCommand: `${DJ} dbt.modified-models --file examples/dbt-modified-models.request.json`,
  }),
  'dbt.compiled-status': help({
    operation: 'dbt.compiled-status',
    description: 'Whether a model is compiled (path/time).',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleCommand: `${DJ} dbt.compiled-status --modelName int__g__t__name --projectName opus`,
    payloadNotes: 'Requires modelName; use --file or --modelName.',
  }),
  'dbt.model-outdated': help({
    operation: 'dbt.model-outdated',
    description: 'Whether compiled output is stale for a model.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleCommand: `${DJ} dbt.model-outdated --modelName int__g__t__name --projectName opus`,
  }),
  'trino.catalogs': help({
    operation: 'trino.catalogs',
    description: 'List Trino catalogs.',
    sideEffect: 'read',
    payloadRequired: 'none',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleCommand: `${DJ} trino.catalogs`,
  }),
  'trino.schemas': help({
    operation: 'trino.schemas',
    description: 'List schemas in a catalog.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleFile: 'examples/trino-schemas.request.json',
    exampleCommand: `${DJ} trino.schemas --file examples/trino-schemas.request.json`,
    payloadNotes: 'Requires catalog.',
  }),
  'trino.tables': help({
    operation: 'trino.tables',
    description: 'List tables in a schema.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleFile: 'examples/trino-tables.request.json',
    exampleCommand: `${DJ} trino.tables --file examples/trino-tables.request.json`,
    payloadNotes: 'Requires catalog and schema.',
  }),
  'trino.columns': help({
    operation: 'trino.columns',
    description: 'List columns for a table (SHOW COLUMNS).',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleFile: 'examples/trino-columns.request.json',
    exampleCommand: `${DJ} trino.columns --file examples/trino-columns.request.json`,
  }),
  'model.get': help({
    operation: 'model.get',
    description: 'Read an existing .model.json.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleCommand: `${DJ} model.get --modelName int__g__t__name --projectName opus`,
  }),
  'model.columns': help({
    operation: 'model.columns',
    description: 'Column list from manifest (dim/fct, types).',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleFile: 'examples/model-columns.request.json',
    exampleCommand: `${DJ} model.columns --file examples/model-columns.request.json`,
  }),
  'model.similar': help({
    operation: 'model.similar',
    description: 'Peer models (same upstream, group, topic).',
    sideEffect: 'read',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS, '--modelName'],
    exampleCommand: `${DJ} model.similar --modelName int__g__t__name --projectName opus`,
  }),
  'lightdash.assets': help({
    operation: 'lightdash.assets',
    description: 'List Lightdash dashboards/charts; optional query filter.',
    sideEffect: 'read',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleFile: 'examples/lightdash-assets.request.json',
    exampleCommand: `${DJ} lightdash.assets --file examples/lightdash-assets.request.json`,
  }),
  'workflow.scaffold-explore': help({
    operation: 'workflow.scaffold-explore',
    description:
      'Suggested int/mart names for a new explore from an upstream model.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS],
    exampleFile: 'examples/workflow-scaffold-explore.request.json',
    exampleCommand: `${DJ} workflow.scaffold-explore --file examples/workflow-scaffold-explore.request.json`,
    payloadNotes: 'Requires upstreamModelName.',
  }),
  'model.sync': help({
    operation: 'model.sync',
    description: 'Generate/refresh workspace .sql/.yml from JSON.',
    sideEffect: 'mutate',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS, '--modelName'],
    exampleCommand: `${DJ} model.sync --modelName int__g__t__name --projectName opus`,
    payloadNotes: 'Omit modelName for full sync.',
  }),
  'model.create-batch': help({
    operation: 'model.create-batch',
    description: 'Create multiple models; one sync at the end.',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileFlatBody',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleCommand: `${DJ} model.create-batch --file batch.json --timeout 600000`,
    defaultTimeoutMs: 600_000,
    payloadNotes: 'Requires { models: [ … ] }.',
  }),
  'model.create': help({
    operation: 'model.create',
    description: 'Create a .model.json and auto-sync SQL/YML.',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileFlatBody',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/model-create.request.json',
    exampleCommand: `${DJ} model.create --file examples/model-create.request.json --timeout 600000`,
    defaultTimeoutMs: 600_000,
    payloadNotes:
      'Flat JSON body (type, group, topic, name, …). Prefer --file over inline --json.',
  }),
  'source.create': help({
    operation: 'source.create',
    description: 'Create a .source.json from a Trino table.',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileFlatBody',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/source-create.request.json',
    exampleCommand: `${DJ} source.create --file examples/source-create.request.json`,
    payloadNotes:
      'Flat Trino identity fields (projectName, trinoCatalog, trinoSchema, trinoTable).',
  }),
  'model.update': help({
    operation: 'model.update',
    description: 'Update an existing model (merge, validate, relocate on rename).',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileWrappedModelJson',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/model-update.request.json',
    exampleCommand: `${DJ} model.update --file examples/model-update.request.json`,
    payloadNotes: 'Requires modelJson plus originalModelPath or modelName.',
  }),
  'model.preview': help({
    operation: 'model.preview',
    description: 'Dry-run SQL/YAML/columns without writing.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileWrappedModelJson',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/model-preview.request.json',
    exampleCommand: `${DJ} model.preview --file examples/model-preview.request.json`,
    payloadNotes: 'modelJson envelope or flat create body (auto-wrapped).',
  }),
  'model.exists': help({
    operation: 'model.exists',
    description: 'Check whether a model identity already exists.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileWrappedModelJson',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/model-exists.request.json',
    exampleCommand: `${DJ} model.exists --file examples/model-exists.request.json`,
  }),
  'model.cte-analysis': help({
    operation: 'model.cte-analysis',
    description: 'Per-CTE inferred columns and diagnostics.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileWrappedModelJson',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleCommand: `${DJ} model.cte-analysis --file examples/model-preview.request.json`,
    payloadNotes: 'Requires modelJson (flat create JSON is auto-wrapped).',
  }),
  'dbt.compile': help({
    operation: 'dbt.compile',
    description:
      'dbt compile (target/compiled only — use model.sync for disk SQL).',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [
      ...PROJECT_FLAGS,
      '--modelName',
      '--select',
      ...COMMON_FLAGS,
    ],
    exampleFile: 'examples/dbt-compile.request.json',
    exampleCommand: `${DJ} dbt.compile --file examples/dbt-compile.request.json`,
    payloadNotes: 'modelName or select; not modelNames array.',
  }),
  'dbt.compile-logs': help({
    operation: 'dbt.compile-logs',
    description: 'Same as dbt.compile with log streaming.',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [
      ...PROJECT_FLAGS,
      '--modelName',
      '--select',
      ...COMMON_FLAGS,
    ],
    exampleFile: 'examples/dbt-compile.request.json',
    exampleCommand: `${DJ} dbt.compile-logs --file examples/dbt-compile.request.json`,
  }),
  'dbt.compile-select': help({
    operation: 'dbt.compile-select',
    description: 'dbt compile with a selector string only.',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS, '--select', ...COMMON_FLAGS],
    exampleCommand: `${DJ} dbt.compile-select --select "mart__a int__b" --projectName opus`,
  }),
  'dbt.parse': help({
    operation: 'dbt.parse',
    description: 'Parse project and refresh manifest.',
    sideEffect: 'mutate',
    payloadRequired: 'optional',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/dbt-project.request.json',
    exampleCommand: `${DJ} dbt.parse --file examples/dbt-project.request.json --timeout 600000`,
    defaultTimeoutMs: 600_000,
  }),
  'dbt.run': help({
    operation: 'dbt.run',
    description: 'Run models via dbt (warehouse write — user Yes/No first).',
    sideEffect: 'mutate',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...PROJECT_FLAGS, ...COMMON_FLAGS],
    exampleFile: 'examples/dbt-run.request.json',
    exampleCommand: `${DJ} dbt.run --file examples/dbt-run.request.json`,
  }),
  'model.lineage': help({
    operation: 'model.lineage',
    description:
      'Upstream/downstream lineage (CLI defaults depth to full chain).',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleFile: 'examples/model-lineage.request.json',
    exampleCommand: `${DJ} model.lineage --file examples/model-lineage.request.json`,
  }),
  'model.compiled-sql': help({
    operation: 'model.compiled-sql',
    description: "Read a model's compiled SQL.",
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleCommand: `${DJ} model.compiled-sql --modelName int__g__t__name --projectName opus`,
  }),
  'model.query': help({
    operation: 'model.query',
    description: 'Run compiled SQL for a model via Trino (preview path).',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleFile: 'examples/model-query.request.json',
    exampleCommand: `${DJ} model.query --file examples/model-query.request.json`,
  }),
  'model.data-check': help({
    operation: 'model.data-check',
    description: 'Read-only sanity-check SQL from a named template.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...MODEL_NAME_FLAGS],
    exampleCommand: `${DJ} model.data-check --modelName mart__g__t__name --file payload.json`,
    payloadNotes: 'Requires modelName and template in JSON.',
  }),
  'model.reverse-lineage': help({
    operation: 'model.reverse-lineage',
    description: 'Trace from dashboard/chart back to models.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS],
    exampleCommand: `${DJ} model.reverse-lineage --file payload.json`,
    payloadNotes: 'Requires kind and slug.',
  }),
  'query.execute': help({
    operation: 'query.execute',
    description: 'Run a read-only SELECT against the warehouse.',
    sideEffect: 'read',
    payloadRequired: 'required',
    preferredInvoke: 'fileAndFlags',
    allowedFlags: [...COMMON_FLAGS, '--sql'],
    exampleFile: 'examples/query-execute.request.json',
    exampleCommand: `${DJ} query.execute --file examples/query-execute.request.json`,
  }),
};

export const CLI_USAGE =
  'usage: dj <operation> [--help] [--file req.json | --json <str>] [--modelName X] [--projectName P] [--select S] [--sql Q] [--depth N] [--workspace <dir>] [--timeout <ms>]';

export function getOperationHelp(operation: string): OperationHelp | undefined {
  return HELP_BY_NAME[operation];
}

export function listOperationHelp(): OperationHelp[] {
  return CLI_OPERATION_NAMES.map((name) => HELP_BY_NAME[name]).filter(
    (h): h is OperationHelp => h !== undefined,
  );
}

export function formatGlobalHelp(): {
  usage: string;
  operations: string[];
  hint: string;
} {
  return {
    usage: CLI_USAGE,
    operations: [...CLI_OPERATION_NAMES],
    hint: 'Run dj <operation> --help for JSON invoke help, or system.capabilities when the bridge is up.',
  };
}

export function formatOperationHelpSummary(
  operation: string,
): OperationHelp | { error: string; suggestion: string } {
  const h = getOperationHelp(operation);
  if (!h) {
    return {
      error: `Unknown operation: ${operation}`,
      suggestion: 'Run dj --help or system.capabilities for the op list.',
    };
  }
  return h;
}
