import {
  ArrowUpTrayIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import { Button, Checkbox, FileTree, InputText, LogPanel } from '@web/elements';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useMemo, useState } from 'react';

import { flattenFiles, partitionLocalPaths } from './utils';

export function UploadView() {
  const { api } = useApp();
  const {
    tree,
    selectedUploadFiles,
    toggleUploadFile,
    setUploadFiles,
    clearUploadFiles,
    uploadOptions,
    setUploadOption,
    isUploading,
    setIsUploading,
    uploadLogs,
    clearUploadLogs,
    addUploadLog,
    setActiveLogChannel,
    currentPath,
    setShowPostUploadDialog,
    setLastUploadedFiles,
    uploadSearchTerm,
    setUploadSearchTerm,
  } = useLightdashYamlStore();

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);
  const allFilePaths = useMemo(
    () => allFiles.map((node) => node.path),
    [allFiles],
  );
  const totalFiles = allFilePaths.length;

  // Inline validation state: errors are computed on submit and cleared
  // per-field as the user edits. The Upload button stays enabled except
  // while a request is in flight; missing required input surfaces as
  // inline messages on the affected fields.
  const [errors, setErrors] = useState<{
    project?: string;
    files?: string;
  }>({});

  const onUpload = async () => {
    const project = uploadOptions.project.trim();
    const nextErrors: typeof errors = {};
    if (!project) {
      nextErrors.project = 'Project UUID is required.';
    }
    if (totalFiles === 0) {
      nextErrors.files = 'No local YAML files to upload. Run a download first.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsUploading(true);
    clearUploadLogs();
    setActiveLogChannel('upload');
    const selected = Array.from(selectedUploadFiles);
    // Empty selection or "all selected" → entire-project upload (no -c/-d).
    const allSelected = selected.length === 0 || selected.length >= totalFiles;
    const { chartSlugs, dashboardSlugs } = allSelected
      ? { chartSlugs: [], dashboardSlugs: [] }
      : partitionLocalPaths(selected);
    try {
      const resp = await api.post({
        type: 'lightdash-yaml-upload',
        request: {
          path: currentPath.trim() || undefined,
          chartSlugs: chartSlugs.length ? chartSlugs : undefined,
          dashboardSlugs: dashboardSlugs.length ? dashboardSlugs : undefined,
          force: uploadOptions.force,
          includeCharts: uploadOptions.includeCharts,
          project,
        },
      });
      if (resp.success) {
        setLastUploadedFiles(
          resp.uploadedFiles ?? (allSelected ? allFilePaths : selected),
        );
        setShowPostUploadDialog(true);
      }
      // Failures are already streamed line-by-line into the LogPanel by the
      // CLI stderr handler in the extension; re-emitting resp.error here
      // would just duplicate the error block.
    } catch (err) {
      addUploadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsUploading(false);
      setActiveLogChannel(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 h-full min-h-0">
      <section className="lg:col-span-4 flex flex-col gap-4 h-full min-h-0">
        <header className="flex items-center justify-between gap-4 shrink-0">
          <h2 className="text-surface-contrast">
            Upload changes you've made to your charts or dashboards as code.
          </h2>
          <Button
            variant="primary"
            label={isUploading ? 'Uploading…' : 'Upload'}
            icon={<ArrowUpTrayIcon className="w-4 h-4" />}
            loading={isUploading}
            disabled={isUploading}
            onClick={() => void onUpload()}
          />
        </header>

        {/* Project UUID is required so download/upload always targets an
            explicit project, never the Lightdash CLI's ambient
            active-project default. Production and preview UUIDs are
            both valid - copy from the project URL after `/projects/`
            or from the project's settings page. */}
        <div className="bg-card rounded-lg p-4 shrink-0">
          <InputText
            label="Project UUID (required)"
            tooltipText="Required. Lightdash project UUID — production or preview. Find it in the project URL after `/projects/`, or in the project's settings page."
            value={uploadOptions.project}
            onChange={(e) => {
              setUploadOption('project', e.target.value);
              if (errors.project) {
                setErrors((prev) => ({ ...prev, project: undefined }));
              }
            }}
            placeholder="production or preview UUID"
            error={errors.project}
          />
        </div>

        <div className="bg-card rounded-lg p-4 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-2 gap-3 shrink-0">
            <h2 className="text-sm font-semibold">Files to upload</h2>
            <div className="flex gap-2">
              <Button
                variant="link"
                label="Select all"
                onClick={() => setUploadFiles(allFilePaths)}
                className="px-2 py-1 text-xs"
              />
              <Button
                variant="link"
                label="Clear"
                onClick={() => clearUploadFiles()}
                className="px-2 py-1 text-xs"
              />
            </div>
          </div>
          <div className="relative mb-2 shrink-0">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
            <input
              type="text"
              value={uploadSearchTerm}
              onChange={(e) => setUploadSearchTerm(e.target.value)}
              placeholder="Filter files…"
              className="block w-full bg-background ring-1 ring-[#D9D9D9] dark:ring-[#4A4A4A] rounded-md pl-8 pr-3 h-8 text-xs text-background-contrast focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <FileTree
              nodes={tree}
              filter={uploadSearchTerm}
              renderFileExtra={(node) => (
                <Checkbox
                  checked={selectedUploadFiles.has(node.path)}
                  onChange={() => toggleUploadFile(node.path)}
                />
              )}
            />
            {tree.length === 0 && (
              <p className="text-xs italic text-neutral-500 mt-2">
                No local YAML files. Run a download first.
              </p>
            )}
            {errors.files && (
              <p className="text-error text-xs italic mt-2">{errors.files}</p>
            )}
          </div>
        </div>

        <div className="bg-card rounded-lg p-4 shrink-0 flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Options</h2>
          <Checkbox
            checked={uploadOptions.force}
            onChange={(v) => setUploadOption('force', Boolean(v))}
            label="--force"
            description="Use when uploading new content that doesn't yet exist on Lightdash."
            className="!items-start"
          />
          <Checkbox
            checked={uploadOptions.includeCharts}
            onChange={(v) => setUploadOption('includeCharts', Boolean(v))}
            label="--include-charts"
            description="Automatically uploads any charts referenced by selected dashboards."
            className="!items-start"
          />
        </div>
      </section>

      <LogPanel
        className="lg:col-span-2 h-full min-h-0"
        logs={uploadLogs}
        emptyMessage="Run an upload to see CLI output here."
      />
    </div>
  );
}
