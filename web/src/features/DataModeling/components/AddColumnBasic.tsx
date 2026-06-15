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
  /**
   * Earlier-CTE reference. Only meaningful in `mode='cte'`; mirrors the
   * `model` field but emits a `cte` key in the schema row instead. Empty
   * string means "no CTE reference" (the form may still emit a plain row).
   */
  cte?: string;
  /**
   * Interval picker selection for the SchemaModelSelectInterval shape.
   * Surfaced when `name === 'datetime'`. Empty string keeps the row in its
   * pre-interval shape so an unfilled datetime column doesn't accidentally
   * emit an interval-only row.
   */
  interval?: string;
}

interface AddColumnBasicProps {
  onCancel: () => void;
  onConfirm: (formData: ColumnFormData) => void;
  onConfigure: () => void;
  /**
   * Render mode. `'main'` is the legacy behaviour: writes to
   * `modelingState.select` via `updateSelectState`. `'cte'` instead
   * delegates the row build to `onAdd`, so the caller decides which CTE
   * (or other container) receives the new column.
   */
  mode?: 'main' | 'cte';
  /**
   * Called with the built schema row in `mode='cte'` instead of writing to
   * `modelingState.select`. Caller is responsible for appending it to the
   * appropriate CTE select array via the model store. Ignored in `main`.
   */
  onAdd?: (item: unknown) => void;
  /**
   * Override the upstream-model list used in the Source Model picker. Used
   * by the CTE form to surface the CTE's own `from.model` (and any joined
   * models) rather than the main model's. Falls back to the derived list
   * when undefined.
   */
  availableModels?: { value: string; label: string }[];
  /**
   * Earlier-CTE options. Only consumed in `mode='cte'`; powers the
   * "Source CTE" picker that lives alongside "Source Model" so users can
   * reference a sibling CTE's column instead of an upstream model.
   */
  availableCtes?: { value: string; label: string }[];
  /**
   * Interval options for SchemaModelSelectInterval rows (day / hour / etc).
   * Only consumed in `mode='cte'` -- the main-model variant doesn't expose
   * interval picking through this form yet.
   */
  intervalOptions?: { value: string; label: string }[];
}

export const AddColumnBasic = ({
  onCancel,
  onConfirm,
  onConfigure,
  mode = 'main',
  onAdd,
  availableModels: availableModelsOverride,
  availableCtes,
  intervalOptions,
}: AddColumnBasicProps) => {
  const {
    setEditingColumn,
    setShowColumnConfiguration,
    modelingState,
    updateSelectState,
    basicFields,
  } = useModelStore();

  const isCteMode = mode === 'cte';

  // For CTE mode there's no single owning model type. CTE selects accept the
  // same shapes as `int_select_model` selects (interval / aggregation /
  // expression / from-model / from-cte all valid), so we substitute that
  // model type for field-support gating. The actual emitted row is decided
  // by `onAdd` in CTE mode -- this just controls which inputs render.
  const modelType = isCteMode
    ? ('int_select_model' as ModelType)
    : (basicFields.type as ModelType | undefined);

  const [formData, setFormData] = useState<ColumnFormData>({
    type: 'dim',
    name: '',
    dataType: '',
    description: '',
    expression: '',
    aggregations: [],
    model: '',
    cte: '',
    interval: '',
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

  // Datetime / Interval picker -- only meaningful in CTE mode for now;
  // main-model authoring doesn't route through this form for intervals
  // today (those come from the column wizard). When the column is named
  // `datetime` we still hide the data_type / expr / aggregations inputs.
  const supportsInterval = useMemo(
    () =>
      isCteMode &&
      isFieldSupportedForColumn('interval', modelType, formData.name),
    [isCteMode, modelType, formData.name],
  );

  // Get available models for the model dropdown
  // This includes the "from" model and any joined models. Caller can pass
  // `availableModels` to override (used by the CTE form so the picker shows
  // the CTE's own upstreams instead of the main model's).
  const availableModels = useMemo(() => {
    if (availableModelsOverride !== undefined) {
      return availableModelsOverride;
    }
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
  }, [availableModelsOverride, modelingState.from, modelingState.join]);

  // Total upstream sources in scope. With <= 1 source the column reference
  // is unambiguous (any picked column implicitly belongs to the only
  // upstream), so the Source Model / Source CTE pickers are noise. Showing
  // them in that case also tempted users into picking out-of-scope CTEs
  // from the dropdown, which produced JSON the sync layer can't resolve.
  // CTE mode only -- main-model authoring keeps its existing behaviour.
  const hasMultipleSources = useMemo(() => {
    if (!isCteMode) return true;
    const ctesCount = availableCtes?.length ?? 0;
    return availableModels.length + ctesCount > 1;
  }, [isCteMode, availableModels.length, availableCtes]);

  const handleFieldChange = (
    field: keyof ColumnFormData,
    value: string | AggregationType[],
  ) => {
    // Special handling for datetime columns
    if (field === 'name' && value === 'datetime') {
      // Force type to 'dim' for datetime columns; default interval so the
      // CTE row emits a valid SchemaModelSelectInterval out of the gate.
      setFormData((prev) => ({
        ...prev,
        name: value as string,
        type: 'dim',
        dataType: '',
        expression: '',
        aggregations: [],
        model: '',
        cte: '',
        interval: isCteMode && !prev.interval ? 'day' : prev.interval,
      }));
    } else if (field === 'type' && value === 'dim') {
      // Clear aggregations and model when switching to dimension
      setFormData((prev) => ({
        ...prev,
        type: value as ColumnTypeValue,
        aggregations: [],
        model: '',
        cte: '',
      }));
    } else if (field === 'model') {
      // Choosing a Source Model clears the Source CTE (they're mutually
      // exclusive in the schema).
      setFormData((prev) => ({
        ...prev,
        model: value as string,
        cte: '',
      }));
    } else if (field === 'cte') {
      setFormData((prev) => ({
        ...prev,
        cte: value as string,
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

  const resetForm = () => {
    setFormData({
      type: 'dim',
      name: '',
      dataType: '',
      description: '',
      expression: '',
      aggregations: [],
      model: '',
      cte: '',
      interval: '',
    });
  };

  const handleCancel = () => {
    resetForm();
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

    const aggs = formData.aggregations;

    if (isCteMode && onAdd) {
      // CTE mode emits a schema-shaped row directly; the caller appends it
      // to `cte.select`. We pick the row shape from the form state so it
      // stays close to the schema variants:
      //   - `name === 'datetime'` + interval → SchemaModelSelectInterval
      //   - `cte` set → SchemaModelSelectFromCte
      //   - `model` + aggregations → SchemaModelSelectFromModelWithAgg
      //   - `model` only → SchemaModelSelectFromModel
      //   - `expression` → SchemaModelSelectExpr (with/without agg)
      //   - bare passthrough → string (only when no metadata at all)
      const row: Record<string, unknown> = {};
      if (formData.name === 'datetime' && formData.interval) {
        row.name = 'datetime';
        row.interval = formData.interval;
        row.type = 'dim';
        if (formData.description) row.description = formData.description;
      } else if (formData.cte) {
        row.cte = formData.cte;
        row.name = formData.name.trim();
        row.type = formData.type;
        if (formData.dataType) row.data_type = formData.dataType;
        if (formData.description) row.description = formData.description;
      } else if (formData.model) {
        row.model = formData.model;
        row.name = formData.name.trim();
        row.type = formData.type;
        if (formData.dataType) row.data_type = formData.dataType;
        if (formData.description) row.description = formData.description;
        if (aggs.length === 1) row.agg = aggs[0];
        else if (aggs.length > 1) row.aggs = aggs;
      } else if (formData.expression) {
        row.name = formData.name.trim();
        row.expr = formData.expression.trim();
        row.type = formData.type;
        if (formData.dataType) row.data_type = formData.dataType;
        if (formData.description) row.description = formData.description;
        if (aggs.length === 1) row.agg = aggs[0];
        else if (aggs.length > 1) row.aggs = aggs;
      } else if (
        !formData.dataType &&
        !formData.description &&
        formData.type === 'dim' &&
        aggs.length === 0
      ) {
        // Plain passthrough -- nothing else worth carrying.
        onAdd(formData.name.trim());
        resetForm();
        setErrors({});
        onConfirm(formData);
        return;
      } else {
        row.name = formData.name.trim();
        row.type = formData.type;
        if (formData.dataType) row.data_type = formData.dataType;
        if (formData.description) row.description = formData.description;
        if (aggs.length === 1) row.agg = aggs[0];
        else if (aggs.length > 1) row.aggs = aggs;
      }
      onAdd(row);
      resetForm();
      setErrors({});
      onConfirm(formData);
      return;
    }

    // Main-model mode: legacy path -- buildSelectColumn + updateSelectState.
    const columnData = buildSelectColumn({
      name: formData.name.trim(),
      type: formData.type,
      expr: formData.expression.trim() || '',
      ...(formData.model ? { model: formData.model } : {}),
      data_type: (formData.dataType as SchemaColumnDataType) || undefined,
      description: formData.description || undefined,
      ...(aggs.length === 1
        ? { agg: aggs[0] as SchemaColumnAgg }
        : aggs.length > 1
          ? { aggs: aggs as SchemaColumnAgg[] }
          : {}),
    });

    const updatedSelect = [...modelingState.select, columnData];
    updateSelectState(updatedSelect);

    resetForm();
    setErrors({});
    onConfirm(formData);
  }, [
    formData,
    isCteMode,
    onAdd,
    modelingState.select,
    updateSelectState,
    onConfirm,
  ]);

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
      <div className="bg-surface border border-neutral rounded-md p-4">
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

          {/* Interval picker -- SchemaModelSelectInterval. Surfaces only
              when the column is the magic `datetime` name and we're in CTE
              mode. Main-model authoring uses the column wizard for intervals. */}
          {supportsInterval && isDatetimeColumn && (
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                Interval
                <Tooltip
                  content="Granularity of the datetime column (day / hour / month / year)."
                  variant="outline"
                />
              </label>
              <SelectSingle
                options={intervalOptions ?? []}
                value={
                  formData.interval
                    ? {
                        value: formData.interval,
                        label: formData.interval,
                      }
                    : null
                }
                onChange={(option) =>
                  handleFieldChange('interval', option?.value || '')
                }
                onBlur={() => {}}
                placeholder="day"
              />
            </div>
          )}

          {/* Aggregations & Source Model Row - Only show for Metric type and if model supports aggregation */}
          {formData.type === 'fct' && supportsAggregation && (
            <div className="flex gap-4 w-full flex-wrap">
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

              {/* Source Model - Only show when aggregations are selected
                  and model supports it. In CTE mode we also require
                  multiple in-scope sources so the picker stays out of the
                  way for single-source CTEs (head only) where a column
                  reference is implicit. */}
              {supportsModelRef &&
                formData.aggregations.length > 0 &&
                availableModels.length > 0 &&
                (!isCteMode || hasMultipleSources) && (
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

              {/* Source CTE -- CTE-mode parallel to Source Model. Lets users
                  reference a sibling CTE's column for aggregation. Mutually
                  exclusive with `model` (the form state guarantees this in
                  handleFieldChange). Only renders when 2+ sources are in
                  scope -- otherwise the head is implicit. */}
              {isCteMode &&
                availableCtes &&
                availableCtes.length > 0 &&
                formData.aggregations.length > 0 &&
                hasMultipleSources && (
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                      Source CTE
                      <Tooltip
                        content="Reference a column from an earlier CTE instead of an upstream model."
                        variant="outline"
                      />
                    </label>
                    <SelectSingle
                      options={availableCtes}
                      value={
                        formData.cte
                          ? availableCtes.find(
                              (opt) => opt.value === formData.cte,
                            ) || null
                          : null
                      }
                      onChange={(option) =>
                        handleFieldChange('cte', option?.value || '')
                      }
                      onBlur={() => {}}
                      placeholder="Select source CTE (optional)"
                    />
                  </div>
                )}
            </div>
          )}

          {/* Source CTE for non-fact / non-aggregated rows. Surfaces in CTE
              mode when 2+ sources are in scope (head + at least one join /
              union branch); single-source CTEs (head only) hide the picker
              entirely since a bare passthrough is unambiguous. */}
          {isCteMode &&
            availableCtes &&
            availableCtes.length > 0 &&
            hasMultipleSources &&
            !(formData.type === 'fct' && supportsAggregation) && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                  Source CTE
                  <Tooltip
                    content="Reference a column from an earlier CTE. Leave empty for an inline / passthrough column."
                    variant="outline"
                  />
                </label>
                <SelectSingle
                  options={availableCtes}
                  value={
                    formData.cte
                      ? availableCtes.find(
                          (opt) => opt.value === formData.cte,
                        ) || null
                      : null
                  }
                  onChange={(option) =>
                    handleFieldChange('cte', option?.value || '')
                  }
                  onBlur={() => {}}
                  placeholder="Select source CTE (optional)"
                />
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
