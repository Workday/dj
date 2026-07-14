import {
  ButtonGroup,
  InputText,
  SelectMulti,
  SelectSingle,
  Tooltip,
} from '@web/elements';
import { FieldInputText } from '@web/forms';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import type { ModelType } from '@web/utils/columnConfig';
import { isFieldSupportedForColumn } from '@web/utils/columnConfig';
import { useEffect, useMemo, useState } from 'react';

import type { ColumnValidationErrors } from '../../../utils/columnHelpers';
import type { AggregationType, ColumnTypeValue } from '../types';
import {
  AGGREGATION_OPTIONS,
  COLUMN_TYPE_OPTIONS,
  DATA_TYPE_OPTIONS,
} from '../types';

interface ColumnFormData {
  type: ColumnTypeValue;
  name: string;
  dataType: string;
  description: string;
  expression: string;
  aggregations: AggregationType[];
  model: string;
}

interface ColumnConfigGeneralProps {
  errors?: ColumnValidationErrors;
  onErrorClear?: (field: keyof ColumnValidationErrors) => void;
}

export const ColumnConfigGeneral = ({
  errors = {},
  onErrorClear,
}: ColumnConfigGeneralProps) => {
  const { editingColumn, setEditingColumn, basicFields, modelingState } =
    useModelStore();

  // Tutorial integration
  const { isPlayTutorialActive, tutorialSelectedColumn } = useTutorialStore(
    (state) => ({
      isPlayTutorialActive: state.isPlayTutorialActive,
      tutorialSelectedColumn: state.tutorialSelectedColumn,
    }),
  );

  // Use tutorial column if in tutorial mode, otherwise use editing column
  const columnToEdit = useMemo(() => {
    return isPlayTutorialActive && tutorialSelectedColumn
      ? tutorialSelectedColumn
      : editingColumn;
  }, [isPlayTutorialActive, tutorialSelectedColumn, editingColumn]);

  // Get current model type
  const modelType = basicFields.type as ModelType | undefined;

  const [formData, setFormData] = useState<ColumnFormData>({
    type: 'dim',
    name: '',
    dataType: '',
    description: '',
    expression: '',
    aggregations: [],
    model: '',
  });

  // Check if this is a datetime interval column
  const isDatetimeColumn = useMemo(
    () => formData.name === 'datetime',
    [formData.name],
  );

  // Check if fields are supported for this model type and column name
  const supportsExpr = useMemo(
    () => isFieldSupportedForColumn('expr', modelType, formData.name),
    [modelType, formData.name],
  );

  const supportsDataType = useMemo(
    () => isFieldSupportedForColumn('data_type', modelType, formData.name),
    [modelType, formData.name],
  );

  const supportsAggregation = useMemo(
    () => isFieldSupportedForColumn('agg', modelType, formData.name),
    [modelType, formData.name],
  );

  const supportsTypeSelection = useMemo(
    () => isFieldSupportedForColumn('type', modelType, formData.name),
    [modelType, formData.name],
  );

  // Model reference is only supported for int_select_model and int_lookback_model
  // when the column is a fact with aggregations
  const supportsModelRef = useMemo(
    () =>
      isFieldSupportedForColumn('model', modelType, formData.name) &&
      (modelType === 'int_select_model' || modelType === 'int_lookback_model'),
    [modelType, formData.name],
  );

  // Get available models for the model dropdown
  // This includes the "from" model and any joined models
  const availableModels = useMemo(() => {
    const models: { value: string; label: string }[] = [];

    // Add the "from" model
    const fromModel = modelingState.from?.model;
    if (fromModel && typeof fromModel === 'string') {
      models.push({ value: fromModel, label: fromModel });
    }

    // Add joined models if available
    if (modelingState.join && Array.isArray(modelingState.join)) {
      modelingState.join.forEach((joinItem) => {
        if (joinItem && 'model' in joinItem && joinItem.model) {
          const joinModel = joinItem.model;
          if (!models.some((m) => m.value === joinModel)) {
            models.push({ value: joinModel, label: joinModel });
          }
        }
      });
    }

    return models;
  }, [modelingState.from, modelingState.join]);

  // Load data from columnToEdit (either tutorial or editing column) when it changes
  useEffect(() => {
    if (columnToEdit) {
      // Handle both agg (single) and aggs (array) fields
      let aggregations: AggregationType[] = [];
      if ('aggs' in columnToEdit && Array.isArray(columnToEdit.aggs)) {
        aggregations = columnToEdit.aggs as AggregationType[];
      } else if ('agg' in columnToEdit && columnToEdit.agg) {
        aggregations = [columnToEdit.agg as AggregationType];
      }

      setFormData({
        type: (columnToEdit.type as ColumnTypeValue) || 'dim',
        name:
          ('name' in columnToEdit ? (columnToEdit.name as string) : '') || '',
        dataType:
          ('data_type' in columnToEdit
            ? (columnToEdit.data_type as string)
            : '') || '',
        description:
          ('description' in columnToEdit
            ? (columnToEdit.description as string)
            : '') || '',
        expression:
          ('expr' in columnToEdit ? (columnToEdit.expr as string) : '') || '',
        aggregations,
        model:
          ('model' in columnToEdit ? (columnToEdit.model as string) : '') || '',
      });
    }
  }, [columnToEdit]);

  const handleFieldChange = (
    field: keyof ColumnFormData,
    value: string | AggregationType[] | string[],
  ) => {
    // Special handling for datetime columns
    if (field === 'name' && value === 'datetime') {
      // Force type to 'dim' for datetime columns
      setFormData((prev) => ({
        ...prev,
        name: value,
        type: 'dim', // datetime must be dimension
        dataType: '', // clear data type
        expression: '', // clear expression
        aggregations: [], // clear aggregations
        model: '', // clear model
      }));
    } else if (field === 'type' && value === 'dim') {
      // Clear aggregations and model when changing to 'dim' type
      setFormData((prev) => ({
        ...prev,
        type: value,
        aggregations: [],
        model: '',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
    }

    // Clear error for this field when user types
    if (onErrorClear && errors[field as keyof ColumnValidationErrors]) {
      onErrorClear(field as keyof ColumnValidationErrors);
    }

    // Update editingColumn in store
    if (editingColumn) {
      const updatedColumn = { ...editingColumn };

      // Map form fields to schema fields
      switch (field) {
        case 'name': {
          (updatedColumn as Record<string, unknown>).name = value;

          // Special handling for datetime columns
          if (value === 'datetime') {
            (updatedColumn as Record<string, unknown>).type = 'dim';
            delete (updatedColumn as Record<string, unknown>).data_type;
            delete (updatedColumn as Record<string, unknown>).expr;
            delete (updatedColumn as Record<string, unknown>).agg;
            delete (updatedColumn as Record<string, unknown>).aggs;
            delete (updatedColumn as Record<string, unknown>).model;
          }
          break;
        }
        case 'type': {
          (updatedColumn as Record<string, unknown>).type = value;

          // Clear aggregations and model when changing to 'dim' type
          if (value === 'dim') {
            delete (updatedColumn as Record<string, unknown>).agg;
            delete (updatedColumn as Record<string, unknown>).aggs;
            delete (updatedColumn as Record<string, unknown>).model;
          }
          break;
        }
        case 'dataType':
          (updatedColumn as Record<string, unknown>).data_type = value;
          break;
        case 'description':
          (updatedColumn as Record<string, unknown>).description = value;
          break;
        case 'expression':
          (updatedColumn as Record<string, unknown>).expr = value;
          break;
        case 'model':
          if (value) {
            (updatedColumn as Record<string, unknown>).model = value;
          } else {
            delete (updatedColumn as Record<string, unknown>).model;
          }
          break;
        case 'aggregations': {
          const aggs = value as AggregationType[];
          // Remove old agg/aggs fields
          delete (updatedColumn as Record<string, unknown>).agg;
          delete (updatedColumn as Record<string, unknown>).aggs;

          // Set new value based on length
          if (aggs.length === 0) {
            // Do nothing, already deleted
          } else if (aggs.length === 1) {
            (updatedColumn as Record<string, unknown>).agg = aggs[0];
          } else {
            (updatedColumn as Record<string, unknown>).aggs = aggs;
          }
          break;
        }
      }

      setEditingColumn(updatedColumn);
    }
  };

  return (
    <div className="w-full">
      {/* Form Fields - Flex Wrap Layout */}
      <div>
        <div className="flex flex-col gap-4">
          {/* Type - conditional rendering based on column name */}
          {supportsTypeSelection && (
            <div
              className="min-w-[200px]"
              data-tutorial-id="colconfig-general-type"
            >
              <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                Type
                <Tooltip
                  content="Choose whether this is a Dimension (categorical/grouping column) or a Fact (numeric/measurable column)"
                  variant="outline"
                />
              </label>
              {isDatetimeColumn ? (
                <InputText
                  value="Dimension"
                  disabled
                  className="w-full"
                  title="Datetime columns can only be dimensions"
                />
              ) : (
                <ButtonGroup
                  options={COLUMN_TYPE_OPTIONS.map((opt) => opt.label)}
                  initialValue={
                    COLUMN_TYPE_OPTIONS.find(
                      (opt) => opt.value === formData.type,
                    )?.label || 'Dimension'
                  }
                  onSelect={(label) => {
                    const option = COLUMN_TYPE_OPTIONS.find(
                      (opt) => opt.label === label,
                    );
                    if (option) {
                      handleFieldChange('type', option.value);
                    }
                  }}
                />
              )}
            </div>
          )}

          {/* Name */}
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              Name
              <Tooltip
                content="The column name as it will appear in your model. Use snake_case for consistency."
                variant="outline"
              />
            </label>
            <InputText
              value={formData.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="Enter column name"
              className="w-full"
            />
            {errors.name && (
              <p className="inline-block text-error text-xs italic mt-1">
                {errors.name}
              </p>
            )}
          </div>

          {/* Data Type - hide for datetime columns */}
          {supportsDataType && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                Data Type
                <Tooltip
                  content="The SQL data type for this column (e.g., string, number, date, boolean)"
                  variant="outline"
                />
              </label>
              <SelectSingle
                options={DATA_TYPE_OPTIONS}
                value={
                  formData.dataType
                    ? DATA_TYPE_OPTIONS.find(
                        (opt) => opt.value === formData.dataType,
                      ) || null
                    : null
                }
                onChange={(option) =>
                  handleFieldChange('dataType', option?.value || '')
                }
                onBlur={() => {}}
                placeholder="Select data type"
              />
              {errors.dataType && (
                <p className="inline-block text-error text-xs italic mt-1">
                  {errors.dataType}
                </p>
              )}
            </div>
          )}

          {/* Description */}
          <div className="flex-1 min-w-[300px] w-full">
            <FieldInputText
              onChange={(e) => handleFieldChange('description', e.target.value)}
              label="Description"
              name="description"
              onBlur={() => {}}
              value={formData.description}
              tooltipText="A clear description of what this column represents and how it should be used"
            />
            {errors.description && (
              <p className="inline-block text-error text-xs italic mt-1">
                {errors.description}
              </p>
            )}
          </div>

          {/* Aggregations - Only show for Metric type */}
          {formData.type === 'fct' && supportsAggregation && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                Aggregation(s)
                <Tooltip
                  content="How this fact should be aggregated (e.g., SUM for totals, AVG for averages, COUNT for counts)"
                  variant="outline"
                />
              </label>
              <SelectMulti
                options={AGGREGATION_OPTIONS}
                value={formData.aggregations}
                onChange={(selectedValues) =>
                  handleFieldChange('aggregations', selectedValues)
                }
                placeholder="Select aggregation(s)"
              />
            </div>
          )}

          {/* Source Model - Only show for fact columns with aggregations in int_select_model/int_lookback_model */}
          {formData.type === 'fct' &&
            supportsModelRef &&
            formData.aggregations.length > 0 &&
            availableModels.length > 0 && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                  Source Model
                  <Tooltip
                    content="Select a source model to reference an existing column for aggregation. This allows you to aggregate a column from the base model or joined models."
                    variant="outline"
                  />
                </label>
                <SelectSingle
                  options={availableModels}
                  value={
                    formData.model
                      ? availableModels.find(
                          (opt) => opt.value === formData.model,
                        ) || null
                      : null
                  }
                  onChange={(option) =>
                    handleFieldChange('model', option?.value || '')
                  }
                  onBlur={() => {}}
                  placeholder="Select source model (optional)"
                />
              </div>
            )}

          {/* Expression - hide for datetime columns */}
          {supportsExpr && (
            <div className="flex-1 min-w-[300px] w-full">
              <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                Expression
                <Tooltip
                  content="SQL expression to calculate this column's value (e.g., UPPER(name), price * quantity). Leave empty to use the column as-is."
                  variant="outline"
                />
              </label>
              <textarea
                value={formData.expression}
                onChange={(e) =>
                  handleFieldChange('expression', e.target.value)
                }
                placeholder="Enter expression"
                className="w-full border border-input rounded-md bg-background text-foreground p-2 text-sm font-mono min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary"
                rows={3}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
