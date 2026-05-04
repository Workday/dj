import type { IncrementalStrategy } from '@shared/schema/types/model.schema';
import { Checkbox, EditableList, TagInput, Tooltip } from '@web/elements';
import { FieldInputText, FieldSelectSingle } from '@web/forms';
import type { AdditionalFieldsSchema } from '@web/stores/useModelStore';
import { useModelStore } from '@web/stores/useModelStore';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect } from 'react';
import type { Control, FieldError, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';

import type { ModelWizardFormValues } from './types';

interface AdditionalFieldsProps {
  control: Control<ModelWizardFormValues>;
  errors: FieldErrors<ModelWizardFormValues>;

  watch: (name: any) => unknown;
  setValue: (
    name: keyof AdditionalFieldsSchema,
    value: AdditionalFieldsSchema[keyof AdditionalFieldsSchema] | undefined,
  ) => void;
  mode?: 'create' | 'edit';
}

// Developer feature toggle for advanced fields that are rarely used and potentially dangerous if misconfigured
// Set to true to show incremental strategy, exclude filters, etc. for development/testing purposes
const SHOW_ADVANCED_FIELDS = false;

// Move static options outside component to avoid recreation
const INCREMENTAL_STRATEGY_OPTIONS = [
  { label: 'Append', value: 'append' },
  { label: 'Delete + Insert', value: 'delete+insert' },
  { label: 'Merge', value: 'merge' },
  {
    label: 'Overwrite Existing Partitions',
    value: 'overwrite_existing_partitions',
  },
] as const;

export function AdditionalFields({
  control,
  errors,
  setValue,
  watch,
}: AdditionalFieldsProps) {
  const type = useModelStore((state) => state.basicFields.type);
  const materialized = useModelStore((state) => state.basicFields.materialized);
  const setAdditionalField = useModelStore((state) => state.setAdditionalField);
  const additionalFieldsSqlHooks = useModelStore(
    (state) => state.additionalFields.sql_hooks,
  );

  // Watch incremental_strategy to show/hide merge fields
  const incrementalStrategy = watch('incremental_strategy') as
    | ModelWizardFormValues['incremental_strategy']
    | undefined;

  // Sync store's sql_hooks to form state on mount
  // This handles cases where materialized was changed on BasicInformation step,
  // updating sql_hooks in the store, and user navigates to AdditionalFields step
  useEffect(() => {
    const formHooks = watch('sql_hooks');

    // Only update if store value differs from form value
    if (
      JSON.stringify(additionalFieldsSqlHooks) !== JSON.stringify(formHooks)
    ) {
      setValue('sql_hooks', additionalFieldsSqlHooks);
    }
  }, []); // Empty deps: only run on mount

  /**
   * Non-mart models support additional configuration options like
   * SQL Hooks and certain exclude filters
   */
  const isMartModelType = ['mart_select_model', 'mart_join_models'].includes(
    type,
  );

  const isIncrementalMaterialization = materialized === 'incremental';

  /**
   * Exclude daily filters are not available for stg_select_source, stg_union_sources and mart models
   */
  const isExcludeDailyFilterAvailable = !(
    ['stg_select_source', 'stg_union_sources'].includes(type) || isMartModelType
  );

  /**
   * Incremental Strategy is only available when materialized type is 'incremental' and non-mart model
   */
  const showIncrementalStrategy =
    !isMartModelType && isIncrementalMaterialization;

  const createCheckboxHandler = useCallback(
    (
      fieldName: keyof AdditionalFieldsSchema,
      fieldOnChange: (value: boolean) => void,
    ) =>
      (checked: boolean | ChangeEvent<HTMLInputElement>) => {
        const value =
          typeof checked === 'boolean' ? checked : checked.target.checked;
        fieldOnChange(value);
        setValue(fieldName, value);
        setAdditionalField(fieldName, value);
      },
    [setValue, setAdditionalField],
  );

  // Handler for SQL hooks (pre/post) with duplicate checking
  const createSqlHookHandler = useCallback(
    (
      hookType: 'pre' | 'post',
      currentSqlHooks: ModelWizardFormValues['sql_hooks'] | undefined,
      fieldOnChange: (value: ModelWizardFormValues['sql_hooks']) => void,
    ) =>
      (statements: string[]) => {
        // Remove duplicates while preserving order
        const uniqueStatements = statements.filter(
          (stmt, index, self) =>
            self.findIndex((s) => s.trim() === stmt.trim()) === index,
        );

        const hookValue: string | [string, ...string[]] | undefined =
          uniqueStatements.length === 0
            ? undefined
            : uniqueStatements.length === 1
              ? uniqueStatements[0]
              : (uniqueStatements as [string, ...string[]]);

        const newSqlHooks = {
          ...currentSqlHooks,
          [hookType]: hookValue,
        };

        fieldOnChange(newSqlHooks);
        setValue('sql_hooks', newSqlHooks);
        setAdditionalField('sql_hooks', newSqlHooks);
      },
    [setValue, setAdditionalField],
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-tutorial-id="additional-fields-section"
    >
      {/* 1. Description */}
      <Controller
        control={control}
        name="description"
        rules={{ required: false }}
        render={({ field }) => (
          <div data-tutorial-id="description-input">
            <FieldInputText
              {...field}
              // placeholder="Enter a description for the model"
              onChange={(e) => {
                field.onChange(e);
                setValue('description', e.target.value);
                setAdditionalField('description', e.target.value);
              }}
              error={errors.description}
              label="Description"
              tooltipText="Description for the model that will appear as a hover tooltip in Lightdash"
            />
          </div>
        )}
      />

      {/* 2. Tags */}
      <Controller
        control={control}
        name="tags"
        render={({ field }) => (
          <div data-tutorial-id="tags-input">
            <TagInput
              value={field.value || []}
              onChange={(value) => {
                field.onChange(value);
                setValue('tags', value);
                setAdditionalField('tags', value);
              }}
              onBlur={field.onBlur}
              label="Tags"
              predefinedTags={['lightdash', 'lightdash-explore']}
              tooltipText="Add tags for organization and filtering."
              placeholder="Type and press Enter to add tags"
            />
          </div>
        )}
      />

      {/* 3. Incremental Strategy (only shown for incremental materialization) */}
      {showIncrementalStrategy && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground border-b border-neutral py-2">
            Incremental Strategy
          </h3>

          {/* First Row: Type and Unique Key */}
          <div className="grid grid-cols-2 gap-4">
            {/* Type */}
            <Controller
              control={control}
              name="incremental_strategy.type"
              render={({ field }) => (
                <FieldSelectSingle
                  name={field.name}
                  onBlur={field.onBlur}
                  value={field.value || ''}
                  onChange={(value) => {
                    field.onChange(value);
                    const updateIncrementalStrategy = {
                      ...incrementalStrategy,
                      type: value as IncrementalStrategy['type'],
                    } as IncrementalStrategy;
                    setValue('incremental_strategy', updateIncrementalStrategy);
                    setAdditionalField(
                      'incremental_strategy',
                      updateIncrementalStrategy,
                    );
                  }}
                  label="Type"
                  options={[...INCREMENTAL_STRATEGY_OPTIONS]}
                  tooltipText={
                    'The strategy to use for incremental updates (dbt-trino).\n' +
                    '\u2022 append: inserts new rows without dedup (upstream must guarantee no duplicates).\n' +
                    '\u2022 delete+insert: partition-safe upsert; unique_key auto-derived from partitions.\n' +
                    '\u2022 merge: row-level upsert on unique_key (requires Iceberg format in dbt-trino).\n' +
                    '\u2022 overwrite_existing_partitions: drops & rewrites partitions in the new slice. Requires a custom dbt macro in your project \u2014 if unavailable, use delete+insert instead.\n' +
                    'The default can be configured via dj.materialization.defaultIncrementalStrategy.'
                  }
                />
              )}
            />

            {/* Unique Key - not applicable for 'append' */}
            {incrementalStrategy?.type !== 'append' && (
              <Controller
                control={control}
                name="incremental_strategy.unique_key"
                rules={{
                  validate: (value, formValues) => {
                    // Get the current type value from formValues
                    const strategyType = formValues.incremental_strategy?.type;

                    // If type is merge, unique_key must be provided
                    if (strategyType === 'merge') {
                      if (
                        !value ||
                        (typeof value === 'string' && value.trim() === '') ||
                        (Array.isArray(value) && value.length === 0)
                      ) {
                        return 'At least one unique key is required for merge strategy';
                      }
                    }
                    return true;
                  },
                }}
                render={({ field }) => {
                  // Convert unique_key to array format for TagInput
                  const uniqueKeyArray = Array.isArray(field.value)
                    ? field.value
                    : field.value
                      ? [field.value]
                      : [];

                  return (
                    <TagInput
                      value={uniqueKeyArray}
                      onChange={(value) => {
                        // Convert to proper format: string or tuple [string, ...string[]]
                        const uniqueKeyValue:
                          | string
                          | [string, ...string[]]
                          | undefined =
                          value.length === 0
                            ? undefined
                            : value.length === 1
                              ? value[0]
                              : (value as [string, ...string[]]);

                        field.onChange(uniqueKeyValue);
                        const newStrategy = {
                          ...incrementalStrategy,
                          unique_key: uniqueKeyValue || '',
                        };
                        setValue(
                          'incremental_strategy',
                          newStrategy as ModelWizardFormValues['incremental_strategy'],
                        );
                        setAdditionalField(
                          'incremental_strategy',
                          newStrategy as IncrementalStrategy,
                        );
                      }}
                      onBlur={field.onBlur}
                      label="Unique Key(s)"
                      placeholder="Type and press Enter to add unique keys"
                      tooltipText={
                        incrementalStrategy?.type === 'merge'
                          ? 'Required for merge. The unique key(s) to upsert on.'
                          : incrementalStrategy?.type === 'delete+insert' ||
                              incrementalStrategy?.type ===
                                'overwrite_existing_partitions'
                            ? 'Optional override. Defaults to the model\u2019s partition column when omitted.'
                            : 'The unique key(s) to use for incremental updates'
                      }
                      error={(() => {
                        // `incremental_strategy` is a discriminated union, so
                        // `unique_key` is not present on the `append` variant.
                        // Access via index so react-hook-form errors resolve
                        // correctly regardless of the active variant.
                        const uniqueKeyError = (
                          errors.incremental_strategy as
                            | Record<string, FieldError | undefined>
                            | undefined
                        )?.['unique_key'];
                        return uniqueKeyError?.message;
                      })()}
                    />
                  );
                }}
              />
            )}
          </div>

          {/* Second Row: Merge strategy-specific fields (only shown when type is 'merge') */}
          {incrementalStrategy?.type === 'merge' && (
            <div className="grid grid-cols-2 gap-4">
              {/* Merge Update Columns */}
              <Controller
                control={control}
                name="incremental_strategy.merge_update_columns"
                render={({ field }) => {
                  const mergeUpdateColumns = Array.isArray(field.value)
                    ? field.value
                    : [];

                  return (
                    <TagInput
                      value={mergeUpdateColumns}
                      onChange={(value) => {
                        const updatedValue =
                          value.length > 0 ? value : undefined;
                        field.onChange(updatedValue);

                        const newStrategy = {
                          ...incrementalStrategy,
                          type: 'merge' as const,
                          unique_key: incrementalStrategy.unique_key || '',
                          merge_update_columns: updatedValue,
                        };
                        setValue('incremental_strategy', newStrategy);
                        setAdditionalField('incremental_strategy', newStrategy);
                      }}
                      onBlur={field.onBlur}
                      label="Merge Update Columns"
                      placeholder="Type and press Enter to add columns"
                      tooltipText="The columns to exclude when merging"
                    />
                  );
                }}
              />

              {/* Merge Exclude Columns */}
              <Controller
                control={control}
                name="incremental_strategy.merge_exclude_columns"
                render={({ field }) => {
                  const mergeExcludeColumns = Array.isArray(field.value)
                    ? field.value
                    : [];

                  return (
                    <TagInput
                      value={mergeExcludeColumns}
                      onChange={(value) => {
                        const updatedValue =
                          value.length > 0 ? value : undefined;
                        field.onChange(updatedValue);

                        const newStrategy = {
                          ...incrementalStrategy,
                          type: 'merge' as const,
                          unique_key: incrementalStrategy.unique_key || '',
                          merge_exclude_columns: updatedValue,
                        };
                        setValue('incremental_strategy', newStrategy);
                        setAdditionalField('incremental_strategy', newStrategy);
                      }}
                      onBlur={field.onBlur}
                      label="Merge Exclude Columns"
                      placeholder="Type and press Enter to add columns"
                      tooltipText="The columns to update when merging"
                    />
                  );
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* 4. SQL Hooks - NOT available for mart models */}
      {!isMartModelType && (
        <div className="flex flex-col gap-4" data-tutorial-id="sql-hooks">
          <h3 className="text-sm font-semibold text-foreground border-b border-neutral py-2">
            SQL Hooks
          </h3>

          <div className="grid grid-cols-2 gap-4">
            {/* Pre Hook */}
            <Controller
              control={control}
              name="sql_hooks"
              render={({ field }) => {
                const sqlHooks = watch('sql_hooks') as
                  | ModelWizardFormValues['sql_hooks']
                  | undefined;

                // Convert pre to array format
                const preValue = sqlHooks?.pre;
                const preStatements = Array.isArray(preValue)
                  ? preValue
                  : preValue
                    ? [preValue]
                    : [];

                return (
                  <div className="flex flex-col gap-3">
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      Pre Hook
                      <Tooltip content="SQL statement(s) to run before the model" />
                    </h4>

                    <EditableList
                      items={preStatements}
                      onChange={createSqlHookHandler(
                        'pre',
                        sqlHooks,
                        field.onChange,
                      )}
                      placeholder="Enter SQL statement"
                      emptyText="No pre hooks added"
                      addButtonLabel="Add"
                    />
                  </div>
                );
              }}
            />

            {/* Post Hook */}
            <Controller
              control={control}
              name="sql_hooks"
              render={({ field }) => {
                const sqlHooks = watch('sql_hooks') as
                  | ModelWizardFormValues['sql_hooks']
                  | undefined;

                // Convert post to array format
                const postValue = sqlHooks?.post;
                const postStatements = Array.isArray(postValue)
                  ? postValue
                  : postValue
                    ? [postValue]
                    : [];

                return (
                  <div className="flex flex-col gap-3">
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      Post Hook
                      <Tooltip content="SQL statement(s) to run after the model" />
                    </h4>

                    <EditableList
                      items={postStatements}
                      onChange={createSqlHookHandler(
                        'post',
                        sqlHooks,
                        field.onChange,
                      )}
                      placeholder="Enter SQL statement"
                      emptyText="No post hooks added"
                      addButtonLabel="Add"
                    />
                  </div>
                );
              }}
            />
          </div>
        </div>
      )}

      {/* 5. Column Excludes */}
      <div className="flex flex-col gap-4" data-tutorial-id="column-excludes">
        <div className="flex items-center gap-2 border-b border-neutral py-2">
          <h3 className="text-sm font-semibold text-foreground">
            Column Excludes
          </h3>
          <Tooltip
            content="Control which system-generated columns to exclude from your model, such as portal metadata columns, partition columns, and date filters."
            variant="outline"
          />
        </div>

        {/* Exclude Portal Source Count - available for all models */}
        <Controller
          control={control}
          name="exclude_portal_source_count"
          render={({ field }) => (
            <Checkbox
              checked={field.value || false}
              onChange={createCheckboxHandler(
                'exclude_portal_source_count',
                field.onChange,
              )}
              label="Exclude Portal Source Count"
            />
          )}
        />

        {/* Exclude Portal Partition Columns - available for all models */}
        {SHOW_ADVANCED_FIELDS && (
          <Controller
            control={control}
            name="exclude_portal_partition_columns"
            render={({ field }) => (
              <Checkbox
                checked={field.value || false}
                onChange={createCheckboxHandler(
                  'exclude_portal_partition_columns',
                  field.onChange,
                )}
                label="Exclude Portal Partition Columns"
              />
            )}
          />
        )}

        {/* Exclude Date Filter - NOT available for mart models */}
        {SHOW_ADVANCED_FIELDS && !isMartModelType && (
          <Controller
            control={control}
            name="exclude_date_filter"
            render={({ field }) => (
              <Checkbox
                checked={field.value || false}
                onChange={createCheckboxHandler(
                  'exclude_date_filter',
                  field.onChange,
                )}
                label="Exclude Date Filter"
              />
            )}
          />
        )}

        {/* Exclude Daily Filter - NOT available for mart models and stg source models */}
        {SHOW_ADVANCED_FIELDS && isExcludeDailyFilterAvailable && (
          <Controller
            control={control}
            name="exclude_daily_filter"
            render={({ field }) => (
              <Checkbox
                checked={field.value || false}
                onChange={createCheckboxHandler(
                  'exclude_daily_filter',
                  field.onChange,
                )}
                label="Exclude Daily Filter"
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
