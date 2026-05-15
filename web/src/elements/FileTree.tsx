import {
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline';
import type { LightdashYamlNode } from '@shared/lightdash/types';
import { makeClassName } from '@web';
import { useState } from 'react';

export type FileTreeProps = {
  nodes: LightdashYamlNode[];
  /** Currently selected file path (highlighted). */
  selectedPath?: string | null;
  onSelect?: (node: LightdashYamlNode) => void;
  /** Optional render-prop for file row decorations (badges, checkboxes, etc). */
  renderFileExtra?: (node: LightdashYamlNode) => React.ReactNode;
  /** Optional render-prop for directory row decorations. */
  renderDirExtra?: (node: LightdashYamlNode) => React.ReactNode;
  /** Hide files that don't match this case-insensitive substring. */
  filter?: string;
  /** When true, all directories start expanded. Defaults to true. */
  defaultExpanded?: boolean;
  className?: string;
};

function nodeMatchesFilter(node: LightdashYamlNode, filter: string): boolean {
  if (!filter) {
    return true;
  }
  const lower = filter.toLowerCase();
  if (node.name.toLowerCase().includes(lower)) {
    return true;
  }
  if (node.path.toLowerCase().includes(lower)) {
    return true;
  }
  if (node.children) {
    return node.children.some((child) => nodeMatchesFilter(child, lower));
  }
  return false;
}

export function FileTree({
  nodes,
  selectedPath,
  onSelect,
  renderFileExtra,
  renderDirExtra,
  filter = '',
  defaultExpanded = true,
  className = '',
}: FileTreeProps) {
  if (!nodes.length) {
    return (
      <div
        className={makeClassName(
          'text-sm italic text-neutral-500 px-2 py-3',
          className,
        )}
      >
        No files yet.
      </div>
    );
  }
  return (
    <ul className={makeClassName('text-sm', className)}>
      {nodes.map((node) => (
        <FileTreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          renderFileExtra={renderFileExtra}
          renderDirExtra={renderDirExtra}
          filter={filter}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </ul>
  );
}

function FileTreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  renderFileExtra,
  renderDirExtra,
  filter,
  defaultExpanded,
}: {
  node: LightdashYamlNode;
  depth: number;
  selectedPath?: string | null;
  onSelect?: (node: LightdashYamlNode) => void;
  renderFileExtra?: (node: LightdashYamlNode) => React.ReactNode;
  renderDirExtra?: (node: LightdashYamlNode) => React.ReactNode;
  filter: string;
  defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded || filter.length > 0);
  if (!nodeMatchesFilter(node, filter)) {
    return null;
  }

  const indent = { paddingLeft: `${depth * 12 + 4}px` };

  if (node.type === 'dir') {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={makeClassName(
            'w-full flex items-center gap-1.5 py-1 hover:bg-neutral-500/10 text-left',
          )}
          style={indent}
        >
          {open ? (
            <ChevronDownIcon className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="w-3.5 h-3.5 shrink-0" />
          )}
          {open ? (
            <FolderOpenIcon className="w-4 h-4 shrink-0 text-amber-500" />
          ) : (
            <FolderIcon className="w-4 h-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate">{node.name}</span>
          {renderDirExtra && (
            <span className="ml-auto pr-1">{renderDirExtra(node)}</span>
          )}
        </button>
        {open && node.children && node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <FileTreeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                renderFileExtra={renderFileExtra}
                renderDirExtra={renderDirExtra}
                filter={filter}
                defaultExpanded={defaultExpanded}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(node)}
        className={makeClassName(
          'w-full flex items-center gap-1.5 py-1 text-left hover:bg-neutral-500/10',
          isSelected && 'bg-primary/15 hover:bg-primary/20',
        )}
        style={indent}
      >
        <span className="w-3.5 shrink-0" />
        <DocumentTextIcon className="w-4 h-4 shrink-0 text-neutral-500" />
        <span className="truncate">{node.name}</span>
        {renderFileExtra && (
          <span className="ml-auto pr-1">{renderFileExtra(node)}</span>
        )}
      </button>
    </li>
  );
}
