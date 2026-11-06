/**
 * Unit tests for the `dj.lightdash.restrictedProjects` enforcement inside
 * `executeLightdashUpload`. We mock `getDjConfig` to control the policy
 * and `child_process.spawn` to detect whether the CLI was invoked.
 *
 *   - mode=block        → success: false, CLI never spawned
 *   - mode=warn (no ack) → success: false, CLI never spawned
 *   - mode=warn (acked)  → CLI spawned (then we let it exit cleanly)
 *   - allow              → CLI spawned (then we let it exit cleanly)
 */

import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { resolveLightdashProjectUuid } from '@services/lightdash/projectResolver';
import { EventEmitter } from 'events';

const AAA_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BBB_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mockResolveProject = resolveLightdashProjectUuid as jest.MockedFunction<
  typeof resolveLightdashProjectUuid
>;

// Minimal vscode mock - `admin.ts` reads workspaceFolders at import time
// and the dashboards-as-code module imports `vscode` for path helpers.
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

// Mock `@services/config` so individual tests can dictate the
// restricted-projects list.
const mockGetDjConfig = jest.fn();
jest.mock('@services/config', () => ({
  getDjConfig: mockGetDjConfig,
  updateDjSetting: jest.fn(),
}));

// Keep the real resolver by default; slug tests override it per call.
jest.mock('@services/lightdash/projectResolver', () => {
  const actual = jest.requireActual(
    '@services/lightdash/projectResolver',
  ) as typeof import('@services/lightdash/projectResolver');
  return {
    ...actual,
    resolveLightdashProjectUuid: jest.fn((value: string) =>
      actual.resolveLightdashProjectUuid(value),
    ),
  };
});

// Capture spawn() invocations and return a fake ChildProcess that
// closes successfully so the upload "happy path" resolves.
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

function makeFakeChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  setImmediate(() => emitter.emit('close', 0));
  return emitter;
}

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<
  typeof import('@services/lightdash/dashboardsAsCode').executeLightdashUpload
>[1];

const noopOnLog = () => undefined;

const baseRequest = {
  path: 'lightdash',
  chartSlugs: ['orders-by-region'],
  dashboardSlugs: [],
  project: AAA_UUID,
};

// Defer import until after the mocks are set up.
let executeLightdashUpload: typeof import('@services/lightdash/dashboardsAsCode').executeLightdashUpload;
beforeAll(async () => {
  ({ executeLightdashUpload } = await import(
    '@services/lightdash/dashboardsAsCode'
  ));
});

beforeEach(() => {
  mockGetDjConfig.mockReset();
  mockSpawn.mockReset();
  mockSpawn.mockImplementation(() => makeFakeChildProcess());
});

describe('executeLightdashUpload restriction enforcement', () => {
  it('refuses block-mode uploads and never spawns the CLI', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashRestrictedProjects: [
        { uuid: AAA_UUID, mode: 'block', label: 'production' },
      ],
    });
    const result = await executeLightdashUpload(
      baseRequest,
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(false);
    expect(result.restriction?.status).toBe('block');
    expect(result.error).toMatch(/blocked/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('refuses warn-mode uploads when acknowledgedWarning is missing', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashRestrictedProjects: [
        { uuid: AAA_UUID, mode: 'warn', label: 'production' },
      ],
    });
    const result = await executeLightdashUpload(
      baseRequest,
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(false);
    expect(result.restriction?.status).toBe('warn');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('proceeds with warn-mode uploads when acknowledgedWarning is true', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashRestrictedProjects: [
        { uuid: AAA_UUID, mode: 'warn', label: 'production' },
      ],
    });
    const result = await executeLightdashUpload(
      { ...baseRequest, acknowledgedWarning: true },
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[0]).toBe('lightdash');
    expect(spawnArgs[1]).toEqual(
      expect.arrayContaining(['upload', '--project', AAA_UUID]),
    );
  });

  it('proceeds when the project is not on the restricted list', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashRestrictedProjects: [{ uuid: BBB_UUID, mode: 'block' }],
    });
    const result = await executeLightdashUpload(
      baseRequest,
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the restricted-projects list is empty / undefined', async () => {
    mockGetDjConfig.mockReturnValue({});
    const result = await executeLightdashUpload(
      baseRequest,
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('still rejects when project is empty (existing behavior, no policy bypass)', async () => {
    mockGetDjConfig.mockReturnValue({
      lightdashRestrictedProjects: [],
    });
    const result = await executeLightdashUpload(
      { ...baseRequest, project: '' },
      noopLogger,
      noopOnLog,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/project slug or uuid is required/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  describe('slug input', () => {
    it('applies the block policy to the UUID a slug resolves to', async () => {
      mockGetDjConfig.mockReturnValue({
        lightdashRestrictedProjects: [
          { uuid: AAA_UUID, mode: 'block', label: 'production' },
        ],
      });
      mockResolveProject.mockResolvedValueOnce({ ok: true, uuid: AAA_UUID });
      const result = await executeLightdashUpload(
        { ...baseRequest, project: 'jaffle-prod' },
        noopLogger,
        noopOnLog,
      );
      expect(mockResolveProject).toHaveBeenCalledWith('jaffle-prod');
      expect(result.success).toBe(false);
      expect(result.restriction?.status).toBe('block');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('applies the warn policy to the UUID a slug resolves to', async () => {
      mockGetDjConfig.mockReturnValue({
        lightdashRestrictedProjects: [{ uuid: AAA_UUID, mode: 'warn' }],
      });
      mockResolveProject.mockResolvedValueOnce({ ok: true, uuid: AAA_UUID });
      const result = await executeLightdashUpload(
        { ...baseRequest, project: 'jaffle-prod' },
        noopLogger,
        noopOnLog,
      );
      expect(result.restriction?.status).toBe('warn');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('refuses the upload when the slug cannot be resolved', async () => {
      mockGetDjConfig.mockReturnValue({ lightdashRestrictedProjects: [] });
      mockResolveProject.mockResolvedValueOnce({
        ok: false,
        error: 'No project found with UUID or slug "missing".',
      });
      const result = await executeLightdashUpload(
        { ...baseRequest, project: 'missing' },
        noopLogger,
        noopOnLog,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no project found/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('passes the resolved UUID to the CLI --project flag', async () => {
      mockGetDjConfig.mockReturnValue({
        lightdashRestrictedProjects: [{ uuid: BBB_UUID, mode: 'block' }],
      });
      mockResolveProject.mockResolvedValueOnce({ ok: true, uuid: AAA_UUID });
      const result = await executeLightdashUpload(
        { ...baseRequest, project: 'jaffle-dev' },
        noopLogger,
        noopOnLog,
      );
      expect(result.success).toBe(true);
      const spawnArgs = mockSpawn.mock.calls[0];
      expect(spawnArgs[1]).toEqual(
        expect.arrayContaining(['--project', AAA_UUID]),
      );
    });
  });
});
