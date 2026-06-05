import type { Edge, Node } from '@xyflow/react';

export type MaterializationType =
  | 'ephemeral'
  | 'incremental'
  | 'view'
  | 'table';

export interface LineageNode {
  id: string;
  name: string;
  type: 'model' | 'source' | 'seed' | 'python';
  description?: string;
  tags?: string[];
  path: string;
  pathSystem?: string;
  schema?: string;
  database?: string;
  materialized?: MaterializationType;
  testCount?: number;
  // Whether this node has its own upstream/downstream models (for expand buttons)
  hasOwnUpstream?: boolean;
  hasOwnDownstream?: boolean;
}

export interface LightdashLineageNode {
  id: string;
  slug: string;
  name: string;
  kind: 'dashboard' | 'standalone-charts';
  url?: string;
  charts?: {
    slug: string;
    name: string;
    url?: string;
    filePath: string;
    embeddedAsTile?: boolean;
    hasYaml?: boolean;
  }[];
  filePath: string;
}

// Carries the same data shape as `LightdashLineageNode` plus the click
// handlers wired up by the parent. The `Record<string, unknown>` index
// signature is required by React Flow's generic node types.
export interface LightdashNodeData
  extends LightdashLineageNode,
    Record<string, unknown> {
  onOpen: (url: string) => void;
  onOpenYaml: (filePath: string) => void;
}

export interface ModelNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  type: 'model' | 'source' | 'seed' | 'python';
  description?: string;
  tags?: string[];
  path?: string;
  pathSystem?: string;
  isCurrent?: boolean;
  isSelected?: boolean;
  projectName: string;
  isCompiled?: boolean;
  // Smart compile detection: whether model source has changed since last compile
  isOutdated?: boolean;
  hasCompiledFile?: boolean;
  materialized?: MaterializationType;
  testCount?: number;
  hasUpstream?: boolean;
  hasDownstream?: boolean;
  isUpstreamExpanded?: boolean;
  isDownstreamExpanded?: boolean;
  onRun: (modelName: string, projectName: string) => void;
  onCompile: (modelName: string, projectName: string) => void;
  onCompileAndRun: (modelName: string, projectName: string) => void;
  onNodeClick: (
    modelName: string,
    projectName: string,
    type: 'model' | 'source' | 'seed' | 'python',
  ) => void;
  onExpandUpstream?: (modelName: string, projectName: string) => void;
  onExpandDownstream?: (modelName: string, projectName: string) => void;
  onViewColumns?: (
    filePath: string,
    modelName: string,
    type: 'model' | 'source' | 'seed' | 'python',
  ) => void;
}

export type LineageFlowNode = Node<ModelNodeData>;
export type LineageFlowEdge = Edge;
