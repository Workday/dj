/**
 * Python Model Sync Service (v5 -- JSON is single source of truth)
 *
 * .python.json is the single source of truth. It contains both metadata
 * AND notebook-format `cells` (code + markdown).
 *
 * Derived files:
 *   .python.py   -- concatenated code cells (lives next to .python.json)
 *   .python.ipynb -- ephemeral, stored in .dj/.python_temp/ and auto-deleted on close
 *
 * Sync directions:
 *   JSON  -> PY + IPYNB  (source of truth propagates out)
 *   PY    -> IPYNB        (code edits sync to notebook if open)
 *   IPYNB -> PY           (cell edits sync to .py)
 *
 * PY and IPYNB NEVER write back to JSON.
 */

import {
  cellsToNotebook,
  cellsToPython,
  generatePythonModelCells,
} from '@services/framework/utils';
import type {
  PythonModelCell,
  PythonModelConfig,
} from '@shared/framework/types';
import { DJ_PYTHON_TEMP_PATH, WORKSPACE_ROOT } from 'admin';
import * as path from 'path';
import * as vscode from 'vscode';

export interface PythonModelFileSet {
  jsonPath: string;
  pyPath: string;
  ipynbPath: string;
  config: PythonModelConfig;
}

export type PythonModelSyncSource = 'json' | 'python' | 'notebook';

export interface PythonModelSyncLogger {
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export class PythonModelSyncService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private isSyncing = false;
  private suppressedPaths = new Map<string, number>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private logger: PythonModelSyncLogger;

  /** Maps temp ipynb path -> original json path for reverse lookup */
  private notebookPathMap = new Map<string, string>();

  private static readonly SUPPRESS_TTL_MS = 5_000;
  private static readonly DEBOUNCE_MS = 150;

  constructor(logger: PythonModelSyncLogger) {
    this.logger = logger;
  }

  public initialize(): void {
    const handler = (uri: vscode.Uri, source: PythonModelSyncSource) =>
      this.debouncedHandleFileChange(uri, source);

    const jsonWatcher =
      vscode.workspace.createFileSystemWatcher('**/*.python.json');
    jsonWatcher.onDidChange((uri) => handler(uri, 'json'));
    jsonWatcher.onDidCreate((uri) => handler(uri, 'json'));
    this.disposables.push(jsonWatcher);

    const pyWatcher =
      vscode.workspace.createFileSystemWatcher('**/*.python.py');
    pyWatcher.onDidChange((uri) => handler(uri, 'python'));
    pyWatcher.onDidCreate((uri) => handler(uri, 'python'));
    this.disposables.push(pyWatcher);

    const ipynbWatcher =
      vscode.workspace.createFileSystemWatcher('**/*.python.ipynb');
    ipynbWatcher.onDidChange((uri) => handler(uri, 'notebook'));
    ipynbWatcher.onDidCreate((uri) => handler(uri, 'notebook'));
    this.disposables.push(ipynbWatcher);

    const saveDisposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      const p = doc.uri.fsPath;
      if (p.endsWith('.python.json')) {
        handler(doc.uri, 'json');
      } else if (p.endsWith('.python.py')) {
        handler(doc.uri, 'python');
      } else if (p.endsWith('.python.ipynb')) {
        handler(doc.uri, 'notebook');
      }
    });
    this.disposables.push(saveDisposable);

    const tabDisposable = vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.closed) {
        const uri = this.getTabUri(tab);
        if (!uri) {
          continue;
        }
        const fsPath = uri.fsPath;
        if (
          fsPath.endsWith('.python.ipynb') &&
          fsPath.startsWith(DJ_PYTHON_TEMP_PATH)
        ) {
          this.notebookPathMap.delete(fsPath);
          vscode.workspace.fs.delete(vscode.Uri.file(fsPath)).then(
            () =>
              this.logger.info(
                `Deleted ephemeral notebook: ${path.basename(fsPath)}`,
              ),
            () => {
              /* already deleted */
            },
          );
        }
      }
    });
    this.disposables.push(tabDisposable);

    this.logger.info(
      'PythonModelSyncService (cells-based, ephemeral notebooks) initialized',
    );
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Open an ephemeral notebook for the given .python.json file.
   * Generates the ipynb in .dj/.python_temp/, records the mapping,
   * and opens it in the VS Code notebook editor.
   */
  public async openNotebook(jsonPath: string): Promise<void> {
    try {
      const jsonContent = await vscode.workspace.fs.readFile(
        vscode.Uri.file(jsonPath),
      );
      const config = this.parseJsonTolerant(
        Buffer.from(jsonContent).toString(),
      ) as PythonModelConfig;

      if (!config.cells || config.cells.length === 0) {
        config.cells = generatePythonModelCells(config);
      }

      const ipynbPath = this.computeTempIpynbPath(jsonPath);
      const ipynbDir = path.dirname(ipynbPath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(ipynbDir));

      const nbContent = cellsToNotebook(config.cells);
      this.suppress(ipynbPath);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(ipynbPath),
        Buffer.from(nbContent),
      );

      this.notebookPathMap.set(ipynbPath, jsonPath);

      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(ipynbPath),
        'jupyter-notebook',
      );

      this.logger.info(
        `Opened ephemeral notebook: ${path.basename(ipynbPath)}`,
      );
    } catch (error) {
      this.logger.error(`Failed to open notebook: ${String(error)}`);
      void vscode.window.showErrorMessage(
        `Failed to open Python model notebook: ${String(error)}`,
      );
    }
  }

  public async syncFile(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    let source: PythonModelSyncSource;

    if (filePath.endsWith('.python.json')) {
      source = 'json';
    } else if (filePath.endsWith('.python.py')) {
      source = 'python';
    } else if (filePath.endsWith('.python.ipynb')) {
      source = 'notebook';
    } else {
      this.logger.warn(`Unknown Python model file type: ${filePath}`);
      return;
    }

    await this.handleFileChange(uri, source);
  }

  // ── Debounce & suppression ─────────────────────────────────────────

  private debouncedHandleFileChange(
    uri: vscode.Uri,
    source: PythonModelSyncSource,
  ): void {
    const key = uri.fsPath;
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.handleFileChange(uri, source);
      }, PythonModelSyncService.DEBOUNCE_MS),
    );
  }

  private isSuppressed(filePath: string): boolean {
    const ts = this.suppressedPaths.get(filePath);
    if (ts === undefined) {
      return false;
    }
    if (Date.now() - ts > PythonModelSyncService.SUPPRESS_TTL_MS) {
      this.suppressedPaths.delete(filePath);
      return false;
    }
    this.suppressedPaths.delete(filePath);
    return true;
  }

  private suppress(filePath: string): void {
    this.suppressedPaths.set(filePath, Date.now());
  }

  /** Strip trailing commas so hand-edited JSONC doesn't break parsing. */
  private parseJsonTolerant(content: string): unknown {
    const cleaned = content.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(cleaned);
  }

  // ── Core sync handler ──────────────────────────────────────────────

  private async handleFileChange(
    uri: vscode.Uri,
    source: PythonModelSyncSource,
  ): Promise<void> {
    const filePath = uri.fsPath;

    if (this.isSuppressed(filePath)) {
      return;
    }

    if (this.isSyncing) {
      return;
    }

    try {
      this.isSyncing = true;
      const baseName = path.basename(filePath);
      this.logger.info(
        `Python model file changed: ${baseName} (source: ${source})`,
      );

      const fileSet = await this.resolveFileSet(uri, source);
      if (!fileSet) {
        this.logger.warn(`Could not resolve file set for: ${filePath}`);
        return;
      }

      void vscode.window.setStatusBarMessage(
        `$(sync~spin) Python Model: Syncing ${baseName}...`,
        10_000,
      );

      switch (source) {
        case 'json':
          await this.syncFromJson(fileSet);
          break;
        case 'python':
          await this.syncFromPython(fileSet);
          break;
        case 'notebook':
          await this.syncFromNotebook(fileSet);
          break;
      }

      void vscode.window.setStatusBarMessage(
        `$(check) Python Model: ${baseName} synced`,
        3000,
      );
    } catch (error) {
      this.logger.error(`Error syncing Python model files: ${String(error)}`);
      void vscode.window.showErrorMessage(
        `Python Model Sync failed: ${String(error)}`,
      );
    } finally {
      this.isSyncing = false;
    }
  }

  // ── Temp ipynb path helpers ────────────────────────────────────────

  /**
   * Derive the temp ipynb path by mirroring the relative path from
   * workspace root under .dj/.python_temp/.
   */
  private computeTempIpynbPath(jsonPath: string): string {
    const relative = path.relative(WORKSPACE_ROOT, jsonPath);
    const ipynbRelative = relative.replace(/\.python\.json$/, '.python.ipynb');
    return path.join(DJ_PYTHON_TEMP_PATH, ipynbRelative);
  }

  /**
   * Check if a temp ipynb path has an open editor tab.
   */
  private isNotebookOpen(ipynbPath: string): boolean {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        const uri = this.getTabUri(tab);
        if (uri?.fsPath === ipynbPath) {
          return true;
        }
      }
    }
    return false;
  }

  private getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) {
      return input.uri;
    }
    if (input instanceof vscode.TabInputNotebook) {
      return input.uri;
    }
    return undefined;
  }

  // ── File set resolution ────────────────────────────────────────────

  private async resolveFileSet(
    uri: vscode.Uri,
    source: PythonModelSyncSource,
  ): Promise<PythonModelFileSet | null> {
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);

    let jsonPath: string | null = null;

    if (source === 'notebook') {
      // Notebook lives in temp dir -- look up the original json path
      const mapped = this.notebookPathMap.get(filePath);
      if (mapped) {
        jsonPath = mapped;
      } else {
        this.logger.warn(`No mapping found for notebook: ${filePath}`);
        return null;
      }
    } else {
      const dir = path.dirname(filePath);
      let name: string | null = null;

      if (source === 'json') {
        const match = fileName.match(/^(.+)\.python\.json$/);
        if (match) {
          name = match[1];
        }
      } else if (source === 'python') {
        const match = fileName.match(/^(.+)\.python\.py$/);
        if (match) {
          name = match[1];
        }
      }

      if (!name) {
        return null;
      }
      jsonPath = path.join(dir, `${name}.python.json`);
    }

    const dir = path.dirname(jsonPath);
    const jsonName = path.basename(jsonPath);
    const nameMatch = jsonName.match(/^(.+)\.python\.json$/);
    if (!nameMatch) {
      return null;
    }
    const name = nameMatch[1];

    const pyPath = path.join(dir, `${name}.python.py`);
    const ipynbPath = this.computeTempIpynbPath(jsonPath);

    try {
      const jsonContent = await vscode.workspace.fs.readFile(
        vscode.Uri.file(jsonPath),
      );
      const config = this.parseJsonTolerant(
        Buffer.from(jsonContent).toString(),
      ) as PythonModelConfig;

      return { jsonPath, pyPath, ipynbPath, config };
    } catch {
      this.logger.warn(`Could not read JSON config: ${jsonPath}`);
      return null;
    }
  }

  // ── Config cell refresh ────────────────────────────────────────────

  private refreshConfigCells(config: PythonModelConfig): PythonModelCell[] {
    const cells = config.cells ?? [];
    if (cells.length === 0) {
      return generatePythonModelCells(config);
    }

    const fresh = generatePythonModelCells(config);

    const isConfigCell = (src: string) =>
      src.includes('OUTPUT_CONFIG = PythonModelConfig(') ||
      src.includes('MODEL_CONFIG = PythonModelConfig(') ||
      src.includes('MODEL_CONFIG = PreDbtConfig(') ||
      src.includes('INPUT_VARIABLES = {') ||
      src.includes('MODEL_VARIABLES = {') ||
      src.includes('# Python Model:') ||
      src.includes('# Pre-dbt Model:') ||
      src.includes('context = {');

    return cells.map((cell) => {
      const src = Array.isArray(cell.source)
        ? cell.source.join('')
        : cell.source;
      if (!isConfigCell(src)) {
        return cell;
      }

      const match = fresh.find((f) => {
        const fSrc = Array.isArray(f.source) ? f.source.join('') : f.source;
        if (
          (src.includes('OUTPUT_CONFIG') || src.includes('MODEL_CONFIG')) &&
          (fSrc.includes('OUTPUT_CONFIG') || fSrc.includes('MODEL_CONFIG'))
        ) {
          return true;
        }
        if (
          (src.includes('INPUT_VARIABLES') ||
            src.includes('MODEL_VARIABLES')) &&
          (fSrc.includes('INPUT_VARIABLES') || fSrc.includes('MODEL_VARIABLES'))
        ) {
          return true;
        }
        if (
          (src.includes('# Python Model:') ||
            src.includes('# Pre-dbt Model:')) &&
          (fSrc.includes('# Python Model:') ||
            fSrc.includes('# Pre-dbt Model:'))
        ) {
          return true;
        }
        if (src.includes('context = {') && fSrc.includes('context = {')) {
          return true;
        }
        return false;
      });

      return match ?? cell;
    });
  }

  // ── JSON -> PY + IPYNB ──────────────────────────────────────────────

  private async syncFromJson(fileSet: PythonModelFileSet): Promise<void> {
    const { config, pyPath, ipynbPath } = fileSet;
    this.logger.info('Syncing from JSON -> PY + IPYNB');

    const refreshedCells = this.refreshConfigCells(config);
    config.cells = refreshedCells;

    const pyContent = cellsToPython(config.cells, config);
    this.suppress(pyPath);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(pyPath),
      Buffer.from(pyContent),
    );

    // Only update the ephemeral notebook if it is currently open
    if (this.isNotebookOpen(ipynbPath)) {
      const nbContent = cellsToNotebook(config.cells);
      this.suppress(ipynbPath);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(ipynbPath),
        Buffer.from(nbContent),
      );
    }

    this.logger.info(
      `Synced JSON -> PY${this.isNotebookOpen(ipynbPath) ? ' + IPYNB' : ''}`,
    );
  }

  // ── PY -> IPYNB (JSON is never modified) ─────────────────────────────

  private async syncFromPython(fileSet: PythonModelFileSet): Promise<void> {
    const { pyPath, ipynbPath, config } = fileSet;

    if (!this.isNotebookOpen(ipynbPath)) {
      this.logger.info('PY changed but notebook not open -- nothing to sync');
      return;
    }

    this.logger.info('Syncing from PY -> IPYNB');

    const pyContent = await vscode.workspace.fs.readFile(
      vscode.Uri.file(pyPath),
    );
    const pyCode = Buffer.from(pyContent).toString();

    if (!config.cells || config.cells.length === 0) {
      config.cells = generatePythonModelCells(config);
    }

    const blocks = pyCode.split('\n\n\n').slice(1);
    const tempCells = [...config.cells];

    const editableCells: PythonModelCell[] = [];
    for (const cell of tempCells) {
      if (cell.cell_type !== 'code') {
        continue;
      }
      const src = Array.isArray(cell.source)
        ? cell.source.join('')
        : cell.source;
      const trimmed = src.trim();
      if (
        trimmed.startsWith('context = {') ||
        trimmed.startsWith("context = {'ds")
      ) {
        continue;
      }
      if (
        trimmed === 'run_etl(context)' ||
        trimmed === '# Run the ETL\nrun_etl(context)'
      ) {
        continue;
      }
      editableCells.push(cell);
    }

    const count = Math.min(blocks.length, editableCells.length);
    for (let i = 0; i < count; i++) {
      const blockContent = blocks[i].trim() + '\n';
      const cell = editableCells[i];
      cell.source = blockContent
        .split('\n')
        .map((line, j, arr) => (j < arr.length - 1 ? line + '\n' : line));
      if (
        Array.isArray(cell.source) &&
        cell.source[cell.source.length - 1] === ''
      ) {
        cell.source.pop();
      }
    }

    const nbContent = cellsToNotebook(tempCells);
    this.suppress(ipynbPath);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(ipynbPath),
      Buffer.from(nbContent),
    );

    this.logger.info('Synced PY -> IPYNB');
  }

  // ── IPYNB -> PY (JSON is never modified) ─────────────────────────────

  private async syncFromNotebook(fileSet: PythonModelFileSet): Promise<void> {
    const { ipynbPath, pyPath, config } = fileSet;

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(ipynbPath));
    } catch {
      return;
    }

    this.logger.info('Syncing from IPYNB -> PY');

    const notebookContent = await vscode.workspace.fs.readFile(
      vscode.Uri.file(ipynbPath),
    );
    const notebook = this.parseJsonTolerant(
      Buffer.from(notebookContent).toString(),
    ) as Record<string, unknown>;

    // Extract cells from notebook to generate the .py file
    let cells: PythonModelCell[] = config.cells ?? [];
    if (notebook.cells && Array.isArray(notebook.cells)) {
      cells = notebook.cells.map(
        (c: Record<string, unknown>): PythonModelCell => ({
          cell_type: c.cell_type as PythonModelCell['cell_type'],
          metadata: (c.metadata as Record<string, unknown>) ?? {},
          source: c.source as string[] | string,
          ...(c.cell_type === 'code' && {
            execution_count: null,
            outputs: [],
          }),
        }),
      );
    }

    const pyContent = cellsToPython(cells, config);
    this.suppress(pyPath);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(pyPath),
      Buffer.from(pyContent),
    );

    this.logger.info('Synced IPYNB -> PY');
  }

  // ── Dispose ────────────────────────────────────────────────────────

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
