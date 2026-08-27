import type { PythonModelUpstreamSource } from '@shared/framework/types';
import type { LineageNode } from '@shared/modellineage/types';

import { parseUpstreamSourcesProperty } from './python-upstream-sources';

export interface PythonModelTableProps {
  pythonModelName: string;
  upstreamSources: PythonModelUpstreamSource[];
  namespace?: string;
  table?: string;
  description?: string;
}

export interface PythonModelLineageEdge {
  pythonModelNodeId: string;
  sourceNodeId: string;
}

export interface PythonModelLineageWalkResult {
  nodes: LineageNode[];
  edges: PythonModelLineageEdge[];
}

/** Parse Iceberg `python_model_*` table properties into structured metadata. */
export function parsePythonModelProperties(
  props: Record<string, string>,
): PythonModelTableProps | null {
  const pythonModelName = props['python_model_name'];
  if (!pythonModelName) {
    return null;
  }

  return {
    pythonModelName,
    upstreamSources: parseUpstreamSourcesProperty(
      props['python_model_upstream_sources'],
    ),
    namespace: props['python_model_namespace'],
    table: props['python_model_table'],
    description: props['python_model_description'],
  };
}

function sanitizeNodeIdSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function hasSourceTableLocation(
  node: LineageNode,
): node is LineageNode & { database: string; schema: string } {
  return Boolean(node.database && node.schema && node.name);
}

function makePythonLineageNode(
  parsed: PythonModelTableProps,
  catalog: string,
  schema: string,
  table: string,
  nodeId: string,
): LineageNode {
  return {
    id: nodeId,
    name: parsed.pythonModelName,
    type: 'python',
    description: parsed.description || `${schema}.${table}`,
    tags: ['python'],
    path: '',
    schema,
    database: catalog,
    hasOwnUpstream: false,
    hasOwnDownstream: true,
  };
}

function makeTrinoRefNode(
  catalog: string,
  schema: string,
  table: string,
  nodeId: string,
): LineageNode {
  return {
    id: nodeId,
    name: table,
    type: 'python',
    description: `${schema}.${table}`,
    tags: ['python', 'trino-ref'],
    path: '',
    schema,
    database: catalog,
    hasOwnUpstream: false,
    hasOwnDownstream: true,
  };
}

function makeExternalLeafNode(value: string, nodeId: string): LineageNode {
  return {
    id: nodeId,
    name: value,
    type: 'python',
    description: value,
    tags: ['python', 'external'],
    path: '',
    hasOwnUpstream: false,
    hasOwnDownstream: true,
  };
}

interface WalkQueueItem {
  catalog: string;
  schema: string;
  table: string;
  attachToNodeId: string;
}

/**
 * Recursively walk Python model upstream chains via Iceberg table properties.
 * Starts from manifest source nodes and follows trino-type upstream entries to root.
 */
export async function buildPythonUpstreamGraph(params: {
  startSourceNodes: LineageNode[];
  fetchProperties: (
    catalog: string,
    schema: string,
    table: string,
  ) => Promise<Record<string, string>>;
}): Promise<PythonModelLineageWalkResult> {
  const { startSourceNodes, fetchProperties } = params;
  const nodesById = new Map<string, LineageNode>();
  const edges: PythonModelLineageEdge[] = [];
  const edgeKeys = new Set<string>();
  const visitedTables = new Set<string>();

  const queue: WalkQueueItem[] = startSourceNodes
    .filter(hasSourceTableLocation)
    .map((n) => ({
      catalog: n.database,
      schema: n.schema,
      table: n.name,
      attachToNodeId: n.id,
    }));

  const addEdge = (pythonModelNodeId: string, sourceNodeId: string) => {
    const key = `${pythonModelNodeId}->${sourceNodeId}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({ pythonModelNodeId, sourceNodeId });
  };

  while (queue.length > 0) {
    const item = queue.shift()!;
    const tableKey = `${item.catalog}.${item.schema}.${item.table}`;
    if (visitedTables.has(tableKey)) {
      continue;
    }
    visitedTables.add(tableKey);

    let props: Record<string, string> | null = null;
    try {
      props = await fetchProperties(item.catalog, item.schema, item.table);
    } catch {
      props = null;
    }

    const parsed = props ? parsePythonModelProperties(props) : null;
    if (!parsed) {
      if (!item.attachToNodeId.startsWith('python.')) {
        continue;
      }
      const refId = `python.trino.${item.schema}.${item.table}`;
      if (!nodesById.has(refId)) {
        nodesById.set(
          refId,
          makeTrinoRefNode(item.catalog, item.schema, item.table, refId),
        );
      }
      addEdge(refId, item.attachToNodeId);
      continue;
    }

    const nodeId = `python.${parsed.pythonModelName}`;
    let node = nodesById.get(nodeId);
    if (!node) {
      node = makePythonLineageNode(
        parsed,
        item.catalog,
        item.schema,
        item.table,
        nodeId,
      );
      nodesById.set(nodeId, node);
    }

    addEdge(nodeId, item.attachToNodeId);

    let hasTrinoUpstream = false;
    for (const entry of parsed.upstreamSources) {
      if (entry.type === 'external') {
        const extId = `python.external.${sanitizeNodeIdSegment(entry.value)}`;
        if (!nodesById.has(extId)) {
          nodesById.set(extId, makeExternalLeafNode(entry.value, extId));
        }
        addEdge(extId, nodeId);
        continue;
      }

      if (entry.type === 'trino') {
        const dotIdx = entry.value.indexOf('.');
        if (dotIdx === -1) {
          continue;
        }
        hasTrinoUpstream = true;
        queue.push({
          catalog: item.catalog,
          schema: entry.value.slice(0, dotIdx),
          table: entry.value.slice(dotIdx + 1),
          attachToNodeId: nodeId,
        });
      }
    }

    if (hasTrinoUpstream) {
      nodesById.set(nodeId, { ...node, hasOwnUpstream: true });
    }
  }

  return {
    nodes: [...nodesById.values()],
    edges,
  };
}
