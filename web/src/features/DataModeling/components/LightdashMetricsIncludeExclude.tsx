import { XMarkIcon } from '@heroicons/react/24/outline';
import type { SchemaModelLightdash } from '@shared/schema/types/model.schema';
import { Button, DialogBox, InputText, Tooltip } from '@web/elements';
import React, { useCallback, useState } from 'react';

interface LightdashMetricsIncludeExcludeProps {
  type: 'include' | 'exclude';
  lightdashConfig: SchemaModelLightdash;
  updateLightdashState: (state: SchemaModelLightdash) => void;
}

export const LightdashMetricsIncludeExclude: React.FC<
  LightdashMetricsIncludeExcludeProps
> = ({ type, lightdashConfig, updateLightdashState }) => {
  const [inputText, setInputText] = useState<string>('');

  // State for metric removal confirmation
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<boolean>(false);
  const [metricToRemove, setMetricToRemove] = useState<string | null>(null);

  const isIncludeType = type === 'include';
  const metricsList = isIncludeType
    ? lightdashConfig.metrics_include
    : lightdashConfig.metrics_exclude;

  // Add metric to list
  const handleAddMetric = useCallback(() => {
    if (inputText.trim() && !metricsList?.includes(inputText.trim())) {
      const updatedMetrics = [...(metricsList || []), inputText.trim()];
      setInputText('');

      updateLightdashState({
        ...lightdashConfig,
        [isIncludeType ? 'metrics_include' : 'metrics_exclude']: updatedMetrics,
      });
    }
  }, [
    inputText,
    metricsList,
    lightdashConfig,
    updateLightdashState,
    isIncludeType,
  ]);

  // Remove metric from list
  const handleRemoveMetric = useCallback(
    (metricToRemove: string) => {
      const updatedMetrics =
        metricsList?.filter((m) => m !== metricToRemove) || [];

      updateLightdashState({
        ...lightdashConfig,
        [isIncludeType ? 'metrics_include' : 'metrics_exclude']: updatedMetrics,
      });
    },
    [metricsList, lightdashConfig, updateLightdashState, isIncludeType],
  );

  // Confirmation handlers for metric removal
  const handleRequestMetricRemoval = useCallback((metric: string) => {
    setMetricToRemove(metric);
    setShowRemoveConfirm(true);
  }, []);

  const handleConfirmMetricRemoval = useCallback(() => {
    if (metricToRemove) {
      handleRemoveMetric(metricToRemove);
    }
    setShowRemoveConfirm(false);
    setMetricToRemove(null);
  }, [metricToRemove, handleRemoveMetric]);

  const handleCancelMetricRemoval = useCallback(() => {
    setShowRemoveConfirm(false);
    setMetricToRemove(null);
  }, []);

  return (
    <div className="mb-4">
      <div className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
        Metrics to {isIncludeType ? 'include' : 'exclude'}
        <Tooltip
          content={
            isIncludeType
              ? 'Specify which metrics should be explicitly included in Lightdash queries'
              : 'Specify which metrics should be excluded from Lightdash queries'
          }
          variant="outline"
        />
      </div>

      {(metricsList?.length || 0) === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-4 mb-2">
          No metrics selected
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2">
          {metricsList?.map((metric) => (
            <div
              key={metric}
              className="flex items-center gap-2 px-3 py-1 border border-border rounded-full bg-muted/20"
            >
              <span className="text-sm text-foreground">{metric}</span>
              <Button
                variant="iconButton"
                title="Remove metric"
                aria-label={`Remove ${metric}`}
                className="hover:bg-muted rounded-full p-0.5 transition-colors"
                icon={
                  <XMarkIcon className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                }
                onClick={(e) => {
                  e.stopPropagation();
                  handleRequestMetricRemoval(metric);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <InputText
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enter metric name"
          className="flex-1"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddMetric();
            }
          }}
        />
        <Button
          label="+ Add"
          className="px-4 py-1 border border-primary text-primary rounded-md min-w-[100px]"
          variant="link"
          onClick={(e) => {
            e.stopPropagation();
            handleAddMetric();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!inputText.trim()}
        />
      </div>

      {/* Confirmation Dialog for Metric Removal */}
      <DialogBox
        open={showRemoveConfirm}
        title="Remove Metric"
        caption={`Are you sure you want to remove "${metricToRemove}" from metrics to ${isIncludeType ? 'include' : 'exclude'}?`}
        confirmCTALabel="Remove"
        discardCTALabel="Cancel"
        onConfirm={handleConfirmMetricRemoval}
        onDiscard={handleCancelMetricRemoval}
      />
    </div>
  );
};
