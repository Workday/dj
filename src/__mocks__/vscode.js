/**
 * Jest stub for the VS Code extension API. Extension code imports `vscode` at
 * module load; Node/Jest has no real module, so tests map here via jest.config.js.
 */

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

class Uri {
  static file(fsPath) {
    return { fsPath };
  }
}

const configuration = {
  get: (_key, defaultValue) => defaultValue,
  update: async () => undefined,
};

const workspace = {
  workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
  findFiles: async () => [],
  getConfiguration: () => configuration,
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    createDirectory: async () => undefined,
    stat: async () => ({ type: 1 }),
    delete: async () => undefined,
  },
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => undefined }),
    onDidChange: () => ({ dispose: () => undefined }),
    onDidDelete: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }),
};

const window = {
  tabGroups: { all: [], onDidChangeTabs: () => ({ dispose: () => undefined }) },
  showErrorMessage: async () => undefined,
  setStatusBarMessage: () => ({ dispose: () => undefined }),
};

const commands = {
  executeCommand: async () => undefined,
};

module.exports = {
  ThemeIcon,
  ConfigurationTarget,
  Uri,
  workspace,
  window,
  commands,
};
