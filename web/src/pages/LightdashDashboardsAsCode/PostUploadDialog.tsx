import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import { Button, RadioGroup } from '@web/elements';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useEffect, useState } from 'react';

import { partitionLocalPaths } from './utils';

type RefreshScope = 'just-uploaded' | 'all';

/**
 * Post-upload action dialog.
 *
 * After a successful upload the workflow has three sensible outcomes:
 *  1. Refresh from Lightdash — re-run an entire-project download to pull
 *     pristine canonical YAML.
 *  2. Clear local — delete the just-uploaded YAML files locally.
 *  3. Keep as-is — leave files on disk for further iteration.
 */
export function PostUploadDialog() {
  const { api } = useApp();
  const {
    showPostUploadDialog,
    setShowPostUploadDialog,
    lastUploadedFiles,
    setLastUploadedFiles,
    currentPath,
    uploadOptions,
    setTree,
    clearUploadFiles,
    addDownloadLog,
    clearDownloadLogs,
    addUploadLog,
    setActiveLogChannel,
  } = useLightdashYamlStore();
  const [busy, setBusy] = useState<null | 'refresh' | 'clear' | 'keep'>(null);

  const canRefreshUploaded = lastUploadedFiles.length > 0;
  // Default mirrors the upload that just happened: a selection-driven upload
  // refreshes only those files, an entire-project upload refreshes everything.
  const [refreshScope, setRefreshScope] = useState<RefreshScope>(() =>
    canRefreshUploaded ? 'just-uploaded' : 'all',
  );

  // Reset the scope each time the dialog (re-)opens so the default is
  // re-evaluated against the current `lastUploadedFiles` snapshot.
  useEffect(() => {
    if (showPostUploadDialog) {
      setRefreshScope(lastUploadedFiles.length > 0 ? 'just-uploaded' : 'all');
    }
  }, [showPostUploadDialog, lastUploadedFiles.length]);

  const close = () => {
    setShowPostUploadDialog(false);
    setLastUploadedFiles([]);
    setBusy(null);
  };

  const onRefresh = async () => {
    setBusy('refresh');
    clearDownloadLogs();
    setActiveLogChannel('download');
    const useJustUploaded =
      refreshScope === 'just-uploaded' && canRefreshUploaded;
    const { chartSlugs, dashboardSlugs } = useJustUploaded
      ? partitionLocalPaths(lastUploadedFiles)
      : { chartSlugs: [], dashboardSlugs: [] };
    try {
      const resp = await api.post({
        type: 'lightdash-yaml-download',
        request: {
          path: currentPath.trim() || undefined,
          scope: useJustUploaded ? 'specific' : 'all',
          dashboardIds:
            useJustUploaded && dashboardSlugs.length
              ? dashboardSlugs
              : undefined,
          chartIds:
            useJustUploaded && chartSlugs.length ? chartSlugs : undefined,
          // Reuse the project UUID the upload just succeeded with - the
          // refresh action only ever pulls from the same project we
          // just uploaded to.
          project: uploadOptions.project.trim(),
        },
      });
      if (resp.success) {
        if (resp.tree) {
          setTree(resp.tree);
        }
        clearUploadFiles();
      } else if (resp.error) {
        addDownloadLog({
          level: 'error',
          message: resp.error,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      addDownloadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setActiveLogChannel(null);
      close();
    }
  };

  const onClear = async () => {
    setBusy('clear');
    try {
      await api.post({
        type: 'lightdash-yaml-delete-files',
        request: { paths: lastUploadedFiles },
      });
      const listResp = await api.post({
        type: 'lightdash-yaml-list-files',
        request: { path: currentPath },
      });
      if (listResp.success) {
        setTree(listResp.tree ?? []);
      }
      clearUploadFiles();
    } catch (err) {
      addUploadLog({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    } finally {
      close();
    }
  };

  return (
    <Dialog
      open={showPostUploadDialog}
      onClose={() => (busy ? null : close())}
      className="relative z-50"
    >
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="bg-background border border-surface rounded-lg max-w-md w-full p-5 space-y-4">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2 text-surface-contrast">
            <CheckCircleIcon className="w-5 h-5 text-green-500" />
            Upload complete
          </DialogTitle>
          <p className="text-sm text-surface-contrast">
            {lastUploadedFiles.length === 0
              ? 'Your changes are now live on Lightdash.'
              : `Uploaded ${lastUploadedFiles.length} file${
                  lastUploadedFiles.length === 1 ? '' : 's'
                } to Lightdash.`}{' '}
            What would you like to do with the local files?
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-surface-contrast">
                Refresh scope
              </span>
              <RadioGroup
                name="dac-refresh-scope"
                value={refreshScope}
                onChange={(v) => setRefreshScope(v as RefreshScope)}
                variant="button-group"
                options={[
                  {
                    value: 'just-uploaded',
                    label: canRefreshUploaded
                      ? `Just-uploaded (${lastUploadedFiles.length})`
                      : 'Just-uploaded',
                    disabled: !canRefreshUploaded,
                  },
                  { value: 'all', label: 'Entire project' },
                ]}
              />
            </div>
            <Button
              variant="primary"
              label="Refresh from Lightdash"
              icon={<ArrowDownTrayIcon className="w-4 h-4" />}
              loading={busy === 'refresh'}
              disabled={!!busy}
              onClick={() => void onRefresh()}
              fullWidth
            />
            <Button
              variant="error"
              label="Clear local files"
              icon={<TrashIcon className="w-4 h-4" />}
              loading={busy === 'clear'}
              disabled={!!busy}
              onClick={() => void onClear()}
              fullWidth
            />
            <Button
              variant="secondary"
              label="Keep as-is"
              disabled={!!busy}
              onClick={close}
              fullWidth
            />
          </div>
          <p className="text-xs text-neutral-500">
            <strong>Refresh</strong> re-runs <code>lightdash download</code>{' '}
            using the scope above. <strong>Clear</strong> deletes only the files
            you just uploaded. <strong>Keep</strong> leaves everything in place
            for further iteration.
          </p>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
