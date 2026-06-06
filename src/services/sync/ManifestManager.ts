/**
 * Manifest Manager Module
 *
 * Handles manifest freshness checking and new resource handling.
 *
 * Responsibilities:
 * - Check if manifest is current based on file changes
 * - Create SyncResource entries for new roots not in manifest
 */

import { jsonParse } from '@shared';
import type { DbtProject, DbtProjectManifest } from '@shared/dbt/types';
import type { FrameworkModel } from '@shared/framework/types';
import * as vscode from 'vscode';

import { extractFrameworkDependencies } from './dependencyGraph';
import type { ResourceProcessingResult, SyncResource, SyncRoot } from './types';

/**
 * Freshness check result indicating whether manifest needs reparsing.
 */
export interface ManifestFreshnessResult {
  /** Whether the manifest is considered current */
  isFresh: boolean;
  /** Reason for the freshness determination */
  reason: string;
}

/**
 * ManifestManager handles manifest freshness checking and new resource creation.
 *
 * The manifest is considered "fresh" if:
 * 1. It exists
 * 2. It was generated after the last file change
 * 3. At least 30 seconds have passed since the last file change
 *
 * When syncing specific roots that aren't in the manifest yet (newly created),
 * this class creates temporary SyncResource entries for them.
 *
 * @example
 * ```typescript
 * const manager = new ManifestManager();
 *
 * // Check freshness
 * const freshness = manager.checkFreshness({
 *   manifest,
 *   lastFileChange,
 *   hasRoots: roots?.length > 0,
 * });
 *
 * if (!freshness.isFresh) {
 *   manifest = await parseManifest(project);
 * }
 *
 * // Create resources for new roots
 * const newResources = await manager.createResourcesForNewRoots({
 *   roots,
 *   project,
 * });
 * ```
 */
export class ManifestManager {
  /** Minimum time (ms) since last file change before manifest is considered fresh */
  private static readonly FRESHNESS_THRESHOLD_MS = 30000;

  /**
   * When a targeted sync contains more roots than this, treat the
   * freshness check as if it were a full sync (allow reparse).
   */
  static readonly BULK_ROOT_THRESHOLD = 5;

  /**
   * Check if the manifest is fresh enough to use without reparsing.
   *
   * The manifest is considered fresh if:
   * 1. We're syncing specific roots (not a full sync)
   * 2. OR the manifest was generated after the last file change
   *    AND at least 30 seconds have passed since the last change
   *
   * @param params - Freshness check parameters
   * @returns Freshness result with reason
   */
  checkFreshness(params: {
    manifest: DbtProjectManifest | null;
    lastFileChange: Date | null;
    hasRoots: boolean;
    rootCount?: number;
    forceReparse?: boolean;
  }): ManifestFreshnessResult {
    const { manifest, lastFileChange, hasRoots, rootCount, forceReparse } =
      params;

    // No manifest - definitely not fresh
    if (!manifest) {
      return {
        isFresh: false,
        reason: 'No manifest exists',
      };
    }

    // If forced (e.g., previous sync had renames), always reparse
    // to ensure the manifest reflects the latest file renames on disk.
    if (forceReparse) {
      return {
        isFresh: false,
        reason: 'Forced reparse after previous rename sync',
      };
    }

    // Small targeted syncs can reuse the existing manifest.
    // Large targeted syncs (bulk changes) fall through to the
    // same freshness checks as a full sync.
    const isBulkRoots =
      rootCount !== undefined &&
      rootCount > ManifestManager.BULK_ROOT_THRESHOLD;
    if (hasRoots && !isBulkRoots) {
      return {
        isFresh: true,
        reason: 'Using existing manifest for specific roots',
      };
    }

    // Check manifest generation time
    const generatedAt = manifest.metadata?.generated_at
      ? new Date(manifest.metadata.generated_at)
      : null;

    if (!generatedAt) {
      return {
        isFresh: false,
        reason: 'Manifest has no generation timestamp',
      };
    }

    // No file changes recorded - manifest is fresh
    if (!lastFileChange) {
      return {
        isFresh: true,
        reason: 'No file changes recorded since manifest generation',
      };
    }

    // Check if manifest was generated after last file change
    const manifestAfterChange =
      generatedAt.getTime() > lastFileChange.getTime();

    // Check if enough time has passed since last change
    const timeSinceChange = Date.now() - lastFileChange.getTime();
    const enoughTimePassed =
      timeSinceChange > ManifestManager.FRESHNESS_THRESHOLD_MS;

    if (manifestAfterChange && enoughTimePassed) {
      return {
        isFresh: true,
        reason: 'Manifest generated after last file change',
      };
    }

    return {
      isFresh: false,
      reason: manifestAfterChange
        ? 'Recent file changes detected, waiting for stabilization'
        : 'Manifest is older than last file change',
    };
  }

  /**
   * Determine if manifest should be reparsed after sync and the reparsing strategy.
   *
   * The decision is based on what changed during the sync:
   * - If renames occurred: Blocking reparse (await to ensure consistency)
   * - If resources were processed: Background reparse (non-blocking optimization)
   * - If nothing changed: No reparse needed
   *
   * @param result - Sync result containing statistics and changes
   * @returns Decision about whether and how to reparse
   */
  shouldReparseAfterSync(result: {
    renames: unknown[];
    stats: { processedResources: number };
  }): {
    shouldReparse: boolean;
    blocking: boolean;
    reason: string;
  } {
    // If model renames occurred, we need to reparse immediately
    if (result.renames.length > 0) {
      return {
        shouldReparse: true,
        blocking: true,
        reason:
          'Model renames require immediate manifest refresh for consistency',
      };
    }

    // If resources were processed, request background reparse
    if (result.stats.processedResources > 0) {
      return {
        shouldReparse: true,
        blocking: false,
        reason: 'Background refresh after resource changes',
      };
    }

    // No changes - no need to reparse
    return {
      shouldReparse: false,
      blocking: false,
      reason: 'No resources processed',
    };
  }

  /**
   * Create SyncResource entries for roots that aren't in the manifest.
   *
   * This handles newly created models/sources that haven't been parsed yet.
   * Uses framework-level dependencies to calculate accurate depth.
   *
   * @param params - Creation parameters
   * @param params.roots - Root resources to check
   * @param params.project - Current dbt project
   * @param params.frameworkDependencies - Map of resource ID to framework parent model names
   * @returns Array of SyncResource entries for new roots
   */
  async createResourcesForNewRoots(params: {
    roots: SyncRoot[];
    project: DbtProject;
    frameworkDependencies?: Map<string, string[]>;
  }): Promise<SyncResource[]> {
    const { roots, project } = params;
    const resources: SyncResource[] = [];

    for (const root of roots) {
      const rootParts = root.id.split('.');
      const [resourceType, projectName] = rootParts;

      // Only process roots for this project
      if (project.name !== projectName) {
        continue;
      }

      switch (resourceType) {
        case 'model': {
          const pathJson = root.pathJson;
          if (pathJson) {
            // Read the model file to get the name and dependencies
            try {
              const modelUri = vscode.Uri.file(pathJson);
              const modelFile = (
                await vscode.workspace.fs.readFile(modelUri)
              ).toString();
              const modelJson = jsonParse(modelFile) as FrameworkModel;

              // Extract framework dependencies to determine parent IDs
              const dependencies = extractFrameworkDependencies(modelJson);
              const parentIds = dependencies.map(
                (depModelName) => `model.${project.name}.${depModelName}`,
              );

              // Calculate depth based on framework dependencies
              // For new resources, we use a simple heuristic:
              // - If no dependencies: depth 0
              // - If has dependencies: depth 1 (will be recalculated by buildOrderedResources)
              const depth = parentIds.length > 0 ? 1 : 0;

              resources.push({
                id: root.id,
                pathJson,
                pathResource: pathJson.replace(/\.model\.json$/, '.sql'),
                type: 'model',
                parentIds,
                depth,
              });
            } catch {
              // File might not exist or be readable - skip
            }
          }
          break;
        }

        case 'source': {
          const pathJson = root.pathJson;
          if (pathJson) {
            resources.push({
              id: root.id,
              pathJson,
              pathResource: pathJson.replace(/\.source\.json$/, '.yml'),
              type: 'source',
              parentIds: [], // Sources have no parents
              depth: 0, // Sources are at depth 0
            });
          }
          break;
        }
      }
    }

    return resources;
  }

  /**
   * Determine if manifest should be reparsed.
   *
   * @param params - Check parameters
   * @returns true if manifest should be reparsed
   */
  shouldReparse(params: {
    manifest: DbtProjectManifest | null;
    lastFileChange: Date | null;
    hasRoots: boolean;
    rootCount?: number;
    forceReparse?: boolean;
  }): boolean {
    const freshness = this.checkFreshness(params);
    return !freshness.isFresh;
  }

  /**
   * Merges a resource update into the project manifest using granular updates.
   *
   * This method implements a granular update strategy to prevent race conditions
   * during parallel processing. Instead of overwriting entire manifest sections
   * (nodes/sources), it updates only the specific entries that changed.
   *
   * Why granular updates are necessary:
   * - During parallel processing within a dependency level, multiple resources
   *   are processed concurrently with the same initial manifest state
   * - If we spread entire nodes/sources objects, later results overwrite earlier
   *   ones with stale data, losing metadata enrichment from previous updates
   * - Granular updates ensure each resource's manifest entry is preserved
   *
   * @param project - Current project with accumulated manifest state
   * @param result - Processing result containing updated manifest for one resource
   * @returns Updated project with the resource's manifest entry merged in
   */
  mergeResourceUpdate(
    project: DbtProject,
    result: ResourceProcessingResult,
  ): DbtProject {
    if (!result.updatedProject) {
      return project;
    }

    if ('modelId' in result) {
      // Update only the specific model node
      const modelNode = result.updatedProject.manifest.nodes[result.modelId];
      if (modelNode) {
        return {
          ...project,
          manifest: {
            ...project.manifest,
            nodes: {
              ...project.manifest.nodes,
              [result.modelId]: modelNode,
            },
          },
        };
      }
    } else if ('sourceId' in result) {
      // Update only the source tables belonging to this source file
      // The sourceId (resource ID) matches the prefix of the table IDs
      const sourceUpdates: DbtProjectManifest['sources'] = {};
      const newSources = result.updatedProject.manifest.sources;

      for (const key of Object.keys(newSources)) {
        if (key.startsWith(result.sourceId)) {
          sourceUpdates[key] = newSources[key];
        }
      }

      if (Object.keys(sourceUpdates).length > 0) {
        return {
          ...project,
          manifest: {
            ...project.manifest,
            sources: {
              ...project.manifest.sources,
              ...sourceUpdates,
            },
          },
        };
      }
    }

    return project;
  }
}
