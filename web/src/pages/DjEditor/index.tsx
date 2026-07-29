import type { DjEditorInit, DjEditorUpdate } from '@shared/editor/types';
import { useEnvironment } from '@web/context/useEnvironment';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Visual editor page for .dj files rendered inside a CustomTextEditorProvider webview.
 *
 * Lifecycle:
 * 1. Component mounts, posts 'dj-editor-ready'
 * 2. Extension responds with 'dj-editor-init' containing file content
 * 3. User edits propagate back via 'dj-editor-edit'
 * 4. External changes arrive as 'dj-editor-update'
 */
export function DjEditor() {
  const { vscode } = useEnvironment();
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const suppressUpdateRef = useRef(false);

  // Listen for messages from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as DjEditorInit | DjEditorUpdate;
      switch (msg.type) {
        case 'dj-editor-init':
          setContent(msg.content);
          setFileName(msg.fileName);
          setParseError(null);
          break;
        case 'dj-editor-update':
          // Ignore updates triggered by our own edits
          if (!suppressUpdateRef.current) {
            setContent(msg.content);
            setParseError(null);
          }
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Signal ready to the extension host
  useEffect(() => {
    vscode?.postMessage({ type: 'dj-editor-ready' });
  }, [vscode]);

  const handleEdit = useCallback(
    (newContent: string) => {
      suppressUpdateRef.current = true;
      setContent(newContent);
      vscode?.postMessage({ type: 'dj-editor-edit', content: newContent });
      // Allow updates again after a tick (the extension echoes back the change)
      setTimeout(() => {
        suppressUpdateRef.current = false;
      }, 100);
    },
    [vscode],
  );

  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <span className="text-[var(--vscode-descriptionForeground)]">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <DjEditorContent
      content={content}
      fileName={fileName}
      parseError={parseError}
      onEdit={handleEdit}
      onParseError={setParseError}
    />
  );
}

function DjEditorContent({
  content,
  fileName,
  parseError,
  onEdit,
  onParseError,
}: {
  content: string;
  fileName: string;
  parseError: string | null;
  onEdit: (newContent: string) => void;
  onParseError: (err: string | null) => void;
}) {
  const [model, setModel] = useState<Record<string, unknown>>({});

  useEffect(() => {
    try {
      const parsed = JSON.parse(content);
      setModel(parsed);
      onParseError(null);
    } catch (e) {
      onParseError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [content, onParseError]);

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      const updated = { ...model, [key]: value };
      setModel(updated);
      onEdit(JSON.stringify(updated, null, 2));
    },
    [model, onEdit],
  );

  const displayName =
    fileName.split('/').pop()?.replace('.dj', '') || 'Untitled';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b"
        style={{
          borderColor: 'var(--vscode-panel-border)',
          background: 'var(--vscode-editor-background)',
        }}
      >
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--vscode-editor-foreground)' }}
        >
          {displayName}
        </span>
        {model.type && (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--vscode-badge-background)',
              color: 'var(--vscode-badge-foreground)',
            }}
          >
            {String(model.type)}
          </span>
        )}
      </div>

      {/* Error banner */}
      {parseError && (
        <div
          className="px-4 py-2 text-sm"
          style={{
            background: 'var(--vscode-inputValidation-errorBackground)',
            color: 'var(--vscode-errorForeground)',
            borderBottom:
              '1px solid var(--vscode-inputValidation-errorBorder)',
          }}
        >
          Parse error: {parseError}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3 max-w-2xl">
          {Object.entries(model).map(([key, value]) => (
            <FieldRow
              key={key}
              fieldKey={key}
              value={value}
              onChange={(v) => handleFieldChange(key, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  fieldKey,
  value,
  onChange,
}: {
  fieldKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const isComplex = typeof value === 'object' && value !== null;

  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs font-medium"
        style={{ color: 'var(--vscode-descriptionForeground)' }}
      >
        {fieldKey}
      </label>
      {isComplex ? (
        <pre
          className="text-xs p-2 rounded overflow-x-auto"
          style={{
            background: 'var(--vscode-textCodeBlock-background)',
            color: 'var(--vscode-editor-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <input
          type="text"
          className="text-sm px-2 py-1 rounded"
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
          }}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            // Preserve type: number fields stay numbers, booleans stay booleans
            if (typeof value === 'number') {
              const num = Number(raw);
              onChange(isNaN(num) ? raw : num);
            } else if (typeof value === 'boolean') {
              onChange(raw === 'true');
            } else {
              onChange(raw);
            }
          }}
        />
      )}
    </div>
  );
}
