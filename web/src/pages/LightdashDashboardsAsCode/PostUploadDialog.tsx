import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import { Button, LogPanel } from '@web/elements';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useState } from 'react';

type Status = 'idle' | 'running' | 'success' | 'error';

/**
 * Post-upload action dialog.
 *
 * After a successful upload the user can either pull the canonical YAML back
 * down (Refresh) -- streaming the CLI output inline so the download is
 * visible -- or close and keep the local files as-is.
 */
export function PostUploadDialog() {
  const { api } = useApp();
  const {
    showPostUploadDialog,
    setShowPostUploadDialog,
    lastUpload,
    setLastUpload,
    currentPath,
    uploadOptions,
    setTree,
    clearUploadFiles,
    downloadLogs,
    addDownloadLog,
    clearDownloadLogs,
    setActiveLogChannel,
  } = useLightdashYamlStore();
  const [status, setStatus] = useState<Status>('idle');

  const running = status === 'running';
  // A selection-driven upload refreshes just those slugs; an entire-project
  // upload (empty slug arrays) refreshes everything.
  const chartSlugs = lastUpload?.chartSlugs ?? [];
  const dashboardSlugs = lastUpload?.dashboardSlugs ?? [];
  const hasSpecificSelection =
    chartSlugs.length > 0 || dashboardSlugs.length > 0;
  const uploadedCount = chartSlugs.length + dashboardSlugs.length;

  const close = () => {
    setShowPostUploadDialog(false);
    setLastUpload(null);
    setStatus('idle');
  };

  const onRefresh = async () => {
    setStatus('running');
    clearDownloadLogs();
    setActiveLogChannel('download');
    try {
      const resp = await api.post({
        type: 'lightdash-yaml-download',
        request: {
          path: currentPath.trim() || undefined,
          scope: hasSpecificSelection ? 'specific' : 'all',
          dashboardIds: dashboardSlugs.length ? dashboardSlugs : undefined,
          chartIds: chartSlugs.length ? chartSlugs : undefined,
          // Reuse the project the upload just succeeded with - a refresh only
          // ever pulls from the same project we just uploaded to.
          project: uploadOptions.project.trim(),
        },
      });
      if (resp.success) {
        if (resp.tree) {
          setTree(resp.tree);
        }
        clearUploadFiles();
        setStatus('success');
      } else {
        if (resp.error) {
          addDownloadLog({
            level: 'error',
            message: resp.error,
            timestamp: new Date().toISOString(),
          });
        }
        setStatus('error');
      }
    } catch (err) {
      addDownloadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      setStatus('error');
    } finally {
      setActiveLogChannel(null);
    }
  };

  const title =
    status === 'success'
      ? 'Refresh complete'
      : status === 'error'
        ? 'Refresh failed'
        : running
          ? 'Refreshing from Lightdash'
          : 'Upload complete';

  const titleIcon = running ? (
    <ArrowPathIcon className="w-5 h-5 text-neutral-400 animate-spin" />
  ) : status === 'error' ? (
    <XMarkIcon className="w-5 h-5 text-red-500" />
  ) : (
    <CheckCircleIcon className="w-5 h-5 text-green-500" />
  );

  return (
    <Dialog
      open={showPostUploadDialog}
      onClose={() => (running ? null : close())}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-background border border-surface rounded-lg max-w-md w-full p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-surface-contrast">
              {titleIcon}
              {title}
            </DialogTitle>
            <Button
              variant="iconButton"
              aria-label="Close"
              title="Close (keeps local files as-is)"
              icon={<XMarkIcon className="w-5 h-5" />}
              disabled={running}
              onClick={close}
              className="-mr-2 -mt-1 text-neutral-500"
            />
          </div>

          {status === 'idle' && (
            <p className="text-sm text-surface-contrast">
              {uploadedCount === 0
                ? 'Your changes are now live on Lightdash.'
                : `Uploaded ${uploadedCount} file${
                    uploadedCount === 1 ? '' : 's'
                  } to Lightdash.`}{' '}
              Pull the canonical YAML back down, or keep your local files as-is.
            </p>
          )}
          {status === 'success' && (
            <p className="text-sm text-surface-contrast">
              Pulled the latest YAML from Lightdash.
            </p>
          )}
          {status === 'error' && (
            <p className="text-sm text-surface-contrast">
              The download did not finish. Check the output below and try again.
            </p>
          )}

          {status !== 'idle' && (
            <LogPanel
              logs={downloadLogs}
              title="Download output"
              emptyMessage="Starting download"
              className="h-48 min-h-0"
            />
          )}

          <div className="flex flex-col gap-2">
            {status === 'idle' && (
              <>
                <Button
                  variant="primary"
                  label="Refresh from Lightdash"
                  icon={<ArrowDownTrayIcon className="w-4 h-4" />}
                  onClick={() => void onRefresh()}
                  fullWidth
                />
                <Button
                  variant="secondary"
                  label="Close"
                  onClick={close}
                  fullWidth
                />
              </>
            )}
            {running && (
              <Button
                variant="primary"
                label="Downloading"
                loading
                disabled
                fullWidth
              />
            )}
            {status === 'success' && (
              <Button
                variant="primary"
                label="Close"
                onClick={close}
                fullWidth
              />
            )}
            {status === 'error' && (
              <>
                <Button
                  variant="primary"
                  label="Try again"
                  icon={<ArrowDownTrayIcon className="w-4 h-4" />}
                  onClick={() => void onRefresh()}
                  fullWidth
                />
                <Button
                  variant="secondary"
                  label="Close"
                  onClick={close}
                  fullWidth
                />
              </>
            )}
          </div>

          {status === 'idle' && (
            <p className="text-xs text-neutral-500">
              <strong>Refresh</strong> re-runs <code>lightdash download</code>{' '}
              to replace your local files with the versions saved on Lightdash.
            </p>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
