import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useApp, useEnvironment } from '@web/context';
import { Spinner } from '@web/elements';
import { useCallback, useEffect, useRef, useState } from 'react';

import QueryResults from '../DataExplorer/QueryResults';

interface QueryResultsData {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  executionTime?: number;
  modelName: string;
  error?: string;
}

interface HistoryEntry {
  id: string;
  filename: string;
  status: 'success' | 'error' | 'executing';
  rowCount?: number;
  executionTime?: number;
  error?: string;
  timestamp: Date;
  results?: QueryResultsData;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface QueryPreviewProps {
  onClose?: () => void;
}

export default function QueryPreview({ onClose }: QueryPreviewProps) {
  const { api } = useApp();
  const { vscode } = useEnvironment();
  const [results, setResults] = useState<QueryResultsData | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const executingIdRef = useRef<string | null>(null);

  useEffect(() => {
    vscode?.postMessage({ type: 'webview-ready' });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'query-results') {
        const isError = !!message.error;

        if (isError) {
          setError(message.error);
          setResults(null);
        } else {
          const newResults: QueryResultsData = {
            columns: message.columns,
            rows: message.rows,
            rowCount: message.rowCount,
            executionTime: message.executionTime,
            modelName: message.modelName || 'Query Draft',
          };
          setResults(newResults);
          setError(null);
        }
        setIsExecuting(false);

        setHistory((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((e) => e.id === executingIdRef.current);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              status: isError ? 'error' : 'success',
              error: message.error,
              rowCount: message.rowCount,
              executionTime: message.executionTime,
              results: isError
                ? undefined
                : {
                    columns: message.columns,
                    rows: message.rows,
                    rowCount: message.rowCount,
                    executionTime: message.executionTime,
                    modelName: message.modelName || 'Query Draft',
                  },
            };
          }
          executingIdRef.current = null;
          return updated;
        });
      } else if (message.type === 'query-executing') {
        setIsExecuting(true);
        setError(null);
        setShowHistory(false);

        const id = `${Date.now()}`;
        executingIdRef.current = id;
        setHistory((prev) => [
          {
            id,
            filename: message.modelName || 'Query Draft',
            status: 'executing',
            timestamp: new Date(),
          },
          ...prev,
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleExecuteQuery = useCallback(
    async (limit = 500) => {
      setIsExecuting(true);
      setError(null);
      setShowHistory(false);

      const id = `${Date.now()}`;
      executingIdRef.current = id;
      setHistory((prev) => [
        {
          id,
          filename: 'Query Draft',
          status: 'executing',
          timestamp: new Date(),
        },
        ...prev,
      ]);

      try {
        const response = await api.post({
          type: 'query-draft-execute',
          request: { sql: '', limit },
        });

        const newResults: QueryResultsData = {
          columns: response.columns,
          rows: response.rows,
          rowCount: response.rowCount,
          executionTime: response.executionTime,
          modelName: 'Query Draft',
        };
        setResults(newResults);

        setHistory((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((e) => e.id === id);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              status: 'success',
              rowCount: response.rowCount,
              executionTime: response.executionTime,
              results: newResults,
            };
          }
          return updated;
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to execute query';
        setError(errorMessage);
        setResults(null);

        setHistory((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((e) => e.id === id);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              status: 'error',
              error: errorMessage,
            };
          }
          return updated;
        });
      } finally {
        setIsExecuting(false);
        executingIdRef.current = null;
      }
    },
    [api],
  );

  const handleClearResults = useCallback(() => {
    setResults(null);
    setError(null);
    setShowHistory(false);
  }, []);

  const handleNewQuery = useCallback(() => {
    vscode?.postMessage({
      type: 'execute-command',
      command: 'dj.command.queryDraftCreate',
    });
  }, [vscode]);

  const handleConvertToModel = useCallback(() => {
    vscode?.postMessage({
      type: 'execute-command',
      command: 'dj.command.convertDraftToModel',
    });
  }, [vscode]);

  const handleRestoreFromHistory = useCallback((entry: HistoryEntry) => {
    if (entry.results) {
      setResults(entry.results);
      setError(null);
    } else if (entry.error) {
      setError(entry.error);
      setResults(null);
    }
    setShowHistory(false);
  }, []);

  const hasContent = results || error;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-neutral bg-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-surface transition-colors flex-shrink-0"
                title="Back to Data Explorer"
              >
                <ArrowLeftIcon className="w-4 h-4 text-surface-contrast" />
              </button>
            )}
            <DocumentTextIcon className="w-4 h-4 text-surface-contrast flex-shrink-0" />
            <span className="font-mono font-semibold text-sm text-foreground">
              Adhoc Query
            </span>
            {results && !showHistory && (
              <span className="text-xs text-surface-contrast">
                {results.rowCount} rows
                {results.executionTime && ` • ${results.executionTime}ms`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {results && !showHistory && (
              <button
                onClick={handleConvertToModel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 transition-colors"
                title="Convert SQL to DJ Model using AI"
              >
                <SparklesIcon className="w-4 h-4" />
                Convert to DJ Model
              </button>
            )}
            {history.length > 0 && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`p-1.5 rounded transition-colors ${showHistory ? 'bg-surface text-foreground' : 'hover:bg-surface text-surface-contrast'}`}
                title={showHistory ? 'Back to results' : 'Execution history'}
              >
                <ClockIcon className="w-4 h-4" />
              </button>
            )}
            {hasContent && !showHistory && (
              <button
                onClick={() => void handleExecuteQuery()}
                disabled={isExecuting}
                className="p-1.5 rounded hover:bg-surface transition-colors disabled:opacity-50"
                title="Re-run query"
              >
                <ArrowPathIcon
                  className={`w-4 h-4 text-surface-contrast ${isExecuting ? 'animate-spin' : ''}`}
                />
              </button>
            )}
            {(hasContent || showHistory) && (
              <button
                onClick={onClose ?? handleClearResults}
                className="p-1.5 rounded hover:bg-surface transition-colors"
                title={
                  onClose
                    ? 'Close and return to Data Explorer'
                    : 'Clear results'
                }
              >
                <XMarkIcon className="w-4 h-4 text-surface-contrast" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showHistory ? (
          /* History View */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral bg-surface/50">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Execution History
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded hover:bg-surface transition-colors"
                title="Close history"
              >
                <XMarkIcon className="w-3.5 h-3.5 text-surface-contrast" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleRestoreFromHistory(entry)}
                  disabled={entry.status === 'executing'}
                  className="w-full text-left px-3 py-2.5 border-b border-neutral hover:bg-surface/50 transition-colors disabled:opacity-60 disabled:cursor-default"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {entry.status === 'executing' && <Spinner size={16} />}
                      {entry.status === 'success' && (
                        <CheckCircleIcon className="w-4 h-4 text-green-500" />
                      )}
                      {entry.status === 'error' && (
                        <ExclamationCircleIcon className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {entry.filename}
                        </span>
                        {entry.status === 'success' &&
                          entry.rowCount != null && (
                            <span className="text-xs text-surface-contrast flex-shrink-0">
                              {entry.rowCount} rows
                            </span>
                          )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-surface-contrast">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                        {entry.executionTime != null && (
                          <span className="text-xs text-surface-contrast">
                            {entry.executionTime}ms
                          </span>
                        )}
                        {entry.status === 'error' && entry.error && (
                          <span className="text-xs text-red-500 truncate">
                            {entry.error}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Error State */}
            {error && (
              <div className="m-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                      Query Execution Failed
                    </h4>
                    <p className="text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading State (priority over empty state to prevent flash) */}
            {isExecuting && !results ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Spinner size={32} />
                  <p className="mt-4 text-sm text-surface-contrast">
                    Executing query against Trino...
                  </p>
                </div>
              </div>
            ) : results ? (
              <div className="flex-1 overflow-hidden">
                <QueryResults
                  results={results}
                  isExecuting={isExecuting}
                  onClose={handleClearResults}
                  onRerun={(limit) => void handleExecuteQuery(limit)}
                />
              </div>
            ) : !error ? (
              /* Empty State */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-md px-4">
                  <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <DocumentTextIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    Adhoc Query
                  </h3>
                  <p className="text-sm text-surface-contrast mb-6">
                    Create a query draft file to write and test SQL queries
                    against Trino. Once validated, convert your query to a DJ
                    model.
                  </p>
                  <div className="flex flex-col gap-3 items-center">
                    <button
                      onClick={handleNewQuery}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                    >
                      <PlusIcon className="w-4 h-4" />
                      New Query
                    </button>
                    <p className="text-xs text-surface-contrast">
                      Or right-click a{' '}
                      <code className="bg-surface px-1 rounded">
                        .draft.sql
                      </code>{' '}
                      file and select <strong>DJ: Run Query</strong>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
