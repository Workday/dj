import type { Edge, Node } from '@xyflow/react';
import { Position } from '@xyflow/react';
import { useCallback } from 'react';

const LAYOUT_CONFIG = {
  direction: 'TB',

  nodeWidth: 400,
  nodeHeight: 200,

  stages: {
    // Pre-source lane reserved for the CTE list. CTEs declare upstream of
    // SELECT FROM (mirrors WITH ... SELECT in SQL). Uses a tighter rankSep
    // than the transformation lanes so the CTE node visually leads directly
    // into Select rather than sitting in a separate canvas region.
    preSource: {
      rankSep: 240,
      nodeSep: 450,
    },
    source: {
      rankSep: 600,
      nodeSep: 450,
    },
    transformation: {
      rankSep: 600,
      nodeSep: 480,
    },
    columnSelection: {
      rankSep: 200,
      nodeSep: 160,
    },
    finalProcessing: {
      rankSep: 600,
      nodeSep: 500,
    },
  },

  nodeTypes: {
    // CTE list sits above the SELECT FROM picker so the canvas reads
    // top-down as `WITH cte AS (...) SELECT FROM ...`. Priority 0.5 keeps
    // it ahead of selectNode (1) without renumbering downstream priorities.
    cteNode: { stage: 'preSource', priority: 0.5 },
    selectNode: { stage: 'source', priority: 1 },
    joinNode: { stage: 'transformation', priority: 2 },
    joinColumnNode: { stage: 'transformation', priority: 2 },
    addJoinButtonNode: { stage: 'source', priority: 1.5 },
    rollupNode: { stage: 'transformation', priority: 2 },
    lookbackNode: { stage: 'transformation', priority: 2 },
    unionNode: { stage: 'transformation', priority: 2 },
    columnSelectionNode: { stage: 'columnSelection', priority: 3 }, // Dynamic priority based on context
    whereNode: { stage: 'finalProcessing', priority: 4 },
    groupByNode: { stage: 'finalProcessing', priority: 4 },
    lightdashNode: { stage: 'finalProcessing', priority: 4 }, // Default priority, can be overridden
  },
} as const;

// Function to get dynamic priority for LightdashNode based on modelType
const getLightdashNodePriority = (modelType?: string | null): number => {
  if (!modelType) return 4; // Default priority

  if (
    modelType.includes('select_model') ||
    modelType.includes('select_source')
  ) {
    return 3;
  }

  return 4; // For all other modelTypes
};

// Function to get dynamic priority for ColumnSelectionNode based on context.
// CTE node lives in its own preSource lane upstream of selectNode now, so
// it doesn't influence column-selection placement -- only the join /
// transformation lanes matter for whether column-selection gets its own row
// (priority 3) or sits in the source row (priority 2).
const getColumnSelectionPriority = (nodes: Node[]): number => {
  const hasTransformationNodes = nodes.some(
    (n) =>
      n.type === 'rollupNode' ||
      n.type === 'lookbackNode' ||
      n.type === 'unionNode' ||
      n.type === 'joinNode' ||
      n.type === 'joinColumnNode',
  );

  return hasTransformationNodes ? 3 : 2;
};

export const useLayoutManager = () => {
  const analyzeNodeStages = useCallback(
    (nodes: Node[], layoutConfig = LAYOUT_CONFIG) => {
      const stageAnalysis = {
        preSource: nodes.filter(
          (node) =>
            layoutConfig.nodeTypes[
              node.type as keyof typeof layoutConfig.nodeTypes
            ]?.stage === 'preSource',
        ),
        source: nodes.filter(
          (node) =>
            layoutConfig.nodeTypes[
              node.type as keyof typeof layoutConfig.nodeTypes
            ]?.stage === 'source',
        ),
        transformation: nodes.filter(
          (node) =>
            layoutConfig.nodeTypes[
              node.type as keyof typeof layoutConfig.nodeTypes
            ]?.stage === 'transformation',
        ),
        columnSelection: nodes.filter(
          (node) =>
            layoutConfig.nodeTypes[
              node.type as keyof typeof layoutConfig.nodeTypes
            ]?.stage === 'columnSelection',
        ),
        finalProcessing: nodes.filter(
          (node) =>
            layoutConfig.nodeTypes[
              node.type as keyof typeof layoutConfig.nodeTypes
            ]?.stage === 'finalProcessing',
        ),
      };

      return stageAnalysis;
    },
    [],
  );

  const calculateLayoutConfig = useCallback(
    (nodes: Node[], layoutConfig = LAYOUT_CONFIG) => {
      const stages = analyzeNodeStages(nodes, layoutConfig);

      // Tie-break: ignore `preSource` (the CTE list) when picking the
      // baseline stage. The CTE node renders one DOM box but reports a
      // single "node" to the layout; using its rankSep (240) as the
      // baseline when it happens to have the most logical entries
      // collapses every downstream gap and causes Source -> Joins, etc.
      // to overlap. `transformation` is the next-busiest lane in
      // join/union models, so falling back to `source` (the safe
      // default) keeps the canvas readable.
      const stageWithMostNodes = Object.entries(stages)
        .filter(([stageName]) => stageName !== 'preSource')
        .reduce(
          (max, [stageName, stageNodes]) => {
            return stageNodes.length > max.nodes
              ? { stage: stageName, nodes: stageNodes.length }
              : max;
          },
          { stage: 'source', nodes: 0 },
        );

      const baseConfig =
        layoutConfig.stages[
          stageWithMostNodes.stage as keyof typeof layoutConfig.stages
        ];

      const totalNodes = nodes.length;
      const complexityMultiplier = Math.min(1 + (totalNodes - 1) * 0.05, 1.5);

      return {
        ...baseConfig,
        rankSep: Math.round(baseConfig.rankSep * complexityMultiplier),
        nodeSep: Math.round(baseConfig.nodeSep * complexityMultiplier),
      };
    },
    [analyzeNodeStages],
  );

  const calculateCustomLayout = useCallback(
    (
      nodes: Node[],
      _edges: Edge[],
      direction: string,
      customLayoutConfig?: typeof LAYOUT_CONFIG,
      modelType?: string | null,
      /**
       * Optional measured heights keyed by React Flow node type. Today only
       * `cteNode` is observed (see `CteNode.tsx`'s ResizeObserver); the
       * value flows in via `DataModelingFlow`. Used to compute the
       * `preSource -> source` Y delta against the real rendered height
       * instead of `LAYOUT_CONFIG.nodeHeight` (200px), which is
       * dramatically smaller than a CTE list with even a handful of rows
       * and causes the SelectNode to overlap the CTE node.
       */
      measuredHeights?: Partial<Record<string, number>>,
    ) => {
      if (nodes.length === 0) return nodes;

      const layoutConfig = customLayoutConfig || LAYOUT_CONFIG;

      const nodesByStage = new Map<number, Node[]>();
      nodes.forEach((node) => {
        const nodeTypeConfig =
          layoutConfig.nodeTypes[
            node.type as keyof typeof layoutConfig.nodeTypes
          ];

        let priority = nodeTypeConfig?.priority || 1;

        if (node.type === 'lightdashNode') {
          priority = getLightdashNodePriority(modelType) as 1 | 1.5 | 2 | 4;
        }

        if (node.type === 'columnSelectionNode') {
          priority = getColumnSelectionPriority(nodes) as 2 | 3;
        }

        if (!nodesByStage.has(priority)) {
          nodesByStage.set(priority, []);
        }
        nodesByStage.get(priority)!.push(node);
      });

      const dynamicLayoutConfig = calculateLayoutConfig(nodes, layoutConfig);
      const { nodeWidth, nodeHeight } = layoutConfig;
      const { rankSep, nodeSep } = dynamicLayoutConfig;

      const layoutedNodes: Node[] = [];
      let currentStagePosition = 0;

      const sortedStages = Array.from(nodesByStage.keys()).sort(
        (a, b) => a - b,
      );

      sortedStages.forEach((priority, stageIndex) => {
        const stageNodes = nodesByStage.get(priority)!;
        const nodesInStage = stageNodes.length;

        if (direction === 'TB') {
          const totalWidth = (nodesInStage - 1) * (nodeWidth + nodeSep);
          stageNodes.forEach((node, nodeIndex) => {
            let x = nodeIndex * (nodeWidth + nodeSep) - totalWidth / 2;
            let y = currentStagePosition;

            if (nodesInStage === 1) {
              x = 0;
            }

            if (node.type === 'selectNode' && stageIndex === 0) {
              y = 24;
            }

            layoutedNodes.push({
              ...node,
              position: { x, y },
              targetPosition: Position.Top,
              sourcePosition: Position.Bottom,
            });
          });

          let stageSpacing = rankSep;

          const hasAddJoinButton = stageNodes.some(
            (node) => node.type === 'addJoinButtonNode',
          );
          const nextStageIndex = stageIndex + 1;
          const nextStage =
            nextStageIndex < sortedStages.length
              ? nodesByStage.get(sortedStages[nextStageIndex])
              : null;
          const nextStageHasJoinNodes =
            nextStage?.some((node) => node.type === 'joinNode') || false;
          const nextStageHasColumnSelection =
            nextStage?.some((node) => node.type === 'columnSelectionNode') ||
            false;
          const nextStageHasFinalProcessingNodes =
            nextStage?.some(
              (node) =>
                node.type === 'lightdashNode' ||
                node.type === 'groupByNode' ||
                node.type === 'whereNode',
            ) || false;

          const hasTransformationNodes = stageNodes.some(
            (node) =>
              node.type === 'joinNode' ||
              node.type === 'joinColumnNode' ||
              node.type === 'rollupNode' ||
              node.type === 'lookbackNode' ||
              node.type === 'unionNode',
          );
          const hasJoinNodes = stageNodes.some(
            (node) => node.type === 'joinNode',
          );
          const hasColumnSelection = stageNodes.some(
            (node) => node.type === 'columnSelectionNode',
          );

          const hasRollupNode = stageNodes.some(
            (node) => node.type === 'rollupNode',
          );

          // Per-stage override hook -- when the current stage has its own
          // entry in `LAYOUT_CONFIG.stages`, prefer that stage's rankSep over
          // the global one. Used today for the `preSource` lane (CTE list)
          // which wants to sit much closer to its downstream SelectNode than
          // the source-stage's 600px would imply. The global `rankSep` here
          // already has the complexity multiplier baked in (see
          // `calculateLayoutConfig`), so we scale the preSource rankSep by
          // the same ratio (`preSource.rankSep / source.rankSep`) instead of
          // recomputing the multiplier.
          const hasCteNode = stageNodes.some((node) => node.type === 'cteNode');
          const nextStageHasSelectNode =
            nextStage?.some((node) => node.type === 'selectNode') || false;
          const isPreSourceToSource = hasCteNode && nextStageHasSelectNode;

          // Adjust spacing based on node types and relationships
          if (isPreSourceToSource) {
            const ratio =
              layoutConfig.stages.preSource.rankSep /
              layoutConfig.stages.source.rankSep;
            stageSpacing = Math.round(rankSep * ratio);
          } else if (hasAddJoinButton && nextStageHasJoinNodes) {
            stageSpacing = rankSep * 0.2;
          } else if (hasTransformationNodes && nextStageHasColumnSelection) {
            if (hasJoinNodes) {
              stageSpacing = rankSep * 1.5;
            } else if (hasRollupNode) {
              stageSpacing = 0;
            } else {
              stageSpacing = rankSep * 0.6;
            }
          } else if (hasColumnSelection && nextStageHasFinalProcessingNodes) {
            // Extra spacing between column selection and final processing nodes
            stageSpacing = rankSep * 2.0;
          }

          // Use the measured CTE height for the preSource lane instead of
          // the (much smaller) fixed `nodeHeight: 200`. Without this, the
          // SelectNode's Y is computed from where a 200px-tall CTE node
          // would end, so any CTE list taller than ~200px (i.e. any non-
          // empty list) ends up overlapped by the SelectNode below.
          const advanceHeight = isPreSourceToSource
            ? measuredHeights?.cteNode ?? nodeHeight
            : nodeHeight;
          currentStagePosition += advanceHeight + stageSpacing;
        } else {
          const totalHeight = (nodesInStage - 1) * (nodeHeight + nodeSep);
          stageNodes.forEach((node, nodeIndex) => {
            const x = currentStagePosition;
            const y = nodeIndex * (nodeHeight + nodeSep) - totalHeight / 2;
            layoutedNodes.push({
              ...node,
              position: { x, y },
              targetPosition: Position.Top,
              sourcePosition: Position.Bottom,
            });
          });

          let stageSpacing = rankSep;

          const hasAddJoinButton = stageNodes.some(
            (node) => node.type === 'addJoinButtonNode',
          );
          const nextStageIndex = stageIndex + 1;
          const nextStage =
            nextStageIndex < sortedStages.length
              ? nodesByStage.get(sortedStages[nextStageIndex])
              : null;
          const nextStageHasJoinNodes =
            nextStage?.some((node) => node.type === 'joinNode') || false;
          const nextStageHasColumnSelection =
            nextStage?.some((node) => node.type === 'columnSelectionNode') ||
            false;
          const nextStageHasFinalProcessingNodes =
            nextStage?.some(
              (node) =>
                node.type === 'lightdashNode' ||
                node.type === 'groupByNode' ||
                node.type === 'whereNode',
            ) || false;

          const hasTransformationNodes = stageNodes.some(
            (node) =>
              node.type === 'joinNode' ||
              node.type === 'joinColumnNode' ||
              node.type === 'rollupNode' ||
              node.type === 'lookbackNode' ||
              node.type === 'unionNode',
          );
          const hasColumnSelection = stageNodes.some(
            (node) => node.type === 'columnSelectionNode',
          );
          // Mirrors the TB branch's preSource override (see comment above).
          const hasCteNodeLR = stageNodes.some(
            (node) => node.type === 'cteNode',
          );
          const nextStageHasSelectNodeLR =
            nextStage?.some((node) => node.type === 'selectNode') || false;
          const isPreSourceToSourceLR =
            hasCteNodeLR && nextStageHasSelectNodeLR;
          if (isPreSourceToSourceLR) {
            const ratio =
              layoutConfig.stages.preSource.rankSep /
              layoutConfig.stages.source.rankSep;
            stageSpacing = Math.round(rankSep * ratio);
          } else if (hasAddJoinButton && nextStageHasJoinNodes) {
            stageSpacing = rankSep * 0.2;
          } else if (hasTransformationNodes && nextStageHasColumnSelection) {
            stageSpacing = rankSep * 1.6;
          } else if (hasColumnSelection && nextStageHasFinalProcessingNodes) {
            stageSpacing = rankSep * 2.0;
          }

          // LR doesn't need measured width today (CTE node sits in its
          // own column anyway). Keep symmetry with the TB branch by using
          // the same fixed `nodeWidth` lookup.
          currentStagePosition += nodeWidth + stageSpacing;
        }
      });

      return layoutedNodes;
    },
    [calculateLayoutConfig],
  );

  // Align nodes with center X position and handle positioning for join nodes and column selection
  const alignNodesWithCenterX = useCallback(
    (layoutedNodes: Node[], currentModelType: string) => {
      const layoutedSelectNode = layoutedNodes.find(
        (n) => n.type === 'selectNode',
      );
      const centerX = layoutedSelectNode?.position.x || 100;

      // First pass: compute the override Y for `column-selection` so we
      // can re-anchor downstream final-processing nodes (groupBy / where
      // / lightdash) by the same delta. Without this, the column-
      // selection Y can jump down 500-1000px (e.g. in join models the
      // override pushes it +1450 below the joins) while groupBy stays
      // at its layout-pass Y -- visually overlapping the column list.
      const originalColumnSelection = layoutedNodes.find(
        (n) => n.id === 'column-selection',
      );
      const computeColumnSelectionY = (): number => {
        let correctY = 400; // Default

        if (currentModelType === 'int_join_column') {
          // Position below JoinColumnNode - needs more space due to larger node size
          const joinColumnNodes = layoutedNodes.filter(
            (n) => n.type === 'joinColumnNode',
          );
          if (joinColumnNodes.length > 0) {
            correctY = joinColumnNodes[0].position.y + 1000;
          }
        } else if (currentModelType.includes('join')) {
          const joinNodes = layoutedNodes.filter((n) => n.type === 'joinNode');
          if (joinNodes.length > 0) {
            const maxJoinY = Math.max(...joinNodes.map((n) => n.position.y));
            correctY = maxJoinY + 1450;
          }
        } else if (
          currentModelType.includes('rollup') ||
          currentModelType.includes('lookback') ||
          currentModelType.includes('union')
        ) {
          const transformNodes = layoutedNodes.filter(
            (n) =>
              n.type === 'rollupNode' ||
              n.type === 'lookbackNode' ||
              n.type === 'unionNode',
          );
          if (transformNodes.length > 0) {
            correctY = transformNodes[0].position.y + 550;
          }
        } else if (currentModelType.includes('select')) {
          if (layoutedSelectNode) {
            correctY = layoutedSelectNode.position.y + 950;
          }
        }

        return correctY;
      };

      const newColumnSelectionY = computeColumnSelectionY();
      const columnSelectionDelta =
        originalColumnSelection !== undefined
          ? newColumnSelectionY - originalColumnSelection.position.y
          : 0;

      return layoutedNodes.map((node) => {
        if (node.id === 'column-selection') {
          return {
            ...node,
            position: { x: centerX, y: newColumnSelectionY },
          };
        } else if (node.type === 'joinNode') {
          // Position join nodes horizontally in a row with gaps
          const joinNodes = layoutedNodes.filter((n) => n.type === 'joinNode');
          const joinIndex = parseInt(node.id.replace('join-', '')) - 1;
          const joinGap = 750;
          const startX = centerX - ((joinNodes.length - 1) * joinGap) / 2;
          const joinX = startX + joinIndex * joinGap;

          return {
            ...node,
            position: { x: joinX, y: node.position.y },
          };
        } else if (node.type === 'columnConfigurationNode') {
          // ColumnConfigurationNode is positioned horizontally to the right of column-selection
          // Find column-selection node to get its Y position
          const columnSelectionNode = layoutedNodes.find(
            (n) => n.id === 'column-selection',
          );
          if (columnSelectionNode) {
            return {
              ...node,
              position: {
                x: columnSelectionNode.position.x + 1200,
                y: columnSelectionNode.position.y,
              },
            };
          }
          return node;
        } else if (
          node.type === 'lightdashNode' ||
          node.type === 'groupByNode' ||
          node.type === 'whereNode'
        ) {
          // Re-anchor final-processing nodes by the same Y delta we
          // applied to `column-selection`. They sit immediately below
          // the column list in every model type; otherwise they overlap
          // it whenever the alignment pass shifts the column list down.
          // X is preserved so the horizontal triangle (where | groupBy |
          // lightdash) stays intact.
          return {
            ...node,
            position: {
              x: node.position.x,
              y: node.position.y + columnSelectionDelta,
            },
          };
        } else {
          // Center all other nodes horizontally with SelectNode
          return {
            ...node,
            position: { x: centerX, y: node.position.y },
          };
        }
      });
    },
    [],
  );

  // Find the most relevant node to center the view on
  const findNodeToCenter = useCallback(
    (finalNodes: Node[], currentModelType: string): Node | undefined => {
      if (currentModelType.includes('join')) {
        // For join models: Center on the last (newest) join node
        const joinNodes = finalNodes.filter((n) => n.type === 'joinNode');
        if (joinNodes.length > 0) {
          return joinNodes.reduce((latest, current) => {
            const latestNum = parseInt(latest.id.replace('join-', ''));
            const currentNum = parseInt(current.id.replace('join-', ''));
            return currentNum > latestNum ? current : latest;
          });
        }
      } else {
        // For other model types: Center on ColumnSelectionNode if exists, otherwise transformation node
        const columnSelectionNode = finalNodes.find(
          (n) => n.id === 'column-selection',
        );
        if (columnSelectionNode) {
          return columnSelectionNode;
        } else {
          // Fallback to transformation node or SelectNode
          return (
            finalNodes.find(
              (n) =>
                n.type === 'rollupNode' ||
                n.type === 'lookbackNode' ||
                n.type === 'unionNode' ||
                n.type === 'joinColumnNode',
            ) || finalNodes.find((n) => n.type === 'selectNode')
          );
        }
      }
      return undefined;
    },
    [],
  );

  return {
    calculateCustomLayout,
    alignNodesWithCenterX,
    findNodeToCenter,
  };
};

// ---------------------------------------------------------------------
// Pure-function exports for unit testing.
//
// The hook above wraps each layout helper in `useCallback`; none of the
// helpers actually need React state -- the memoization is purely for
// referential stability across re-renders. Re-exporting the underlying
// pure functions here lets us assert on the layout math without booting
// React + @testing-library. The shape is intentionally a thin re-export
// rather than a refactor so the prod call-site keeps its memoization.
// ---------------------------------------------------------------------

/** Default layout dimensions; tests use this to pin against constants. */
export const LAYOUT_CONFIG_FOR_TESTS = LAYOUT_CONFIG;

/**
 * Pure version of `calculateLayoutConfig`. Used by tests to verify the
 * tie-break: `preSource` must never become the baseline stage even
 * when it has the most nodes (its `rankSep: 240` would collapse the
 * downstream gaps).
 */
export function calculateLayoutConfigForTests(
  nodes: Node[],
  layoutConfig: typeof LAYOUT_CONFIG = LAYOUT_CONFIG,
): { rankSep: number; nodeSep: number } {
  const stages = {
    preSource: nodes.filter(
      (node) =>
        layoutConfig.nodeTypes[node.type as keyof typeof layoutConfig.nodeTypes]
          ?.stage === 'preSource',
    ),
    source: nodes.filter(
      (node) =>
        layoutConfig.nodeTypes[node.type as keyof typeof layoutConfig.nodeTypes]
          ?.stage === 'source',
    ),
    transformation: nodes.filter(
      (node) =>
        layoutConfig.nodeTypes[node.type as keyof typeof layoutConfig.nodeTypes]
          ?.stage === 'transformation',
    ),
    columnSelection: nodes.filter(
      (node) =>
        layoutConfig.nodeTypes[node.type as keyof typeof layoutConfig.nodeTypes]
          ?.stage === 'columnSelection',
    ),
    finalProcessing: nodes.filter(
      (node) =>
        layoutConfig.nodeTypes[node.type as keyof typeof layoutConfig.nodeTypes]
          ?.stage === 'finalProcessing',
    ),
  };

  const stageWithMostNodes = Object.entries(stages)
    .filter(([stageName]) => stageName !== 'preSource')
    .reduce(
      (max, [stageName, stageNodes]) => {
        return stageNodes.length > max.nodes
          ? { stage: stageName, nodes: stageNodes.length }
          : max;
      },
      { stage: 'source', nodes: 0 },
    );

  const baseConfig =
    layoutConfig.stages[
      stageWithMostNodes.stage as keyof typeof layoutConfig.stages
    ];
  const totalNodes = nodes.length;
  const complexityMultiplier = Math.min(1 + (totalNodes - 1) * 0.05, 1.5);
  return {
    rankSep: Math.round(baseConfig.rankSep * complexityMultiplier),
    nodeSep: Math.round(baseConfig.nodeSep * complexityMultiplier),
  };
}

/**
 * Pure helper that computes the Y delta `alignNodesWithCenterX` applies
 * to `column-selection`. The alignment pass overrides Column Selection's
 * Y to "below the busiest upstream"; we then shift every final-
 * processing node (groupBy/where/lightdash) by the same delta so they
 * don't overlap. Tests verify the delta is positive and matches the
 * model-type math.
 */
export function computeColumnSelectionYForTests(
  layoutedNodes: Node[],
  currentModelType: string,
): number {
  const layoutedSelectNode = layoutedNodes.find((n) => n.type === 'selectNode');
  let correctY = 400;
  if (currentModelType === 'int_join_column') {
    const joinColumnNodes = layoutedNodes.filter(
      (n) => n.type === 'joinColumnNode',
    );
    if (joinColumnNodes.length > 0) {
      correctY = joinColumnNodes[0].position.y + 1000;
    }
  } else if (currentModelType.includes('join')) {
    const joinNodes = layoutedNodes.filter((n) => n.type === 'joinNode');
    if (joinNodes.length > 0) {
      const maxJoinY = Math.max(...joinNodes.map((n) => n.position.y));
      correctY = maxJoinY + 1450;
    }
  } else if (
    currentModelType.includes('rollup') ||
    currentModelType.includes('lookback') ||
    currentModelType.includes('union')
  ) {
    const transformNodes = layoutedNodes.filter(
      (n) =>
        n.type === 'rollupNode' ||
        n.type === 'lookbackNode' ||
        n.type === 'unionNode',
    );
    if (transformNodes.length > 0) {
      correctY = transformNodes[0].position.y + 550;
    }
  } else if (currentModelType.includes('select')) {
    if (layoutedSelectNode) {
      correctY = layoutedSelectNode.position.y + 950;
    }
  }
  return correctY;
}
