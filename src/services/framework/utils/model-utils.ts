/**
 * Model utility functions for Framework
 *
 * Functions for working with framework model metadata, IDs, names, and references.
 * These are pure utility functions with no dependencies on other util modules.
 */

import type {
  DbtProject,
  DbtProjectManifestNode,
  DbtProjectManifestSource,
  DbtResourceType,
} from '@shared/dbt/types';
import { getDbtModelId } from '@shared/dbt/utils';
import type { FrameworkCTE, FrameworkModel } from '@shared/framework/types';
import * as _ from 'lodash';
import * as path from 'path';

import { frameworkGetSourceMeta } from './source-utils';

/**
 * Get the unique ID for a framework model
 *
 * @param modelJson - The framework model JSON
 * @param project - The DBT project
 * @returns The model ID (e.g., "model.project.model_name") or null if not found
 *
 * @example
 * ```typescript
 * const modelId = frameworkGetModelId({ modelJson, project });
 * // Returns: "model.my_project.stg_users"
 * ```
 */
export function frameworkGetModelId({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): string | null {
  const modelName = frameworkGetModelName(modelJson);
  const modelId = getDbtModelId({ modelName, projectName: project.name });
  return modelId;
}

/**
 * Get the name of a framework model
 *
 * @param modelJson - The framework model JSON
 * @returns The model name
 *
 * @example
 * ```typescript
 * const name = frameworkGetModelName(modelJson);
 * // Returns: "stg_users"
 * ```
 */
export function frameworkGetModelName(
  modelJson: Pick<FrameworkModel, 'name' | 'group' | 'topic' | 'type'>,
): string {
  const modelLayer = frameworkGetModelLayer(modelJson);
  return modelLayer && modelJson.group && modelJson.topic && modelJson.name
    ? `${modelLayer}__${modelJson.group}__${modelJson.topic.replaceAll('/', '__')}__${modelJson.name}`
    : '';
}

/**
 * Extract the model name from a full model identifier.
 * This is the inverse of frameworkGetModelName.
 *
 * Format: layer__group__topic__name (where name may contain __)
 * - First 3 __ delimiters separate structural parts (layer, group, topic)
 * - Everything after the 3rd __ is the model name
 *
 * @param fullModelName - e.g., "stg__sales__billing__my__data"
 * @returns The name portion - e.g., "my__data"
 * @example
 * frameworkExtractModelName("stg__sales__billing__accounts_daily") // "accounts_daily"
 * frameworkExtractModelName("stg__sales__billing__my__complex__name") // "my__complex__name"
 */
export function frameworkExtractModelName(fullModelName: string): string {
  const parts = fullModelName.split('__');
  // First 3 parts are layer, group, topic. Everything else is name.
  return parts.length >= 4 ? parts.slice(3).join('__') : fullModelName;
}

/**
 * Get the prefix for a framework model
 *
 * @param modelJson - The framework model JSON
 * @returns The model prefix (stg, int, mart, etc.)
 *
 * @example
 * ```typescript
 * const prefix = frameworkGetModelPrefix({ modelJson });
 * // Returns: "stg"
 * ```
 */
export function frameworkGetModelPrefix({
  modelJson,
  project,
}: {
  modelJson: Pick<FrameworkModel, 'group' | 'name' | 'topic' | 'type'>;
  project: DbtProject;
}): string | null {
  const modelLayer = frameworkGetModelLayer(modelJson);
  const modelName = frameworkGetModelName(modelJson);
  if (!modelName) {
    return null;
  }
  let modelPath = path.join(
    project.pathSystem,
    project.modelPaths[0] ?? 'models',
  );
  switch (modelLayer) {
    case 'int': {
      modelPath = path.join(modelPath, 'intermediate');
      break;
    }
    case 'mart': {
      modelPath = path.join(modelPath, 'marts');
      break;
    }
    case 'stg': {
      modelPath = path.join(modelPath, 'staging');
      break;
    }
  }
  modelPath = path.join(modelPath, modelJson.group);
  if (modelJson.topic) {
    modelPath = path.join(modelPath, modelJson.topic);
  }
  return path.join(modelPath, modelName);
}

/**
 * Get the layer of a framework model (stg, int, or mart)
 *
 * @param modelJson - The framework model JSON (only type field needed)
 * @returns The model layer
 *
 * @example
 * ```typescript
 * const layer = frameworkGetModelLayer(modelJson);
 * // Returns: "stg" | "int" | "mart"
 * ```
 */
export function frameworkGetModelLayer(
  modelJson: Pick<FrameworkModel, 'type'>,
): 'stg' | 'int' | 'mart' {
  return modelJson.type.split('_')[0] as 'stg' | 'int' | 'mart';
}

/**
 * Get a manifest node (model or seed) from the DBT project
 *
 * @param payload - Project and model/source identifier
 * @returns The manifest node or null if not found
 *
 * @example
 * ```typescript
 * const node = frameworkGetNode({ project, model: "stg_users" });
 * // Returns: ManifestNode | null
 * ```
 */
export function frameworkGetNode(
  payload: {
    project: DbtProject;
  } & ({ model: string } | { source: string }),
): Partial<DbtProjectManifestNode | DbtProjectManifestSource> | null {
  const { project } = payload;
  if ('model' in payload) {
    // May be either model node or seed node
    const modelNode =
      project.manifest.nodes?.[`model.${project.name}.${payload.model}`] ??
      project.manifest.nodes?.[`seed.${project.name}.${payload.model}`];
    return modelNode ?? null;
  }
  if ('source' in payload) {
    const sourceId = frameworkGetSourceId({ ...payload });
    return project.manifest.sources?.[sourceId] ?? null;
  }
  return null;
}

// Helper function for source ID (will be moved to source-utils later)
function frameworkGetSourceId({
  project,
  source,
}: {
  project: DbtProject;
  source: string;
}): string {
  const [sourceName, ...tableName] = source.split('.');
  return `source.${project.name}.${sourceName}.${tableName.join('.')}`;
}

/**
 * Get model metadata from framework model JSON
 *
 * @param project - The DBT project
 * @param model - The model name
 * @returns The model metadata
 */
export function frameworkGetModelMeta({
  project,
  model,
}: {
  project: DbtProject;
  model: string;
}): unknown {
  const modelId = `model.${project.name}.${model}`;
  return project.manifest.nodes?.[modelId]?.meta ?? null;
}

/**
 * Trace a CTE chain back to the root model or source reference.
 * Walks the `ctes` array starting from `cteName`, following `from.cte`
 * references until a concrete `from.model` or `from.source` is found.
 * Returns `null` if the chain cannot be resolved (e.g. circular or missing).
 */
export function resolveCteRootFrom(
  cteName: string,
  ctes: FrameworkCTE[],
): { model: string } | { source: string } | null {
  const cteMap = new Map(ctes.map((c) => [c.name, c]));
  const visited = new Set<string>();
  let current = cteName;

  while (current) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    const cte = cteMap.get(current);
    if (!cte) {
      return null;
    }

    if ('model' in cte.from && cte.from.model) {
      return { model: cte.from.model };
    }
    if ('source' in cte.from && (cte.from as { source: string }).source) {
      return { source: (cte.from as { source: string }).source };
    }
    if ('cte' in cte.from && cte.from.cte) {
      current = cte.from.cte;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Get parent node metadata
 *
 * @param modelJson - The framework model JSON
 * @param project - The DBT project
 * @returns The parent node metadata or null
 */
export function frameworkGetParentMeta({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): unknown {
  if ('cte' in modelJson.from) {
    if ('ctes' in modelJson && modelJson.ctes?.length) {
      const rootFrom = resolveCteRootFrom(modelJson.from.cte, modelJson.ctes);
      if (rootFrom) {
        if ('source' in rootFrom) {
          return frameworkGetSourceMeta({ project, ...rootFrom });
        }
        return frameworkGetModelMeta({ project, ...rootFrom });
      }
    }
    return null;
  }
  if ('source' in modelJson.from) {
    return frameworkGetSourceMeta({ project, ...modelJson.from });
  } else {
    return frameworkGetModelMeta({ project, ...modelJson.from });
  }
}

/**
 * Get a single parent node
 *
 * @param modelJson - The framework model JSON
 * @param project - The DBT project
 * @returns The parent manifest node or null
 */
export function frameworkGetParentNode({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): Partial<DbtProjectManifestNode | DbtProjectManifestSource> | null {
  if ('from' in modelJson && !('cte' in modelJson.from)) {
    const baseNode = frameworkGetNode({ project, ...modelJson.from });
    return baseNode;
  }
  return null;
}

/**
 * Get all parent nodes for a model
 *
 * @param modelJson - The framework model JSON
 * @param project - The DBT project
 * @returns Array of parent manifest nodes
 */
export function frameworkGetParentNodes({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): Array<Partial<DbtProjectManifestNode | DbtProjectManifestSource>> {
  const parentNodes: Array<
    Partial<DbtProjectManifestNode | DbtProjectManifestSource>
  > = [];
  if (!('from' in modelJson && modelJson.from)) {
    return parentNodes;
  }
  if (!('cte' in modelJson.from)) {
    const baseNode = frameworkGetNode({ project, ...modelJson.from });
    if (baseNode) {
      parentNodes.push(baseNode);
    }
  }

  if ('join' in modelJson.from && modelJson.type !== 'int_join_column') {
    for (const join of modelJson.from.join ?? []) {
      if ('cte' in join) {
        continue;
      }
      const joinNode = frameworkGetNode({ project, ...join });
      if (joinNode) {
        parentNodes.push(joinNode);
      }
    }
  }

  if ('union' in modelJson.from) {
    if ('models' in modelJson.from.union) {
      for (const model of modelJson.from.union.models ?? []) {
        const unionNode = frameworkGetNode({ project, model });
        if (unionNode) {
          parentNodes.push(unionNode);
        }
      }
    } else if ('sources' in modelJson.from.union) {
      for (const source of modelJson.from.union.sources ?? []) {
        const unionNode = frameworkGetNode({ project, source });
        if (unionNode) {
          parentNodes.push(unionNode);
        }
      }
    }
  }

  return parentNodes;
}

/**
 * Get the child map for a model
 *
 * @param project - The DBT project
 * @param modelName - The model name
 * @returns Array of child model IDs
 */
export function frameworkGetModelChildMap({
  project,
  modelName,
}: {
  modelName: string;
  project: DbtProject;
}): string[] {
  const modelId = `model.${project.name}.${modelName}`;
  if (!modelId) {
    return [];
  }
  return project.manifest.child_map?.[modelId] ?? [];
}

/**
 * Build tags for a framework model
 *
 * @param modelJson - The framework model JSON
 * @param project - The DBT project
 * @returns Object containing different types of tags
 */
export function frameworkBuildModelTags({
  modelJson,
  project,
}: {
  modelJson: FrameworkModel;
  project: DbtProject;
}): {
  aiHints: string[];
  local: string[];
  model: string[];
} {
  const modelLayer = frameworkGetModelLayer(modelJson);
  const tagsAiHints = [];
  const tagsExclude = [];
  const tagsDefault = ['json'];
  const tagsInherited: string[] = [];
  const tagsLocal: string[] = [];
  const tagsNew: string[] = [];
  const parentNodes = frameworkGetParentNodes({ modelJson, project });

  switch (modelLayer) {
    case 'stg': {
      tagsDefault.push('staging');
      tagsExclude.push('intermediate');
      tagsExclude.push('lightdash');
      tagsExclude.push('lightdash-explore');
      tagsExclude.push('mart');
      break;
    }
    case 'int': {
      tagsDefault.push('intermediate');
      tagsExclude.push('lightdash');
      tagsExclude.push('lightdash-explore');
      tagsExclude.push('staging');
      tagsExclude.push('mart');
      break;
    }
    case 'mart': {
      tagsDefault.push('mart');
      tagsExclude.push('staging');
      tagsExclude.push('intermediate');
      break;
    }
  }

  for (const node of parentNodes) {
    const nodeTags = node?.tags ?? [];
    const nodeLocalTags = node?.meta?.local_tags ?? [];
    tagsInherited.push(
      ..._.union(
        tagsInherited,
        _.difference(nodeTags, nodeLocalTags, tagsExclude),
      ),
    );
  }

  if ('tags' in modelJson) {
    for (const t of modelJson.tags ?? []) {
      if (typeof t === 'string') {
        tagsNew.push(t);
      } else {
        switch (t.type) {
          case 'ai_hints': {
            tagsAiHints.push(t.tag);
            break;
          }
          case 'exclude': {
            tagsExclude.push(t.tag);
            break;
          }
          case 'local': {
            tagsLocal.push(t.tag);
            tagsNew.push(t.tag);
            break;
          }
          default: {
            tagsNew.push(t.tag);
            break;
          }
        }
      }
    }
  }

  // Combine all the tags for the model
  let tagsModel = _.union(tagsDefault, tagsInherited, tagsNew);
  // Remove any tags that are excluded
  tagsModel = _.difference(tagsModel, tagsExclude);

  tagsAiHints.sort();
  tagsLocal.sort();
  tagsModel.sort();

  return {
    aiHints: tagsAiHints,
    local: tagsLocal,
    model: tagsModel,
  };
}

/**
 * Generate a framework model name from components
 *
 * @param group - The model group
 * @param topic - The model topic
 * @param type - The model type
 * @returns The generated model name
 */
export function frameworkMakeModelName({
  group,
  topic,
  type,
}: {
  group: string;
  topic: string;
  type: string;
}): string {
  const modelLayer = type.split('_')[0];
  return `${modelLayer}__${group}__${topic.replaceAll('/', '__')}`;
}

/**
 * Get path to JSON file
 */
export function frameworkGetPathJson({
  pathResource,
  type,
}: {
  pathResource: string;
  type: DbtResourceType;
}): string {
  return pathResource.replace(/\.(?:csv|sql|yaml|yml)$/, `.${type}.json`);
}

/**
 * Get a macro from the project
 */
export function frameworkGetMacro({
  macro,
  project,
}: {
  macro: string;
  project: DbtProject;
}) {
  return project.manifest.macros[`macro.${project.name}.${macro}`] ?? null;
}
