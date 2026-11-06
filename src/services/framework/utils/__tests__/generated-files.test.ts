import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { withGeneratedHeader } from '@shared/framework/generated-file-header';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  buildGitAttributesContent,
  getDjExtensionVersion,
  registerGeneratedFileSaveGuard,
  registerReadonlyGeneratedPaths,
  writeGeneratedFileIfOutdated,
} from '../generated-files';
import { findGitDir, isGitOperationInProgress } from '../git-operation';

type Listener<T> = (event: T) => unknown;

type MutableMock = Record<string, unknown> & {
  fs: Record<string, unknown>;
};
const workspace = vscode.workspace as unknown as MutableMock;
const window = vscode.window as unknown as Record<string, unknown>;

const log = { info: jest.fn(), warn: jest.fn() };
const BODY = 'VALUE = 1\n';

let tmpRoot: string;
let disk: Map<string, string>;
let writes: string[];

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-generated-'));
  disk = new Map();
  writes = [];
  workspace.fs.readFile = jest.fn((uri: { fsPath: string }) => {
    const text = disk.get(uri.fsPath);
    return text === undefined
      ? Promise.reject(new Error('ENOENT'))
      : Promise.resolve(Buffer.from(text));
  });
  workspace.fs.writeFile = jest.fn(
    (uri: { fsPath: string }, data: Uint8Array) => {
      writes.push(uri.fsPath);
      disk.set(uri.fsPath, Buffer.from(data).toString());
      return Promise.resolve();
    },
  );
  workspace.fs.createDirectory = jest.fn(() => Promise.resolve());
  window.showInformationMessage = jest.fn(() => Promise.resolve());
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  jest.clearAllMocks();
});

function startGitOperation(marker: string): void {
  fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, '.git', marker), '');
}

describe('git operation detection', () => {
  test('is false outside a git operation', () => {
    fs.mkdirSync(path.join(tmpRoot, '.git'));
    expect(isGitOperationInProgress(tmpRoot)).toBe(false);
  });

  test.each(['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'])(
    'detects %s',
    (marker) => {
      startGitOperation(marker);
      expect(isGitOperationInProgress(path.join(tmpRoot, 'dags'))).toBe(true);
    },
  );

  test.each(['rebase-merge', 'rebase-apply'])('detects %s', (marker) => {
    fs.mkdirSync(path.join(tmpRoot, '.git', marker), { recursive: true });
    expect(isGitOperationInProgress(tmpRoot)).toBe(true);
  });

  test('follows a worktree .git file', () => {
    const realGitDir = path.join(tmpRoot, 'main.git', 'worktrees', 'wt');
    fs.mkdirSync(realGitDir, { recursive: true });
    const worktree = path.join(tmpRoot, 'wt');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${realGitDir}\n`);
    expect(findGitDir(worktree)).toBe(realGitDir);
    fs.writeFileSync(path.join(realGitDir, 'MERGE_HEAD'), '');
    expect(isGitOperationInProgress(worktree)).toBe(true);
  });
});

describe('getDjExtensionVersion', () => {
  test('reads the extension package.json version', () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../../../../package.json'),
        'utf8',
      ),
    ) as { version: string };
    expect(getDjExtensionVersion()).toBe(pkg.version);
  });
});

describe('writeGeneratedFileIfOutdated', () => {
  const filePath = () => path.join(tmpRoot, 'dags', 'python_models', '_x.py');

  test('writes a missing file with a version header', async () => {
    const decision = await writeGeneratedFileIfOutdated({
      filePath: filePath(),
      body: BODY,
      log,
      version: '2.5.0',
    });
    expect(decision).toEqual({ action: 'write', reason: 'missing' });
    expect(disk.get(filePath())).toBe(withGeneratedHeader(BODY, '2.5.0'));
  });

  test('does not downgrade a file pulled from a newer DJ', async () => {
    const upstream = withGeneratedHeader('NEWER = 1\n', '2.6.0');
    disk.set(filePath(), upstream);
    const decision = await writeGeneratedFileIfOutdated({
      filePath: filePath(),
      body: BODY,
      log,
      version: '2.5.0',
    });
    expect(decision.action).toBe('keep');
    expect(writes).toEqual([]);
    expect(disk.get(filePath())).toBe(upstream);
  });

  test('does not rewrite a CRLF checkout of identical content', async () => {
    disk.set(
      filePath(),
      withGeneratedHeader(BODY, '2.5.0').replace(/\n/g, '\r\n'),
    );
    await writeGeneratedFileIfOutdated({
      filePath: filePath(),
      body: BODY,
      log,
      version: '2.5.0',
    });
    expect(writes).toEqual([]);
  });

  test('leaves every file alone while a merge is in progress', async () => {
    startGitOperation('MERGE_HEAD');
    const decision = await writeGeneratedFileIfOutdated({
      filePath: filePath(),
      body: BODY,
      log,
      version: '2.5.0',
    });
    expect(decision).toEqual({ action: 'keep', reason: 'git-operation' });
    expect(writes).toEqual([]);
  });
});

describe('registerGeneratedFileSaveGuard', () => {
  let willSave: Listener<unknown> | undefined;
  let didSave: Listener<unknown> | undefined;
  const guardedPath = () =>
    path.join(tmpRoot, 'dags', 'python_models', '_trino_io.py');

  beforeEach(() => {
    willSave = undefined;
    didSave = undefined;
    workspace.onWillSaveTextDocument = jest.fn((cb: Listener<unknown>) => {
      willSave = cb;
      return { dispose: () => undefined };
    });
    workspace.onDidSaveTextDocument = jest.fn((cb: Listener<unknown>) => {
      didSave = cb;
      return { dispose: () => undefined };
    });
    workspace.createFileSystemWatcher = jest.fn(() => {
      throw new Error('file-system watchers must not be used');
    });
  });

  const register = () =>
    registerGeneratedFileSaveGuard({
      isGuarded: (fsPath) => fsPath === guardedPath(),
      log,
    });

  async function save(fsPath: string, newText: string): Promise<void> {
    const document = { uri: { fsPath }, getText: () => newText };
    let pending: Promise<unknown> = Promise.resolve();
    willSave?.({
      document,
      waitUntil: (thenable: Promise<unknown>) => {
        pending = thenable;
      },
    });
    await pending;
    disk.set(fsPath, newText);
    await didSave?.(document);
  }

  test('ignores non-editor writes such as git checkouts', () => {
    register();
    expect(workspace.createFileSystemWatcher).not.toHaveBeenCalled();
    // A git checkout rewrites the file on disk without raising save events
    disk.set(guardedPath(), 'UPSTREAM = 1\n');
    expect(writes).toEqual([]);
    expect(disk.get(guardedPath())).toBe('UPSTREAM = 1\n');
  });

  test('reverts an editor save to the content on disk before the save', async () => {
    register();
    disk.set(guardedPath(), 'FROM_GIT = 1\n');
    await save(guardedPath(), 'HAND_EDIT = 1\n');
    expect(disk.get(guardedPath())).toBe('FROM_GIT = 1\n');
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  test('does not revert a save that only changes line endings', async () => {
    register();
    disk.set(guardedPath(), 'A = 1\nB = 2\n');
    writes = [];
    await save(guardedPath(), 'A = 1\r\nB = 2\r\n');
    expect(writes).toEqual([]);
  });

  test('ignores saves of unguarded files', async () => {
    register();
    const other = path.join(
      tmpRoot,
      'dags',
      'python_models',
      'model.python.py',
    );
    disk.set(other, 'X = 1\n');
    await save(other, 'X = 2\n');
    expect(disk.get(other)).toBe('X = 2\n');
    expect(writes).toEqual([]);
  });

  test('allows saves while a merge is in progress', async () => {
    register();
    startGitOperation('MERGE_HEAD');
    disk.set(guardedPath(), '<<<<<<< HEAD\nA\n=======\nB\n>>>>>>> master\n');
    await save(guardedPath(), 'B\n');
    expect(disk.get(guardedPath())).toBe('B\n');
    expect(writes).toEqual([]);
  });
});

describe('buildGitAttributesContent', () => {
  const paths = [
    path.join('dags', 'python_models', '_trino_io.py'),
    path.join('dags', 'python_models', '_config.py'),
  ];

  test('creates a sorted section when the file is missing', () => {
    expect(buildGitAttributesContent(undefined, paths)).toBe(
      [
        '# DJ-generated files',
        'dags/python_models/_config.py eol=lf linguist-generated=true',
        'dags/python_models/_trino_io.py eol=lf linguist-generated=true',
        '',
      ].join('\n'),
    );
  });

  test('appends only missing entries and keeps existing lines verbatim', () => {
    const existing = '*.png binary\ndags/python_models/_config.py -diff\n';
    expect(buildGitAttributesContent(existing, paths)).toBe(
      [
        '*.png binary',
        'dags/python_models/_config.py -diff',
        '# DJ-generated files',
        'dags/python_models/_trino_io.py eol=lf linguist-generated=true',
        '',
      ].join('\n'),
    );
  });

  test('returns undefined when every path is declared', () => {
    const existing = buildGitAttributesContent(undefined, paths);
    expect(buildGitAttributesContent(existing, paths)).toBeUndefined();
  });

  test('skips paths outside the workspace', () => {
    expect(
      buildGitAttributesContent(undefined, [path.join('..', 'x.py')]),
    ).toBeUndefined();
  });
});

describe('registerReadonlyGeneratedPaths', () => {
  test('merges new globs into the workspace readonlyInclude setting', async () => {
    const update = jest.fn(() => Promise.resolve());
    workspace.getConfiguration = jest.fn(() => ({
      inspect: () => ({
        workspaceValue: {
          'other/**': true,
          'dags/python_models/_config.py': false,
        },
      }),
      update,
    }));

    await registerReadonlyGeneratedPaths(tmpRoot, [
      path.join(tmpRoot, 'dags', 'python_models', '_config.py'),
      path.join(tmpRoot, 'dags', 'python_models', '_trino_io.py'),
    ]);

    expect(update).toHaveBeenCalledWith(
      'readonlyInclude',
      {
        'other/**': true,
        'dags/python_models/_config.py': false,
        'dags/python_models/_trino_io.py': true,
      },
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('does not touch settings when every glob is present', async () => {
    const update = jest.fn(() => Promise.resolve());
    workspace.getConfiguration = jest.fn(() => ({
      inspect: () => ({
        workspaceValue: { 'dags/python_models/_trino_io.py': true },
      }),
      update,
    }));

    await registerReadonlyGeneratedPaths(tmpRoot, [
      path.join(tmpRoot, 'dags', 'python_models', '_trino_io.py'),
    ]);
    expect(update).not.toHaveBeenCalled();
  });
});
