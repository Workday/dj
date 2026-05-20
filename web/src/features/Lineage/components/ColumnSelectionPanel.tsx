import {
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Panel } from '@xyflow/react';
import React, { useMemo, useState } from 'react';

import { ColumnCard } from './ColumnCard';

export interface Column {
  name: string;
  data_type?: string;
  description?: string;
}

export interface ColumnSelectionPanelProps {
  /** Mode determines how the panel is displayed */
  mode?: 'columnLineage' | 'modelLineage';
  /** Model name to display */
  modelName?: string;
  /** List of columns to display */
  columns: Column[];
  /** Currently selected column name */
  selectedColumn?: string;
  /** Whether columns are being loaded */
  isLoading?: boolean;
  /** Error message to display */
  error?: string;
  /** Callback when a column is selected */
  onColumnSelect: (columnName: string) => void;
  /** Callback when panel is closed */
  onClose?: () => void;
  /** Callback when retry is requested */
  onRetry?: () => void;

  selectedNodeType?: string;
}

/**
 * A React Flow Panel component for selecting columns from a list.
 * Displays on the right side with search functionality.
 * When mode='modelLineage', renders without the React Flow Panel wrapper.
 */
export const ColumnSelectionPanel: React.FC<ColumnSelectionPanelProps> = ({
  mode = 'columnLineage',
  modelName,
  columns,
  selectedColumn,
  isLoading,
  error,
  onColumnSelect,
  onClose,
  onRetry,
  selectedNodeType,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredColumns = useMemo(() => {
    if (!searchTerm.trim()) {
      return columns;
    }
    const lowerSearch = searchTerm.toLowerCase();
    return columns.filter((col) =>
      col.name.toLowerCase().includes(lowerSearch),
    );
  }, [columns, searchTerm]);

  const content = (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral flex justify-between items-center">
        <span className="text-sm font-medium text-foreground">
          {mode === 'modelLineage'
            ? selectedNodeType === 'model'
              ? 'Model Columns'
              : selectedNodeType === 'source'
                ? 'Source Columns'
                : 'Seed Columns'
            : 'Choose column'}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 flex items-center justify-center text-foreground opacity-70 hover:opacity-100 transition-opacity"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Model name */}
      {modelName && (
        <div className="px-4 py-3 text-xs text-surface-contrast border-b border-neutral">
          <span className="mr-1">
            {selectedNodeType === 'model'
              ? 'Model:'
              : selectedNodeType === 'source'
                ? 'Source:'
                : 'Seed:'}
          </span>
          <span className="font-medium break-all" title={modelName}>
            {modelName}
          </span>
        </div>
      )}

      {/* Search input */}
      <div className="p-4">
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder="Search columns"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full py-2 px-3 pl-9 text-[13px] bg-background text-foreground border border-neutral rounded focus:border-primary focus:outline-none"
          />
          <MagnifyingGlassIcon className="w-4 h-4 text-surface-contrast absolute left-2.5 pointer-events-none" />
        </div>
      </div>

      {/* Column list */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <div className="text-center py-6 px-4">
            <ExclamationCircleIcon className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm text-red-700 mb-3">{error}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
        ) : filteredColumns.length > 0 ? (
          filteredColumns.map((col) => (
            <ColumnCard
              key={col.name}
              name={col.name}
              dataType={col.data_type}
              description={col.description}
              isSelected={selectedColumn === col.name}
              onClick={() => onColumnSelect(col.name)}
            />
          ))
        ) : (
          <div className="text-center py-6 text-surface-contrast text-[13px]">
            {searchTerm
              ? 'No columns match your search'
              : 'No columns available'}
          </div>
        )}
      </div>
    </>
  );

  // In modelLineage mode, render without the React Flow Panel wrapper
  if (mode === 'modelLineage') {
    return <div className="h-full bg-card flex flex-col">{content}</div>;
  }

  return (
    <Panel
      position="top-right"
      className="min-w-96 w-[30vw] h-full !m-0 !p-0 bg-card border-l border-neutral flex flex-col"
    >
      {content}
    </Panel>
  );
};
