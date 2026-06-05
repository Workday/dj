import '@xyflow/react/dist/style.css';

import type { Edge, Node } from '@xyflow/react';
import {
  Background,
  Controls,
  MarkerType,
  PanOnScrollMode,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';

import { useDataExplorerStore } from '../../stores/dataExplorerStore';
import LightdashNode from './LightdashNode';
import ModelNode from './ModelNode';
import type {
  LightdashLineageNode,
  LightdashNodeData,
  LineageNode,
  ModelNodeData,
} from './types';

const nodeTypes = {
  lineageNode: ModelNode,
  lightdashNode: LightdashNode,
};

// Lightdash edges are intentionally softer than the dbt-model edges so the
// "data lineage" path stays visually dominant over the "BI consumer" path.
const LIGHTDASH_EDGE_COLOR = '#a78bfa'; // purple-400
const lightdashEdgeStyle = {
  strokeWidth: 1.5,
  stroke: LIGHTDASH_EDGE_COLOR,
  strokeDasharray: '4 4',
  opacity: 0.55,
};

interface LineageGraphProps {
  currentNode: LineageNode;
  upstreamNodes: LineageNode[];
  downstreamNodes: LineageNode[];
  lightdashDownstream?: LightdashLineageNode[];
  projectName: string;
  selectedNodeForQuery: string | null;
  selectedNodeName: string | null;
  onRunQuery: (modelName: string, projectName: string) => void;
  onCompile: (modelName: string, projectName: string) => void;
  onNodeClick: (
    modelName: string,
    projectName: string,
    type: 'model' | 'source' | 'seed' | 'python',
  ) => void;
  onViewColumns?: (
    filePath: string,
    modelName: string,
    type: 'model' | 'source' | 'seed' | 'python',
  ) => void;
  onOpenLightdash: (url: string) => void;
  onOpenLightdashYaml: (filePath: string) => void;
}

const EDGE_COLOR = 'var(--color-border-contrast)';

const edgeStyle = {
  strokeWidth: 2,
  stroke: EDGE_COLOR,
};

// Node dimensions: max-width ~380px, height ~75px
// Spacing = node size + gap
const HORIZONTAL_SPACING = 500;
const VERTICAL_SPACING = 210;

// Build a graph structure to calculate node levels
const buildGraph = (nodes: Node[], edges: Edge[]) => {
  const graph: Map<string, { upstream: string[]; downstream: string[] }> =
    new Map();

  nodes.forEach((node) => {
    graph.set(node.id, { upstream: [], downstream: [] });
  });

  edges.forEach((edge) => {
    const sourceEntry = graph.get(edge.source);
    const targetEntry = graph.get(edge.target);
    if (sourceEntry) sourceEntry.downstream.push(edge.target);
    if (targetEntry) targetEntry.upstream.push(edge.source);
  });

  return graph;
};

// Calculate level (distance from current node) for each node
const calculateLevels = (
  nodes: Node[],
  edges: Edge[],
  currentNodeId: string,
) => {
  const graph = buildGraph(nodes, edges);
  const levels: Map<string, number> = new Map();
  const visited = new Set<string>();

  // BFS from current node
  // Upstream nodes get negative levels, downstream get positive
  levels.set(currentNodeId, 0);
  visited.add(currentNodeId);

  // Process upstream (negative levels)
  const upstreamQueue: Array<{ id: string; level: number }> = [
    { id: currentNodeId, level: 0 },
  ];
  while (upstreamQueue.length > 0) {
    const { id, level } = upstreamQueue.shift()!;
    const entry = graph.get(id);
    if (entry) {
      entry.upstream.forEach((upId) => {
        if (!visited.has(upId)) {
          visited.add(upId);
          levels.set(upId, level - 1);
          upstreamQueue.push({ id: upId, level: level - 1 });
        }
      });
    }
  }

  // Process downstream (positive levels)
  visited.clear();
  visited.add(currentNodeId);
  const downstreamQueue: Array<{ id: string; level: number }> = [
    { id: currentNodeId, level: 0 },
  ];
  while (downstreamQueue.length > 0) {
    const { id, level } = downstreamQueue.shift()!;
    const entry = graph.get(id);
    if (entry) {
      entry.downstream.forEach((downId) => {
        if (!visited.has(downId)) {
          visited.add(downId);
          levels.set(downId, level + 1);
          downstreamQueue.push({ id: downId, level: level + 1 });
        }
      });
    }
  }

  return levels;
};

// Horizontal layout algorithm with multi-level support
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  currentNodeId: string,
) => {
  if (nodes.length === 0) return { nodes: [], edges };

  const levels = calculateLevels(nodes, edges, currentNodeId);

  // Group nodes by level
  const nodesByLevel: Map<number, Node[]> = new Map();
  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level)!.push(node);
  });

  // Find min and max levels
  const allLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);
  const minLevel = Math.min(...allLevels);

  // Calculate max nodes in any column for vertical centering
  const maxNodesInColumn = Math.max(
    ...Array.from(nodesByLevel.values()).map((n) => n.length),
    1,
  );

  // Calculate positions
  const layoutedNodes = nodes.map((node) => {
    const level = levels.get(node.id) ?? 0;
    const nodesAtLevel = nodesByLevel.get(level) || [];
    const indexInLevel = nodesAtLevel.findIndex((n) => n.id === node.id);

    // X position based on level (normalized so current is at center)
    const x = (level - minLevel) * HORIZONTAL_SPACING;

    // Y position - center nodes vertically within their level
    const totalHeight = nodesAtLevel.length * VERTICAL_SPACING;
    const maxTotalHeight = maxNodesInColumn * VERTICAL_SPACING;
    const yOffset = (maxTotalHeight - totalHeight) / 2;
    const y = yOffset + indexInLevel * VERTICAL_SPACING;

    return {
      ...node,
      position: { x, y },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export default function LineageGraph({
  currentNode,
  upstreamNodes,
  downstreamNodes,
  lightdashDownstream,
  projectName,
  selectedNodeForQuery,
  selectedNodeName,
  onRunQuery,
  onCompile,
  onNodeClick,
  onViewColumns,
  onOpenLightdash,
  onOpenLightdashYaml,
}: LineageGraphProps) {
  const {
    checkModelOutdated,
    compileModelWithLogs,
    expandUpstreamNode,
    expandDownstreamNode,
    isNodeUpstreamExpanded,
    isNodeDownstreamExpanded,
    additionalNodes,
    additionalEdges,
  } = useDataExplorerStore();
  const { fitView } = useReactFlow();
  // Mixed node store: ModelNodeData (lineageNode) and LightdashNodeData
  // (lightdashNode). Both interfaces extend Record<string, unknown>, so
  // typing the React Flow store as `Node` (any data) keeps everything
  // type-safe at the call sites without losing per-node strictness.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutVersionRef = useRef(0);

  const handleCompile = useCallback(
    (modelName: string, projectName: string) => {
      // Trigger compilation only (no auto-run) - call parent handler
      onCompile(modelName, projectName);
    },
    [onCompile],
  );

  const handleCompileAndRun = useCallback(
    (modelName: string, projectName: string) => {
      // Trigger compilation with auto-run after
      void compileModelWithLogs(modelName, projectName, true);
    },
    [compileModelWithLogs],
  );

  const handleExpandUpstream = useCallback(
    (modelName: string, projectName: string) => {
      void expandUpstreamNode(modelName, projectName);
    },
    [expandUpstreamNode],
  );

  const handleExpandDownstream = useCallback(
    (modelName: string, projectName: string) => {
      void expandDownstreamNode(modelName, projectName);
    },
    [expandDownstreamNode],
  );

  // Build nodes and edges from lineage data
  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Combine all nodes including additional ones from expansion
    const allLineageNodes = [
      currentNode,
      ...upstreamNodes,
      ...downstreamNodes,
      ...additionalNodes,
    ];

    // Check model outdated status for all models
    const checkStatuses = async () => {
      const statusPromises = allLineageNodes
        .filter((node) => node.type === 'model')
        .map(async (node) => {
          const status = await checkModelOutdated(node.name, projectName);
          return {
            nodeName: node.name,
            isOutdated: status.isOutdated,
            hasCompiledFile: status.hasCompiledFile,
          };
        });

      return await Promise.all(statusPromises);
    };

    // Check model outdated status for all models asynchronously and update nodes
    void checkStatuses().then((statuses) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const status = statuses.find((s) => s.nodeName === node.data.name);
          if (status) {
            return {
              ...node,
              data: {
                ...node.data,
                isOutdated: status.isOutdated,
                hasCompiledFile: status.hasCompiledFile,
              },
            };
          }
          return node;
        }),
      );
    });

    // Create current node
    // For current node, we show expand buttons based on whether it has more ancestors/descendants
    // beyond what's already displayed (upstream/downstream nodes)
    const currentFlowNode: Node<ModelNodeData> = {
      id: currentNode.id,
      type: 'lineageNode',
      position: { x: 0, y: 0 },
      data: {
        id: currentNode.id,
        name: currentNode.name,
        type: currentNode.type,
        description: currentNode.description,
        path: currentNode.path,
        pathSystem: currentNode.pathSystem,
        isCurrent: true,
        projectName,
        isCompiled: undefined,
        materialized: currentNode.materialized,
        testCount: currentNode.testCount,
        // Current node already shows its immediate upstream/downstream, so no expand buttons needed
        hasUpstream: false,
        hasDownstream: false,
        isUpstreamExpanded: true,
        isDownstreamExpanded: true,
        onRun: onRunQuery,
        onCompile: handleCompile,
        onCompileAndRun: handleCompileAndRun,
        onNodeClick,
        onExpandUpstream: handleExpandUpstream,
        onExpandDownstream: handleExpandDownstream,
        onViewColumns,
      },
    };
    newNodes.push(currentFlowNode);

    // Create upstream nodes and edges
    upstreamNodes.forEach((node) => {
      // Check if this node has already been expanded (has additional edges pointing to it)
      const hasBeenExpanded = additionalEdges.some((e) => e.target === node.id);

      const flowNode: Node<ModelNodeData> = {
        id: node.id,
        type: 'lineageNode',
        position: { x: 0, y: 0 },
        data: {
          id: node.id,
          name: node.name,
          type: node.type,
          description: node.description,
          path: node.path,
          pathSystem: node.pathSystem,
          isCurrent: false,
          projectName,
          isCompiled: undefined,
          materialized: node.materialized,
          testCount: node.testCount,
          // Use backend value to determine if node has its own upstream
          hasUpstream: node.hasOwnUpstream === true,
          hasDownstream: false, // Downstream is already shown (current node)
          isUpstreamExpanded:
            isNodeUpstreamExpanded(node.id) || hasBeenExpanded,
          isDownstreamExpanded: true, // Already showing downstream (current)
          onRun: onRunQuery,
          onCompile: handleCompile,
          onCompileAndRun: handleCompileAndRun,
          onNodeClick,
          onExpandUpstream: handleExpandUpstream,
          onExpandDownstream: handleExpandDownstream,
          onViewColumns,
        },
      };
      newNodes.push(flowNode);

      const edge: Edge = {
        id: `${node.id}-${currentNode.id}`,
        source: node.id,
        target: currentNode.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: EDGE_COLOR,
        },
      };
      newEdges.push(edge);
    });

    // Create downstream nodes and edges
    downstreamNodes.forEach((node) => {
      // Check if this node has already been expanded (has additional edges coming from it)
      const hasBeenExpanded = additionalEdges.some((e) => e.source === node.id);

      const flowNode: Node<ModelNodeData> = {
        id: node.id,
        type: 'lineageNode',
        position: { x: 0, y: 0 },
        data: {
          id: node.id,
          name: node.name,
          type: node.type,
          description: node.description,
          path: node.path,
          pathSystem: node.pathSystem,
          isCurrent: false,
          projectName,
          isCompiled: undefined,
          materialized: node.materialized,
          testCount: node.testCount,
          hasUpstream: false, // Upstream is already shown (current node)
          // Use backend value to determine if node has its own downstream
          hasDownstream: node.hasOwnDownstream === true,
          isUpstreamExpanded: true, // Already showing upstream (current)
          isDownstreamExpanded:
            isNodeDownstreamExpanded(node.id) || hasBeenExpanded,
          onRun: onRunQuery,
          onCompile: handleCompile,
          onCompileAndRun: handleCompileAndRun,
          onNodeClick,
          onExpandUpstream: handleExpandUpstream,
          onExpandDownstream: handleExpandDownstream,
          onViewColumns,
        },
      };
      newNodes.push(flowNode);

      const edge: Edge = {
        id: `${currentNode.id}-${node.id}`,
        source: currentNode.id,
        target: node.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: EDGE_COLOR,
        },
      };
      newEdges.push(edge);
    });

    // Add additional nodes from expansion
    additionalNodes.forEach((node) => {
      // Check if already added
      if (newNodes.some((n) => n.id === node.id)) return;

      const flowNode: Node<ModelNodeData> = {
        id: node.id,
        type: 'lineageNode',
        position: { x: 0, y: 0 },
        data: {
          id: node.id,
          name: node.name,
          type: node.type,
          description: node.description,
          path: node.path,
          pathSystem: node.pathSystem,
          isCurrent: false,
          projectName,
          isCompiled: undefined,
          materialized: node.materialized,
          testCount: node.testCount,
          // Use backend values to determine if node has its own upstream/downstream
          hasUpstream: node.hasOwnUpstream === true,
          hasDownstream: node.hasOwnDownstream === true,
          isUpstreamExpanded: isNodeUpstreamExpanded(node.id),
          isDownstreamExpanded: isNodeDownstreamExpanded(node.id),
          onRun: onRunQuery,
          onCompile: handleCompile,
          onCompileAndRun: handleCompileAndRun,
          onNodeClick,
          onExpandUpstream: handleExpandUpstream,
          onExpandDownstream: handleExpandDownstream,
          onViewColumns,
        },
      };
      newNodes.push(flowNode);
    });

    // Add additional edges from expansion
    additionalEdges.forEach(({ source, target }) => {
      const edgeId = `${source}-${target}`;
      if (newEdges.some((e) => e.id === edgeId)) return;

      const edge: Edge = {
        id: edgeId,
        source,
        target,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: edgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: EDGE_COLOR,
        },
      };
      newEdges.push(edge);
    });

    // Lightdash content nodes - placed level+1 from current (right-most
    // column when current is a mart). Distinct dashed purple edges visually
    // separate "data lineage" from "BI consumer" relationships.
    if (lightdashDownstream && lightdashDownstream.length > 0) {
      lightdashDownstream.forEach((ld) => {
        const flowNode: Node<LightdashNodeData> = {
          id: ld.id,
          type: 'lightdashNode',
          position: { x: 0, y: 0 },
          data: {
            id: ld.id,
            slug: ld.slug,
            name: ld.name,
            kind: ld.kind,
            url: ld.url,
            charts: ld.charts,
            filePath: ld.filePath,
            onOpen: onOpenLightdash,
            onOpenYaml: onOpenLightdashYaml,
          },
        };
        newNodes.push(flowNode);

        const edge: Edge = {
          id: `${currentNode.id}-${ld.id}`,
          source: currentNode.id,
          target: ld.id,
          sourceHandle: 'output',
          targetHandle: 'input',
          style: lightdashEdgeStyle,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: LIGHTDASH_EDGE_COLOR,
          },
        };
        newEdges.push(edge);
      });
    }

    // Apply layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      newNodes,
      newEdges,
      currentNode.id,
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    layoutVersionRef.current += 1;
  }, [
    currentNode,
    upstreamNodes,
    downstreamNodes,
    lightdashDownstream,
    projectName,
    onRunQuery,
    onNodeClick,
    onOpenLightdash,
    onOpenLightdashYaml,
    setNodes,
    setEdges,
    additionalNodes,
    additionalEdges,
    handleCompile,
    handleCompileAndRun,
    handleExpandUpstream,
    handleExpandDownstream,
    isNodeUpstreamExpanded,
    isNodeDownstreamExpanded,
    checkModelOutdated,
  ]);

  // Imperative fitView after layout changes
  useEffect(() => {
    if (nodes.length > 0 && layoutVersionRef.current > 0) {
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, maxZoom: 1.5, duration: 200 });
      });
    }
  }, [nodes.length, fitView]);

  // Highlight selected/clicked node
  useEffect(() => {
    // Use selectedNodeName (clicked node) or selectedNodeForQuery (query node)
    const activeSelection = selectedNodeName || selectedNodeForQuery;

    if (activeSelection) {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isSelected:
              node.data.name === activeSelection && !node.data.isCurrent,
          },
          style: {
            ...node.style,
            opacity: node.data.name === activeSelection ? 1 : 0.7,
          },
        })),
      );
    } else {
      setNodes((nds) =>
        nds.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isSelected: false,
          },
          style: {
            ...node.style,
            opacity: 1,
          },
        })),
      );
    }
  }, [selectedNodeName, selectedNodeForQuery, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{
        padding: 0.2,
        minZoom: 0.5,
        maxZoom: 1.5,
      }}
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={{
        style: edgeStyle,
      }}
      zoomOnScroll={false}
      zoomOnPinch={true}
      panOnScroll={true}
      panOnScrollMode={PanOnScrollMode.Free}
      preventScrolling={true}
      className="bg-surface"
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--color-neutral)" gap={16} />
      <Controls
        className="bg-card border border-neutral rounded-lg shadow-lg"
        showInteractive={false}
      />
    </ReactFlow>
  );
}
