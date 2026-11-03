import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Coder } from '@services/coder';
import { ColumnLineageService } from '@services/columnLineage';
import * as vscode from 'vscode';

function makeService() {
  const handleApi = jest.fn();
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const coder = { api: { handleApi }, log } as unknown as Coder;
  return { service: new ColumnLineageService(coder), handleApi, log };
}

describe('ColumnLineageService draft exclusion', () => {
  const win = vscode.window as any;

  beforeEach(() => {
    win.showWarningMessage = jest.fn();
  });

  it('does not treat query drafts as supported lineage files', () => {
    const { service } = makeService();
    expect(service.isSupportedFile('/ws/.dj/drafts/123.draft.sql')).toBe(false);
    expect(service.isSupportedFile('/ws/models/x.draft.sql')).toBe(false);
  });

  it('keeps model, source, and dbt files supported', () => {
    const { service } = makeService();
    expect(service.isSupportedFile('/ws/models/x.sql')).toBe(true);
    expect(service.isSupportedFile('/ws/models/x.model.json')).toBe(true);
    expect(service.isSupportedFile('/ws/models/x.source.json')).toBe(true);
    expect(service.isSupportedFile('/ws/models/schema.yml')).toBe(true);
  });

  it('skips drafts in loadForFile without calling the API or logging a warning', async () => {
    const { service, handleApi, log } = makeService();
    const loaded = await service.loadForFile('/ws/.dj/drafts/123.draft.sql');
    expect(loaded).toBe(false);
    expect(handleApi).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(win.showWarningMessage).not.toHaveBeenCalled();
  });

  it('explains why a draft has no lineage when the user asked for it', async () => {
    const { service, handleApi } = makeService();
    await service.loadForFile('/ws/.dj/drafts/123.draft.sql', {
      showErrors: true,
    });
    expect(handleApi).not.toHaveBeenCalled();
    expect(win.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not query drafts'),
    );
  });
});
