import { PlayIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/solid';
import type {
  DbtRunConfig,
  DbtRunLineage,
  DbtRunScope,
  SelectedModel,
} from '@shared/dbt/types';
import { buildDbtRunCommand } from '@shared/dbt/utils';
import { EXTERNAL_LINKS } from '@shared/web/constants';
import { useApp } from '@web/context/useApp';
import { useEnvironment } from '@web/context/useEnvironment';
import { Button, Spinner, SwitchCard, Tooltip } from '@web/elements';
import { InputDate } from '@web/elements/InputDate';
import { InputText } from '@web/elements/InputText';
import { Message } from '@web/elements/Message';
import { useDebounce } from '@web/hooks/useDebounce';
import { useModelRunValidation } from '@web/hooks/useModelRunValidation';
import {
  DEFAULT_DEFER_STATE_PATH,
  TOOLTIPS,
} from '@web/utils/modelRunConstants';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CommandPreview } from './CommandPreview';
import { ScopeSelector } from './ScopeSelector';

interface ModelInfo {
  modelName: string | null;
  projectName: string;
  projectPath: string;
}

// Memoized SwitchCard to prevent unnecessary re-renders
const MemoizedSwitchCard = React.memo(SwitchCard) as typeof SwitchCard;

/**
 * Helper function to extract error message from various error formats
 */
const extractErrorMessage = (
  error: unknown,
  defaultMessage: string = 'An error occurred',
): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return defaultMessage;
};

export function ModelRun() {
  const { api } = useApp();
  const { vscode } = useEnvironment();

  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [generalError, setGeneralError] = useState<string>('');
  const [modifiedModels, setModifiedModels] = useState<string[]>([]);
  const [selectedModifiedModels, setSelectedModifiedModels] = useState<
    SelectedModel[]
  >([]);
  const [fetchingModifiedModels, setFetchingModifiedModels] = useState(false);
  const [hasFetchedModels, setHasFetchedModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Initialize theme based on document/OS settings
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    return currentTheme?.includes('dark') ? 'dark' : 'light';
  });

  const [config, setConfig] = useState<DbtRunConfig>({
    cleanAndDeps: false,
    seed: false,
    build: false,
    defer: false,
    fullRefresh: false,
    scope: 'single',
    lineage: 'model-only',
    selectedModels: [],
    startDate: '',
    endDate: '',
    statePath: '',
    projectName: undefined,
    projectPath: undefined,
    modelName: undefined,
  });

  // Refs for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);
  const themeObserverRef = useRef<MutationObserver | null>(null);

  const currentDate = useMemo(() => {
    // return date in YYYY-MM-DD format
    return new Date().toISOString().split('T')[0];
  }, []);

  // Use validation hook
  const { validationErrors, isFormValid } = useModelRunValidation({
    config,
    fetchingModifiedModels,
    modifiedModels,
    selectedModifiedModels,
    hasFetchedModels,
  });

  // Sync config with modelInfo when it changes
  useEffect(() => {
    if (!modelInfo) return;

    const hasActiveModel = modelInfo.modelName != null;

    setConfig((prev) => ({
      ...prev,
      projectName: modelInfo.projectName,
      projectPath: modelInfo.projectPath,
      modelName: modelInfo.modelName,
      // Set default state path on first load
      statePath:
        prev.statePath ||
        `${modelInfo.projectPath}/${DEFAULT_DEFER_STATE_PATH}`,
      // Switch to 'multi-model' scope when no active model
      scope:
        !hasActiveModel && prev.scope === 'single' ? 'multi-model' : prev.scope,
    }));
  }, [modelInfo]);

  // Auto-switch scope to 'modified' when defer is enabled
  useEffect(() => {
    setConfig((prev) => {
      if (prev.defer && prev.scope !== 'modified') {
        return { ...prev, scope: 'modified' };
      }
      return prev;
    });
  }, [config.defer]);

  // Fetch available models when project is set in config
  useEffect(() => {
    if (!config.projectName) return;

    const fetchAvailableModels = async () => {
      try {
        const response = await api.post({
          type: 'dbt-fetch-available-models',
          request: { projectName: config.projectName! },
        });
        setAvailableModels(response || []);
      } catch (error) {
        console.error('Failed to fetch available models:', error);
        setAvailableModels([]);
      }
    };

    void fetchAvailableModels();
  }, [config.projectName, api]);

  // Debounce the scope and defer changes to avoid rapid API calls
  const debouncedScope = useDebounce(config.scope, 300);
  const debouncedDefer = useDebounce(config.defer, 300);

  // Fetch modified models when defer is enabled OR scope is 'modified'
  // Uses state to track if we've already fetched to avoid redundant API calls
  useEffect(() => {
    const shouldFetchModifiedModels =
      (debouncedDefer || debouncedScope === 'modified') && config.projectName;

    const shouldClearModels = !debouncedDefer && debouncedScope !== 'modified';

    if (shouldClearModels) {
      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Reset modified models and fetch flag when neither defer nor modified scope is active
      setModifiedModels([]);
      setSelectedModifiedModels([]);
      setHasFetchedModels(false);
      setFetchingModifiedModels(false);
    } else if (shouldFetchModifiedModels && !hasFetchedModels) {
      // Only fetch if we haven't already fetched
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setFetchingModifiedModels(true);

      api
        .post({
          type: 'dbt-fetch-modified-models',
          request: { projectName: config.projectName! },
        })
        .then((models) => {
          if (!abortController.signal.aborted) {
            setModifiedModels(models);
            // Auto-select all modified models with downstream lineage (current default)
            setSelectedModifiedModels(
              models.map((modelName) => ({
                modelName,
                lineage: 'downstream',
              })),
            );
            setHasFetchedModels(true); // Mark as fetched only on success
          }
        })
        .catch((error) => {
          if (!abortController.signal.aborted) {
            console.error('Failed to fetch modified models:', error);
            setHasFetchedModels(false); // Reset on error so user can retry
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setFetchingModifiedModels(false);
          }
        });
    }

    // Cleanup on unmount or dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [
    debouncedDefer,
    debouncedScope,
    config.projectName,
    hasFetchedModels,
    api,
  ]);

  // Listen for theme changes in the document
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'data-theme') {
          const newTheme = document.documentElement.getAttribute('data-theme');
          setPreviewTheme(newTheme?.includes('dark') ? 'dark' : 'light');
        }
      });
    });

    themeObserverRef.current = observer;
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
        themeObserverRef.current = null;
      }
    };
  }, []);

  // Initialize: Fetch model info on mount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const maxRetries = 3;

    const initialize = async () => {
      try {
        const modelInfo = await api.post({
          type: 'dbt-get-model-info',
          request: null,
        });
        setModelInfo(modelInfo);
        setIsLoading(false);
        if (timeoutId) clearTimeout(timeoutId);
      } catch (error) {
        console.error('Failed to fetch model info:', error);

        // Retry with exponential backoff if it's a loading/initialization issue
        const errorMessage = extractErrorMessage(error);
        if (retryCount < maxRetries && errorMessage.includes('loading')) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
          console.log(
            `Retrying initialization in ${delay}ms (attempt ${retryCount}/${maxRetries})`,
          );
          timeoutId = setTimeout(() => void initialize(), delay);
          return;
        }

        // Handle specific error cases
        if (errorMessage.includes('not within a recognized dbt project')) {
          setGeneralError(
            'The active file is not within a recognized dbt project. Please check your dbt project configuration.',
          );
        } else if (errorMessage.includes('still loading')) {
          setGeneralError(
            'DBT extension is still initializing. Please wait a moment and try again.',
          );
        } else {
          // For other errors, just log them but don't show to user
          console.warn('Error during initialization:', errorMessage);
        }

        setIsLoading(false);
      }
    };

    // Add a small initial delay to allow extension to initialize
    timeoutId = setTimeout(() => void initialize(), 1000);

    // Cleanup function
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [api]);

  // Prepare config with models for execution
  const configWithModels = useMemo(
    () => ({
      ...config,
      modifiedModels: config.scope === 'modified' ? modifiedModels : undefined,
      selectedModifiedModels:
        config.scope === 'modified' ? selectedModifiedModels : undefined,
    }),
    [config, modifiedModels, selectedModifiedModels],
  );

  // Calculate command preview in real-time
  const commandPreview = useMemo(() => {
    return buildDbtRunCommand(configWithModels);
  }, [configWithModels]);

  /**
   * Determine if execute button should be disabled
   */
  const isExecuteDisabled = useMemo(() => {
    // Disable if form has validation errors
    if (!isFormValid) return true;

    // For single model scope, require model info
    if (config.scope === 'single' && !modelInfo) return true;

    // Disable for 'modified' scope if no models selected
    if (config.scope === 'modified' && selectedModifiedModels.length === 0) {
      return true;
    }

    // Disable for 'multi-model' scope if no models selected
    if (
      config.scope === 'multi-model' &&
      (!config.selectedModels || config.selectedModels.length === 0)
    ) {
      return true;
    }

    return false;
  }, [
    modelInfo,
    isFormValid,
    config.scope,
    config.selectedModels,
    selectedModifiedModels.length,
  ]);

  /**
   * Updates the config state
   */
  const handleConfigChange = useCallback(
    <K extends keyof DbtRunConfig>(key: K, value: DbtRunConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /**
   * Handle scope change
   */
  const handleScopeChange = useCallback((scope: DbtRunScope) => {
    setConfig((prev) => {
      const updates: Partial<DbtRunConfig> = { scope };

      // Reset lineage to default when changing scopes
      if (scope === 'single' && !prev.lineage) {
        updates.lineage = 'model-only';
      }

      // Clear selected models when leaving multi-model scope
      if (scope !== 'multi-model') {
        updates.selectedModels = [];
      }

      return { ...prev, ...updates };
    });
  }, []);

  /**
   * Handle lineage change for single model scope
   */
  const handleLineageChange = useCallback(
    (lineage: DbtRunLineage) => {
      handleConfigChange('lineage', lineage);
    },
    [handleConfigChange],
  );

  /**
   * Handle selected models change for multi-model scope
   */
  const handleSelectedModelsChange = useCallback(
    (models: SelectedModel[]) => {
      handleConfigChange('selectedModels', models);
    },
    [handleConfigChange],
  );

  /**
   * Handle selected modified models change for modified scope
   */
  const handleSelectedModifiedModelsChange = useCallback(
    (models: SelectedModel[]) => {
      setSelectedModifiedModels(models);
    },
    [],
  );

  /**
   * Handle boolean config changes (for SwitchCard compatibility)
   */
  const handleBooleanConfigChange = useCallback(
    (key: string, value: boolean) => {
      handleConfigChange(key as keyof DbtRunConfig, value);
    },
    [handleConfigChange],
  );

  const handleExecute = () => {
    if (!isFormValid) return;

    try {
      // Validate that we have a project name in config
      if (!configWithModels.projectName) {
        throw new Error('No DBT project selected');
      }

      void api.post({
        type: 'dbt-run-model',
        request: {
          config: configWithModels,
        },
      });

      // Show success message
      void api.post({
        type: 'framework-show-message',
        request: {
          message:
            'DBT run command started successfully. Check the terminal for progress.',
          type: 'info',
        },
      });

      closePanel();
    } catch (error) {
      console.error('Error executing run:', error);
      setGeneralError(extractErrorMessage(error, 'Failed to execute run'));
    }
  };

  const closePanel = useCallback(() => {
    try {
      vscode?.postMessage({
        type: 'close-panel',
        panelType: 'model-run',
      });
    } catch (err) {
      console.error('Failed to close panel:', err);
    }
  }, [vscode]);

  const onHelp = useCallback(async () => {
    try {
      await api.post({
        type: 'framework-open-external-url',
        request: { url: EXTERNAL_LINKS.documentation },
      } as any);
    } catch {
      // Fallback to opening in browser if API fails
      window.open(EXTERNAL_LINKS.documentation, '_blank');
    }
  }, [api]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      // Cancel any in-flight requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Disconnect theme observer
      if (themeObserverRef.current) {
        themeObserverRef.current.disconnect();
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size={48} label="Loading Model Run Form..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen text-surface-contrast">
      {/* Header */}
      <div className="flex justify-between p-4 border-b border-surface">
        <h1 className="text-2xl font-bold">DBT Run Model</h1>
        <Button
          label="Need Help?"
          variant="iconButton"
          type="button"
          icon={<QuestionMarkCircleIcon className="h-5 w-5" />}
          onClick={() => void onHelp()}
          className="ring-0 px-3 cursor-pointer py-0 text-primary"
        />
      </div>

      {/* Content */}
      <main className="p-4 grid grid-cols-1 gap-4 md:grid-cols-5 h-[calc(100vh-65px)] overflow-y-auto md:overflow-hidden">
        {/* Run Options */}
        <div className="p-4 bg-card rounded-lg flex flex-col gap-4 md:col-span-3 md:overflow-y-auto">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">Run Options</h2>
            <p className="text-sm">
              Configure how you want to run the selected dbt model
            </p>
          </div>

          {/* General Error */}
          {generalError && (
            <Message variant="error">
              <p className="text-sm">{generalError}</p>
            </Message>
          )}

          {/* Initial Commands */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Initial Commands</h2>
              <Tooltip content={TOOLTIPS.cleanAndDeps} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <MemoizedSwitchCard
                checked={config.cleanAndDeps}
                configKey="cleanAndDeps"
                label="Clean & Deps"
                tooltipText={TOOLTIPS.cleanAndDeps}
                onChange={handleBooleanConfigChange}
              />
              <MemoizedSwitchCard
                checked={config.seed}
                configKey="seed"
                label="Seed"
                tooltipText={TOOLTIPS.seed}
                onChange={handleBooleanConfigChange}
              />
            </div>
          </div>

          {/* Advanced Flags */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Advanced Flags</h2>
              <Tooltip content="Additional flags to customize the dbt run behavior" />
            </div>
            {/* Show error when defer is enabled but no modified models */}
            {validationErrors.defer && (
              <Message variant="error">
                <p className="text-sm">{validationErrors.defer}</p>
              </Message>
            )}
            <div className="grid grid-cols-2 gap-4">
              <MemoizedSwitchCard
                checked={config.build}
                configKey="build"
                label="Build"
                tooltipText={TOOLTIPS.build}
                onChange={handleBooleanConfigChange}
              />
              <MemoizedSwitchCard
                checked={config.defer}
                configKey="defer"
                label="Defer"
                tooltipText={TOOLTIPS.defer}
                onChange={handleBooleanConfigChange}
              />
              <MemoizedSwitchCard
                checked={config.fullRefresh}
                configKey="fullRefresh"
                label="Full Refresh"
                tooltipText={TOOLTIPS.fullRefresh}
                onChange={handleBooleanConfigChange}
              />
            </div>
            {/* State Path Input - Show when defer is enabled */}
            {config.defer && (
              <InputText
                id="statePath"
                name="statePath"
                label="State Path"
                value={config.statePath}
                onChange={(e) =>
                  handleConfigChange('statePath', e.target.value)
                }
                placeholder={`${modelInfo?.projectPath || '/path/to/project'}/${DEFAULT_DEFER_STATE_PATH}`}
                tooltipText={TOOLTIPS.statePath}
                error={validationErrors.statePath}
              />
            )}
          </div>

          {/* Run Scope */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Run Scope</h2>
              <Tooltip content={TOOLTIPS.scope} />
            </div>
            <ScopeSelector
              currentScope={config.scope}
              isDeferEnabled={config.defer}
              onScopeChange={handleScopeChange}
              activeModelName={modelInfo?.modelName}
              currentLineage={config.lineage}
              onLineageChange={handleLineageChange}
              selectedModels={config.selectedModels}
              availableModels={availableModels}
              onSelectedModelsChange={handleSelectedModelsChange}
              modifiedModels={modifiedModels}
              selectedModifiedModels={selectedModifiedModels}
              onSelectedModifiedModelsChange={
                handleSelectedModifiedModelsChange
              }
              fetchingModifiedModels={fetchingModifiedModels}
            />
          </div>

          {/* Dates */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Dates</h2>
              <Tooltip content={TOOLTIPS.dates} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <InputDate
                name="startDate"
                id="startDate"
                value={config.startDate}
                error={validationErrors.startDate}
                max={currentDate}
                onChange={(e) =>
                  handleConfigChange('startDate', e.target.value)
                }
              />
              <InputDate
                name="endDate"
                id="endDate"
                value={config.endDate}
                error={validationErrors.endDate}
                max={currentDate}
                onChange={(e) => handleConfigChange('endDate', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Run Details */}
        <div className="p-4 bg-card rounded-lg flex flex-col gap-4 md:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Run Details</h2>
            <Button
              onClick={() => void handleExecute()}
              disabled={isExecuteDisabled}
              label="Execute"
              icon={<PlayIcon className="h-5 w-5" />}
            />
          </div>

          {/* Model Info */}
          <div className="flex flex-col gap-2">
            {/* Show model name for single scope */}
            {config.scope === 'single' && (
              <p className="text-sm flex gap-2">
                <span className="font-semibold">Model:</span>
                <span className="break-all">
                  {modelInfo?.modelName || '<Model not found>'}
                </span>
              </p>
            )}

            {/* Show lineage for single scope */}
            {config.scope === 'single' && config.lineage && (
              <p className="text-sm flex gap-2">
                <span className="font-semibold">Lineage:</span>
                <span className="capitalize">
                  {config.lineage.replace('-', ' ')}
                </span>
              </p>
            )}

            {/* Show selected models for multi-model scope */}
            {config.scope === 'multi-model' && (
              <div className="flex flex-col gap-2 min-h-0">
                <p className="text-sm font-semibold">
                  Selected Models: {config.selectedModels?.length || 0}
                </p>
                {config.selectedModels && config.selectedModels.length > 0 ? (
                  <ul className="flex flex-col gap-1 max-h-[200px] overflow-y-auto overflow-x-hidden list-none pr-2">
                    {config.selectedModels.map((model) => (
                      <li
                        key={model.modelName}
                        className="break-words text-sm min-w-0"
                      >
                        <span className="font-medium">{model.modelName}</span>
                        <span className="text-xs ml-2 opacity-70 whitespace-nowrap">
                          ({model.lineage.replace('-', ' ')})
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm opacity-70">No models selected</p>
                )}
              </div>
            )}

            {/* Show modified models if modified scope */}
            {fetchingModifiedModels && config.scope === 'modified' && (
              <div className="bg-message-info border border-[var(--color-primary)] rounded-lg p-4 flex items-center gap-2">
                <Spinner />
                <p className="text-sm text-message-info-contrast">
                  Checking for modified models...
                </p>
              </div>
            )}

            {!fetchingModifiedModels &&
              config.scope === 'modified' &&
              hasFetchedModels && (
                <>
                  {modifiedModels.length > 0 ? (
                    <div className="flex flex-col gap-2 min-h-0">
                      <p className="text-sm font-semibold">
                        Modified Models: {selectedModifiedModels.length} of{' '}
                        {modifiedModels.length} selected
                      </p>
                      {selectedModifiedModels.length > 0 ? (
                        <ul className="flex flex-col gap-1 max-h-[200px] overflow-y-auto overflow-x-hidden list-none pr-2">
                          {selectedModifiedModels.map((model) => (
                            <li
                              key={model.modelName}
                              className="break-words text-sm min-w-0"
                            >
                              <span className="font-medium">
                                {model.modelName}
                              </span>
                              <span className="text-xs ml-2 opacity-70 whitespace-nowrap">
                                ({model.lineage.replace('-', ' ')})
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm opacity-70">No models selected</p>
                      )}
                    </div>
                  ) : (
                    <Message variant="error">
                      <p className="text-sm">
                        No modified models found. Please update your model
                        definitions and try again.
                      </p>
                    </Message>
                  )}
                </>
              )}

            {/* Show full project if full project scope */}
            {config.scope === 'full-project' && (
              <p className="text-sm flex items-center gap-2">
                <span className="font-semibold">Project:</span>
                <span>{modelInfo?.projectName || '<Project not found>'}</span>
              </p>
            )}
          </div>

          {/* Run Command Preview */}
          <CommandPreview
            commandPreview={commandPreview}
            isFormValid={isFormValid}
            previewTheme={previewTheme}
            vscode={vscode}
          />
        </div>
      </main>
    </div>
  );
}
