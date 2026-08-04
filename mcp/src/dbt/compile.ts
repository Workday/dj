import { execFile } from 'child_process';
import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DbtCommandResult {
  stdout: string;
  stderr: string;
  compiledSqlPath?: string;
  compiledSql?: string;
  deferStatePath?: string;
  deferSchema?: string;
}

export interface DbtDeferOptions {
  /** Use --defer so unselected upstreams resolve from state (default true). */
  defer?: boolean;
  /** Directory containing manifest.json for --state. */
  statePath?: string;
  /**
   * Remap personal/dev schema in the state manifest to this shared schema
   * (e.g. datamarts_portal) so defer points at existing upstream tables.
   */
  deferSchema?: string;
}

function dbtBin(): string {
  return process.env.DJ_DBT_PATH?.trim() || process.env.DBT_PATH?.trim() || 'dbt';
}

function defaultDeferSchema(): string | undefined {
  return (
    process.env.DJ_DBT_DEFER_SCHEMA?.trim() ||
    process.env.DBT_DEFER_SCHEMA?.trim() ||
    undefined
  );
}

async function runDbt(
  projectPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env };
  if (process.env.DJ_DBT_PROFILES_DIR?.trim()) {
    env.DBT_PROFILES_DIR = process.env.DJ_DBT_PROFILES_DIR.trim();
  }
  try {
    const { stdout, stderr } = await execFileAsync(dbtBin(), args, {
      cwd: projectPath,
      env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(process.env.DJ_DBT_TIMEOUT_MS ?? 300_000),
    });
    return {
      stdout: typeof stdout === 'string' ? stdout : String(stdout),
      stderr: typeof stderr === 'string' ? stderr : String(stderr),
    };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const detail = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    throw new Error(`dbt ${args.join(' ')} failed:\n${detail}`);
  }
}

export async function findCompiledSql(
  projectPath: string,
  modelName: string,
): Promise<{ path: string; sql: string } | null> {
  const matches = await glob(`**/target/compiled/**/${modelName}.sql`, {
    cwd: projectPath,
    absolute: true,
    nodir: true,
  });
  if (!matches.length) {
    return null;
  }
  matches.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return b.length - a.length;
    }
  });
  const file = matches[0];
  return { path: file, sql: fs.readFileSync(file, 'utf8') };
}

function remapNodeSchema(
  node: Record<string, unknown>,
  personalSchema: string,
  deferSchema: string,
): void {
  const mat = (node.config as { materialized?: string } | undefined)
    ?.materialized;
  if (mat === 'ephemeral') {
    return;
  }
  const schema = node.schema as string | undefined;
  const relationName = node.relation_name as string | undefined;
  if (
    schema !== personalSchema &&
    !(relationName && relationName.includes(`"${personalSchema}"`))
  ) {
    return;
  }
  node.schema = deferSchema;
  if (relationName) {
    node.relation_name = relationName.split(`"${personalSchema}"`).join(
      `"${deferSchema}"`,
    );
  } else {
    const database = (node.database as string) || 'glue_development';
    const alias = (node.alias as string) || (node.name as string) || 'unknown';
    node.relation_name = `"${database}"."${deferSchema}"."${alias}"`;
  }
}

/**
 * Ensure target/manifest.json exists, then write a defer-state copy that
 * remaps the personal schema to a shared upstream schema (e.g. datamarts_portal).
 */
export async function prepareDeferState(
  projectPath: string,
  options: DbtDeferOptions = {},
): Promise<{ statePath: string; deferSchema?: string }> {
  const targetManifest = path.join(projectPath, 'target', 'manifest.json');
  if (!fs.existsSync(targetManifest)) {
    await runDbt(projectPath, ['parse']);
  }
  if (!fs.existsSync(targetManifest)) {
    throw new Error(
      `No dbt manifest at ${targetManifest}. Run dbt parse/compile first.`,
    );
  }

  const deferSchema = options.deferSchema ?? defaultDeferSchema();
  const statePath =
    options.statePath?.trim() ||
    path.join(projectPath, 'target', 'defer_state');
  fs.mkdirSync(statePath, { recursive: true });

  if (!deferSchema) {
    fs.copyFileSync(targetManifest, path.join(statePath, 'manifest.json'));
    return { statePath };
  }

  const personalSchema = process.env.TRINO_SCHEMA?.trim();
  if (!personalSchema) {
    fs.copyFileSync(targetManifest, path.join(statePath, 'manifest.json'));
    return { statePath, deferSchema };
  }

  const manifest = JSON.parse(fs.readFileSync(targetManifest, 'utf8')) as {
    nodes?: Record<string, Record<string, unknown>>;
  };

  for (const [nid, node] of Object.entries(manifest.nodes ?? {})) {
    if (!nid.startsWith('model.') && !nid.startsWith('seed.')) {
      continue;
    }
    remapNodeSchema(node, personalSchema, deferSchema);
  }

  fs.writeFileSync(
    path.join(statePath, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
    'utf8',
  );
  return { statePath, deferSchema };
}

function deferCliArgs(statePath: string): string[] {
  return ['--defer', '--state', statePath];
}

export async function dbtCompileModel(params: {
  projectPath: string;
  modelName: string;
  defer?: boolean;
  statePath?: string;
  deferSchema?: string;
}): Promise<DbtCommandResult> {
  const useDefer = params.defer !== false;
  let deferMeta: { statePath?: string; deferSchema?: string } = {};
  const args = ['compile', '--select', params.modelName];
  if (useDefer) {
    deferMeta = await prepareDeferState(params.projectPath, {
      statePath: params.statePath,
      deferSchema: params.deferSchema,
    });
    args.push(...deferCliArgs(deferMeta.statePath!));
  }
  const { stdout, stderr } = await runDbt(params.projectPath, args);
  const compiled = await findCompiledSql(params.projectPath, params.modelName);
  if (!compiled) {
    throw new Error(
      `dbt compile succeeded but compiled SQL not found for ${params.modelName} under ${params.projectPath}/target/compiled`,
    );
  }
  return {
    stdout,
    stderr,
    compiledSqlPath: compiled.path,
    compiledSql: compiled.sql,
    deferStatePath: deferMeta.statePath,
    deferSchema: deferMeta.deferSchema,
  };
}

export async function dbtRunModel(params: {
  projectPath: string;
  modelName: string;
  includeUpstream?: boolean;
  defer?: boolean;
  statePath?: string;
  deferSchema?: string;
}): Promise<DbtCommandResult> {
  // Prefer defer over building all upstreams.
  const useDefer =
    params.defer !== false && params.includeUpstream !== true;
  const selector = params.includeUpstream
    ? `+${params.modelName}`
    : params.modelName;
  const args = ['run', '--select', selector];
  let deferMeta: { statePath?: string; deferSchema?: string } = {};
  if (useDefer) {
    deferMeta = await prepareDeferState(params.projectPath, {
      statePath: params.statePath,
      deferSchema: params.deferSchema,
    });
    args.push(...deferCliArgs(deferMeta.statePath!));
  }
  const { stdout, stderr } = await runDbt(params.projectPath, args);
  return {
    stdout,
    stderr,
    deferStatePath: deferMeta.statePath,
    deferSchema: deferMeta.deferSchema,
  };
}
