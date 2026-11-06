import { BASE_PACKAGE_JSON_PATH } from '@services/constants';
import {
  decideGeneratedFileAction,
  type GeneratedFileDecision,
  normalizeLineEndings,
  withGeneratedHeader,
} from '@shared/framework/generated-file-header';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { isGitOperationInProgress } from './git-operation';

interface GeneratedFileLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

let cachedExtensionVersion: string | undefined;

/** Version of the running DJ extension, read once from its package.json. */
export function getDjExtensionVersion(): string {
  if (cachedExtensionVersion === undefined) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(BASE_PACKAGE_JSON_PATH, 'utf8'),
      ) as {
        version?: string;
      };
      cachedExtensionVersion = pkg.version ?? '0.0.0';
    } catch {
      cachedExtensionVersion = '0.0.0';
    }
  }
  return cachedExtensionVersion;
}

async function readTextIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString();
  } catch {
    return undefined;
  }
}

/**
 * Write a DJ-generated file only when it is missing, unversioned, or older
 * than the running DJ and the body differs from the desired output. Files
 * stamped by a newer DJ, files with
 * conflict markers, and every file while a git merge/rebase is in progress are
 * left untouched so DJ never fights content git just wrote.
 */
export async function writeGeneratedFileIfOutdated({
  filePath,
  body,
  log,
  version = getDjExtensionVersion(),
}: {
  filePath: string;
  body: string;
  log: GeneratedFileLogger;
  version?: string;
}): Promise<GeneratedFileDecision> {
  const label = path.basename(filePath);
  if (isGitOperationInProgress(path.dirname(filePath))) {
    log.info(`Skipped ${label}: git operation in progress`);
    return { action: 'keep', reason: 'git-operation' };
  }

  const uri = vscode.Uri.file(filePath);
  const existing = await readTextIfExists(uri);
  const decision = decideGeneratedFileAction({
    existing,
    desiredBody: body,
    version,
  });

  if (decision.action === 'write') {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(path.dirname(filePath)),
    );
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(withGeneratedHeader(body, version)),
    );
    log.info(`Generated ${label} (${decision.reason}) at: ${filePath}`);
  } else if (decision.reason !== 'up-to-date') {
    log.info(`Kept ${label} (${decision.reason}) at: ${filePath}`);
  }
  return decision;
}

export const GENERATED_FILE_GIT_ATTRIBUTES = 'eol=lf linguist-generated=true';
const GIT_ATTRIBUTES_SECTION_COMMENT = '# DJ-generated files';

/**
 * Return `.gitattributes` content with an entry appended for every
 * `relativePaths` pattern that has no line yet, or `undefined` when nothing is
 * missing. Existing lines are never modified.
 */
export function buildGitAttributesContent(
  existing: string | undefined,
  relativePaths: Iterable<string>,
): string | undefined {
  const current = existing ?? '';
  const lines = normalizeLineEndings(current).split('\n');
  const declared = new Set(
    lines
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((pattern) => pattern && !pattern.startsWith('#')),
  );

  const missing = new Set<string>();
  for (const relativePath of relativePaths) {
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }
    const pattern = relativePath.split(path.sep).join('/');
    // Unquoted .gitattributes patterns cannot contain whitespace
    if (/\s/.test(pattern) || declared.has(pattern)) {
      continue;
    }
    missing.add(pattern);
  }
  if (missing.size === 0) {
    return undefined;
  }

  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const block = [...missing]
    .sort()
    .map((pattern) => `${pattern} ${GENERATED_FILE_GIT_ATTRIBUTES}`);
  if (!lines.some((line) => line.trim() === GIT_ATTRIBUTES_SECTION_COMMENT)) {
    block.unshift(GIT_ATTRIBUTES_SECTION_COMMENT);
  }

  const prefix = current.trim() === '' ? '' : `${current.trimEnd()}${eol}`;
  return `${prefix}${block.join(eol)}${eol}`;
}

/**
 * Add workspace-relative `filePaths` to the workspace `files.readonlyInclude`
 * setting so VS Code opens them read-only. Existing entries, including ones a
 * user set to `false`, are preserved.
 */
export async function registerReadonlyGeneratedPaths(
  workspaceRoot: string,
  filePaths: Iterable<string>,
): Promise<void> {
  if (!workspaceRoot) {
    return;
  }
  const config = vscode.workspace.getConfiguration('files');
  const current =
    config.inspect<Record<string, boolean>>('readonlyInclude')
      ?.workspaceValue ?? {};

  const next = { ...current };
  let changed = false;
  for (const filePath of filePaths) {
    const relative = path.relative(workspaceRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    const glob = relative.split(path.sep).join('/');
    if (!(glob in next)) {
      next[glob] = true;
      changed = true;
    }
  }

  if (changed) {
    await config.update(
      'readonlyInclude',
      next,
      vscode.ConfigurationTarget.Workspace,
    );
  }
}

/**
 * Revert editor saves of DJ-generated files. Only editor saves raise these
 * events; git checkouts, merges, and other on-disk writes never do, so git is
 * free to update the files. Saves during a merge/rebase are allowed so
 * conflicts can still be resolved in the editor.
 */
export function registerGeneratedFileSaveGuard({
  isGuarded,
  log,
}: {
  isGuarded: (fsPath: string) => boolean;
  log: GeneratedFileLogger;
}): vscode.Disposable[] {
  const contentBeforeSave = new Map<string, string | undefined>();

  const willSave = vscode.workspace.onWillSaveTextDocument((event) => {
    const fsPath = event.document.uri.fsPath;
    if (!isGuarded(fsPath) || isGitOperationInProgress(path.dirname(fsPath))) {
      return;
    }
    event.waitUntil(
      readTextIfExists(event.document.uri).then((text) => {
        contentBeforeSave.set(fsPath, text);
        return [];
      }),
    );
  });

  const didSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const fsPath = document.uri.fsPath;
    if (!contentBeforeSave.has(fsPath)) {
      return;
    }
    const previous = contentBeforeSave.get(fsPath);
    contentBeforeSave.delete(fsPath);
    if (
      previous === undefined ||
      normalizeLineEndings(previous) ===
        normalizeLineEndings(document.getText())
    ) {
      return;
    }
    const label = path.basename(fsPath);
    try {
      await vscode.workspace.fs.writeFile(document.uri, Buffer.from(previous));
      void vscode.window.showInformationMessage(
        `DJ Framework: ${label} is auto-generated and cannot be edited. Your changes have been reverted.`,
      );
    } catch (err) {
      log.warn(`Could not revert ${label}: ${String(err)}`);
    }
  });

  return [willSave, didSave];
}
