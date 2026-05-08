import type { Coder } from '@services/coder';
import { VIEW_ID } from '@services/constants';
import type { ApiEnabledService } from '@services/types';
import { getHtml } from '@services/webview/utils';
import type { ApiMessage, ApiPayload, ApiResponse } from '@shared/api/types';
import * as vscode from 'vscode';

/**
 * WebviewViewProvider for Query Preview panel
 */
class QueryPreviewViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _isReady = false;
  private _messageQueue: any[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _coder: Coder,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._isReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = getHtml({
      extensionUri: this._extensionUri,
      route: '/query/preview',
      webview: webviewView.webview,
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: ApiMessage) => {
      try {
        // Handle webview-ready signal from React
        if ((message as any).type === 'webview-ready') {
          this._coder.log.info('Query Preview webview is ready');
          this._isReady = true;
          this._flushMessageQueue();
          return;
        }

        // Handle execute-command messages (same pattern as dataExplorer.ts)
        if ((message as any).type === 'execute-command') {
          const command = (message as any).command;
          this._coder.log.info('Executing command from webview:', command);
          await vscode.commands.executeCommand(command);
          return;
        }

        // Route API calls through the main API handler
        const response = await this._coder.api.handleApi(message as any);
        this._view?.webview.postMessage({
          _channelId: message._channelId,
          response,
        });
      } catch (error: unknown) {
        this._coder.log.error('Error handling Query Preview message:', error);
        this._view?.webview.postMessage({
          _channelId: message._channelId,
          error:
            error instanceof Error
              ? error.message
              : 'An unknown error occurred',
        });
      }
    });
  }

  private _flushMessageQueue(): void {
    if (!this._isReady || !this._view) {
      return;
    }

    while (this._messageQueue.length > 0) {
      const message = this._messageQueue.shift();
      this._view.webview.postMessage(message);
    }
  }

  public sendMessage(message: any): void {
    if (this._isReady && this._view) {
      this._view.webview.postMessage(message);
    } else {
      this._messageQueue.push(message);
    }
  }

  public focus(): void {
    this._view?.show(true);
  }
}

/**
 * Query Preview service for managing the Query Preview panel
 */
export class QueryPreview implements ApiEnabledService<'query-draft'> {
  private readonly coder: Coder;
  private viewProvider?: QueryPreviewViewProvider;

  constructor({ coder }: { coder: Coder }) {
    this.coder = coder;
  }

  /**
   * Activate the service (required by ApiEnabledService)
   */
  activate(_context: vscode.ExtensionContext): void {
    this.coder.log.info('QueryPreview service activated');
  }

  /**
   * Handle API requests - delegates to QueryDraftService
   */
  readonly handleApi = async (
    payload: ApiPayload<'query-draft'>,
  ): Promise<ApiResponse> => {
    return this.coder.queryDraft.handleApi(payload);
  };

  /**
   * Register the Query Preview webview provider
   */
  registerProviders(context: vscode.ExtensionContext): void {
    this.viewProvider = new QueryPreviewViewProvider(
      context.extensionUri,
      this.coder,
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        VIEW_ID.QUERY_PREVIEW,
        this.viewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );
    this.coder.log.info('QueryPreview provider registered');
  }

  /**
   * Send a message to the Query Preview webview
   */
  public sendMessage(message: any): void {
    this.viewProvider?.sendMessage(message);
  }

  /**
   * Focus the Query Preview panel
   */
  public focusView(): void {
    this.viewProvider?.focus();
  }
}
