import { create } from 'zustand';

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
}

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

export interface QueryResults {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  executionTime?: number;
  modelName: string;
  error?: string;
}

export interface CompilationLog {
  level: 'info' | 'success' | 'error' | 'warning';
  message: string;
  timestamp: string;
  isProgress?: boolean;
}

export interface ModelColumn {
  name: string;
  data_type?: string;
  description?: string;
}

interface DataExplorerStore {
  // State
  activeModel: { modelName: string; projectName: string } | null;
  lineageData: LineageData | null;
  queryResults: QueryResults | null;
  isLoadingLineage: boolean;
  isExecutingQuery: boolean;
  error: string | null;
  selectedNodeForQuery: string | null;

  // Compilation state
  compilationLogs: CompilationLog[];
  isCompiling: boolean;
  compilationSuccess: boolean | null;
  pendingQueryAfterCompile: { modelName: string; projectName: string } | null;
  isStandaloneCompilation: boolean;
  isQueryAfterCompile: boolean; // Indicates query is running after compilation (for UI transition)

  // Expansion state - tracks which nodes have been expanded
  expandedUpstream: Set<string>; // Set of node IDs that have upstream expanded
  expandedDownstream: Set<string>; // Set of node IDs that have downstream expanded
  additionalNodes: LineageNode[]; // Additional nodes from expansion
  additionalEdges: Array<{ source: string; target: string }>; // Additional edges

  // Model columns state
  modelColumns: ModelColumn[] | null;
  isLoadingColumns: boolean;
  selectedModelForColumns: string | null;

  // Compiled SQL state
  compiledSql: string | null;
  isLoadingCompiledSql: boolean;
  compiledSqlModelName: string | null;
  lastCompiledTime: number | null; // Unix timestamp in milliseconds

  // Split mode state
  isSplitMode: boolean;
  selectedModelFilePath: string | null;

  // Actions
  setActiveModel: (
    model: { modelName: string; projectName: string } | null,
  ) => void;
  fetchLineage: (modelName: string, projectName: string) => Promise<void>;
  executeQuery: (
    modelName: string,
    projectName: string,
    limit?: number,
  ) => Promise<void>;
  compileModel: (modelName: string, projectName: string) => Promise<void>;
  openModelFile: (modelName: string, projectName: string) => Promise<void>;
  clearResults: () => void;
  clearError: () => void;
  notifyReady: () => Promise<void>;
  detectActiveModel: () => Promise<{
    modelName: string;
    projectName: string;
  } | null>;

  // Compilation actions
  checkCompiledStatus: (
    modelName: string,
    projectName: string,
  ) => Promise<{
    isCompiled: boolean;
    compiledPath?: string;
    lastCompiled?: string;
  }>;
  checkModelOutdated: (
    modelName: string,
    projectName: string,
  ) => Promise<{
    isOutdated: boolean;
    hasCompiledFile: boolean;
    reason?: string;
  }>;
  compileModelWithLogs: (
    modelName: string,
    projectName: string,
    runQueryAfter: boolean,
  ) => Promise<void>;
  addCompilationLog: (log: CompilationLog) => void;
  clearCompilationLogs: () => void;
  setCompilationComplete: (success: boolean) => Promise<void>;

  // Expansion actions
  expandUpstreamNode: (modelName: string, projectName: string) => Promise<void>;
  expandDownstreamNode: (
    modelName: string,
    projectName: string,
  ) => Promise<void>;
  isNodeUpstreamExpanded: (nodeId: string) => boolean;
  isNodeDownstreamExpanded: (nodeId: string) => boolean;
  resetExpansion: () => void;

  // Model columns actions
  fetchModelColumns: (filePath: string, modelName: string) => Promise<void>;
  fetchSourceColumns: (filePath: string, tableName: string) => Promise<void>;
  clearModelColumns: () => void;

  // Compiled SQL actions
  fetchCompiledSql: (modelName: string, projectName: string) => Promise<void>;
  clearCompiledSql: () => void;

  // Split mode actions
  setSplitMode: (value: boolean) => void;

  // Store the API handler

  _apiHandler: any;

  setApiHandler: (handler: any) => void;
}

export const useDataExplorerStore = create<DataExplorerStore>((set, get) => ({
  // Initial state
  activeModel: null,
  lineageData: null,
  queryResults: null,
  isLoadingLineage: false,
  isExecutingQuery: false,
  error: null,
  selectedNodeForQuery: null,
  _apiHandler: null,

  // Compilation state
  compilationLogs: [],
  isCompiling: false,
  compilationSuccess: null,
  pendingQueryAfterCompile: null,
  isStandaloneCompilation: false,
  isQueryAfterCompile: false,

  // Expansion state
  expandedUpstream: new Set<string>(),
  expandedDownstream: new Set<string>(),
  additionalNodes: [],
  additionalEdges: [],

  // Model columns state
  modelColumns: null,
  isLoadingColumns: false,
  selectedModelForColumns: null,
  selectedModelFilePath: null,

  // Compiled SQL state
  compiledSql: null,
  isLoadingCompiledSql: false,
  compiledSqlModelName: null,
  lastCompiledTime: null,

  // Split mode state - default to true (split mode on)
  isSplitMode: true,

  // Actions

  setApiHandler: (handler: any) => {
    console.log('[DataExplorerStore] Setting API handler:', !!handler);
    set({ _apiHandler: handler });
  },

  setActiveModel: (model) => {
    set({ activeModel: model, error: null });
  },

  fetchLineage: async (modelName: string, projectName: string) => {
    const { _apiHandler, resetExpansion } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    console.log(
      '[DataExplorerStore] Fetching lineage for:',
      modelName,
      projectName,
    );

    // Reset expansion state when fetching new lineage
    resetExpansion();

    set({ isLoadingLineage: true, error: null });
    try {
      const response = (await _apiHandler({
        type: 'data-explorer-get-model-lineage',
        request: { modelName, projectName },
      })) as LineageData;

      console.log('[DataExplorerStore] Lineage response:', response);
      set({
        lineageData: response,
        isLoadingLineage: false,
        activeModel: { modelName, projectName },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch lineage';
      console.error('[DataExplorerStore] Error fetching lineage:', error);
      set({
        error: errorMessage,
        isLoadingLineage: false,
        lineageData: null,
      });
    }
  },

  executeQuery: async (modelName: string, projectName: string, limit = 500) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    console.log(
      '[DataExplorerStore] Executing query for:',
      modelName,
      projectName,
      'limit:',
      limit,
    );
    // Clear previous results and errors before new query
    set({
      isExecutingQuery: true,
      error: null,
      queryResults: null,
      selectedNodeForQuery: modelName,
    });
    try {
      const response = (await _apiHandler({
        type: 'data-explorer-execute-query',
        request: { modelName, projectName, limit },
      })) as Omit<QueryResults, 'modelName'>;

      console.log('[DataExplorerStore] Query executed successfully:', response);
      set({
        queryResults: {
          ...response,
          modelName,
        },
        isExecutingQuery: false,
      });
    } catch (error) {
      // Extract error message - preserve full Trino error details
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Failed to execute query';

      console.error('[DataExplorerStore] Error executing query:', {
        modelName,
        projectName,
        error,
        errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: typeof error,
      });

      // Check if compilation is required - auto-compile then retry
      if (errorMessage.includes('COMPILE_REQUIRED')) {
        console.log(
          '[DataExplorerStore] Compilation required, auto-compiling...',
          modelName,
        );
        set({ isExecutingQuery: false });

        // Trigger compilation with runQueryAfter=true
        // This will compile, then run the query after success
        await get().compileModelWithLogs(modelName, projectName, true);
        return;
      }

      set({
        error: errorMessage,
        isExecutingQuery: false,
        queryResults: {
          columns: [],
          rows: [],
          rowCount: 0,
          modelName,
          error: errorMessage,
        },
      });
    }
  },

  compileModel: async (modelName: string, projectName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('API handler not set');
      return;
    }

    try {
      await _apiHandler({
        type: 'dbt-model-compile',
        request: { modelName, projectName },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to compile model';
      set({ error: errorMessage });
      console.error('Error compiling model:', error);
      throw error;
    }
  },

  openModelFile: async (modelName: string, projectName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('API handler not set');
      return;
    }

    try {
      await _apiHandler({
        type: 'data-explorer-open-model-file',
        request: { modelName, projectName },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to open model file';
      set({ error: errorMessage });
      console.error('Error opening model file:', error);
    }
  },

  clearResults: () => {
    set({ queryResults: null, selectedNodeForQuery: null, error: null });
  },

  clearError: () => {
    set({ error: null });
  },

  notifyReady: async () => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      return;
    }

    try {
      await _apiHandler({
        type: 'data-explorer-ready',
        request: null,
      });
    } catch (error) {
      console.error('Error notifying ready:', error);
    }
  },

  detectActiveModel: async () => {
    const { _apiHandler, setActiveModel, fetchLineage } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return null;
    }

    console.log('[DataExplorerStore] Detecting active model manually');
    try {
      const activeModel = (await _apiHandler({
        type: 'data-explorer-detect-active-model',
        request: null,
      })) as { modelName: string; projectName: string } | null;

      console.log('[DataExplorerStore] Detected active model:', activeModel);

      if (activeModel) {
        // Set the active model explicitly
        setActiveModel(activeModel);
        // Fetch the lineage for this model
        await fetchLineage(activeModel.modelName, activeModel.projectName);
      }

      return activeModel;
    } catch (error) {
      console.error('[DataExplorerStore] Error detecting active model:', error);
      return null;
    }
  },

  // Compilation actions
  checkCompiledStatus: async (modelName: string, projectName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('API handler not set');
      return { isCompiled: false };
    }

    try {
      const response = (await _apiHandler({
        type: 'dbt-check-compiled-status',
        request: { modelName, projectName },
      })) as {
        isCompiled: boolean;
        compiledPath?: string;
        lastCompiled?: string;
      };
      return response;
    } catch (error) {
      console.error('Error checking compiled status:', error);
      return { isCompiled: false };
    }
  },

  checkModelOutdated: async (modelName: string, projectName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('API handler not set');
      return { isOutdated: true, hasCompiledFile: false };
    }

    try {
      const response = (await _apiHandler({
        type: 'dbt-check-model-outdated',
        request: { modelName, projectName },
      })) as {
        isOutdated: boolean;
        hasCompiledFile: boolean;
        reason?: string;
      };
      return response;
    } catch (error) {
      console.error('Error checking model outdated status:', error);
      return { isOutdated: true, hasCompiledFile: false };
    }
  },

  compileModelWithLogs: async (
    modelName: string,
    projectName: string,
    runQueryAfter: boolean,
  ) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('API handler not set');
      return;
    }

    console.log(
      '[DataExplorerStore] Starting compilation with logs for:',
      modelName,
    );
    set({
      isCompiling: true,
      compilationSuccess: null,
      compilationLogs: [],
      error: null,
      pendingQueryAfterCompile: runQueryAfter
        ? { modelName, projectName }
        : null,
      isStandaloneCompilation: !runQueryAfter,
    });

    try {
      await _apiHandler({
        type: 'dbt-compile-with-logs',
        request: { modelName, projectName },
      });
      // Success is handled by setCompilationComplete called from message listener
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to compile model';
      console.error('[DataExplorerStore] Error compiling model:', error);
      set({
        isCompiling: false,
        compilationSuccess: false,
        error: errorMessage,
      });
      // Don't add log here if it was already added by the backend message
      // But we can't easily know that, so we might duplicate.
      // However, if the backend fails BEFORE sending message (e.g. timeout), we need this.
      // Let's rely on backend sending the log for spawn errors now.
      const currentLogs = get().compilationLogs;
      const lastLog =
        currentLogs.length > 0 ? currentLogs[currentLogs.length - 1] : null;

      // Only add the log if it's not already the last log message
      // This prevents duplicates while ensuring the error is shown even if message delivery failed
      if (lastLog?.message !== errorMessage) {
        get().addCompilationLog({
          level: 'error',
          message: errorMessage,
          timestamp: new Date().toISOString(),
        });
      }
    }
  },

  addCompilationLog: (log: CompilationLog) => {
    set((state) => ({
      compilationLogs: [...state.compilationLogs, log],
    }));
  },

  clearCompilationLogs: () => {
    set({
      compilationLogs: [],
      isCompiling: false,
      compilationSuccess: null,
      pendingQueryAfterCompile: null,
      isStandaloneCompilation: false,
      isQueryAfterCompile: false,
    });
  },

  setCompilationComplete: async (success: boolean) => {
    console.log('[DataExplorerStore] Compilation complete:', success);
    set({ isCompiling: false, compilationSuccess: success });

    // If compilation succeeded and we have a pending query, execute it
    const {
      pendingQueryAfterCompile,
      executeQuery,
      activeModel,
      fetchLineage,
    } = get();
    if (success && pendingQueryAfterCompile) {
      console.log('[DataExplorerStore] Auto-executing query after compilation');

      // Set flag to indicate this is a query after compile (for UI transition)
      set({ isQueryAfterCompile: true });

      // Add small delay to ensure file system writes are complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        await executeQuery(
          pendingQueryAfterCompile.modelName,
          pendingQueryAfterCompile.projectName,
        );
      } catch (error) {
        console.error(
          '[DataExplorerStore] Error executing query after compilation:',
          error,
        );
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to execute query after compilation',
        });
      }
      // Clear flags after query completes (success or failure)
      set({ pendingQueryAfterCompile: null, isQueryAfterCompile: false });
    } else if (success && activeModel) {
      // If no pending query but compilation succeeded, fetch lineage
      // This handles the auto-compile case when Data Explorer first opens
      console.log(
        '[DataExplorerStore] Fetching lineage after auto-compilation',
      );

      // Add small delay to ensure manifest is refreshed on backend
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        await fetchLineage(activeModel.modelName, activeModel.projectName);
      } catch (error) {
        console.error(
          '[DataExplorerStore] Error fetching lineage after compilation:',
          error,
        );
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch lineage after compilation',
        });
      }
    }
  },

  // Expansion actions
  expandUpstreamNode: async (modelName: string, projectName: string) => {
    const { _apiHandler, expandedUpstream, additionalNodes, additionalEdges } =
      get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    console.log('[DataExplorerStore] Expanding upstream for:', modelName);
    try {
      const response = (await _apiHandler({
        type: 'data-explorer-get-model-lineage',
        request: { modelName, projectName },
      })) as LineageData;

      const existingNodeIds = new Set([
        ...additionalNodes.map((n) => n.id),
        get().lineageData?.current.id,
        ...(get().lineageData?.upstream.map((n) => n.id) || []),
        ...(get().lineageData?.downstream.map((n) => n.id) || []),
      ]);

      const newNodes = response.upstream.filter(
        (n) => !existingNodeIds.has(n.id),
      );

      // Build python model edge lookup so python nodes connect to their source, not current
      const pythonModelEdgeMap = new Map<string, string>();
      if (response.pythonModelEdges) {
        for (const pe of response.pythonModelEdges) {
          pythonModelEdgeMap.set(pe.pythonModelNodeId, pe.sourceNodeId);
        }
      }

      const newEdges = response.upstream
        .filter((n) => n.type !== 'python')
        .map((upstream) => ({
          source: upstream.id,
          target: response.current.id,
        }));

      // Add python model -> source edges
      for (const [pythonModelId, sourceId] of pythonModelEdgeMap) {
        newEdges.push({ source: pythonModelId, target: sourceId });
      }

      const newExpandedUpstream = new Set(expandedUpstream);
      newExpandedUpstream.add(response.current.id);

      set({
        additionalNodes: [...additionalNodes, ...newNodes],
        additionalEdges: [...additionalEdges, ...newEdges],
        expandedUpstream: newExpandedUpstream,
      });
    } catch (error) {
      console.error('[DataExplorerStore] Error expanding upstream:', error);
    }
  },

  expandDownstreamNode: async (modelName: string, projectName: string) => {
    const {
      _apiHandler,
      expandedDownstream,
      additionalNodes,
      additionalEdges,
    } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    console.log('[DataExplorerStore] Expanding downstream for:', modelName);
    try {
      const response = (await _apiHandler({
        type: 'data-explorer-get-model-lineage',
        request: { modelName, projectName },
      })) as LineageData;

      // Add new downstream nodes that don't already exist
      const existingNodeIds = new Set([
        ...additionalNodes.map((n) => n.id),
        get().lineageData?.current.id,
        ...(get().lineageData?.upstream.map((n) => n.id) || []),
        ...(get().lineageData?.downstream.map((n) => n.id) || []),
      ]);

      const newNodes = response.downstream.filter(
        (n) => !existingNodeIds.has(n.id),
      );
      const newEdges = response.downstream.map((downstream) => ({
        source: response.current.id,
        target: downstream.id,
      }));

      // Mark this node as expanded
      const newExpandedDownstream = new Set(expandedDownstream);
      newExpandedDownstream.add(response.current.id);

      set({
        additionalNodes: [...additionalNodes, ...newNodes],
        additionalEdges: [...additionalEdges, ...newEdges],
        expandedDownstream: newExpandedDownstream,
      });
    } catch (error) {
      console.error('[DataExplorerStore] Error expanding downstream:', error);
    }
  },

  isNodeUpstreamExpanded: (nodeId: string) => {
    return get().expandedUpstream.has(nodeId);
  },

  isNodeDownstreamExpanded: (nodeId: string) => {
    return get().expandedDownstream.has(nodeId);
  },

  resetExpansion: () => {
    set({
      expandedUpstream: new Set<string>(),
      expandedDownstream: new Set<string>(),
      additionalNodes: [],
      additionalEdges: [],
    });
  },

  // Model columns actions
  fetchModelColumns: async (filePath: string, modelName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    console.log(
      '[DataExplorerStore] Fetching columns for:',
      modelName,
      'filePath:',
      filePath,
    );
    set({
      isLoadingColumns: true,
      error: null,
      selectedModelForColumns: modelName,
      selectedModelFilePath: filePath,
    });

    try {
      const response = (await _apiHandler({
        type: 'framework-column-lineage',
        request: { action: 'get-columns', filePath },
      })) as {
        success: boolean;
        modelName?: string;
        columns?: ModelColumn[];
        error?: string;
      };

      console.log('[DataExplorerStore] Columns response:', response);

      if (response.success && response.columns) {
        set({
          modelColumns: response.columns,
          isLoadingColumns: false,
        });
      } else {
        set({
          error: response.error || 'Failed to fetch columns',
          isLoadingColumns: false,
          modelColumns: null,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch columns';
      console.error('[DataExplorerStore] Error fetching columns:', error);
      set({
        error: errorMessage,
        isLoadingColumns: false,
        modelColumns: null,
      });
    }
  },

  fetchSourceColumns: async (filePath: string, tableName: string) => {
    const { _apiHandler } = get();
    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    set({
      isLoadingColumns: true,
      error: null,
      selectedModelForColumns: tableName,
      selectedModelFilePath: filePath,
    });

    try {
      const response = (await _apiHandler({
        type: 'framework-column-lineage',
        request: { action: 'get-source-columns', filePath, tableName },
      })) as {
        success: boolean;
        modelName?: string;
        columns?: ModelColumn[];
        error?: string;
      };

      if (response.success && response.columns) {
        set({
          modelColumns: response.columns,
          isLoadingColumns: false,
        });
      } else {
        set({
          error: response.error || 'Failed to fetch source columns',
          isLoadingColumns: false,
          modelColumns: null,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to fetch source columns';
      console.error(
        '[DataExplorerStore] Error fetching source columns:',
        error,
      );
      set({
        error: errorMessage,
        isLoadingColumns: false,
        modelColumns: null,
      });
    }
  },

  clearModelColumns: () => {
    set({
      modelColumns: null,
      selectedModelForColumns: null,
      selectedModelFilePath: null,
      isLoadingColumns: false,
      error: null,
    });
  },

  // Compiled SQL actions
  fetchCompiledSql: async (modelName: string, projectName: string) => {
    const { _apiHandler, compiledSqlModelName, compiledSql } = get();

    // Don't refetch if we already have the SQL for this model
    if (compiledSqlModelName === modelName && compiledSql !== null) {
      console.log(
        '[DataExplorerStore] Compiled SQL already loaded for:',
        modelName,
      );
      return;
    }

    if (!_apiHandler) {
      console.error('[DataExplorerStore] API handler not set');
      return;
    }

    set({ isLoadingCompiledSql: true, compiledSqlModelName: modelName });

    try {
      console.log('[DataExplorerStore] Fetching compiled SQL for:', modelName);
      const response = await _apiHandler({
        type: 'data-explorer-get-compiled-sql',
        request: { modelName, projectName },
      });

      console.log('[DataExplorerStore] Compiled SQL response:', response);
      set({
        compiledSql: response.sql,
        isLoadingCompiledSql: false,
        lastCompiledTime: response.lastModified || null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch compiled SQL';
      console.error('[DataExplorerStore] Error fetching compiled SQL:', error);
      set({
        error: errorMessage,
        isLoadingCompiledSql: false,
        compiledSql: null,
      });
    }
  },

  clearCompiledSql: () => {
    set({
      compiledSql: null,
      compiledSqlModelName: null,
      isLoadingCompiledSql: false,
      lastCompiledTime: null,
    });
  },

  // Split mode actions
  setSplitMode: (value: boolean) => {
    set({ isSplitMode: value });
  },
}));
