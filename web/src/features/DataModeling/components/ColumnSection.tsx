import { InformationCircleIcon } from '@heroicons/react/24/outline';
import LineageIcon from '@web/assets/icons/lineage.svg?react';
import { Button, Checkbox, Tooltip } from '@web/elements';
import React from 'react';

import DataTypeBadge from './DataTypeBadge';

export interface ColumnSectionColumn {
  name: string;
  dataType: string;
  description?: string;
}

export interface ColumnSectionProps {
  title: string;
  tooltip?: string;
  columns: ColumnSectionColumn[];
  includedColumns: string[];
  onColumnToggle: (columnName: string) => void;
  disabled?: boolean;
  onColumnLineageClick?: (columnName: string) => void;
}

/**
 * Section of a column picker: header with a tooltip and a
 * `selected N of N` counter, a divider, and a scrollable list of
 * checkbox rows showing the column name, a tooltip hint, the
 * `DataTypeBadge`, and an optional lineage button.
 *
 * Selection state is controlled -- the parent passes the currently
 * included column names and an `onColumnToggle(name)` callback. The
 * `disabled` flag is consumed by the inner checkbox only; the row
 * still emits click events so callers that want to intercept toggles
 * elsewhere can do so.
 */
export const ColumnSection: React.FC<ColumnSectionProps> = ({
  title,
  tooltip,
  columns,
  includedColumns,
  onColumnToggle,
  disabled = false,
  onColumnLineageClick,
}) => {
  const selectedCount = includedColumns.filter((name) =>
    columns.some((col) => col.name === name),
  ).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-foreground webkit-font-smoothing-antialiased">
            {title}
          </h4>
          {tooltip && (
            <Tooltip content={tooltip}>
              <InformationCircleIcon className="w-4 h-4 text-muted-foreground cursor-help" />
            </Tooltip>
          )}
        </div>
        <span className="text-xs text-gray-500">
          selected {selectedCount} of {columns.length}
        </span>
      </div>

      <hr className="border-border mb-1" />

      {columns.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4">
          No {title.toLowerCase()} available
        </div>
      ) : (
        <div
          className="space-y-1 overflow-y-auto react-flow__node-scrollable"
          style={{ maxHeight: columns.length > 5 ? '200px' : 'auto' }}
          onWheel={(e) => {
            if (e.type === 'wheel') {
              e.stopPropagation();
            }
          }}
        >
          {columns.map((column) => (
            <div
              key={column.name}
              className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-list-item-hover transition-colors cursor-pointer group"
              onClick={(e) => {
                e.stopPropagation();
                onColumnToggle(column.name);
              }}
            >
              <div className="flex items-center gap-2">
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    id={`${title.toLowerCase()}-${column.name}`}
                    checked={includedColumns.includes(column.name)}
                    onChange={() => onColumnToggle(column.name)}
                    disabled={disabled}
                    label={column.name}
                  />
                </div>
                <Tooltip
                  content={column.description || `Column: ${column.name}`}
                >
                  <InformationCircleIcon className="w-4 h-4 text-muted-foreground cursor-help" />
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <DataTypeBadge
                  dataType={column.dataType}
                  className="font-mono"
                />
                {onColumnLineageClick && (
                  <>
                    <div className="w-px h-4 bg-gray-200" />
                    <Tooltip content="View column lineage">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onColumnLineageClick?.(column.name);
                        }}
                        variant="iconButton"
                        label=""
                        icon={
                          <LineageIcon className="w-4 h-4 [&_g]:stroke-current" />
                        }
                        className="p-1 text-muted-foreground hover:text-primary"
                      />
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ColumnSection;
