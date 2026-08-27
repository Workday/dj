import { describe, expect, test } from '@jest/globals';

import {
  buildPythonUpstreamGraph,
  parsePythonModelProperties,
} from '@shared/pymodel/python-model-lineage';
import type { LineageNode } from '@shared/modellineage/types';

describe('parsePythonModelProperties', () => {
  test('returns null when python_model_name is missing', () => {
    expect(parsePythonModelProperties({})).toBeNull();
  });

  test('parses structured upstream_sources JSON', () => {
    expect(
      parsePythonModelProperties({
        python_model_name: 'model_d',
        python_model_upstream_sources:
          '[{"type":"trino","value":"opus_python_source.model_c"}]',
      }),
    ).toEqual({
      pythonModelName: 'model_d',
      upstreamSources: [{ type: 'trino', value: 'opus_python_source.model_c' }],
      namespace: undefined,
      table: undefined,
      description: undefined,
    });
  });

  test('parses legacy comma-separated upstream_sources', () => {
    expect(
      parsePythonModelProperties({
        python_model_name: 'model_c',
        python_model_upstream_sources: 'schema.b, schema.a',
      }),
    ).toEqual({
      pythonModelName: 'model_c',
      upstreamSources: [
        { type: 'trino', value: 'schema.b' },
        { type: 'trino', value: 'schema.a' },
      ],
      namespace: undefined,
      table: undefined,
      description: undefined,
    });
  });
});

describe('buildPythonUpstreamGraph', () => {
  const sourceD: LineageNode = {
    id: 'source.project.schema.model_d',
    name: 'model_d',
    type: 'source',
    path: '',
    schema: 'opus_python_source',
    database: 'glue',
  };

  test('walks a multi-hop Python model chain D -> C -> B,A', async () => {
    const propsByTable: Record<string, Record<string, string>> = {
      'glue.opus_python_source.model_d': {
        python_model_name: 'model_d',
        python_model_upstream_sources:
          '[{"type":"trino","value":"opus_python_source.model_c"}]',
      },
      'glue.opus_python_source.model_c': {
        python_model_name: 'model_c',
        python_model_upstream_sources:
          '[{"type":"trino","value":"opus_python_source.model_b"},{"type":"external","value":"backstage_api"}]',
      },
      'glue.opus_python_source.model_b': {
        python_model_name: 'model_b',
      },
    };

    const fetchProperties = async (
      catalog: string,
      schema: string,
      table: string,
    ) => {
      const key = `${catalog}.${schema}.${table}`;
      const props = propsByTable[key];
      if (!props) {
        throw new Error(`missing ${key}`);
      }
      return props;
    };

    const { nodes, edges } = await buildPythonUpstreamGraph({
      startSourceNodes: [sourceD],
      fetchProperties,
    });

    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds).toContain('python.model_d');
    expect(nodeIds).toContain('python.model_c');
    expect(nodeIds).toContain('python.model_b');
    expect(nodeIds).toContain('python.external.backstage_api');

    expect(edges).toEqual(
      expect.arrayContaining([
        { pythonModelNodeId: 'python.model_d', sourceNodeId: sourceD.id },
        { pythonModelNodeId: 'python.model_c', sourceNodeId: 'python.model_d' },
        { pythonModelNodeId: 'python.model_b', sourceNodeId: 'python.model_c' },
        {
          pythonModelNodeId: 'python.external.backstage_api',
          sourceNodeId: 'python.model_c',
        },
      ]),
    );

    const modelC = nodes.find((n) => n.id === 'python.model_c');
    expect(modelC?.hasOwnUpstream).toBe(true);
  });

  test('detects cycles without infinite loop', async () => {
    const propsByTable: Record<string, Record<string, string>> = {
      'glue.s.t1': {
        python_model_name: 'm1',
        python_model_upstream_sources:
          '[{"type":"trino","value":"s.t2"}]',
      },
      'glue.s.t2': {
        python_model_name: 'm2',
        python_model_upstream_sources:
          '[{"type":"trino","value":"s.t1"}]',
      },
    };

    const source: LineageNode = {
      id: 'source.s.t1',
      name: 't1',
      type: 'source',
      path: '',
      schema: 's',
      database: 'glue',
    };

    const { nodes } = await buildPythonUpstreamGraph({
      startSourceNodes: [source],
      fetchProperties: async (catalog, schema, table) =>
        propsByTable[`${catalog}.${schema}.${table}`],
    });

    expect(nodes.map((n) => n.id).sort()).toEqual(['python.m1', 'python.m2']);
  });

  test('skips non-python manifest sources without properties', async () => {
    const source: LineageNode = {
      id: 'source.s.regular_table',
      name: 'regular_table',
      type: 'source',
      path: '',
      schema: 's',
      database: 'glue',
    };

    const { nodes, edges } = await buildPythonUpstreamGraph({
      startSourceNodes: [source],
      fetchProperties: async () => {
        throw new Error('no properties');
      },
    });

    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  test('creates trino ref leaf when upstream table has no python metadata', async () => {
    const source: LineageNode = {
      id: 'source.s.out',
      name: 'out',
      type: 'source',
      path: '',
      schema: 's',
      database: 'glue',
    };

    const propsByTable: Record<string, Record<string, string>> = {
      'glue.s.out': {
        python_model_name: 'out_model',
        python_model_upstream_sources:
          '[{"type":"trino","value":"s.raw_table"}]',
      },
    };

    const { nodes, edges } = await buildPythonUpstreamGraph({
      startSourceNodes: [source],
      fetchProperties: async (catalog, schema, table) => {
        const key = `${catalog}.${schema}.${table}`;
        const props = propsByTable[key];
        if (!props) {
          throw new Error('no properties');
        }
        return props;
      },
    });

    expect(nodes.map((n) => n.id)).toContain('python.trino.s.raw_table');
    expect(edges).toEqual(
      expect.arrayContaining([
        {
          pythonModelNodeId: 'python.trino.s.raw_table',
          sourceNodeId: 'python.out_model',
        },
      ]),
    );
  });
});
