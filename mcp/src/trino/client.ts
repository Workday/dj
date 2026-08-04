import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { buildTrinoCliArgs } from '@shared/trino/cli';
import type { ResolvedTrinoConnection } from './resolve';

const execFileAsync = promisify(execFile);

export interface TrinoQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated?: boolean;
}

const FORBIDDEN =
  /^\s*(insert|update|delete|drop|create|alter|truncate|merge|call|execute|grant|revoke|set\s+session|use\s+)/i;

export function assertSelectOnly(sql: string): void {
  const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim();
  // Allow WITH ... SELECT and SHOW / DESCRIBE / EXPLAIN
  if (
    FORBIDDEN.test(trimmed) &&
    !/^\s*(with|select|show|describe|desc|explain)\b/i.test(trimmed)
  ) {
    throw new Error(
      'Only SELECT / SHOW / DESCRIBE / EXPLAIN queries are allowed for MCP Trino preview',
    );
  }
  if (
    !/^\s*(with|select|show|describe|desc|explain)\b/i.test(trimmed)
  ) {
    throw new Error(
      'Query must start with SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN',
    );
  }
}

export function ensureLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/^\s*(show|describe|desc|explain)\b/i.test(trimmed)) {
    return trimmed;
  }
  if (/\blimit\s+\d+\b/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\nLIMIT ${Math.max(1, Math.min(limit, 10_000))}`;
}

export function quoteIdent(id: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
    throw new Error(`Invalid SQL identifier: ${id}`);
  }
  return `"${id}"`;
}

function parseCsv(text: string): TrinoQueryResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0 };
  }
  const columns = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => splitCsvLine(line));
  return { columns, rows, rowCount: rows.length };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function executeViaCli(
  conn: ResolvedTrinoConnection,
  sql: string,
): Promise<TrinoQueryResult> {
  const cli = conn.cliPath || process.env.DJ_TRINO_PATH || 'trino-cli';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-mcp-trino-'));
  const sqlFile = path.join(tmpDir, 'query.sql');
  const sqlWithSemi = sql.trim().endsWith(';') ? sql.trim() : `${sql.trim()};`;
  fs.writeFileSync(sqlFile, sqlWithSemi, 'utf8');
  const args = buildTrinoCliArgs({ file: sqlFile });
  const env = {
    ...process.env,
    TRINO_HOST: conn.host,
    TRINO_PORT: String(conn.port),
    TRINO_USERNAME: conn.user,
    TRINO_USER: conn.user,
    TRINO_CATALOG: conn.catalog,
    TRINO_SCHEMA: conn.schema,
    ...(conn.password ? { TRINO_PASSWORD: conn.password } : {}),
  };
  try {
    const { stdout, stderr } = await execFileAsync(cli, args, {
      env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: conn.timeoutMs,
    });
    if (!stdout.trim() && stderr.trim()) {
      throw new Error(stderr.trim());
    }
    return parseCsv(stdout);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

interface TrinoStatementResponse {
  nextUri?: string;
  data?: unknown[][];
  columns?: { name: string }[];
  error?: { message?: string };
  stats?: { state?: string };
}

async function executeViaHttp(
  conn: ResolvedTrinoConnection,
  sql: string,
): Promise<TrinoQueryResult> {
  const headers: Record<string, string> = {
    'X-Trino-User': conn.user,
    'X-Trino-Source': 'dj-mcp',
    'X-Trino-Catalog': conn.catalog,
    'X-Trino-Schema': conn.schema,
    'Content-Type': 'text/plain',
  };
  if (conn.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${conn.user}:${conn.password}`,
    ).toString('base64')}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), conn.timeoutMs);
  try {
    let url = `${conn.baseUrl}/v1/statement`;
    let body: string | undefined = sql;
    let method: 'POST' | 'GET' = 'POST';
    const columns: string[] = [];
    const rows: unknown[][] = [];

    // Follow nextUri until finished
    for (let i = 0; i < 10_000; i++) {
      const reqHeaders: Record<string, string> = { ...headers };
      if (method === 'GET') {
        delete reqHeaders['Content-Type'];
      }
      const res = await fetch(url, {
        method,
        headers: reqHeaders,
        body: method === 'POST' ? body : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Trino HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const json = (await res.json()) as TrinoStatementResponse;
      if (json.error?.message) {
        throw new Error(json.error.message);
      }
      if (json.columns?.length && columns.length === 0) {
        for (const c of json.columns) {
          columns.push(c.name);
        }
      }
      if (json.data?.length) {
        rows.push(...json.data);
      }
      if (!json.nextUri) {
        break;
      }
      url = json.nextUri;
      method = 'GET';
      body = undefined;
    }

    return { columns, rows, rowCount: rows.length };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute a read-only SQL statement against Trino (HTTP or CLI).
 */
export async function executeTrinoQuery(
  conn: ResolvedTrinoConnection,
  sql: string,
  options: { limit?: number; skipLimit?: boolean } = {},
): Promise<TrinoQueryResult> {
  assertSelectOnly(sql);
  const limit = options.limit ?? conn.defaultLimit;
  const finalSql = options.skipLimit ? sql.trim() : ensureLimit(sql, limit);
  if (conn.cliPath) {
    return executeViaCli(conn, finalSql);
  }
  return executeViaHttp(conn, finalSql);
}
