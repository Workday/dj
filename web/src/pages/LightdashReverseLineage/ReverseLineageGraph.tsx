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

import { useReverseLineageStore } from '../../stores/useReverseLineageStore';
import LightdashNode from '../ModelLineage/LightdashNode';
import { getLayoutedElements } from '../ModelLineage/LineageGraph';
import ModelNode from '../ModelLineage/ModelNode';
import type {
  LightdashNodeData,
  LineageNode,
  ModelNodeData,
} from '../ModelLineage/types';

const nodeTypes = {
  lineageNode: ModelNode,
  lightdashNode: LightdashNode,
};

const EDGE_COLOR = 'var(--color-border-contrast)';
const edgeStyle = { strokeWidth: 2, stroke: EDGE_COLOR };

// The model -> dashboard/chart hop crosses the data/BI boundary; render it
// in the same dashed purple as the forward view's Lightdash edges so the
// two directions read consistently.
const BI_EDGE_COLOR = '#a78bfa';
const biEdgeStyle = {
  strokeWidth: 1.5,
  stroke: BI_EDGE_COLOR,
  strokeDasharray: '4 4',
  opacity: 0.7,
};

/**
 * React Flow canvas for reverse lineage. The Lightdash asset is the sink
 * (right-most); the models it references render to its left; expand-upstream
 * drills further left. Reuses `ModelNode`, `LightdashNode`, and the forward
 * view's layout helpers; expansion state comes from `useReverseLineageStore`.
 */
export default function ReverseLineageGraph() {
  const {
    data,
    additionalNodes,
    additionalEdges,
    isNodeUpstreamExpanded,
    expandUpstreamNode,
    openModelInDataExplorer,
    compileModel,
    previewModel,
    openColumnLineage,
    openLightdashUrl,
    openLightdashYaml,
    fetchReverseLineage,
  } = useReverseLineageStore();
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutVersionRef = useRef(0);

  // ModelNode requires run/compile/click handlers; in the reverse view we
  // centralize those by opening the model in the main Data Explorer (which
  // owns the full run/compile/preview flow). Expand-upstream drills locally.
  const openModel = useCallback(
    (modelName: string, projectName: string) => {
      void openModelInDataExplorer(modelName, projectName);
    },
    [openModelInDataExplorer],
  );

  const handleExpandUpstream = useCallback(
    (modelName: string, projectName: string) => {
      void expandUpstreamNode(modelName, projectName);
    },
    [expandUpstreamNode],
  );

  useEffect(() => {
    if (!data) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const { anchor, models, staleModels, projectName } = data;
    const parentDashboards = data.parentDashboards ?? [];

    // Model-node action wiring shared by referenced + expanded-upstream nodes:
    // run the real VS Code command against the model's file, falling back to
    // opening it in the Data Explorer when the file path is unknown.
    const modelActions = (node: LineageNode) => ({
      onRun: () => {
        if (node.pathSystem) void previewModel(node.pathSystem);
        else void openModel(node.name, projectName);
      },
      onCompile: () => {
        if (node.pathSystem) void compileModel(node.pathSystem);
        else void openModel(node.name, projectName);
      },
      onCompileAndRun: () => {
        if (node.pathSystem) void previewModel(node.pathSystem);
        else void openModel(node.name, projectName);
      },
      onNodeClick: (modelName: string, proj: string) =>
        openModel(modelName, proj),
      onExpandUpstream: handleExpandUpstream,
      onViewColumns: (filePath: string) => void openColumnLineage(filePath),
    });

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Anchor (dashboard / chart). For a chart anchor with parent dashboards
    // it sits mid-graph (models on the left, dashboards on the right) and
    // needs a source handle for the outgoing chart -> dashboard edges.
    const anchorNode: Node<LightdashNodeData> = {
      id: anchor.id,
      type: 'lightdashNode',
      position: { x: 0, y: 0 },
      data: {
        id: anchor.id,
        slug: anchor.slug,
        name: anchor.name,
        kind: anchor.kind,
        url: anchor.url,
        charts: anchor.charts,
        filePath: anchor.filePath,
        showSourceHandle: parentDashboards.length > 0,
        onOpen: (url) => void openLightdashUrl(url),
        onOpenYaml: (filePath) => void openLightdashYaml(filePath),
      },
    };
    newNodes.push(anchorNode);

    // Parent dashboards (chart anchor only): the dashboard(s) that embed the
    // chart, rendered to the right so the graph reads models -> chart ->
    // dashboard. Clicking a dashboard name re-anchors the view on it.
    parentDashboards.forEach((dash) => {
      if (newNodes.some((n) => n.id === dash.id)) return;
      const dashNode: Node<LightdashNodeData> = {
        id: dash.id,
        type: 'lightdashNode',
        position: { x: 0, y: 0 },
        data: {
          id: dash.id,
          slug: dash.slug,
          name: dash.name,
          kind: dash.kind,
          url: dash.url,
          charts: dash.charts,
          filePath: dash.filePath,
          onOpen: (url) => void openLightdashUrl(url),
          onOpenYaml: (filePath) => void openLightdashYaml(filePath),
          onOpenReverseLineage: (a) => void fetchReverseLineage(a),
        },
      };
      newNodes.push(dashNode);
      newEdges.push({
        id: `${anchor.id}-${dash.id}`,
        source: anchor.id,
        target: dash.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: biEdgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: BI_EDGE_COLOR,
        },
      });
    });

    // Referenced models that resolved in the manifest.
    models.forEach((node) => {
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
          projectName,
          materialized: node.materialized,
          testCount: node.testCount,
          hasUpstream: node.hasOwnUpstream === true,
          hasDownstream: false,
          isUpstreamExpanded:
            isNodeUpstreamExpanded(node.id) || hasBeenExpanded,
          isDownstreamExpanded: true,
          ...modelActions(node),
        },
      };
      newNodes.push(flowNode);
      newEdges.push({
        id: `${node.id}-${anchor.id}`,
        source: node.id,
        target: anchor.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: biEdgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: BI_EDGE_COLOR,
        },
      });
    });

    // Stale references: flagged "not in project" nodes, no actions.
    staleModels.forEach((modelName) => {
      const id = `stale::${modelName}`;
      const flowNode: Node<ModelNodeData> = {
        id,
        type: 'lineageNode',
        position: { x: 0, y: 0 },
        data: {
          id,
          name: modelName,
          type: 'model',
          projectName,
          isStale: true,
          hasUpstream: false,
          hasDownstream: false,
          onRun: openModel,
          onCompile: openModel,
          onCompileAndRun: openModel,
          onNodeClick: () => undefined,
        },
      };
      newNodes.push(flowNode);
      newEdges.push({
        id: `${id}-${anchor.id}`,
        source: id,
        target: anchor.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        style: biEdgeStyle,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: BI_EDGE_COLOR,
        },
      });
    });

    // Upstream nodes pulled in via expand-upstream.
    additionalNodes.forEach((node) => {
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
          projectName,
          materialized: node.materialized,
          testCount: node.testCount,
          hasUpstream: node.hasOwnUpstream === true,
          hasDownstream: false,
          isUpstreamExpanded: isNodeUpstreamExpanded(node.id),
          isDownstreamExpanded: true,
          ...modelActions(node),
        },
      };
      newNodes.push(flowNode);
    });

    // Edges from expansion (upstream -> model).
    additionalEdges.forEach(({ source, target }) => {
      const edgeId = `${source}-${target}`;
      if (newEdges.some((e) => e.id === edgeId)) return;
      newEdges.push({
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
      });
    });

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      newNodes,
      newEdges,
      anchor.id,
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    layoutVersionRef.current += 1;
  }, [
    data,
    additionalNodes,
    additionalEdges,
    isNodeUpstreamExpanded,
    openModel,
    handleExpandUpstream,
    compileModel,
    previewModel,
    openColumnLineage,
    openLightdashUrl,
    openLightdashYaml,
    fetchReverseLineage,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    if (nodes.length > 0 && layoutVersionRef.current > 0) {
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, maxZoom: 1.5, duration: 200 });
      });
    }
  }, [nodes.length, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, minZoom: 0.5, maxZoom: 1.5 }}
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={{ style: edgeStyle }}
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
