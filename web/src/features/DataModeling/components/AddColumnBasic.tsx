import { Cog8ToothIcon } from '@heroicons/react/20/solid';
import type {
  SchemaColumnAgg,
  SchemaColumnDataType,
} from '@shared/schema/types/model.schema';
import {
  Button,
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
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ColumnValidationErrors } from '../../../utils/columnHelpers';
import {
  buildSelectColumn,
  hasValidationErrors,
  validateColumnFields,
} from '../../../utils/columnHelpers';
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

interface AddColumnBasicProps {
  onCancel: () => void;
  onConfirm: (formData: ColumnFormData) => void;
  onConfigure: () => void;
}

export const AddColumnBasic = ({
  onCancel,
  onConfirm,
  onConfigure,
}: AddColumnBasicProps) => {
  const {
    setEditingColumn,
    setShowColumnConfiguration,
    modelingState,
    updateSelectState,
    basicFields,
  } = useModelStore();

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

  const [errors, setErrors] = useState<ColumnValidationErrors>({});

  // Tutorial integration - read prefilled column data
  const { isPlayTutorialActive, tutorialSelectedColumn } = useTutorialStore(
    (state) => ({
      isPlayTutorialActive: state.isPlayTutorialActive,
      tutorialSelectedColumn: state.tutorialSelectedColumn,
    }),
  );

  // Prefill form data from tutorial when tutorial column is set
  useEffect(() => {
    if (isPlayTutorialActive && tutorialSelectedColumn) {
      // Handle aggregations - convert to array format
      let aggregations: AggregationType[] = [];
      if (
        'aggs' in tutorialSelectedColumn &&
        Array.isArray(tutorialSelectedColumn.aggs)
      ) {
        aggregations = tutorialSelectedColumn.aggs as AggregationType[];
      } else if (
        'agg' in tutorialSelectedColumn &&
        tutorialSelectedColumn.agg
      ) {
        aggregations = [tutorialSelectedColumn.agg as AggregationType];
      }

      setFormData({
        type: (tutorialSelectedColumn.type as ColumnTypeValue) || 'dim',
        name:
          ('name' in tutorialSelectedColumn
            ? tutorialSelectedColumn.name
            : '') || '',
        dataType:
          ('data_type' in tutorialSelectedColumn
            ? tutorialSelectedColumn.data_type
            : '') || '',
        description:
          ('description' in tutorialSelectedColumn
            ? tutorialSelectedColumn.description
            : '') || '',
        expression:
          ('expr' in tutorialSelectedColumn
            ? tutorialSelectedColumn.expr
            : '') || '',
        aggregations,
        model:
          ('model' in tutorialSelectedColumn
            ? tutorialSelectedColumn.model
            : '') || '',
      });
    }
  }, [isPlayTutorialActive, tutorialSelectedColumn]);
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

  const handleFieldChange = (
    field: keyof ColumnFormData,
    value: string | AggregationType[],
  ) => {
    console.log('field', field);
    console.log('value', value);

    // Special handling for datetime columns
    if (field === 'name' && value === 'datetime') {
      // Force type to 'dim' for datetime columns
      setFormData((prev) => ({
        ...prev,
        name: value as string,
        type: 'dim', // datetime must be dimension
        dataType: '', // clear data type
        expression: '', // clear expression
        aggregations: [], // clear aggregations
        model: '', // clear model
      }));
    } else if (field === 'type' && value === 'dim') {
      // Clear aggregations and model when switching to dimension
      setFormData((prev) => ({
        ...prev,
        type: value as ColumnTypeValue,
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
    if (errors[field as keyof ColumnValidationErrors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  const handleCancel = () => {
    // Reset form and errors
    setFormData({
      type: 'dim',
      name: '',
      dataType: '',
      description: '',
      expression: '',
      aggregations: [],
      model: '',
    });
    setErrors({});
    onCancel();
  };

  const handleOk = useCallback(() => {
    // Validate fields
    const validationErrors = validateColumnFields({
      name: formData.name,
      description: formData.description,
      dataType: formData.dataType,
    });

    if (hasValidationErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    // Build the column object based on type and aggregations
    // Handle aggregations: if single, use agg; if multiple, use aggs
    const aggs = formData.aggregations;
    const columnData = buildSelectColumn({
      name: formData.name.trim(),
      type: formData.type,
      expr: formData.expression.trim() || '',
      // Include model if it's selected (for SchemaModelSelectModelWithAgg)
      ...(formData.model ? { model: formData.model } : {}),
      data_type: (formData.dataType as SchemaColumnDataType) || undefined,
      description: formData.description || undefined,
      ...(aggs.length === 1
        ? { agg: aggs[0] as SchemaColumnAgg }
        : aggs.length > 1
          ? { aggs: aggs as SchemaColumnAgg[] }
          : {}),
    });

    // Add to select array
    const updatedSelect = [...modelingState.select, columnData];
    updateSelectState(updatedSelect);

    // Reset form and notify parent
    setFormData({
      type: 'dim',
      name: '',
      dataType: '',
      description: '',
      expression: '',
      aggregations: [],
      model: '',
    });
    setErrors({});
    onConfirm(formData);
  }, [formData, modelingState.select, updateSelectState, onConfirm]);

  const handleConfigure = useCallback(() => {
    // Validate fields
    const validationErrors = validateColumnFields({
      name: formData.name,
      description: formData.description,
      dataType: formData.dataType,
    });

    if (hasValidationErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    // Build partial column data to pass to configuration
    // Handle aggregations: if single, use agg; if multiple, use aggs
    const aggs = formData.aggregations;
    const columnData = {
      name: formData.name.trim(),
      type: formData.type,
      expr: formData.expression.trim() || undefined,
      // Include model if it's selected (for SchemaModelSelectModelWithAgg)
      ...(formData.model ? { model: formData.model } : {}),
      ...(formData.dataType && {
        data_type: formData.dataType as SchemaColumnDataType,
      }),
      ...(formData.description && { description: formData.description }),
      ...(aggs.length === 1
        ? { agg: aggs[0] as SchemaColumnAgg }
        : aggs.length > 1
          ? { aggs: aggs as SchemaColumnAgg[] }
          : {}),
    };

    // Set editing column and open configuration
    // Pass null as originalName since this is a new column
    setEditingColumn(columnData, null);
    setShowColumnConfiguration(true);
    onConfigure();
  }, [formData, setEditingColumn, setShowColumnConfiguration, onConfigure]);

  return (
    <div
      className="bg-background border-t border-border p-4"
      data-tutorial-id="add-column-modal"
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-foreground">
          Add Column Manually
        </h3>
        <Tooltip content="Open advanced column configuration to set up Lightdash properties, data tests, and other detailed settings">
          <Button
            variant="iconButton"
            label="Configure"
            onClick={handleConfigure}
            icon={<Cog8ToothIcon className="h-4 w-4" />}
          />
        </Tooltip>
      </div>

      {/* Form Fields - Flex Wrap Layout */}
      <div className="bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          {/* Type - conditional rendering based on column name */}
          {supportsTypeSelection && (
            <div
              className="flex-1 min-w-[200px]"
              data-tutorial-id="add-column-type"
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
          <div
            className="flex-1 min-w-[200px]"
            data-tutorial-id="add-column-name"
          >
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
            <div
              className="flex-1 min-w-[200px]"
              data-tutorial-id="add-column-datatype"
            >
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
          <div
            className="flex-1 min-w-[300px] w-full"
            data-tutorial-id="add-column-description"
          >
            <FieldInputText
              onChange={(e) => handleFieldChange('description', e.target.value)}
              label="Description"
              name="description"
              labelClassName="font-medium mt-0 text-sm mb-2"
              inputClassName="mt-0"
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

          {/* Expression - hide for datetime columns */}
          {supportsExpr && (
            <div
              className="flex-1 min-w-[300px] w-full"
              data-tutorial-id="add-column-expression"
            >
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

          {/* Aggregations & Source Model Row - Only show for Metric type and if model supports aggregation */}
          {formData.type === 'fct' && supportsAggregation && (
            <div className="flex gap-4 w-full">
              {/* Aggregations */}
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
                    handleFieldChange(
                      'aggregations',
                      selectedValues as AggregationType[],
                    )
                  }
                  placeholder="Select aggregation(s)"
                />
              </div>

              {/* Source Model - Only show when aggregations are selected and model supports it */}
              {supportsModelRef &&
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
            </div>
          )}
        </div>
      </div>
      {/* Action Buttons */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
        <Button label="Cancel" variant="link" onClick={handleCancel} />
        <Button label="Add Column" variant="primary" onClick={handleOk} />
      </div>
    </div>
  );
};
