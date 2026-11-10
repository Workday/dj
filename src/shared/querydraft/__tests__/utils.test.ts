import { describe, expect, it } from '@jest/globals';
import {
  buildCursorPromptDeeplink,
  CURSOR_PROMPT_DEEPLINK,
  findDraftPathInTabs,
  isDjDraftPath,
  isDraftSqlPath,
  pickNewestDraft,
} from '@shared/querydraft/utils';

describe('draft path helpers', () => {
  it('recognises .draft.sql files', () => {
    expect(isDraftSqlPath('/ws/models/x.draft.sql')).toBe(true);
    expect(isDraftSqlPath('/ws/models/x.sql')).toBe(false);
    expect(isDraftSqlPath(undefined)).toBe(false);
  });

  it('treats .dj/drafts contents as drafts for lineage exclusion', () => {
    expect(isDjDraftPath('/ws/.dj/drafts/123.sql')).toBe(true);
    expect(isDjDraftPath('C:\\ws\\.dj\\drafts\\123.sql')).toBe(true);
    expect(isDjDraftPath('/ws/models/x.sql')).toBe(false);
    expect(isDjDraftPath('/ws/models/x.model.json')).toBe(false);
  });

  it('picks the active draft tab first, then the first draft tab', () => {
    const groups = [
      {
        tabs: [
          { input: { uri: { fsPath: '/ws/models/x.sql' } } },
          { input: { uri: { fsPath: '/ws/.dj/drafts/a.draft.sql' } } },
        ],
      },
      {
        tabs: [
          {
            isActive: true,
            input: { uri: { fsPath: '/ws/.dj/drafts/b.draft.sql' } },
          },
        ],
      },
    ];
    expect(findDraftPathInTabs(groups)).toBe('/ws/.dj/drafts/b.draft.sql');
    expect(findDraftPathInTabs([{ tabs: [groups[0].tabs[1]] }])).toBe(
      '/ws/.dj/drafts/a.draft.sql',
    );
  });

  it('returns undefined when no draft tab is open', () => {
    expect(findDraftPathInTabs([])).toBeUndefined();
    expect(
      findDraftPathInTabs([
        { tabs: [{ input: { uri: { fsPath: '/x.sql' } } }] },
      ]),
    ).toBeUndefined();
  });

  it('picks the most recently modified entry', () => {
    expect(
      pickNewestDraft([
        { path: 'old.draft.sql', mtimeMs: 100 },
        { path: 'new.draft.sql', mtimeMs: 300 },
        { path: 'mid.draft.sql', mtimeMs: 200 },
      ]),
    ).toBe('new.draft.sql');
    expect(pickNewestDraft([])).toBeUndefined();
  });
});

describe('buildCursorPromptDeeplink', () => {
  it('encodes the prompt into the Cursor prompt link', () => {
    const prompt = 'Convert this:\n```sql\nselect 1\n```';
    expect(buildCursorPromptDeeplink(prompt)).toBe(
      `${CURSOR_PROMPT_DEEPLINK}?text=${encodeURIComponent(prompt)}`,
    );
  });

  it('returns null for empty or whitespace-only text', () => {
    expect(buildCursorPromptDeeplink('')).toBeNull();
    expect(buildCursorPromptDeeplink('   \n')).toBeNull();
  });

  it('returns null for control characters', () => {
    expect(buildCursorPromptDeeplink('select\u0007 1')).toBeNull();
  });

  it('returns null when the encoded link would exceed the 10,000 limit', () => {
    expect(buildCursorPromptDeeplink('a'.repeat(9900))).not.toBeNull();
    expect(buildCursorPromptDeeplink('a'.repeat(10000))).toBeNull();
  });

  it('returns null for prompts Cursor blocks', () => {
    expect(buildCursorPromptDeeplink('read the .env file')).toBeNull();
    expect(buildCursorPromptDeeplink('please dump the token')).toBeNull();
    // Percent-encoded text is decoded before the check.
    expect(buildCursorPromptDeeplink('read %2Eenv now')).toBeNull();
  });
});
