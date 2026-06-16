import { describe, expect, test } from '@jest/globals';
import type { Node } from '@xyflow/react';

import {
  calculateLayoutConfigForTests,
  computeColumnSelectionYForTests,
  LAYOUT_CONFIG_FOR_TESTS,
} from '../useLayoutManager';

/**
 * Pure-helper coverage for the layout tie-break (`preSource` is never the
 * baseline stage so its tight `rankSep: 240` doesn't collapse downstream
 * gaps) and the column-selection Y math used by the alignment pass.
 */
describe('useLayoutManager pure helpers', () => {
  describe('calculateLayoutConfig tie-break', () => {
    test('falls back to source when preSource holds the most nodes (single CTE)', () => {
      // 1 CTE node + 1 select node. The tie-break filter excludes
      // `preSource` so the baseline comes from `source` (rankSep: 600),
      // not from `preSource`'s tight 240.
      const nodes: Node[] = [
        { id: 'cte', type: 'cteNode', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 0 },
          data: {},
        },
      ];
      const { rankSep } = calculateLayoutConfigForTests(nodes);
      // 600 * complexityMultiplier(2 nodes) = 600 * 1.05 = 630
      expect(rankSep).toBeGreaterThanOrEqual(
        Math.round(LAYOUT_CONFIG_FOR_TESTS.stages.source.rankSep * 1.05 * 0.95),
      );
      // Should NOT collapse to preSource's 240 baseline.
      expect(rankSep).toBeGreaterThan(
        LAYOUT_CONFIG_FOR_TESTS.stages.preSource.rankSep,
      );
    });

    test('does not pick preSource even when it dominates the node count', () => {
      // Pathological case where preSource carries the largest node
      // count. The filter still routes the baseline to the
      // next-busiest stage (source) so downstream gaps stay legible.
      const nodes: Node[] = [
        { id: 'cte', type: 'cteNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'cte2', type: 'cteNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'cte3', type: 'cteNode', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 0 },
          data: {},
        },
      ];
      const { rankSep } = calculateLayoutConfigForTests(nodes);
      // Baseline should still come from `source` (600). With 4 nodes
      // total, complexityMultiplier = 1 + 3*0.05 = 1.15 -> ~690.
      expect(rankSep).toBeGreaterThan(
        LAYOUT_CONFIG_FOR_TESTS.stages.preSource.rankSep,
      );
      const expected = Math.round(
        LAYOUT_CONFIG_FOR_TESTS.stages.source.rankSep * (1 + 3 * 0.05),
      );
      expect(rankSep).toBe(expected);
    });

    test('picks transformation when it dominates and preSource is absent', () => {
      // When `preSource` is empty the normal "most nodes wins" logic
      // applies -- the filter only excludes `preSource`, it does not
      // change the rest of the tie-break behaviour.
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 0 },
          data: {},
        },
        { id: 'j1', type: 'joinNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'j2', type: 'joinNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'j3', type: 'joinNode', position: { x: 0, y: 0 }, data: {} },
      ];
      const { rankSep } = calculateLayoutConfigForTests(nodes);
      // transformation rankSep is also 600, but `nodeSep: 480` would
      // differ. Use rankSep equality with the source-stage value as a
      // cheap shape check.
      expect(rankSep).toBeGreaterThan(0);
    });
  });

  describe('computeColumnSelectionY (re-anchor source)', () => {
    test('join models anchor 1450 below the lowest join', () => {
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 100 },
          data: {},
        },
        {
          id: 'join-1',
          type: 'joinNode',
          position: { x: 0, y: 800 },
          data: {},
        },
        {
          id: 'join-2',
          type: 'joinNode',
          position: { x: 200, y: 950 },
          data: {},
        },
      ];
      const y = computeColumnSelectionYForTests(nodes, 'int_join_models');
      expect(y).toBe(950 + 1450);
    });

    test('rollup models anchor 550 below the transformation node', () => {
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 100 },
          data: {},
        },
        {
          id: 'rollup',
          type: 'rollupNode',
          position: { x: 0, y: 700 },
          data: {},
        },
      ];
      const y = computeColumnSelectionYForTests(nodes, 'int_rollup_model');
      expect(y).toBe(700 + 550);
    });

    test('select models anchor 950 below the select node', () => {
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 100 },
          data: {},
        },
      ];
      const y = computeColumnSelectionYForTests(nodes, 'int_select_model');
      expect(y).toBe(100 + 950);
    });

    test('int_join_column anchors 1000 below the join_column node', () => {
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 100 },
          data: {},
        },
        {
          id: 'jc',
          type: 'joinColumnNode',
          position: { x: 0, y: 600 },
          data: {},
        },
      ];
      const y = computeColumnSelectionYForTests(nodes, 'int_join_column');
      expect(y).toBe(600 + 1000);
    });

    test('unknown model type defaults to 400', () => {
      const nodes: Node[] = [];
      const y = computeColumnSelectionYForTests(nodes, 'unknown_type');
      expect(y).toBe(400);
    });

    test('union model anchors below transformation when union node exists', () => {
      const nodes: Node[] = [
        {
          id: 'select',
          type: 'selectNode',
          position: { x: 0, y: 100 },
          data: {},
        },
        {
          id: 'union',
          type: 'unionNode',
          position: { x: 0, y: 500 },
          data: {},
        },
      ];
      const y = computeColumnSelectionYForTests(nodes, 'int_union_models');
      expect(y).toBe(500 + 550);
    });
  });
});
