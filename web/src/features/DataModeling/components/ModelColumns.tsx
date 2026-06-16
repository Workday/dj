import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { Button, InputText, RadioGroup, Tooltip } from '@web/elements';
import { useModelStore } from '@web/stores/useModelStore';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getSelectedColumns,
  modelColumnSelectionList,
} from '../../../utils/dataModeling';
import type { SelectionSourceKind } from '../types';
import { SelectionType } from '../types';
import { ColumnSection } from './ColumnSection';

interface Column {
  name: string;
  dataType: string;
  type: 'dimension' | 'fact';
  description?: string;
}

interface ModelColumnsProps {
  columns?: Column[];
  nodeId?: string; // Used to create unique radio group names per node
  onSelectionChange?: (
    selectionType: SelectionType,
    result: { include?: string[]; exclude?: string[] },
    shouldClear?: boolean,
  ) => void;
  defaultValue?: {
    filterType?: SelectionType;
    include?: string[];
    exclude?: string[];
  };
  /**
   * @deprecated Prefer `sourceKind`. Retained for backwards compatibility with
   * callers (e.g. JoinNode) that haven't been migrated yet. When `sourceKind`
   * is provided it wins; otherwise `isSourceModel` is mapped to
   * `'source' | 'model'`.
   */
  isSourceModel?: boolean;
  /**
   * Discriminates the upstream the SELECT is reading from. Drives the
   * radio-options branch and the bulk-directive variants emitted onto the
   * model JSON (`{all,dims,fcts}_from_{model,source,cte}`).
   */
  sourceKind?: SelectionSourceKind;
  onColumnLineageClick?: (columnName: string) => void; // Callback for column lineage navigation
}

export const ModelColumns: React.FC<ModelColumnsProps> = ({
  columns = [],
  onSelectionChange,
  defaultValue,
  isSourceModel = false,
  sourceKind,
  nodeId,
  onColumnLineageClick,
}) => {
  // Prefer the explicit `sourceKind`; fall back to the older `isSourceModel`
  // boolean so unmigrated call sites continue to work unchanged.
  const effectiveKind: SelectionSourceKind =
    sourceKind ?? (isSourceModel ? 'source' : 'model');
  // Determine initial filter type from defaultValue or empty string
  const [filterType, setFilterType] = useState<SelectionType | ''>(
    defaultValue?.filterType || '',
  );
  const [searchTerm, setSearchTerm] = useState<string>('');

  const { basicFields } = useModelStore();

  const noFiltersAvailable =
    basicFields.type === 'int_join_column' ||
    basicFields.type === 'int_rollup_model';

  const noColumnSelections = basicFields.type === 'int_rollup_model';

  // State to track individual column selections (for filterType === '')
  const [individualColumnSelections, setIndividualColumnSelections] = useState<
    string[]
  >([]);

  const [selectionState, setSelectionState] = useState<{
    filterType?: SelectionType;
    include?: string[];
    exclude?: string[];
  }>(() => {
    // Initialize with prefilled data if provided
    if (
      defaultValue?.filterType &&
      (defaultValue.include || defaultValue.exclude)
    ) {
      return {
        filterType: defaultValue.filterType,
        ...(defaultValue.include && { include: defaultValue.include }),
        ...(defaultValue.exclude && { exclude: defaultValue.exclude }),
      };
    }
    return {};
  });

  // If defaultValue changes externally, update local state accordingly
  useEffect(() => {
    if (defaultValue?.filterType !== undefined) {
      // Check if we're in active individual selection mode - don't override if so
      const isInActiveIndividualMode =
        filterType === '' && individualColumnSelections.length > 0;

      if (isInActiveIndividualMode) {
        return;
      }

      setFilterType(defaultValue.filterType);

      // Handle individual column selections (filterType === '')
      if (
        defaultValue.filterType === ('' as SelectionType) &&
        defaultValue.include
      ) {
        setIndividualColumnSelections(defaultValue.include);
      }

      setSelectionState({
        filterType: defaultValue.filterType,
        ...(defaultValue.include && { include: defaultValue.include }),
        ...(defaultValue.exclude && { exclude: defaultValue.exclude }),
      });
    }
  }, [defaultValue?.filterType, defaultValue?.include, defaultValue?.exclude]);

  // Radio options depend on the upstream kind. Sources still gate Dims/Fcts
  // off because source columns don't carry dim/fct typing; CTEs and models
  // expose all three.
  const radioOptions = useMemo(() => {
    if (effectiveKind === 'source') {
      return [
        { value: SelectionType.ALL_FROM_SOURCE, label: 'All From Source' },
        {
          value: SelectionType.DIMS_FROM_SOURCE,
          label: 'Dims',
          disabled: true,
        },
        {
          value: SelectionType.FCTS_FROM_SOURCE,
          label: 'Fcts',
          disabled: true,
        },
      ];
    }
    if (effectiveKind === 'cte') {
      return [
        { value: SelectionType.ALL_FROM_CTE, label: 'All From CTE' },
        { value: SelectionType.DIMS_FROM_CTE, label: 'Dims' },
        { value: SelectionType.FCTS_FROM_CTE, label: 'Fcts' },
      ];
    }
    return [
      { value: SelectionType.ALL_FROM_MODEL, label: 'All From Model' },
      { value: SelectionType.DIMS_FROM_MODEL, label: 'Dims' },
      { value: SelectionType.FCTS_FROM_MODEL, label: 'Fcts' },
    ];
  }, [effectiveKind]);

  // Stable radio group name per component instance to prevent cross-component
  // interference. Includes the source kind so an instance that flips from
  // model→cte gets a fresh radio group rather than inheriting stale state.
  const groupNameRef = useRef<string>(
    (() => {
      const base = `column-filter-${effectiveKind}`;
      return nodeId
        ? `${base}-${nodeId}`
        : `${base}-${Math.random().toString(36).slice(2, 8)}`;
    })(),
  );

  // Get all available columns for the current selection type
  const getAvailableColumnsForType = useCallback(
    (type: SelectionType) => {
      switch (type) {
        case SelectionType.DIMS_FROM_MODEL:
        case SelectionType.DIMS_FROM_SOURCE:
        case SelectionType.DIMS_FROM_CTE:
          return columns
            .filter((col) => col.type === 'dimension')
            .map((col) => col.name);
        case SelectionType.FCTS_FROM_MODEL:
        case SelectionType.FCTS_FROM_SOURCE:
        case SelectionType.FCTS_FROM_CTE:
          return columns
            .filter((col) => col.type === 'fact')
            .map((col) => col.name);
        case SelectionType.ALL_FROM_MODEL:
        case SelectionType.ALL_FROM_SOURCE:
        case SelectionType.ALL_FROM_CTE:
        default:
          return columns.map((col) => col.name);
      }
    },
    [columns],
  );

  const currentSelectionType =
    filterType ||
    (effectiveKind === 'source'
      ? SelectionType.ALL_FROM_SOURCE
      : effectiveKind === 'cte'
        ? SelectionType.ALL_FROM_CTE
        : SelectionType.ALL_FROM_MODEL);

  const availableColumns = getAvailableColumnsForType(currentSelectionType);

  // Use selectionState only if it matches current filter type, otherwise use default (all selected)
  const currentIncludedColumns = useMemo(() => {
    return selectionState.filterType === currentSelectionType
      ? getSelectedColumns(
          availableColumns,
          selectionState.include,
          selectionState.exclude,
        )
      : availableColumns; // Default to all columns selected if no specific selection for this type
  }, [
    selectionState.filterType,
    currentSelectionType,
    availableColumns,
    selectionState.include,
    selectionState.exclude,
  ]);

  // Use ref to track the last processed selection to prevent infinite loops
  const lastProcessedSelection = useRef<string>('');

  // Store onSelectionChange in a ref to avoid triggering useEffect when it changes
  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    if (filterType !== '') {
      const modelColumnSelection = modelColumnSelectionList(
        availableColumns,
        currentIncludedColumns,
      );

      // Create a stable key for comparison to prevent infinite updates
      const selectionKey = `${currentSelectionType}-${JSON.stringify(modelColumnSelection)}`;

      // Only call onSelectionChange if the selection actually changed
      if (lastProcessedSelection.current !== selectionKey) {
        lastProcessedSelection.current = selectionKey;
        onSelectionChangeRef.current?.(
          currentSelectionType,
          modelColumnSelection,
        );
      }
    }
  }, [
    currentSelectionType,
    currentIncludedColumns,
    filterType,
    availableColumns,
  ]);

  const handleColumnToggle = useCallback(
    (columnName: string) => {
      if (filterType === '') return;

      setSelectionState((prev) => {
        const currentType = filterType;
        const typeAvailableColumns = getAvailableColumnsForType(currentType);

        // Get current selected columns
        const currentSelected =
          prev.filterType === currentType
            ? getSelectedColumns(
                typeAvailableColumns,
                prev.include,
                prev.exclude,
              )
            : typeAvailableColumns; // Default to all selected if no previous selection

        // Toggle the column
        const newSelected = currentSelected.includes(columnName)
          ? currentSelected.filter((name: string) => name !== columnName)
          : [...currentSelected, columnName];

        // Calculate optimal include/exclude representation
        const modelColumnSelection = modelColumnSelectionList(
          typeAvailableColumns,
          newSelected,
        );

        // Notify parent with optimized selection
        onSelectionChangeRef.current?.(currentType, modelColumnSelection);

        // Return new state with current filter type
        return {
          filterType: currentType,
          ...modelColumnSelection,
        };
      });
    },
    [filterType, getAvailableColumnsForType],
  );

  const handleIndividualColumnToggle = useCallback((columnName: string) => {
    setIndividualColumnSelections((prev) => {
      // Toggle the column
      const newSelections = prev.includes(columnName)
        ? prev.filter((name) => name !== columnName)
        : [...prev, columnName];

      // Notify parent with the column names as strings
      // We use empty string to indicate individual column selection (SchemaColumnName)
      const callback = onSelectionChangeRef.current as
        | ((
            selectionType: SelectionType | '',
            result: { include?: string[]; exclude?: string[] },
            shouldClear?: boolean,
          ) => void)
        | undefined;

      callback?.('', { include: newSelections }, false);

      return newSelections;
    });
  }, []);

  // Clear button handler - resets filter type, search term, and selections
  const handleClear = useCallback(() => {
    setFilterType('');
    setSearchTerm('');
    setSelectionState({});
    setIndividualColumnSelections([]);
    lastProcessedSelection.current = '';
    // Notify parent to clear the select state for this model with shouldClear flag
    onSelectionChangeRef.current?.(currentSelectionType, {}, true);
  }, [currentSelectionType]);

  const getFilteredColumns = () => {
    const lowered = searchTerm.toLowerCase();
    const baseColumns = columns.filter((c) =>
      c.name.toLowerCase().includes(lowered),
    );
    if (
      filterType === SelectionType.DIMS_FROM_MODEL ||
      filterType === SelectionType.DIMS_FROM_SOURCE ||
      filterType === SelectionType.DIMS_FROM_CTE
    ) {
      return baseColumns.filter((c) => c.type === 'dimension');
    }
    if (
      filterType === SelectionType.FCTS_FROM_MODEL ||
      filterType === SelectionType.FCTS_FROM_SOURCE ||
      filterType === SelectionType.FCTS_FROM_CTE
    ) {
      return baseColumns.filter((c) => c.type === 'fact');
    }
    return baseColumns;
  };

  const filteredColumns = getFilteredColumns();
  const dimensions = filteredColumns.filter((col) => col.type === 'dimension');
  const facts = filteredColumns.filter((col) => col.type === 'fact');

  if (columns.length === 0) {
    return (
      <div className="rounded-lg px-4 py-2 bg-card mt-4">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-md font-medium text-foreground">Columns</h3>
          <Tooltip content="Select columns to include in your model">
            <InformationCircleIcon className="w-4 h-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </div>
        <div className="text-sm text-muted-foreground text-center py-4">
          No columns available. Select a{' '}
          {effectiveKind === 'source'
            ? 'source'
            : effectiveKind === 'cte'
              ? 'CTE'
              : 'model'}{' '}
          to view its columns.
        </div>
      </div>
    );
  }

  // Generate a unique and stable radio group name to avoid collisions between different nodes.
  // If nodeId is provided (SelectNode passes a static one, JoinNode passes its flow id), use it directly.
  // Fallback includes a random suffix to ensure uniqueness when nodeId is absent.
  // Stable group name computed once

  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-md font-medium text-foreground">Columns</h3>
          <Tooltip content="Select columns to include in your model">
            <InformationCircleIcon className="w-4 h-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </div>
        {filterType !== '' && (
          <Button
            onClick={handleClear}
            variant="iconButton"
            className="text-xs font-medium hover:bg-list-item-hover hover:text-muted-foreground text-muted-foreground m-0 py-1 px-1"
            label="Reset"
            //icon={<XMarkIcon className="w-3 h-3" />}
          />
        )}
      </div>

      {!noFiltersAvailable && (
        <div>
          <RadioGroup
            options={radioOptions}
            value={filterType}
            onChange={(value) => setFilterType(value as SelectionType)}
            name={groupNameRef.current}
            className="w-max gap-4"
          />
        </div>
      )}

      <div>
        <InputText
          placeholder="Search Columns"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          inputClassName="rounded"
          //inputClassName="w-full border border-input rounded bg-background text-foreground placeholder-muted-foreground"
        />
      </div>

      {filterType === '' && (
        <>
          <ColumnSection
            title="Dimensions"
            tooltip="Select individual columns to add to your model"
            columns={dimensions}
            includedColumns={individualColumnSelections}
            onColumnToggle={handleIndividualColumnToggle}
            disabled={noColumnSelections}
            onColumnLineageClick={onColumnLineageClick}
          />
          <ColumnSection
            title="Facts"
            tooltip="Select individual columns to add to your model"
            columns={facts}
            includedColumns={individualColumnSelections}
            onColumnToggle={handleIndividualColumnToggle}
            disabled={noColumnSelections}
            onColumnLineageClick={onColumnLineageClick}
          />
        </>
      )}

      {(filterType === SelectionType.ALL_FROM_MODEL ||
        filterType === SelectionType.ALL_FROM_SOURCE ||
        filterType === SelectionType.ALL_FROM_CTE) && (
        <>
          <ColumnSection
            title="Dimensions"
            tooltip="Categorical columns used for grouping and filtering"
            columns={dimensions}
            includedColumns={currentIncludedColumns}
            onColumnToggle={handleColumnToggle}
            onColumnLineageClick={onColumnLineageClick}
          />
          <ColumnSection
            title="Facts"
            tooltip="Numerical columns used for calculations and aggregations"
            columns={facts}
            includedColumns={currentIncludedColumns}
            onColumnToggle={handleColumnToggle}
            onColumnLineageClick={onColumnLineageClick}
          />
        </>
      )}

      {effectiveKind !== 'source' &&
        (filterType === SelectionType.DIMS_FROM_MODEL ||
          filterType === SelectionType.DIMS_FROM_CTE) && (
          <ColumnSection
            title="Dimensions"
            tooltip="Categorical columns used for grouping and filtering"
            columns={dimensions}
            includedColumns={currentIncludedColumns}
            onColumnToggle={handleColumnToggle}
            onColumnLineageClick={onColumnLineageClick}
          />
        )}

      {effectiveKind !== 'source' &&
        (filterType === SelectionType.FCTS_FROM_MODEL ||
          filterType === SelectionType.FCTS_FROM_CTE) && (
          <ColumnSection
            title="Facts"
            tooltip="Numerical columns used for calculations and aggregations"
            columns={facts}
            includedColumns={currentIncludedColumns}
            onColumnToggle={handleColumnToggle}
            onColumnLineageClick={onColumnLineageClick}
          />
        )}
    </div>
  );
};
