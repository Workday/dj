import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { SchemaColumnDataTests } from '@shared/schema/types/model.schema';
import {
  Button,
  InputText,
  SelectSingle,
  Switch,
  Tooltip,
} from '@web/elements';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import type { ModelType } from '@web/utils/columnConfig';
import { isFieldSupported } from '@web/utils/columnConfig';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DATA_TEST_TYPES, INTERVAL_OPTIONS } from '../types';

interface DataTest {
  id: string;
  type:
    | 'accepted_values'
    | 'equal_or_lower_row_count'
    | 'equal_row_count'
    | 'no_null_aggregates'
    | 'not_null'
    | 'unique'
    | 'relationships';
  config?: {
    where?: string;
    quote?: boolean;
    values?: string[];
    field?: string;
    to?: string;
  };
}

interface ColumnOthersConfig {
  exclude_from_group_by?: boolean;
  interval?: 'day' | 'hour' | 'month' | 'year';
  override_prefix?: string;
  override_suffix_agg?: boolean;
  data_tests?: DataTest[];
}

export const ColumnConfigOthers = () => {
  const { editingColumn, setEditingColumn, basicFields } = useModelStore();

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

  // Calculate which fields are supported for this model type
  const columnFields = useMemo(
    () => ({
      exclude_from_group_by: isFieldSupported(
        'exclude_from_group_by',
        modelType,
      ),
      interval: isFieldSupported('interval', modelType),
      override_prefix: isFieldSupported('override_prefix', modelType),
      override_suffix_agg: isFieldSupported('override_suffix_agg', modelType),
      data_tests: isFieldSupported('data_tests', modelType),
    }),
    [modelType],
  );

  const [config, setConfig] = useState<ColumnOthersConfig>({
    exclude_from_group_by: false,
    interval: undefined,
    override_prefix: '',
    override_suffix_agg: false,
    data_tests: [],
  });

  // Helper to convert SchemaColumnDataTests to DataTest[] format
  const convertSchemaToDataTests = useCallback(
    (schemaTests: SchemaColumnDataTests): DataTest[] => {
      if (!schemaTests || !Array.isArray(schemaTests)) return [];

      return schemaTests.map((test, index) => {
        const id = `test-${Date.now()}-${index}`;

        // Handle string types
        if (typeof test === 'string') {
          return {
            id,
            type: test as 'not_null' | 'unique',
          };
        }

        // Handle object types
        if (typeof test === 'object' && test !== null) {
          if (
            'unique' in test &&
            typeof test.unique === 'object' &&
            test.unique !== null
          ) {
            return {
              id,
              type: 'unique' as const,
              config: {
                where: test.unique.config?.where,
              },
            };
          }
        }

        // Fallback
        return {
          id,
          type: 'not_null' as const,
        };
      });
    },
    [],
  );

  // Helper to convert DataTest[] to SchemaColumnDataTests format
  const convertDataTestsToSchema = useCallback((tests: DataTest[]) => {
    return tests.map((test) => {
      // Simple string types
      if (test.type === 'not_null' && !test.config) {
        return 'not_null';
      }
      if (test.type === 'unique' && !test.config?.where) {
        return 'unique';
      }

      // Complex object types
      if (test.type === 'unique' && test.config?.where) {
        return {
          unique: {
            config: {
              where: test.config.where,
            },
          },
        };
      }
      if (test.type === 'accepted_values' && test.config?.values) {
        return {
          accepted_values: {
            values: test.config.values,
            ...(test.config.quote !== undefined && {
              quote: test.config.quote,
            }),
          },
        };
      }
      if (
        test.type === 'relationships' &&
        test.config?.field &&
        test.config?.to
      ) {
        return {
          relationships: {
            field: test.config.field,
            to: test.config.to,
          },
        };
      }

      // Fallback to string
      return test.type;
    });
  }, []);

  // Load data from columnToEdit (either tutorial or editing column)
  useEffect(() => {
    if (columnToEdit) {
      const schemaDataTests =
        'data_tests' in columnToEdit
          ? (columnToEdit.data_tests as SchemaColumnDataTests)
          : undefined;

      setConfig({
        exclude_from_group_by:
          ('exclude_from_group_by' in columnToEdit
            ? columnToEdit.exclude_from_group_by
            : false) || false,
        interval:
          ('interval' in columnToEdit ? columnToEdit.interval : undefined) ||
          undefined,
        override_prefix:
          ('override_prefix' in columnToEdit
            ? columnToEdit.override_prefix
            : '') || '',
        override_suffix_agg:
          (('override_suffix_agg' in columnToEdit
            ? columnToEdit.override_suffix_agg
            : false) as boolean) || false,
        data_tests: schemaDataTests
          ? convertSchemaToDataTests(schemaDataTests)
          : [],
      });
    }
  }, [columnToEdit, convertSchemaToDataTests]);

  const handleFieldChange = useCallback(
    (field: keyof ColumnOthersConfig, value: string | boolean | undefined) => {
      setConfig((prev) => ({
        ...prev,
        [field]: value,
      }));

      // Update editingColumn
      if (editingColumn) {
        setEditingColumn({
          ...editingColumn,
          [field]: value,
        });
      }
    },
    [editingColumn, setEditingColumn],
  );

  // Data Tests Management
  const handleAddDataTest = useCallback(() => {
    const newTest: DataTest = {
      id: `test-${Date.now()}`,
      type: 'not_null',
    };
    const updatedTests = [...(config.data_tests || []), newTest];
    setConfig((prev) => ({
      ...prev,
      data_tests: updatedTests,
    }));

    // Update editingColumn
    if (editingColumn) {
      setEditingColumn({
        ...editingColumn,
        data_tests: convertDataTestsToSchema(
          updatedTests,
        ) as SchemaColumnDataTests,
      });
    }
  }, [
    config.data_tests,
    editingColumn,
    setEditingColumn,
    convertDataTestsToSchema,
  ]);

  const handleDataTestTypeChange = useCallback(
    (testId: string, type: DataTest['type']) => {
      const updatedTests =
        config.data_tests?.map((test) =>
          test.id === testId ? { ...test, type, config: undefined } : test,
        ) || [];

      setConfig((prev) => ({
        ...prev,
        data_tests: updatedTests,
      }));

      // Update editingColumn
      if (editingColumn) {
        setEditingColumn({
          ...editingColumn,
          data_tests: convertDataTestsToSchema(
            updatedTests,
          ) as SchemaColumnDataTests,
        });
      }
    },
    [
      config.data_tests,
      editingColumn,
      setEditingColumn,
      convertDataTestsToSchema,
    ],
  );

  const handleDataTestConfigChange = useCallback(
    (testId: string, configKey: string, value: string | boolean | string[]) => {
      const updatedTests =
        config.data_tests?.map((test) =>
          test.id === testId
            ? {
                ...test,
                config: {
                  ...test.config,
                  [configKey]: value,
                },
              }
            : test,
        ) || [];

      setConfig((prev) => ({
        ...prev,
        data_tests: updatedTests,
      }));

      // Update editingColumn
      if (editingColumn) {
        setEditingColumn({
          ...editingColumn,
          data_tests: convertDataTestsToSchema(
            updatedTests,
          ) as SchemaColumnDataTests,
        });
      }
    },
    [
      config.data_tests,
      editingColumn,
      setEditingColumn,
      convertDataTestsToSchema,
    ],
  );

  const handleDeleteDataTest = useCallback(
    (testId: string) => {
      const updatedTests =
        config.data_tests?.filter((test) => test.id !== testId) || [];

      setConfig((prev) => ({
        ...prev,
        data_tests: updatedTests,
      }));

      // Update editingColumn
      if (editingColumn) {
        if (updatedTests.length > 0) {
          setEditingColumn({
            ...editingColumn,
            data_tests: convertDataTestsToSchema(
              updatedTests,
            ) as SchemaColumnDataTests,
          });
        } else {
          // Remove data_tests if empty

          const { data_tests: _removed, ...rest } = editingColumn as Record<
            string,
            unknown
          >;
          setEditingColumn(rest);
        }
      }
    },
    [
      config.data_tests,
      editingColumn,
      setEditingColumn,
      convertDataTestsToSchema,
    ],
  );

  const renderDataTestConfig = (test: DataTest) => {
    switch (test.type) {
      case 'unique':
        return (
          <div className="mt-2 pl-4 border-l-2 border-border">
            <label className="block text-xs text-muted-foreground mb-1">
              Where Condition (optional)
            </label>
            <InputText
              value={test.config?.where || ''}
              onChange={(e) =>
                handleDataTestConfigChange(test.id, 'where', e.target.value)
              }
              placeholder="Enter SQL where condition"
              className="w-full text-sm"
            />
          </div>
        );

      case 'accepted_values':
        return (
          <div className="mt-2 pl-4 border-l-2 border-border space-y-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Values (comma-separated)
              </label>
              <InputText
                value={
                  Array.isArray(test.config?.values)
                    ? test.config.values.join(', ')
                    : ''
                }
                onChange={(e) => {
                  const values = e.target.value
                    .split(',')
                    .map((v) => v.trim())
                    .filter((v) => v);
                  handleDataTestConfigChange(test.id, 'values', values);
                }}
                placeholder="value1, value2, value3"
                className="w-full text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={test.config?.quote || false}
                onChange={(checked) => {
                  const value =
                    typeof checked === 'boolean'
                      ? checked
                      : checked.target.checked;
                  handleDataTestConfigChange(test.id, 'quote', value);
                }}
                label="Quote values"
                position="right"
              />
            </div>
          </div>
        );

      case 'relationships':
        return (
          <div className="mt-2 pl-4 border-l-2 border-border space-y-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Field
              </label>
              <InputText
                value={test.config?.field || ''}
                onChange={(e) =>
                  handleDataTestConfigChange(test.id, 'field', e.target.value)
                }
                placeholder="Enter field name"
                className="w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                To (ref/model)
              </label>
              <InputText
                value={test.config?.to || ''}
                onChange={(e) =>
                  handleDataTestConfigChange(test.id, 'to', e.target.value)
                }
                placeholder="Enter reference model"
                className="w-full text-sm"
              />
            </div>
          </div>
        );

      case 'not_null':
      default:
        return null;
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Exclude from Group By */}
      {columnFields.exclude_from_group_by && (
        <div className="flex items-center justify-between p-4 border border-border rounded-lg">
          <div className="flex-1">
            <label className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              Exclude from Group By
              <Tooltip
                content="When enabled, this column won't be included in GROUP BY clauses during aggregation"
                variant="outline"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Exclude this column from group by when aggregating
            </p>
          </div>
          <Switch
            checked={config.exclude_from_group_by || false}
            onChange={(checked) => {
              const value =
                typeof checked === 'boolean' ? checked : checked.target.checked;
              handleFieldChange('exclude_from_group_by', value);
            }}
            position="right"
          />
        </div>
      )}

      {/* Interval */}
      {columnFields.interval && (
        <div className="p-4 border border-border rounded-lg">
          <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            Interval
            <Tooltip
              content="Set the time granularity for datetime columns to group data by day, hour, month, or year"
              variant="outline"
            />
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Time interval for datetime columns (day, hour, month, year)
          </p>
          <SelectSingle
            value={
              config.interval
                ? {
                    label:
                      INTERVAL_OPTIONS.find(
                        (opt) => opt.value === config.interval,
                      )?.label || '',
                    value: config.interval,
                  }
                : null
            }
            onChange={(option) => handleFieldChange('interval', option?.value)}
            onBlur={() => {}}
            options={
              INTERVAL_OPTIONS as unknown as { label: string; value: string }[]
            }
            placeholder="Select interval"
          />
        </div>
      )}

      {/* Override Prefix */}
      {columnFields.override_prefix && (
        <div className="p-4 border border-border rounded-lg">
          <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            Override Prefix
            <Tooltip
              content="Replace the default prefix added to this column's name in the output"
              variant="outline"
            />
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Override the default column name prefix
          </p>
          <InputText
            value={config.override_prefix || ''}
            onChange={(e) =>
              handleFieldChange('override_prefix', e.target.value)
            }
            placeholder="Enter override prefix"
            className="w-full"
          />
        </div>
      )}

      {/* Override Suffix Agg */}
      {columnFields.override_suffix_agg && (
        <div className="flex items-center justify-between p-4 border border-border rounded-lg">
          <div className="flex-1">
            <label className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
              Override Suffix Aggregation
              <Tooltip
                content="When enabled, prevents automatic suffix (e.g., _sum, _avg) from being added to aggregated column names"
                variant="outline"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Override automatic suffix for aggregation columns
            </p>
          </div>
          <Switch
            checked={config.override_suffix_agg || false}
            onChange={(checked) => {
              const value =
                typeof checked === 'boolean' ? checked : checked.target.checked;
              handleFieldChange('override_suffix_agg', value);
            }}
            position="right"
          />
        </div>
      )}

      {/* Data Tests */}
      {columnFields.data_tests && (
        <div
          className="p-4 border border-border rounded-lg"
          data-tutorial-id="colconfig-others-datatests"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1 flex items-center gap-2">
                Data Tests
                <Tooltip
                  content="Add dbt tests to validate data quality: not_null (no missing values), unique (no duplicates), accepted_values (allowed values only), relationships (foreign key integrity)"
                  variant="outline"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Add data quality tests for this column
              </p>
            </div>
            <Button
              onClick={handleAddDataTest}
              variant="link"
              label="Add Data Test"
              icon={<PlusIcon className="w-4 h-4" />}
              className="px-3 py-1 border border-primary text-primary rounded-md hover:bg-primary/5"
            />
          </div>

          {(config.data_tests?.length || 0) === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-4">
              No data tests added yet
            </div>
          ) : (
            <div className="space-y-3">
              {config.data_tests?.map((test) => (
                <div
                  key={test.id}
                  className="p-3 border border-border rounded-md bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <SelectSingle
                        value={
                          test.type
                            ? {
                                label:
                                  DATA_TEST_TYPES.find(
                                    (opt) => opt.value === test.type,
                                  )?.label || '',
                                value: test.type,
                              }
                            : null
                        }
                        onChange={(option) =>
                          handleDataTestTypeChange(
                            test.id,
                            option?.value as DataTest['type'],
                          )
                        }
                        onBlur={() => {}}
                        options={
                          DATA_TEST_TYPES as unknown as {
                            label: string;
                            value: string;
                          }[]
                        }
                        placeholder="Select test type"
                      />
                      {renderDataTestConfig(test)}
                    </div>
                    <Button
                      onClick={() => handleDeleteDataTest(test.id)}
                      variant="iconButton"
                      label=""
                      icon={
                        <TrashIcon className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                      }
                      className="p-1 hover:bg-muted rounded transition-colors"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
