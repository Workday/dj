import { frameworkGetModelName } from '@services/framework/utils';
import type { FrameworkModel, FrameworkSource } from '@shared/framework/types';
import { resolveTrinoConnection } from '../trino/resolve';
import { failure, success, type ProjectSelector } from '../response';
import { createModel } from './create-model';
import { createSource } from './create-source';
import { getLineage } from './get-lineage';
import { previewData } from './preview-data';

type ModelCreateSpec = Record<string, unknown> & {
  type: FrameworkModel['type'];
  group: string;
  name: string;
  topic: string;
  description?: string;
};

/**
 * End-to-end create from a requirement:
 * optional source + model in an isolated change set, with preview + lineage.
 * Optionally sample live rows via Trino when includeData is true.
 * Publish separately via dj_publish_change after user approval.
 */
export async function createE2e(
  args: ProjectSelector & {
    requirement: string;
    model?: ModelCreateSpec;
    source?: FrameworkSource;
    overwrite?: boolean;
    includePreview?: boolean;
    includeLineage?: boolean;
    includeData?: boolean;
    dataMode?: 'compile' | 'run';
    dataLimit?: number;
  },
) {
  try {
    if (!args.requirement?.trim()) {
      return failure(['requirement is required']);
    }
    if (!args.model && !args.source) {
      return failure([
        'Provide model and/or source. Interpret the requirement into DJ JSON specs first (type/group/topic/name/from/select for models; database/schema/tables for sources).',
      ]);
    }

    const selector = {
      projectId: args.projectId,
      localPath: args.localPath,
      workspaceRoot: args.workspaceRoot,
      projectPath: args.projectPath,
      projectName: args.projectName,
      previewOnly: args.previewOnly !== false,
    };

    const steps: string[] = [];
    const created: { source?: unknown; model?: unknown } = {};
    const warnings: string[] = [];
    let changeSetId: string | undefined;
    let changedFiles: string[] | undefined;
    let project: unknown;
    let models: unknown;

    if (args.source) {
      const sourceResult = await createSource({
        ...selector,
        source: args.source,
        overwrite: args.overwrite,
        generateYml: true,
      });
      if (!sourceResult.ok) {
        return failure(sourceResult.errors ?? ['Source create failed'], {
          data: { steps, requirement: args.requirement },
        });
      }
      steps.push('create_source');
      created.source = sourceResult.data;
      changeSetId =
        (sourceResult.data as { changeSetId?: string })?.changeSetId ??
        changeSetId;
      if (sourceResult.warnings?.length) {
        warnings.push(...sourceResult.warnings);
      }
    }

    let modelName: string | undefined;
    let preview: unknown;
    let validation: unknown;
    let dataPreview: unknown;

    if (args.model) {
      const modelSpec: ModelCreateSpec = {
        ...args.model,
        description: args.model.description?.trim() || args.requirement.trim(),
      };

      const modelResult = await createModel({
        ...selector,
        model: modelSpec,
        overwrite: args.overwrite,
      });
      if (!modelResult.ok) {
        return failure(modelResult.errors ?? ['Model create failed'], {
          data: { steps, created, requirement: args.requirement },
          warnings: warnings.length ? warnings : undefined,
        });
      }
      steps.push('create_model');
      created.model = modelResult.data;
      const data = modelResult.data as {
        changeSetId?: string;
        changedFiles?: string[];
        project?: unknown;
        models?: unknown;
        modelJson?: FrameworkModel;
        artifacts?: { sql?: string; yml?: string };
        validation?: unknown;
      };
      changeSetId = data.changeSetId ?? changeSetId;
      changedFiles = data.changedFiles;
      project = data.project;
      models = data.models;
      validation = data.validation;
      preview =
        args.includePreview === false
          ? undefined
          : {
              sql: data.artifacts?.sql,
              yml: data.artifacts?.yml,
            };
      modelName =
        frameworkGetModelName(data.modelJson ?? modelSpec) || undefined;
      steps.push('preview_model');
    }

    let lineage: unknown;
    if (
      args.includeLineage !== false &&
      modelName &&
      (args.projectId || args.localPath || args.projectPath || args.projectName)
    ) {
      const lineageResult = await getLineage({
        projectId: args.projectId,
        localPath: args.localPath,
        workspaceRoot: args.workspaceRoot,
        projectPath: args.projectPath,
        projectName: args.projectName,
        modelName,
        upstreamLevels: 5,
        downstreamLevels: 5,
      });
      steps.push('get_lineage');
      if (lineageResult.ok) {
        lineage = lineageResult.data;
      } else {
        warnings.push(
          ...(lineageResult.errors ?? ['Lineage failed']).map(
            (e) => `lineage: ${e}`,
          ),
        );
      }
    }

    const trino = resolveTrinoConnection(args.projectId);
    if (args.includeData && modelName && changeSetId) {
      if (!trino.enabled || !trino.host) {
        warnings.push(
          'includeData requested but Trino is not configured (set trino.host in DJ_MCP_CONFIG).',
        );
      } else {
        const dataResult = await previewData({
          projectId: args.projectId,
          changeSetId,
          modelName,
          mode: args.dataMode ?? trino.previewMode,
          limit: args.dataLimit ?? trino.defaultLimit,
        });
        steps.push('preview_data');
        if (dataResult.ok) {
          dataPreview = dataResult.data;
        } else {
          warnings.push(
            ...(dataResult.errors ?? ['preview_data failed']).map(
              (e) => `preview_data: ${e}`,
            ),
          );
        }
      }
    }

    const next =
      changeSetId && trino.enabled && trino.host && !args.includeData
        ? `Optional live rows: dj_preview_data({ changeSetId: "${changeSetId}", modelName: "${modelName ?? ''}", mode: "compile" }). Then dj_publish_change({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
        : changeSetId
          ? `After review: dj_publish_change({ changeSetId: "${changeSetId}", approval: true, commitMessage: "..." })`
          : undefined;

    return success(
      {
        requirement: args.requirement,
        status: changeSetId ? 'awaiting_approval' : 'written',
        changeSetId,
        steps,
        created,
        validation,
        preview,
        dataPreview,
        lineage,
        modelName,
        project,
        changedFiles,
        models,
        trinoConfigured: Boolean(trino.enabled && trino.host),
        next,
      },
      {
        warnings: warnings.length ? warnings : undefined,
      },
    );
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
