import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CodeBracketIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/solid';
import { useMemo, useState } from 'react';

import type { QueryResults as QueryResultsType } from '../../stores/dataExplorerStore';

interface QueryResultsProps {
  results: QueryResultsType | null;
  isExecuting: boolean;
  onClose: () => void;
  onRerun?: (limit: number) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onViewSql?: () => void;
  onOpenFile?: () => void;
}

type SortDirection = 'asc' | 'desc' | null;
interface SortConfig {
  columnIndex: number | null;
  direction: SortDirection;
}

/**
 * Format a cell value for display
 * Handles arrays, objects, and primitive types appropriately
 */
function formatCellValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle arrays and objects by stringifying them
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export default function QueryResults({
  results,
  isExecuting,
  onClose: _onClose,
  onRerun,
  isMaximized: _isMaximized = false,
  onToggleMaximize: _onToggleMaximize,
  onViewSql,
  onOpenFile,
}: QueryResultsProps) {
  const [limitValue, setLimitValue] = useState('500');
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    columnIndex: null,
    direction: null,
  });

  // Sorted rows based on current sort configuration
  const sortedRows = useMemo(() => {
    if (!results || sortConfig.columnIndex === null || !sortConfig.direction) {
      return results?.rows || [];
    }

    const { columnIndex, direction } = sortConfig;
    return [...results.rows].sort((a, b) => {
      const aVal = a[columnIndex];
      const bVal = b[columnIndex];

      // Handle null values
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return direction === 'asc' ? -1 : 1;
      if (bVal === null) return direction === 'asc' ? 1 : -1;

      // Compare values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (direction === 'asc') {
        return aStr.localeCompare(bStr);
      }
      return bStr.localeCompare(aStr);
    });
  }, [results, sortConfig]);

  const handleSort = (columnIndex: number) => {
    setSortConfig((prev) => {
      if (prev.columnIndex !== columnIndex) {
        return { columnIndex, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { columnIndex, direction: 'desc' };
      }
      // Reset sorting
      return { columnIndex: null, direction: null };
    });
  };

  // Parse limit value for validation
  const parsedLimit = parseInt(limitValue, 10);
  const isLimitValid = !isNaN(parsedLimit) && parsedLimit > 0;

  const handleRerun = () => {
    if (onRerun && isLimitValid) {
      onRerun(parsedLimit);
    }
  };

  if (!results && !isExecuting) {
    return null;
  }

  const exportToCSV = () => {
    if (!results || !results.columns.length) return;

    const escapeCsvValue = (value: any): string => {
      if (value === null || value === undefined) {
        return '';
      }
      // Handle arrays and objects by stringifying them
      let strValue: string;
      if (typeof value === 'object') {
        try {
          strValue = JSON.stringify(value);
        } catch {
          strValue = String(value);
        }
      } else {
        strValue = String(value);
      }
      // Escape quotes and wrap in quotes if contains special characters
      if (
        strValue.includes(',') ||
        strValue.includes('"') ||
        strValue.includes('\n')
      ) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    };

    const csvContent = [
      results.columns.map(escapeCsvValue).join(','),
      ...results.rows.map((row) => row.map(escapeCsvValue).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${results.modelName}_results.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-neutral">
      {/* Header - Always visible at top */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-neutral flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            {results && (
              <span
                title={results.modelName}
                className="font-mono text-sm font-semibold text-foreground truncate block"
              >
                {results.modelName}
              </span>
            )}
            <div className="flex items-center gap-2">
              {results && !isExecuting && !results.error && (
                <div className="flex items-center gap-2 text-xs text-surface-contrast flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <CheckCircleIcon className="w-4 h-4 text-success" />
                    <span>{results.rowCount} rows</span>
                  </div>
                  {results.executionTime !== undefined && (
                    <div className="flex items-center gap-1 opacity-70">
                      <ClockIcon className="w-3.5 h-3.5" />
                      <span>{(results.executionTime / 1000).toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {results?.error && !isExecuting && (
            <div className="flex items-center gap-1 text-xs text-message-error-contrast flex-shrink-0">
              <ExclamationCircleIcon className="w-4 h-4" />
              <span>Error</span>
            </div>
          )}
          {isExecuting && (
            <div className="flex items-center gap-2 text-xs text-primary flex-shrink-0">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-primary"></div>
              <span>Executing...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRerun && results && !isExecuting && (
            <>
              <label className="text-sm text-surface-contrast opacity-70">
                Limit:
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
                className={`w-16 px-2 py-1 text-xs bg-background text-foreground border rounded focus:outline-none focus:ring-1 focus:ring-primary ${
                  !isLimitValid && limitValue !== ''
                    ? 'border-message-error'
                    : 'border-neutral'
                }`}
                placeholder="500"
              />
              {onViewSql && (
                <button
                  onClick={onViewSql}
                  className="p-1 rounded hover:bg-surface transition-colors"
                  title="View Compiled SQL"
                >
                  <CodeBracketIcon className="w-4 h-4 text-surface-contrast" />
                </button>
              )}
              {onOpenFile && (
                <button
                  onClick={onOpenFile}
                  className="p-1 rounded hover:bg-surface transition-colors"
                  title="Open Draft SQL"
                >
                  <ArrowTopRightOnSquareIcon className="w-4 h-4 text-surface-contrast" />
                </button>
              )}
              <button
                onClick={handleRerun}
                disabled={!isLimitValid}
                className={`p-1 rounded transition-colors ${
                  isLimitValid
                    ? 'bg-primary hover:opacity-90'
                    : 'bg-surface opacity-50 cursor-not-allowed'
                }`}
                title={
                  isLimitValid
                    ? 'Re-run query with new limit'
                    : 'Enter a valid limit'
                }
              >
                <PlayIcon
                  className={`w-3.5 h-3.5 ${isLimitValid ? 'text-primary-contrast' : 'text-surface-contrast'}`}
                />
              </button>
            </>
          )}
          {results && !results.error && !isExecuting && (
            <button
              onClick={exportToCSV}
              className="p-1 rounded hover:bg-surface transition-colors"
              title="Export to CSV"
            >
              <ArrowDownTrayIcon className="w-4 h-4 text-surface-contrast" />
            </button>
          )}
        </div>
      </div>

      {/* Content - Scrollable area */}
      <div className="flex-1 overflow-auto min-h-0">
        {isExecuting && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-surface-contrast text-sm">
                {results?.modelName
                  ? `Executing query for ${results.modelName}...`
                  : 'Executing query...'}
              </p>
            </div>
          </div>
        )}

        {results && results.error && !isExecuting && (
          <div className="p-4">
            <div className="bg-message-error border border-message-error rounded-lg p-4">
              <div className="flex items-start gap-3">
                <ExclamationCircleIcon className="w-5 h-5 text-message-error-contrast flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-message-error-contrast mb-2">
                    Query Execution Failed
                  </h4>

                  {/* Error message in monospace font with scroll */}
                  <div className="text-sm text-message-error-contrast font-mono bg-black/10 p-3 rounded border border-black/10 whitespace-pre-wrap overflow-auto max-h-40">
                    {results.error}
                  </div>

                  {/* Helpful guidance for "does not exist" errors */}
                  {results.error.toLowerCase().includes('does not exist') && (
                    <div className="mt-3 text-sm bg-warning/20 border border-warning p-3 rounded">
                      <p className="font-semibold text-foreground mb-2">
                        💡 This usually means:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-surface-contrast">
                        <li>An upstream model hasn't been materialized yet</li>
                        <li>
                          You need to run{' '}
                          <code className="bg-surface px-1 rounded">
                            dbt run
                          </code>{' '}
                          for dependencies first
                        </li>
                        <li>
                          Only models that reference seeds can be previewed
                          without running
                        </li>
                      </ul>
                      <div className="mt-3 pt-3 border-t border-warning">
                        <p className="font-semibold text-foreground mb-1">
                          Quick fix:
                        </p>
                        <code className="block bg-surface px-2 py-1 rounded text-xs">
                          dbt run --select +{results.modelName}
                        </code>
                        <p className="text-xs text-surface-contrast mt-1">
                          This will run the model and all its dependencies
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Guidance for "Compiled SQL not found" errors */}
                  {results.error.includes('Compiled SQL not found') && (
                    <div className="mt-3 text-sm bg-warning/20 border border-warning p-3 rounded">
                      <p className="font-semibold text-foreground mb-2">
                        💡 Solution:
                      </p>
                      <p className="text-surface-contrast mb-2">
                        Try compiling the model first using the compile command.
                      </p>
                      <code className="block bg-surface px-2 py-1 rounded text-xs">
                        dbt compile --select {results.modelName}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {results &&
          !results.error &&
          !isExecuting &&
          results.columns.length > 0 && (
            <table className="w-full border-collapse">
              <thead className="bg-surface sticky top-0 z-10">
                <tr>
                  {results.columns.map((column, index) => (
                    <th
                      key={index}
                      className="px-4 py-2 text-left text-xs font-semibold text-foreground border-b border-neutral whitespace-nowrap cursor-pointer hover:bg-neutral/50 select-none transition-colors"
                      onClick={() => handleSort(index)}
                    >
                      <div className="flex items-center gap-1">
                        {column}
                        <span className="w-4 h-4 flex items-center justify-center">
                          {sortConfig.columnIndex === index ? (
                            sortConfig.direction === 'asc' ? (
                              <ChevronUpIcon className="w-3 h-3 text-primary" />
                            ) : (
                              <ChevronDownIcon className="w-3 h-3 text-primary" />
                            )
                          ) : (
                            <span className="w-3 h-3 text-surface-contrast opacity-30">
                              ⇅
                            </span>
                          )}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={rowIndex % 2 === 0 ? 'bg-card' : 'bg-surface/50'}
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-4 py-2 text-sm text-foreground border-b border-neutral whitespace-nowrap"
                      >
                        {cell !== null && cell !== undefined ? (
                          formatCellValue(cell)
                        ) : (
                          <span className="text-surface-contrast opacity-50">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        {results &&
          !results.error &&
          !isExecuting &&
          results.columns.length === 0 && (
            <div className="flex items-center justify-center h-full text-surface-contrast">
              <div className="text-center">
                <p className="text-sm">No results returned</p>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
