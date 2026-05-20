import { ArrowPathIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { useApp } from '@web/context';
import { Button, CodeBlock, FileTree, InputText, Spinner } from '@web/elements';
import { useThemeMode } from '@web/hooks';
import { useLightdashYamlStore } from '@web/stores/useLightdashYamlStore';
import { useEffect } from 'react';

export function ExplorerView() {
  const { api } = useApp();
  const themeMode = useThemeMode();
  const {
    tree,
    isLoadingTree,
    selectedFile,
    setSelectedFile,
    selectedFileContent,
    setSelectedFileContent,
    isLoadingFileContent,
    setIsLoadingFileContent,
    searchTerm,
    setSearchTerm,
    setTree,
    setIsLoadingTree,
    currentPath,
  } = useLightdashYamlStore();

  // Auto-load file content when selection changes.
  useEffect(() => {
    if (!selectedFile) {
      setSelectedFileContent('');
      return;
    }
    let cancelled = false;
    setIsLoadingFileContent(true);
    api
      .post({
        type: 'lightdash-yaml-read-file',
        request: { path: selectedFile },
      })
      .then((resp) => {
        if (cancelled) {
          return;
        }
        if (resp.success) {
          setSelectedFileContent(resp.content ?? '');
        } else {
          setSelectedFileContent(`# Error: ${resp.error ?? 'failed to read'}`);
        }
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setSelectedFileContent(
          `# Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoadingFileContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedFile, setSelectedFileContent, setIsLoadingFileContent]);

  const onRefresh = async () => {
    setIsLoadingTree(true);
    try {
      const resp = await api.post({
        type: 'lightdash-yaml-list-files',
        request: { path: currentPath },
      });
      if (resp.success) {
        setTree(resp.tree ?? []);
      }
    } finally {
      setIsLoadingTree(false);
    }
  };

  const onEdit = async () => {
    if (!selectedFile) {
      return;
    }
    await api.post({
      type: 'lightdash-yaml-edit-file',
      request: { path: selectedFile },
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full min-h-0">
      <aside className="lg:col-span-4 bg-card rounded-lg p-4 h-full min-h-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <InputText
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search files…"
            inputClassName="h-8 text-xs"
          />
          <Button
            variant="iconButton"
            title="Refresh tree"
            icon={<ArrowPathIcon className="w-4 h-4" />}
            onClick={() => void onRefresh()}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoadingTree ? (
            <Spinner inline label="Loading…" size={16} />
          ) : (
            <FileTree
              nodes={tree}
              selectedPath={selectedFile}
              filter={searchTerm}
              onSelect={(node) => setSelectedFile(node.path)}
            />
          )}
        </div>
      </aside>

      <section className="lg:col-span-8 bg-card rounded-lg p-4 h-full min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="text-sm font-semibold truncate">
            {selectedFile ?? 'Select a file to preview'}
          </div>
          <Button
            variant="primary"
            label="Edit"
            icon={<PencilSquareIcon className="w-4 h-4" />}
            disabled={!selectedFile}
            onClick={() => void onEdit()}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {selectedFile ? (
            isLoadingFileContent ? (
              <Spinner inline label="Loading file…" size={16} />
            ) : (
              <CodeBlock
                code={selectedFileContent}
                language="yaml"
                theme={themeMode}
                wrapLines
                showLineNumbers
              />
            )
          ) : (
            <p className="text-xs italic text-neutral-500">
              Pick a YAML file from the tree.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
