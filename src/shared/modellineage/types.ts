export type MaterializationType =
  | 'ephemeral'
  | 'incremental'
  | 'view'
  | 'table';

export interface PythonModelNodeMetadata {
  modelName: string;
  modelType: string;
  namespace?: string;
  tableName?: string;
  description?: string;
  upstreamSources?: string[];
}

export interface LineageNode {
  id: string; // manifest unique_id
  name: string; // model name
  type: 'model' | 'source' | 'seed' | 'python';
  description?: string;
  tags?: string[];
  path: string; // relative file path
  pathSystem?: string; // full system file path
  schema?: string;
  database?: string;
  materialized?: MaterializationType;
  testCount?: number;
  pythonModelMetadata?: PythonModelNodeMetadata;
  // Whether this node has its own upstream/downstream models (for expand buttons)
  hasOwnUpstream?: boolean;
  hasOwnDownstream?: boolean;
}

export interface PythonModelEdge {
  pythonModelNodeId: string;
  sourceNodeId: string;
}

export interface LineageData {
  current: LineageNode;
  upstream: LineageNode[];
  downstream: LineageNode[];
  pythonModelEdges?: PythonModelEdge[];
}

export type ModelLineageApi =
  | {
      type: 'data-explorer-get-model-lineage';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: LineageData;
    }
  | {
      type: 'data-explorer-execute-query';
      service: 'model-lineage';
      request: { modelName: string; projectName: string; limit?: number };
      response: {
        columns: string[];
        rows: unknown[][];
        rowCount: number;
        executionTime?: number;
      };
    }
  | {
      type: 'data-explorer-ready';
      service: 'model-lineage';
      request: null;
      response: void;
    }
  | {
      type: 'data-explorer-detect-active-model';
      service: 'model-lineage';
      request: null;
      response: { modelName: string; projectName: string } | null;
    }
  | {
      type: 'data-explorer-open-model-file';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-get-compiled-sql';
      service: 'model-lineage';
      request: { modelName: string; projectName: string };
      response: {
        sql: string | null;
        compiledPath?: string;
        lastModified?: number; // Unix timestamp in milliseconds
      };
    };
