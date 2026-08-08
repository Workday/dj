import type {
  DbtRunLineage,
  DbtRunScope,
  SelectedModel,
} from '@shared/dbt/types';
import { makeClassName } from '@web';
import { Spinner } from '@web/elements';
import { SCOPE_OPTIONS } from '@web/utils/modelRunConstants';
import React from 'react';

import { ModelSelector } from './ModelSelector';

interface ScopeSelectorProps {
  currentScope: DbtRunScope;
  onScopeChange: (scope: DbtRunScope) => void;
  // For single model scope - the model from active editor
  activeModelName?: string | null;
  currentLineage?: DbtRunLineage;
  onLineageChange?: (lineage: DbtRunLineage) => void;
  // For multi-model scope - user selected models
  selectedModels?: SelectedModel[];
  availableModels?: string[];
  onSelectedModelsChange?: (models: SelectedModel[]) => void;
  // For modified scope - selectable modified models
  modifiedModels?: string[];
  selectedModifiedModels?: SelectedModel[];
  onSelectedModifiedModelsChange?: (models: SelectedModel[]) => void;
  fetchingModifiedModels?: boolean;
}

/**
 * Memoized component for scope selection
 * Only re-renders when props change
 */
export const ScopeSelector = React.memo<ScopeSelectorProps>(
  ({
    currentScope,
    onScopeChange,
    activeModelName,
    currentLineage = 'model-only',
    onLineageChange,
    selectedModels = [],
    availableModels = [],
    onSelectedModelsChange,
    modifiedModels = [],
    selectedModifiedModels = [],
    onSelectedModifiedModelsChange,
    fetchingModifiedModels = false,
  }) => {
    const hasActiveModel = activeModelName != null;

    // Filter scope options based on whether there's an active model
    const availableScopeOptions = hasActiveModel
      ? SCOPE_OPTIONS
      : SCOPE_OPTIONS.filter((option) => option.value !== 'single');

    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          {availableScopeOptions.map((option) => {
            return (
              <button
                key={option.value}
                onClick={() => onScopeChange(option.value)}
                className={makeClassName(
                  'relative p-4 rounded-lg border-2 text-left transition-all',
                  currentScope === option.value
                    ? 'border-blue-500 bg-message-info'
                    : 'border-neutral bg-background',
                  'hover:border-blue-300 cursor-pointer',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={makeClassName(
                      'font-medium',
                      currentScope === option.value
                        ? 'text-message-info-contrast'
                        : 'text-surface-contrast',
                    )}
                  >
                    {option.label}
                  </span>
                </div>
                <p className="text-sm text-surface-contrast">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Model selector - show when single or multi-model scope is selected */}
        {((currentScope === 'single' && onLineageChange) ||
          (currentScope === 'multi-model' &&
            onSelectedModelsChange &&
            availableModels)) && (
          <ModelSelector
            mode={currentScope}
            // Single model props
            currentLineage={currentLineage}
            onLineageChange={onLineageChange}
            activeModelName={activeModelName}
            // Multi-model props
            selectedModels={selectedModels}
            availableModels={availableModels}
            onModelsChange={onSelectedModelsChange}
          />
        )}

        {/* Modified models selector - show when modified scope is selected */}
        {currentScope === 'modified' && (
          <>
            {fetchingModifiedModels ? (
              <div className="bg-message-info border border-[var(--color-primary)] rounded-lg p-4 flex items-center gap-2">
                <Spinner />
                <p className="text-sm text-message-info-contrast">
                  Checking for modified models...
                </p>
              </div>
            ) : (
              modifiedModels.length > 0 &&
              onSelectedModifiedModelsChange && (
                <ModelSelector
                  mode="multi-model"
                  title="Modified Models Selection"
                  selectedModels={selectedModifiedModels}
                  availableModels={modifiedModels}
                  onModelsChange={onSelectedModifiedModelsChange}
                />
              )
            )}
          </>
        )}
      </div>
    );
  },
);

ScopeSelector.displayName = 'ScopeSelector';
