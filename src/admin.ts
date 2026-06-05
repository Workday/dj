import { getDjConfig } from '@services/config';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export { ThemeIcon } from 'vscode';

export const WORKSPACE_ROOT =
  vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';

export const DJ_SCHEMAS_PATH = path.join(WORKSPACE_ROOT, `.dj/schemas`);
export const DJ_STATE_PATH = path.join(WORKSPACE_ROOT, `.dj/state`);
export const DJ_SQL_PATH = path.join(WORKSPACE_ROOT, `.dj/sql`);
export const DJ_PYTHON_TEMP_PATH = path.join(
  WORKSPACE_ROOT,
  '.dj',
  '.python_temp',
);
/** @deprecated Use DJ_PYTHON_TEMP_PATH */
export const DJ_PREDBT_TEMP_PATH = DJ_PYTHON_TEMP_PATH;

/**
 * Get Trino connection configuration with precedence: VS Code > Environment > Default
 * Supports:
 * - Command names: 'trino' or 'trino-cli' (resolved from PATH)
 * - Full paths: '/usr/local/bin/trino' or '/usr/local/bin/trino-cli'
 * - Directory paths: '/usr/local/bin' (checks for both 'trino-cli' and 'trino')
 */
export function getTrinoConfig() {
  let { trinoPath } = getDjConfig();

  if (!trinoPath) {
    // Default: use trino-cli from PATH
    return { path: 'trino-cli' };
  }

  // Remove any trailing slashes
  trinoPath = trinoPath.replace(/\/+$/, '');

  // Check if it's a command name (no path separators) - use as-is
  const isCommandName = !trinoPath.includes('/') && !trinoPath.includes('\\');
  if (isCommandName) {
    return { path: trinoPath };
  }

  // Check if it already points to a trino executable (ends with 'trino' or 'trino-cli')
  const basename = trinoPath.split('/').pop() ?? '';
  if (basename === 'trino' || basename === 'trino-cli') {
    return { path: trinoPath };
  }

  // It's a directory path - check for both trino-cli and trino
  const trinoCliPath = `${trinoPath}/trino-cli`;
  const trinoPath2 = `${trinoPath}/trino`;

  // Prefer trino-cli if it exists
  if (fs.existsSync(trinoCliPath)) {
    return { path: trinoCliPath };
  }

  // Fall back to trino if it exists
  if (fs.existsSync(trinoPath2)) {
    return { path: trinoPath2 };
  }

  // Neither exists - default to trino-cli (will fail at runtime with clear error)
  return { path: trinoCliPath };
}

export function djSqlPath({ name }: { name: string }) {
  return path.join(DJ_SQL_PATH, name);
}
export function djSqlRead({ name }: { name: string }) {
  fs.readFileSync(djSqlPath({ name }), 'utf8');
}
export function djSqlWrite({ name, sql }: { name: string; sql: string }) {
  writeFile({
    filePath: djSqlPath({ name }),
    fileText: sql,
  });
}

function writeFile({
  filePath,
  fileText,
}: {
  filePath: string;
  fileText: string;
}) {
  const dirName = path.dirname(filePath);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }
  fs.writeFileSync(filePath, Buffer.from(fileText, 'utf8'));
}

export function timestamp() {
  return new Date().toISOString().slice(0, 23);
}

export type TreeItem = vscode.TreeItem & { children?: TreeItem[] };
export type TreeData = TreeItem[];

export class TreeDataInstance implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  data: TreeItem[];

  constructor(_data?: TreeItem[]) {
    this.data = _data ?? [];
  }

  getTreeItem(element: TreeItem): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(
    element?: TreeItem & { children?: TreeItem[] },
  ): vscode.ProviderResult<TreeItem[]> {
    if (!element) {
      return this.data;
    }
    return element?.children ?? [];
  }

  setData(data: TreeItem[]): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }
}

export class WebviewViewInstance implements vscode.WebviewViewProvider {
  onResolve?: () => Promise<void>;
  view?: vscode.WebviewView;

  constructor({ onResolve }: { onResolve?: () => Promise<void> }) {
    this.onResolve = onResolve;
  }

  resolveWebviewView(_view: vscode.WebviewView) {
    this.view = _view;
    void this.onResolve?.();
  }
  setHtml(html: string) {
    if (!this.view) {
      return;
    }
    this.view.webview.html = html;
  }
}
