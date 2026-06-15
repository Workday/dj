/**
 * Unit tests for the `lightdash-yaml-get-download-defaults` handler, which
 * seeds the Download tab's option defaults from VS Code settings. We mock
 * `@services/config` so each test can dictate the configured value and
 * assert the handler echoes it back (falling back to `true` when unset).
 */

import { describe, expect, it, jest } from '@jest/globals';

// Minimal vscode mock - `admin.ts` reads workspaceFolders at import time
// and the Lightdash service constructs `ThemeIcon` instances in its field
// initializers.
jest.mock(
  'vscode',
  () => ({
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/tmp/dj-test-ws' } }],
      getConfiguration: () => ({ get: () => undefined, update: jest.fn() }),
      onDidChangeConfiguration: jest.fn(),
    },
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => p }),
    },
    ThemeIcon: class {
      constructor(public readonly id: string) {}
    },
    ConfigurationTarget: { Workspace: 1, Global: 2, WorkspaceFolder: 3 },
    extensions: { getExtension: () => undefined, onDidChange: jest.fn() },
    window: {
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      setStatusBarMessage: jest.fn(),
    },
    commands: { executeCommand: jest.fn() },
  }),
  { virtual: true },
);

// Mock `@services/config` so individual tests can dictate the configured
// `lightdashDefaultAddPathToGitignore` value.
const mockGetDjConfig = jest.fn();
jest.mock('@services/config', () => ({
  getDjConfig: mockGetDjConfig,
  updateDjSetting: jest.fn(),
}));

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as import('@services/djLogger').DJLogger;

// Defer import until after the mocks are set up.
let Lightdash: typeof import('@services/lightdash').Lightdash;
beforeAll(async () => {
  ({ Lightdash } = await import('@services/lightdash'));
});

function makeService() {
  return new Lightdash(
    {} as unknown as import('@services/dbt').Dbt,
    noopLogger,
    jest.fn() as never,
  );
}

beforeEach(() => {
  mockGetDjConfig.mockReset();
});

describe('lightdash-yaml-get-download-defaults', () => {
  it('returns the configured value when set to true', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashDefaultAddPathToGitignore: true,
    });
    const resp = await makeService().handleApi({
      type: 'lightdash-yaml-get-download-defaults',
      request: null,
    });
    expect(resp).toEqual({ addPathToGitignore: true });
  });

  it('returns the configured value when set to false', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashDefaultAddPathToGitignore: false,
    });
    const resp = await makeService().handleApi({
      type: 'lightdash-yaml-get-download-defaults',
      request: null,
    });
    expect(resp).toEqual({ addPathToGitignore: false });
  });

  it('falls back to true when the setting is undefined', async () => {
    mockGetDjConfig.mockReturnValue({});
    const resp = await makeService().handleApi({
      type: 'lightdash-yaml-get-download-defaults',
      request: null,
    });
    expect(resp).toEqual({ addPathToGitignore: true });
  });
});
