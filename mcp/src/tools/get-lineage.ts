import { frameworkGetModelName } from '@services/framework/utils';
import { resolveProject } from '@services/framework/headless';
import { extractFrameworkDependencies } from '@services/sync/dependencyGraph';
import { jsonParse } from '@shared';
import type { FrameworkModel } from '@shared/framework/types';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { failure, success, type ProjectSelector } from '../response';

export interface LineageNode {
  id: string;
  name: string;
  kind: 'model' | 'source';
  path?: string;
  type?: string;
  group?: string;
  topic?: string;
}

export interface LineageEdge {
  from: string;
  to: string;
  relation: 'depends_on';
}

function extractSourceDependencies(modelJson: FrameworkModel): string[] {
  const sources = new Set<string>();

  const collectFrom = (from: Record<string, unknown> | undefined) => {
    if (!from) {
      return;
    }
    if (typeof from.source === 'string' && from.source) {
      sources.add(from.source);
    }
    if (from.union && typeof from.union === 'object') {
      const union = from.union as { sources?: unknown[] };
      if (Array.isArray(union.sources)) {
        for (const src of union.sources) {
          if (typeof src === 'string') {
            sources.add(src);
          } else if (src && typeof src === 'object' && 'source' in src) {
            const s = (src as { source?: string }).source;
            if (s) {
              sources.add(s);
            }
          }
        }
      }
    }
  };

  if ('from' in modelJson && modelJson.from) {
    collectFrom(modelJson.from as Record<string, unknown>);
  }

  if ('ctes' in modelJson && Array.isArray(modelJson.ctes)) {
    for (const cte of modelJson.ctes) {
      if (cte?.from) {
        collectFrom(cte.from as Record<string, unknown>);
      }
    }
  }

  if ('select' in modelJson && Array.isArray(modelJson.select)) {
    for (const selected of modelJson.select) {
      if (
        selected &&
        typeof selected === 'object' &&
        'source' in selected &&
        typeof (selected as { source?: string }).source === 'string'
      ) {
        sources.add((selected as { source: string }).source);
      }
    }
  }

  return [...sources];
}

async function loadProjectModelIndex(projectPath: string): Promise<{
  byName: Map<string, { path: string; modelJson: FrameworkModel }>;
  upstreamModels: Map<string, string[]>;
  upstreamSources: Map<string, string[]>;
  downstream: Map<string, string[]>;
}> {
  const byName = new Map<string, { path: string; modelJson: FrameworkModel }>();
  const upstreamModels = new Map<string, string[]>();
  const upstreamSources = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();

  const files = await glob('**/*.model.json', {
    cwd: projectPath,
    absolute: true,
    nodir: true,
    ignore: ['**/target/**', '**/dbt_packages/**', '**/node_modules/**'],
  });

  for (const file of files) {
    try {
      const modelJson = jsonParse(fs.readFileSync(file, 'utf8')) as FrameworkModel;
      const name = frameworkGetModelName(modelJson);
      if (!name) {
        continue;
      }
      byName.set(name, { path: file, modelJson });
      upstreamModels.set(name, extractFrameworkDependencies(modelJson));
      upstreamSources.set(name, extractSourceDependencies(modelJson));
    } catch {
      // Skip invalid JSON files
    }
  }

  for (const [name, parents] of upstreamModels.entries()) {
    for (const parent of parents) {
      const kids = downstream.get(parent) ?? [];
      kids.push(name);
      downstream.set(parent, kids);
    }
  }

  return { byName, upstreamModels, upstreamSources, downstream };
}

function walk(
  start: string,
  adjacency: Map<string, string[]>,
  maxLevels: number,
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: start, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxLevels) {
      continue;
    }
    for (const next of adjacency.get(current.id) ?? []) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }

  return visited;
}

/**
 * Trace model/source lineage for a DJ model.
 *
 * Uses Framework JSON dependencies (from/join/union/ctes/select) — the same
 * graph the sync engine uses — so it works without a dbt manifest.
 */
export async function getLineage(
  args: ProjectSelector & {
    modelPath?: string;
    modelName?: string;
    upstreamLevels?: number;
    downstreamLevels?: number;
  },
) {
  try {
    const { resolveActiveProject } = await import('../projects/registry');
    let projectPath: string;
    let workspaceRoot: string;
    let projectName: string | undefined;

    if (args.projectPath && !args.projectId && !args.localPath) {
      const { getConfig } = await import('../config');
      const { workspaceRoot: root } = getConfig(args);
      workspaceRoot = root;
      const project = resolveProject(
        workspaceRoot,
        args.projectPath,
        args.projectName,
      );
      projectPath = project.pathSystem;
      projectName = project.name;
    } else {
      const ctx = await resolveActiveProject(args);
      projectPath = ctx.projectPath;
      workspaceRoot = ctx.workspaceRoot;
      projectName = ctx.projectName;
    }

    const project = resolveProject(workspaceRoot, projectPath, projectName);

    const index = await loadProjectModelIndex(project.pathSystem);

    let rootName = args.modelName;
    if (!rootName && args.modelPath) {
      const modelPath = path.resolve(args.modelPath);
      const modelJson = jsonParse(
        fs.readFileSync(modelPath, 'utf8'),
      ) as FrameworkModel;
      rootName = frameworkGetModelName(modelJson);
    }
    if (!rootName) {
      return failure(['modelPath or modelName is required']);
    }
    if (!index.byName.has(rootName) && !args.modelPath) {
      return failure([`Model not found: ${rootName}`]);
    }

    const upstreamLevels = args.upstreamLevels ?? 10;
    const downstreamLevels = args.downstreamLevels ?? 10;

    const upstreamModelNames = walk(
      rootName,
      index.upstreamModels,
      upstreamLevels,
    );
    const downstreamModelNames = walk(
      rootName,
      index.downstream,
      downstreamLevels,
    );

    const sourceNames = new Set<string>();
    const considerForSources = [rootName, ...upstreamModelNames];
    for (const name of considerForSources) {
      for (const src of index.upstreamSources.get(name) ?? []) {
        sourceNames.add(src);
      }
    }

    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const seenNodes = new Set<string>();

    const addModelNode = (name: string) => {
      if (seenNodes.has(name)) {
        return;
      }
      seenNodes.add(name);
      const entry = index.byName.get(name);
      nodes.push({
        id: name,
        name,
        kind: 'model',
        path: entry?.path,
        type: entry?.modelJson.type,
        group: entry?.modelJson.group,
        topic: entry?.modelJson.topic,
      });
    };

    const addSourceNode = (name: string) => {
      if (seenNodes.has(`source:${name}`)) {
        return;
      }
      seenNodes.add(`source:${name}`);
      nodes.push({
        id: `source:${name}`,
        name,
        kind: 'source',
      });
    };

    addModelNode(rootName);
    for (const name of upstreamModelNames) {
      addModelNode(name);
    }
    for (const name of downstreamModelNames) {
      addModelNode(name);
    }
    for (const src of sourceNames) {
      addSourceNode(src);
    }

    const relevantModels = new Set([
      rootName,
      ...upstreamModelNames,
      ...downstreamModelNames,
    ]);

    for (const name of relevantModels) {
      for (const parent of index.upstreamModels.get(name) ?? []) {
        if (relevantModels.has(parent)) {
          edges.push({ from: parent, to: name, relation: 'depends_on' });
        }
      }
      for (const src of index.upstreamSources.get(name) ?? []) {
        if (sourceNames.has(src)) {
          edges.push({
            from: `source:${src}`,
            to: name,
            relation: 'depends_on',
          });
        }
      }
    }

    return success({
      root: rootName,
      project: project.name,
      upstreamLevels,
      downstreamLevels,
      summary: {
        models: nodes.filter((n) => n.kind === 'model').length,
        sources: nodes.filter((n) => n.kind === 'source').length,
        edges: edges.length,
      },
      nodes,
      edges,
    });
  } catch (error) {
    return failure([(error as Error).message]);
  }
}
