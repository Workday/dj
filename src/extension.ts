import { Coder } from '@services/coder';
import * as vscode from 'vscode';

let coder: Coder;

export async function activate(context: vscode.ExtensionContext) {
  // Set context variable so our keybindings take precedence over other dbt extensions
  await vscode.commands.executeCommand('setContext', 'dj.active', true);

  try {
    coder = new Coder(context);
    await coder.activate();
  } catch (error: unknown) {
    console.error('[DJ] FATAL ERROR during extension activation:', error);
    vscode.window.showErrorMessage(
      `DJ (Data JSON) Framework extension failed to activate: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

export function deactivate() {
  coder?.deactivate();
}
