import * as fs from 'fs';
import { getRegistryConfig } from '../projects/registry';
import type { TrinoConnectionConfig } from '../projects/types';

export interface ResolvedTrinoConnection {
  enabled: boolean;
  host: string;
  port: number;
  httpScheme: 'http' | 'https';
  catalog: string;
  schema: string;
  user: string;
  password?: string;
  cliPath?: string;
  defaultLimit: number;
  timeoutMs: number;
  previewMode: 'compile' | 'run';
  baseUrl: string;
}

function readPassword(
  cfg: TrinoConnectionConfig | undefined,
): string | undefined {
  if (cfg?.passwordFile) {
    const p = cfg.passwordFile.trim();
    if (p && fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').trim();
    }
  }
  const envName = cfg?.passwordEnv?.trim() || 'TRINO_PASSWORD';
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return process.env.TRINO_PASSWORD?.trim() || undefined;
}

/**
 * Resolve effective Trino connection: env → global config → per-project overrides.
 */
export function resolveTrinoConnection(
  projectId?: string,
): ResolvedTrinoConnection {
  const file = getRegistryConfig();
  const project = projectId
    ? file.projects?.find((p) => p.id === projectId)
    : undefined;
  const global = file.trino ?? {};
  const local = project?.trino ?? {};
  const merged: TrinoConnectionConfig = { ...global, ...local };

  const host =
    process.env.TRINO_HOST?.trim() ||
    merged.host?.trim() ||
    '';
  const port = Number(
    process.env.TRINO_PORT?.trim() ||
      merged.port ||
      (merged.httpScheme === 'http' ? 8080 : 443),
  );
  const httpScheme: 'http' | 'https' =
    (process.env.TRINO_SSL === 'false' ? 'http' : undefined) ||
    merged.httpScheme ||
    (port === 8080 || port === 80 ? 'http' : 'https');
  const catalog =
    process.env.TRINO_CATALOG?.trim() ||
    merged.catalog?.trim() ||
    'hive';
  const schema =
    process.env.TRINO_SCHEMA?.trim() ||
    merged.schema?.trim() ||
    'default';
  const user =
    process.env.TRINO_USERNAME?.trim() ||
    process.env.TRINO_USER?.trim() ||
    merged.user?.trim() ||
    'dj-mcp';
  const cliPath =
    process.env.DJ_TRINO_PATH?.trim() ||
    (merged.cliPath === null || merged.cliPath === ''
      ? undefined
      : merged.cliPath?.trim()) ||
    undefined;
  const enabledExplicit = merged.enabled;
  const enabled =
    enabledExplicit === true ||
    (enabledExplicit !== false && Boolean(host));

  return {
    enabled,
    host,
    port,
    httpScheme,
    catalog,
    schema,
    user,
    password: readPassword(merged),
    cliPath,
    defaultLimit: merged.defaultLimit ?? 100,
    timeoutMs: merged.timeoutMs ?? 120_000,
    previewMode: merged.previewMode ?? 'compile',
    baseUrl: `${httpScheme}://${host}:${port}`,
  };
}

export function assertTrinoEnabled(
  conn: ResolvedTrinoConnection,
): void {
  if (!conn.enabled || !conn.host) {
    throw new Error(
      'Trino is not configured. Set trino.enabled/host in DJ_MCP_CONFIG (and TRINO_PASSWORD via env), then retry.',
    );
  }
}

/** Public fields safe to return in tool responses (no secrets). */
export function publicTrinoInfo(conn: ResolvedTrinoConnection) {
  return {
    host: conn.host,
    port: conn.port,
    httpScheme: conn.httpScheme,
    catalog: conn.catalog,
    schema: conn.schema,
    user: conn.user,
    mode: conn.cliPath ? 'cli' : 'http',
    defaultLimit: conn.defaultLimit,
    previewMode: conn.previewMode,
  };
}
