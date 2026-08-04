import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ProjectBackendType = 'git' | 'local';

export interface ProjectPrConfig {
  provider?: 'github';
  remote?: string;
  baseBranch?: string;
}

/** Trino connection for live source/model preview (secrets via env only). */
export interface TrinoConnectionConfig {
  enabled?: boolean;
  host?: string;
  port?: number;
  httpScheme?: 'http' | 'https';
  catalog?: string;
  schema?: string;
  user?: string;
  /** Name of env var holding the password (never store plaintext). */
  passwordEnv?: string;
  /** Optional path to a password file. */
  passwordFile?: string;
  /** If set, use Trino CLI instead of HTTP statement API. */
  cliPath?: string | null;
  defaultLimit?: number;
  timeoutMs?: number;
  /** Default preview mode for models: compile (SELECT) or run (materialize then SELECT). */
  previewMode?: 'compile' | 'run';
}

export interface CatalogProjectConfig {
  id: string;
  label: string;
  type: ProjectBackendType;
  /** Local absolute path (type=local). */
  path?: string;
  /** Git remote URL (type=git). */
  url?: string;
  ref?: string;
  /** dbt project name inside the checkout when multiple exist. */
  projectName?: string;
  pr?: ProjectPrConfig;
  /** Per-project Trino overrides (catalog/schema/etc.). */
  trino?: Partial<TrinoConnectionConfig>;
}

export interface DjMcpFileConfig {
  productionMode?: boolean;
  allowLocalProjectMode?: boolean;
  exposeFilesystemPaths?: boolean;
  projects?: CatalogProjectConfig[];
  defaultProjectId?: string;
  /** Global Trino connection for live previews. */
  trino?: TrinoConnectionConfig;
}

export type SessionMode = 'catalog' | 'local' | 'unset';

export interface SessionState {
  mode: SessionMode;
  activeProjectId?: string;
  activeLocalPath?: string;
}

export interface ResolvedProjectContext {
  mode: 'catalog' | 'local';
  projectId?: string;
  label: string;
  /** Absolute path to workspace root (parent or project dir). */
  workspaceRoot: string;
  /** Absolute path to the dbt project directory. */
  projectPath: string;
  projectName?: string;
  gitRoot?: string;
  baseRef?: string;
  pr?: ProjectPrConfig;
  exposePaths: boolean;
}

export interface ChangeSetManifest {
  changeSetId: string;
  status: 'awaiting_approval' | 'published' | 'discarded' | 'failed';
  mode: 'catalog' | 'local';
  projectId?: string;
  label: string;
  projectName?: string;
  baseRoot: string;
  worktreePath: string;
  gitRoot: string;
  baseSha: string;
  baseBranch: string;
  changedFiles: string[];
  relativeChangedFiles: string[];
  createdAt: number;
  updatedAt: number;
  branch?: string;
  commitSha?: string;
  prUrl?: string;
  error?: string;
}

export function djMcpHome(): string {
  return path.join(os.homedir(), '.dj-mcp');
}

export function configPath(): string {
  return (
    process.env.DJ_MCP_CONFIG?.trim() ||
    path.join(djMcpHome(), 'config.json')
  );
}

export function mirrorsDir(): string {
  return path.join(djMcpHome(), 'mirrors');
}

export function changesDir(): string {
  return path.join(djMcpHome(), 'changes');
}

export function ensureDjMcpDirs(): void {
  fs.mkdirSync(mirrorsDir(), { recursive: true });
  fs.mkdirSync(changesDir(), { recursive: true });
}

export function loadFileConfig(): DjMcpFileConfig {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return {
      productionMode: false,
      allowLocalProjectMode: true,
      exposeFilesystemPaths: true,
      projects: [],
    };
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as DjMcpFileConfig;
  return {
    productionMode: raw.productionMode ?? false,
    allowLocalProjectMode: raw.allowLocalProjectMode ?? true,
    exposeFilesystemPaths:
      raw.exposeFilesystemPaths ?? !(raw.productionMode ?? false),
    projects: raw.projects ?? [],
    defaultProjectId: raw.defaultProjectId,
    trino: raw.trino,
  };
}
