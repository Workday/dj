import { getDjConfig } from '@services/config';
import {
  LIGHTDASH_CHART_SCHEMA_URL,
  LIGHTDASH_DASHBOARD_SCHEMA_URL,
} from '@services/constants';
import type { DJLogger } from '@services/djLogger';
import { buildProcessEnv } from '@services/utils/process';
import {
  describeLightdashRestriction,
  resolveLightdashUploadRestriction,
} from '@shared/lightdash/restrictions';
import type {
  LightdashYamlLog,
  LightdashYamlNode,
} from '@shared/lightdash/types';
import { WORKSPACE_ROOT } from 'admin';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Default dashboards-as-code working directory, relative to the workspace
 * root. The Lightdash CLI will create `charts/` and `dashboards/` folders
 * inside this directory.
 */
export const LIGHTDASH_YAML_DEFAULT_PATH = 'lightdash';

/* -------------------------------------------------------------------------- */
/* Path helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the configured dashboards-as-code working directory.
 *
 * `dj.lightdash.dashboardsAsCodePath` is intentionally workspace-relative so
 * the schema bindings and the CLI agree on a single, portable root. An
 * unset / blank value falls back to the well-known `lightdash/` directory.
 */
export function getDashboardsAsCodeRelativePath(): string {
  const setting = vscode.workspace
    .getConfiguration('dj')
    .get<string>('lightdash.dashboardsAsCodePath');
  const trimmed = (setting || '').trim();
  return trimmed === '' ? LIGHTDASH_YAML_DEFAULT_PATH : trimmed;
}

/** Absolute filesystem path corresponding to the configured working dir. */
export function getDashboardsAsCodeAbsolutePath(): string {
  const rel = getDashboardsAsCodeRelativePath();
  return path.isAbsolute(rel) ? rel : path.join(WORKSPACE_ROOT, rel);
}

/* -------------------------------------------------------------------------- */
/* File-tree helpers                                                          */
/* -------------------------------------------------------------------------- */

function toWorkspaceRelative(absPath: string): string {
  return path.relative(WORKSPACE_ROOT, absPath).split(path.sep).join('/');
}

/**
 * Build a hierarchical directory tree of the dashboards-as-code working
 * directory. Only `.yml` / `.yaml` files are emitted; empty directories
 * are pruned.
 */
export function listLightdashFiles(absoluteRoot: string): LightdashYamlNode[] {
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  const buildNode = (absPath: string, name: string): LightdashYamlNode => {
    const relPath = toWorkspaceRelative(absPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      return { name, type: 'file', path: relPath };
    }
    if (stat.isDirectory()) {
      const childEntries = fs
        .readdirSync(absPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() || /\.ya?ml$/i.test(e.name))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) {
            return -1;
          }
          if (!a.isDirectory() && b.isDirectory()) {
            return 1;
          }
          return a.name.localeCompare(b.name);
        });
      const children = childEntries
        .map((entry) => buildNode(path.join(absPath, entry.name), entry.name))
        .filter(
          (node) =>
            node.type === 'file' || (node.children && node.children.length > 0),
        );
      return {
        name,
        type: 'dir',
        path: relPath,
        children,
      };
    }
    return { name, type: 'file', path: relPath };
  };

  const rootEntries = fs
    .readdirSync(absoluteRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() || /\.ya?ml$/i.test(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

  return rootEntries
    .map((entry) => buildNode(path.join(absoluteRoot, entry.name), entry.name))
    .filter(
      (node) =>
        node.type === 'file' || (node.children && node.children.length > 0),
    );
}

/* -------------------------------------------------------------------------- */
/* CLI execution                                                              */
/* -------------------------------------------------------------------------- */

type StreamLogFn = (log: LightdashYamlLog) => void;

/**
 * Spawn the Lightdash CLI and stream its stdout/stderr line-by-line into
 * the webview's LogPanel. The download/upload flows always pass
 * `--project <uuid>` (UI requires the field), so the CLI never reaches
 * its interactive project-selection prompt on these codepaths.
 */
function runLightdash(
  args: string[],
  cwd: string,
  onLog: StreamLogFn,
  log: DJLogger,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    log.info(`Executing: lightdash ${args.join(' ')} (cwd=${cwd})`);
    onLog({
      level: 'info',
      message: `$ lightdash ${args.join(' ')}`,
      timestamp: new Date().toISOString(),
    });

    const env = buildProcessEnv({});
    const child = spawn('lightdash', args, { cwd, env });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        onLog({
          level: 'info',
          message: line,
          timestamp: new Date().toISOString(),
        });
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        const level: LightdashYamlLog['level'] = /error|fail/i.test(line)
          ? 'error'
          : /warn/i.test(line)
            ? 'warning'
            : /✔|success/i.test(line)
              ? 'success'
              : 'info';
        onLog({
          level,
          message: line,
          timestamp: new Date().toISOString(),
        });
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function resolveAbsoluteWorkingDir(rawPath?: string): string {
  const trimmed = rawPath?.trim();
  if (!trimmed) {
    return getDashboardsAsCodeAbsolutePath();
  }
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.join(WORKSPACE_ROOT, trimmed);
}

/**
 * Execute `lightdash download`. When `scope === 'specific'`, pass each
 * dashboard via `-d <id>` and each chart via `-c <id>` (flags repeat).
 *
 * `project` is mandatory (UI enforces non-empty input via inline
 * validation). The CLI is invoked with `--project <uuid>` on every run
 * so we never fall through to the Lightdash CLI's interactive
 * project-selection prompt - that prompt would hang forever in a
 * spawned process with no TTY.
 */
export async function executeLightdashDownload(
  request: {
    path?: string;
    scope: 'all' | 'specific';
    dashboardIds?: string[];
    chartIds?: string[];
    project: string;
  },
  log: DJLogger,
  onLog: StreamLogFn,
): Promise<{
  success: boolean;
  tree?: LightdashYamlNode[];
  absolutePath: string;
  error?: string;
}> {
  const absolutePath = resolveAbsoluteWorkingDir(request.path);
  const project = request.project.trim();
  if (!project) {
    const error =
      'Project UUID is required (production or preview). Set the project field and run again.';
    onLog({
      level: 'error',
      message: error,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error, absolutePath };
  }

  const args: string[] = ['download', '-p', absolutePath, '--project', project];
  if (request.scope === 'specific') {
    for (const id of request.dashboardIds ?? []) {
      args.push('-d', id);
    }
    for (const id of request.chartIds ?? []) {
      args.push('-c', id);
    }
  }

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  try {
    const result = await runLightdash(args, WORKSPACE_ROOT, onLog, log);
    if (result.code !== 0) {
      // Per-line stderr/stdout has already streamed via onLog inside
      // runLightdash; don't re-emit the trimmed bundle to avoid duplicate
      // entries in the LogPanel. Just return the error for the API response.
      const error =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `lightdash download exited with code ${result.code}`;
      return { success: false, error, absolutePath };
    }
    return {
      success: true,
      tree: listLightdashFiles(absolutePath),
      absolutePath,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Transport / unexpected exception path: nothing was streamed, so emit
    // the message once so the user sees something in the LogPanel.
    onLog({
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: message, absolutePath };
  }
}

/**
 * Execute `lightdash upload`. When neither `chartSlugs` nor `dashboardSlugs`
 * is provided, run an entire-project upload. Otherwise pass each as a
 * repeated `-c <slug>` / `-d <slug>` flag.
 *
 * `project` is mandatory; see `executeLightdashDownload` for the
 * rationale.
 */
export async function executeLightdashUpload(
  request: {
    path?: string;
    chartSlugs?: string[];
    dashboardSlugs?: string[];
    force?: boolean;
    includeCharts?: boolean;
    project: string;
    /** See `LightdashApi['lightdash-yaml-upload'].request`. */
    acknowledgedWarning?: boolean;
  },
  log: DJLogger,
  onLog: StreamLogFn,
): Promise<{
  success: boolean;
  uploadedFiles?: string[];
  error?: string;
  restriction?: import('@shared/lightdash/restrictions').LightdashRestrictionStatus;
}> {
  const absolutePath = resolveAbsoluteWorkingDir(request.path);
  const project = request.project.trim();
  if (!project) {
    const error =
      'Project UUID is required (production or preview). Set the project field and run again.';
    onLog({
      level: 'error',
      message: error,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error };
  }

  // Defense-in-depth: re-check the restricted-projects policy here even
  // though the UI pre-flights via `lightdash-yaml-check-upload-policy`.
  // The setting may have changed between the pre-flight and the actual
  // upload, and direct API callers can bypass the UI entirely.
  const restriction = resolveLightdashUploadRestriction(
    project,
    getDjConfig().lightdashRestrictedProjects ?? [],
  );
  if (restriction.status === 'block') {
    const error =
      describeLightdashRestriction(restriction) ??
      `Upload blocked: project ${project} is on the DJ restricted list.`;
    onLog({
      level: 'error',
      message: error,
      timestamp: new Date().toISOString(),
    });
    return {
      success: false,
      error,
      restriction: { ...restriction, message: error },
    };
  }
  if (restriction.status === 'warn' && !request.acknowledgedWarning) {
    const error =
      describeLightdashRestriction(restriction) ??
      `Upload requires confirmation: project ${project} is marked as warn.`;
    onLog({
      level: 'warning',
      message: error,
      timestamp: new Date().toISOString(),
    });
    return {
      success: false,
      error,
      restriction: { ...restriction, message: error },
    };
  }

  const args: string[] = ['upload', '-p', absolutePath, '--project', project];
  for (const slug of request.dashboardSlugs ?? []) {
    args.push('-d', slug);
  }
  for (const slug of request.chartSlugs ?? []) {
    args.push('-c', slug);
  }
  if (request.includeCharts) {
    args.push('--include-charts');
  }
  if (request.force) {
    args.push('--force');
  }

  try {
    const result = await runLightdash(args, WORKSPACE_ROOT, onLog, log);
    if (result.code !== 0) {
      // Per-line stderr/stdout already streamed via onLog inside
      // runLightdash; don't re-emit the trimmed bundle to avoid duplicate
      // entries in the LogPanel.
      const error =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `lightdash upload exited with code ${result.code}`;
      return { success: false, error };
    }
    const uploaded = [
      ...(request.dashboardSlugs ?? []),
      ...(request.chartSlugs ?? []),
    ];
    return {
      success: true,
      uploadedFiles: uploaded,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Transport / unexpected exception path: nothing was streamed, emit once.
    onLog({
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
    });
    return { success: false, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* File operations                                                            */
/* -------------------------------------------------------------------------- */

function resolveSafe(targetPath: string): string {
  const abs = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(WORKSPACE_ROOT, targetPath);
  // Guard against path traversal - only allow paths under the workspace root.
  if (!abs.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Refusing to access path outside workspace: ${targetPath}`);
  }
  return abs;
}

export function readYamlFile(targetPath: string): {
  content: string;
  absolutePath: string;
} {
  const abs = resolveSafe(targetPath);
  return { content: fs.readFileSync(abs, 'utf-8'), absolutePath: abs };
}

export function deleteYamlFiles(targetPaths: string[]): void {
  for (const target of targetPaths) {
    const abs = resolveSafe(target);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      fs.rmSync(abs, { recursive: true, force: true });
    } else {
      fs.unlinkSync(abs);
    }
  }
}

export async function openYamlInEditor(targetPath: string): Promise<void> {
  const abs = resolveSafe(targetPath);
  const doc = await vscode.workspace.openTextDocument(abs);
  await vscode.window.showTextDocument(doc, { preview: false });
}

/* -------------------------------------------------------------------------- */
/* yaml.schemas auto-sync                                                     */
/* -------------------------------------------------------------------------- */

const YAML_EXTENSION_ID = 'redhat.vscode-yaml';
const YAML_PROMPT_DISMISSED_KEY = 'dj.lightdash.yamlExtensionPromptDismissed';

export function isYamlExtensionInstalled(): boolean {
  return vscode.extensions.getExtension(YAML_EXTENSION_ID) !== undefined;
}

/**
 * Idempotently install (or refresh) the `yaml.schemas` and `[yaml]`
 * formatter bindings for the configured dashboards-as-code working dir.
 *
 * No-op when the Red Hat YAML extension isn't installed - there is nothing
 * to consume the bindings, and writing `[yaml].editor.defaultFormatter`
 * would point at a missing formatter.
 *
 * Uses `vscode.workspace.getConfiguration().update(...)` instead of editing
 * `.vscode/settings.json` directly so existing entries - including comments
 * managed by VS Code - are preserved.
 */
export async function syncYamlSchemasSetting(log: DJLogger): Promise<void> {
  if (!isYamlExtensionInstalled()) {
    log.debug(
      '[lightdash] Skipping yaml.schemas sync: redhat.vscode-yaml not installed.',
    );
    return;
  }

  const relPath = getDashboardsAsCodeRelativePath();
  const chartsGlob = `${relPath.replace(/\/$/, '')}/charts/*.yml`;
  const dashboardsGlob = `${relPath.replace(/\/$/, '')}/dashboards/*.yml`;

  try {
    const yamlConfig = vscode.workspace.getConfiguration('yaml');
    const existingSchemas =
      (yamlConfig.get<Record<string, string | string[]>>('schemas') ?? {}) ||
      {};

    const nextSchemas: Record<string, string | string[]> = {
      ...existingSchemas,
      [LIGHTDASH_CHART_SCHEMA_URL]: chartsGlob,
      [LIGHTDASH_DASHBOARD_SCHEMA_URL]: dashboardsGlob,
    };

    await yamlConfig.update(
      'schemas',
      nextSchemas,
      vscode.ConfigurationTarget.Workspace,
    );

    const editorConfig = vscode.workspace.getConfiguration();
    const yamlBlock =
      (editorConfig.get<Record<string, unknown>>('[yaml]') ?? {}) || {};
    if (yamlBlock['editor.defaultFormatter'] !== YAML_EXTENSION_ID) {
      await editorConfig.update(
        '[yaml]',
        { ...yamlBlock, 'editor.defaultFormatter': YAML_EXTENSION_ID },
        vscode.ConfigurationTarget.Workspace,
      );
    }

    log.info(
      `[lightdash] yaml.schemas updated for dashboards-as-code path: ${relPath}`,
    );
  } catch (err: unknown) {
    log.error('[lightdash] Failed to sync yaml.schemas:', err);
  }
}

/**
 * Prompt the user once (per workspace state) to install the Red Hat YAML
 * extension. Called when the Dashboards-as-Code panel is opened so users
 * who never use the feature aren't bothered.
 */
export async function promptInstallYamlExtension(
  context: vscode.ExtensionContext,
  log: DJLogger,
): Promise<void> {
  if (isYamlExtensionInstalled()) {
    return;
  }
  if (context.globalState.get<boolean>(YAML_PROMPT_DISMISSED_KEY)) {
    return;
  }

  const INSTALL = 'Install';
  const NOT_NOW = 'Not now';
  const DONT_ASK = "Don't ask again";

  const choice = await vscode.window.showInformationMessage(
    'Install the Red Hat YAML extension to enable schema validation and autocomplete for Lightdash chart/dashboard files?',
    INSTALL,
    NOT_NOW,
    DONT_ASK,
  );
  if (choice === INSTALL) {
    try {
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        YAML_EXTENSION_ID,
      );
      log.info('[lightdash] redhat.vscode-yaml install triggered.');
    } catch (err: unknown) {
      log.error('[lightdash] Failed to install redhat.vscode-yaml:', err);
    }
  } else if (choice === DONT_ASK) {
    await context.globalState.update(YAML_PROMPT_DISMISSED_KEY, true);
  }
}
