import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  CodeBracketIcon,
  CogIcon,
  ExclamationCircleIcon,
  PlayIcon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import { useEnvironment } from '@web/context';
import { CodeBlock, Spinner, Switch } from '@web/elements';
import { ColumnSelectionPanel } from '@web/features/Lineage';
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';

import SplitViewIcon from '../../assets/icons/split-view.svg';
import { useDataExplorerStore } from '../../stores/dataExplorerStore';
import CompilationLogs from '../DataExplorer/CompilationLogs';
import QueryResults from '../DataExplorer/QueryResults';
import LineageGraph from './LineageGraph';

type RightPanelTab = 'query' | 'columns';
type QueryViewMode = 'data' | 'sql';

export default function ModelLineage() {
  const { api } = useApp();
  const { vscode } = useEnvironment();
  const {
    activeModel,
    lineageData,
    queryResults,
    isLoadingLineage,
    isExecutingQuery,
    error,
    selectedNodeForQuery,
    fetchLineage,
    executeQuery,
    openModelFile,
    clearResults,
    clearError,
    notifyReady,
    detectActiveModel,
    setApiHandler,
    setActiveModel,
    // Compilation state
    compilationLogs,
    isCompiling,
    compilationSuccess,
    compileModelWithLogs,
    addCompilationLog,
    clearCompilationLogs,
    setCompilationComplete,
    isQueryAfterCompile,
    // Model columns state
    modelColumns,
    isLoadingColumns,
    selectedModelForColumns,
    selectedModelFilePath,
    fetchModelColumns,
    fetchSourceColumns,
    clearModelColumns,
    // Compiled SQL state
    compiledSql,
    isLoadingCompiledSql,
    lastCompiledTime,
    fetchCompiledSql,
    clearCompiledSql,
    // Split mode state
    isSplitMode,
    setSplitMode,
  } = useDataExplorerStore();

  const [showResults, setShowResults] = useState(false);
  const [showCompilationLogs, setShowCompilationLogs] = useState(false);
  const [isResultsMaximized, setIsResultsMaximized] = useState(false);
  const [isCompilationMaximized, setIsCompilationMaximized] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('columns'); // Start with columns tab
  const [showColumns, setShowColumns] = useState(false);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [queryViewMode, setQueryViewMode] = useState<QueryViewMode>('data'); // Toggle between data table and SQL view

  // Auto-refresh state - disabled by default for better UX
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);

  // Theme detection for CodeBlock
  const [codeTheme, setCodeTheme] = useState<'light' | 'dark'>(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    return currentTheme?.includes('dark') ? 'dark' : 'light';
  });

  // Initialize API handler
  useEffect(() => {
    setApiHandler(api.post);
  }, [api.post, setApiHandler]);

  // Load data explorer preferences on mount
  useEffect(() => {
    void loadDataExplorerPreferences();
  }, []);

  // Listen for theme changes for CodeBlock
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const newTheme = document.documentElement.getAttribute('data-theme');
          setCodeTheme(newTheme?.includes('dark') ? 'dark' : 'light');
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // Listen for compilation messages from the backend
  useEffect(() => {
    if (!vscode) return;

    const messageHandler = (event: MessageEvent) => {
      const message = event.data;

      // Skip API response messages (they have _channelId)
      if (message._channelId) {
        return;
      }

      // All message handler code below uses message which is any from vscode API
      if (message.type === 'compilation-log') {
        addCompilationLog(message.log);
      } else if (message.type === 'compilation-complete') {
        void setCompilationComplete(message.success);
      } else if (message.type === 'trigger-compilation') {
        // Triggered from command - show compilation in full width mode
        setSplitMode(true);
        setIsCompilationMaximized(true); // Full width mode - hide lineage
        void compileModelWithLogs(
          message.modelName,
          message.projectName,
          false,
        );
        setShowCompilationLogs(true);
        setShowColumns(false);
        setShowResults(false);
      } else if (message.type === 'trigger-run-query') {
        // Triggered from Preview Model command
        setSplitMode(true);
        // Set maximized mode if requested
        if (message.maximized) {
          setIsResultsMaximized(true);
        }
        setShowResults(true);
        setShowCompilationLogs(false); // Hide compilation logs
        setRightPanelTab('query');
        setSelectedNodeName(message.modelName);
        clearError();
        void executeQuery(message.modelName, message.projectName);
      } else if (message.type === 'select-model') {
        // Triggered from Data Modeling SelectNode "DATA EXPLORER" button
        // Clear all stale data and reset UI state when model changes
        clearResults();
        clearModelColumns();
        clearCompiledSql();
        setShowResults(false);
        setShowColumns(false);
        // Set the active model
        setActiveModel({
          modelName: message.modelName,
          projectName: message.projectName,
        });
        setSelectedNodeName(message.modelName);
        clearError();
        void fetchLineage(message.modelName, message.projectName);
      } else if (message.type === 'set-active-model') {
        // Explicitly set the active model (from Data Explorer command on .model.json or .yml files)
        if (message.modelName && message.projectName) {
          // Reset UI state to show lineage (in case we were showing maximized results or compilation logs)
          setIsResultsMaximized(false);
          setIsCompilationMaximized(false);
          setShowResults(false);
          setShowColumns(false);
          setShowCompilationLogs(false);
          setSplitMode(false);
          // Fetch lineage for this specific model
          void fetchLineage(message.modelName, message.projectName);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Step 1: Signal DOM is ready (enables message queue flushing)
    vscode.postMessage({ type: 'webview-ready' });

    // Step 2: Trigger app initialization and auto-detection (after DOM ready)
    void notifyReady();

    return () => window.removeEventListener('message', messageHandler);
  }, [
    vscode,
    addCompilationLog,
    setCompilationComplete,
    compileModelWithLogs,
    executeQuery,
    clearError,
    fetchLineage,
    setActiveModel,
    setSplitMode,
    notifyReady,
  ]);

  // Show results panel when query results are available
  useEffect(() => {
    if (queryResults) {
      setShowResults(true);
      setRightPanelTab('query');
      // If this is a query after compile, close compilation logs to show results
      if (isQueryAfterCompile) {
        setShowCompilationLogs(false);
      }
    }
  }, [queryResults, isQueryAfterCompile]);

  // Show columns panel when columns are loaded
  useEffect(() => {
    if (modelColumns) {
      setShowColumns(true);
      setRightPanelTab('columns');
    }
  }, [modelColumns]);

  // Show compilation logs when compiling
  useEffect(() => {
    if (isCompiling) {
      setShowCompilationLogs(true);
      setShowColumns(false);
      setShowResults(false);
    }
  }, [isCompiling]);

  // Auto-fetch columns when columns tab is active and panel is visible but no columns loaded
  useEffect(() => {
    // Only auto-fetch when:
    // 1. Columns tab is selected
    // 2. Panel is visible (split mode or results showing)
    // 3. Columns are not already loaded
    // 4. Not currently loading
    // 5. There's lineage data to work with
    // 6. Compilation logs are NOT showing (compilation takes precedence)
    if (
      rightPanelTab === 'columns' &&
      (isSplitMode || showResults) &&
      !showColumns &&
      !showCompilationLogs &&
      !isLoadingColumns &&
      lineageData?.current
    ) {
      // Find the target node (selected or current model)
      const targetNode = selectedNodeName
        ? [
            lineageData.current,
            ...(lineageData.upstream || []),
            ...(lineageData.downstream || []),
          ].find((n) => n?.name === selectedNodeName)
        : lineageData.current;

      if (targetNode?.pathSystem) {
        setShowColumns(true);
        if (targetNode.type === 'source') {
          const sourcePath = targetNode.pathSystem.endsWith('.yml')
            ? targetNode.pathSystem.replace(/\.yml$/, '.source.json')
            : targetNode.pathSystem;
          void fetchSourceColumns(sourcePath, targetNode.name);
        } else {
          void fetchModelColumns(targetNode.pathSystem, targetNode.name);
        }
      }
    }
  }, [
    rightPanelTab,
    isSplitMode,
    showResults,
    showColumns,
    showCompilationLogs,
    isLoadingColumns,
    lineageData,
    selectedNodeName,
    fetchModelColumns,
    fetchSourceColumns,
  ]);

  const handleRunQuery = (modelName: string, projectName: string) => {
    // Show panel immediately with loading state
    setSplitMode(true);
    setShowResults(true);
    setShowCompilationLogs(false); // Hide compilation logs if open
    setRightPanelTab('query');
    setSelectedNodeName(modelName);
    // Clear any previous error
    clearError();
    void executeQuery(modelName, projectName);
  };

  const handleCompile = (modelName: string, projectName: string) => {
    // Show compilation logs panel
    setSplitMode(true);
    setShowCompilationLogs(true);
    setShowResults(false);
    setShowColumns(false);
    setSelectedNodeName(modelName);
    // Trigger compilation (true = always run query after compilation)
    void compileModelWithLogs(modelName, projectName, true);
  };

  const handleNodeClick = (modelName: string, projectName: string) => {
    // Validate modelName to prevent issues
    if (!modelName || typeof modelName !== 'string') {
      console.error(
        '[ModelLineage] Invalid modelName in handleNodeClick:',
        modelName,
      );
      return;
    }

    // Set the selected node to update placeholders
    setSelectedNodeName(modelName);
    // Ensure split mode is on to show the panel
    setSplitMode(true);
    // Hide compilation logs if open
    setShowCompilationLogs(false);
    // Clear any existing results/columns/compiled SQL
    setShowResults(false);
    clearResults();
    clearModelColumns();
    clearCompiledSql();

    if (rightPanelTab === 'columns') {
      const targetNode = [
        lineageData?.current,
        ...(lineageData?.upstream || []),
        ...(lineageData?.downstream || []),
      ].find((n) => n?.name === modelName);

      if (targetNode?.pathSystem) {
        setShowColumns(true);
        if (targetNode.type === 'source') {
          const sourcePath = targetNode.pathSystem.endsWith('.yml')
            ? targetNode.pathSystem.replace(/\.yml$/, '.source.json')
            : targetNode.pathSystem;
          void fetchSourceColumns(sourcePath, modelName);
        } else {
          void fetchModelColumns(targetNode.pathSystem, modelName);
        }
      }
    } else {
      setShowColumns(false);
    }

    // Open the model file
    void openModelFile(modelName, projectName);
  };

  const handleCloseResults = () => {
    setShowResults(false);
    setIsResultsMaximized(false);
    clearResults();
  };

  const handleRerunQuery = (limit: number) => {
    if (queryResults) {
      void executeQuery(
        queryResults.modelName,
        activeModel?.projectName || '',
        limit,
      );
    }
  };

  const handleToggleMaximize = () => {
    setIsResultsMaximized((prev) => !prev);
  };

  const handleCloseCompilationLogs = () => {
    setShowCompilationLogs(false);
    setIsCompilationMaximized(false);
    clearCompilationLogs();
  };

  const handleRunQueryAfterCompilation = () => {
    if (activeModel) {
      // Show panel immediately with loading state
      setSplitMode(true);
      // If compilation was maximized, keep results maximized too
      if (isCompilationMaximized) {
        setIsResultsMaximized(true);
        setIsCompilationMaximized(false);
      }
      setShowResults(true);
      setShowCompilationLogs(false); // Hide compilation logs
      setRightPanelTab('query');
      clearError();
      void executeQuery(activeModel.modelName, activeModel.projectName);
    }
  };

  const handleRefresh = () => {
    if (activeModel) {
      void fetchLineage(activeModel.modelName, activeModel.projectName);
    }
  };

  // Load data explorer preferences on mount
  const loadDataExplorerPreferences = async () => {
    try {
      // Add timeout to prevent indefinite loading state if backend doesn't respond
      const result = await api.post({
        type: 'framework-preferences',
        request: {
          action: 'get',
          context: 'data-explorer',
        },
      });

      if (result.success && typeof result.value === 'boolean') {
        setAutoRefreshEnabled(result.value);
      }
    } catch (error) {
      console.warn(
        '[ModelLineage] Failed to load data explorer preferences:',
        error,
      );
    } finally {
      setIsLoadingPreferences(false);
    }
  };

  // Handle auto-refresh toggle with persistence
  const handleAutoRefreshToggle = (
    checked: boolean | React.ChangeEvent<HTMLInputElement>,
  ) => {
    const enabled =
      typeof checked === 'boolean' ? checked : checked.target.checked;

    // Optimistically update UI
    setAutoRefreshEnabled(enabled);

    // Save to VSCode settings asynchronously
    const savePreference = async () => {
      try {
        const result = await api.post({
          type: 'framework-preferences',
          request: {
            action: 'set',
            context: 'data-explorer',
            value: enabled,
          },
        });
        if (!result.success) {
          // Revert on failure
          setAutoRefreshEnabled(!enabled);
          console.error(
            '[ModelLineage] Failed to save auto-refresh preference:',
            result.error,
          );
        }
      } catch (error) {
        // Revert on failure
        setAutoRefreshEnabled(!enabled);
        console.error(
          '[ModelLineage] Failed to save auto-refresh preference:',
          error,
        );
      }
    };
    void savePreference();
  };

  const handleViewColumns = (filePath: string, modelName: string) => {
    setSplitMode(true);
    setShowColumns(true);
    setShowCompilationLogs(false);
    setRightPanelTab('columns');
    setSelectedNodeName(modelName);
    clearError();

    // Detect source nodes: use get-source-columns with the table name
    const isSourceFile = filePath.endsWith('.source.json');
    if (isSourceFile) {
      void fetchSourceColumns(filePath, modelName);
    } else {
      void fetchModelColumns(filePath, modelName);
    }
  };

  const handleCloseColumns = () => {
    setShowColumns(false);
    clearModelColumns();
  };

  // Close all right panel sections and exit split mode
  const handleCloseRightPanel = () => {
    setShowResults(false);
    setShowColumns(false);
    setShowCompilationLogs(false);
    setIsResultsMaximized(false); // Reset maximized state so lineage graph is visible
    setIsCompilationMaximized(false); // Reset compilation maximized state
    setSplitMode(false);
    clearResults();
    clearModelColumns();
    clearCompilationLogs();
  };

  // Toggle split mode - when exiting, close all panels
  const handleToggleSplitMode = () => {
    if (isSplitMode) {
      // Exiting split mode - close all panels
      handleCloseRightPanel();
    } else {
      // Entering split mode
      setSplitMode(true);
    }
  };

  const handleColumnClick = (columnName: string) => {
    // Navigate to Column Lineage panel with the selected column
    if (!selectedModelFilePath || !selectedModelForColumns) {
      console.error('[ModelLineage] No file path for column lineage');
      return;
    }

    // Send message to extension to open Column Lineage panel
    if (vscode) {
      vscode.postMessage({
        type: 'open-column-lineage',
        filePath: selectedModelFilePath,
        modelName: selectedModelForColumns,
        columnName: columnName,
        columns: modelColumns,
      });
    }
  };

  // Determine if right panel should be shown
  // In split mode, always show right panel (with placeholders if no data)
  // Otherwise, show only when there's data or loading
  const showRightPanel =
    isSplitMode ||
    showResults ||
    showColumns ||
    showCompilationLogs ||
    isExecutingQuery ||
    isLoadingColumns;

  // Loading state
  if (isLoadingLineage && !lineageData) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading lineage...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !lineageData) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex gap-3">
              <ExclamationCircleIcon className="w-6 h-6 text-red-600 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900 mb-2">
                  Failed to Load Lineage
                </h3>
                <p className="text-sm text-red-700 mb-4">{error}</p>
                <button
                  onClick={() => {
                    clearError();
                    void notifyReady();
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No active model state
  if (!activeModel || !lineageData) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <svg
            className="w-16 h-16 text-gray-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Active Model
          </h3>
          <p className="text-gray-600 mb-4">
            Open a open a model file (.sql, .model.json, or .yml) to view its
            lineage.
          </p>
          <button
            onClick={() => {
              void detectActiveModel();
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Detect Active Model
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Compact Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-neutral bg-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="font-mono font-semibold text-sm text-foreground truncate">
              {activeModel.modelName}
            </span>
            <span className="text-xs text-surface-contrast opacity-70">
              in {activeModel.projectName}
            </span>
            <div className="flex items-center gap-2 text-xs text-surface-contrast opacity-70">
              <span>
                <strong className="text-foreground">
                  {lineageData.upstream.length}
                </strong>{' '}
                ↑
              </span>
              <span>
                <strong className="text-foreground">
                  {lineageData.downstream.length}
                </strong>{' '}
                ↓
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Split Mode Toggle */}
            <button
              onClick={handleToggleSplitMode}
              className={`p-1.5 rounded transition-colors ${
                isSplitMode
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-surface text-surface-contrast'
              }`}
              title={isSplitMode ? 'Exit split view' : 'Split view'}
            >
              <img
                src={SplitViewIcon}
                alt="Split view"
                className="w-4 h-4"
                style={{
                  filter: isSplitMode
                    ? 'var(--icon-primary-filter, invert(35%) sepia(95%) saturate(1000%) hue-rotate(200deg))'
                    : 'var(--icon-contrast-filter, invert(40%))',
                }}
              />
            </button>
            <button
              onClick={handleRefresh}
              disabled={isLoadingLineage}
              className="p-1.5 rounded hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh lineage"
            >
              <ArrowPathIcon
                className={`w-4 h-4 text-surface-contrast ${isLoadingLineage && 'animate-spin'}`}
              />
            </button>

            {/* Auto-refresh toggle */}
            <div className="flex items-center gap-1">
              <Switch
                checked={autoRefreshEnabled}
                onChange={handleAutoRefreshToggle}
                label="Auto-sync"
                size="sm"
                className="ml-2"
                disabled={isLoadingPreferences}
                tooltipText="Automatically sync lineage when switching files"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Lineage Graph - hidden when results or compilation are maximized */}
        {!isResultsMaximized && !isCompilationMaximized && (
          <div
            className={`flex-1 h-full ${showRightPanel ? 'border-r border-neutral' : ''}`}
          >
            <ReactFlowProvider>
              <LineageGraph
                currentNode={lineageData.current}
                upstreamNodes={lineageData.upstream}
                downstreamNodes={lineageData.downstream}
                pythonModelEdges={lineageData.pythonModelEdges}
                projectName={activeModel.projectName}
                selectedNodeForQuery={selectedNodeForQuery}
                selectedNodeName={selectedNodeName}
                onRunQuery={handleRunQuery}
                onCompile={handleCompile}
                onNodeClick={handleNodeClick}
                onViewColumns={handleViewColumns}
              />
            </ReactFlowProvider>
          </div>
        )}

        {/* Compilation Logs Panel */}
        {showCompilationLogs && (
          <div
            className={
              isCompilationMaximized
                ? 'flex-1 h-full overflow-hidden'
                : 'w-1/2 max-w-2xl h-full overflow-hidden'
            }
          >
            <CompilationLogs
              logs={compilationLogs}
              isCompiling={isCompiling}
              compilationSuccess={compilationSuccess}
              modelName={activeModel?.modelName || ''}
              onClose={handleCloseCompilationLogs}
              onRunQuery={handleRunQueryAfterCompilation}
              showRunButton={true}
            />
          </div>
        )}

        {/* Right Panel with Tabs (Query Results / Model Columns) */}
        {(isSplitMode || showResults || showColumns) &&
          !showCompilationLogs && (
            <div
              className={
                isResultsMaximized
                  ? 'flex-1 h-full overflow-hidden flex flex-col'
                  : 'w-1/2 max-w-2xl h-full overflow-hidden flex flex-col'
              }
            >
              {/* Tab Buttons - always show in split mode */}
              <div className="flex-shrink-0 flex items-center border-b border-neutral bg-card">
                <button
                  onClick={() => setRightPanelTab('columns')}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                    rightPanelTab === 'columns'
                      ? 'text-primary border-b-2 border-primary bg-surface'
                      : 'text-surface-contrast hover:text-foreground hover:bg-surface'
                  }`}
                >
                  Columns
                </button>
                {!selectedModelFilePath?.endsWith('.source.json') && (
                  <button
                    onClick={() => setRightPanelTab('query')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      rightPanelTab === 'query'
                        ? 'text-primary border-b-2 border-primary bg-surface'
                        : 'text-surface-contrast hover:text-foreground hover:bg-surface'
                    }`}
                  >
                    Query Results
                  </button>
                )}
                <button
                  onClick={handleToggleMaximize}
                  className="p-2 hover:bg-surface rounded transition-colors"
                  title={isResultsMaximized ? 'Minimize' : 'Maximize'}
                >
                  {isResultsMaximized ? (
                    <ArrowsPointingInIcon className="w-4 h-4 text-surface-contrast" />
                  ) : (
                    <ArrowsPointingOutIcon className="w-4 h-4 text-surface-contrast" />
                  )}
                </button>
                <button
                  onClick={handleCloseRightPanel}
                  className="p-2 hover:bg-surface rounded transition-colors"
                  title="Close panel"
                >
                  <XMarkIcon className="w-4 h-4 text-surface-contrast" />
                </button>
              </div>

              {/* Panel Content */}
              <div className="flex-1 overflow-hidden">
                {/* Query Results Tab */}
                {rightPanelTab === 'query' && (
                  <div className="h-full flex flex-col">
                    {/* SQL View Mode */}
                    {queryViewMode === 'sql' && (
                      <>
                        {/* SQL Header with toggle */}
                        <div className="flex-shrink-0 px-3 py-2.5 border-b border-neutral flex items-center justify-between gap-4 bg-card">
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <span className="font-mono text-sm font-semibold text-foreground truncate">
                              {selectedNodeName || activeModel?.modelName}
                            </span>
                            {lastCompiledTime && (
                              <div className="flex items-center gap-1 text-xs text-surface-contrast">
                                <span>Last compiled:</span>
                                <span className="font-medium">
                                  {new Date(lastCompiledTime).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => {
                                setQueryViewMode('data');
                              }}
                              className="p-1.5 rounded hover:bg-surface transition-colors"
                              title="View Query Results"
                            >
                              <TableCellsIcon className="w-4 h-4 text-surface-contrast" />
                            </button>
                            <button
                              onClick={() => {
                                if (activeModel) {
                                  handleRunQuery(
                                    selectedNodeName || activeModel.modelName,
                                    activeModel.projectName,
                                  );
                                  setQueryViewMode('data');
                                }
                              }}
                              className="p-1 rounded bg-primary hover:opacity-90 transition-colors"
                              title="Run Query"
                            >
                              <PlayIcon className="w-3.5 h-3.5 text-primary-contrast" />
                            </button>
                          </div>
                        </div>

                        {/* SQL Content */}
                        <div className="flex-1 overflow-hidden">
                          {isLoadingCompiledSql && (
                            <div className="h-full flex items-center justify-center bg-surface">
                              <Spinner
                                size={32}
                                label="Loading compiled SQL..."
                              />
                            </div>
                          )}

                          {!isLoadingCompiledSql && compiledSql && (
                            <div className="compiled-sql-preview h-full overflow-auto">
                              <CodeBlock
                                code={compiledSql}
                                language="sql"
                                theme={codeTheme}
                                className="h-full min-h-full"
                              />
                            </div>
                          )}

                          {!isLoadingCompiledSql && !compiledSql && (
                            <div className="h-full flex items-center justify-center bg-surface">
                              <div className="text-center p-6 max-w-sm">
                                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-card border border-neutral flex items-center justify-center">
                                  <CodeBracketIcon className="w-6 h-6 text-surface-contrast" />
                                </div>
                                <h3 className="text-base font-semibold text-foreground mb-2">
                                  No Compiled SQL
                                </h3>
                                <p className="text-sm text-surface-contrast mb-4">
                                  Compile the model to view the generated SQL
                                  for{' '}
                                  <span className="font-mono font-medium text-foreground">
                                    {selectedNodeName || activeModel?.modelName}
                                  </span>
                                </p>
                                <div className="flex gap-2 justify-center">
                                  <button
                                    onClick={() => {
                                      if (activeModel) {
                                        handleCompile(
                                          selectedNodeName ||
                                            activeModel.modelName,
                                          activeModel.projectName,
                                        );
                                      }
                                    }}
                                    className="px-4 py-2 bg-primary text-primary-contrast rounded hover:opacity-90 transition-opacity text-sm font-medium inline-flex items-center gap-2"
                                  >
                                    <CogIcon className="w-4 h-4" />
                                    Compile Model
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (activeModel) {
                                        handleRunQuery(
                                          selectedNodeName ||
                                            activeModel.modelName,
                                          activeModel.projectName,
                                        );
                                        setQueryViewMode('data');
                                      }
                                    }}
                                    className="px-4 py-2 bg-secondary text-secondary-contrast rounded hover:opacity-90 transition-opacity text-sm font-medium inline-flex items-center gap-2"
                                  >
                                    <PlayIcon className="w-4 h-4" />
                                    Run Query
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* Data View Mode */}
                    {queryViewMode === 'data' && (
                      <>
                        {/* Show QueryResults when we have data or are loading */}
                        {(showResults || isExecutingQuery) && (
                          <QueryResults
                            results={queryResults}
                            isExecuting={isExecutingQuery}
                            onClose={handleCloseResults}
                            onRerun={handleRerunQuery}
                            isMaximized={isResultsMaximized}
                            onToggleMaximize={handleToggleMaximize}
                            onViewSql={() => {
                              const targetModel =
                                selectedNodeName || activeModel?.modelName;
                              const targetProject = activeModel?.projectName;
                              if (targetModel && targetProject) {
                                void fetchCompiledSql(
                                  targetModel,
                                  targetProject,
                                );
                              }
                              setQueryViewMode('sql');
                            }}
                          />
                        )}

                        {/* Show placeholder when panel is visible but no data */}
                        {(isSplitMode || showColumns) &&
                          !showResults &&
                          !isExecutingQuery && (
                            <div className="h-full flex items-center justify-center bg-surface">
                              <div className="text-center p-6 max-w-sm">
                                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-card border border-neutral flex items-center justify-center">
                                  <PlayIcon className="w-6 h-6 text-surface-contrast" />
                                </div>
                                <h3 className="text-base font-semibold text-foreground mb-2">
                                  Run Query
                                </h3>
                                <p className="text-sm text-surface-contrast mb-4">
                                  Preview data from{' '}
                                  <span className="font-mono font-medium text-foreground">
                                    {selectedNodeName || activeModel?.modelName}
                                  </span>
                                </p>
                                <button
                                  onClick={() => {
                                    if (activeModel) {
                                      handleRunQuery(
                                        selectedNodeName ||
                                          activeModel.modelName,
                                        activeModel.projectName,
                                      );
                                    }
                                  }}
                                  className="px-4 py-2 bg-primary text-primary-contrast rounded hover:opacity-90 transition-opacity text-sm font-medium inline-flex items-center gap-2"
                                >
                                  <PlayIcon className="w-4 h-4" />
                                  Run Query
                                </button>
                              </div>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}

                {/* Columns Tab */}
                {rightPanelTab === 'columns' && (
                  <>
                    {/* Show ColumnSelectionPanel when we have data or are loading */}
                    {(showColumns || isLoadingColumns) && (
                      <ColumnSelectionPanel
                        mode="modelLineage"
                        modelName={selectedModelForColumns || undefined}
                        isSource={selectedModelFilePath?.endsWith(
                          '.source.json',
                        )}
                        columns={modelColumns || []}
                        isLoading={isLoadingColumns}
                        error={error || undefined}
                        onColumnSelect={handleColumnClick}
                        onClose={handleCloseColumns}
                        onRetry={() => {
                          if (
                            selectedModelFilePath &&
                            selectedModelForColumns
                          ) {
                            if (
                              selectedModelFilePath.endsWith('.source.json')
                            ) {
                              void fetchSourceColumns(
                                selectedModelFilePath,
                                selectedModelForColumns,
                              );
                            } else {
                              void fetchModelColumns(
                                selectedModelFilePath,
                                selectedModelForColumns,
                              );
                            }
                          }
                        }}
                      />
                    )}

                    {/* Show placeholder only when no model is available */}
                    {(isSplitMode || showResults) &&
                      !showColumns &&
                      !isLoadingColumns &&
                      !lineageData?.current && (
                        <div className="h-full flex items-center justify-center bg-surface">
                          <div className="text-center p-6 max-w-sm">
                            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-card border border-neutral flex items-center justify-center">
                              <TableCellsIcon className="w-6 h-6 text-surface-contrast" />
                            </div>
                            <h3 className="text-base font-semibold text-foreground mb-2">
                              No Model Selected
                            </h3>
                            <p className="text-sm text-surface-contrast">
                              Select a model from the lineage graph to view its
                              columns
                            </p>
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
