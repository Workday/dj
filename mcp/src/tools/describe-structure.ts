import { frameworkGetModelName } from '@services/framework/utils';
import { jsonParse } from '@shared';
import type { FrameworkModel } from '@shared/framework/types';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { resolveActiveProject, toPublicProject } from '../projects/registry';
import { failure, success, type ProjectSelector } from '../response';

/**
 * Describe DJ folder conventions and existing groups/topics for the active project.
 */
export async function describeStructure(
  args: ProjectSelector & { suggestion?: string } = {},
) {
  try {
    const ctx = await resolveActiveProject(args);
    const modelRoot = path.join(ctx.projectPath, 'models');
    const files = await glob('**/*.model.json', {
      cwd: modelRoot,
      absolute: true,
      nodir: true,
      ignore: ['**/target/**', '**/dbt_packages/**'],
    });

    const groups = new Set<string>();
    const topics = new Set<string>();
    const layers = new Set<string>();
    const samples: Array<Record<string, unknown>> = [];

    for (const file of files) {
      try {
        const modelJson = jsonParse(
          fs.readFileSync(file, 'utf8'),
        ) as FrameworkModel;
        if (modelJson.group) {
          groups.add(String(modelJson.group));
        }
        if (modelJson.topic) {
          topics.add(String(modelJson.topic));
        }
        if (modelJson.type) {
          layers.add(String(modelJson.type).split('_')[0]);
        }
        if (samples.length < 8) {
          samples.push({
            name: frameworkGetModelName(modelJson),
            type: modelJson.type,
            group: modelJson.group,
            topic: modelJson.topic,
            relativePath: path
              .relative(ctx.projectPath, file)
              .split(path.sep)
              .join('/'),
          });
        }
      } catch {
        // skip invalid
      }
    }

    const suggestion = args.suggestion?.trim();
    let suggested: Record<string, string> | undefined;
    if (suggestion) {
      const tokens = suggestion
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const group = tokens[0] ?? 'general';
      const topic = tokens.slice(1).join('_') || 'metrics';
      suggested = {
        group,
        topic,
        examplePath: `models/intermediate/${group}/${topic}/int__${group}__${topic}__<name>.model.json`,
        exampleType: 'int_select_model',
      };
    }

    return success({
      project: toPublicProject(ctx),
      conventions: {
        pathPattern:
          'models/{staging|intermediate|marts}/{group}/{topic}/{layer}__{group}__{topic}__{name}.{model.json,sql,yml}',
        layers: {
          stg: 'staging',
          int: 'intermediate',
          mart: 'marts',
        },
        notes: [
          'Pick type by layer (stg_select_source, int_select_model, mart_select_model, …).',
          'group/topic become folder segments and part of the model filename.',
        ],
      },
      existing: {
        groups: [...groups].sort(),
        topics: [...topics].sort(),
        layers: [...layers].sort(),
        sampleModels: samples,
        modelCount: files.length,
      },
      suggested,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
