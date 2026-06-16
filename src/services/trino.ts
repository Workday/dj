import type { Coder } from '@services/coder';
import { COMMAND_ID } from '@services/constants';
import { findModelForSql } from '@services/trino/findModelForSql';
import {
  deleteProfile,
  getActiveProfile,
  getProfileByName,
  listProfiles,
  setActiveProfile,
  storeSecret,
  upsertProfile,
} from '@services/trino/profiles';
import {
  listPersistedQueries,
  readPersistedSanitizedQuery,
  reapOldDiagnostics,
  sanitizeAndPersist,
} from '@services/trino/queryJsonSanitizer';
import {
  shapeQueryInfo,
  shapeQuerySummary,
  TrinoCoordinatorError,
  TrinoRestClient,
} from '@services/trino/restClient';
import type { ApiEnabledService } from '@services/types';
import { buildProcessEnv } from '@services/utils/process';
import { getHtml } from '@services/webview/utils';
import { assertExhaustive } from '@shared';
import type { ApiMessage, ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import type { FrameworkEtlSource } from '@shared/framework/types';
import type {
  TrinoActiveQueriesResponse,
  TrinoApi,
  TrinoProfile,
  TrinoQuerySummary,
  TrinoSystemNode,
  TrinoTable,
  TrinoTableColumn,
} from '@shared/trino/types';
import {
  djSqlPath,
  djSqlWrite,
  getTrinoConfig,
  TreeDataInstance,
  WORKSPACE_ROOT,
} from 'admin';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const POLLING_INTERVAL_SYSTEM_INFO = 60000; // 60 seconds

export class Trino implements ApiEnabledService<'trino'> {
  coder: Coder;
  handleApi: (payload: ApiPayload<'trino'>) => Promise<ApiResponse>;
  systemNodes: TrinoSystemNode[] | null = null;
  tables = new Map<string, TrinoTable>();
  timeoutSystemInfo: NodeJS.Timeout | null = null;
  viewQueryEngine: TreeDataInstance;
  /** Singleton Query Control Center panel (refocused on subsequent opens). */
  private queryControlCenterPanel?: vscode.WebviewPanel;
  /** Cached REST client. Invalidated whenever the active profile changes. */
  private restClient?: { client: TrinoRestClient; profileName: string };

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;

    this.handleApi = async (payload) => {
      switch (payload.type) {
        case 'trino-fetch-catalogs': {
          const catalogsRaw = await this.handleQuery(`show catalogs`);
          const catalogs = catalogsRaw.map((r) => r['Catalog']);
          return apiResponse<typeof payload.type>(catalogs);
        }
        case 'trino-fetch-columns': {
          const { catalog, schema, table } = payload.request;
          const columnsRaw = await this.handleQuery(
            `show columns from "${catalog}"."${schema}"."${table}"`,
          );
          const columns: TrinoTableColumn[] = columnsRaw.map((r) => {
            return {
              column: r['Column'],
              type: r['Type'],
              extra: r['Extra'],
              comment: r['Comment'] || '',
            };
          });
          return apiResponse<typeof payload.type>(columns);
        }
        case 'trino-fetch-etl-sources': {
          const { projectName, etlSchema } = payload.request;
          const schemaName = etlSchema || 'source_etl';

          const etlSourcesRaw = await this.handleQuery(
            `select source_id, properties, etl_active from ${projectName}.${schemaName}.dbt_sources`,
          );
          const etlSources: FrameworkEtlSource[] = etlSourcesRaw.map((r) => {
            return {
              etl_active: r['etl_active'],
              properties: r['properties'],
              source_id: r['source_id'],
            };
          });
          return apiResponse<typeof payload.type>(etlSources);
        }
        case 'trino-fetch-schemas': {
          const { catalog } = payload.request;
          const schemasRaw = await this.handleQuery(
            `show schemas from ${catalog}`,
          );
          const schemas = schemasRaw.map((r) => r['Schema']);
          return apiResponse<typeof payload.type>(schemas);
        }
        case 'trino-fetch-system-nodes': {
          const nodesRaw = await this.handleQuery(
            'select * from system.runtime.nodes',
          );
          const nodes: TrinoSystemNode[] = nodesRaw.map((r) => {
            return {
              coordinator: Boolean(r['coordinator']),
              http_uri: r['http_uri'],
              node_id: r['node_id'],
              node_version: Number(r['node_version']),
              state: r['state'],
            };
          });
          return apiResponse<typeof payload.type>(nodes);
        }
        case 'trino-fetch-tables': {
          const { catalog, schema } = payload.request;
          const tablesRaw = await this.handleQuery(
            `show tables from ${catalog}.${schema}`,
          );
          const tables = tablesRaw.map((r) => r['Table']);
          return apiResponse<typeof payload.type>(tables);
        }
        case 'trino-fetch-query-info': {
          const { queryId, prefer = 'persisted' } = payload.request;
          const diagnosticsPath = path.join(
            WORKSPACE_ROOT,
            '.dj',
            'diagnostics',
            `${queryId}.json`,
          );
          const fullDiagnosticsPath = path.join(
            WORKSPACE_ROOT,
            '.dj',
            'diagnostics',
            `${queryId}.full.json`,
          );
          // Persisted-first (default): the detail pane sends `prefer:
          // 'persisted'` on every row click and only flips to `'rest'`
          // when the user clicks "Refresh from coordinator" or
          // "Analyze with AI". This means browsing the History tab
          // never hits the network, and re-opening a previously-
          // analyzed Live query is also free.
          if (prefer === 'persisted') {
            const persisted = await readPersistedSanitizedQuery(queryId);
            if (persisted) {
              const info = {
                ...persisted,
                modelMatch: findModelForSql(
                  persisted.query,
                  this.coder.dbt.models,
                ),
                loadedFrom: 'persisted' as const,
                jsonPath: diagnosticsPath,
                // The raw coordinator snapshot is written alongside the
                // sanitized JSON by `sanitizeAndPersist`. Surface its
                // path only when the file actually exists on disk —
                // older diagnostics created before the full snapshot
                // was added (or hand-edited setups) may not have one.
                fullJsonPath: fs.existsSync(fullDiagnosticsPath)
                  ? fullDiagnosticsPath
                  : undefined,
              };
              return apiResponse<typeof payload.type>(info);
            }
            // No local copy yet — fall through to a REST fetch and
            // persist the sanitized result so the next click is free.
          }

          // Fetch the raw QueryInfo so we can both sanitize-and-persist
          // (filling the local diagnostics cache so the next click on
          // this same queryId is free) and return a clean shaped form
          // to the UI in one round-trip.
          const rawQueryInfo =
            await this.getRestClient().getRawQueryInfo(queryId);
          // Persistence is best-effort. If the firewall rejects the
          // payload or disk is unwritable, the user still gets the
          // detail pane (just no on-disk cache for next time).
          const persisted = await sanitizeAndPersist(rawQueryInfo, {
            source: this.activeProfileSource(),
          }).catch((err: unknown) => {
            this.coder.log.warn(
              `Failed to persist sanitized QueryInfo for ${queryId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return null;
          });
          const info = persisted
            ? { ...persisted.sanitized }
            : shapeQueryInfo(rawQueryInfo);
          info.modelMatch = findModelForSql(info.query, this.coder.dbt.models);
          info.loadedFrom = 'rest';
          if (persisted) {
            info.jsonPath = persisted.jsonPath;
            if (fs.existsSync(persisted.fullJsonPath)) {
              info.fullJsonPath = persisted.fullJsonPath;
            }
          }
          // Stamp the active profile onto the response too. For
          // persisted-then-refreshed snapshots the sanitized JSON
          // already carries these (sanitizeAndPersist copies them in)
          // but the persisted-first path below also wants them, so we
          // set them unconditionally from the active profile here.
          const profileSource = this.activeProfileSource();
          if (profileSource) {
            info.profileName = profileSource.profileName;
            info.coordinatorUrl = profileSource.coordinatorUrl;
          }
          return apiResponse<typeof payload.type>(info);
        }
        case 'trino-fetch-active-queries': {
          const summaries = await this.fetchActiveQueries(
            payload.request.filter,
          );
          return apiResponse<typeof payload.type>(summaries);
        }
        case 'trino-fetch-persisted-queries': {
          const retentionDays = vscode.workspace
            .getConfiguration()
            .get<number>('dj.trino.diagnosticsRetentionDays', 30);
          // Opportunistic cleanup so .dj/diagnostics/ doesn't grow forever.
          void reapOldDiagnostics(retentionDays).catch(() => undefined);
          const persisted = await listPersistedQueries();
          return apiResponse<typeof payload.type>(persisted);
        }
        case 'trino-delete-persisted-query': {
          const queryId = payload.request.queryId;
          const dir = path.join(WORKSPACE_ROOT, '.dj', 'diagnostics');
          const targets = [
            path.join(dir, `${queryId}.json`),
            path.join(dir, `${queryId}.full.json`),
          ];
          let deleted = false;
          for (const target of targets) {
            try {
              await fs.promises.unlink(target);
              deleted = true;
            } catch (err) {
              // ENOENT just means the file was already gone — fine.
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
              }
            }
          }
          return apiResponse<typeof payload.type>({ queryId, deleted });
        }
        case 'trino-analyze-query': {
          const result = await this.analyzeQuery(payload.request.queryId);
          return apiResponse<typeof payload.type>(result);
        }
        case 'trino-list-profiles': {
          const profiles = listProfiles();
          const active = getActiveProfile()?.name ?? null;
          return apiResponse<typeof payload.type>({ profiles, active });
        }
        case 'trino-save-profile': {
          await upsertProfile(
            this.coder.context,
            payload.request.profile,
            payload.request.previousName,
          );
          this.invalidateRestClient();
          return apiResponse<typeof payload.type>({ ok: true });
        }
        case 'trino-delete-profile': {
          await deleteProfile(this.coder.context, payload.request.name);
          this.invalidateRestClient();
          return apiResponse<typeof payload.type>({ ok: true });
        }
        case 'trino-set-active-profile': {
          await setActiveProfile(payload.request.name);
          this.invalidateRestClient();
          return apiResponse<typeof payload.type>({ ok: true });
        }
        case 'trino-set-credentials': {
          await storeSecret(
            this.coder.context,
            payload.request.profile,
            payload.request.kind,
            payload.request.secret,
          );
          this.invalidateRestClient();
          return apiResponse<typeof payload.type>({ ok: true });
        }
        case 'trino-ping-coordinator': {
          const profile = payload.request.profile
            ? getProfileByName(payload.request.profile)
            : getActiveProfile();
          if (!profile) {
            return apiResponse<typeof payload.type>({
              ok: false,
              error: 'No Trino profile configured.',
            });
          }
          const client = new TrinoRestClient(
            this.coder.context,
            profile,
            this.coder.log,
          );
          const ping = await client.pingCoordinator();
          return apiResponse<typeof payload.type>(ping);
        }
        case 'trino-jump-to-model-from-query': {
          const match = await this.jumpToModelFromQuery(
            payload.request.queryId,
          );
          return apiResponse<typeof payload.type>(
            match ? { matched: true, modelMatch: match } : { matched: false },
          );
        }
        default:
          return assertExhaustive<ApiResponse>(payload);
      }
    };

    this.viewQueryEngine = new TreeDataInstance([
      { label: 'Extension loading...' },
    ]);
  }

  activate(context: vscode.ExtensionContext): void {
    // Don't await this so we don't block the extension from loading
    // Failures will be caught in handleSystemInfo
    void this.handleSystemInfo();

    // Register commands
    this.registerCommands(context);
  }

  /**
   * Register Trino-specific commands: Query Control Center, profile + credential
   * management, Analyze, Jump-to-Model, Test Trino Connection.
   * @param context
   */
  registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        COMMAND_ID.QUERY_CONTROL_CENTER,
        (arg?: { queryId?: string } | string) =>
          this.openQueryControlCenter(context, arg),
      ),

      vscode.commands.registerCommand(
        COMMAND_ID.ANALYZE_QUERY,
        async (arg?: { queryId?: string } | string) => {
          const queryId = await this.resolveQueryId(arg);
          if (!queryId) {
            return;
          }
          try {
            const result = await this.analyzeQuery(queryId);
            const action = await vscode.window.showInformationMessage(
              `Trino query ${queryId} sanitized to ${vscode.workspace.asRelativePath(result.jsonPath)}. ` +
                `Open it in your AI agent with the dj-trino-analyzer skill loaded.`,
              'Open JSON',
              'Copy Prompt',
            );
            if (action === 'Open JSON') {
              await vscode.window.showTextDocument(
                vscode.Uri.file(result.jsonPath),
              );
            } else if (action === 'Copy Prompt') {
              await vscode.env.clipboard.writeText(result.promptSnippet);
              vscode.window.showInformationMessage(
                'Analysis prompt copied to clipboard.',
              );
            }
          } catch (err: unknown) {
            vscode.window.showErrorMessage(
              `Failed to analyze query: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      ),

      vscode.commands.registerCommand(
        COMMAND_ID.SET_TRINO_CREDENTIALS,
        async () => this.setTrinoCredentialsQuickPick(),
      ),

      vscode.commands.registerCommand(
        COMMAND_ID.SELECT_TRINO_PROFILE,
        async () => this.selectTrinoProfileQuickPick(),
      ),

      vscode.commands.registerCommand(
        COMMAND_ID.JUMP_TO_MODEL_FROM_QUERY,
        async (arg?: { queryId?: string } | string) => {
          const queryId = await this.resolveQueryId(arg);
          if (!queryId) {
            return;
          }
          const match = await this.jumpToModelFromQuery(queryId);
          if (!match) {
            vscode.window.showInformationMessage(
              `No DJ model match found for query ${queryId}.`,
            );
            return;
          }
          if (match.modelJsonPath) {
            await vscode.window.showTextDocument(
              vscode.Uri.file(match.modelJsonPath),
            );
          } else {
            vscode.window.showInformationMessage(
              `Matched ${match.project}:${match.modelName} but .model.json file not found.`,
            );
          }
        },
      ),

      vscode.commands.registerCommand(
        COMMAND_ID.TEST_TRINO_CONNECTION,
        async () => {
          try {
            this.coder.log.info('Testing Trino connection...');

            const trinoConfig = getTrinoConfig();
            this.coder.log.info('Trino configuration:', trinoConfig);

            const result = await this.coder.trino.handleQuery(
              'SELECT 1 as test',
              {
                raw: true,
              },
            );

            vscode.window.showInformationMessage(
              `✅ Trino connection successful! Using: ${trinoConfig.path}`,
            );
            this.coder.log.info('Trino connection test result:', result);
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              `❌ Trino connection failed: ${errorMessage}`,
            );
            this.coder.log.error('Trino connection test failed:', error);
          }
        },
      ),
    );
  }

  /**
   * Execute Trino query with file or direct execution
   */
  handleQuery(
    sql: string,
    options?: {
      raw?: false;
      filename?:
        | TrinoApi['type']
        | 'data-explorer-query.sql'
        | 'trino-fetch-active-queries-cli'
        | 'trino-fetch-query-sql-cli';
    },
  ): Promise<Record<string, any>[]>;
  handleQuery(
    sql: string,
    options?: {
      raw: true;
      filename?:
        | TrinoApi['type']
        | 'data-explorer-query.sql'
        | 'trino-fetch-active-queries-cli'
        | 'trino-fetch-query-sql-cli';
    },
  ): Promise<string>;
  async handleQuery(
    sql: string,
    options?: {
      raw?: boolean;
      filename?:
        | TrinoApi['type']
        | 'data-explorer-query.sql'
        | 'trino-fetch-active-queries-cli'
        | 'trino-fetch-query-sql-cli';
    },
  ): Promise<Record<string, any>[] | string> {
    const { path: trinoCommand } = getTrinoConfig();
    const { filename } = options ?? {};

    // Log SQL for debugging
    this.coder.log.info(`[Trino] SQL: ${sql}`);

    let command = trinoCommand;
    if (filename) {
      // Use file-based execution when filename is specified
      const filepath = djSqlPath({ name: filename });
      // Ensure SQL ends with semicolon for file-based execution
      const sqlWithSemicolon = sql.trim().endsWith(';')
        ? sql
        : `${sql.trim()};`;
      djSqlWrite({ name: filename, sql: sqlWithSemicolon });
      command += ` --file '${filepath}'`;
      this.coder.log.info(`[Trino] Using --file: ${filepath}`);
    } else {
      // Use --execute for direct queries (single quotes preserve double quotes in SQL)
      command += ` --execute '${sql}'`;
      this.coder.log.info(`[Trino] Using --execute`);
    }

    if (!options?.raw) {
      // Use CSV_HEADER format instead of JSON to properly handle complex types (arrays, maps, structs)
      // The Trino CLI's JSON format has a known limitation where it cannot serialize
      // java.util.Collections$UnmodifiableList (arrays) without a proper ObjectCodec
      command += ` --output-format=CSV_HEADER`;
    }

    this.coder.log.info(`[Trino] Command: ${command}`);

    try {
      const result = await this.executeTrinoCommand(command);

      if (options?.raw) {
        return result;
      }

      return this.parseCsvOutput(result);
    } catch (error: unknown) {
      this.coder.log.error('Trino query failed:', error);

      // Check for command not found error
      const errorString = String(error);
      if (errorString.includes('command not found')) {
        if (trinoCommand) {
          throw new Error(
            `Trino CLI (trino-cli) not found at configured path: ${trinoCommand}. Please verify the path is correct and the file is executable. You can update this in VS Code Settings under "DJ > Trino Path".`,
          );
        } else {
          throw new Error(
            `Trino CLI (trino-cli) not found in PATH. Please configure the full path to your Trino executable in VS Code Settings under "DJ > Trino Path" (e.g., /usr/local/bin).`,
          );
        }
      }

      // Parse and format Trino error for better readability
      const trinoError = this.parseTrinoError(error);
      throw new Error(trinoError);
    }
  }

  /**
   * Execute Trino command with proper environment setup (venv support)
   */
  private executeTrinoCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = buildProcessEnv();

      const childProcess = spawn(command, {
        cwd: WORKSPACE_ROOT,
        env,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Parse CSV output from Trino CLI into an array of objects.
   *
   * Per RFC 4180, newlines inside quoted cells belong to the cell, not
   * the row separator. The previous implementation split on `\n` before
   * checking quote state, which broke any column containing multi-line
   * text — in particular the `query` column of `system.runtime.queries`,
   * whose SQL bodies turned each newline into a fake row. This walks
   * the buffer character-by-character and only emits a row when a
   * newline is reached while OUTSIDE a quoted cell.
   */
  private parseCsvOutput(csvData: string): Record<string, any>[] {
    const records = this.splitCsvRecords(csvData);
    if (records.length === 0) {
      return [];
    }

    const headers = this.parseCsvLine(records[0]);
    const results: Record<string, any>[] = [];
    for (let i = 1; i < records.length; i++) {
      const values = this.parseCsvLine(records[i]);
      const row: Record<string, any> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = this.parseTrinoValue(values[j]);
      }
      results.push(row);
    }
    return results;
  }

  /**
   * Split CSV text into records, respecting quoted multi-line cells.
   * A record boundary is a `\n` (or `\r\n`) seen while not in a quoted
   * cell. Doubled quotes (`""`) inside a quoted cell are literal and
   * don't toggle the quote state.
   */
  private splitCsvRecords(csvData: string): string[] {
    const records: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < csvData.length; i++) {
      const ch = csvData[i];
      if (ch === '"') {
        if (inQuotes && csvData[i + 1] === '"') {
          current += '""';
          i += 1;
        } else {
          inQuotes = !inQuotes;
          current += ch;
        }
        continue;
      }
      if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && csvData[i + 1] === '\n') {
          i += 1;
        }
        if (current.length > 0) {
          records.push(current);
        }
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.length > 0) {
      records.push(current);
    }
    return records;
  }

  /**
   * Parse a single CSV line, handling quoted fields and embedded commas
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
      i++;
    }

    // Add the last field
    result.push(current);

    return result;
  }

  /**
   * Parse a Trino value from CSV string representation
   * Handles arrays, maps, structs, nulls, and primitive types
   */
  private parseTrinoValue(value: string | undefined): any {
    if (value === undefined || value === '' || value === 'NULL') {
      return null;
    }

    const trimmed = value.trim();

    // Handle NULL values
    if (trimmed.toUpperCase() === 'NULL') {
      return null;
    }

    // Try to parse as JSON for arrays and maps
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        // First try standard JSON parsing
        return JSON.parse(trimmed);
      } catch {
        // Trino may output maps/structs with = instead of : (e.g., {key=value})
        // Try to convert Trino format to JSON format
        try {
          const jsonified = this.trinoToJson(trimmed);
          return JSON.parse(jsonified);
        } catch {
          // If all parsing fails, return as string (the frontend can still display it)
          return trimmed;
        }
      }
    }

    // Try to parse as number
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = parseFloat(trimmed);
      if (!isNaN(num)) {
        return num;
      }
    }

    // Try to parse as boolean
    if (trimmed.toLowerCase() === 'true') {
      return true;
    }
    if (trimmed.toLowerCase() === 'false') {
      return false;
    }

    // Return as string
    return trimmed;
  }

  /**
   * Convert Trino's map/struct format to JSON format
   * Trino outputs maps as {key=value, key2=value2} instead of JSON's {"key": "value"}
   */
  private trinoToJson(trinoStr: string): string {
    // This is a best-effort conversion for simple cases
    // For complex nested structures, it may not work perfectly
    let result = trinoStr;

    // Replace = with : for key-value pairs, but be careful with values containing =
    // Match pattern: word= or "word"= at the start of a key-value pair
    result = result.replace(/(\{|, )([a-zA-Z_][a-zA-Z0-9_]*)=/g, '$1"$2":');

    // Handle unquoted string values (simple alphanumeric values)
    // This is tricky because we don't want to double-quote already quoted strings or numbers
    result = result.replace(/:([a-zA-Z][a-zA-Z0-9_]*)(,|})/g, ':"$1"$2');

    return result;
  }

  /**
   * Parse Trino CLI error messages to extract meaningful information
   */
  private parseTrinoError(error: unknown): string {
    const errorStr = error instanceof Error ? error.message : String(error);

    // Remove ANSI color codes
    const cleaned = errorStr.replace(/\x1b\[[0-9;]*m/g, '');

    // Extract meaningful error lines
    const lines = cleaned
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.includes('Error running command'))
      .filter((line) => !line.startsWith('at ')) // Remove stack traces
      .filter((line) => !line.includes('node:internal')); // Remove Node.js internals

    // Return formatted error or original if parsing fails
    return lines.length > 0 ? lines.join('\n') : errorStr;
  }

  async handleSystemInfo() {
    try {
      this.systemNodes = await this.coder.api.handleApi({
        type: 'trino-fetch-system-nodes',
        request: null,
      });

      const queryNodes = this.systemNodes?.filter((n) => !n.coordinator) ?? [];
      // Sidebar layout: Trino (placeholder) → Nodes (at-a-glance
      // coordinator/worker status) → Query Control Center (shortcut
      // into the webview where per-query browsing lives, under its
      // Live and History tabs).
      this.viewQueryEngine.setData([
        { label: 'Trino' },
        {
          label: 'Nodes',
          description: String(queryNodes.length),
          children:
            queryNodes.map((n) => ({
              label: n.node_id,
              iconPath:
                n.state === 'active'
                  ? new vscode.ThemeIcon('pass-filled')
                  : new vscode.ThemeIcon('error'),
            })) ?? [],
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        },
        {
          label: 'Query Control Center',
          iconPath: new vscode.ThemeIcon('dashboard'),
          command: {
            title: 'Open Query Control Center',
            command: COMMAND_ID.QUERY_CONTROL_CENTER,
            arguments: [],
          },
        },
      ]);
    } catch (err: unknown) {
      this.coder.log.error('Error fetching query engine info', err);
    }
    this.timeoutSystemInfo = setTimeout(
      () => void this.handleSystemInfo(),
      POLLING_INTERVAL_SYSTEM_INFO,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Query Control Center + REST API helpers
  // ────────────────────────────────────────────────────────────────────

  /**
   * Open (or refocus) the singleton Query Control Center webview panel.
   * When `arg.queryId` is supplied the master pane preselects that query.
   */
  private openQueryControlCenter(
    context: vscode.ExtensionContext,
    arg?: { queryId?: string } | string,
  ): void {
    const queryId = typeof arg === 'string' ? arg : arg?.queryId ?? undefined;

    if (this.queryControlCenterPanel) {
      this.queryControlCenterPanel.reveal(vscode.ViewColumn.Active);
      if (queryId) {
        this.queryControlCenterPanel.webview.postMessage({
          type: 'query-control-center-select',
          queryId,
        });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dj_query_control_center',
      'DJ: Query Control Center',
      vscode.ViewColumn.Active,
      {
        enableFindWidget: true,
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.queryControlCenterPanel = panel;
    panel.iconPath = new vscode.ThemeIcon('dashboard');

    panel.webview.html = getHtml({
      extensionUri: context.extensionUri,
      route: queryId
        ? `/query/control-center?queryId=${encodeURIComponent(queryId)}`
        : '/query/control-center',
      webview: panel.webview,
    });

    panel.webview.onDidReceiveMessage(async (message: ApiMessage) =>
      this.coder.handleWebviewMessage({
        message,
        webview: panel.webview,
      }),
    );

    panel.onDidDispose(() => {
      this.queryControlCenterPanel = undefined;
    });
  }

  /**
   * Lazily build a REST client for the currently-active profile. The
   * client is cached on the service so we don't re-resolve the profile on
   * every request. `invalidateRestClient()` clears the cache when the
   * profile or its credentials change.
   */
  getRestClient(): TrinoRestClient {
    const profile = getActiveProfile();
    if (!profile) {
      throw new TrinoCoordinatorError(
        'No Trino profile configured. Add one in Settings under `dj.trino.profiles` or open the Query Control Center → "Edit connections…".',
        'PROFILE_ERROR',
      );
    }
    if (this.restClient?.profileName !== profile.name) {
      this.restClient = {
        client: new TrinoRestClient(
          this.coder.context,
          profile,
          this.coder.log,
        ),
        profileName: profile.name,
      };
    }
    return this.restClient.client;
  }

  private invalidateRestClient(): void {
    this.restClient = undefined;
  }

  /**
   * Snapshot of the currently-active profile, shaped for
   * `sanitizeAndPersist`'s `source` option. Returns `undefined` when
   * no profile is active or when the caller doesn't need to stamp a
   * profile onto the diagnostic (e.g. the CLI listing path, which
   * never persists).
   */
  private activeProfileSource():
    | { profileName: string; coordinatorUrl: string }
    | undefined {
    const profile = getActiveProfile();
    if (!profile) {
      return undefined;
    }
    return {
      profileName: profile.name,
      coordinatorUrl: profile.coordinatorUrl,
    };
  }

  /**
   * Resolve the active list of queries for the Query Control Center's
   * Live tab. The decision is **deterministic on the active profile**,
   * not on "did REST happen to work":
   *
   *   - Profile active → REST `/v1/query` against THAT coordinator,
   *     so the rows always match the coordinator the rest of the panel
   *     (status pill, per-query JSON, Analyze-with-AI) is talking to.
   *     Intentionally NO silent CLI fallback: silently swapping the
   *     user's view from prod → dev rows on a transient REST blip
   *     would break coordinator identity. REST errors are re-thrown
   *     so the webview shows a clean error banner instead.
   *   - No profile → Trino CLI's `system.runtime.queries`. Works
   *     without any setup, mirroring the old "My Queries" sidebar.
   *
   * The envelope carries `source` + `profileName` so the UI can render
   * a "Listing from: …" subtitle and the user never has to guess which
   * coordinator they're looking at. The "My dbt runs only" filter is
   * also applied server-side here for parity with the webview chip.
   */
  async fetchActiveQueries(
    filter?: 'all' | 'dbt-trino-only',
  ): Promise<TrinoActiveQueriesResponse> {
    const profile = getActiveProfile();
    // The QCC's own listing queries always touch `system.runtime.queries`
    // (CLI path) — and analogous REST calls — and would otherwise
    // dominate every poll. Filter them out so the Live tab shows real
    // user work, not the panel watching itself.
    const isSelfQuery = (q: TrinoQuerySummary): boolean =>
      typeof q.query === 'string' &&
      /\bsystem\.runtime\.queries\b/i.test(q.query);
    const applyFilters = (rows: TrinoQuerySummary[]): TrinoQuerySummary[] => {
      const dropSelf = rows.filter((q) => !isSelfQuery(q));
      return filter === 'dbt-trino-only'
        ? dropSelf.filter((q) => (q.source ?? '').startsWith('dbt-trino-'))
        : dropSelf;
    };

    if (profile) {
      const rows = await this.getRestClient().listActiveQueries();
      return {
        source: 'rest',
        profileName: profile.name,
        rows: applyFilters(rows),
      };
    }

    return {
      source: 'cli',
      profileName: null,
      rows: applyFilters(await this.fetchActiveQueriesViaCli()),
    };
  }

  private async fetchActiveQueriesViaCli(): Promise<TrinoQuerySummary[]> {
    // `system.runtime.queries` columns are stable across Trino versions:
    //   query_id, state, user, source, query, resource_group_id,
    //   queued, analysis_time, planning_time, created, started,
    //   last_heartbeat, end, error_type, error_code.
    // `catalog` / `schema` are NOT exposed here (they're session-scoped,
    // not query-scoped); selecting them errors out with "Column
    // 'catalog' cannot be resolved" on most coordinators. They only
    // arrive on the REST path via `session.catalog` / `session.schema`.
    const sql = `
select
  "created",
  "end",
  "query_id",
  "source",
  "started",
  "state",
  "user",
  "query"
from
  system.runtime.queries
order by created desc
limit 200;`;
    let rows: Record<string, any>[];
    try {
      rows = await this.handleQuery(sql, {
        filename: 'trino-fetch-active-queries-cli',
      });
    } catch (err: unknown) {
      // Re-throw rather than swallowing into []: a silent empty list
      // under the "Listing from: local Trino CLI" subtitle is
      // indistinguishable from a true empty result, hiding genuine
      // SQL/CLI failures behind the generic retention empty-state.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Trino CLI listing failed (system.runtime.queries): ${message}`,
      );
    }
    return rows.map((r) =>
      shapeQuerySummary({
        queryId: r['query_id'],
        state: r['state'],
        query: r['query'],
        session: {
          user: r['user'],
          source: r['source'],
        },
        queryStats: {
          createTime: r['created'],
          executionStartTime: r['started'],
          endTime: r['end'],
        },
      }),
    );
  }

  /**
   * Look up the originating DJ model and emit the analyzer prompt for
   * the sanitized JSON.
   *
   * Persisted-first: if `<queryId>.json` already exists under
   * `.dj/diagnostics/` (true for any query the user has analyzed or
   * loaded full details on), reuse it and skip REST entirely. This is
   * what lets the History tab analyze queries the coordinator no
   * longer retains (otherwise HTTP 410 territory).
   *
   * Only when nothing is on disk do we hit REST to fetch + sanitize +
   * persist a fresh copy — the live / fresh-query path.
   */
  async analyzeQuery(queryId: string) {
    const diagnosticsDir = path.join(WORKSPACE_ROOT, '.dj', 'diagnostics');
    const jsonPath = path.join(diagnosticsDir, `${queryId}.json`);
    const fullJsonPath = path.join(diagnosticsDir, `${queryId}.full.json`);

    const persisted = await readPersistedSanitizedQuery(queryId);
    let querySql: string;
    if (persisted) {
      querySql = persisted.query ?? '';
    } else {
      const client = this.getRestClient();
      const raw = await client.getRawQueryInfo(queryId);
      const result = await sanitizeAndPersist(raw, {
        source: this.activeProfileSource(),
      });
      querySql = result.sanitized.query ?? '';
    }

    const match = findModelForSql(querySql, this.coder.framework.dbt.models);
    const promptSnippet = `Use the dj-trino-analyzer skill to analyze .dj/diagnostics/${queryId}.json (Trino QueryInfo for ${match ? `${match.project}:${match.modelName}` : 'an unknown DJ model'}). Start with the summary, then explain the slowest operator and recommend changes.`;

    return {
      queryId,
      jsonPath,
      fullJsonPath,
      modelMatch: match,
      promptSnippet,
    };
  }

  async jumpToModelFromQuery(queryId: string) {
    // Prefer a persisted sanitized copy (no network round-trip). Fall
    // back to a fresh REST fetch when nothing's persisted yet.
    const persisted = await listPersistedQueries();
    let sql = persisted.find((p) => p.queryId === queryId)?.summary.query;
    if (!sql) {
      try {
        const info = await this.getRestClient().getQueryInfo(queryId);
        sql = info.query;
      } catch (err: unknown) {
        this.coder.log.warn('jumpToModelFromQuery: REST fetch failed:', err);
      }
    }
    if (!sql) {
      // Final fallback: query the system table directly.
      try {
        const querySql = await this.handleQuery(
          `select "query" from system.runtime.queries where query_id = '${queryId}';`,
          { raw: true, filename: 'trino-fetch-query-sql-cli' },
        );
        sql = querySql;
      } catch {
        return null;
      }
    }
    if (!sql) {
      return null;
    }
    return findModelForSql(sql, this.coder.framework.dbt.models);
  }

  private async resolveQueryId(
    arg?: { queryId?: string } | string,
  ): Promise<string | undefined> {
    if (typeof arg === 'string') {
      return arg;
    }
    if (arg?.queryId) {
      return arg.queryId;
    }
    const entered = await vscode.window.showInputBox({
      title: 'Trino Query ID',
      prompt: 'Enter the Trino query ID (e.g. 20250101_120000_00001_abcde)',
      validateInput: (v) =>
        v?.trim() ? undefined : 'Query ID cannot be empty',
    });
    return entered?.trim() || undefined;
  }

  private async setTrinoCredentialsQuickPick(): Promise<void> {
    const profiles = listProfiles();
    if (profiles.length === 0) {
      const action = await vscode.window.showInformationMessage(
        'No Trino profiles configured yet. Add one in Settings (`dj.trino.profiles`) or open Query Control Center → "Edit connections…".',
        'Open Settings',
      );
      if (action === 'Open Settings') {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'dj.trino.profiles',
        );
      }
      return;
    }
    const profileChoice = await vscode.window.showQuickPick(
      profiles.map((p) => ({
        label: p.name,
        description: `${p.coordinatorUrl} (authSource: ${p.authSource})`,
        profile: p,
      })),
      { title: 'Select a Trino profile' },
    );
    if (!profileChoice) {
      return;
    }

    const profile: TrinoProfile = profileChoice.profile;
    if (profile.authSource !== 'secret-storage') {
      vscode.window.showInformationMessage(
        `Profile "${profile.name}" uses authSource "${profile.authSource}" — nothing to store in SecretStorage. ` +
          (profile.authSource === 'env-var'
            ? `The secret is read at request time from env var "${profile.secretEnvVar}".`
            : profile.authSource === 'password-file'
              ? `The secret is read at request time from file "${profile.passwordFilePath}".`
              : `The secret is read from ~/.dbt/profiles.yml (${profile.dbtProfile}.${profile.dbtTarget ?? 'default'}).`),
      );
      return;
    }
    const kind = profile.authMethod === 'bearer' ? 'bearerToken' : 'password';
    const secret = await vscode.window.showInputBox({
      title: `Enter ${kind} for profile "${profile.name}"`,
      password: true,
      placeHolder:
        'Stored securely in the OS keychain via VS Code SecretStorage.',
      ignoreFocusOut: true,
    });
    if (!secret) {
      return;
    }
    await storeSecret(this.coder.context, profile.name, kind, secret);
    this.invalidateRestClient();
    vscode.window.showInformationMessage(
      `Stored ${kind} for profile "${profile.name}".`,
    );
  }

  private async selectTrinoProfileQuickPick(): Promise<void> {
    const profiles = listProfiles();
    if (profiles.length === 0) {
      vscode.window.showInformationMessage(
        'No Trino profiles configured. Add one in Settings (`dj.trino.profiles`).',
      );
      return;
    }
    const active = getActiveProfile()?.name;
    const pick = await vscode.window.showQuickPick(
      profiles.map((p) => ({
        label: p.name === active ? `$(check) ${p.name}` : `      ${p.name}`,
        description: p.coordinatorUrl,
        name: p.name,
      })),
      { title: 'Select active Trino connection profile' },
    );
    if (!pick) {
      return;
    }
    await setActiveProfile(pick.name);
    this.invalidateRestClient();
    vscode.window.showInformationMessage(
      `Active Trino profile set to "${pick.name}".`,
    );
  }

  deactivate() {
    if (this.timeoutSystemInfo) {
      clearTimeout(this.timeoutSystemInfo);
    }
    this.queryControlCenterPanel?.dispose();
  }
}
