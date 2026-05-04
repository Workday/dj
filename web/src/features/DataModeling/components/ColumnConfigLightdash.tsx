// import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import type {
  SchemaColumnLightdash,
  SchemaLightdashDimension,
  SchemaLightdashMetricMerge,
} from '@shared/schema/types/model.schema';
import { Button, Checkbox, Popover, SelectMulti, Tooltip } from '@web/elements';
import type { LightdashMetricWithId } from '@web/stores/useModelStore';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  DimensionField,
  MetricMergeField,
} from '../../../utils/lightdash';
import { dimensionFields, metricsMergeFields } from '../../../utils/lightdash';
import type { LightdashStandardMetricValue } from '../types';
import {
  LIGHTDASH_COL_CONFIGS as CONFIG,
  LIGHTDASH_STANDARD_METRICS,
} from '../types';
import { AddLightdashMetric } from './AddLightdashMetric';
import { LightdashFields } from './LightdashFields';

export type ConfigState = {
  [CONFIG.Dimension]: boolean;
  [CONFIG.Metric]: boolean;
  [CONFIG.MetricsMerge]: boolean;
};

export const ColumnConfigLightdash = () => {
  const { editingColumn, setEditingColumn } = useModelStore();

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

  // Get current column lightdash config from columnToEdit
  const columnLightdashConfig = useMemo<Partial<SchemaColumnLightdash>>(() => {
    if (columnToEdit && 'lightdash' in columnToEdit) {
      return (columnToEdit.lightdash as SchemaColumnLightdash) || {};
    }
    return {
      dimension: undefined,
      metrics: undefined,
      metrics_merge: undefined,
    };
  }, [columnToEdit]);

  const [configurations, setConfigurations] = useState<ConfigState>({
    [CONFIG.Dimension]: true,
    [CONFIG.Metric]: true,
    [CONFIG.MetricsMerge]: true,
  });

  // Modal state for custom metrics
  const [isMetricModalOpen, setIsMetricModalOpen] = useState<boolean>(false);
  const [editingMetric, setEditingMetric] =
    useState<LightdashMetricWithId | null>(null);

  // Dimension section state
  const [dimensionConfig, setDimensionConfig] = useState<
    Partial<SchemaLightdashDimension>
  >(
    columnLightdashConfig.dimension || {
      group_label: '',
      label: '',
    },
  );

  // Parse metrics from columnLightdashConfig (similar to dimensionConfig)
  const parsedMetrics = useMemo(() => {
    const metrics = columnLightdashConfig.metrics;
    const standard: LightdashStandardMetricValue[] = [];
    const custom: LightdashMetricWithId[] = [];

    if (Array.isArray(metrics)) {
      metrics.forEach((metric, index) => {
        if (typeof metric === 'string') {
          // Standard metric (string value like 'avg', 'count')
          standard.push(metric as LightdashStandardMetricValue);
        } else if (typeof metric === 'object' && metric !== null) {
          // Custom metric (object with properties)
          custom.push({
            ...metric,
            id: `metric-${Date.now()}-${index}`, // Add unique ID
          } as LightdashMetricWithId);
        }
      });
    }

    return { standard, custom };
  }, [columnLightdashConfig.metrics]);

  // Metrics section state
  const [standardMetrics, setStandardMetrics] = useState<
    LightdashStandardMetricValue[]
  >(parsedMetrics.standard);
  const [customMetrics, setCustomMetrics] = useState<LightdashMetricWithId[]>(
    parsedMetrics.custom,
  );

  // Update metrics state when parsedMetrics changes (when editingColumn changes)
  useEffect(() => {
    setStandardMetrics(parsedMetrics.standard);
    setCustomMetrics(parsedMetrics.custom);
  }, [parsedMetrics]);

  // Metrics Merge section state
  const [metricsMergeConfig, setMetricsMergeConfig] = useState<
    Partial<SchemaLightdashMetricMerge>
  >(
    columnLightdashConfig.metrics_merge || {
      compact: undefined,
      format: undefined,
      round: undefined,
    },
  );

  // Visible properties state - initialize with default visibility OR if values exist
  const [visibleDimensionProps, setVisibleDimensionProps] = useState<
    Record<string, boolean>
  >(() =>
    dimensionFields.reduce(
      (acc: Record<string, boolean>, field: DimensionField) => {
        // Show field if it has a default visibility OR if it has a value in the config
        const hasValue =
          columnLightdashConfig.dimension &&
          columnLightdashConfig.dimension[field.key] !== undefined &&
          columnLightdashConfig.dimension[field.key] !== null &&
          columnLightdashConfig.dimension[field.key] !== '';
        acc[field.key] = !!(field.defaultVisible || hasValue);
        return acc;
      },
      {} as Record<string, boolean>,
    ),
  );

  const [visibleMetricsMergeProps, setVisibleMetricsMergeProps] = useState<
    Record<string, boolean>
  >(() =>
    metricsMergeFields.reduce(
      (acc: Record<string, boolean>, field: MetricMergeField) => {
        // Show field if it has a default visibility OR if it has a value in the config
        const hasValue =
          columnLightdashConfig.metrics_merge &&
          columnLightdashConfig.metrics_merge[field.key] !== undefined &&
          columnLightdashConfig.metrics_merge[field.key] !== null &&
          columnLightdashConfig.metrics_merge[field.key] !== '';
        acc[field.key] = !!(field.defaultVisible || hasValue);
        return acc;
      },
      {} as Record<string, boolean>,
    ),
  );

  const toggle = (key: CONFIG) => {
    setConfigurations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Helper to update editingColumn's lightdash property
  const updateEditingColumnLightdash = useCallback(
    (updates: Partial<SchemaColumnLightdash>) => {
      if (editingColumn) {
        const currentLightdash =
          ('lightdash' in editingColumn ? editingColumn.lightdash : {}) || {};
        setEditingColumn({
          ...editingColumn,
          lightdash: {
            ...currentLightdash,
            ...updates,
          } as SchemaColumnLightdash,
        });
      }
    },
    [editingColumn, setEditingColumn],
  );

  // Dimension handlers
  const handleDimensionPropertyChange = useCallback(
    (property: keyof SchemaLightdashDimension, value: unknown) => {
      // Process ai_hint: ensure comma-separated strings become arrays
      let processedValue = value;
      if (
        property === 'ai_hint' &&
        typeof value === 'string' &&
        value.includes(',')
      ) {
        processedValue = value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v);
      }

      setDimensionConfig((prev) => ({
        ...prev,
        [property]: processedValue,
      }));

      // Update editingColumn
      updateEditingColumnLightdash({
        dimension: {
          ...dimensionConfig,
          [property]: processedValue,
        } as SchemaLightdashDimension,
      });
    },
    [dimensionConfig, updateEditingColumnLightdash],
  );

  const handleDimensionPropertyVisibilityChange = useCallback(
    (property: string, visible: boolean) => {
      setVisibleDimensionProps((prev) => ({
        ...prev,
        [property]: visible,
      }));
    },
    [],
  );

  // Standard Metrics handlers
  const handleStandardMetricsChange = useCallback(
    (selectedValues: string[]) => {
      const newStandardMetrics =
        selectedValues as LightdashStandardMetricValue[];
      setStandardMetrics(newStandardMetrics);

      // Update editingColumn with combined metrics
      const combinedMetrics = [
        ...newStandardMetrics,

        ...customMetrics.map(({ id: _id, ...rest }) => rest), // Remove id from custom metrics
      ];

      if (combinedMetrics.length > 0) {
        updateEditingColumnLightdash({
          metrics: combinedMetrics as SchemaColumnLightdash['metrics'],
        });
      }
    },
    [customMetrics, updateEditingColumnLightdash],
  );

  const handleClearStandardMetrics = useCallback(() => {
    setStandardMetrics([]);

    // Update editingColumn - only custom metrics remain

    const combinedMetrics = customMetrics.map(({ id: _id, ...rest }) => rest);

    if (combinedMetrics.length > 0) {
      updateEditingColumnLightdash({
        metrics: combinedMetrics as SchemaColumnLightdash['metrics'],
      });
    } else {
      // Remove metrics if none left
      updateEditingColumnLightdash({
        metrics: undefined,
      });
    }
  }, [customMetrics, updateEditingColumnLightdash]);

  // Custom Metrics handlers
  const handleAddCustomMetric = useCallback(() => {
    setEditingMetric(null);
    setIsMetricModalOpen(true);
  }, []);

  const handleEditCustomMetric = useCallback(
    (metric: LightdashMetricWithId) => {
      setEditingMetric(metric);
      setIsMetricModalOpen(true);
    },
    [],
  );

  const handleDeleteCustomMetric = useCallback(
    (metricId: string) => {
      const updatedCustomMetrics = customMetrics.filter(
        (m) => m.id !== metricId,
      );
      setCustomMetrics(updatedCustomMetrics);

      // Update editingColumn with combined metrics
      const combinedMetrics = [
        ...standardMetrics,

        ...updatedCustomMetrics.map(({ id: _id, ...rest }) => rest),
      ];

      if (combinedMetrics.length > 0) {
        updateEditingColumnLightdash({
          metrics: combinedMetrics as SchemaColumnLightdash['metrics'],
        });
      } else {
        updateEditingColumnLightdash({
          metrics: undefined,
        });
      }
    },
    [customMetrics, standardMetrics, updateEditingColumnLightdash],
  );

  const handleSaveCustomMetric = useCallback(
    (metric: LightdashMetricWithId) => {
      let updatedCustomMetrics: LightdashMetricWithId[];

      if (editingMetric) {
        // Update existing metric
        updatedCustomMetrics = customMetrics.map((m) =>
          m.id === editingMetric.id ? metric : m,
        );
      } else {
        // Add new metric
        updatedCustomMetrics = [...customMetrics, metric];
      }

      setCustomMetrics(updatedCustomMetrics);

      // Update editingColumn with combined metrics
      const combinedMetrics = [
        ...standardMetrics,

        ...updatedCustomMetrics.map(({ id: _id, ...rest }) => rest),
      ];

      updateEditingColumnLightdash({
        metrics: combinedMetrics as SchemaColumnLightdash['metrics'],
      });

      setIsMetricModalOpen(false);
      setEditingMetric(null);
    },
    [
      editingMetric,
      customMetrics,
      standardMetrics,
      updateEditingColumnLightdash,
    ],
  );

  const handleCloseMetricModal = useCallback(() => {
    setIsMetricModalOpen(false);
    setEditingMetric(null);
  }, []);

  // Metrics Merge handlers
  const handleMetricsMergePropertyChange = useCallback(
    (property: keyof SchemaLightdashMetricMerge, value: unknown) => {
      const updatedConfig = {
        ...metricsMergeConfig,
        [property]: value,
      };
      setMetricsMergeConfig(updatedConfig);

      // Update editingColumn
      updateEditingColumnLightdash({
        metrics_merge: updatedConfig as SchemaLightdashMetricMerge,
      });
    },
    [metricsMergeConfig, updateEditingColumnLightdash],
  );

  const handleMetricsMergePropertyVisibilityChange = useCallback(
    (property: string, visible: boolean) => {
      setVisibleMetricsMergeProps((prev) => ({
        ...prev,
        [property]: visible,
      }));
    },
    [],
  );

  // Column-level case_sensitive override (lives on dimension per Lightdash docs)
  const handleCaseSensitiveChange = useCallback(
    (checked: boolean | React.ChangeEvent<HTMLInputElement>) => {
      const value =
        typeof checked === 'boolean' ? checked : checked.target.checked;
      updateEditingColumnLightdash({
        dimension: {
          ...dimensionConfig,
          case_sensitive: value,
        } as SchemaLightdashDimension,
      });
    },
    [dimensionConfig, updateEditingColumnLightdash],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Column-level case sensitivity override */}
      <div className="flex items-center gap-2">
        <Checkbox
          checked={columnLightdashConfig.dimension?.case_sensitive ?? false}
          onChange={handleCaseSensitiveChange}
          label="Case sensitive"
        />
        <Tooltip
          content="Override the model-level case sensitivity setting for this column"
          variant="outline"
        />
      </div>

      {/* Configuration Selection */}
      <div>
        <div className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          Select the configurations you wish to add
          <Tooltip
            content="Choose which Lightdash properties to configure for this column. Dimensions control how data is grouped, Metrics define calculations, and Metrics Merge controls metric aggregation."
            variant="outline"
          />
        </div>
        <div className="flex gap-6">
          {Object.keys(CONFIG).map((item) => {
            const key = item as keyof typeof CONFIG;
            return (
              <div key={key}>
                <Checkbox
                  label={CONFIG[key]}
                  checked={configurations[CONFIG[key]]}
                  onChange={() => toggle(CONFIG[key])}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Dimension Section */}
      {configurations[CONFIG.Dimension] && (
        <div
          className="border border-border rounded-lg p-4"
          data-tutorial-id="colconfig-lightdash-dimension"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h4 className="text-md font-semibold text-foreground">
                Dimensions
              </h4>
              <Tooltip
                content="Configure how this column appears in Lightdash as a dimension for filtering and grouping data"
                variant="outline"
              />
            </div>
            <Popover
              trigger={
                <span className="text-sm text-primary hover:text-primary/80 cursor-pointer">
                  + Choose properties
                </span>
              }
              showChevron
              panelClassName="w-72 p-4"
              placement="left"
            >
              <div className="text-sm font-medium text-foreground mb-3">
                Dimension Properties
              </div>
              <div className="space-y-3">
                {dimensionFields
                  .filter((field: DimensionField) => !field.defaultVisible)
                  .map((field: DimensionField) => (
                    <div
                      key={field.key}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        checked={visibleDimensionProps[field.key] || false}
                        onChange={(checked) => {
                          const isChecked =
                            typeof checked === 'boolean'
                              ? checked
                              : checked.target.checked;
                          handleDimensionPropertyVisibilityChange(
                            field.key,
                            isChecked,
                          );
                        }}
                        className="size-4"
                      />
                      <span className="text-sm text-foreground">
                        {field.label}
                      </span>
                    </div>
                  ))}
              </div>
            </Popover>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {dimensionFields
              .filter(
                (field: DimensionField) => visibleDimensionProps[field.key],
              )
              .map((field: DimensionField) => (
                <div key={field.key} className="flex flex-col">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {field.label}
                  </label>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <LightdashFields<SchemaLightdashDimension>
                        field={field}
                        value={dimensionConfig[field.key]}
                        onChange={handleDimensionPropertyChange}
                      />
                      <span className="text-sm text-foreground">
                        {field.label}
                      </span>
                    </div>
                  ) : (
                    <LightdashFields<SchemaLightdashDimension>
                      field={field}
                      value={dimensionConfig[field.key]}
                      onChange={handleDimensionPropertyChange}
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Metrics Section */}
      {configurations[CONFIG.Metric] && (
        <div
          className="border border-border rounded-lg p-4"
          data-tutorial-id="colconfig-lightdash-metrics"
        >
          <div className="flex items-center gap-2 mb-4">
            <h4 className="text-md font-semibold text-foreground">Metrics</h4>
            <Tooltip
              content="Define how this column can be measured and aggregated in Lightdash. Use standard metrics for common calculations or create custom metrics for specific needs."
              variant="outline"
            />
          </div>

          {/* Standard metrics */}
          <div
            className="mb-4"
            data-tutorial-id="colconfig-lightdash-standard-metrics"
          >
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              Standard metrics
              <Tooltip
                content="Pre-built aggregations like sum, average, count, min, and max"
                variant="outline"
              />
            </label>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <SelectMulti
                  options={
                    LIGHTDASH_STANDARD_METRICS as unknown as {
                      label: string;
                      value: string;
                    }[]
                  }
                  className="react-flow__node-scrollable"
                  value={standardMetrics}
                  onChange={handleStandardMetricsChange}
                  placeholder="Select metrics"
                />
              </div>
              <Button
                label="Clear"
                variant="link"
                onClick={handleClearStandardMetrics}
                className="px-4 py-2 border border-primary text-primary rounded-md hover:bg-primary/5"
              />
            </div>
          </div>

          {/* Custom metrics */}
          <div data-tutorial-id="colconfig-lightdash-custom-metrics">
            <label className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              Custom metrics
              <Tooltip
                content="Create custom calculations with specific SQL expressions, filters, and formatting"
                variant="outline"
              />
            </label>

            {customMetrics.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4 mb-2">
                No custom metrics added yet
              </div>
            ) : (
              <div className="space-y-2 mb-3">
                {customMetrics.map((metric) => (
                  <div
                    key={metric.id}
                    className="flex items-center justify-between p-3 border border-border rounded-md bg-muted/20"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">
                        {metric.name}
                        <span className="ml-2 text-xs px-2 py-1 bg-primary/10 text-primary rounded">
                          {metric.type}
                        </span>
                      </div>
                      {metric.description && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Description: {metric.description}
                        </div>
                      )}
                      {metric.label && (
                        <div className="text-xs text-muted-foreground">
                          Label: {metric.label}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditCustomMetric(metric);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-muted rounded transition-colors"
                        title="Edit metric"
                        variant="iconButton"
                        label=""
                        icon={
                          <PencilIcon className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        }
                      />
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustomMetric(metric.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 hover:bg-muted rounded transition-colors"
                        title="Delete metric"
                        icon={
                          <TrashIcon className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                        }
                        variant="iconButton"
                        label=""
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Button
              className="w-full py-2 px-4 border border-primary font-medium text-primary text-sm rounded-md bg-transparent hover:bg-primary/5 transition-colors"
              onClick={handleAddCustomMetric}
              variant="link"
              label="+ Add metric"
            />
          </div>
        </div>
      )}

      {/* Metrics Merge Section */}
      {configurations[CONFIG.MetricsMerge] && (
        <div className="border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h4 className="text-md font-semibold text-foreground">
                Metrics Merge
              </h4>
              <Tooltip
                content="Control how multiple metrics from this column are combined and displayed in Lightdash"
                variant="outline"
              />
            </div>
            <Popover
              trigger={
                <span className="text-sm text-primary hover:text-primary/80 cursor-pointer">
                  + Choose properties
                </span>
              }
              showChevron
              panelClassName="w-72 p-4"
              placement="left"
            >
              <div className="text-sm font-medium text-foreground mb-3">
                Metrics Merge Properties
              </div>
              <div className="space-y-3">
                {metricsMergeFields
                  .filter((field: MetricMergeField) => !field.defaultVisible)
                  .map((field: MetricMergeField) => (
                    <div
                      key={field.key}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        checked={visibleMetricsMergeProps[field.key] || false}
                        onChange={(checked) => {
                          const isChecked =
                            typeof checked === 'boolean'
                              ? checked
                              : checked.target.checked;
                          handleMetricsMergePropertyVisibilityChange(
                            field.key,
                            isChecked,
                          );
                        }}
                        className="size-4"
                      />
                      <span className="text-sm text-foreground">
                        {field.label}
                      </span>
                    </div>
                  ))}
              </div>
            </Popover>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {metricsMergeFields
              .filter(
                (field: MetricMergeField) =>
                  visibleMetricsMergeProps[field.key],
              )
              .map((field: MetricMergeField) => (
                <div key={field.key} className="flex flex-col">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    {field.label}
                  </label>
                  {field.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <LightdashFields<SchemaLightdashMetricMerge>
                        field={field}
                        value={metricsMergeConfig[field.key]}
                        onChange={handleMetricsMergePropertyChange}
                      />
                      <span className="text-sm text-foreground">
                        {field.label}
                      </span>
                    </div>
                  ) : (
                    <LightdashFields<SchemaLightdashMetricMerge>
                      field={field}
                      value={metricsMergeConfig[field.key]}
                      onChange={handleMetricsMergePropertyChange}
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Custom Metric Modal */}
      <AddLightdashMetric
        isOpen={isMetricModalOpen}
        onClose={handleCloseMetricModal}
        onSave={handleSaveCustomMetric}
        editingMetric={editingMetric}
      />
    </div>
  );
};
