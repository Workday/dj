import type { Coder } from '@services/coder';
import type { ApiEnabledService } from '@services/types';
import type { ApiPayload, ApiResponse } from '@shared/api/types';
import type * as vscode from 'vscode';

/**
 * Query Preview service
 * No longer manages its own webview -- delegates to Data Explorer
 */
export class QueryPreview implements ApiEnabledService<'query-draft'> {
  private readonly coder: Coder;

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;
  }

  activate(_context: vscode.ExtensionContext): void {
    this.coder.log.info('QueryPreview service activated');
  }

  readonly handleApi = async (
    payload: ApiPayload<'query-draft'>,
  ): Promise<ApiResponse> => {
    return this.coder.queryDraft.handleApi(payload);
  };

  public sendMessage(message: any): void {
    this.coder.dataExplorer.sendMessage(message);
  }

  public focusView(): void {
    this.coder.dataExplorer.focusView();
  }
}
