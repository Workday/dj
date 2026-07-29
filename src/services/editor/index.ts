import type { Coder } from '@services/coder';
import { getHtml } from '@services/webview/utils';
import type { ApiMessage } from '@shared/api/types';
import type { DjEditorMessage } from '@shared/editor/types';
import * as vscode from 'vscode';

const VIEW_TYPE = 'dj.editor';

/**
 * CustomTextEditorProvider for .dj files.
 *
 * Renders a React-based visual editor in place of the default text editor when
 * a .dj file is opened. Backed by a TextDocument so undo/redo/save work natively.
 */
export class DjEditorProvider implements vscode.CustomTextEditorProvider {
  private coder: Coder;

  constructor(coder: Coder) {
    this.coder = coder;
  }

  static register(context: vscode.ExtensionContext, coder: Coder): void {
    const provider = new DjEditorProvider(coder);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.coder.context.extensionUri],
    };

    webviewPanel.webview.html = getHtml({
      extensionUri: this.coder.context.extensionUri,
      route: '/editor/dj',
      webview: webviewPanel.webview,
    });

    // Send document content to webview when it signals ready
    const onReady = (msg: DjEditorMessage) => {
      if (msg.type === 'dj-editor-ready') {
        webviewPanel.webview.postMessage({
          type: 'dj-editor-init',
          content: document.getText(),
          fileName: document.fileName,
        });
      }
    };

    // Handle messages from the webview
    const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
      async (msg: DjEditorMessage | ApiMessage) => {
        switch (msg.type) {
          case 'dj-editor-ready':
            onReady(msg as DjEditorMessage);
            return;

          case 'dj-editor-edit': {
            const editMsg = msg as DjEditorMessage & { type: 'dj-editor-edit' };
            await this.applyEdit(document, editMsg.content);
            return;
          }

          default:
            // Delegate to standard API handler for framework/dbt/trino messages
            if ('_channelId' in msg) {
              await this.coder.handleWebviewMessage({
                message: msg as ApiMessage,
                webview: webviewPanel.webview,
              });
            }
        }
      },
    );

    // Sync external document changes back to the webview
    const changeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        e.document.uri.toString() === document.uri.toString() &&
        e.contentChanges.length > 0
      ) {
        webviewPanel.webview.postMessage({
          type: 'dj-editor-update',
          content: document.getText(),
        });
      }
    });

    webviewPanel.onDidDispose(() => {
      messageDisposable.dispose();
      changeDisposable.dispose();
    });
  }

  /**
   * Apply a full-document edit from the webview. Uses a WorkspaceEdit so the
   * change integrates with VS Code's undo stack.
   */
  private async applyEdit(
    document: vscode.TextDocument,
    newContent: string,
  ): Promise<void> {
    const currentText = document.getText();
    if (currentText === newContent) return;

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(currentText.length),
    );
    edit.replace(document.uri, fullRange, newContent);
    await vscode.workspace.applyEdit(edit);
  }
}
