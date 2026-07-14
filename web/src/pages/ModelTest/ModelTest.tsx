import { ArrowPathIcon, PlayIcon } from '@heroicons/react/24/solid';
import { useApp } from '@web/context';
import { useEnvironment } from '@web/context/useEnvironment';
import { Button, Spinner } from '@web/elements';
import { useModelTestStore } from '@web/stores/useModelTestStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConsoleOutput } from './ConsoleOutput';
import { ModelSelector } from './ModelSelector';
import { TestStatus } from './TestStatus';
import type { RunAnalytics } from './types';
import { DEFAULT_MODEL_CONFIG } from './types';

export function ModelTest() {
  const { api } = useApp();
  const { vscode } = useEnvironment();

  const {
    activeChanges,
    isTesting,
    isLoading,
    testQueue,
    setIsLoading,
    setIsTesting,
    setTestQueue,
    updateTestStatusByName,
    addLog,
    clearLogs,
    setActiveChanges,
    setAvailableModels,
    setRunAnalytics,
    setProjectName,
  } = useModelTestStore();

  // Count checked models
  const checkedCount = useMemo(
    () => activeChanges.filter((m) => m.checked).length,
    [activeChanges],
  );

  // Track when the page was hidden (for visibility change refresh)
  // Only auto-refresh if hidden for more than 30 seconds
  const hiddenAtRef = useRef<number | null>(null);
  const AUTO_REFRESH_THRESHOLD_MS = 60 * 1000; // 30 seconds

  // Manual refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Reusable fetch models function
  const fetchModels = useCallback(async () => {
    try {
      setIsLoading(true);

      // First get model info to get project name
      const modelInfo = await api.post({
        type: 'dbt-get-model-info',
        request: null,
      });

      if (!modelInfo?.projectName) {
        console.error('No project found');
        setIsLoading(false);
        return;
      }

      // Store project name for use by child components
      setProjectName(modelInfo.projectName);

      // Fetch models with test counts
      const result = await api.post({
        type: 'dbt-fetch-models-with-tests',
        request: { projectName: modelInfo.projectName },
      });

      // Set active changes from modified models
      setActiveChanges(
        result.modifiedModels.map(
          (m: {
            name: string;
            testCount: number;
            testDetails: {
              name: string;
              testType: string;
              columnName?: string;
            }[];
            hasJoins: boolean;
            hasAggregates: boolean;
            hasPortalPartitionDaily: boolean;
            modelType: string | null;
            existingDataTests: Array<{ type: string; [key: string]: any }>;
            fromModel: string | null;
            firstJoinType: string | null;
          }) => ({
            name: m.name,
            testCount: m.testCount,
            testDetails: m.testDetails || [],
            hasJoins: m.hasJoins ?? false,
            hasAggregates: m.hasAggregates ?? false,
            hasPortalPartitionDaily: m.hasPortalPartitionDaily ?? false,
            modelType: m.modelType ?? null,
            existingDataTests: m.existingDataTests || [],
            fromModel: m.fromModel ?? null,
            firstJoinType: m.firstJoinType ?? null,
            checked: true,
            tests: [] as string[],
            config: { ...DEFAULT_MODEL_CONFIG },
            isFromGitChanges: true,
          }),
        ),
      );

      // Set available models
      setAvailableModels(result.availableModels);

      setIsLoading(false);
    } catch (error) {
      console.error('Failed to fetch models:', error);
      setIsLoading(false);
    }
  }, [api, setIsLoading, setActiveChanges, setAvailableModels, setProjectName]);

  // Fetch models on mount
  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchModels();
    setIsRefreshing(false);
  }, [fetchModels]);

  // Refresh data when tab becomes visible after being hidden for a while
  // Only auto-refresh if hidden for more than 30 seconds to avoid excessive reloads
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Record when tab was hidden
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        // Check if we should auto-refresh
        if (hiddenAtRef.current !== null) {
          const hiddenDuration = Date.now() - hiddenAtRef.current;
          hiddenAtRef.current = null;

          // Only auto-refresh if hidden for more than threshold
          if (hiddenDuration > AUTO_REFRESH_THRESHOLD_MS) {
            void fetchModels();
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchModels, AUTO_REFRESH_THRESHOLD_MS]);

  // Compute analytics from test queue
  const computeAnalytics = useCallback((): RunAnalytics => {
    const total = testQueue.length;
    let success = 0;
    let error = 0;
    let warning = 0;

    testQueue.forEach((item) => {
      if (item.status === 'success') success++;
      else if (item.status === 'error') error++;
      else if (item.status === 'warning') warning++;
    });

    return {
      total,
      success,
      error,
      warning,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      failureRate: total > 0 ? Math.round((error / total) * 100) : 0,
    };
  }, [testQueue]);

  // Listen for streaming messages from extension
  useEffect(() => {
    if (!vscode) return;

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'test-log') {
        addLog(message.log.message);
      }

      if (message.type === 'test-status') {
        updateTestStatusByName(message.modelName, message.status);
      }

      if (message.type === 'test-complete') {
        setIsTesting(false);
        // Compute and set analytics after a short delay to ensure all statuses are updated
        setTimeout(() => {
          const analytics = computeAnalytics();
          setRunAnalytics(analytics);
        }, 100);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    vscode,
    addLog,
    updateTestStatusByName,
    setIsTesting,
    computeAnalytics,
    setRunAnalytics,
  ]);

  const handleRunTests = useCallback(async () => {
    const runningOn = activeChanges.filter((m) => m.checked);
    if (runningOn.length === 0) return;

    setIsTesting(true);
    clearLogs();

    // Initialize test queue
    const initialQueue = runningOn.map((item) => ({
      name: item.name,
      status: 'idle' as const,
    }));
    setTestQueue(initialQueue);

    try {
      // Get project info
      const modelInfo = await api.post({
        type: 'dbt-get-model-info',
        request: null,
      });

      if (!modelInfo?.projectName) {
        addLog('> Error: No project found');
        setIsTesting(false);
        return;
      }

      // Call dbt-run-test API - streaming will happen via postMessage
      await api.post({
        type: 'dbt-run-test',
        request: {
          projectName: modelInfo.projectName,
          models: runningOn.map((m) => ({
            name: m.name,
            config: m.config,
          })),
        },
      });
    } catch (error) {
      console.error('Failed to run tests:', error);
      addLog(`> Error: ${error}`);
      setIsTesting(false);
    }
  }, [activeChanges, setIsTesting, clearLogs, setTestQueue, api, addLog]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen w-full bg-background text-surface-contrast items-center justify-center">
        <Spinner size={32} />
        <p className="mt-4 text-surface-contrast/60">Loading models...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background text-surface-contrast overflow-hidden">
      {/* Global Header */}
      <header className="px-6 py-5 border-b border-surface flex items-center justify-between shrink-0 bg-card z-50">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-surface-contrast leading-none">
            DBT Test Model
            <sup className="text-xs bg-blue-200 font-normal text-blue-800 px-3 py-1 ml-2 rounded-full">
              alpha
            </sup>
          </h1>
          <p className="text-[14px] text-surface-contrast/60 font-medium mt-1.5">
            Ensure your models are production-ready.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing || isTesting}
            title="Refresh git status"
            className={`p-2.5 rounded-xl border transition-all ${
              isRefreshing || isTesting
                ? 'opacity-50 cursor-not-allowed border-surface bg-surface/30'
                : 'border-surface hover:border-primary/50 hover:bg-primary/10'
            }`}
          >
            <ArrowPathIcon
              className={`w-5 h-5 ${
                isRefreshing
                  ? 'animate-spin text-primary'
                  : 'text-surface-contrast/60'
              }`}
            />
          </button>

          {/* Run Tests Button */}
          <Button
            onClick={() => void handleRunTests()}
            disabled={isTesting || checkedCount === 0}
            label={isTesting ? 'TESTING...' : `RUN ${checkedCount} SELECTED`}
            icon={
              isTesting ? (
                <Spinner size={16} inline={true} />
              ) : (
                <PlayIcon className="w-4 h-4 fill-current" />
              )
            }
          />
        </div>
      </header>

      {/* Three Column Layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Column 1: Model Selector (Sidebar) - fixed width */}
        <aside className="w-[420px] min-w-[420px] max-w-[420px] border-r border-surface flex flex-col bg-card z-20 shadow-sm shrink-0 overflow-hidden">
          <ModelSelector />
        </aside>

        {/* Column 2: Test Status - fixed width */}
        <div className="w-[320px] min-w-[320px] max-w-[320px] border-r border-surface flex flex-col bg-card shrink-0 overflow-hidden">
          <TestStatus />
        </div>

        {/* Column 3: Console Output - takes remaining space but doesn't expand beyond available */}
        <main className="flex-1 min-w-0 flex flex-col bg-card overflow-hidden">
          <ConsoleOutput />
        </main>
      </div>
    </div>
  );
}
