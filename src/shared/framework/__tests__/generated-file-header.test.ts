import { describe, expect, test } from '@jest/globals';
import {
  compareVersions,
  decideGeneratedFileAction,
  hasConflictMarkers,
  parseGeneratedFile,
  withGeneratedHeader,
} from '@shared/framework/generated-file-header';

const BODY = '"""Shared helpers."""\nimport os\n\nVALUE = 1\n';

describe('compareVersions', () => {
  test.each([
    ['2.5.0', '2.5.0', 0],
    ['2.4.9', '2.5.0', -1],
    ['2.10.0', '2.9.3', 1],
    ['2.5', '2.5.0', 0],
    ['v2.5.0', '2.5.0', 0],
    ['2.5.0-beta.1', '2.5.0', -1],
    ['2.5.0', '2.5.0-beta.1', 1],
    ['2.5.0-beta.1', '2.5.0-beta.2', -1],
  ])('%s vs %s', (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });
});

describe('withGeneratedHeader / parseGeneratedFile', () => {
  test('round-trips version and body', () => {
    const content = withGeneratedHeader(BODY, '2.5.0');
    expect(content.split('\n')[0]).toBe('# dj-generated: version=2.5.0');
    const parsed = parseGeneratedFile(content);
    expect(parsed.header).toEqual({ version: '2.5.0' });
    expect(parsed.body).toBe(BODY);
  });

  test('normalizes CRLF on parse', () => {
    const crlf = withGeneratedHeader(BODY, '2.5.0').replace(/\n/g, '\r\n');
    const parsed = parseGeneratedFile(crlf);
    expect(parsed.header?.version).toBe('2.5.0');
    expect(parsed.body).toBe(BODY);
  });

  test('parses version when legacy sha256 suffix is present', () => {
    const legacy = `# dj-generated: version=2.5.0 sha256=abc123\n${BODY}`;
    expect(parseGeneratedFile(legacy).header).toEqual({ version: '2.5.0' });
  });

  test('returns the full content as body when there is no header', () => {
    expect(parseGeneratedFile(BODY)).toEqual({ body: BODY });
  });
});

describe('hasConflictMarkers', () => {
  test('detects git conflict blocks', () => {
    const conflicted = [
      '<<<<<<< HEAD',
      'a = 1',
      '=======',
      'a = 2',
      '>>>>>>> origin/master',
      '',
    ].join('\n');
    expect(hasConflictMarkers(conflicted)).toBe(true);
  });

  test('ignores banner comments made of = signs', () => {
    expect(hasConflictMarkers('# =======\nx = 1\n=======\n')).toBe(false);
  });
});

describe('decideGeneratedFileAction', () => {
  const decide = (existing: string | undefined, version = '2.5.0') =>
    decideGeneratedFileAction({ existing, desiredBody: BODY, version });

  test('writes a missing file', () => {
    expect(decide(undefined)).toEqual({ action: 'write', reason: 'missing' });
  });

  test('writes an unversioned (pre-header) file', () => {
    expect(decide(BODY)).toEqual({ action: 'write', reason: 'unversioned' });
  });

  test('keeps an identical file for the same version', () => {
    expect(decide(withGeneratedHeader(BODY, '2.5.0'))).toEqual({
      action: 'keep',
      reason: 'up-to-date',
    });
  });

  test('keeps an identical file stamped by an older version (no churn)', () => {
    expect(decide(withGeneratedHeader(BODY, '2.4.0'))).toEqual({
      action: 'keep',
      reason: 'up-to-date',
    });
  });

  test('keeps an identical file checked out with CRLF line endings', () => {
    const crlf = withGeneratedHeader(BODY, '2.5.0').replace(/\n/g, '\r\n');
    expect(decide(crlf)).toEqual({ action: 'keep', reason: 'up-to-date' });
  });

  test('rewrites an outdated file from an older version', () => {
    expect(decide(withGeneratedHeader('OLD = 1\n', '2.4.0'))).toEqual({
      action: 'write',
      reason: 'outdated',
    });
  });

  test('rewrites a same-version file whose output changed', () => {
    expect(decide(withGeneratedHeader('OTHER = 1\n', '2.5.0'))).toEqual({
      action: 'write',
      reason: 'changed',
    });
  });

  test('never downgrades a file stamped by a newer version', () => {
    expect(decide(withGeneratedHeader('NEWER = 1\n', '2.6.0'))).toEqual({
      action: 'keep',
      reason: 'newer',
      fileVersion: '2.6.0',
    });
  });

  test('rewrites a hand-edited file when body differs from desired', () => {
    const edited = withGeneratedHeader(BODY, '2.5.0') + 'HACK = True\n';
    expect(decide(edited)).toEqual({ action: 'write', reason: 'changed' });
  });

  describe('legacy sha256 header', () => {
    const legacy = (version: string, body = BODY) =>
      `# dj-generated: version=${version} sha256=${'a'.repeat(64)}\n${body}`;

    test('rewrites the header once when the body is identical', () => {
      expect(decide(legacy('2.5.0'))).toEqual({
        action: 'write',
        reason: 'legacy-header',
      });
    });

    test('rewrites a CRLF checkout of a legacy header', () => {
      expect(decide(legacy('2.5.0').replace(/\n/g, '\r\n'))).toEqual({
        action: 'write',
        reason: 'legacy-header',
      });
    });

    test('still never downgrades a legacy header from a newer version', () => {
      expect(decide(legacy('2.6.0', 'NEWER = 1\n'))).toEqual({
        action: 'keep',
        reason: 'newer',
        fileVersion: '2.6.0',
      });
    });
  });

  test('keeps a file with conflict markers', () => {
    const conflicted = `<<<<<<< HEAD\n${BODY}=======\nOTHER = 1\n>>>>>>> master\n`;
    expect(decide(conflicted)).toEqual({ action: 'keep', reason: 'conflict' });
  });
});
