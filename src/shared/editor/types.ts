/**
 * Messages exchanged between the DJ visual editor webview and the extension host.
 */
export type DjEditorMessage =
  | DjEditorReady
  | DjEditorInit
  | DjEditorEdit
  | DjEditorUpdate;

/** Webview signals it has mounted and is ready to receive content */
export interface DjEditorReady {
  type: 'dj-editor-ready';
}

/** Extension sends initial document content to the webview */
export interface DjEditorInit {
  type: 'dj-editor-init';
  content: string;
  fileName: string;
}

/** Webview sends an edited document back to the extension */
export interface DjEditorEdit {
  type: 'dj-editor-edit';
  content: string;
}

/** Extension pushes updated content to the webview (external change) */
export interface DjEditorUpdate {
  type: 'dj-editor-update';
  content: string;
}
