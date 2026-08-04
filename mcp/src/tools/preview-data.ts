import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import { dbtCompileModel, dbtRunModel } from '../dbt/compile';
import { readChangeSet } from '../projects/changes';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';
import { executeTrinoQuery, quoteIdent } from '../trino/client';
import {
  assertTrinoEnabled,
  publicTrinoInfo,
  resolveTrinoConnection,
} from '../trino/resolve';

function worktreeProjectPath(manifest: {
  gitRoot: string;
  baseRoot: string;
  worktreePath: string;
}): string {
  const rel = path.relative(manifest.gitRoot, manifest.baseRoot);
  if (!rel || rel === '.') {
    return manifest.worktreePath;
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return manifest.worktreePath;
  }
  return path.join(manifest.worktreePath, rel);
}

async function resolveModelName(params: {
  projectPath: string;
  modelName?: string;
  modelPath?: string;
}): Promise<string> {
  if (params.modelName?.trim()) {
    return params.modelName.trim().replace(/\.model\.json$/i, '');
  }
  if (params.modelPath?.trim()) {
    const base = path.basename(params.modelPath.trim());
    return base.replace(/\.model\.json$/i, '').replace(/\.sql$/i, '');
  }
  const matches = await glob('**/*.model.json', {
    cwd: params.projectPath,
    nodir: true,
  });
  if (matches.length === 1) {
    return path.basename(matches[0]).replace(/\.model\.json$/i, '');
  }
  throw new Error(
    'modelName or modelPath is required when the project has multiple models',
  );
}

/**
 * Live preview of a DJ model: dbt compile or run (with --defer by default),
 * then sample rows via Trino.
 */
export async function previewData(
  args: ProjectSelector & {
    changeSetId?: string;
    modelName?: string;
    modelPath?: string;
    mode?: 'compile' | 'run';
    includeUpstream?: boolean;
    /** Default true — resolve unselected upstreams from state instead of building them. */
    defer?: boolean;
    statePath?: string;
    /** Shared schema for deferred upstreams (e.g. datamarts_portal). */
    deferSchema?: string;
    limit?: number;
  },
) {
  try {
    const conn = resolveTrinoConnection(args.projectId);
    assertTrinoEnabled(conn);

    let projectPath: string;
    let projectPublic: Record<string, unknown>;
    let changeSetId = args.changeSetId;

    if (changeSetId) {
      const manifest = readChangeSet(changeSetId);
      if (manifest.status === 'discarded') {
        return failure([`Change set ${changeSetId} was discarded`]);
      }
      projectPath = worktreeProjectPath(manifest);
      if (!fs.existsSync(projectPath)) {
        return failure([
          `Change set worktree project path missing: ${changeSetId}`,
        ]);
      }
      projectPublic = {
        mode: manifest.mode,
        id: manifest.projectId,
        label: manifest.label,
        projectName: manifest.projectName,
        changeSetId,
      };
    } else {
      const ctx = await resolveActiveProject({
        projectId: args.projectId,
        localPath: args.localPath,
        workspaceRoot: args.workspaceRoot,
        projectPath: args.projectPath,
        projectName: args.projectName,
      });
      projectPath = ctx.projectPath;
      projectPublic = toPublicProject(ctx);
    }

    const modelName = await resolveModelName({
      projectPath,
      modelName: args.modelName,
      modelPath: args.modelPath,
    });
    const mode = args.mode ?? conn.previewMode;
    const limit = args.limit ?? conn.defaultLimit;
    const defer = args.defer !== false && args.includeUpstream !== true;
    const deferSchema =
      args.deferSchema?.trim() ||
      process.env.DJ_DBT_DEFER_SCHEMA?.trim() ||
      'datamarts_portal';
    const steps: string[] = [];

    if (mode === 'run') {
      const run = await dbtRunModel({
        projectPath,
        modelName,
        includeUpstream: args.includeUpstream,
        defer,
        statePath: args.statePath,
        deferSchema: defer ? deferSchema : undefined,
      });
      steps.push(defer ? 'dbt_run_defer' : 'dbt_run');
      const sql = `SELECT * FROM ${quoteIdent(conn.catalog)}.${quoteIdent(conn.schema)}.${quoteIdent(modelName)}`;
      const result = await executeTrinoQuery(conn, sql, { limit });
      steps.push('trino_query');
      return success({
        project: projectPublic,
        changeSetId,
        modelName,
        mode,
        defer,
        deferSchema: defer ? deferSchema : undefined,
        steps,
        trino: publicTrinoInfo(conn),
        sql: `${sql}\nLIMIT ${limit}`,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        limit,
        dbt: {
          stdoutTail: run.stdout.slice(-1500),
          stderrTail: run.stderr.slice(-1500),
          deferStatePath: run.deferStatePath,
        },
        hint: changeSetId
          ? `Review rows, then dj_publish_change({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
          : undefined,
      });
    }

    const compiled = await dbtCompileModel({
      projectPath,
      modelName,
      defer,
      statePath: args.statePath,
      deferSchema: defer ? deferSchema : undefined,
    });
    steps.push(defer ? 'dbt_compile_defer' : 'dbt_compile');
    const result = await executeTrinoQuery(conn, compiled.compiledSql!, {
      limit,
    });
    steps.push('trino_query');

    return success({
      project: projectPublic,
      changeSetId,
      modelName,
      mode: 'compile',
      defer,
      deferSchema: defer ? deferSchema : undefined,
      steps,
      trino: publicTrinoInfo(conn),
      compiledSql: compiled.compiledSql,
      sql: compiled.compiledSql,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      limit,
      dbt: {
        stdoutTail: compiled.stdout.slice(-1500),
        stderrTail: compiled.stderr.slice(-1500),
        deferStatePath: compiled.deferStatePath,
      },
      hint: changeSetId
        ? `Review rows, then dj_publish_change({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
        : undefined,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
