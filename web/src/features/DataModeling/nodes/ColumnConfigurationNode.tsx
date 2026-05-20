import { XMarkIcon } from '@heroicons/react/20/solid';
import { Button, Tab, Tooltip } from '@web/elements';
import type { SchemaSelect } from '@web/stores/useModelStore';
import { useModelStore } from '@web/stores/useModelStore';
import {
  TutorialComponentState,
  useTutorialStore,
} from '@web/stores/useTutorialStore';
import type { ColumnValidationErrors } from '@web/utils/columnHelpers';
import {
  hasValidationErrors,
  validateColumnFields,
} from '@web/utils/columnHelpers';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, { useCallback, useState } from 'react';

import { ColumnConfigGeneral } from '../components/ColumnConfigGeneral';
import { ColumnConfigLightdash } from '../components/ColumnConfigLightdash';
import { ColumnConfigOthers } from '../components/ColumnConfigOthers';

export const ColumnConfigurationNode: React.FC<NodeProps> = () => {
  const {
    editingColumn,
    editingColumnOriginalName,
    setEditingColumn,
    setShowColumnConfiguration,
    modelingState,
    updateSelectState,
    setNavigationNodeType,
  } = useModelStore();

  // Tutorial store integration - NEW: Use enum-based state
  const {
    isPlayTutorialActive,
    currentComponentState,
    tutorialSelectedColumn,
    // tutorialActiveTabIndex,
  } = useTutorialStore((state) => ({
    isPlayTutorialActive: state.isPlayTutorialActive,
    currentComponentState: state.currentComponentState,
    tutorialSelectedColumn: state.tutorialSelectedColumn,
    // tutorialActiveTabIndex: state.tutorialActiveTabIndex,
  }));

  // NEW: Check if Column Configuration should be shown based on enum state
  const isColumnConfigOpen =
    currentComponentState === TutorialComponentState.COLUMN_CONFIG_OVERVIEW ||
    currentComponentState === TutorialComponentState.COLUMN_CONFIG_TABS ||
    currentComponentState ===
      TutorialComponentState.COLUMN_CONFIG_GENERAL_TAB ||
    currentComponentState ===
      TutorialComponentState.COLUMN_CONFIG_LIGHTDASH_TAB ||
    currentComponentState === TutorialComponentState.COLUMN_CONFIG_OTHERS_TAB ||
    currentComponentState === TutorialComponentState.LIGHTDASH_DIMENSION ||
    currentComponentState ===
      TutorialComponentState.LIGHTDASH_STANDARD_METRICS ||
    currentComponentState === TutorialComponentState.LIGHTDASH_CUSTOM_METRICS ||
    currentComponentState === TutorialComponentState.LIGHTDASH_METRICS_MERGE ||
    currentComponentState === TutorialComponentState.OTHERS_EXCLUDE_GROUPBY ||
    currentComponentState === TutorialComponentState.OTHERS_INTERVAL ||
    currentComponentState === TutorialComponentState.OTHERS_DATA_TESTS;

  const columnToEdit = isPlayTutorialActive
    ? tutorialSelectedColumn
    : editingColumn;

  const [errors, setErrors] = useState<ColumnValidationErrors>({});

  const handleErrorClear = useCallback(
    (field: keyof ColumnValidationErrors) => {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    },
    [],
  );

  const handleClose = useCallback(() => {
    setNavigationNodeType('columnSelectionNode');
    setShowColumnConfiguration(false);
    setEditingColumn(null);
    setErrors({});
  }, [setNavigationNodeType, setShowColumnConfiguration, setEditingColumn]);

  const handleUpdate = useCallback(() => {
    if (!editingColumn) {
      setErrors({ name: 'No column data to save' });
      return;
    }

    // Check if name exists (for expr-based columns)
    const hasName = 'name' in editingColumn && editingColumn.name;
    if (!hasName) {
      setErrors({ name: 'Column name is required' });
      return;
    }

    const columnName = editingColumn.name as string;

    if (columnName === 'datetime') {
      if (!('interval' in editingColumn)) {
        // interval is required for datetime columns
        setErrors({
          interval:
            'Interval is required for datetime columns, please set it in the Others tab',
        });
        return;
      }
    }
    const columnDescription = (
      'description' in editingColumn ? editingColumn.description : ''
    ) as string;
    const columnDataType = (
      'data_type' in editingColumn ? editingColumn.data_type : ''
    ) as string;

    // Validate required fields
    const validationErrors = validateColumnFields({
      name: columnName,
      description: columnDescription,
      dataType: columnDataType,
    });

    if (hasValidationErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    // Find if column already exists in select array (by original name)
    // Use editingColumnOriginalName to handle column renaming
    const searchName = editingColumnOriginalName || columnName;
    const existingIndex = modelingState.select.findIndex(
      (col) =>
        typeof col !== 'string' && 'name' in col && col.name === searchName,
    );

    let updatedSelect: SchemaSelect[];
    if (existingIndex >= 0) {
      // Update existing column
      updatedSelect = [...modelingState.select];
      updatedSelect[existingIndex] = editingColumn as SchemaSelect;
    } else {
      // Add new column
      updatedSelect = [...modelingState.select, editingColumn as SchemaSelect];
    }

    // Save to store
    updateSelectState(updatedSelect);

    // Close and clear
    setShowColumnConfiguration(false);
    setEditingColumn(null);
    setErrors({});
    setNavigationNodeType('columnSelectionNode');

    // For Assist Mode: Move back to column-selection then to actions-bar
    const { assistModeEnabled, moveToAssistStep } = useTutorialStore.getState();
    if (assistModeEnabled) {
      // Small delay to let the column selection node render
      setTimeout(() => {
        moveToAssistStep('actions-bar');
      }, 100);
    }
  }, [
    columnToEdit,
    editingColumn,
    modelingState.select,
    updateSelectState,
    setShowColumnConfiguration,
    setEditingColumn,
    setNavigationNodeType,
  ]);

  // Don't render if not shown (check at render time, not during hooks)
  const shouldRender = isPlayTutorialActive
    ? isColumnConfigOpen
    : !!editingColumn;

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className="bg-background border-2 border-neutral rounded-lg shadow-lg min-w-[800px] max-w-[800px] cursor-default"
      data-tutorial-id="column-configuration-node"
    >
      <Handle type="target" position={Position.Left} id="left-input" />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral p-6">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-foreground">
            Column Configuration
          </h3>
          <Tooltip
            content="Configure advanced column settings including general properties, Lightdash visualization options, and data quality tests."
            variant="outline"
          />
        </div>
        <Button
          onClick={handleClose}
          className="p-1 hover:bg-surface rounded transition-colors"
          title="Close"
          icon={<XMarkIcon className="h-5 w-5 text-foreground" />}
          label=""
          variant="iconButton"
        />
      </div>

      {/* Content */}
      <div data-tutorial-id="column-config-tabs">
        <Tab
          tabs={['General', 'Lightdash', 'Others']}
          panels={[
            <ColumnConfigGeneral
              errors={errors}
              onErrorClear={handleErrorClear}
            />,
            <ColumnConfigLightdash />,
            <ColumnConfigOthers />,
          ]}
        ></Tab>
      </div>

      {errors.interval && (
        <p className="inline-block text-error text-xs font-bold italic mt-1 pl-6 pb-5">
          * {errors.interval}
        </p>
      )}

      {/* Footer with action buttons */}
      <div className="border-t border-neutral p-6">
        <div className="flex justify-end gap-3">
          <Button label="Cancel" variant="link" onClick={handleClose} />
          <Button label="Update" variant="primary" onClick={handleUpdate} />
        </div>
      </div>
    </div>
  );
};
