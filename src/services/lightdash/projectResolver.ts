import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LightdashProjectResolution =
  | { ok: true; uuid: string; error?: undefined }
  | { ok: false; error: string; uuid?: undefined };

type LightdashConnection = {
  serverUrl: string;
  apiKey: string;
  proxyAuthorization?: string;
};

type ResolverDeps = {
  readConnection: () => LightdashConnection | undefined;
  fetch: typeof fetch;
};

export function isLightdashProjectUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Read the Lightdash server URL and API key the same way the Lightdash CLI
 * does: `LIGHTDASH_URL` / `LIGHTDASH_API_KEY` take precedence over the
 * `context` block of `~/.config/lightdash/config.yaml`.
 */
export function readLightdashConnection(): LightdashConnection | undefined {
  let context: Record<string, unknown> = {};
  try {
    const configPath = path.join(
      os.homedir(),
      '.config',
      'lightdash',
      'config.yaml',
    );
    const parsed = parseYaml(fs.readFileSync(configPath, 'utf8')) as {
      context?: Record<string, unknown>;
    } | null;
    context = parsed?.context ?? {};
  } catch {
    // No CLI config file; environment variables may still provide credentials.
  }

  const serverUrl =
    asNonEmptyString(process.env.LIGHTDASH_URL) ??
    asNonEmptyString(context.serverUrl);
  const apiKey =
    asNonEmptyString(process.env.LIGHTDASH_API_KEY) ??
    asNonEmptyString(context.apiKey);
  if (!serverUrl || !apiKey) {
    return undefined;
  }
  return {
    serverUrl: serverUrl.replace(/\/+$/, ''),
    apiKey,
    proxyAuthorization:
      asNonEmptyString(process.env.LIGHTDASH_PROXY_AUTHORIZATION) ??
      asNonEmptyString(context.proxyAuthorization),
  };
}

type OrgProject = { projectUuid: string; slug: string; name?: string };

function extractOrgProjects(body: unknown): OrgProject[] {
  const results =
    body && typeof body === 'object' && 'results' in body ? body.results : body;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.filter(
    (entry): entry is OrgProject =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as OrgProject).projectUuid === 'string' &&
      typeof (entry as OrgProject).slug === 'string',
  );
}

const defaultDeps: ResolverDeps = {
  readConnection: readLightdashConnection,
  fetch: (...args) => fetch(...args),
};

/**
 * Resolve a Lightdash project slug or UUID to a project UUID.
 *
 * UUIDs are returned unchanged without a network call. A slug is matched
 * exactly against the organization's project list, mirroring how the
 * Lightdash CLI resolves `--project <slug>`. Any failure is returned as an
 * `error` so callers can refuse the operation instead of guessing.
 */
export async function resolveLightdashProjectUuid(
  value: string,
  deps: Partial<ResolverDeps> = {},
): Promise<LightdashProjectResolution> {
  const { readConnection, fetch: fetchImpl } = { ...defaultDeps, ...deps };
  const project = value.trim();
  if (!project) {
    return { ok: false, error: 'Project slug or UUID is required.' };
  }
  if (isLightdashProjectUuid(project)) {
    return { ok: true, uuid: project };
  }

  const connection = readConnection();
  if (!connection) {
    return {
      ok: false,
      error: `Could not resolve project "${project}": no Lightdash credentials found. Enter the project UUID, or set LIGHTDASH_URL and LIGHTDASH_API_KEY.`,
    };
  }

  let body: unknown;
  try {
    const headers: Record<string, string> = {
      Authorization: `ApiKey ${connection.apiKey}`,
      Accept: 'application/json',
    };
    if (connection.proxyAuthorization) {
      headers['Proxy-Authorization'] = connection.proxyAuthorization;
    }
    const response = await fetchImpl(
      `${connection.serverUrl}/api/v1/org/projects`,
      { headers },
    );
    if (!response.ok) {
      return {
        ok: false,
        error: `Could not resolve project "${project}": Lightdash responded with HTTP ${response.status}.`,
      };
    }
    body = await response.json();
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not resolve project "${project}": ${reason}`,
    };
  }

  const matches = extractOrgProjects(body).filter(
    (entry) => entry.slug === project,
  );
  if (matches.length === 1) {
    return { ok: true, uuid: matches[0].projectUuid };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Project slug "${project}" matches more than one project. Enter the project UUID instead.`,
    };
  }
  return {
    ok: false,
    error: `No project found with UUID or slug "${project}".`,
  };
}
