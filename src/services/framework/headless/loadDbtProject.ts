import { jsonParse } from '@shared';
import type { DbtProject, DbtProjectManifest } from '@shared/dbt/types';
import { getDbtProjectProperties } from '@shared/dbt/utils';
import * as fs from 'fs';
import * as path from 'path';

function emptyManifest(): DbtProjectManifest {
  return {
    child_map: {},
    disabled: {},
    docs: {},
    exposures: {},
    group_map: {},
    groups: {},
    macros: {},
    metadata: {},
    metrics: {},
    nodes: {},
    parent_map: {},
    saved_queries: {},
    selectors: {},
    semantic_models: {},
    sources: {},
  };
}

function loadManifest(project: DbtProject): DbtProjectManifest {
  const manifestPath = path.join(
    project.pathSystem,
    project.targetPath,
    'manifest.json',
  );
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    if (!content.trim()) {
      return emptyManifest();
    }
    return jsonParse(content) as DbtProjectManifest;
  } catch {
    return emptyManifest();
  }
}

export interface LoadDbtProjectOptions {
  /** Workspace root used to compute pathRelative. Defaults to projectDir parent. */
  workspaceRoot?: string;
  /** When false, skip loading manifest.json. Defaults to true. */
  loadManifest?: boolean;
}

/**
 * Load a DbtProject from a directory containing dbt_project.yml.
 * Mirrors the core of Dbt.initProject without VS Code dependencies.
 */
export function loadDbtProject(
  projectDir: string,
  options: LoadDbtProjectOptions = {},
): DbtProject {
  const resolvedDir = path.resolve(projectDir);
  const projectYmlPath = path.join(resolvedDir, 'dbt_project.yml');

  if (!fs.existsSync(projectYmlPath)) {
    throw new Error(`dbt_project.yml not found in ${resolvedDir}`);
  }

  const projectFile = fs.readFileSync(projectYmlPath, 'utf8');
  const projectProperties = getDbtProjectProperties(projectFile);

  if (!projectProperties.name) {
    throw new Error(`dbt_project.yml in ${resolvedDir} is missing project name`);
  }

  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? path.dirname(resolvedDir),
  );
  const pathRelative = resolvedDir.startsWith(workspaceRoot + path.sep)
    ? resolvedDir.slice(workspaceRoot.length + 1)
    : resolvedDir;

  const project: DbtProject = {
    macroPaths: projectProperties['macro-paths'] ?? ['macros'],
    manifest: emptyManifest(),
    modelPaths: projectProperties['model-paths'] ?? ['models'],
    name: projectProperties.name,
    packagePath: projectProperties['packages-install-path'] ?? 'dbt_packages',
    pathRelative,
    pathSystem: resolvedDir,
    properties: projectProperties,
    targetPath: projectProperties['target-path'] ?? 'target',
    variables: projectProperties.vars ?? {},
  };

  if (options.loadManifest !== false) {
    project.manifest = loadManifest(project);
  }

  return project;
}

export function getManifestInfo(project: DbtProject): {
  path: string;
  exists: boolean;
  mtimeMs: number | null;
} {
  const manifestPath = path.join(
    project.pathSystem,
    project.targetPath,
    'manifest.json',
  );
  try {
    const stat = fs.statSync(manifestPath);
    return { path: manifestPath, exists: true, mtimeMs: stat.mtimeMs };
  } catch {
    return { path: manifestPath, exists: false, mtimeMs: null };
  }
}

/**
 * Find all dbt_project.yml files under a workspace root.
 */
export function findDbtProjectDirs(
  workspaceRoot: string,
  maxDepth = 8,
): string[] {
  const results: string[] = [];
  const root = path.resolve(workspaceRoot);

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name;
      if (
        name === 'node_modules' ||
        name === '.git' ||
        name === 'target' ||
        name === 'dbt_packages' ||
        name === '.venv' ||
        name === 'venv'
      ) {
        continue;
      }
      const fullPath = path.join(dir, name);
      const projectYml = path.join(fullPath, 'dbt_project.yml');
      if (fs.existsSync(projectYml)) {
        results.push(fullPath);
        continue;
      }
      walk(fullPath, depth + 1);
    }
  }

  const rootProjectYml = path.join(root, 'dbt_project.yml');
  if (fs.existsSync(rootProjectYml)) {
    results.push(root);
  }
  walk(root, 0);
  return [...new Set(results)].sort();
}
