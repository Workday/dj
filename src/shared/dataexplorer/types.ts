export interface CompilationLog {
  level: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  isProgress?: boolean;
}

export interface QueryResults {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime?: number;
  modelName: string;
  error?: string;
}

// DBT Compilation APIs (these are in dbt.ts service)
export type DbtCompilationApi =
  | {
      type: 'dbt-check-compiled-status';
      service: 'dbt';
      request: { modelName: string; projectName: string };
      response: {
        isCompiled: boolean;
        compiledPath?: string;
        lastCompiled?: string;
      };
    }
  | {
      type: 'dbt-check-model-outdated';
      service: 'dbt';
      request: { modelName: string; projectName: string };
      response: {
        isOutdated: boolean;
        hasCompiledFile: boolean;
        reason?: string;
      };
    }
  | {
      type: 'dbt-compile-with-logs';
      service: 'dbt';
      request: { modelName: string; projectName: string };
      response: { success: boolean };
    }
  | {
      type: 'dbt-model-compile';
      service: 'dbt';
      request: { modelName: string; projectName: string };
      response: { success: boolean; message?: string };
    };

// Data Explorer UI APIs
export type DataExplorerUiApi =
  | {
      type: 'data-explorer-open-with-model';
      service: 'data-explorer';
      request: { modelName: string; projectName: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-compile-model';
      service: 'data-explorer';
      request: { pathSystem: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-preview-model';
      service: 'data-explorer';
      request: { pathSystem: string };
      response: { success: boolean };
    }
  | {
      type: 'data-explorer-open-column-lineage';
      service: 'data-explorer';
      request: { pathSystem: string };
      response: { success: boolean };
    };

// Re-export model lineage types for convenience
export type {
  LineageData,
  LineageNode,
  MaterializationType,
  ModelLineageApi,
} from '@shared/modellineage/types';
