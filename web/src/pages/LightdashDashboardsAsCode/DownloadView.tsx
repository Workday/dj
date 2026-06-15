import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  FolderIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import {
  Button,
  Checkbox,
  EditableList,
  InputText,
  LogPanel,
  Message,
  RadioGroup,
  Tooltip,
} from '@web/elements';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useMemo, useState } from 'react';

import { flattenFiles } from './utils';

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Entire Project' },
  { value: 'specific', label: 'Specific Assets' },
];

export function DownloadView() {
  const { api } = useApp();
  const {
    currentPath,
    defaultPath,
    setCurrentPath,
    setDefaultPath,
    downloadOptions,
    setDownloadOption,
    isDownloading,
    setIsDownloading,
    downloadLogs,
    clearDownloadLogs,
    addDownloadLog,
    setActiveLogChannel,
    setTree,
    setAbsolutePath,
    tree,
    clearUploadFiles,
    setSelectedFile,
    setSelectedFileContent,
  } = useLightdashYamlStore();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  // Inline validation state: errors are computed on submit and cleared
  // per-field as the user edits. The Run button stays enabled except
  // while a request is in flight; missing required input surfaces as
  // inline messages on the affected fields.
  const [errors, setErrors] = useState<{
    project?: string;
    scope?: string;
  }>({});

  const localFiles = useMemo(() => flattenFiles(tree), [tree]);
  const localFileCount = localFiles.length;

  const dashboards = downloadOptions.dashboards;
  const charts = downloadOptions.charts;
  const filledDashboards = useMemo(
    () => dashboards.map((s) => s.trim()).filter(Boolean),
    [dashboards],
  );
  const filledCharts = useMemo(
    () => charts.map((s) => s.trim()).filter(Boolean),
    [charts],
  );

  const isSpecific = downloadOptions.scope === 'specific';

  const onPathBlur = async () => {
    if (!downloadOptions.setAsDefault) {
      return;
    }
    const trimmed = currentPath.trim();
    if (!trimmed || trimmed === defaultPath) {
      return;
    }
    const resp = await api.post({
      type: 'lightdash-yaml-set-default-path',
      request: { path: trimmed },
    });
    if (resp.success && resp.absolutePath) {
      setDefaultPath(trimmed);
      setAbsolutePath(resp.absolutePath);
    }
  };

  const onDownload = async () => {
    const project = downloadOptions.project.trim();
    const nextErrors: typeof errors = {};
    if (!project) {
      nextErrors.project = 'Project UUID is required.';
    }
    if (
      isSpecific &&
      filledDashboards.length === 0 &&
      filledCharts.length === 0
    ) {
      nextErrors.scope =
        'Add at least one dashboard or chart, or switch to Entire Project.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsDownloading(true);
    clearDownloadLogs();
    setActiveLogChannel('download');
    try {
      // Optionally manage .gitignore BEFORE the CLI run so any
      // newly-downloaded files are immediately ignored. Failures here are
      // non-fatal - they're already streamed to the LogPanel and shouldn't
      // abort the download.
      if (downloadOptions.addToGitignore) {
        const gitignorePath = currentPath.trim() || defaultPath;
        await api.post({
          type: 'lightdash-yaml-ensure-gitignore',
          request: { path: gitignorePath },
        });
      }

      const resp = await api.post({
        type: 'lightdash-yaml-download',
        request: {
          path: currentPath.trim() || undefined,
          scope: downloadOptions.scope,
          dashboardIds:
            isSpecific && filledDashboards.length
              ? filledDashboards
              : undefined,
          chartIds:
            isSpecific && filledCharts.length ? filledCharts : undefined,
          project,
        },
      });
      if (resp.success) {
        if (resp.tree) {
          setTree(resp.tree);
        }
        if (resp.absolutePath) {
          setAbsolutePath(resp.absolutePath);
        }
      }
      // Failures are already streamed line-by-line into the LogPanel by the
      // CLI stderr handler in the extension; re-emitting resp.error here
      // would just duplicate the error block.
    } catch (err) {
      addDownloadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsDownloading(false);
      setActiveLogChannel(null);
    }
  };

  const onClearLocalFiles = async () => {
    if (localFileCount === 0) {
      return;
    }
    setIsClearing(true);
    try {
      const paths = localFiles.map((node) => node.path);
      const delResp = await api.post({
        type: 'lightdash-yaml-delete-files',
        request: { paths },
      });
      if (!delResp.success && delResp.error) {
        addDownloadLog({
          level: 'error',
          message: delResp.error,
          timestamp: new Date().toISOString(),
        });
      }
      const listResp = await api.post({
        type: 'lightdash-yaml-list-files',
        request: { path: currentPath },
      });
      if (listResp.success) {
        setTree(listResp.tree ?? []);
        if (listResp.absolutePath) {
          setAbsolutePath(listResp.absolutePath);
        }
      }
      clearUploadFiles();
      setSelectedFile(null);
      setSelectedFileContent('');
      addDownloadLog({
        level: 'success',
        message: `Cleared ${paths.length} local YAML file${paths.length === 1 ? '' : 's'}.`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      addDownloadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full min-h-0">
      <section className="lg:col-span-2 flex flex-col gap-4 h-full min-h-0">
        <header className="flex items-center justify-between gap-4 shrink-0 flex-col md:flex-row">
          <h2 className="text-surface-contrast">
            Provide Lightdash dashboard or chart SLUG, UUID, or the URL to the
            dashboard or chart to download local YAML files.
          </h2>
          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
            <Button
              variant="error"
              label="Clear local files"
              icon={<TrashIcon className="w-4 h-4" />}
              disabled={isDownloading || isClearing || localFileCount === 0}
              onClick={() => setShowClearConfirm(true)}
              className="whitespace-nowrap"
            />
            <Button
              variant="primary"
              label={isDownloading ? 'Downloading…' : 'Download'}
              icon={<ArrowDownTrayIcon className="w-4 h-4" />}
              loading={isDownloading}
              disabled={isDownloading}
              onClick={() => void onDownload()}
              className="whitespace-nowrap"
            />
          </div>
        </header>

        <Message variant="warning" className="shrink-0">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <strong>Warning:</strong> Downloading will overwrite existing
              local YAML files.
            </div>
          </div>
        </Message>

        <div className="flex-1 min-h-0 overflow-y-auto px-1 flex flex-col gap-4">
          {/* Project UUID is required so download/upload always targets
              an explicit project, never the Lightdash CLI's ambient
              active-project default. Production and preview UUIDs are
              both valid - copy from the project URL after `/projects/`
              or from the project's settings page. */}
          <InputText
            label="Project UUID (required)"
            tooltipText="Required. Lightdash project UUID — production or preview. Find it in the project URL after `/projects/`, or in the project's settings page."
            value={downloadOptions.project}
            onChange={(e) => {
              setDownloadOption('project', e.target.value);
              if (errors.project) {
                setErrors((prev) => ({ ...prev, project: undefined }));
              }
            }}
            placeholder="production or preview UUID"
            error={errors.project}
          />

          <div className="flex flex-col gap-2">
            <label className="text-sm/6 font-semibold text-background-contrast">
              Save to Path
            </label>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <FolderIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
                <input
                  type="text"
                  value={currentPath}
                  onChange={(e) => setCurrentPath(e.target.value)}
                  onBlur={() => void onPathBlur()}
                  placeholder={defaultPath}
                  className="block w-full bg-background ring-1 ring-[#D9D9D9] dark:ring-[#4A4A4A] rounded-lg pl-9 pr-3 h-10 text-sm text-background-contrast focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <Checkbox
                label="Set as Default"
                checked={downloadOptions.setAsDefault}
                onChange={(checked) =>
                  setDownloadOption('setAsDefault', Boolean(checked))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Checkbox
                label="Add path to .gitignore"
                checked={downloadOptions.addToGitignore}
                onChange={(checked) =>
                  setDownloadOption('addToGitignore', Boolean(checked))
                }
              />
              <p className="text-xs text-surface-contrast opacity-70">
                When enabled, appends{' '}
                <code className="font-mono">
                  {(currentPath.trim() || defaultPath).replace(/\/$/, '') + '/'}
                </code>{' '}
                to the workspace .gitignore (inside a managed marker block) so
                downloaded YAML files stay out of git. Idempotent.
              </p>
            </div>
          </div>

          <div>
            <label className="text-sm/6 font-semibold text-background-contrast">
              Target Type
            </label>
            <div className="mt-3">
              <RadioGroup
                name="dac-download-scope"
                options={SCOPE_OPTIONS}
                value={downloadOptions.scope}
                onChange={(v) => {
                  setDownloadOption('scope', v as typeof downloadOptions.scope);
                  if (errors.scope) {
                    setErrors((prev) => ({ ...prev, scope: undefined }));
                  }
                }}
                variant="button-group"
              />
            </div>
          </div>

          {isSpecific && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  Dashboards
                  <Tooltip content="Add one entry per dashboard. Each entry accepts the dashboard's SLUG, UUID, or full URL." />
                </h4>
                <EditableList
                  items={dashboards}
                  onChange={(next) => {
                    setDownloadOption('dashboards', next);
                    if (errors.scope) {
                      setErrors((prev) => ({ ...prev, scope: undefined }));
                    }
                  }}
                  placeholder="executive-overview / UUID / URL"
                  emptyText="No dashboards added"
                  addButtonLabel="Add"
                />
              </div>
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  Charts
                  <Tooltip content="Add one entry per saved chart. Each entry accepts the chart's SLUG, UUID, or full URL." />
                </h4>
                <EditableList
                  items={charts}
                  onChange={(next) => {
                    setDownloadOption('charts', next);
                    if (errors.scope) {
                      setErrors((prev) => ({ ...prev, scope: undefined }));
                    }
                  }}
                  placeholder="sales-by-region / UUID / URL"
                  emptyText="No charts added"
                  addButtonLabel="Add"
                />
              </div>
              {errors.scope && (
                <p className="text-error text-xs italic">{errors.scope}</p>
              )}
            </div>
          )}
        </div>
      </section>

      <LogPanel
        className="lg:col-span-1 h-full min-h-0"
        logs={downloadLogs}
        emptyMessage="Run a download to see CLI output here."
      />

      <Dialog
        open={showClearConfirm}
        onClose={() => (isClearing ? null : setShowClearConfirm(false))}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="bg-background border border-surface rounded-lg max-w-md w-full p-5 space-y-4">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-surface-contrast">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
              Clear local YAML files?
            </DialogTitle>
            <p className="text-sm text-surface-contrast">
              This will permanently delete{' '}
              <strong>
                {localFileCount} file{localFileCount === 1 ? '' : 's'}
              </strong>{' '}
              under <code>{currentPath || defaultPath}</code>. This action
              cannot be undone.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="error"
                label="Delete local files"
                icon={<TrashIcon className="w-4 h-4" />}
                loading={isClearing}
                disabled={isClearing}
                onClick={() => void onClearLocalFiles()}
                fullWidth
              />
              <Button
                variant="secondary"
                label="Cancel"
                disabled={isClearing}
                onClick={() => setShowClearConfirm(false)}
                fullWidth
              />
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
