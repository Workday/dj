import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import { dbtRunModel } from '../dbt/compile';
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
 * Run a dbt model (write to Trino) then sample rows.
 *
 * When upstream is omitted or "ask", returns needsDecision so the agent can
 * ask the user: build upstream (+model) vs defer to shared schema.
 */
export async function runModel(
  args: ProjectSelector & {
    changeSetId?: string;
    modelName?: string;
    modelPath?: string;
    /** ask (default) | defer | build */
    upstream?: 'ask' | 'defer' | 'build';
    previewLimit?: number;
    deferSchema?: string;
  },
) {
  try {
    const conn = resolveTrinoConnection(args.projectId);
    assertTrinoEnabled(conn);

    let projectPath: string;
    let projectPublic: Record<string, unknown>;
    const changeSetId = args.changeSetId;

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

    const upstream = args.upstream ?? 'ask';
    if (upstream === 'ask') {
      return success({
        needsDecision: true,
        modelName,
        project: projectPublic,
        changeSetId,
        question:
          'Run with upstream models (+model, rebuild chain in your schema) or defer upstreams to the shared schema and only run this model?',
        options: [
          {
            value: 'defer',
            label: 'Defer upstreams (recommended) — dbt run --defer',
          },
          {
            value: 'build',
            label: 'Build upstreams — dbt run --select +model',
          },
        ],
        hint: `Ask the user, then call dj_run_model again with upstream: "defer" or upstream: "build"${
          changeSetId ? ` and changeSetId: "${changeSetId}"` : ''
        }.`,
      });
    }

    const deferSchema =
      args.deferSchema?.trim() ||
      process.env.DJ_DBT_DEFER_SCHEMA?.trim() ||
      'datamarts_portal';
    const limit = args.previewLimit ?? conn.defaultLimit;
    const useDefer = upstream === 'defer';

    const run = await dbtRunModel({
      projectPath,
      modelName,
      includeUpstream: upstream === 'build',
      defer: useDefer,
      deferSchema: useDefer ? deferSchema : undefined,
    });

    const sql = `SELECT * FROM ${quoteIdent(conn.catalog)}.${quoteIdent(conn.schema)}.${quoteIdent(modelName)}`;
    let preview: {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    try {
      preview = await executeTrinoQuery(conn, sql, { limit });
    } catch (error) {
      return success(
        {
          project: projectPublic,
          changeSetId,
          modelName,
          upstream,
          defer: useDefer,
          deferSchema: useDefer ? deferSchema : undefined,
          steps: [useDefer ? 'dbt_run_defer' : 'dbt_run'],
          trino: publicTrinoInfo(conn),
          wroteRelation: `${conn.catalog}.${conn.schema}.${modelName}`,
          previewError: (error as Error).message,
          dbt: {
            stdoutTail: run.stdout.slice(-2000),
            stderrTail: run.stderr.slice(-2000),
            deferStatePath: run.deferStatePath,
          },
          hint: 'dbt run finished but Trino preview failed — relation may be ephemeral or not yet queryable.',
        },
        {
          warnings: [(error as Error).message],
        },
      );
    }

    return success({
      project: projectPublic,
      changeSetId,
      modelName,
      upstream,
      defer: useDefer,
      deferSchema: useDefer ? deferSchema : undefined,
      steps: [
        useDefer ? 'dbt_run_defer' : 'dbt_run',
        'trino_preview',
      ],
      trino: publicTrinoInfo(conn),
      wroteRelation: `${conn.catalog}.${conn.schema}.${modelName}`,
      sql: `${sql}\nLIMIT ${limit}`,
      columns: preview.columns,
      rows: preview.rows,
      rowCount: preview.rowCount,
      limit,
      dbt: {
        stdoutTail: run.stdout.slice(-2000),
        stderrTail: run.stderr.slice(-2000),
        deferStatePath: run.deferStatePath,
      },
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
