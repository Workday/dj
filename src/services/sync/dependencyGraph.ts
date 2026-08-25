/**
 * Dependency Graph Module
 *
 * This module handles the construction and analysis of the model dependency graph.
 * It provides functions to:
 * - Build a topologically sorted list of resources
 * - Group resources by dependency depth for parallel processing
 * - Efficiently resolve parent-child relationships
 */

import { frameworkGetPathJson } from '@services/framework/utils';
import type {
  DbtModel,
  DbtProject,
  DbtProjectManifestNode,
  DbtProjectManifestSource,
  DbtResourceType,
  DbtSeed,
  DbtSource,
} from '@shared/dbt/types';
import type { FrameworkModel } from '@shared/framework/types';
import * as path from 'path';

import type { DependencyLevel, SyncResource } from './types';

/**
 * Extracts the resource type from a resource ID
 * @example getResourceType("model.project.stg__users") => "model"
 */
export function getResourceType(resourceId: string): DbtResourceType {
  return resourceId.split('.')[0] as DbtResourceType;
}

/**
 * Extracts framework-level dependencies from a FrameworkModel JSON.
 * Returns model names that this model depends on (from.model, join.model, union.models, select.model).
 *
 * @param modelJson - The parsed FrameworkModel JSON
 * @returns Array of model names this model depends on
 */
export function extractFrameworkDependencies(
  modelJson: FrameworkModel,
): string[] {
  const dependencies = new Set<string>();

  // Extract base model dependency from 'from'
  if ('from' in modelJson && modelJson.from) {
    if ('model' in modelJson.from && modelJson.from.model) {
      dependencies.add(modelJson.from.model);
    }

    // Extract join dependencies
    if ('join' in modelJson.from && modelJson.from.join) {
      const joins = Array.isArray(modelJson.from.join)
        ? modelJson.from.join
        : [modelJson.from.join];

      for (const join of joins) {
        if ('model' in join && join.model) {
          dependencies.add(join.model);
        }
      }
    }

    // Extract union dependencies
    if ('union' in modelJson.from && modelJson.from.union) {
      if ('models' in modelJson.from.union && modelJson.from.union.models) {
        for (const model of modelJson.from.union.models) {
          dependencies.add(model);
        }
      }
    }
  }

  // Extract select dependencies (when selecting from a specific model)
  if ('select' in modelJson && modelJson.select) {
    for (const selected of modelJson.select) {
      if (
        typeof selected === 'object' &&
        'model' in selected &&
        selected.model
      ) {
        dependencies.add(selected.model);
      }
    }
  }

  // CTEs may reference external models via from, join, union, or select.
  // These are project-level dependencies needed for correct build ordering.
  if ('ctes' in modelJson && modelJson.ctes) {
    for (const cte of modelJson.ctes) {
      if (cte.from) {
        if ('model' in cte.from && cte.from.model) {
          dependencies.add(cte.from.model);
        }
        if ('join' in cte.from && cte.from.join) {
          const joins = Array.isArray(cte.from.join)
            ? cte.from.join
            : [cte.from.join];
          for (const join of joins) {
            if ('model' in join && join.model) {
              dependencies.add(join.model);
            }
          }
        }
        if ('union' in cte.from && cte.from.union) {
          if ('models' in cte.from.union && cte.from.union.models) {
            for (const model of cte.from.union.models) {
              dependencies.add(model);
            }
          }
        }
      }
      if (cte.select) {
        for (const selected of cte.select) {
          if (
            typeof selected === 'object' &&
            'model' in selected &&
            (selected as { model: string }).model
          ) {
            dependencies.add((selected as { model: string }).model);
          }
        }
      }
    }
  }

  // Authored forced refs (--depends_on comments) also affect sync order.
  if ('depends_on' in modelJson && modelJson.depends_on) {
    for (const modelName of modelJson.depends_on) {
      dependencies.add(modelName);
    }
  }

  return Array.from(dependencies);
}

/**
 * Gets manifest resources organized by type.
 * Extracts models, seeds, and sources from the project's manifest,
 * and computes full system paths for each resource.
 *
 * @param project - The dbt project with manifest
 * @returns Object with models, seeds, and sources records keyed by resource ID
 */
export function getManifestResources(project: DbtProject): {
  models: Record<string, DbtModel>;
  seeds: Record<string, DbtSeed>;
  sources: Record<string, DbtSource>;
} {
  const { manifest } = project;
  const resourcesByType: {
    models: Record<string, DbtModel>;
    seeds: Record<string, DbtSeed>;
    sources: Record<string, DbtSource>;
  } = { models: {}, seeds: {}, sources: {} };

  // Process nodes and sources together
  for (const [key, node] of Object.entries({
    ...manifest.nodes,
    ...manifest.sources,
  })) {
    if (!node) {
      continue;
    }

    // Compute paths from original_file_path
    const pathRelativeFile = node.original_file_path ?? '';
    const pathRelativeDirectory = path.dirname(pathRelativeFile);
    const pathSystemDirectory = path.join(
      project.pathSystem,
      pathRelativeDirectory,
    );
    const pathSystemFile = path.join(project.pathSystem, pathRelativeFile);

    const frameworkValues = {
      childMap: manifest.child_map?.[key] ?? [],
      parentMap: manifest.parent_map?.[key] ?? [],
      pathRelativeDirectory,
      pathSystemDirectory,
      pathSystemFile,
    };

    switch (node.resource_type) {
      case 'model':
        resourcesByType.models[key] = {
          ...(node as DbtProjectManifestNode),
          ...frameworkValues,
        };
        break;
      case 'seed':
        resourcesByType.seeds[key] = {
          ...(node as DbtProjectManifestNode),
          ...frameworkValues,
        };
        break;
      case 'source':
        resourcesByType.sources[key] = {
          ...(node as DbtProjectManifestSource),
          ...frameworkValues,
        };
        break;
    }
  }

  return resourcesByType;
}

/**
 * Builds a topologically sorted list of resources with dependency information
 *
 * This function:
 * 1. Starts with sources and seeds (no dependencies)
 * 2. Traverses the dependency graph using child_map
 * 3. Ensures parents are added before children
 * 4. Calculates dependency depth for each resource
 *
 * @param project - The dbt project with manifest
 * @param rootIds - Optional specific resource IDs to start from
 * @param frameworkDependencies - Optional map of resource ID to framework-level parent model names
 * @returns Array of SyncResource objects in topological order
 */
export function buildOrderedResources({
  project,
  rootIds,
  frameworkDependencies,
}: {
  project: DbtProject;
  rootIds?: string[];
  frameworkDependencies?: Map<string, string[]>;
}): SyncResource[] {
  const orderedResources: SyncResource[] = [];
  // Use Set for O(1) lookup instead of array.find()
  const addedIds = new Set<string>();
  let waitingIds: string[] = [];

  const { models, seeds, sources } = getManifestResources(project);

  // Helper to get a resource by ID
  function getResource(
    resourceId: string,
  ): DbtModel | DbtSeed | DbtSource | undefined {
    const resourceType = getResourceType(resourceId);
    switch (resourceType) {
      case 'model':
        return models[resourceId];
      case 'seed':
        return seeds[resourceId];
      case 'source':
        return sources[resourceId];
      default:
        return undefined;
    }
  }

  /**
   * Recursively calculates the dependency depth of a resource.
   *
   * Depth is defined as the maximum depth of all parents + 1.
   * Resources with no dependencies have depth 0.
   *
   * The depth cache prevents redundant calculations and handles cycles gracefully.
   *
   * @param resourceId - The resource ID to calculate depth for
   * @param depthCache - Memoization cache to store calculated depths
   * @returns The dependency depth of the resource
   */
  function calculateDepth(
    resourceId: string,
    depthCache: Map<string, number>,
  ): number {
    if (depthCache.has(resourceId)) {
      return depthCache.get(resourceId)!;
    }

    const resource = getResource(resourceId);

    // Combine manifest parents with framework-level dependencies
    let allParentIds = resource?.parentMap ?? [];

    // Add framework-level dependencies if available
    if (frameworkDependencies?.has(resourceId)) {
      const frameworkParents = frameworkDependencies.get(resourceId) ?? [];
      // Convert model names to resource IDs (model.projectName.modelName)
      const frameworkParentIds = frameworkParents.map(
        (modelName) => `model.${project.name}.${modelName}`,
      );
      // Combine and deduplicate
      allParentIds = Array.from(
        new Set([...allParentIds, ...frameworkParentIds]),
      );
    }

    if (!resource || allParentIds.length === 0) {
      depthCache.set(resourceId, 0);
      return 0;
    }

    const parentDepths = allParentIds
      .map((parentId) => calculateDepth(parentId, depthCache))
      .filter((d) => d >= 0);

    const depth = parentDepths.length > 0 ? Math.max(...parentDepths) + 1 : 0;
    depthCache.set(resourceId, depth);
    return depth;
  }

  // Add a resource to the ordered list
  function addResource(
    resourceId: string,
    depthCache: Map<string, number>,
    skipWaiting = false,
  ): boolean {
    // O(1) lookup with Set
    if (addedIds.has(resourceId)) {
      return true;
    }

    const resource = getResource(resourceId);
    if (!resource) {
      return false;
    }

    // Combine manifest parents with framework-level dependencies
    let allParentIds = resource.parentMap || [];

    // Add framework-level dependencies if available
    if (frameworkDependencies?.has(resourceId)) {
      const frameworkParents = frameworkDependencies.get(resourceId) ?? [];
      // Convert model names to resource IDs (model.projectName.modelName)
      const frameworkParentIds = frameworkParents.map(
        (modelName) => `model.${project.name}.${modelName}`,
      );
      // Combine and deduplicate
      allParentIds = Array.from(
        new Set([...allParentIds, ...frameworkParentIds]),
      );
    }

    // Check if all parents have been added (O(1) per parent with Set)
    const ready =
      allParentIds.length === 0 || allParentIds.every((id) => addedIds.has(id));

    if (ready || skipWaiting) {
      const resourceType = getResourceType(resourceId);
      const pathResource = resource.pathSystemFile || '';
      const pathJson = frameworkGetPathJson({
        pathResource,
        type: resourceType,
      });
      const depth = calculateDepth(resourceId, depthCache);

      orderedResources.push({
        id: resourceId,
        pathJson,
        pathResource,
        type: resourceType,
        parentIds: allParentIds,
        depth,
      });

      addedIds.add(resourceId);

      // Remove from waiting list if present
      const waitingIndex = waitingIds.indexOf(resourceId);
      if (waitingIndex >= 0) {
        waitingIds = [
          ...waitingIds.slice(0, waitingIndex),
          ...waitingIds.slice(waitingIndex + 1),
        ];
      }

      return true;
    } else {
      // Add to waiting list if not already there
      if (!waitingIds.includes(resourceId)) {
        waitingIds.push(resourceId);
      }
      return false;
    }
  }

  // Recursively traverse children
  function addChildren(
    resourceIds: string[],
    depthCache: Map<string, number>,
    skipWaiting = false,
  ): void {
    for (const resourceId of resourceIds) {
      const proceed = addResource(resourceId, depthCache, skipWaiting);
      if (!proceed) {
        continue;
      }

      const resource = getResource(resourceId);
      if (!resource) {
        continue;
      }

      // Only process model children
      const resourceChildren = resource.childMap
        .filter((id) => getResourceType(id) === 'model')
        .sort();

      addChildren(resourceChildren, depthCache, skipWaiting);
    }
  }

  // Initialize depth cache
  const depthCache = new Map<string, number>();

  // Initialize root IDs if not provided
  if (!rootIds || rootIds.length === 0) {
    rootIds = [];

    // Add seeds as roots
    for (const [seedId, seed] of Object.entries(seeds)) {
      const pathResource = seed.pathSystemFile;
      const pathJson = pathResource.replace(/\.csv$/, '.seed.json');
      rootIds.push(seedId);
      orderedResources.push({
        id: seedId,
        pathJson,
        pathResource,
        type: 'seed',
        parentIds: [],
        depth: 0,
      });
      addedIds.add(seedId);
      depthCache.set(seedId, 0);
    }

    // Add sources as roots
    for (const [sourceId, source] of Object.entries(sources)) {
      const pathResource = source.pathSystemFile;
      const pathJson = pathResource.replace(
        /(?:\.yml|\.yaml)$/,
        '.source.json',
      );
      rootIds.push(sourceId);
      orderedResources.push({
        id: sourceId,
        pathJson,
        pathResource,
        type: 'source',
        parentIds: [],
        depth: 0,
      });
      addedIds.add(sourceId);
      depthCache.set(sourceId, 0);
    }
  }

  // Sort roots alphabetically for consistent ordering
  rootIds.sort();
  orderedResources.sort((a, b) => (a.id > b.id ? 1 : -1));

  // Traverse from roots
  addChildren(rootIds, depthCache);

  // Handle any waiting resources that couldn't be added due to missing parents
  if (waitingIds.length > 0) {
    addChildren(waitingIds, depthCache, true);
  }

  return orderedResources;
}

/**
 * Groups resources by their dependency depth for parallel processing
 *
 * Resources at the same depth have no interdependencies and can be
 * processed in parallel. Processing must proceed level by level
 * (all depth 0, then all depth 1, etc.) to ensure parents are
 * processed before children.
 *
 * @param resources - Topologically sorted resources with depth information
 * @returns Array of DependencyLevel objects, sorted by depth
 */
export function groupByDependencyLevel(
  resources: SyncResource[],
): DependencyLevel[] {
  const levelMap = new Map<number, SyncResource[]>();

  // Group resources by depth
  for (const resource of resources) {
    const existing = levelMap.get(resource.depth) ?? [];
    existing.push(resource);
    levelMap.set(resource.depth, existing);
  }

  // Convert to sorted array of DependencyLevel objects
  const levels: DependencyLevel[] = [];
  const sortedDepths = Array.from(levelMap.keys()).sort((a, b) => a - b);

  for (const depth of sortedDepths) {
    levels.push({
      depth,
      resources: levelMap.get(depth) ?? [],
    });
  }

  return levels;
}

/**
 * Calculates statistics about the dependency graph
 */
export function getDependencyStats(levels: DependencyLevel[]): {
  totalResources: number;
  maxDepth: number;
  maxParallelism: number;
  avgParallelism: number;
} {
  const totalResources = levels.reduce((sum, l) => sum + l.resources.length, 0);
  const maxDepth = levels.length > 0 ? levels[levels.length - 1].depth : 0;
  const maxParallelism = Math.max(...levels.map((l) => l.resources.length), 0);
  const avgParallelism = levels.length > 0 ? totalResources / levels.length : 0;

  return {
    totalResources,
    maxDepth,
    maxParallelism,
    avgParallelism: Math.round(avgParallelism * 10) / 10,
  };
}
