import type { Edge, Node } from '@xyflow/react';

export type MaterializationType =
  | 'ephemeral'
  | 'incremental'
  | 'view'
  | 'table';

export interface LineageNode {
  id: string;
  name: string;
  type: 'model' | 'source' | 'seed';
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
  // `chart` is used as the anchor (sink) of the reverse-lineage view.
  kind: 'dashboard' | 'standalone-charts' | 'chart';
  url?: string;
  charts?: {
    slug: string;
    name: string;
    url?: string;
    filePath: string;
    embeddedAsTile?: boolean;
    hasYaml?: boolean;
    // dbt model this chart references; surfaced in the reverse-lineage
    // popover so each row shows its upstream model. Undefined / ignored
    // by the forward view.
    modelName?: string | null;
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
  /**
   * When provided, the dashboard/chart name (and per-chart popover rows)
   * become click targets that open the reverse-lineage view for that
   * asset. Wired by the forward model-lineage view as a convenience
   * entry point; omitted for the reverse view's own anchor node.
   */
  onOpenReverseLineage?: (anchor: {
    kind: 'dashboard' | 'chart';
    slug: string;
  }) => void;
  /**
   * Render a right-side source handle so edges can originate from this node.
   * Set on the reverse-lineage chart anchor (which points at its parent
   * dashboard nodes); omitted elsewhere so sink nodes keep only their left
   * target handle.
   */
  showSourceHandle?: boolean;
}

export interface ModelNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  type: 'model' | 'source' | 'seed';
  description?: string;
  tags?: string[];
  path?: string;
  pathSystem?: string;
  isCurrent?: boolean;
  isSelected?: boolean;
  /**
   * Reverse-lineage only: the model is referenced by the Lightdash asset
   * but was not found in the dbt manifest (stale reference). Rendered
   * with a "not found in project" treatment instead of action buttons.
   */
  isStale?: boolean;
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
    type: 'model' | 'source' | 'seed',
  ) => void;
  onExpandUpstream?: (modelName: string, projectName: string) => void;
  onExpandDownstream?: (modelName: string, projectName: string) => void;
  onViewColumns?: (
    filePath: string,
    modelName: string,
    type: 'model' | 'source' | 'seed',
  ) => void;
}

export type LineageFlowNode = Node<ModelNodeData>;
export type LineageFlowEdge = Edge;
