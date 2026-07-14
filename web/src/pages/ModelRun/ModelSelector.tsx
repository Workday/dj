import { XMarkIcon } from '@heroicons/react/24/solid';
import type { DbtRunLineage, SelectedModel } from '@shared/dbt/types';
import { Button, ButtonGroup, SelectMulti } from '@web/elements';
import { LINEAGE_OPTIONS } from '@web/utils/modelRunConstants';
import React, { useMemo } from 'react';

interface ModelSelectorProps {
  mode: 'single' | 'multi-model';
  title?: string;
  // Single model props - the model from active editor
  currentLineage?: DbtRunLineage;
  onLineageChange?: (lineage: DbtRunLineage) => void;
  activeModelName?: string | null;
  // Multi-model props - user selected models
  selectedModels?: SelectedModel[];
  availableModels?: string[];
  onModelsChange?: (models: SelectedModel[]) => void;
}

/**
 * Component for selecting models - supports both single model with lineage and multi-model selection
 */
export const ModelSelector = React.memo<ModelSelectorProps>(
  ({
    mode,
    title,
    currentLineage = 'model-only',
    onLineageChange,
    activeModelName,
    selectedModels = [],
    availableModels = [],
    onModelsChange,
  }) => {
    // Get selected model names for SelectMulti
    const selectedModelNames = useMemo(
      () => selectedModels.map((m) => m.modelName),
      [selectedModels],
    );

    // Create options for SelectMulti from available models
    const modelOptions = useMemo(
      () =>
        availableModels.map((model) => ({
          value: model,
          label: model,
        })),
      [availableModels],
    );

    const handleModelsSelectionChange = (selectedModelNames: string[]) => {
      if (onModelsChange) {
        // Create new SelectedModel objects for newly selected models
        // Preserve existing SelectedModel objects for models that remain selected
        const newSelectedModels: SelectedModel[] = selectedModelNames.map(
          (modelName) => {
            const existingModel = selectedModels.find(
              (m) => m.modelName === modelName,
            );
            if (existingModel) {
              // Keep existing model with its lineage setting
              return existingModel;
            } else {
              // Create new model with default lineage
              return {
                modelName,
                lineage: 'model-only',
              };
            }
          },
        );
        onModelsChange(newSelectedModels);
      }
    };

    const handleRemoveModel = (modelName: string) => {
      if (onModelsChange) {
        onModelsChange(selectedModels.filter((m) => m.modelName !== modelName));
      }
    };

    const handleLineageChange = (modelName: string, lineage: DbtRunLineage) => {
      if (onModelsChange) {
        onModelsChange(
          selectedModels.map((m) =>
            m.modelName === modelName ? { ...m, lineage } : m,
          ),
        );
      }
    };

    if (mode === 'single') {
      return (
        <div className="@container flex flex-col gap-4 p-4 border-2 border-neutral rounded-lg bg-background">
          <h3 className="text-lg font-semibold">Single Model Configuration</h3>
          {activeModelName ? (
            <div className="flex flex-col gap-2 @[720px]:flex-row @[720px]:items-center @[720px]:justify-between">
              <span
                className="font-medium truncate min-w-0"
                title={activeModelName}
              >
                {activeModelName}
              </span>
              <ButtonGroup
                options={LINEAGE_OPTIONS.map((option) => option.label)}
                initialValue={
                  LINEAGE_OPTIONS.find(
                    (option) => option.value === currentLineage,
                  )?.label || ''
                }
                onSelect={(selectedLabel: string) => {
                  const selectedOption = LINEAGE_OPTIONS.find(
                    (option) => option.label === selectedLabel,
                  );
                  if (selectedOption && onLineageChange) {
                    onLineageChange(selectedOption.value);
                  }
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-surface-contrast opacity-70 text-center py-4">
              Not available. Please open a model JSON file first and then click
              "Run Model" to continue.
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 p-4 border-2 border-neutral rounded-lg bg-background">
        <h3 className="text-lg font-semibold">
          {title ?? 'Multi-Model Selection'}
        </h3>

        {/* Model Selection */}
        <SelectMulti
          options={modelOptions}
          value={selectedModelNames}
          onChange={handleModelsSelectionChange}
          placeholder="Select models to run..."
          className="w-full"
          searchable={true}
          showSelectedTags={false}
        />

        {/* Selected Models List */}
        {selectedModels.length > 0 ? (
          <div className="@container flex flex-col gap-2 max-h-96 overflow-y-auto overflow-x-hidden">
            {/* Model Name and Remove Button */}
            {selectedModels.map((model) => (
              <div
                className="flex flex-col gap-2 p-3 border border-neutral rounded-md bg-card @[720px]:flex-row @[720px]:items-center @[720px]:justify-between @[720px]:gap-4"
                key={model.modelName}
              >
                <div className="font-medium flex items-center justify-between @[720px]:justify-start @[720px]:min-w-0 @[720px]:flex-1 gap-2">
                  <span className="truncate min-w-0" title={model.modelName}>
                    {model.modelName}
                  </span>
                  <Button
                    onClick={() => handleRemoveModel(model.modelName)}
                    title="Remove model"
                    label=""
                    variant="iconButton"
                    icon={<XMarkIcon className="h-5 w-5" />}
                    className="@[720px]:hidden flex-shrink-0"
                  />
                </div>
                <div className="flex flex-col gap-2 @[720px]:flex-row @[720px]:items-center @[720px]:flex-shrink-0 @[720px]:gap-2">
                  {/* Lineage Selector */}
                  <div className="min-w-0 @[720px]:flex-shrink-0">
                    <ButtonGroup
                      options={LINEAGE_OPTIONS.map((option) => option.label)}
                      initialValue={
                        LINEAGE_OPTIONS.find(
                          (option) => option.value === model.lineage,
                        )?.label || ''
                      }
                      onSelect={(selectedLabel: string) => {
                        const selectedOption = LINEAGE_OPTIONS.find(
                          (option) => option.label === selectedLabel,
                        );
                        if (selectedOption) {
                          handleLineageChange(
                            model.modelName,
                            selectedOption.value,
                          );
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={() => handleRemoveModel(model.modelName)}
                    title="Remove model"
                    label=""
                    variant="iconButton"
                    icon={<XMarkIcon className="h-5 w-5" />}
                    className="hidden @[720px]:block flex-shrink-0"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-contrast opacity-70 text-center py-4">
            No models selected. Search and select models above.
          </p>
        )}
      </div>
    );
  },
);

ModelSelector.displayName = 'ModelSelector';
