import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { makeClassName } from '@web';
import { useApp } from '@web/context';
import type { RadioOption } from '@web/elements';
import {
  Checkbox,
  CodeBlock,
  DiffView,
  DiffViewMode,
  RadioGroup,
  Spinner,
  Tooltip,
} from '@web/elements';
import { useDebounce } from '@web/hooks';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import { useEffect, useState } from 'react';

import { MetaInformationTable } from './MetaInformationTable';

enum PreviewType {
  SQL = 'sql',
  YAML = 'yaml',
  JSON = 'json',
  META = 'meta',
}

const PREVIEW_TYPES: RadioOption[] = [
  { value: PreviewType.SQL, label: 'SQL' },
  { value: PreviewType.YAML, label: 'YML' },
  { value: PreviewType.JSON, label: 'JSON' },
  { value: PreviewType.META, label: 'Meta Information' },
];

const DIFF_MODE_OPTIONS: RadioOption[] = [
  { value: DiffViewMode.SPLIT, label: 'Split' },
  { value: DiffViewMode.UNIFIED, label: 'Unified' },
];

export function FinalPreview() {
  const [selectedPreviewType, setSelectedPreviewType] = useState<PreviewType>(
    PreviewType.SQL,
  );

  // Initialize theme based on document/OS settings
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    return currentTheme?.includes('dark') ? 'dark' : 'light';
  });

  const [showDiff, setShowDiff] = useState(false);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(DiffViewMode.SPLIT);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOriginal, setIsLoadingOriginal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState({
    json: '',
    sql: '',
    yaml: '',
    columns: [] as Array<{
      name: string;
      description: string;
      type: 'dim' | 'fct';
      dataType: string;
    }>,
  });

  const { api } = useApp();
  const {
    basicFields,
    buildModelJson,
    mode,
    originalModelPath,
    originalFiles,
    setOriginalFiles,
  } = useModelStore();

  // Tutorial store integration
  const { isPlayTutorialActive, tutorialPreviewType } = useTutorialStore(
    (state) => ({
      isPlayTutorialActive: state.isPlayTutorialActive,
      tutorialPreviewType: state.tutorialPreviewType,
    }),
  );

  const projectName = basicFields.projectName;
  const isEditMode = mode === 'edit';

  // Build the model and stringify it
  const model = buildModelJson();
  const modelString = JSON.stringify(model);

  // Debounce model changes to avoid excessive API calls
  const debouncedModelString = useDebounce(modelString, 1000);

  const previewCode =
    selectedPreviewType === PreviewType.META
      ? ''
      : previewData[selectedPreviewType];
  const originalCode =
    selectedPreviewType === PreviewType.META || !originalFiles
      ? ''
      : originalFiles[selectedPreviewType] || '';

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

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // Fetch original files on mount when in edit mode
  useEffect(() => {
    const fetchOriginalFiles = async () => {
      if (!isEditMode || !originalModelPath || originalFiles) {
        return;
      }

      setIsLoadingOriginal(true);
      try {
        const response = await api.post({
          type: 'framework-get-original-model-files' as const,
          request: {
            originalModelPath,
          },
        } as const);

        setOriginalFiles(response);
      } catch (err) {
        const error = (err || {}) as Error;
        console.error('Error fetching original files:', error);
        // Set empty original files on error so we don't keep retrying
        setOriginalFiles({
          json: '// Error loading original JSON',
          sql: '-- Error loading original SQL',
          yaml: '# Error loading original YAML',
        });
      } finally {
        setIsLoadingOriginal(false);
      }
    };

    void fetchOriginalFiles();
  }, [isEditMode, originalModelPath, originalFiles, api, setOriginalFiles]);

  // Fetch preview data
  useEffect(() => {
    const fetchPreview = async () => {
      // Parse the debounced model string back to object
      const currentModel = JSON.parse(debouncedModelString);

      // Don't fetch if required fields are missing
      if (!currentModel.name || !currentModel.type) {
        setPreviewData({
          json: '# Add model name and type to see JSON preview',
          sql: '-- Add model name and type to see SQL preview',
          yaml: '# Add model name and type to see YAML preview',
          columns: [],
        });
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await api.post({
          type: 'framework-model-preview' as const,
          request: {
            projectName,
            modelJson: currentModel,
          },
        } as const);

        setPreviewData({
          json: response.json,
          sql: response.sql,
          yaml: response.yaml,
          columns: response.columns,
        });
      } catch (err) {
        const error = (err || {}) as Error;
        console.error('Error fetching preview:', error);
        setError(error.message || 'Failed to generate preview');
        // Set fallback preview data
        setPreviewData({
          json: JSON.stringify(currentModel, null, '    '),
          sql: `-- Error generating SQL:\n-- ${error.message || 'Unknown error'}`,
          yaml: `# Error generating YAML:\n# ${error.message || 'Unknown error'}`,
          columns: [],
        });
      } finally {
        setIsLoading(false);
      }
    };

    void fetchPreview();
  }, [debouncedModelString, projectName, api]);

  // Tutorial: Listen for preview type changes and switch tabs
  useEffect(() => {
    if (isPlayTutorialActive && tutorialPreviewType) {
      switch (tutorialPreviewType) {
        case 'sql':
          setSelectedPreviewType(PreviewType.SQL);
          break;
        case 'yaml':
          setSelectedPreviewType(PreviewType.YAML);
          break;
        case 'json':
          setSelectedPreviewType(PreviewType.JSON);
          break;
        case 'meta':
          setSelectedPreviewType(PreviewType.META);
          break;
      }
    }
  }, [isPlayTutorialActive, tutorialPreviewType]);

  const showDiffView =
    isEditMode &&
    showDiff &&
    originalFiles &&
    selectedPreviewType !== PreviewType.META;

  const isLoadingAny = isLoading || isLoadingOriginal;

  return (
    <div
      className="flex flex-col gap-4 h-full max-h-full overflow-hidden"
      data-tutorial-id="final-preview"
    >
      <div className="flex justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold">Final Preview</h2>
            <Tooltip
              content="Review your complete model before creating it. View the generated SQL, YAML configuration, JSON structure, and meta information. In edit mode, you can also compare changes with the original model."
              variant="outline"
            />
          </div>
          {/* View Diff Checkbox - only in edit mode and not on Meta Information tab */}
          {isEditMode && selectedPreviewType !== PreviewType.META && (
            <Checkbox
              checked={showDiff}
              onChange={(checked) => {
                if (typeof checked === 'boolean') {
                  setShowDiff(checked);
                }
              }}
              label="View diff"
            />
          )}

          {/* Diff Mode Toggle - only when diff is enabled */}
          {showDiffView && (
            <RadioGroup
              value={diffMode}
              onChange={(value) => {
                setDiffMode(value as DiffViewMode);
              }}
              name="diff-mode"
              options={DIFF_MODE_OPTIONS}
              variant="button-group"
            />
          )}
        </div>
        {selectedPreviewType !== PreviewType.META && (
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={() => {
                setPreviewTheme((prev) =>
                  prev === 'light' ? 'dark' : 'light',
                );
              }}
              type="button"
              className="px-3 py-2 rounded-md bg-surface hover:bg-surface/80 transition-colors"
              title={`Switch to ${previewTheme === 'light' ? 'dark' : 'light'} theme`}
              data-tutorial-id="preview-theme-toggle"
            >
              {previewTheme === 'light' ? (
                <MoonIcon className="h-5 w-5" />
              ) : (
                <SunIcon className="h-5 w-5" />
              )}
            </button>
          </div>
        )}
      </div>
      {/* Preview Type Selector */}
      <div
        className="flex gap-2 bg-background rounded-md p-2"
        data-tutorial-id="preview-tabs"
      >
        <RadioGroup
          value={selectedPreviewType}
          onChange={(value) => {
            setSelectedPreviewType(value as PreviewType);
          }}
          name="preview-type"
          options={PREVIEW_TYPES}
          className="flex-1"
          variant="button-group"
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}

      <div className="final-preview relative rounded-md overflow-auto min-h-0">
        {isLoadingAny && (
          <div
            className={makeClassName(
              'absolute inset-0 flex items-center justify-center bg-opacity-85 z-10',
              previewTheme === 'dark'
                ? 'bg-gray-500 text-white'
                : 'bg-gray-100 text-black',
            )}
          >
            <Spinner
              size={32}
              label={
                isLoadingOriginal
                  ? 'Loading original files...'
                  : 'Generating preview...'
              }
            />
          </div>
        )}

        {showDiffView ? (
          <div data-tutorial-id="diff-view" className="h-full">
            <DiffView
              original={originalCode}
              modified={previewCode}
              language={selectedPreviewType}
              theme={previewTheme}
              viewMode={diffMode}
              className="h-full min-h-40"
            />
          </div>
        ) : selectedPreviewType === PreviewType.META ? (
          <div data-tutorial-id="sql-preview" className="h-full">
            <MetaInformationTable columns={previewData.columns} />
          </div>
        ) : (
          <div data-tutorial-id="sql-preview" className="h-full">
            <CodeBlock
              code={previewCode}
              language={selectedPreviewType}
              theme={previewTheme}
              className="h-full min-h-40"
            />
          </div>
        )}
      </div>
    </div>
  );
}
