import { CircleStackIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { DbtProject } from '@shared/dbt/types';
import { useApp } from '@web/context/useApp';
import { Button, InputText, SelectSingle } from '@web/elements';
import { useModelStore } from '@web/stores/useModelStore';
import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import ErrorMessage from '../components/ErrorMessage';
import {
  extractColumnsFromNode,
  findModelNode,
} from '../utils/manifestColumns';
import type { AvailableModel, Column } from './SelectNode';

export const JoinColumnNode: React.FC<NodeProps> = () => {
  const { api } = useApp();

  // ModelStore integration
  const { modelingState, updateJoinState, updateSelectState } = useModelStore();

  // Get current cross join unnest configuration
  const currentJoin = useMemo(() => {
    if (!modelingState.join) {
      return null;
    }

    // For int_join_column, join is a single object, not an array
    if (!Array.isArray(modelingState.join)) {
      // This is SchemaModelFromJoinColumn
      return modelingState.join.type === 'cross_join_unnest'
        ? modelingState.join
        : null;
    }

    // For regular joins (array), find the cross join unnest configuration
    // Note: This is a fallback case that shouldn't normally happen for int_join_column
    const foundJoin = modelingState.join.find(
      (join) => (join as any).type === 'cross_join_unnest',
    );

    return foundJoin; // Will have column and fields properties
  }, [modelingState.join]);

  // State management
  const [selectedColumn, setSelectedColumn] = useState<AvailableModel | null>(
    null,
  );
  const [fields, setFields] = useState<string[]>([]);
  const [fieldInputText, setFieldInputText] = useState<string>('');
  const [baseColumns, setBaseColumns] = useState<Column[]>([]);
  const [currentProject, setCurrentProject] = useState<DbtProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize from current join state
  useEffect(() => {
    if (currentJoin) {
      // Set selected column
      const joinColumn = (currentJoin as { column?: string }).column;
      if (joinColumn && !selectedColumn) {
        setSelectedColumn({
          label: joinColumn,
          value: joinColumn,
        });
      }

      // Set fields
      const joinFields = (currentJoin as { fields?: string[] }).fields;
      if (joinFields && Array.isArray(joinFields) && fields.length === 0) {
        const validFields = joinFields.filter(Boolean);
        setFields(validFields);

        // Also add fields to select array if not already there
        const currentSelections = modelingState.select;
        const fieldsToAdd = validFields.filter(
          (field) =>
            !currentSelections.some(
              (item) => typeof item === 'string' && item === field,
            ),
        );
        if (fieldsToAdd.length > 0) {
          updateSelectState([...currentSelections, ...fieldsToAdd] as any);
        }
      }
    }
  }, [
    currentJoin,
    selectedColumn,
    fields.length,
    modelingState.select,
    updateSelectState,
  ]);

  // Fetch base model columns
  const fetchBaseColumns = useCallback(() => {
    if (!modelingState.from?.model || !currentProject?.manifest) {
      setBaseColumns([]);
      return;
    }

    const modelNode = findModelNode(
      currentProject.manifest,
      modelingState.from.model as string,
    );
    setBaseColumns(extractColumnsFromNode(modelNode));
  }, [modelingState.from?.model, currentProject]);

  // Fetch initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch projects
        const projectsResponse = await api.post({
          type: 'dbt-fetch-projects',
          request: null,
        });
        const projects = projectsResponse || [];

        if (projects.length > 0) {
          const project = projects[0];
          setCurrentProject(project);
        }
      } catch (err) {
        setError('Failed to fetch project data');
        console.error('Error fetching initial data:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchInitialData();
  }, [api]);

  // Fetch base columns when project is available
  useEffect(() => {
    if (currentProject) {
      fetchBaseColumns();
    }
  }, [currentProject, fetchBaseColumns]);

  // Generate column options from base model
  const columnOptions = useMemo(() => {
    return baseColumns.map((column) => ({
      label: column.name,
      value: column.name,
    }));
  }, [baseColumns]);

  // Update join configuration in ModelStore
  const updateJoinConfiguration = useCallback(
    (column: string, fieldList: string[]) => {
      const validFields = fieldList.filter(Boolean);

      const joinConfig = {
        type: 'cross_join_unnest' as const,
        column,
        fields: column
          ? (validFields as [string, ...string[]])
          : ([] as unknown as [string, ...string[]]),
      };

      // Update the join state with cross join unnest configuration
      // For int_join_column, save as single object, not array
      updateJoinState(joinConfig);
    },
    [updateJoinState],
  );

  // Handle column selection
  const handleColumnChange = useCallback(
    (option: AvailableModel | null) => {
      setSelectedColumn(option);
      // Keep existing fields when changing / clearing the column — user may be
      // correcting a wrong selection and should not have to re-enter field names.
      updateJoinConfiguration(option?.value ?? '', fields);
    },
    [fields, updateJoinConfiguration],
  );

  // Add field to the list
  const handleAddField = useCallback(() => {
    if (fieldInputText.trim() && !fields.includes(fieldInputText.trim())) {
      const fieldName = fieldInputText.trim();
      const updatedFields = [...fields, fieldName];
      setFields(updatedFields);
      setFieldInputText('');
      updateJoinConfiguration(selectedColumn?.value || '', updatedFields);

      // Add field as individual column name to select array (like ModelColumns does)
      const currentSelections = modelingState.select;
      // Check if field is not already in select array (checking for string type)
      const fieldExists = currentSelections.some(
        (item) => typeof item === 'string' && item === fieldName,
      );
      if (!fieldExists) {
        updateSelectState([...currentSelections, fieldName] as any);
      }
    }
  }, [
    fieldInputText,
    fields,
    selectedColumn,
    updateJoinConfiguration,
    modelingState.select,
    updateSelectState,
  ]);

  // Remove field from the list
  const handleRemoveField = useCallback(
    (fieldToRemove: string) => {
      const updatedFields = fields.filter((field) => field !== fieldToRemove);
      setFields(updatedFields);
      updateJoinConfiguration(selectedColumn?.value || '', updatedFields);

      // Remove field from select array as well
      const currentSelections = modelingState.select;
      const filteredSelections = currentSelections.filter(
        (item) => !(typeof item === 'string' && item === fieldToRemove),
      );
      updateSelectState(filteredSelections);
    },
    [
      fields,
      selectedColumn,
      updateJoinConfiguration,
      modelingState.select,
      updateSelectState,
    ],
  );

  if (loading) {
    return (
      <div className="bg-background border-2 border-neutral rounded-lg p-4 min-w-[400px] shadow-lg">
        <Handle
          type="target"
          position={Position.Top}
          id="input"
          style={{
            background: '#757575',
            border: '1px solid #757575',
            width: '8px',
            height: '8px',
          }}
        />

        <div className="flex items-center gap-2 mb-4">
          <CircleStackIcon className="w-5 h-5" />
          <span className="font-medium text-foreground">Join Column</span>
        </div>
        <div className="text-center text-muted-foreground">Loading...</div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="output"
          style={{
            background: '#757575',
            border: '1px solid #757575',
            width: '8px',
            height: '8px',
          }}
        />
      </div>
    );
  }

  return (
    <div className="bg-background border-2 border-neutral rounded-lg p-4 min-w-[400px] max-w-[500px] shadow-lg">
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
      />

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <CircleStackIcon className="w-5 h-5" />
        <span className="font-medium text-foreground">Join Column</span>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Column Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          Column Selection
        </label>
        <SelectSingle
          label=""
          value={selectedColumn}
          onChange={handleColumnChange}
          onBlur={() => {}}
          options={columnOptions}
          placeholder="Select column to unnest"
          selectedDisplayValue={(opt) => opt?.label ?? ''}
          className="w-full border border-neutral rounded-md py-2 px-4 bg-background text-foreground h-10 text-sm"
        />
      </div>

      {!selectedColumn && <ErrorMessage type="join_column_selection" />}

      {/* Fields */}
      {selectedColumn && (
        <div className="mb-4">
          <div className="text-sm font-medium text-foreground mb-2">Fields</div>

          {/* Display added fields */}
          {fields.length > 0 ? (
            <div className="space-y-2 mb-3">
              {fields.map((field: string) => (
                <div
                  key={field}
                  className="flex items-center justify-between p-2 border border-neutral bg-card rounded-md"
                >
                  <span className="text-sm text-foreground">{field}</span>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveField(field);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="p-1 hover:bg-muted rounded transition-colors"
                    title="Remove field"
                    variant="iconButton"
                    label=""
                    icon={
                      <XMarkIcon className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground mb-2">
              No fields added yet
            </div>
          )}

          {/* Add new field input */}
          <div className="grid grid-cols-4 gap-2">
            <div className="w-full col-span-3">
              <InputText
                value={fieldInputText}
                onChange={(e) => setFieldInputText(e.target.value)}
                placeholder="Enter field name"
                onMouseDown={(e) => e.stopPropagation()}
                className="rounded-md"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddField();
                  }
                }}
              />
            </div>
            <Button
              label="+ Add"
              className="m-0 border border-primary rounded-md ring-primary text-primary mt-0"
              variant="link"
              onClick={(e) => {
                e.stopPropagation();
                handleAddField();
              }}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>

          {!fields ||
            (fields.length === 0 && (
              <div className="my-4">
                <ErrorMessage type="join_column_fields" />
              </div>
            ))}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{
          background: '#757575',
          border: '1px solid #757575',
          width: '8px',
          height: '8px',
        }}
      />
    </div>
  );
};
