import {
  findDbtProjectDirs,
  loadDbtProject,
} from '@services/framework/headless';
import * as fs from 'fs';
import * as path from 'path';
import {
  defaultBranch,
  ensureGitMirror,
  findGitRoot,
  currentSha,
} from './git';
import { getSession } from './session';
import {
  ensureDjMcpDirs,
  loadFileConfig,
  mirrorsDir,
  type CatalogProjectConfig,
  type DjMcpFileConfig,
  type ResolvedProjectContext,
} from './types';

export function getRegistryConfig(): DjMcpFileConfig {
  return loadFileConfig();
}

export function listCatalogProjects(): CatalogProjectConfig[] {
  return getRegistryConfig().projects ?? [];
}

function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${candidate}`);
  }
  return resolvedCandidate;
}

async function resolveCatalogProject(
  config: CatalogProjectConfig,
  exposePaths: boolean,
): Promise<ResolvedProjectContext> {
  ensureDjMcpDirs();
  let checkoutRoot: string;
  let gitRoot: string | undefined;
  let baseRef = config.ref ?? 'main';

  if (config.type === 'git') {
    if (!config.url) {
      throw new Error(`Catalog project "${config.id}" is missing url`);
    }
    const mirrorPath = path.join(mirrorsDir(), config.id);
    const mirror = await ensureGitMirror({
      id: config.id,
      url: config.url,
      ref: baseRef,
      mirrorPath,
    });
    checkoutRoot = mirror.gitRoot;
    gitRoot = mirror.gitRoot;
  } else {
    if (!config.path) {
      throw new Error(`Catalog project "${config.id}" is missing path`);
    }
    checkoutRoot = path.resolve(config.path);
    if (!fs.existsSync(checkoutRoot)) {
      throw new Error(`Local catalog path not found: ${checkoutRoot}`);
    }
    gitRoot = (await findGitRoot(checkoutRoot)) ?? undefined;
  }

  const dirs = findDbtProjectDirs(checkoutRoot);
  if (dirs.length === 0) {
    throw new Error(`No dbt_project.yml under catalog project "${config.id}"`);
  }

  let projectPath = dirs[0];
  if (config.projectName) {
    const match = dirs.find((dir) => {
      const project = loadDbtProject(dir, { workspaceRoot: checkoutRoot });
      return project.name === config.projectName;
    });
    if (!match) {
      throw new Error(
        `dbt project "${config.projectName}" not found in catalog "${config.id}"`,
      );
    }
    projectPath = match;
  } else if (dirs.length > 1) {
    throw new Error(
      `Multiple dbt projects in catalog "${config.id}". Set projectName in config.`,
    );
  }

  assertInsideRoot(checkoutRoot, projectPath);

  return {
    mode: 'catalog',
    projectId: config.id,
    label: config.label,
    workspaceRoot: checkoutRoot,
    projectPath,
    projectName: config.projectName ?? loadDbtProject(projectPath).name,
    gitRoot,
    baseRef,
    pr: config.pr,
    exposePaths,
  };
}

async function resolveLocalPath(
  localPath: string,
  projectName: string | undefined,
  exposePaths: boolean,
): Promise<ResolvedProjectContext> {
  const resolved = path.resolve(localPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Local path not found: ${resolved}`);
  }

  const dirs = findDbtProjectDirs(resolved);
  if (dirs.length === 0) {
    throw new Error(`No dbt_project.yml found under ${resolved}`);
  }

  let projectPath = dirs[0];
  if (projectName) {
    const match = dirs.find((dir) => {
      const project = loadDbtProject(dir, { workspaceRoot: resolved });
      return project.name === projectName;
    });
    if (!match) {
      throw new Error(`No dbt project named "${projectName}" under ${resolved}`);
    }
    projectPath = match;
  } else if (dirs.length > 1) {
    throw new Error(
      `Multiple dbt projects under ${resolved}. Pass projectName.`,
    );
  }

  assertInsideRoot(resolved, projectPath);
  const gitRoot = (await findGitRoot(projectPath)) ?? undefined;

  return {
    mode: 'local',
    label: path.basename(projectPath),
    workspaceRoot: resolved,
    projectPath,
    projectName: loadDbtProject(projectPath).name,
    gitRoot,
    baseRef: gitRoot ? await defaultBranch(gitRoot) : undefined,
    pr: { provider: 'github', baseBranch: gitRoot ? await defaultBranch(gitRoot) : 'main' },
    exposePaths,
  };
}

export interface ResolveArgs {
  projectId?: string;
  localPath?: string;
  workspaceRoot?: string;
  projectPath?: string;
  projectName?: string;
}

/**
 * Resolve active project from catalog id, local path, session, or legacy selectors.
 */
export async function resolveActiveProject(
  args: ResolveArgs = {},
): Promise<ResolvedProjectContext> {
  const fileConfig = getRegistryConfig();
  const exposePaths = fileConfig.exposeFilesystemPaths ?? !fileConfig.productionMode;
  const session = getSession();

  const projectId = args.projectId ?? session.activeProjectId;
  const localPath =
    args.localPath ??
    session.activeLocalPath ??
    (fileConfig.productionMode ? undefined : args.workspaceRoot);

  if (projectId) {
    const catalog = listCatalogProjects().find((p) => p.id === projectId);
    if (!catalog) {
      throw new Error(
        `Unknown projectId "${projectId}". Use dj_list_projects.`,
      );
    }
    return resolveCatalogProject(catalog, exposePaths);
  }

  if (localPath) {
    if (fileConfig.allowLocalProjectMode === false) {
      throw new Error(
        'Local project mode is disabled. Select a catalog projectId.',
      );
    }
    return resolveLocalPath(localPath, args.projectName, exposePaths);
  }

  // Legacy / self-hosted: explicit projectPath
  if (args.projectPath) {
    if (fileConfig.productionMode && !exposePaths) {
      throw new Error(
        'Raw projectPath is disabled in production mode. Use projectId.',
      );
    }
    const projectPath = path.resolve(args.projectPath);
    const workspaceRoot = args.workspaceRoot
      ? path.resolve(args.workspaceRoot)
      : projectPath;
    return {
      mode: 'local',
      label: path.basename(projectPath),
      workspaceRoot,
      projectPath,
      projectName: args.projectName ?? loadDbtProject(projectPath).name,
      gitRoot: (await findGitRoot(projectPath)) ?? undefined,
      exposePaths: true,
    };
  }

  // Env DJ_WORKSPACE_ROOT convenience when no catalog/session
  const envRoot = process.env.DJ_WORKSPACE_ROOT?.trim();
  if (envRoot && !fileConfig.productionMode) {
    return resolveLocalPath(envRoot, args.projectName, true);
  }

  if (fileConfig.defaultProjectId) {
    const catalog = listCatalogProjects().find(
      (p) => p.id === fileConfig.defaultProjectId,
    );
    if (catalog) {
      return resolveCatalogProject(catalog, exposePaths);
    }
  }

  const catalog = listCatalogProjects();
  if (catalog.length === 1) {
    return resolveCatalogProject(catalog[0], exposePaths);
  }

  if (catalog.length > 1) {
    throw new Error(
      `Select a project with dj_use_project. Available: ${catalog
        .map((p) => p.id)
        .join(', ')}`,
    );
  }

  throw new Error(
    fileConfig.productionMode
      ? 'No projects available. Contact the MCP operator.'
      : 'No project selected. Use dj_use_local_project with a local path, or configure ~/.dj-mcp/config.json.',
  );
}

export async function getBaseSha(
  ctx: ResolvedProjectContext,
): Promise<{ gitRoot: string; sha: string; baseBranch: string }> {
  if (!ctx.gitRoot) {
    throw new Error(
      'Selected project is not a git repository. Publish requires git.',
    );
  }
  const baseBranch =
    ctx.pr?.baseBranch ?? ctx.baseRef ?? (await defaultBranch(ctx.gitRoot));
  const sha = await currentSha(ctx.gitRoot);
  return { gitRoot: ctx.gitRoot, sha, baseBranch };
}

export function toPublicProject(
  ctx: ResolvedProjectContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    mode: ctx.mode,
    id: ctx.projectId,
    label: ctx.label,
    projectName: ctx.projectName,
    ...extra,
  };
  if (ctx.exposePaths) {
    base.projectPath = ctx.projectPath;
    base.workspaceRoot = ctx.workspaceRoot;
  }
  return base;
}
