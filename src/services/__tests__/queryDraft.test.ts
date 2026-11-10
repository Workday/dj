import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Coder } from '@services/coder';
import { QueryDraftService } from '@services/queryDraft';
import { NO_DRAFT_FOUND_MESSAGE } from '@shared/querydraft/utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// Keep the workspace in a fixed temp folder. jest.mock factories are hoisted,
// so they can't reference variables declared in this file.
jest.mock('admin', () => {
  const realPath = jest.requireActual<typeof path>('path');
  const realOs = jest.requireActual<typeof os>('os');
  return {
    WORKSPACE_ROOT: realPath.join(realOs.tmpdir(), 'dj-query-draft-test-ws'),
  };
});

const WORKSPACE = path.join(os.tmpdir(), 'dj-query-draft-test-ws');
const DRAFTS_DIR = path.join(WORKSPACE, '.dj', 'drafts');

function writeDraft(name: string, text: string, mtimeSec?: number): string {
  const filePath = path.join(DRAFTS_DIR, name);
  fs.writeFileSync(filePath, text, 'utf8');
  if (mtimeSec !== undefined) {
    fs.utimesSync(filePath, mtimeSec, mtimeSec);
  }
  return filePath;
}

function editorFor(filePath: string, text: string) {
  return { document: { uri: { fsPath: filePath }, getText: () => text } };
}

// The raw mock module object is mutable; the `import * as` namespace is not.
// queryDraft reads these through the same live module object.
const rawVscode = jest.requireActual<any>('vscode');

function makeService() {
  const log = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const service = new QueryDraftService({
    coder: { log } as unknown as Coder,
  });
  return { service, log };
}

describe('QueryDraftService draft lookup', () => {
  const win = vscode.window as any;
  const ws = vscode.workspace as any;
  let service: QueryDraftService;

  beforeEach(() => {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    fs.mkdirSync(DRAFTS_DIR, { recursive: true });
    ({ service } = makeService());

    win.activeTextEditor = undefined;
    win.visibleTextEditors = [];
    win.tabGroups = { all: [] };
    win.showWarningMessage = jest.fn();
    win.showInformationMessage = jest.fn();
    ws.textDocuments = [];
    rawVscode.commands.executeCommand = jest.fn();
    rawVscode.env.openExternal = jest.fn(async () => true);
    rawVscode.env.clipboard.writeText = jest.fn(async () => undefined);
  });

  afterAll(() => {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
  });

  it('reads the file passed in by the command, without any open editor', async () => {
    const filePath = writeDraft('a.draft.sql', 'select 1 as from_uri');
    const sql = await service.getCurrentDraftContent(vscode.Uri.file(filePath));
    expect(sql).toBe('select 1 as from_uri');
  });

  it('ignores a passed file that is not a draft and uses the active draft editor', async () => {
    const draft = writeDraft('b.draft.sql', 'select 2');
    win.activeTextEditor = editorFor(draft, 'select 2 unsaved');
    const sql = await service.getCurrentDraftContent(
      vscode.Uri.file('/ws/models/x.model.json'),
    );
    expect(sql).toBe('select 2 unsaved');
  });

  it('prefers an open document over the file on disk', async () => {
    const draft = writeDraft('c.draft.sql', 'on disk');
    ws.textDocuments = [{ uri: { fsPath: draft }, getText: () => 'in editor' }];
    expect(await service.getCurrentDraftContent()).toBe('in editor');
  });

  it('falls back to a visible draft editor when nothing is active', async () => {
    const draft = writeDraft('d.draft.sql', 'select 4');
    win.visibleTextEditors = [editorFor(draft, 'select 4 visible')];
    expect(await service.getCurrentDraftContent()).toBe('select 4 visible');
  });

  it('falls back to a draft editor tab and reads it from disk', async () => {
    const draft = writeDraft('e.draft.sql', 'select 5 from tab');
    win.tabGroups = {
      all: [
        {
          tabs: [{ isActive: true, input: { uri: { fsPath: draft } } }],
        },
      ],
    };
    expect(await service.getCurrentDraftContent()).toBe('select 5 from tab');
  });

  it('falls back to the newest draft in .dj/drafts', async () => {
    writeDraft('old.draft.sql', 'old', 1_000_000);
    writeDraft('new.draft.sql', 'new', 2_000_000);
    expect(await service.getCurrentDraftContent()).toBe('new');
  });

  it('returns null when no draft can be found', async () => {
    expect(await service.getCurrentDraftContent()).toBeNull();
  });

  it('shows the next-step message when there is no draft to convert', async () => {
    await service.convertDraftToModel('cursor');
    expect(win.showWarningMessage).toHaveBeenCalledWith(NO_DRAFT_FOUND_MESSAGE);
  });

  it('opens the Cursor prompt link when the prompt fits', async () => {
    const draft = writeDraft('f.draft.sql', 'select 6');
    await service.convertDraftToModel('cursor', vscode.Uri.file(draft));
    const openExternal = rawVscode.env.openExternal as jest.Mock;
    expect(openExternal).toHaveBeenCalledTimes(1);
    const link = String(openExternal.mock.calls[0][0]);
    expect(
      link.startsWith('cursor://anysphere.cursor-deeplink/prompt?text='),
    ).toBe(true);
    expect(decodeURIComponent(link)).toContain('select 6');
    expect(rawVscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies the prompt and opens the composer when the link is too long', async () => {
    const big = 'select 1 -- ' + 'x'.repeat(12000);
    const draft = writeDraft('g.draft.sql', big);
    await service.convertDraftToModel('cursor', vscode.Uri.file(draft));
    expect(rawVscode.env.openExternal).not.toHaveBeenCalled();
    expect(rawVscode.env.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(big),
    );
    expect(rawVscode.commands.executeCommand).toHaveBeenCalledWith(
      'composer.startComposerPrompt',
    );
    expect(win.showInformationMessage).toHaveBeenCalledWith(
      'Prompt copied. Paste it into the Cursor chat.',
    );
  });
});
