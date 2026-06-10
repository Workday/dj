import type { Coder } from '@services/coder';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import { apiResponse } from '@shared/api/utils';
import { WORKSPACE_ROOT } from 'admin';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const DJ_DRAFTS_PATH = path.join(WORKSPACE_ROOT, '.dj/drafts');

interface QueryResult {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  rowCount: number;
}

export class QueryDraftService {
  private readonly coder: Coder;

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;
  }

  /**
   * Handle API requests for query drafts
   */
  readonly handleApi = async (
    payload: ApiPayload<'query-draft'>,
  ): Promise<ApiResponse> => {
    switch (payload.type) {
      case 'query-draft-create': {
        try {
          const filepath = await this.createDraft(payload.request.projectName);
          return apiResponse<typeof payload.type>({ filepath });
        } catch (error: unknown) {
          this.coder.log.error('Error creating query draft:', error);
          throw error;
        }
      }

      case 'query-draft-execute': {
        try {
          let { sql } = payload.request;
          const { limit = 100 } = payload.request;

          // If SQL is empty, read from active editor
          if (!sql || sql.trim() === '') {
            const content = await this.getCurrentDraftContent();
            if (!content) {
              throw new Error(
                'No SQL content found. Please open a .draft.sql file.',
              );
            }
            sql = content;
          }

          const startTime = Date.now();
          const result = await this.executeQuery(sql, limit);
          const executionTime = Date.now() - startTime;
          return apiResponse<typeof payload.type>({
            ...result,
            executionTime,
          });
        } catch (error: unknown) {
          this.coder.log.error('Error executing query draft:', error);
          throw error;
        }
      }

      default:
        throw new Error(
          `Unknown query-draft API type: ${(payload as { type: string }).type}`,
        );
    }
  };

  /**
   * Create a new query draft file
   */
  async createDraft(projectName?: string): Promise<string> {
    const filename = `${Date.now()}.draft.sql`;
    const filepath = path.join(DJ_DRAFTS_PATH, filename);

    // Ensure the drafts directory exists
    if (!fs.existsSync(DJ_DRAFTS_PATH)) {
      fs.mkdirSync(DJ_DRAFTS_PATH, { recursive: true });
    }

    const template = `-- Query Draft
-- Write your SQL query here and run it in the Query Preview panel
-- This file is stored in .dj/drafts/

SELECT 1
`;

    fs.writeFileSync(filepath, template, 'utf8');

    // Open the file in the editor
    const uri = vscode.Uri.file(filepath);
    await vscode.window.showTextDocument(uri);

    this.coder.log.info(`Created query draft: ${filepath}`);
    return filepath;
  }

  /**
   * Execute a query directly against Trino
   */
  async executeQuery(sql: string, limit: number): Promise<QueryResult> {
    this.coder.log.info(`[QueryDraft] Executing query with limit ${limit}`);

    // Add LIMIT clause if not present
    const sqlLower = sql.toLowerCase().trim();
    let finalSql = sql;
    if (!sqlLower.includes('limit')) {
      finalSql = `${sql.trim().replace(/;$/, '')} LIMIT ${limit}`;
    }

    try {
      const results = await this.coder.trino.handleQuery(finalSql, {
        filename: 'query-draft.sql' as any,
      });

      // Convert results to column/row format
      if (results.length === 0) {
        return { columns: [], rows: [], rowCount: 0 };
      }

      const columns = Object.keys(results[0]);
      const rows = results.map((row) =>
        columns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) {
            return null;
          }
          if (typeof val === 'object') {
            return JSON.stringify(val);
          }
          return val;
        }),
      );

      return {
        columns,
        rows: rows as (string | number | boolean | null)[][],
        rowCount: rows.length,
      };
    } catch (error: unknown) {
      this.coder.log.error('[QueryDraft] Query execution failed:', error);
      throw error;
    }
  }

  /**
   * Get content of the current draft file from the active editor
   */
  async getCurrentDraftContent(): Promise<string | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const filePath = editor.document.uri.fsPath;
    // Support .draft.sql files in the .dj/drafts/ folder
    if (!filePath.endsWith('.draft.sql')) {
      return null;
    }

    return editor.document.getText();
  }

  /**
   * Open the most recent .draft.sql file in the editor.
   * If a draft is already open in the active editor, focus it instead.
   */
  async openLatestDraft(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.fsPath.endsWith('.draft.sql')) {
      await vscode.window.showTextDocument(editor.document);
      return;
    }

    if (!fs.existsSync(DJ_DRAFTS_PATH)) {
      vscode.window.showWarningMessage(
        'No query drafts found. Create one first.',
      );
      return;
    }

    const files = fs
      .readdirSync(DJ_DRAFTS_PATH)
      .filter((f) => f.endsWith('.draft.sql'))
      .sort()
      .reverse();

    if (files.length === 0) {
      vscode.window.showWarningMessage(
        'No query drafts found. Create one first.',
      );
      return;
    }

    const latestFile = path.join(DJ_DRAFTS_PATH, files[0]);
    const uri = vscode.Uri.file(latestFile);
    await vscode.window.showTextDocument(uri);
  }

  /**
   * Detect available AI assistants and set VS Code context
   */
  async detectAiAssistants(): Promise<void> {
    const copilotAvailable =
      vscode.extensions.getExtension('GitHub.copilot-chat') !== undefined;
    const cursorAvailable = this.isCursorEnvironment();
    const claudeAvailable =
      vscode.extensions.getExtension('anthropics.claude-code') !== undefined;

    this.coder.log.info(
      `[QueryDraft] AI assistants detected - Copilot: ${copilotAvailable}, Cursor: ${cursorAvailable}, Claude: ${claudeAvailable}`,
    );

    await vscode.commands.executeCommand(
      'setContext',
      'dj.copilotAvailable',
      copilotAvailable,
    );
    await vscode.commands.executeCommand(
      'setContext',
      'dj.cursorAvailable',
      cursorAvailable,
    );
    await vscode.commands.executeCommand(
      'setContext',
      'dj.claudeAvailable',
      claudeAvailable,
    );
  }

  /**
   * Check if running in Cursor environment
   */
  private isCursorEnvironment(): boolean {
    return vscode.env.appName.toLowerCase().includes('cursor');
  }

  /**
   * Build the conversion prompt for AI assistants
   */
  buildConversionPrompt(sql: string): string {
    return `/convert-sql-to-model

## SQL Query
\`\`\`sql
${sql}
\`\`\`

Convert this SQL query into a DJ .model.json file.`;
  }

  /**
   * Run query from editor and show results in Query Results panel
   */
  async runQueryFromEditor(): Promise<void> {
    const sql = await this.getCurrentDraftContent();
    if (!sql) {
      vscode.window.showWarningMessage(
        'No query draft content found. Please open a .draft.sql file.',
      );
      return;
    }

    // Focus the Data Explorer panel and switch to adhoc query view
    await vscode.commands.executeCommand('dj.view.modelLineage.focus');
    this.coder.dataExplorer.sendMessage({ type: 'show-adhoc-query' });
    this.coder.dataExplorer.sendMessage({ type: 'query-executing' });

    try {
      const startTime = Date.now();
      const result = await this.executeQuery(sql, 500);
      const executionTime = Date.now() - startTime;

      this.coder.dataExplorer.sendMessage({
        type: 'query-results',
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        executionTime,
        modelName: 'Query Draft',
      });

      this.coder.log.info(
        `[QueryDraft] Query executed successfully: ${result.rowCount} rows in ${executionTime}ms`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to execute query';

      this.coder.dataExplorer.sendMessage({
        type: 'query-results',
        error: errorMessage,
      });

      this.coder.log.error('[QueryDraft] Query execution failed:', error);
    }
  }

  /**
   * Auto-detect available AI assistants and let user pick one, then convert
   */
  async convertDraftToModelAuto(): Promise<void> {
    const agents: { label: string; id: 'copilot' | 'cursor' | 'claude' }[] = [];

    if (this.isCursorEnvironment()) {
      agents.push({ label: 'Cursor', id: 'cursor' });
    }
    if (vscode.extensions.getExtension('GitHub.copilot-chat')) {
      agents.push({ label: 'GitHub Copilot', id: 'copilot' });
    }
    if (vscode.extensions.getExtension('anthropics.claude-code')) {
      agents.push({ label: 'Claude', id: 'claude' });
    }

    if (agents.length === 0) {
      vscode.window.showWarningMessage(
        'No AI assistants found. Install GitHub Copilot, Cursor, or Claude to use this feature.',
      );
      return;
    }

    if (agents.length === 1) {
      await this.convertDraftToModel(agents[0].id);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      agents.map((a) => a.label),
      { placeHolder: 'Select an AI assistant to convert SQL to DJ Model' },
    );
    if (!picked) {
      return;
    }

    const agent = agents.find((a) => a.label === picked);
    if (agent) {
      await this.convertDraftToModel(agent.id);
    }
  }

  /**
   * Open AI chat with conversion prompt
   */
  async convertDraftToModel(
    assistant: 'copilot' | 'cursor' | 'claude',
  ): Promise<void> {
    const sql = await this.getCurrentDraftContent();
    if (!sql) {
      vscode.window.showWarningMessage(
        'No query draft content found. Please open a .draft.sql file.',
      );
      return;
    }

    const prompt = this.buildConversionPrompt(sql);

    try {
      switch (assistant) {
        case 'copilot':
          await vscode.commands.executeCommand(
            'workbench.action.chat.open',
            prompt,
          );
          break;
        case 'cursor':
          await vscode.commands.executeCommand(
            'composer.startComposerPrompt',
            prompt,
          );
          break;
        case 'claude':
          await vscode.commands.executeCommand('claude.openChat', prompt);
          break;
      }
      this.coder.log.info(
        `[QueryDraft] Opened ${assistant} chat for conversion`,
      );
    } catch (error: unknown) {
      this.coder.log.error(
        `[QueryDraft] Failed to open ${assistant} chat:`,
        error,
      );
      vscode.window.showErrorMessage(
        `Failed to open ${assistant} chat. Please ensure the extension is installed.`,
      );
    }
  }
}
